<script setup lang="ts">
// GridCanvas：CSS Grid 画布主容器（对齐 NEW_DESIGN.md §3.1 + DESIGN.md 2.13）
//
// 渲染当前 pgroup 的网格，通过 v-for + GridCell 子组件管理所有格 DOM
// 所有视觉态通过响应式 :class 驱动（对齐 2.13），禁止命令式 DOM
// 拖拽通过 useToolActions.drag 状态驱动 :class，由 GridCell 读取

import { computed, ref } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import { useOverlayStore } from '@/stores/overlayStore';
import { useToolActions } from '@/composables/useToolActions';
import GridCell from './GridCell.vue';
import GridConnections from './GridConnections.vue';
import type { Pls, Tile } from '@/shared';

// 单元格尺寸常量（与旧 Vanilla JS grid.js 对齐）
const CELL_WIDTH = 52;
const CELL_HEIGHT = 44;
const HEADER_WIDTH = 38;
const HEADER_HEIGHT = 28;

const project = useProjectStore();
const tool = useToolStore();
const overlay = useOverlayStore();
const actions = useToolActions();

const gridContainer = ref<HTMLElement | null>(null);

const cols = computed(() => project.currentGrid?.cols ?? 0);
const rows = computed(() => project.currentGrid?.rows ?? 0);
const tiles = computed(() => project.currentTiles);

/**
 * 构建坐标索引：{x,y} → pls
 */
const coordIndex = computed<Map<string, { pls: Pls; tile: Tile }>>(() => {
  const map = new Map<string, { pls: Pls; tile: Tile }>();
  for (const plsKey of Object.keys(tiles.value)) {
    const pls = Number(plsKey) as Pls;
    const t = tiles.value[pls];
    if (!t) continue;
    map.set(`${t.x},${t.y}`, { pls, tile: t });
  }
  return map;
});

const gridTemplateColumns = computed(() => `${HEADER_WIDTH}px repeat(${cols.value}, ${CELL_WIDTH}px)`);
const gridTemplateRows = computed(() => `${HEADER_HEIGHT}px repeat(${rows.value}, ${CELL_HEIGHT}px)`);

/**
 * 拖拽源 pls（用于 GridCell isDragSource 判断）
 */
const dragSourcePls = computed<Pls | null>(() => actions.drag.value?.pls ?? null);
/**
 * 拖拽 hover 坐标
 */
const dragHover = computed<{ x: number; y: number } | null>(() => {
  const d = actions.drag.value;
  if (!d || !d.moved || d.hoverX === null || d.hoverY === null) return null;
  return { x: d.hoverX, y: d.hoverY };
});

const currentRegion = computed(() => project.currentRegion);

function isCellSelected(pls: Pls): boolean {
  return project.selectedPls === pls;
}
function isCellInBatch(pls: Pls): boolean {
  return tool.batchSelection.includes(pls);
}
function isCellEntrance(pls: Pls): boolean {
  return currentRegion.value?.entrance_pls === pls;
}
function isCellExit(pls: Pls): boolean {
  return currentRegion.value?.exit_pls === pls;
}

/**
 * 连通线仅在 break / restore 工具下显示（对齐 3.4：非连通性编辑场景下连通线是噪声）
 */
const showConnections = computed(() => tool.current === 'break' || tool.current === 'restore');

/**
 * 任一叠层启用时为 true，由 GridCell 隐藏格内文字（对齐 3.4 协调性即节省注意力）
 */
const anyOverlayActive = computed(() => {
  const f = overlay.flags;
  return f.fog || f.vision || f.reachability || f.tideHeatmap;
});

function onCellClick(pls: Pls): void {
  actions.handleTileClick(pls);
}
function onEmptyClick(x: number, y: number): void {
  actions.handleEmptyClick(x, y);
}

function onDragStart(pls: Pls): void {
  actions.startDragTile(pls);
}
function onDragMove(x: number, y: number): void {
  actions.updateDragHover(x, y);
}
function onDragEnd(x: number, y: number): void {
  actions.endDragTile(x, y);
}

