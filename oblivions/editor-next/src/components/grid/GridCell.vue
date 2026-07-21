<script setup lang="ts">
// GridCell：单元格（对齐 NEW_DESIGN.md §3.1 + DESIGN.md 2.13）
//
// 响应式 :class 驱动所有视觉态（selected / dragging / drop-target / break-first / batch-selected / floor / tide）
// 禁止命令式 DOM 操作（对齐 2.13 v-for 管理子树）
// 拖拽态通过 props.dragState 读取（由 GridCanvas 传入 useToolActions.drag）

import { computed } from 'vue';
import type { Tile, Pls, Floor, Tide } from '@/shared';
import type { DragState } from '@/composables/useToolActions';
import type { ToolId } from '@/stores/toolStore';

const props = withDefaults(
  defineProps<{
    pls: Pls;
    tile: Tile | null; // null 表示空白格
    x: number;
    y: number;
    isSelected: boolean;
    isEntrance: boolean;
    isExit: boolean;
    isInBatch: boolean;
    isBreakFirst: boolean;
    tool: ToolId;
    dragState: DragState | null;
    /** 当前 drag 是否悬停在此格上（用于 drop-target 高亮） */
    isDragHover: boolean;
    /** 此格是否是 drag 源（用于 dragging 高亮） */
    isDragSource: boolean;
    /** 是否启用任意叠层（叠层启用时隐藏格内文字，对齐 3.4 协调性，默认 false） */
    overlayActive?: boolean;
  }>(),
  {
    overlayActive: false,
  },
);

const emit = defineEmits<{
  click: [pls: Pls];
  emptyClick: [x: number, y: number];
  dragStart: [pls: Pls];
  dragMove: [x: number, y: number];
  dragEnd: [x: number, y: number];
}>();

const isEmpty = computed(() => props.tile === null);

/**
 * 单元格 class 计算（响应式驱动，对齐 2.13）
 */
const cellClass = computed(() => {
  const base = 'grid-cell relative flex items-center justify-center border border-gray-800 text-xs select-none';
  if (isEmpty.value) {
    // 空白格：draw 工具下显示可绘制提示
    const drawHover = props.tool === 'draw' ? 'hover:bg-gray-800/50 hover:border-gray-600' : '';
    const dropTarget = props.isDragHover ? 'bg-gray-700/40 border-dashed border-gray-400' : '';
    return [base, 'bg-gray-900/30', drawHover, dropTarget].filter(Boolean).join(' ');
  }
  // 已有格
  const cls: string[] = [base];
  // 选中态
  if (props.isSelected) cls.push('cell-selected', 'bg-gray-700', 'border-gray-400');
  // 拖拽源
  if (props.isDragSource) cls.push('cell-dragging', 'opacity-50');
  // drop target
  if (props.isDragHover) cls.push('cell-drop-target', 'ring-2', 'ring-gray-400');
  // 入口 / 出口标记
  if (props.isEntrance) cls.push('cell-entrance');
  if (props.isExit) cls.push('cell-exit');
  // 不可通行（在 selected 之外使用更深的灰阶 + 斜线纹理，对齐 2.15 形状编码不引入彩色）
  if (props.tile && !props.tile.passable && !props.isSelected) cls.push('cell-blocked', 'bg-gray-800', 'cell-blocked-texture');
  // batch 选中
  if (props.isInBatch) cls.push('cell-batch-selected', 'ring-1', 'ring-gray-500');
  // break / restore 第一步
  if (props.isBreakFirst) cls.push('cell-break-first', 'ring-2', 'ring-accent-error');
  // preset_safe 标记（右上角小标，灰阶形状编码，不引入彩色）
  // 通过 ::after 实现，class 仅作标记
  if (props.tile?.preset_safe) cls.push('cell-safe');
  return cls.join(' ');
});

/**
 * floor 形状纹理 class（对齐 2.15：floor 用 CSS 形状纹理，不引入彩色）
 */
const floorClass = computed(() => {
  if (!props.tile) return '';
  const floor: Floor = props.tile.floor;
  if (floor === 'standard') return '';
  return `floor-${floor}`;
});

/**
 * tide 灰阶亮度 class（对齐 2.15 + tailwind.config.ts tide 三档）
 */
const tideClass = computed(() => {
  if (!props.tile) return '';
  const tide: Tide = props.tile.tide;
  if (tide === 'shallow') return '';
  return `tide-${tide}`;
});

function onClick(): void {
  if (isEmpty.value) {
    emit('emptyClick', props.x, props.y);
  } else {
    emit('click', props.pls);
  }
}

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return; // 仅左键
  if (isEmpty.value) return;
  if (props.tool !== 'select') return;
  emit('dragStart', props.pls);
}

function onMouseEnter(): void {
  if (props.dragState !== null) {
    emit('dragMove', props.x, props.y);
  }
}

function onMouseUp(): void {
  if (props.dragState !== null) {
    emit('dragEnd', props.x, props.y);
  }
}
</script>

<template>
  <div
    :class="[cellClass, floorClass, tideClass]"
    :data-pls="isEmpty ? null : pls"
    :data-x="x"
    :data-y="y"
    @click="onClick"
    @mousedown="onMouseDown"
    @mouseenter="onMouseEnter"
    @mouseup="onMouseUp"
  >
    <template v-if="!isEmpty && tile">
      <span
        v-if="!overlayActive && tile.name"
        class="cell-name pointer-events-none truncate text-xs text-gray-200"
        >{{ tile.name }}</span
      >
      <span
        v-if="!overlayActive && isEntrance"
        class="cell-badge badge-entrance pointer-events-none absolute left-0 top-0 text-[8px] text-gray-300"
        >入</span
      >
      <span
        v-if="!overlayActive && isExit"
        class="cell-badge badge-exit pointer-events-none absolute right-0 top-0 text-[8px] text-gray-300"
        >出</span
      >
    </template>
  </div>
</template>

