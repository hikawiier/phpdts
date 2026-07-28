<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// GridConnections：SVG 连通线渲染（对齐 NEW_DESIGN.md §3.1.3）
//
// 基于 tiles.neighbors 双向连通关系，渲染灰色细线连接相邻格中心。
// _breaks 字段不渲染（编辑器专用，已通过 neighbors 缺失体现）。
// 灰阶细线（对齐 2.15），不引入彩色（路径线由 OverlayReachability 负责，本组件只渲染基础连通）。

import { computed } from 'vue';
import type { Pls, Tile } from '@/shared';

const props = defineProps<{
  tiles: Record<Pls, Tile>;
  cols: number;
  rows: number;
  /** 单元格宽度（px），与 GridCanvas 保持一致 */
  cellWidth: number;
  /** 单元格高度（px） */
  cellHeight: number;
  /** 列标题宽度（px） */
  headerWidth: number;
  /** 行标题高度（px） */
  headerHeight: number;
  /** 是否渲染连通线（仅 break/restore 工具下为 true，对齐 3.4 不展示什么优先） */
  visible?: boolean;
}>();

interface ConnectionLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly key: string;
}

/**
 * 计算所有连通线（去重：A→B 与 B→A 只画一次）
 */
const lines = computed<ConnectionLine[]>(() => {
  const result: ConnectionLine[] = [];
  const seen = new Set<string>();
  for (const plsKey of Object.keys(props.tiles)) {
    const pls = Number(plsKey) as Pls;
    const tile = props.tiles[pls];
    if (!tile) continue;
    const x1 = props.headerWidth + tile.x * props.cellWidth + props.cellWidth / 2;
    const y1 = props.headerHeight + tile.y * props.cellHeight + props.cellHeight / 2;
    for (const nPls of tile.neighbors) {
      const n = Number(nPls) as Pls;
      const neighbor = props.tiles[n];
      if (!neighbor) continue;
      // 去重：min-max key
      const key = pls < n ? `${pls}-${n}` : `${n}-${pls}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const x2 = props.headerWidth + neighbor.x * props.cellWidth + props.cellWidth / 2;
      const y2 = props.headerHeight + neighbor.y * props.cellHeight + props.cellHeight / 2;
      result.push({ x1, y1, x2, y2, key });
    }
  }
  return result;
});

const svgWidth = computed(() => props.headerWidth + props.cols * props.cellWidth);
const svgHeight = computed(() => props.headerHeight + props.rows * props.cellHeight);
</script>

<template>
  <svg
    v-if="visible"
    class="pointer-events-none absolute left-0 top-0"
    :width="svgWidth"
    :height="svgHeight"
    aria-hidden="true"
  >
    <line
      v-for="line in lines"
      :key="line.key"
      :x1="line.x1"
      :y1="line.y1"
      :x2="line.x2"
      :y2="line.y2"
      stroke="var(--color-gray-500)"
      stroke-width="1"
      opacity="0.6"
    />
  </svg>
</template>
