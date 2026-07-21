<script setup lang="ts">
// OverlayFog：迷雾叠层（对齐 NEW_DESIGN.md §3.3.2 + DESIGN.md 2.15）
//
// 研判：
//   - 迷雾是 O-1 的四叠层之一
//
// 视觉规则（对齐 2.15 灰阶基底 + C-10 视觉层次重构）：
//   - fog=0（迷雾中）：半透明深遮罩 rgba(17,17,17,0.7)（C-10 加深，原 0.55）
//   - fog=1（已点亮）：无视觉变化（清晰）
//   - 无数据：不渲染（保持原状）
//   - 不再渲染 ASCII 字符（C-10 移除，与中文 UI 字体不协调）
//
// 设计契约（对齐 2.13）：
//   - 纯 props 驱动 SVG 渲染，无命令式 DOM
//   - 每个迷雾格仅渲染一个 SVG <rect> 半透明背景

import { computed } from 'vue';
import type { Pls, Tile } from '@/shared';

const props = defineProps<{
  tiles: Record<Pls, Tile>;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  headerWidth: number;
  headerHeight: number;
  /** 迷雾数据：pls → 0|1，未在 Map 中的 pls 不渲染 */
  fogData: Map<Pls, 0 | 1>;
}>();

interface FogCell {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
}

/**
 * 计算需要渲染迷雾遮罩的格列表（fog=0）
 *
 * fog=1 的格不渲染（清晰状态不改变视觉）
 * 无数据的格不渲染（保持原状，避免覆盖其他叠层）
 */
const fogCells = computed<FogCell[]>(() => {
  const result: FogCell[] = [];
  for (const [pls, fog] of props.fogData) {
    if (fog !== 0) continue; // fog=1 跳过
    const tile = props.tiles[pls];
    if (!tile) continue;
    result.push({ pls, x: tile.x, y: tile.y });
  }
  return result;
});

const svgWidth = computed(() => props.headerWidth + props.cols * props.cellWidth);
const svgHeight = computed(() => props.headerHeight + props.rows * props.cellHeight);

/**
 * 单元格矩形坐标
 */
function rectX(x: number): number {
  return props.headerWidth + x * props.cellWidth;
}
function rectY(y: number): number {
  return props.headerHeight + y * props.cellHeight;
}
</script>

<template>
  <svg
    class="overlay-fog-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <!-- 半透明深遮罩（C-10 加深至 0.7，对齐 2.15 灰阶基底） -->
    <rect
      v-for="cell in fogCells"
      :key="`fog-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      class="fog-rect"
      :data-pls="cell.pls"
      :data-fog="0"
    />
  </svg>
</template>

<style scoped>
.fog-rect {
  fill: rgba(17, 17, 17, 0.7);
  /* 灰阶半透明深遮罩（C-10 加深，原 0.55，对齐 2.15 灰阶基底） */
}
</style>
