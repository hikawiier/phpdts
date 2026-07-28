<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// OverlayEnemyDistribution：敌人分布叠层（执行案 §4.5.5 / DESIGN.md 2.15 灰阶）
//
// 设计意图：
//   - 在地图画布上灰阶渲染当前选中 distribution.enemy 规则的候选格 / 排除格 / 放置数量
//   - 不依赖玩家位置——distribution 是开局静态生成，与玩家位置无关
//   - 渲染规则（对齐 OverlayPoiDistribution 灰阶模式 + 执行案 §4.5.5）：
//     - 候选格（selector.tides 命中且 passable）：浅灰 fill-opacity 0.4
//     - 排除格——tide 不匹配：不渲染（透明）
//     - 排除格——不可通行：中灰 fill-opacity 0.2 + 斜线纹理
//     - 排除格——入口/出口：深灰 fill-opacity 0.3 + "E"/"X" 标记
//     - 选中格高亮：边框 accent-error
//     - P4 阶段不渲染"已占用"排除格（审查补丁 C4：假设无占用，"已占用"渲染
//       分支为死代码；P6 镜像校验引入动态占用后再增加该渲染分支）
//   - 放置数量显示：候选格内显示 placement.count 或 [min,max] 范围
//
// 数据源：
//   - useDistributionWorkspace().selectedRuleId：当前选中的规则
//   - graph-store: distribution.enemy 节点（读 selector / placement）、world.tile、world.region
//   - useDistributionWorkspace().simulatedPlacements：固定 seed 模拟结果（可选）
//
// 性能（执行案 §4.8.2）：当前规模 2 区域 × 86 tile，单次计算 < 1ms，无需 RAF 分片。

import { computed } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import { enemyRuleFromNode, type DistributionEnemyData } from '@/schema/distribution-rule';
import type { ResourceNode } from '@/graph/types';
import type { WorldTileData, WorldRegionData } from '@/graph/assemblers/world-assembler';
import type { Pls, Tile } from '@/shared';

const props = defineProps<{
  tiles: Record<Pls, Tile>;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  headerWidth: number;
  headerHeight: number;
}>();

const graph = useGraphStore();
const workspace = useDistributionWorkspace();

// ─── 当前选中规则的节点（仅 enemy 类别） ──────────────────
const selectedRuleNode = computed<ResourceNode<DistributionEnemyData> | null>(() => {
  const ruleId = workspace.selectedRuleId.value;
  if (ruleId === null) return null;
  // 仅处理 enemy 类别——id 形如 `shallow:1`，含 1 个 `:` 且第二段是数字
  const colonCount = (ruleId.match(/:/g) ?? []).length;
  if (colonCount !== 1) return null;
  const idx = ruleId.indexOf(':');
  const second = ruleId.slice(idx + 1);
  if (!/^[1-9]\d*$/.test(second)) return null;
  const node = graph.nodes.get(`distribution.enemy:${ruleId}`);
  if (!node) return null;
  return node as ResourceNode<DistributionEnemyData>;
});

const selectedRule = computed(() => {
  const node = selectedRuleNode.value;
  if (!node) return null;
  return enemyRuleFromNode(node);
});

// ─── 区域 entrance/exit 索引 ─────────────────────────────
const regionEntranceExit = computed<Map<number, { entrancePls: number | null; exitPls: number | null }>>(() => {
  const map = new Map<number, { entrancePls: number | null; exitPls: number | null }>();
  const regionNodes = graph.findNodesByKind('world.region');
  for (const node of regionNodes) {
    const data = node.data as WorldRegionData;
    if (typeof data.pgroup !== 'number') continue;
    map.set(data.pgroup, {
      entrancePls: data.entrance_pls ?? null,
      exitPls: data.exit_pls ?? null,
    });
  }
  return map;
});

// ─── pls → pgroup 缓存 ──────────────────────────────────
const plsToPgroup = computed<Map<Pls, number>>(() => {
  const map = new Map<Pls, number>();
  const tileNodes = graph.findNodesByKind('world.tile');
  for (const node of tileNodes) {
    const data = node.data as WorldTileData;
    if (typeof data.pls === 'number' && typeof data.pgroup === 'number') {
      map.set(data.pls, data.pgroup);
    }
  }
  return map;
});

function findTilePgroup(pls: Pls): number | null {
  return plsToPgroup.value.get(pls) ?? null;
}

// ─── 候选格计算 ─────────────────────────────────────────
type CellKind = 'candidate' | 'excluded-impassable' | 'excluded-entrance' | 'excluded-exit' | 'excluded-tide';

interface EnemyCell {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
  readonly kind: CellKind;
}

/**
 * placement.count 显示文本——int 直接显示，[min,max] 显示为 `min~max`。
 */
function countLabel(count: number | [number, number]): string {
  if (Array.isArray(count)) {
    return `${count[0]}~${count[1]}`;
  }
  return String(count);
}

const cells = computed<EnemyCell[]>(() => {
  const rule = selectedRule.value;
  if (!rule) return [];

  const tide = rule.selector.tides[0];
  if (!tide) return [];

  const excludeEntrance = rule.selector.excludeEntrance;
  const excludeExit = rule.selector.excludeExit;
  const regionFilter = rule.selector.regions;

  const result: EnemyCell[] = [];
  for (const plsStr of Object.keys(props.tiles)) {
    const pls = Number(plsStr) as Pls;
    const tile = props.tiles[pls];
    if (!tile) continue;

    const pgroup = findTilePgroup(pls);
    if (pgroup === null) continue;

    // selector.regions 过滤
    if (regionFilter.length > 0 && !regionFilter.includes(String(pgroup))) continue;

    // tide 不匹配 → 不渲染（透明）
    if (tile.tide !== tide) continue;

    // 不可通行
    if (!tile.passable) {
      result.push({ pls, x: tile.x, y: tile.y, kind: 'excluded-impassable' });
      continue;
    }

    // 入口/出口排除
    const region = regionEntranceExit.value.get(pgroup);
    if (excludeEntrance && region && region.entrancePls === pls) {
      result.push({ pls, x: tile.x, y: tile.y, kind: 'excluded-entrance' });
      continue;
    }
    if (excludeExit && region && region.exitPls === pls) {
      result.push({ pls, x: tile.x, y: tile.y, kind: 'excluded-exit' });
      continue;
    }

    // 候选格（P4 阶段不应用 excludeOccupied——审查补丁 C4）
    result.push({ pls, x: tile.x, y: tile.y, kind: 'candidate' });
  }
  return result;
});

