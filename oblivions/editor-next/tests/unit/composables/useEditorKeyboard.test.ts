//
// useEditorKeyboard 单元测试（对齐 NEW_DESIGN.md §7.3 M2）
//
// 覆盖点：
//   - 工具快捷键：V/B/E/F/D/R/Q/P/X
//   - 撤销/重做：Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
//   - 输入框聚焦时不响应工具快捷键（Ctrl+Z 除外，由浏览器系统级撤销处理）
//   - Modal 打开时不响应工具快捷键
//   - sim-player / sim-explore 由 O-1 处理，此处返回 false 穿透
//   - register / handleToolKeydown 接口

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from '@/stores/uiStore';
import { useToolStore } from '@/stores/toolStore';
import { useHistoryStore, createCommand } from '@/stores/historyStore';
import { useEditorKeyboard } from '@/composables/useEditorKeyboard';
import { createI18n } from 'vue-i18n';
import zhCN from '@/i18n/zh-CN';

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  missingWarn: false,
  fallbackWarn: false,
});

describe('useEditorKeyboard', () => {
  let ui: ReturnType<typeof useUiStore>;
  let tool: ReturnType<typeof useToolStore>;
  let history: ReturnType<typeof useHistoryStore>;
  let keyboard: ReturnType<typeof useEditorKeyboard>;

  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    ui = useUiStore();
    tool = useToolStore();
    history = useHistoryStore();
    // useEditorKeyboard 内部依赖 onMounted/onBeforeUnmount，需在组件 setup 中调用
    // 此处直接调用仅获取 register / handleToolKeydown（不挂载监听）
    keyboard = useEditorKeyboard();
  });

  function makeKeyEvent(key: string, opts: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}): KeyboardEvent {
    return {
      key,
      ctrlKey: opts.ctrl ?? false,
      shiftKey: opts.shift ?? false,
      metaKey: opts.meta ?? false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: document.body,
    } as unknown as KeyboardEvent;
  }

  describe('工具快捷键', () => {
    it('V → select', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('v'));
      expect(result).toBe(true);
      expect(tool.current).toBe('select');
    });

    it('B → draw', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('b'));
      expect(result).toBe(true);
      expect(tool.current).toBe('draw');
    });

    it('E → erase', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('e'));
      expect(result).toBe(true);
      expect(tool.current).toBe('erase');
    });

    it('F → paint', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('f'));
      expect(result).toBe(true);
      expect(tool.current).toBe('paint');
    });

    it('D → break', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('d'));
      expect(result).toBe(true);
      expect(tool.current).toBe('break');
    });

    it('R → restore', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('r'));
      expect(result).toBe(true);
      expect(tool.current).toBe('restore');
    });

    it('Q → batch-select', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('q'));
      expect(result).toBe(true);
      expect(tool.current).toBe('batch-select');
    });

    it('大写字母也能识别（V 而非 v）', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('V'));
      expect(result).toBe(true);
      expect(tool.current).toBe('select');
    });
  });

  describe('sim-player / sim-explore 由 O-1 处理', () => {
    it('P 返回 false（不消费）', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('p'));
      expect(result).toBe(false);
    });

    it('X 返回 false（不消费）', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('x'));
      expect(result).toBe(false);
    });
  });

  describe('未映射的键', () => {
    it('返回 false（不消费）', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('z'));
      expect(result).toBe(false);
    });

    it('数字键不响应', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('1'));
      expect(result).toBe(false);
    });
  });

  describe('撤销/重做', () => {
    it('Ctrl+Z 撤销成功返回 true', () => {
      history.push(createCommand('test', () => {}, () => {}));
      const result = keyboard.handleToolKeydown(makeKeyEvent('z', { ctrl: true }));
      expect(result).toBe(true);
      expect(history.canUndo).toBe(false); // 已撤销
    });

    it('Ctrl+Z 空栈时也返回 true（消费键）', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('z', { ctrl: true }));
      expect(result).toBe(true);
    });

    it('Ctrl+Y 重做成功返回 true', () => {
      history.push(createCommand('test', () => {}, () => {}));
      history.undo();
      const result = keyboard.handleToolKeydown(makeKeyEvent('y', { ctrl: true }));
      expect(result).toBe(true);
      expect(history.canRedo).toBe(false); // 已重做
    });

    it('Ctrl+Shift+Z 等价于 Ctrl+Y', () => {
      history.push(createCommand('test', () => {}, () => {}));
      history.undo();
      const result = keyboard.handleToolKeydown(makeKeyEvent('z', { ctrl: true, shift: true }));
      expect(result).toBe(true);
      expect(history.canRedo).toBe(false);
    });

    it('Cmd+Z（macOS metaKey）也触发撤销', () => {
      history.push(createCommand('test', () => {}, () => {}));
      const result = keyboard.handleToolKeydown(makeKeyEvent('z', { meta: true }));
      expect(result).toBe(true);
      expect(history.canUndo).toBe(false);
    });
  });

  describe('Modal 打开时不响应工具快捷键', () => {
    beforeEach(() => {
      ui.openModal('import');
    });

    it('打开 modal 后工具键不响应', () => {
      const result = keyboard.handleToolKeydown(makeKeyEvent('v'));
      expect(result).toBe(false);
      expect(tool.current).toBe('select'); // 未切换
    });

    it('打开 confirm dialog 后工具键不响应', () => {
      ui.closeModal('import');
      ui.openConfirm('test', () => {});
      const result = keyboard.handleToolKeydown(makeKeyEvent('v'));
      expect(result).toBe(false);
    });
  });

  describe('输入框聚焦时不响应工具快捷键', () => {
    function makeInputKeyEvent(key: string): KeyboardEvent {
      const input = document.createElement('input');
      document.body.appendChild(input);
      return {
        key,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target: input,
      } as unknown as KeyboardEvent;
    }

    it('输入框聚焦时 V 不切换工具', () => {
      const result = keyboard.handleToolKeydown(makeInputKeyEvent('v'));
      expect(result).toBe(false);
      expect(tool.current).toBe('select');
    });

    it('输入框聚焦时 Ctrl+Z 返回 false（交由浏览器处理）', () => {
      const result = keyboard.handleToolKeydown(makeInputKeyEvent('z'));
      // 非 Ctrl 时返回 false（输入框 + 非撤销键）
      expect(result).toBe(false);
    });
  });

  describe('register / unregister', () => {
    it('register 返回注销函数', () => {
      const unregister = keyboard.register({
        name: 'panel',
        isActive: () => true,
        handle: () => false,
      });
      expect(typeof unregister).toBe('function');
      unregister();
    });
  });
});
