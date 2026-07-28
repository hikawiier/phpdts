// @module O 内容工具箱
//
// historyStore：撤销/重做（对齐 NEW_DESIGN.md §3.1.6 + §2.3.8 + P1-E 重构）
//
// 研判（P1-E 重构后）：
//   - 撤销/重做是 O-0 框架的基础能力
//   - 边界契约：切换 pgroup 不清空历史栈（跨区域撤销，对齐 §3.1.6）
//   - 与 useToolActions 配合：每个编辑操作封装为 Command，由 useToolActions 调用 execute/push
//   - P1-E：新增 GraphCommand 类型——基于 graph-store 的 world 子图快照（before/after）
//     自动还原，调用方无需提供 undoFn
//   - P1-E：保留旧 Command 类型与 createCommand/push/execute/undo/redo API，
//     useToolActions 现有代码零修改；新增 executeGraph/createGraphCommand 供新调用方使用
//
// 历史栈上限 100（HISTORY_STACK_MAX），超出丢弃最旧
// 切换 pgroup 不清空历史栈（跨区域撤销）

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { HISTORY_STACK_MAX } from '@/shared';
import { useProjectStore, type GraphSnapshot } from '@/stores/projectStore';

/**
 * 旧式 Command——基于 do/undo 函数对。
 *
 * 保留供 useToolActions 现有代码使用；新调用方应优先使用 GraphCommand（见下方）。
 */
export interface Command {
  do(): void;
  undo(): void;
  readonly description: string; // i18n key
  readonly timestamp: number;
}

/**
 * 新式 GraphCommand——基于 graph-store 的 world 子图快照（before/after）。
 *
 * 由 historyStore 内部通过 projectStore.graphSnapshot() 记录前置/后置状态，
 * 调用方只需提供 doFn（执行实际 mutation），undoFn 由 historyStore 自动通过
 * 替换 world 子图还原。
 *
 * 仅包含 world.region / world.tile 节点与 contains / adjacent_to 边（P1 范围）。
 */
export interface GraphCommand {
  readonly description: string;
  readonly timestamp: number;
  readonly before: GraphSnapshot;
  readonly after: GraphSnapshot;
}

/**
 * 历史栈中的任意 Command 类型（discriminated union）。
 *
 * 通过 `isGraphCommand` 区分调度：GraphCommand 走 replaceGraphSnapshot 路径，
 * 旧 Command 走 do/undo 函数路径。
 */
export type AnyCommand = Command | GraphCommand;

function isGraphCommand(cmd: AnyCommand): cmd is GraphCommand {
  return (cmd as GraphCommand).before !== undefined && (cmd as GraphCommand).after !== undefined;
}

/**
 * 创建 Command 的工厂辅助函数（自动填充 timestamp）。
 *
 * 保留供 useToolActions 现有代码使用——旧式 do/undo 函数对模式。
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
  // ─── graph 实例（响应式入口） ───────────────────────────
  // 延迟初始化以避免循环依赖：historyStore 在第一次 action 调用时才取 projectStore
  // （defineStore 工厂函数内部 useProjectStore 是安全的——两个 store 都属于同一 Pinia 实例）
  const project = useProjectStore();

  // ─── state ────────────────────────────────────────────
  const undoStack = ref<AnyCommand[]>([]);
  const redoStack = ref<AnyCommand[]>([]);

  // ─── getters ──────────────────────────────────────────
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const undoCount = computed(() => undoStack.value.length);
  const redoCount = computed(() => redoStack.value.length);
  /**
   * 最近 20 条历史记录（按时间倒序，用于历史面板展示，对齐 §3.1.6）
   */
  const recentHistory = computed<AnyCommand[]>(() => {
    const items = undoStack.value;
    return items.slice(-20).reverse();
  });

  // ─── actions ──────────────────────────────────────────

  /**
   * 执行旧式 Command——调用 do() 并入栈（与现有 useToolActions 行为一致）。
   *
   * 旧调用方已完成实际 mutation，仅通过此 API 入栈。
   */
  function execute(command: Command): Command {
    command.do();
    push(command);
    return command;
  }

  /**
   * 执行新式 GraphCommand——内部记录 before/after 快照，推入 undoStack。
   *
   * 调用方传入 doFn（执行实际 mutation，如 projectStore.addTile / moveTile 等）；
   * doFn 执行前后由 historyStore 自动调用 projectStore.graphSnapshot() 记录 world 子图状态。
   * undoFn 由 historyStore 内部通过 replaceGraphSnapshot 还原，调用方无需提供。
   *
   * 注意：doFn 应是同步 mutation（或 fire-and-forget 异步）。如 doFn 内部有 await，
   * after 快照可能记录不到最终状态——此类场景应改用 createGraphCommand + 手动 await。
   */
  function executeGraph(description: string, doFn: () => void): GraphCommand {
    const cmd = createGraphCommand(description, doFn);
    push(cmd);
    return cmd;
  }

  /**
   * 创建 GraphCommand（不推入栈）——供调用方需要先组装再 push 的场景使用。
   *
   * 与 executeGraph 的区别：仅创建 Command 对象，不入栈；调用方负责 push。
   */
  function createGraphCommand(description: string, doFn: () => void): GraphCommand {
    const before = project.graphSnapshot();
    doFn();
    const after = project.graphSnapshot();
    return {
      description,
      timestamp: Date.now(),
      before,
      after,
    };
  }

  function push(command: AnyCommand): void {
    const next = [...undoStack.value, command];
    if (next.length > HISTORY_STACK_MAX) {
      next.shift();
    }
    undoStack.value = next;
    redoStack.value = [];
  }

  function undo(): AnyCommand | null {
    const command = undoStack.value[undoStack.value.length - 1];
    if (!command) return null;
    if (isGraphCommand(command)) {
      // GraphCommand：通过 replaceGraphSnapshot 还原 world 子图
      // fire-and-forget async；computed 在下一 tick 响应
      void project.replaceGraphSnapshot(command.before);
    } else {
      // 旧 Command：调用 undo()
      command.undo();
    }
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [...redoStack.value, command];
    return command;
  }

  function redo(): AnyCommand | null {
    const command = redoStack.value[redoStack.value.length - 1];
    if (!command) return null;
    if (isGraphCommand(command)) {
      // GraphCommand：通过 replaceGraphSnapshot 还原 world 子图
      void project.replaceGraphSnapshot(command.after);
    } else {
      // 旧 Command：调用 do()
      command.do();
    }
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
    executeGraph,
    createGraphCommand,
    push,
    undo,
    redo,
    clear,
  };
});
