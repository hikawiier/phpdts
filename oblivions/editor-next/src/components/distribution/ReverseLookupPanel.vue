<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ReverseLookupPanel：反向查询面板（执行案 §4.5.5 / §4.5.6）
//
// 设计意图：
//   - 接收"用户点击了哪个地图格"事件，反查"该格可能生成哪些 X"
//   - P4 扩展：同时查询三类规则——POI / 野生道具 / 敌人
//     · POI：cell.tide → distribution.poi where selector.tides 包含该 tide
//       → 候选 POI 列表（per_region_count 模式：理论概率 = per_region / 候选格数）
//     · scatter：cell.tide → distribution.scatter where selector.tides 包含该 tide
//       → 候选道具列表（per_tile_probability 模式：理论概率 = effective_rate）
//     · enemy：cell.tide → distribution.enemy where selector.tides 包含该 tide
//       → 候选敌人列表（per_region_count 模式：理论概率 = count / 候选格数）
//   - 结果分三段展示：POI 候选 / 野生道具候选 / 敌人候选
//   - 反向查询不切换叠层，仅在侧边面板展示结果；点击规则时 emit('select') 同步选中态
//
// 理论概率：
//   - POI / enemy（per_region_count 模式）：placement.count / 候选格总数
//   - scatter（per_tile_probability 模式）：effective_rate（initial=rate；refresh=rate×倍率）
//
// 数据源：
//   - props.clickedPls：用户点击的地图格 pls（null=未点击）
//   - graph-store: distribution.poi / distribution.scatter / distribution.enemy /
//     world.tile / world.region / poi.template / item.template / enemy.template
//   - configStore: obl_config.wild_item_refresh_rate_by_tide（scatter refresh 倍率）
//

import { computed } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { useConfigStore } from '@/stores/configStore';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import {
  tideLabel,
  type DistributionPoiData,
  type DistributionScatterData,
  type DistributionEnemyData,
} from '@/schema/distribution-rule';
import type { WorldTileData, WorldRegionData } from '@/graph/assemblers/world-assembler';
import type { Pls } from '@/shared';

const props = defineProps<{
  /** 用户点击的地图格 pls；null=未点击 */
  clickedPls: Pls | null;
}>();

const emit = defineEmits<{
  /** 选中某条规则——父组件同步规则表 / 矩阵 / 叠层 */
  select: [ruleId: string];
}>();

const graph = useGraphStore();
const config = useConfigStore();
const workspace = useDistributionWorkspace();

// ─── 点击格的 tile 信息 ───────────────────────────────────
interface ClickedTileInfo {
  pls: Pls;
  pgroup: number;
  tide: string;
  passable: boolean;
  isEntrance: boolean;
  isExit: boolean;
}

const clickedTileInfo = computed<ClickedTileInfo | null>(() => {
  if (props.clickedPls === null) return null;
  const tileNodes = graph.findNodesByKind('world.tile');
  let tileData: WorldTileData | null = null;
  for (const node of tileNodes) {
    const data = node.data as WorldTileData;
    if (data.pls === props.clickedPls) {
      tileData = data;
      break;
    }
  }
  if (!tileData) return null;
  if (typeof tileData.pgroup !== 'number' || typeof tileData.tide !== 'string') return null;

  // 查 region 的 entrance/exit
  const regionNodes = graph.findNodesByKind('world.region');
  let entrancePls: number | null = null;
  let exitPls: number | null = null;
  for (const node of regionNodes) {
    const data = node.data as WorldRegionData;
    if (data.pgroup === tileData.pgroup) {
      entrancePls = data.entrance_pls ?? null;
      exitPls = data.exit_pls ?? null;
      break;
    }
  }

  return {
    pls: props.clickedPls,
    pgroup: tileData.pgroup,
    tide: tileData.tide,
    passable: tileData.passable === true,
    isEntrance: entrancePls === props.clickedPls,
    isExit: exitPls === props.clickedPls,
  };
});

// ─── wild_item_refresh_rate_by_tide 倍率表 ──────────────────
const refreshRateByTide = computed<Record<string, number>>(() => {
  const cfg = config.oblConfig as Record<string, unknown> | null;
  if (!cfg) return { shallow: 1, deep: 1, abyss: 1 };
  const raw = cfg['wild_item_refresh_rate_by_tide'];
  if (!raw || typeof raw !== 'object') return { shallow: 1, deep: 1, abyss: 1 };
  const result: Record<string, number> = { shallow: 1, deep: 1, abyss: 1 };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number') result[k] = v;
  }
  return result;
});

