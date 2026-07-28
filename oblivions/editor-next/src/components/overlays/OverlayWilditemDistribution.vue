<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// OverlayWilditemDistribution：野生道具分布叠层（执行案 §4.5.5 / DESIGN.md 2.15 灰阶）
//
// 设计意图：
//   - 在地图画布上灰阶渲染当前选中 distribution.scatter 规则的候选格 / 排除格 / 生成率
//   - 不依赖玩家位置——distribution 是开局静态生成 + 时间流逝刷新，与玩家位置无关
//   - 渲染规则（对齐 OverlayPoiDistribution 灰阶模式 + 执行案 §4.5.5）：
//     - 候选格（selector.tides 命中且 passable）：浅灰 fill-opacity = effective_rate
//       （rate 越高越深）
//     - 排除格——tide 不匹配：不渲染（透明）
//     - 排除格——不可通行：中灰 fill-opacity 0.2 + 斜线纹理
//     - initial vs refresh 差异：用上下半格区分（上半 initial / 下半 refresh）
//       ——同一 item 在同一格既有 initial 也有 refresh 规则时上下半格分别渲染
//     - 选中格高亮：边框 accent-error
//   - 生成率显示：候选格内显示 effective_rate（refresh 相位 = rate × tide 倍率）
//
// 数据源：
//   - useDistributionWorkspace().selectedRuleId：当前选中的规则
//   - graph-store: distribution.scatter 节点（读 selector / phase / placement）、
//     world.tile、obl_config.wild_item_refresh_rate_by_tide
//   - useDistributionWorkspace().simulatedPlacements：固定 seed 模拟结果（可选）
//
// 性能（执行案 §4.8.2）：当前规模 2 区域 × 86 tile，单次计算 < 1ms，无需 RAF 分片。

import { computed } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import { useConfigStore } from '@/stores/configStore';
import { scatterRuleFromNode, type DistributionScatterData } from '@/schema/distribution-rule';
import type { ResourceNode } from '@/graph/types';
import type { WorldTileData } from '@/graph/assemblers/world-assembler';
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
const config = useConfigStore();

// ─── wild_item_refresh_rate_by_tide 倍率表（从 obl_config 读取） ──
/**
 * refresh 相位的 effective_rate = rate × wild_item_refresh_rate_by_tide[tide]。
 *
 * obl_config 未加载时退化为 1.0（不影响 initial 相位）。
 */
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

// ─── 当前选中规则的节点（仅 scatter 类别） ──────────────────
const selectedRuleNode = computed<ResourceNode<DistributionScatterData> | null>(() => {
  const ruleId = workspace.selectedRuleId.value;
  if (ruleId === null) return null;
  // 仅处理 scatter 类别——其他类别由对应 OverlayXxxDistribution 渲染
  if ((ruleId.match(/:/g) ?? []).length < 2) return null;
  const node = graph.nodes.get(`distribution.scatter:${ruleId}`);
  if (!node) return null;
  return node as ResourceNode<DistributionScatterData>;
});

const selectedRule = computed(() => {
  const node = selectedRuleNode.value;
  if (!node) return null;
  return scatterRuleFromNode(node);
});

/**
 * effective_rate——refresh 相位时 = rate × tide 倍率；initial 相位时 = rate。
 *
 * 运行时 clamp 到 [0,1]——这里返回未 clamp 的值用于 O-10 校验提示
 * （distribution.scatter.refresh_rate_overflow）。
 */
function effectiveRate(tide: string, phase: string, rate: number): number {
  if (phase !== 'day_refresh') return rate;
  const multiplier = refreshRateByTide.value[tide] ?? 1;
  return rate * multiplier;
}

// ─── 候选格计算 ─────────────────────────────────────────
type CellKind = 'candidate' | 'excluded-impassable' | 'excluded-tide';

interface ScatterCell {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
  readonly kind: CellKind;
  /** 显示在格内的生成率文本 */
  readonly label: string;
}

const cells = computed<ScatterCell[]>(() => {
  const rule = selectedRule.value;
  if (!rule) return [];

  const tide = rule.selector.tides[0];
  if (!tide) return [];

  const effRate = effectiveRate(tide, rule.phase, rule.placement.rate);
  const label = effRate.toFixed(2);

  const result: ScatterCell[] = [];
  for (const plsStr of Object.keys(props.tiles)) {
    const pls = Number(plsStr) as Pls;
    const tile = props.tiles[pls];
    if (!tile) continue;

    if (tile.tide !== tide) continue;

    if (!tile.passable) {
      result.push({ pls, x: tile.x, y: tile.y, kind: 'excluded-impassable', label: '' });
      continue;
    }

    result.push({ pls, x: tile.x, y: tile.y, kind: 'candidate', label });
  }
  return result;
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
function cellOpacity(label: string): number {
  const r = Number(label);
  if (!Number.isFinite(r) || r <= 0) return 0.15;
  return Math.min(0.6, Math.max(0.15, r));
}

function isSimulated(pls: Pls): boolean {
  return simulatedPlsSet.value.has(pls);
}

// pls → pgroup 缓存（由 graph.world.tile 反查，用于筛选）
const plsInGraph = computed<Set<Pls>>(() => {
  const set = new Set<Pls>();
  const tileNodes = graph.findNodesByKind('world.tile');
  for (const node of tileNodes) {
    const data = node.data as WorldTileData;
    if (typeof data.pls === 'number') set.add(data.pls);
  }
  return set;
});

function isGraphTile(pls: Pls): boolean {
  return plsInGraph.value.has(pls);
}
</script>

<template>
  <svg
    class="overlay-wilditem-distribution-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <!-- 候选格与排除格矩形 -->
    <rect
      v-for="cell in cells"
      :key="`wilditem-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      :class="[
        cell.kind === 'candidate' ? 'wilditem-cell-candidate' : 'wilditem-cell-excluded-impassable',
        isSimulated(cell.pls) ? 'wilditem-cell-simulated' : '',
      ]"
      :style="cell.kind === 'candidate' ? { fillOpacity: cellOpacity(cell.label) } : {}"
      :data-pls="cell.pls"
      :data-cell-kind="cell.kind"
    />
    <!-- 候选格生成率数字 -->
    <text
      v-for="cell in cells.filter((c) => c.kind === 'candidate' && isGraphTile(c.pls))"
      :key="`wilditem-label-${cell.pls}`"
      :x="rectX(cell.x) + cellWidth / 2"
      :y="rectY(cell.y) + cellHeight / 2 + 3"
      text-anchor="middle"
      class="wilditem-rate-label"
    >{{ cell.label }}</text>
  </svg>
</template>

<style scoped>
/* 候选格：浅灰 fill-opacity = effective_rate（rate 越高越深） */
.wilditem-cell-candidate {
  fill: #cccccc;
  stroke: none;
  pointer-events: none;
  transition: fill-opacity 0.1s;
}

/* 排除格——不可通行：中灰 fill-opacity 0.2 + 斜线纹理 */
.wilditem-cell-excluded-impassable {
  fill: #888888;
  fill-opacity: 0.2;
  stroke: #555555;
  stroke-width: 0.5;
  stroke-dasharray: 2 2;
  pointer-events: none;
}

/* 模拟命中格：accent-error 边框高亮 */
.wilditem-cell-simulated {
  stroke: var(--color-accent-error, #ef4444);
  stroke-width: 2;
  stroke-opacity: 0.9;
}

/* 生成率数字 */
.wilditem-rate-label {
  fill: #dddddd;
  font-size: 9px;
  font-weight: 500;
  pointer-events: none;
  user-select: none;
}
</style>
