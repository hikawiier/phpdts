//
// historyStore：撤销/重做（对齐 NEW_DESIGN.md §3.1.6 + §2.3.8）
//
// 研判：
//   - 撤销/重做是 O-0 框架的基础能力
//   - 边界契约：切换 pgroup 不清空历史栈（跨区域撤销，对齐 §3.1.6）
//   - 与 useToolActions 配合：每个编辑操作封装为 Command，由 useToolActions 调用 execute
//
// 命令模式实现 undo / redo
// 历史栈上限 100（HISTORY_STACK_MAX），超出丢弃最旧
// 切换 pgroup 不清空历史栈（跨区域撤销）

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { HISTORY_STACK_MAX } from '@/shared';

export interface Command {
  do(): void;
  undo(): void;
  readonly description: string; // i18n key
  readonly timestamp: number;
}

/**
 * 创建 Command 的工厂辅助函数（自动填充 timestamp）
 */
export function createCommand(
  description: string,
  doFn: () => void,
  undoFn: () => void,
): Command {
  return {
    do: doFn,
    undo: undoFn,
    description,
    timestamp: Date.now(),
  };
}

export const useHistoryStore = defineStore('history', () => {
  // ─── state ────────────────────────────────────────────
  const undoStack = ref<Command[]>([]);
  const redoStack = ref<Command[]>([]);

  // ─── getters ──────────────────────────────────────────
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const undoCount = computed(() => undoStack.value.length);
  const redoCount = computed(() => redoStack.value.length);
  /**
   * 最近 20 条历史记录（按时间倒序，用于历史面板展示，对齐 §3.1.6）
   */
  const recentHistory = computed<Command[]>(() => {
    const items = undoStack.value;
    return items.slice(-20).reverse();
  });

  // ─── actions ──────────────────────────────────────────
  function execute(command: Command): Command {
    command.do();
    push(command);
    return command;
  }

  function push(command: Command): void {
    const next = [...undoStack.value, command];
    if (next.length > HISTORY_STACK_MAX) {
      next.shift();
    }
    undoStack.value = next;
    redoStack.value = [];
  }

  function undo(): Command | null {
    const command = undoStack.value[undoStack.value.length - 1];
    if (!command) return null;
    command.undo();
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [...redoStack.value, command];
    return command;
  }

  function redo(): Command | null {
    const command = redoStack.value[redoStack.value.length - 1];
    if (!command) return null;
    command.do();
    redoStack.value = redoStack.value.slice(0, -1);
    undoStack.value = [...undoStack.value, command];
    return command;
  }

  function clear(): void {
    undoStack.value = [];
    redoStack.value = [];
  }

  return {
    // state
    undoStack,
    redoStack,
    // getters
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    recentHistory,
    // actions
    execute,
    push,
    undo,
    redo,
    clear,
  };
});
