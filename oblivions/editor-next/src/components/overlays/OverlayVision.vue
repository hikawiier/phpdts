<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// OverlayVision：视野范围叠层（对齐 NEW_DESIGN.md §3.3.2 + DESIGN.md 2.15）
//
// 研判：
//   - 视野范围是 O-1 的四叠层之一
//   - 间接关联 E-6：视野 BFS 移植自后端 obl_calc_vision_range
//
// 视觉规则（C-10 重构：4 种边框区分度提升，颜色统一灰阶白，区分度靠线型 + 粗细 + opacity）：
//   - vision-player：实线粗白 sw3 + 中心实心圆 r4（玩家位置是核心信息）
//   - vision-near：实线细白 sw1.5（dist ≤ 1，近距离清晰视野）
//   - vision-edge：虚线白 dasharray 4 2（dist > 1，远距离模糊视野）
//   - vision-sense：点状白 dasharray 1 3 + opacity 0.6（感知外圈，最弱信号）
//
// 设计契约（对齐 2.13）：
//   - 纯 props 驱动 SVG 渲染，无命令式 DOM

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
  /** 视野范围 BFS 结果：pls → distance */
  visionDistance: Map<Pls, number>;
  /** 敌人感知范围 BFS 结果：pls → distance（视野外、感知内的格渲染虚线边框） */
  enemySenseDistance: Map<Pls, number>;
  /** 玩家所在 pls（null 时仅渲染视野范围，不渲染玩家标记） */
  playerPls?: Pls | null;
}>();

interface VisionRect {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
  readonly dist: number;
  /** 'player' | 'near' | 'edge' | 'sense'：决定 stroke 样式 */
  readonly kind: 'player' | 'near' | 'edge' | 'sense';
}

/**
 * 计算需要渲染视野边框的格列表
 *
 * - 玩家格（dist=0）：实线 + 中心点
 * - 视野内（dist ≤ 1）：实线灰阶白边框
 * - 视野边缘（dist > 1）：虚线灰阶边框
 * - 感知外圈（不在视野但在感知范围）：虚线灰阶边框
 */
const visionCells = computed<VisionRect[]>(() => {
  const result: VisionRect[] = [];
  const visionSet = new Set<Pls>();
  for (const [pls, dist] of props.visionDistance) {
    visionSet.add(pls);
    const tile = props.tiles[pls];
    if (!tile) continue;
    let kind: VisionRect['kind'];
    if (props.playerPls !== null && props.playerPls !== undefined && pls === props.playerPls) {
      kind = 'player';
    } else if (dist <= 1) {
      kind = 'near';
    } else {
      kind = 'edge';
    }
    result.push({ pls, x: tile.x, y: tile.y, dist, kind });
  }
  // 感知外圈：在感知范围但不在视野范围
  for (const [pls, dist] of props.enemySenseDistance) {
    if (visionSet.has(pls)) continue;
    const tile = props.tiles[pls];
    if (!tile) continue;
    result.push({ pls, x: tile.x, y: tile.y, dist, kind: 'sense' });
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

/**
 * 玩家中心点坐标（实心圆点）
 */
const playerCenter = computed<{ cx: number; cy: number } | null>(() => {
  if (props.playerPls === null || props.playerPls === undefined) return null;
  const tile = props.tiles[props.playerPls];
  if (!tile) return null;
  return {
    cx: props.headerWidth + tile.x * props.cellWidth + props.cellWidth / 2,
    cy: props.headerHeight + tile.y * props.cellHeight + props.cellHeight / 2,
  };
});
</script>

<template>
  <svg
    class="overlay-vision-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <rect
      v-for="cell in visionCells"
      :key="`vision-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      :class="`vision-rect vision-${cell.kind}`"
      :data-pls="cell.pls"
      :data-vision-dist="cell.dist"
      :data-vision-kind="cell.kind"
    />
    <!-- 玩家中心标记（实心圆点 r4，灰阶白，对齐 2.15 + C-10 增强） -->
    <circle
      v-if="playerCenter"
      :cx="playerCenter.cx"
      :cy="playerCenter.cy"
      r="4"
      class="vision-player-dot"
      :data-player-pls="playerPls ?? null"
    />
  </svg>
</template>

<style scoped>
/* 视野内格（dist ≤ 1）：实线细白边框 sw1.5（C-10：原 sw2，与 player 拉开差距） */
.vision-near {
  fill: none;
  stroke: var(--color-gray-100, #eeeeee);
  stroke-width: 1.5;
}

/* 视野边缘（dist > 1）：虚线白边框 dasharray 4 2（C-10：原灰阶 #aaaaaa 改为白以与 sense 区分） */
.vision-edge {
  fill: none;
  stroke: var(--color-gray-100, #eeeeee);
  stroke-width: 1.5;
  stroke-dasharray: 4 2;
}

/* 感知范围外圈：点状白边框 dasharray 1 3 + opacity 0.6（C-10：原虚线灰改为点状 + 半透明） */
.vision-sense {
  fill: none;
  stroke: var(--color-gray-100, #eeeeee);
  stroke-width: 1;
  stroke-dasharray: 1 3;
  opacity: 0.6;
}

/* 玩家所在格：实线粗白边框 sw3（C-10：原 sw2.5 增强） */
.vision-player {
  fill: none;
  stroke: var(--color-gray-100, #eeeeee);
  stroke-width: 3;
}

/* 玩家中心点标记 r4（C-10：原 r3 增强） */
.vision-player-dot {
  fill: var(--color-gray-100, #eeeeee);
  pointer-events: none;
}
</style>