// ─── 候选格索引（按 tide × pgroup） ────────────────────────
// 复用分布校验与叠层的候选格计算逻辑：
//   - POI / enemy：passable + tide 匹配 + 可选排除 entrance/exit
//   - scatter：passable + tide 匹配（不应用 entrance/exit 排除，运行时不查）
// candidateCountForCategory 分别按规则类别返回候选格总数。

interface CandidateIndex {
  /** (tide, pgroup) → passable pls 集合（不含 entrance/exit 排除） */
  passableByTideRegion: Map<string, Map<number, Set<number>>>;
  /** pgroup → { entrancePls, exitPls } */
  regionEntranceExit: Map<number, { entrancePls: number | null; exitPls: number | null }>;
}

const candidateIndex = computed<CandidateIndex>(() => {
  const passableByTideRegion = new Map<string, Map<number, Set<number>>>();
  const tileNodes = graph.findNodesByKind('world.tile');
  for (const node of tileNodes) {
    const data = node.data as WorldTileData;
    if (typeof data.pgroup !== 'number') continue;
    if (typeof data.tide !== 'string') continue;
    if (typeof data.pls !== 'number') continue;
    if (data.passable !== true) continue;
    let regionMap = passableByTideRegion.get(data.tide);
    if (!regionMap) {
      regionMap = new Map();
      passableByTideRegion.set(data.tide, regionMap);
    }
    let plsSet = regionMap.get(data.pgroup);
    if (!plsSet) {
      plsSet = new Set();
      regionMap.set(data.pgroup, plsSet);
    }
    plsSet.add(data.pls);
  }

  const regionEntranceExit = new Map<number, { entrancePls: number | null; exitPls: number | null }>();
  const regionNodes = graph.findNodesByKind('world.region');
  for (const node of regionNodes) {
    const data = node.data as WorldRegionData;
    if (typeof data.pgroup !== 'number') continue;
    regionEntranceExit.set(data.pgroup, {
      entrancePls: data.entrance_pls ?? null,
      exitPls: data.exit_pls ?? null,
    });
  }

  return { passableByTideRegion, regionEntranceExit };
});

/**
 * 计算指定 tide × pgroup 下指定类别的候选格总数。
 *
 * - POI / enemy：passable + tide + 排除 entrance/exit（默认 excludeEntrance=true）
 * - scatter：passable + tide（不排除 entrance/exit）
 */
function candidateCountForCategory(
  category: 'poi' | 'scatter' | 'enemy',
  tide: string,
  pgroup: number,
  excludeEntrance: boolean,
  excludeExit: boolean,
): number {
  const idx = candidateIndex.value;
  const plsSet = idx.passableByTideRegion.get(tide)?.get(pgroup);
  if (!plsSet) return 0;
  let count = plsSet.size;
  if (category !== 'scatter') {
    const regionInfo = idx.regionEntranceExit.get(pgroup);
    if (regionInfo) {
      if (excludeEntrance && regionInfo.entrancePls !== null && plsSet.has(regionInfo.entrancePls)) count -= 1;
      if (excludeExit && regionInfo.exitPls !== null && plsSet.has(regionInfo.exitPls)) count -= 1;
    }
  }
  return Math.max(0, count);
}

// ─── 候选规则（三类共用一个候选接口） ─────────────────────
interface CandidateRule {
  /** 类别——POI / scatter / enemy */
  category: 'poi' | 'scatter' | 'enemy';
  /** 规则节点 ID（不带 kind 前缀） */
  ruleId: string;
  /** 主体资源 ID（poiId / itemId / enemyType） */
  resourceId: string;
  /** 主体资源中文名（fallback 到 ID） */
  resourceName: string;
  /** 主参数显示（POI: count / scatter: rate / enemy: count） */
  mainParamLabel: string;
  /** 理论概率（0-1） */
  probability: number;
  /** 排除原因（如果该格不在候选集内） */
  exclusionReason: string | null;
}