// ─── 候选格内显示文本 ─────────────────────────────────────
/**
 * per_region_count 模式：候选格内显示 placement.count 或 [min,max] 范围。
 *
 * hover tooltip 由父组件 DistributionOverlayPanel 顶部信息条显示
 * "该格被选中概率 = count / 候选格总数"——本组件仅渲染数量文本。
 */
const countText = computed<string>(() => {
  const rule = selectedRule.value;
  if (!rule) return '';
  return countLabel(rule.placement.count);
});

// ─── 模拟命中格集合 ───────────────────────────────────────
const simulatedPlsSet = computed<Set<Pls>>(() => {
  const set = new Set<Pls>();
  const ruleId = workspace.selectedRuleId.value;
  if (ruleId === null) return set;
  const placements = workspace.simulatedPlacements.value;
  if (!placements) return set;
  const list = placements.get(ruleId);
  if (!list) return set;
  for (const pls of list) set.add(pls);
  return set;
});

// ─── SVG 坐标计算 ─────────────────────────────────────────
const svgWidth = computed(() => props.headerWidth + props.cols * props.cellWidth);
const svgHeight = computed(() => props.headerHeight + props.rows * props.cellHeight);

function rectX(x: number): number {
  return props.headerWidth + x * props.cellWidth;
}
function rectY(y: number): number {
  return props.headerHeight + y * props.cellHeight;
}

// ─── 单元格样式 ───────────────────────────────────────────
function cellClass(kind: CellKind): string {
  switch (kind) {
    case 'candidate':
      return 'enemy-cell-candidate';
    case 'excluded-impassable':
      return 'enemy-cell-excluded-impassable';
    case 'excluded-entrance':
    case 'excluded-exit':
      return 'enemy-cell-excluded-entrance-exit';
    case 'excluded-tide':
    default:
      return 'enemy-cell-hidden';
  }
}

function exclusionLabel(kind: CellKind): string {
  if (kind === 'excluded-entrance') return 'E';
  if (kind === 'excluded-exit') return 'X';
  return '';
}

function isSimulated(pls: Pls): boolean {
  return simulatedPlsSet.value.has(pls);
}
</script>

<template>
  <svg
    class="overlay-enemy-distribution-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <!-- 候选格与排除格矩形 -->
    <rect
      v-for="cell in cells"
      :key="`enemy-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      :class="[cellClass(cell.kind), isSimulated(cell.pls) ? 'enemy-cell-simulated' : '']"
      :data-pls="cell.pls"
      :data-cell-kind="cell.kind"
    />
    <!-- 排除标记（E/X） -->
    <text
      v-for="cell in cells.filter((c) => c.kind === 'excluded-entrance' || c.kind === 'excluded-exit')"
      :key="`enemy-label-${cell.pls}`"
      :x="rectX(cell.x) + cellWidth / 2"
      :y="rectY(cell.y) + cellHeight / 2 + 4"
      text-anchor="middle"
      class="enemy-exclusion-label"
    >{{ exclusionLabel(cell.kind) }}</text>
    <!-- 候选格放置数量数字 -->
    <text
      v-for="cell in cells.filter((c) => c.kind === 'candidate')"
      :key="`enemy-prob-${cell.pls}`"
      :x="rectX(cell.x) + cellWidth / 2"
      :y="rectY(cell.y) + cellHeight / 2 + 3"
      text-anchor="middle"
      class="enemy-probability-label"
    >{{ countText }}</text>
  </svg>
</template>

<style scoped>
/* 候选格：浅灰 fill-opacity 0.4（对齐执行案 §4.5.5） */
.enemy-cell-candidate {
  fill: #cccccc;
  fill-opacity: 0.4;
  stroke: none;
  pointer-events: none;
}

/* 排除格——不可通行：中灰 fill-opacity 0.2 + 斜线纹理 */
.enemy-cell-excluded-impassable {
  fill: #888888;
  fill-opacity: 0.2;
  stroke: #555555;
  stroke-width: 0.5;
  stroke-dasharray: 2 2;
  pointer-events: none;
}

/* 排除格——入口/出口：深灰 fill-opacity 0.3 */
.enemy-cell-excluded-entrance-exit {
  fill: #444444;
  fill-opacity: 0.3;
  stroke: none;
  pointer-events: none;
}

/* 隐藏（tide 不匹配的格不渲染） */
.enemy-cell-hidden {
  fill: none;
  stroke: none;
  pointer-events: none;
}

/* 模拟命中格：accent-error 边框高亮 */
.enemy-cell-simulated {
  stroke: var(--color-accent-error, #ef4444);
  stroke-width: 2;
  stroke-opacity: 0.9;
}

/* 排除标记文本（E/X） */
.enemy-exclusion-label {
  fill: #cccccc;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  user-select: none;
}

/* 放置数量数字 */
.enemy-probability-label {
  fill: #dddddd;
  font-size: 9px;
  font-weight: 500;
  pointer-events: none;
  user-select: none;
}
</style>
