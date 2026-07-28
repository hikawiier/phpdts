<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// OverlayTideHeatmap：潮汐热图叠层（对齐 NEW_DESIGN.md §3.3.2 + DESIGN.md 2.15）
//
// 研判：
//   - 潮汐热图是 O-1 的四叠层之一
//   - 与 GridCell.tideClass 的区别：
//     - GridCell 标记是边框色（小幅提示）
//     - 本叠层是背景色全幅覆盖（用于全局 tide 分布观察）
//
// 视觉规则（C-10：三档灰阶亮度增强，原在 #111 深背景上几乎不可见）：
//   - shallow：浅灰 #cccccc fill-opacity 0.5（原 0.35）
//   - deep：中灰 #888888 fill-opacity 0.65（原 0.45）
//   - abyss：深灰 #222222 fill-opacity 0.8（原 #444444 0.55，改用 #222 与背景 #111 形成可见差异）
//
// 设计契约（对齐 2.13）：
//   - 纯 props 驱动 SVG 渲染，无命令式 DOM

import { computed } from 'vue';
import type { Pls, Tile, Tide } from '@/shared';

const props = defineProps<{
  tiles: Record<Pls, Tile>;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  headerWidth: number;
  headerHeight: number;
}>();

interface TideRect {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
  readonly tide: Tide;
}

/**
 * 计算所有 tile 的潮汐热图矩形
 */
const tideCells = computed<TideRect[]>(() => {
  const result: TideRect[] = [];
  for (const plsStr of Object.keys(props.tiles)) {
    const pls = Number(plsStr) as Pls;
    const tile = props.tiles[pls];
    if (!tile) continue;
    result.push({ pls, x: tile.x, y: tile.y, tide: tile.tide });
  }
  return result;
});

const svgWidth = computed(() => props.headerWidth + props.cols * props.cellWidth);
const svgHeight = computed(() => props.headerHeight + props.rows * props.cellHeight);

function rectX(x: number): number {
  return props.headerWidth + x * props.cellWidth;
}
function rectY(y: number): number {
  return props.headerHeight + y * props.cellHeight;
}
</script>

<template>
  <svg
    class="overlay-tide-heatmap-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <rect
      v-for="cell in tideCells"
      :key="`tide-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      :class="`tide-rect tide-${cell.tide}`"
      :data-pls="cell.pls"
      :data-tide="cell.tide"
    />
  </svg>
</template>

<style scoped>
/* Tide 三档灰阶亮度（C-10：增强 fill-opacity，原在 #111 深背景上几乎不可见） */
.tide-shallow {
  fill: var(--color-tide-shallow, #cccccc);
  fill-opacity: 0.5;
  stroke: none;
}

.tide-deep {
  fill: var(--color-tide-deep, #888888);
  fill-opacity: 0.65;
  stroke: none;
}

.tide-abyss {
  fill: var(--color-tide-abyss, #222222);
  fill-opacity: 0.8;
  stroke: none;
}
</style>