const candidates = computed<CandidateRule[]>(() => {
  const info = clickedTileInfo.value;
  if (!info) return [];

  // 资源名缓存
  const poiNameById = new Map<string, string>();
  for (const node of graph.findNodesByKind('poi.template')) {
    const data = node.data as { name?: string } | null;
    const name = data?.name;
    poiNameById.set(node.id, typeof name === 'string' && name.length > 0 ? name : node.id);
  }
  const itemNameById = new Map<string, string>();
  for (const node of graph.findNodesByKind('item.template')) {
    const data = node.data as { name?: string } | null;
    const name = data?.name;
    itemNameById.set(node.id, typeof name === 'string' && name.length > 0 ? name : node.id);
  }
  const enemyNameById = new Map<string, string>();
  for (const node of graph.findNodesByKind('enemy.template')) {
    const data = node.data as { name?: string } | null;
    const name = data?.name;
    enemyNameById.set(node.id, typeof name === 'string' && name.length > 0 ? name : node.id);
  }

  const result: CandidateRule[] = [];

  // ─── POI 候选 ─────────────────────────────────────────
  for (const node of graph.findNodesByKind('distribution.poi')) {
    const data = node.data as DistributionPoiData | null;
    if (!data || typeof data !== 'object') continue;
    const tides = data['selector.tides'];
    if (!Array.isArray(tides) || tides.length === 0) continue;
    const ruleTide = tides[0];
    if (typeof ruleTide !== 'string' || ruleTide !== info.tide) continue;

    const poiId = data['subject.poi_id'];
    if (typeof poiId !== 'string') continue;
    const perRegion = typeof data['placement.count'] === 'number' ? data['placement.count']! : 0;
    const excludeEntrance = data['selector.excludeEntrance'] !== false;
    const excludeExit = data['selector.excludeExit'] !== false;

    const candidateCount = candidateCountForCategory('poi', ruleTide, info.pgroup, excludeEntrance, excludeExit);

    let exclusionReason: string | null = null;
    if (!info.passable) {
      exclusionReason = '该格不可通行';
    } else if (excludeEntrance && info.isEntrance) {
      exclusionReason = '该格是区域入口（被 excludeEntrance 排除）';
    } else if (excludeExit && info.isExit) {
      exclusionReason = '该格是区域出口（被 excludeExit 排除）';
    }

    const probability = candidateCount > 0 ? perRegion / candidateCount : 0;
    result.push({
      category: 'poi',
      ruleId: node.id,
      resourceId: poiId,
      resourceName: poiNameById.get(poiId) ?? poiId,
      mainParamLabel: `每区域 ${perRegion} 个`,
      probability,
      exclusionReason,
    });
  }

  // ─── scatter 候选 ──────────────────────────────────────
  for (const node of graph.findNodesByKind('distribution.scatter')) {
    const data = node.data as DistributionScatterData | null;
    if (!data || typeof data !== 'object') continue;
    const tides = data['selector.tides'];
    if (!Array.isArray(tides) || tides.length === 0) continue;
    const ruleTide = tides[0];
    if (typeof ruleTide !== 'string' || ruleTide !== info.tide) continue;

    const itemId = data['subject.item_id'];
    if (typeof itemId !== 'string') continue;
    const phase = data['phase'];
    if (phase !== 'game_init' && phase !== 'day_refresh') continue;
    const rate = typeof data['placement.rate'] === 'number' ? data['placement.rate']! : 0;

    // effective_rate：refresh 相位 = rate × tide 倍率；initial 相位 = rate
    const multiplier = phase === 'day_refresh' ? (refreshRateByTide.value[ruleTide] ?? 1) : 1;
    const effectiveRate = rate * multiplier;

    // scatter 不应用 entrance/exit 排除（运行时不查）
    let exclusionReason: string | null = null;
    if (!info.passable) {
      exclusionReason = '该格不可通行';
    }

    // 概率显示：effective_rate（per_tile_probability 模式——每格独立判定）
    const probability = Math.min(1, Math.max(0, effectiveRate));
    const phaseTag = phase === 'day_refresh' ? '刷新' : '初始';
    const rateLabel = phase === 'day_refresh'
      ? `基础率 ${rate.toFixed(2)} × 倍率 ${multiplier} = ${effectiveRate.toFixed(2)}（${phaseTag}）`
      : `基础率 ${rate.toFixed(2)}（${phaseTag}）`;

    result.push({
      category: 'scatter',
      ruleId: node.id,
      resourceId: itemId,
      resourceName: itemNameById.get(itemId) ?? itemId,
      mainParamLabel: rateLabel,
      probability,
      exclusionReason,
    });
  }

  // ─── enemy 候选 ────────────────────────────────────────
  for (const node of graph.findNodesByKind('distribution.enemy')) {
    const data = node.data as DistributionEnemyData | null;
    if (!data || typeof data !== 'object') continue;
    const tides = data['selector.tides'];
    if (!Array.isArray(tides) || tides.length === 0) continue;
    const ruleTide = tides[0];
    if (typeof ruleTide !== 'string' || ruleTide !== info.tide) continue;

    const enemyType = data['subject.enemy_type'];
    if (typeof enemyType !== 'string') continue;
    const rawCount = data['placement.count'] ?? 1;
    const count = rawCount;
    const excludeEntrance = data['selector.excludeEntrance'] !== false;
    const excludeExit = data['selector.excludeExit'] !== false;
    // excludeOccupied 在 P4 是静态派生（假设无占用），不影响候选格计算

    const candidateCount = candidateCountForCategory('enemy', ruleTide, info.pgroup, excludeEntrance, excludeExit);

    let exclusionReason: string | null = null;
    if (!info.passable) {
      exclusionReason = '该格不可通行';
    } else if (excludeEntrance && info.isEntrance) {
      exclusionReason = '该格是区域入口（被 excludeEntrance 排除）';
    } else if (excludeExit && info.isExit) {
      exclusionReason = '该格是区域出口（被 excludeExit 排除）';
    }

    // count 多态：int 直接用作概率分子；[min,max] 取 max 作上界概率
    const countForProb = Array.isArray(count) ? count[1] : count;
    const probability = candidateCount > 0 ? countForProb / candidateCount : 0;
    const countLabel = Array.isArray(count) ? `${count[0]}~${count[1]} 个` : `${count} 个`;

    result.push({
      category: 'enemy',
      ruleId: node.id,
      resourceId: enemyType,
      resourceName: enemyNameById.get(enemyType) ?? enemyType,
      mainParamLabel: `每区域 ${countLabel}`,
      probability,
      exclusionReason,
    });
  }

  // 排序：未排除的在前，按类别顺序（poi → scatter → enemy），同类别按概率降序
  const categoryOrder: Record<'poi' | 'scatter' | 'enemy', number> = { poi: 0, scatter: 1, enemy: 2 };
  result.sort((a, b) => {
    if (a.exclusionReason === null && b.exclusionReason !== null) return -1;
    if (a.exclusionReason !== null && b.exclusionReason === null) return 1;
    if (a.category !== b.category) return categoryOrder[a.category] - categoryOrder[b.category];
    return b.probability - a.probability;
  });
  return result;
});

