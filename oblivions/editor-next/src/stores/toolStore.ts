//
// toolStore：当前工具与画笔预设（对齐 NEW_DESIGN.md §3.1.4 + §3.1.5 + §2.3.7）
//
// 研判：
//   - 工具栏与画笔预设是 O-0 框架的编辑入口
//   - sim-player / sim-explore 工具会切换到 Simulate 视图
//   - 与 useToolActions 配合：toolStore 只管状态，行为由 useToolActions 实现
//
// 工具列表（7 + 2 sim）：
//   select / draw / erase / paint / break / restore / batch-select
//   sim-player / sim-explore（M4 实现，此处仅占位以保留快捷键映射）
//
// 画笔预设：floor 5 类 + tide 3 档（不含 safe，对齐 DESIGN.md 1.3） + passable + height + destructible + preset_safe

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Floor, Tide, Pls } from '@/shared';
import { FLOOR_TYPES, TIDE_TYPES } from '@/shared';

export type ToolId =
  | 'select'
  | 'draw'
  | 'erase'
  | 'paint'
  | 'break'
  | 'restore'
  | 'sim-player'
  | 'sim-explore'
  | 'batch-select';

/**
 * 编辑器可用工具列表（不含 sim-* 模拟工具，由 O-1 视图独立处理）
 */
export const EDITOR_TOOL_LIST: readonly ToolId[] = [
  'select',
  'draw',
  'erase',
  'paint',
  'break',
  'restore',
  'batch-select',
] as const;

/**
 * 工具 → 快捷键映射（对齐 NEW_DESIGN.md §3.1.4）
 *
 * P / X 的 sim-player / sim-explore 由 useEditorKeyboard 统一注册，
 * 此处仅保留映射供 ToolPanel 显示快捷键提示。
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  v: 'select',
  b: 'draw',
  e: 'erase',
  f: 'paint',
  d: 'break',
  r: 'restore',
  q: 'batch-select',
  p: 'sim-player',
  x: 'sim-explore',
} as const;

/**
 * 反向映射：toolId → shortcut key（用于 ToolPanel 显示）
 */
export const TOOL_SHORTCUT_LABELS: Readonly<Partial<Record<ToolId, string>>> = Object.fromEntries(
  Object.entries(TOOL_SHORTCUTS).map(([key, tool]) => [tool, key.toUpperCase()]),
);

export interface BrushPreset {
  floor: Floor;
  tide: Tide;
  passable: boolean;
  height: number;
  destructible: boolean;
  preset_safe: boolean;
}

export const DEFAULT_BRUSH: BrushPreset = {
  floor: 'standard',
  tide: 'shallow',
  passable: true,
  height: 0,
  destructible: false,
  preset_safe: false,
};

/**
 * 校验 BrushPreset 字段合法性（用于导入旧数据迁移）
 */
export function sanitizeBrush(input: Partial<BrushPreset> | undefined): BrushPreset {
  const next: BrushPreset = { ...DEFAULT_BRUSH, ...input };
  if (!FLOOR_TYPES.includes(next.floor)) next.floor = 'standard';
  if (!TIDE_TYPES.includes(next.tide)) next.tide = 'shallow';
  if (typeof next.passable !== 'boolean') next.passable = true;
  if (typeof next.height !== 'number' || Number.isNaN(next.height)) next.height = 0;
  if (typeof next.destructible !== 'boolean') next.destructible = false;
  if (typeof next.preset_safe !== 'boolean') next.preset_safe = false;
  return next;
}

export const useToolStore = defineStore('tool', () => {
  // ─── state ────────────────────────────────────────────
  const current = ref<ToolId>('select');
  const brush = ref<BrushPreset>({ ...DEFAULT_BRUSH });
  const batchSelection = ref<Pls[]>([]);
  /**
   * break / restore 工具两步点击的第一步 pls（null 表示尚未开始）
   *
   * 切换工具时自动清空（对齐 Vanilla JS tools.js setTool 行为）
   */
  const breakFirst = ref<Pls | null>(null);

  // ─── getters ──────────────────────────────────────────
  const isBatchMode = computed(() => current.value === 'batch-select');
  const isBrushActive = computed(() => current.value === 'draw' || current.value === 'paint');
  const batchCount = computed(() => batchSelection.value.length);

  // ─── actions ──────────────────────────────────────────
  function setTool(tool: ToolId): void {
    current.value = tool;
    // 切换工具时清空两步点击状态与批量选择
    breakFirst.value = null;
    if (tool !== 'batch-select') {
      batchSelection.value = [];
    }
  }

  function updateBrush(patch: Partial<BrushPreset>): void {
    brush.value = sanitizeBrush({ ...brush.value, ...patch });
  }

  function resetBrush(): void {
    brush.value = { ...DEFAULT_BRUSH };
  }

  function setBatchSelection(plsList: Pls[]): void {
    batchSelection.value = [...plsList];
  }

  function addToBatchSelection(pls: Pls): void {
    if (!batchSelection.value.includes(pls)) {
      batchSelection.value = [...batchSelection.value, pls];
    }
  }

  function removeFromBatchSelection(pls: Pls): void {
    batchSelection.value = batchSelection.value.filter((p) => p !== pls);
  }

  function toggleBatchSelection(pls: Pls): void {
    if (batchSelection.value.includes(pls)) {
      removeFromBatchSelection(pls);
    } else {
      addToBatchSelection(pls);
    }
  }

  function clearBatchSelection(): void {
    batchSelection.value = [];
  }

  function setBreakFirst(pls: Pls | null): void {
    breakFirst.value = pls;
  }

  return {
    // state
    current,
    brush,
    batchSelection,
    breakFirst,
    // getters
    isBatchMode,
    isBrushActive,
    batchCount,
    // actions
    setTool,
    updateBrush,
    resetBrush,
    setBatchSelection,
    addToBatchSelection,
    removeFromBatchSelection,
    toggleBatchSelection,
    clearBatchSelection,
    setBreakFirst,
  };
});