// 拖拽中鼠标离开 grid 时取消
function onMouseLeaveContainer(): void {
  if (actions.drag.value !== null) {
    // 不立即取消，由 mouseup 在 cell 外触发时通过 window 监听处理
    // 这里仅更新 hover 为 null
    actions.updateDragHover(null, null);
  }
}

function onColumnHeader(c: number): string {
  return String(c);
}
function onRowHeader(r: number): string {
  return String.fromCharCode(65 + r);
}
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <div v-if="!project.hasProject || !project.currentPgroup" class="flex flex-1 items-center justify-center text-sm text-gray-500">
      选择一个区域开始编辑
    </div>
    <div v-else class="flex-1 overflow-auto p-2">
      <div
        ref="gridContainer"
        class="relative inline-grid"
        :style="{
          gridTemplateColumns,
          gridTemplateRows,
        }"
        @mouseleave="onMouseLeaveContainer"
      >
        <!-- 左上角空白 -->
        <div class="flex items-center justify-center border border-gray-800 bg-gray-900 text-xs text-gray-600">#</div>
        <!-- 列标题 -->
        <div
          v-for="c in cols"
          :key="`col-${c}`"
          class="flex items-center justify-center border border-gray-800 bg-gray-900 text-xs text-gray-500"
        >
          {{ onColumnHeader(c - 1) }}
        </div>
        <!-- 行标题 + 单元格 -->
        <template v-for="r in rows" :key="`row-${r}`">
          <div class="flex items-center justify-center border border-gray-800 bg-gray-900 text-xs text-gray-500">
            {{ onRowHeader(r - 1) }}
          </div>
          <GridCell
            v-for="c in cols"
            :key="`cell-${c}-${r}`"
            :pls="coordIndex.get(`${c - 1},${r - 1}`)?.pls ?? 0"
            :tile="coordIndex.get(`${c - 1},${r - 1}`)?.tile ?? null"
            :x="c - 1"
            :y="r - 1"
            :is-selected="coordIndex.get(`${c - 1},${r - 1}`) ? isCellSelected(coordIndex.get(`${c - 1},${r - 1}`)!.pls) : false"
            :is-entrance="coordIndex.get(`${c - 1},${r - 1}`) ? isCellEntrance(coordIndex.get(`${c - 1},${r - 1}`)!.pls) : false"
            :is-exit="coordIndex.get(`${c - 1},${r - 1}`) ? isCellExit(coordIndex.get(`${c - 1},${r - 1}`)!.pls) : false"
            :is-in-batch="coordIndex.get(`${c - 1},${r - 1}`) ? isCellInBatch(coordIndex.get(`${c - 1},${r - 1}`)!.pls) : false"
            :is-break-first="coordIndex.get(`${c - 1},${r - 1}`) ? tool.breakFirst === coordIndex.get(`${c - 1},${r - 1}`)!.pls : false"
            :tool="tool.current"
            :drag-state="actions.drag.value"
            :is-drag-source="coordIndex.get(`${c - 1},${r - 1}`) ? dragSourcePls === coordIndex.get(`${c - 1},${r - 1}`)!.pls : false"
            :is-drag-hover="dragHover !== null && dragHover.x === c - 1 && dragHover.y === r - 1"
            :overlay-active="anyOverlayActive"
            @click="onCellClick"
            @empty-click="onEmptyClick"
            @drag-start="onDragStart"
            @drag-move="onDragMove"
            @drag-end="onDragEnd"
          />
        </template>

        <!-- SVG 连通线（绝对定位叠加在格之上，仅 break/restore 工具下渲染，对齐 3.4） -->
        <GridConnections
          :tiles="tiles"
          :cols="cols"
          :rows="rows"
          :cell-width="CELL_WIDTH"
          :cell-height="CELL_HEIGHT"
          :header-width="HEADER_WIDTH"
          :header-height="HEADER_HEIGHT"
          :visible="showConnections"
        />
      </div>
    </div>
  </div>
</template>