// ─── 按类别分组的候选列表（模板渲染用） ───────────────────
const poiCandidates = computed(() => candidates.value.filter((c) => c.category === 'poi'));
const scatterCandidates = computed(() => candidates.value.filter((c) => c.category === 'scatter'));
const enemyCandidates = computed(() => candidates.value.filter((c) => c.category === 'enemy'));

function onSelectRule(ruleId: string): void {
  emit('select', ruleId);
  workspace.selectRule(ruleId);
}
</script>

<template>
  <div class="flex h-full flex-col overflow-auto p-2 text-sm">
    <div class="mb-2 border-b border-gray-800 pb-1">
      <div class="text-xs text-gray-300">反向查询</div>
      <div v-if="clickedTileInfo" class="mt-1 text-[10px] text-gray-500">
        点击格 #{{ clickedTileInfo.pls }} · 区域 {{ clickedTileInfo.pgroup }} ·
        潮汐 {{ tideLabel(clickedTileInfo.tide) }}
        <span v-if="!clickedTileInfo.passable" class="text-accent-error"> · 不可通行</span>
        <span v-else-if="clickedTileInfo.isEntrance" class="text-gray-400"> · 入口</span>
        <span v-else-if="clickedTileInfo.isExit" class="text-gray-400"> · 出口</span>
      </div>
    </div>

    <div v-if="!clickedTileInfo" class="flex flex-1 items-center justify-center text-xs text-gray-600">
      点击地图格反查"该格可能生成哪些资源"
    </div>

    <div
      v-else-if="poiCandidates.length === 0 && scatterCandidates.length === 0 && enemyCandidates.length === 0"
      class="flex flex-1 items-center justify-center text-xs text-gray-600"
    >
      该格所在潮汐（{{ tideLabel(clickedTileInfo.tide) }}）下无分布规则
    </div>

    <div v-else class="flex flex-col gap-2">
      <!-- POI 候选段 -->
      <div v-if="poiCandidates.length > 0" class="flex flex-col gap-1">
        <div class="border-b border-gray-800 pb-0.5 text-[10px] text-gray-400">
          POI 候选（{{ poiCandidates.length }}）
        </div>
        <div
          v-for="c in poiCandidates"
          :key="c.ruleId"
          class="cursor-pointer rounded border bg-gray-900 p-2 transition-colors hover:border-gray-500"
          :class="c.ruleId === workspace.selectedRuleId.value ? 'border-gray-500' : 'border-gray-800'"
          @click="onSelectRule(c.ruleId)"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="truncate text-xs text-gray-200">{{ c.resourceName }}</span>
            <span class="text-[10px] text-gray-500">{{ c.resourceId }}</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-[10px] text-gray-500">
            <span>{{ c.mainParamLabel }}</span>
            <span :class="c.exclusionReason ? 'text-gray-600' : 'text-gray-300'">
              概率 {{ (c.probability * 100).toFixed(1) }}%
            </span>
          </div>
          <div v-if="c.exclusionReason" class="mt-1 text-[10px] text-gray-600">
            ⚠ {{ c.exclusionReason }}
          </div>
        </div>
      </div>

      <!-- 野生道具候选段 -->
      <div v-if="scatterCandidates.length > 0" class="flex flex-col gap-1">
        <div class="border-b border-gray-800 pb-0.5 text-[10px] text-gray-400">
          野生道具候选（{{ scatterCandidates.length }}）
        </div>
        <div
          v-for="c in scatterCandidates"
          :key="c.ruleId"
          class="cursor-pointer rounded border bg-gray-900 p-2 transition-colors hover:border-gray-500"
          :class="c.ruleId === workspace.selectedRuleId.value ? 'border-gray-500' : 'border-gray-800'"
          @click="onSelectRule(c.ruleId)"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="truncate text-xs text-gray-200">{{ c.resourceName }}</span>
            <span class="text-[10px] text-gray-500">{{ c.resourceId }}</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-[10px] text-gray-500">
            <span class="truncate">{{ c.mainParamLabel }}</span>
            <span :class="c.exclusionReason ? 'text-gray-600' : 'text-gray-300'">
              概率 {{ (c.probability * 100).toFixed(1) }}%
            </span>
          </div>
          <div v-if="c.exclusionReason" class="mt-1 text-[10px] text-gray-600">
            ⚠ {{ c.exclusionReason }}
          </div>
        </div>
      </div>

      <!-- 敌人候选段 -->
      <div v-if="enemyCandidates.length > 0" class="flex flex-col gap-1">
        <div class="border-b border-gray-800 pb-0.5 text-[10px] text-gray-400">
          敌人候选（{{ enemyCandidates.length }}）
        </div>
        <div
          v-for="c in enemyCandidates"
          :key="c.ruleId"
          class="cursor-pointer rounded border bg-gray-900 p-2 transition-colors hover:border-gray-500"
          :class="c.ruleId === workspace.selectedRuleId.value ? 'border-gray-500' : 'border-gray-800'"
          @click="onSelectRule(c.ruleId)"
        >
          <div class="flex items-center justify-between gap-1">
            <span class="truncate text-xs text-gray-200">{{ c.resourceName }}</span>
            <span class="text-[10px] text-gray-500">{{ c.resourceId }}</span>
          </div>
          <div class="mt-1 flex items-center justify-between text-[10px] text-gray-500">
            <span>{{ c.mainParamLabel }}</span>
            <span :class="c.exclusionReason ? 'text-gray-600' : 'text-gray-300'">
              概率 {{ (c.probability * 100).toFixed(1) }}%
            </span>
          </div>
          <div v-if="c.exclusionReason" class="mt-1 text-[10px] text-gray-600">
            ⚠ {{ c.exclusionReason }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
