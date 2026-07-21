<script setup lang="ts">
// OverlayReachability：可达性热图 + 路径预览叠层（对齐 NEW_DESIGN.md §3.3.2 + DESIGN.md 2.15）
//
// 研判：
//   - 可达性是 O-1 的四叠层之一
//   - 间接关联 E-3：可达性 BFS 移植自后端 obl_get_distance
//
// 视觉规则（C-6 + C-10 重构：路径线下线为灰阶白虚线，全编辑器仅剩 accent-error 红一种强调色）：
//   - 可达格：背景微亮 rgba(255,255,255,0.08)（C-10：原灰边框，移除边框改为背景）
//   - 不可达格：背景微暗 rgba(0,0,0,0.45)（C-10：原 rgba(17,17,17,0.5)，加深对比）
//   - 路径线：灰阶白 var(--color-gray-100) 虚线 dasharray 6 3（C-6：原绿色路径线已下线，无动画）
//
// 设计契约（对齐 2.13）：
//   - 纯 props 驱动 SVG 渲染，无命令式 DOM
//   - 路径线通过响应式 <polyline :points> 渲染（非命令式 appendChild）

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
  /** 可达性 BFS 结果：pls → distance */
  reachabilityDistance: Map<Pls, number>;
  /** 路径预览：pls 列表（含起点和终点） */
  pathPreview: Pls[];
}>();

interface ReachabilityRect {
  readonly pls: Pls;
  readonly x: number;
  readonly y: number;
  readonly dist: number;
  readonly kind: 'reachable' | 'unreachable';
}

/**
 * 计算需要渲染可达性背景的格列表
 *
 * - 可达格（dist 已知）：背景微亮（C-10：移除边框改为背景 fill rgba(255,255,255,0.08)）
 * - 不可达格（在 tiles 中但不在 reachabilityDistance 中）：背景微暗（C-10：rgba(0,0,0,0.45)）
 */
const reachabilityCells = computed<ReachabilityRect[]>(() => {
  const result: ReachabilityRect[] = [];
  // 可达格
  for (const [pls, dist] of props.reachabilityDistance) {
    const tile = props.tiles[pls];
    if (!tile) continue;
    result.push({ pls, x: tile.x, y: tile.y, dist, kind: 'reachable' });
  }
  // 不可达格（在当前 tiles 中但不在可达集中）
  const reachableSet = new Set<Pls>(props.reachabilityDistance.keys());
  for (const plsStr of Object.keys(props.tiles)) {
    const pls = Number(plsStr) as Pls;
    if (reachableSet.has(pls)) continue;
    const tile = props.tiles[pls];
    if (!tile) continue;
    result.push({ pls, x: tile.x, y: tile.y, dist: -1, kind: 'unreachable' });
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
 * 路径预览 polyline 坐标字符串
 *
 * 将路径 pls 列表转换为 "x1,y1 x2,y2 ..." 格式
 * 路径不足 2 个点时不渲染
 */
const pathPoints = computed<string>(() => {
  if (props.pathPreview.length < 2) return '';
  const points: string[] = [];
  for (const pls of props.pathPreview) {
    const tile = props.tiles[pls];
    if (!tile) continue;
    const cx = props.headerWidth + tile.x * props.cellWidth + props.cellWidth / 2;
    const cy = props.headerHeight + tile.y * props.cellHeight + props.cellHeight / 2;
    points.push(`${cx},${cy}`);
  }
  return points.join(' ');
});

const hasPath = computed(() => props.pathPreview.length >= 2);
</script>

<template>
  <svg
    class="overlay-reachability-layer absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <!-- 可达 / 不可达格背景（C-10：移除边框，改为背景明暗对比） -->
    <rect
      v-for="cell in reachabilityCells"
      :key="`reach-${cell.pls}`"
      :x="rectX(cell.x)"
      :y="rectY(cell.y)"
      :width="cellWidth"
      :height="cellHeight"
      :class="`reach-rect reach-${cell.kind}`"
      :data-pls="cell.pls"
      :data-reach-dist="cell.dist"
      :data-reach-kind="cell.kind"
    />
    <!-- 路径预览线（C-6：灰阶白虚线 dasharray 6 3，无动画，对齐 2.15 唯一强调色仅剩 error 红） -->
    <polyline
      v-if="hasPath"
      :points="pathPoints"
      class="overlay-path-line"
      fill="none"
      stroke="var(--color-gray-100, #eeeeee)"
      stroke-width="3"
      stroke-dasharray="6 3"
      stroke-linecap="round"
      stroke-linejoin="round"
      data-path-preview="true"
    />
  </svg>
</template>

<style scoped>
/* 可达格：背景微亮（C-10：原灰边框 sw1.5 改为背景 fill，不抢注意力） */
.reach-reachable {
  fill: rgba(255, 255, 255, 0.08);
  stroke: none;
}

/* 不可达格：背景微暗（C-10：原 rgba(17,17,17,0.5) 加深为 rgba(0,0,0,0.45)） */
.reach-unreachable {
  fill: rgba(0, 0, 0, 0.45);
  stroke: none;
}
</style>
