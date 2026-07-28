<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// OverlayPoiDistribution：POI 分布叠层（执行案 §4.5.4 / DESIGN.md 2.15 灰阶）
//
// 设计意图：
//   - 在地图画布上灰阶渲染当前选中 distribution.poi 规则的候选格 / 排除格 / 理论概率
//   - 不依赖玩家位置——distribution 是开局静态生成，与玩家位置无关
//   - 渲染规则（对齐 OverlayTideHeatmap 灰阶模式 + 执行案 §4.5.4）：
//     - 候选格（selector 命中）：浅灰 fill-opacity 0.4
//     - 排除格——tide 不匹配：不渲染（透明）
//     - 排除格——不可通行：中灰 fill-opacity 0.2 + 斜线纹理
//     - 排除格——入口/出口：深灰 fill-opacity 0.3 + "E"/"X" 标记
//     - 模拟命中格（固定 seed 模拟被选中）：accent-error 边框高亮
//   - 理论概率显示：候选格内显示 `1/N` 数字，N=候选格总数
//
// 数据源：
//   - useDistributionWorkspace().selectedRuleId：当前选中的规则
//   - graph-store: distribution.poi 节点（读 selector / placement）、world.tile、world.region
//   - useDistributionWorkspace().simulatedPlacements：固定 seed 模拟结果（可选）
//
// 性能（执行案 §4.8.2）：当前规模 2 区域 × 86 tile，单次计算 < 1ms，无需 RAF 分片。

import { computed } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import { ruleFromNode, type DistributionPoiData } from '@/schema/distribution-rule';
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

// ─── 当前选中规则的节点 ──────────────────────────────────
const selectedRuleNode = computed<ResourceNode<DistributionPoiData> | null>(() => {
  const ruleId = workspace.selectedRuleId.value;
  if (ruleId === null) return null;
  const node = graph.nodes.get(`distribution.poi:${ruleId}`);
  if (!node) return null;
  return node as ResourceNode<DistributionPoiData>;
});

const selectedRule = computed(() => {
  const node = selectedRuleNode.value;
  if (!node) return null;
  return ruleFromNode(node);
});

// ─── 区域 entrance/exit 索引 ─────────────────────────────
/**
 * 当前 pgroup 的 entrance_pls / exit_pls 集合（用于排除标记）。
 *
 * 注：分布规则是跨区域的（per_region 在每个 region 都生成 N 个），所以需要
 * 所有 region 的 entrance/exit 信息。这里构建 pgroup → {entrancePls, exitPls} 映射。
 */
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

// ─── 候选格计算 ─────────────────────────────────────────
type CellKind = 'candidate' | 'excluded-impassable' | 'excluded-entrance' | 'excluded-exit' | 'excluded-tide';

interface PoiCell {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
  readonly pgroup: number;
  readonly kind: CellKind;
}

/**
 * 计算选中规则在每个 tile 上的状态——candidate / excluded-* 之一。
 *
 * 逻辑（对齐 distribution-validator.ts 候选格定义）：
 *   - tile.tide ∈ selector.tides ∧ passable=true ∧
 *     (excludeEntrance ⇒ tile.pls ≠ region.entrance_pls) ∧
 *     (excludeExit ⇒ tile.pls ≠ region.exit_pls) → candidate
 *   - tide 不匹配 → excluded-tide（不渲染）
 *   - tide 匹配但 passable=false → excluded-impassable
 *   - tide 匹配 + passable + entrance/exit 命中排除 → excluded-entrance/exit
 *
 * 只渲染当前选中规则 selector.tides[0]（当前运行时契约每条规则只有一个 tide）。
 * selector.regions 留空=所有区域。
 */
const cells = computed<PoiCell[]>(() => {
  const rule = selectedRule.value;
  if (!rule) return [];

  const tide = rule.selector.tides[0];
  if (!tide) return [];

  const excludeEntrance = rule.selector.excludeEntrance;
  const excludeExit = rule.selector.excludeExit;
  const regionFilter = rule.selector.regions;

  const result: PoiCell[] = [];
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
      result.push({ pls, x: tile.x, y: tile.y, pgroup, kind: 'excluded-impassable' });
      continue;
    }

    // 入口/出口排除
    const region = regionEntranceExit.value.get(pgroup);
    if (excludeEntrance && region && region.entrancePls === pls) {
      result.push({ pls, x: tile.x, y: tile.y, pgroup, kind: 'excluded-entrance' });
      continue;
    }
    if (excludeExit && region && region.exitPls === pls) {
      result.push({ pls, x: tile.x, y: tile.y, pgroup, kind: 'excluded-exit' });
      continue;
    }

    // 候选格
    result.push({ pls, x: tile.x, y: tile.y, pgroup, kind: 'candidate' });
  }
  return result;
});

