<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// DistributionOverlayPanel：地图叠层 + 反向查询 + 固定 seed 模拟（执行案 §4.5.4 / §4.5.5）
//
// 设计意图：
//   - 嵌入 GridCanvas + GridOverlay，让分布工作区有自己的地图画布
//   - 接管网格点击事件用于反向查询（不像 MapTab 仅在 sim-* 工具下响应）
//   - 根据 props.category 激活对应叠层 flag（poi / wilditem / enemy）：
//     · poi：overlayStore.flags.poi = true（P3 已实现 OverlayPoiDistribution）
//     · scatter：overlayStore.flags.wilditem = true（P4 新增 OverlayWilditemDistribution）
//     · enemy：overlayStore.flags.enemy = true（P4 新增 OverlayEnemyDistribution）
//     三类叠层互斥——切换类别时先清空所有分布叠层 flag，再激活对应 flag
//   - 固定 seed 模拟：仅 POI 类别提供"模拟一次放置"按钮（P3 已实现，per_region_count 模式）；
//     scatter（per_tile_probability 模式）与 enemy 的模拟按钮在 P4 阶段隐藏
//     （执行案 §4.5.5 审查补丁 C9：O-12 骨架未实现时仅保留"理论分布"显示）
//   - 右侧反向查询面板展示"该格可能生成哪些 X"——三类别共用同一面板
//
// 复用：
//   - GridCanvas / GridOverlay（与 WorldView.MapTab 同款）
//   - useDistributionWorkspace（共享选中规则 + 模拟结果）
//   - createRng（mulberry32 固定 seed，仅 POI 模拟使用）
//   - ReverseLookupPanel（已扩展支持三类别候选查询）
//
// 布局：
//   - 顶部：选中规则信息 + 模拟控件（仅 POI 显示模拟按钮）
//   - 中部：GridCanvas + GridOverlay（左主区）+ ReverseLookupPanel（右侧栏）
//

import { computed, ref, watch } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useOverlayStore } from '@/stores/overlayStore';
import { useGraphStore } from '@/graph/graph-store';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import { createRng } from '@/shared/algorithms/seed-random';
import {
  ruleFromNode,
  scatterRuleFromNode,
  enemyRuleFromNode,
  tideLabel,
  phaseLabel,
  type DistributionCategory,
  type DistributionPoiData,
  type DistributionScatterData,
  type DistributionEnemyData,
  type DistributionRule,
  type ScatterRule,
  type EnemyRule,
} from '@/schema/distribution-rule';
import type { WorldTileData, WorldRegionData } from '@/graph/assemblers/world-assembler';
import type { ResourceNode } from '@/graph/types';
import type { Pls } from '@/shared';
import GridCanvas from '@/components/grid/GridCanvas.vue';
import GridOverlay from '@/components/grid/GridOverlay.vue';
import ReverseLookupPanel from './ReverseLookupPanel.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseInput from '@/components/common/BaseInput.vue';

const props = defineProps<{
  /** 资源类别——决定激活哪个叠层 flag 与显示哪种规则信息 */
  category: DistributionCategory;
  /** 当前选中的规则 ID（用于显示信息） */
  selectedRuleId: string | null;
}>();

const emit = defineEmits<{
  /** 选中某条规则——父组件同步规则表 / 矩阵视图 */
  select: [ruleId: string | null];
}>();

const project = useProjectStore();
const overlay = useOverlayStore();
const graph = useGraphStore();
const workspace = useDistributionWorkspace();

// ─── GridCanvas 布局常量（与 MapTab.vue 对齐） ────────────
const CELL_WIDTH = 52;
const CELL_HEIGHT = 44;
const HEADER_WIDTH = 38;
const HEADER_HEIGHT = 28;

const hasProject = computed(() => project.hasProject);
const cols = computed(() => project.currentGrid?.cols ?? 0);
const rows = computed(() => project.currentGrid?.rows ?? 0);
const tiles = computed(() => project.currentTiles);

