//
// useEditorKeyboard：统一键盘层（对齐 NEW_DESIGN.md §3.1 + §2.4.3 + DESIGN.md 2.14）
//
// 研判：
//   - 键盘快捷键是 O-0 框架的交互基础
//   - 与 useToolActions 配合：快捷键调用 useToolActions.setTool / undo / redo
//   - 与 uiStore 配合：modal 打开时只响应 modal 层
//   - 优先级：Modal > Tool > Panel > Map（对齐 §2.4.3）
//
// 快捷键映射（对齐 §3.1.4）：
//   V → select       B → draw         E → erase        F → paint
//   D → break        R → restore      Q → batch-select
//   P → sim-player   X → sim-explore  （由 O-1 实现，此处仅占位路由）
//   Ctrl+Z → undo    Ctrl+Y / Ctrl+Shift+Z → redo
//
// 输入框聚焦时不响应工具快捷键（与 Vanilla JS tools.js initToolShortcuts 一致）

import { onMounted, onBeforeUnmount } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { useToolStore, TOOL_SHORTCUTS } from '@/stores/toolStore';
import { useHistoryStore } from '@/stores/historyStore';
import type { ToolId } from '@/stores/toolStore';

export interface KeyboardContext {
  readonly name: 'modal' | 'tool' | 'panel' | 'map';
  readonly isActive: () => boolean;
  readonly handle: (event: KeyboardEvent) => boolean; // 返回 true 表示已消费
}

const PRIORITY_ORDER: ReadonlyArray<KeyboardContext['name']> = ['modal', 'tool', 'panel', 'map'];

/**
 * 判断事件是否发生在输入元素中（输入框聚焦时不响应工具快捷键）
 */
function isInputTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useEditorKeyboard() {
  const ui = useUiStore();
  const tool = useToolStore();
  const history = useHistoryStore();
  const contexts: KeyboardContext[] = [];

  function register(context: KeyboardContext): () => void {
    contexts.push(context);
    return () => {
      const index = contexts.indexOf(context);
      if (index >= 0) contexts.splice(index, 1);
    };
  }

  /**
   * 工具层快捷键处理：V/B/E/F/D/R/Q/P/X + Ctrl+Z/Y/Shift+Z
   *
   * @returns true 表示已消费
   */
  function handleToolKeydown(event: KeyboardEvent): boolean {
    // Modal 打开时不响应工具快捷键
    const hasOpenModal =
      ui.confirmDialog.open || Object.values(ui.modals).some((value) => value);
    if (hasOpenModal) return false;

    // 输入框聚焦时不响应工具快捷键（Ctrl+Z 除外，允许在输入框内撤销）
    const isInput = isInputTarget(event);

    // 撤销 / 重做（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）
    if (event.ctrlKey || event.metaKey) {
      if (isInput) return false; // 输入框内系统级撤销优先
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        const cmd = history.undo();
        if (cmd !== null) {
          ui.showToast(`撤销：${cmd.description}`, 'info');
          return true;
        }
        ui.showToast('message.undoEmpty', 'info');
        return true;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        const cmd = history.redo();
        if (cmd !== null) {
          ui.showToast(`重做：${cmd.description}`, 'info');
          return true;
        }
        ui.showToast('message.redoEmpty', 'info');
        return true;
      }
      return false;
    }

    if (isInput) return false;

    const key = event.key.toLowerCase();
    const toolId = TOOL_SHORTCUTS[key];
    if (!toolId) return false;

    // sim-player / sim-explore 由 O-1 视图独立处理（M4 实现）
    if (toolId === 'sim-player' || toolId === 'sim-explore') {
      return false;
    }

    tool.setTool(toolId as ToolId);
    return true;
  }

  function handleKeydown(event: KeyboardEvent): void {
    // Modal 打开时只响应 modal 层 + ESC（由 modal 层自行处理）
    const hasOpenModal =
      ui.confirmDialog.open || Object.values(ui.modals).some((value) => value);

    // 按优先级遍历注册的 contexts
    for (const name of PRIORITY_ORDER) {
      if (hasOpenModal && name !== 'modal') continue;
      const ctx = contexts.find((c) => c.name === name);
      if (!ctx) continue;
      if (!ctx.isActive()) continue;
      if (ctx.handle(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    // 没有注册的 context 处理时，工具层兜底（保证快捷键在 MapEditorView 直接可用）
    if (!hasOpenModal) {
      if (handleToolKeydown(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeydown, { capture: true });
    }
  });

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleKeydown, { capture: true });
    }
  });

  return {
    register,
    handleToolKeydown,
  };
}