/**
 * 由 pls 反查 pgroup——遍历 graph 中所有 world.tile 节点。
 *
 * 注：props.tiles 是 currentRegion 的 tiles，不含 pgroup 信息；
 * 这里从 graph-store 查询该 pls 对应的 world.tile 节点的 data.pgroup。
 *
 * 性能：86 格 × O(n) 查询，构建 Map<pls, pgroup> 缓存，每次重算 < 1ms。
 */
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

// ─── 候选格总数与理论概率 ─────────────────────────────────
const candidateCount = computed(() => cells.value.filter((c) => c.kind === 'candidate').length);

const theoreticalProbability = computed<number>(() => {
  if (candidateCount.value === 0) return 0;
  return 1 / candidateCount.value;
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

// ─── 单元格样式（对齐执行案 §4.5.4 灰阶）──────────────────
function cellClass(kind: CellKind): string {
  switch (kind) {
    case 'candidate':
      return 'poi-cell-candidate';
    case 'excluded-impassable':
      return 'poi-cell-excluded-impassable';
    case 'excluded-entrance':
    case 'excluded-exit':
      return 'poi-cell-excluded-entrance-exit';
    case 'excluded-tide':
    default:
      return 'poi-cell-hidden';
  }
}

// ─── 排除标记文本 ─────────────────────────────────────────
function exclusionLabel(kind: CellKind): string {
  if (kind === 'excluded-entrance') return 'E';
  if (kind === 'excluded-exit') return 'X';
  return '';
}

// ─── 模拟命中边框样式 ─────────────────────────────────────
function isSimulated(pls: Pls): boolean {
  return simulatedPlsSet.value.has(pls);
}
</script>

<template>
  <svg
    class="overlay-poi-distribution-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <!-- 候选格与排除格矩形 -->
    <rect
      v-for="cell in cells"
      :key="`poi-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      :class="[cellClass(cell.kind), isSimulated(cell.pls) ? 'poi-cell-simulated' : '']"
      :data-pls="cell.pls"
      :data-cell-kind="cell.kind"
    />
    <!-- 排除标记（E/X） -->
    <text
      v-for="cell in cells.filter((c) => c.kind === 'excluded-entrance' || c.kind === 'excluded-exit')"
      :key="`poi-label-${cell.pls}`"
      :x="rectX(cell.x) + cellWidth / 2"
      :y="rectY(cell.y) + cellHeight / 2 + 4"
      text-anchor="middle"
      class="poi-exclusion-label"
    >{{ exclusionLabel(cell.kind) }}</text>
    <!-- 候选格理论概率数字（候选格总数 > 0 时显示） -->
    <text
      v-for="cell in cells.filter((c) => c.kind === 'candidate')"
      :key="`poi-prob-${cell.pls}`"
      :x="rectX(cell.x) + cellWidth / 2"
      :y="rectY(cell.y) + cellHeight / 2 + 3"
      text-anchor="middle"
      class="poi-probability-label"
    >{{ theoreticalProbability > 0 ? (theoreticalProbability * 100).toFixed(1) + '%' : '—' }}</text>
  </svg>
</template>

<style scoped>
/* 候选格：浅灰 fill-opacity 0.4（对齐执行案 §4.5.4） */
.poi-cell-candidate {
  fill: #cccccc;
  fill-opacity: 0.4;
  stroke: none;
  pointer-events: none;
}

/* 排除格——不可通行：中灰 fill-opacity 0.2 + 斜线纹理 */
.poi-cell-excluded-impassable {
  fill: #888888;
  fill-opacity: 0.2;
  stroke: #555555;
  stroke-width: 0.5;
  stroke-dasharray: 2 2;
  pointer-events: none;
}

/* 排除格——入口/出口：深灰 fill-opacity 0.3 */
.poi-cell-excluded-entrance-exit {
  fill: #444444;
  fill-opacity: 0.3;
  stroke: none;
  pointer-events: none;
}

/* 隐藏（tide 不匹配的格不渲染） */
.poi-cell-hidden {
  fill: none;
  stroke: none;
  pointer-events: none;
}

/* 模拟命中格：accent-error 边框高亮 */
.poi-cell-simulated {
  stroke: var(--color-accent-error, #ef4444);
  stroke-width: 2;
  stroke-opacity: 0.9;
}

/* 排除标记文本（E/X） */
.poi-exclusion-label {
  fill: #cccccc;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  user-select: none;
}

/* 理论概率数字 */
.poi-probability-label {
  fill: #dddddd;
  font-size: 9px;
  font-weight: 500;
  pointer-events: none;
  user-select: none;
}
</style>