// ─── 分布叠层自动激活 ─────────────────────────────────────
// 切换类别 / 选中规则时，先清空所有分布叠层 flag，再按 category 激活对应 flag。
// 三类分布叠层互斥——同一时刻只激活一个（执行案 §4.5.5 / useOverlayRenderer 注释）。
const categoryToFlag: Record<DistributionCategory, 'poi' | 'wilditem' | 'enemy'> = {
  poi: 'poi',
  scatter: 'wilditem',
  enemy: 'enemy',
};

watch(
  [() => props.category, () => props.selectedRuleId],
  ([cat, ruleId]) => {
    // 先清空所有分布叠层 flag——避免切换类别时残留旧叠层
    overlay.setFlag('poi', false);
    overlay.setFlag('wilditem', false);
    overlay.setFlag('enemy', false);
    // 选中规则时激活对应类别叠层；取消选中时全关
    if (ruleId !== null) {
      overlay.setFlag(categoryToFlag[cat], true);
    }
    // 切换规则时清空模拟结果
    workspace.clearSimulation();
  },
  { immediate: true },
);

// ─── 当前选中规则信息（按类别派生） ───────────────────────
// 三类规则统一展示 ID + tide + 主参数（POI: count / scatter: rate / enemy: count）。
// 类型聚合通过 selectedRuleInfo discriminated union 实现，模板按 category 分支渲染。

interface PoiRuleInfo {
  kind: 'poi';
  rule: DistributionRule;
}
interface ScatterRuleInfo {
  kind: 'scatter';
  rule: ScatterRule;
}
interface EnemyRuleInfo {
  kind: 'enemy';
  rule: EnemyRule;
}
type SelectedRuleInfo = PoiRuleInfo | ScatterRuleInfo | EnemyRuleInfo;

const selectedRuleInfo = computed<SelectedRuleInfo | null>(() => {
  if (props.selectedRuleId === null) return null;
  if (props.category === 'poi') {
    const node = graph.nodes.get(`distribution.poi:${props.selectedRuleId}`);
    if (!node) return null;
    return { kind: 'poi', rule: ruleFromNode(node as ResourceNode<DistributionPoiData>) };
  }
  if (props.category === 'scatter') {
    const node = graph.nodes.get(`distribution.scatter:${props.selectedRuleId}`);
    if (!node) return null;
    return { kind: 'scatter', rule: scatterRuleFromNode(node as ResourceNode<DistributionScatterData>) };
  }
  const node = graph.nodes.get(`distribution.enemy:${props.selectedRuleId}`);
  if (!node) return null;
  return { kind: 'enemy', rule: enemyRuleFromNode(node as ResourceNode<DistributionEnemyData>) };
});

// ─── 反向查询状态 ─────────────────────────────────────────
const clickedPls = ref<Pls | null>(null);

function findPlsFromEvent(event: MouseEvent): Pls | null {
  const target = event.target as HTMLElement | null;
  if (!target) return null;
  const cell = target.closest<HTMLElement>('[data-pls]');
  if (!cell) return null;
  const raw = cell.getAttribute('data-pls');
  if (raw === null) return null;
  const pls = Number(raw);
  if (Number.isNaN(pls)) return null;
  return pls as Pls;
}

function onGridClick(event: MouseEvent): void {
  const pls = findPlsFromEvent(event);
  clickedPls.value = pls;
}

function clearClick(): void {
  clickedPls.value = null;
}

// 反向查询选中规则时同步到父组件
function onReverseSelect(ruleId: string): void {
  emit('select', ruleId);
  workspace.selectRule(ruleId);
}

// ─── 固定 seed 模拟（仅 POI 类别启用） ────────────────────
// 执行案 §4.5.5 审查补丁 C9：O-12 骨架未实现时，scatter / enemy 仅保留"理论分布"显示。
// POI 的模拟逻辑沿用 P3 实现（per_region_count 模式均匀随机选 N 个候选格）。
const seedInput = ref<string>('1');

function randomizeSeed(): void {
  const s = Math.floor(Math.random() * 0xffffffff) >>> 0;
  // 保证正整数（mulberry32 视 0 为随机种子）
  seedInput.value = String(s === 0 ? 1 : s);
}

/**
 * 执行一次固定 seed 模拟——仅 POI 类别启用。
 *
 * 算法（对齐 E-9 obl_init_pois 的均匀随机假设）：
 *   1. 取选中规则的 selector.tides[0]（当前运行时契约每条规则只有一个 tide）
 *   2. 对每个 region 计算候选格集合（passable + tide 匹配 + 排除 entrance/exit）
 *   3. 使用 mulberry32(seed) 从候选格中均匀随机选 placement.count 个（不重复）
 *   4. 把选中的 pls 列表写入 workspace.simulatedPlacements
 *
 * 边界：
 *   - 候选格不足时放置全部（运行时按 E-9 自动调整的兜底逻辑）
 *   - seed=0 视为随机种子（对齐 seed-random.ts §3.7.4）
 */
function simulate(): void {
  if (props.category !== 'poi') return;
  if (props.selectedRuleId === null) return;
  const ruleNode = graph.nodes.get(`distribution.poi:${props.selectedRuleId}`);
  if (!ruleNode) return;
  const data = ruleNode.data as DistributionPoiData;
  const tides = data['selector.tides'];
  if (!Array.isArray(tides) || tides.length === 0) return;
  const tide = tides[0];
  if (typeof tide !== 'string') return;

  const perRegion = typeof data['placement.count'] === 'number' ? data['placement.count']! : 0;
  const excludeEntrance = data['selector.excludeEntrance'] !== false;
  const excludeExit = data['selector.excludeExit'] !== false;
  const regionFilter = data['selector.regions'] ?? [];

  // 收集候选格——按 region 分组
  const tileNodes = graph.findNodesByKind('world.tile');
  const regionNodes = graph.findNodesByKind('world.region');

  const regionEntranceExit = new Map<number, { entrancePls: number | null; exitPls: number | null }>();
  for (const node of regionNodes) {
    const rData = node.data as WorldRegionData;
    if (typeof rData.pgroup !== 'number') continue;
    regionEntranceExit.set(rData.pgroup, {
      entrancePls: rData.entrance_pls ?? null,
      exitPls: rData.exit_pls ?? null,
    });
  }

  const candidatesByRegion = new Map<number, Pls[]>();
  for (const node of tileNodes) {
    const tData = node.data as WorldTileData;
    if (typeof tData.pgroup !== 'number') continue;
    if (typeof tData.pls !== 'number') continue;
    if (tData.tide !== tide) continue;
    if (tData.passable !== true) continue;
    // selector.regions 过滤
    if (regionFilter.length > 0 && !regionFilter.includes(String(tData.pgroup))) continue;

    let excluded = false;
    const regionInfo = regionEntranceExit.get(tData.pgroup);
    if (excludeEntrance && regionInfo && regionInfo.entrancePls === tData.pls) excluded = true;
    if (excludeExit && regionInfo && regionInfo.exitPls === tData.pls) excluded = true;
    if (excluded) continue;

    let arr = candidatesByRegion.get(tData.pgroup);
    if (!arr) {
      arr = [];
      candidatesByRegion.set(tData.pgroup, arr);
    }
    arr.push(tData.pls);
  }

  // 解析 seed
  const seedNum = Number(seedInput.value);
  const effectiveSeed = Number.isFinite(seedNum) && seedNum > 0 ? seedNum : undefined;
  const rng = createRng(effectiveSeed);

  // 对每个 region 选 perRegion 个候选格
  const selectedList: Pls[] = [];
  for (const candidates of candidatesByRegion.values()) {
    // 洗牌后取前 N 个（不重复）
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const picked = shuffled.slice(0, Math.min(perRegion, shuffled.length));
    selectedList.push(...picked);
  }

  // 写入 workspace
  const placementsMap = new Map<string, Pls[]>();
  placementsMap.set(props.selectedRuleId, selectedList);
  workspace.setSimulatedPlacements(placementsMap);
  workspace.setSimulationSeed(rng.seed);
  seedInput.value = String(rng.seed);
}

// ─── 显示辅助 ─────────────────────────────────────────────
/**
 * 敌人 count 显示——int 直接显示，[min,max] 显示为 `min~max`。
 */
function enemyCountLabel(count: number | [number, number]): string {
  if (Array.isArray(count)) return `${count[0]}~${count[1]}`;
  return String(count);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部信息条 + 模拟控件 -->
    <div class="flex flex-wrap items-center gap-2 border-b border-gray-800 p-2 text-xs">
      <div v-if="selectedRuleInfo" class="flex items-center gap-2">
        <span class="text-gray-500">选中规则：</span>
        <span class="text-gray-200">{{ selectedRuleInfo.rule.id }}</span>
        <span class="text-[10px] text-gray-500">
          ({{ tideLabel(selectedRuleInfo.rule.selector.tides[0] ?? '?') }}
          <template v-if="selectedRuleInfo.kind === 'scatter'">
            · {{ phaseLabel(selectedRuleInfo.rule.phase) }}
          </template>
          <template v-if="selectedRuleInfo.kind === 'poi'">
            · 每区域 {{ selectedRuleInfo.rule.placement.count }} 个
          </template>
          <template v-if="selectedRuleInfo.kind === 'enemy'">
            · 每区域 {{ enemyCountLabel(selectedRuleInfo.rule.placement.count) }} 个
          </template>
          <template v-if="selectedRuleInfo.kind === 'scatter'">
            · 基础率 {{ selectedRuleInfo.rule.placement.rate.toFixed(2) }}
          </template>
          )
        </span>
      </div>
      <div v-else class="text-gray-600">
        未选中规则——请从规则表选择一条
        <span v-if="category === 'poi'">distribution.poi</span>
        <span v-else-if="category === 'scatter'">distribution.scatter</span>
        <span v-else>distribution.enemy</span>
      </div>

      <!-- 模拟控件仅 POI 类别显示（执行案 §4.5.5 审查补丁 C9） -->
      <div v-if="category === 'poi'" class="ml-auto flex items-center gap-1">
        <label class="text-[10px] text-gray-500">Seed：</label>
        <BaseInput
          :model-value="seedInput"
          type="number"
          :min="0"
          :step="1"
          class="w-24"
          @update:model-value="(v) => (seedInput = v)"
        />
        <BaseButton size="sm" variant="ghost" title="随机种子" @click="randomizeSeed">🎲</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="selectedRuleInfo === null"
          @click="simulate"
        >
          模拟一次放置
        </BaseButton>
      </div>
      <div v-else class="ml-auto text-[10px] text-gray-600">
        理论分布显示（P4 阶段不提供模拟按钮，P6 镜像校验完整实现后启用）
      </div>
    </div>

    <!-- 主体：左地图 + 右反向查询 -->
    <div class="flex min-h-0 flex-1">
      <!-- 左：地图画布 + 叠层 -->
      <div class="relative min-w-0 flex-1 bg-gray-950" @click="onGridClick">
        <GridCanvas v-if="hasProject" />
        <GridOverlay
          v-if="hasProject"
          :tiles="tiles"
          :cols="cols"
          :rows="rows"
          :cell-width="CELL_WIDTH"
          :cell-height="CELL_HEIGHT"
          :header-width="HEADER_WIDTH"
          :header-height="HEADER_HEIGHT"
        />
        <div
          v-else
          class="flex h-full items-center justify-center text-sm text-gray-500"
        >
          尚无项目数据——请先在 WorldView 创建地图项目
        </div>
      </div>

      <!-- 右：反向查询面板 -->
      <aside class="w-64 shrink-0 overflow-auto border-l border-gray-800 bg-gray-900">
        <ReverseLookupPanel
          :clicked-pls="clickedPls"
          @select="onReverseSelect"
        />
        <div v-if="clickedPls !== null" class="border-t border-gray-800 p-2">
          <BaseButton size="sm" variant="ghost" class="w-full" @click="clearClick">
            清除选中
          </BaseButton>
        </div>
      </aside>
    </div>
  </div>
</template>
