//
// historyStore 单元测试（对齐 NEW_DESIGN.md §7.3 M2 验收标准 1：覆盖率 ≥ 85%）
//
// 覆盖点：
//   - state：undoStack / redoStack 初始为空
//   - getters：canUndo / canRedo / undoCount / redoCount / recentHistory
//   - actions：execute / push / undo / redo / clear
//   - 边界：undo / redo 在空栈时返回 null
//   - 上限：HISTORY_STACK_MAX=100，超出丢弃最旧
//   - 切换 pgroup 不清空历史栈（由 store 不暴露 setCurrentPgroup 保证，本测试验证 history 自身不被外部清空）

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useHistoryStore, createCommand, type Command } from '@/stores/historyStore';
import { HISTORY_STACK_MAX } from '@/shared';

describe('historyStore', () => {
  let history: ReturnType<typeof useHistoryStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    history = useHistoryStore();
  });

  function makeCmd(desc: string, doFn?: () => void, undoFn?: () => void): Command {
    return createCommand(
      desc,
      doFn ?? (() => {}),
      undoFn ?? (() => {}),
    );
  }

  describe('初始状态', () => {
    it('undoStack / redoStack 为空', () => {
      expect(history.undoStack).toHaveLength(0);
      expect(history.redoStack).toHaveLength(0);
    });

    it('canUndo / canRedo 为 false', () => {
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
    });

    it('undoCount / redoCount 为 0', () => {
      expect(history.undoCount).toBe(0);
      expect(history.redoCount).toBe(0);
    });

    it('recentHistory 为空数组', () => {
      expect(history.recentHistory).toEqual([]);
    });
  });

  describe('createCommand 工厂', () => {
    it('自动填充 timestamp', () => {
      const before = Date.now();
      const cmd = makeCmd('test');
      const after = Date.now();
      expect(cmd.description).toBe('test');
      expect(cmd.timestamp).toBeGreaterThanOrEqual(before);
      expect(cmd.timestamp).toBeLessThanOrEqual(after);
    });

    it('do / undo 函数被保留', () => {
      let counter = 0;
      const cmd = createCommand(
        'test',
        () => {
          counter += 1;
        },
        () => {
          counter -= 1;
        },
      );
      cmd.do();
      expect(counter).toBe(1);
      cmd.undo();
      expect(counter).toBe(0);
    });
  });

  describe('push', () => {
    it('入栈 undoStack 且清空 redoStack', () => {
      const cmd = makeCmd('a');
      history.push(cmd);
      expect(history.undoStack).toHaveLength(1);
      expect(history.redoStack).toHaveLength(0);
      expect(history.canUndo).toBe(true);
    });

    it('多次 push 顺序入栈', () => {
      history.push(makeCmd('a'));
      history.push(makeCmd('b'));
      history.push(makeCmd('c'));
      expect(history.undoStack).toHaveLength(3);
      expect(history.undoStack[0]?.description).toBe('a');
      expect(history.undoStack[2]?.description).toBe('c');
    });

    it('push 后清空 redoStack（新操作抹除重做路径）', () => {
      history.push(makeCmd('a'));
      history.undo(); // 移到 redoStack
      expect(history.redoStack).toHaveLength(1);
      history.push(makeCmd('b'));
      expect(history.redoStack).toHaveLength(0);
    });

    it(`上限 ${HISTORY_STACK_MAX}：超出丢弃最旧`, () => {
      for (let i = 0; i < HISTORY_STACK_MAX + 10; i++) {
        history.push(makeCmd(`cmd-${i}`));
      }
      expect(history.undoStack).toHaveLength(HISTORY_STACK_MAX);
      // 最旧的 cmd-0..cmd-9 被丢弃，最旧为 cmd-10
      expect(history.undoStack[0]?.description).toBe(`cmd-${10}`);
    });
  });

  describe('execute', () => {
    it('调用 do() 并入栈', () => {
      let called = 0;
      const cmd = createCommand(
        'test',
        () => {
          called += 1;
        },
        () => {},
      );
      const returned = history.execute(cmd);
      expect(called).toBe(1);
      expect(history.undoStack).toHaveLength(1);
      expect(returned).toBe(cmd);
    });
  });

  describe('undo', () => {
    it('空栈返回 null', () => {
      const result = history.undo();
      expect(result).toBeNull();
    });

    it('调用 undo() 并将命令移到 redoStack', () => {
      let counter = 0;
      const cmd = createCommand(
        'test',
        () => {
          counter += 1;
        },
        () => {
          counter -= 1;
        },
      );
      history.push(cmd);
      const result = history.undo();
      expect(result).toStrictEqual(cmd);
      expect(counter).toBe(-1);
      expect(history.undoStack).toHaveLength(0);
      expect(history.redoStack).toHaveLength(1);
      expect(history.canRedo).toBe(true);
      expect(history.canUndo).toBe(false);
    });

    it('多次 undo 按 LIFO 顺序', () => {
      const order: string[] = [];
      history.push(
        createCommand(
          'a',
          () => {
            order.push('do-a');
          },
          () => {
            order.push('undo-a');
          },
        ),
      );
      history.push(
        createCommand(
          'b',
          () => {
            order.push('do-b');
          },
          () => {
            order.push('undo-b');
          },
        ),
      );
      history.undo();
      history.undo();
      expect(order).toEqual(['undo-b', 'undo-a']);
    });
  });

  describe('redo', () => {
    it('空栈返回 null', () => {
      const result = history.redo();
      expect(result).toBeNull();
    });

    it('调用 do() 并将命令移回 undoStack', () => {
      let counter = 0;
      const cmd = createCommand(
        'test',
        () => {
          counter += 1;
        },
        () => {
          counter -= 1;
        },
      );
      history.push(cmd);
      history.undo();
      expect(counter).toBe(-1);
      const result = history.redo();
      expect(result).toStrictEqual(cmd);
      expect(counter).toBe(0);
      expect(history.undoStack).toHaveLength(1);
      expect(history.redoStack).toHaveLength(0);
    });

    it('多次 redo 按 FIFO 顺序（与 undo 入栈顺序一致）', () => {
      const order: string[] = [];
      history.push(
        createCommand(
          'a',
          () => {
            order.push('do-a');
          },
          () => {},
        ),
      );
      history.push(
        createCommand(
          'b',
          () => {
            order.push('do-b');
          },
          () => {},
        ),
      );
      history.undo();
      history.undo();
      order.length = 0;
      history.redo();
      history.redo();
      expect(order).toEqual(['do-a', 'do-b']);
    });
  });

  describe('clear', () => {
    it('清空 undoStack / redoStack', () => {
      history.push(makeCmd('a'));
      history.push(makeCmd('b'));
      history.undo();
      expect(history.undoStack.length + history.redoStack.length).toBe(2);
      history.clear();
      expect(history.undoStack).toHaveLength(0);
      expect(history.redoStack).toHaveLength(0);
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
    });
  });

  describe('recentHistory getter', () => {
    it('返回最近 20 条按倒序', () => {
      for (let i = 0; i < 25; i++) {
        history.push(makeCmd(`cmd-${i}`));
      }
      const recent = history.recentHistory;
      expect(recent).toHaveLength(20);
      // 倒序：最近一条在最前
      expect(recent[0]?.description).toBe('cmd-24');
      expect(recent[19]?.description).toBe('cmd-5');
    });

    it('不足 20 条时全部返回', () => {
      history.push(makeCmd('a'));
      history.push(makeCmd('b'));
      const recent = history.recentHistory;
      expect(recent).toHaveLength(2);
      expect(recent[0]?.description).toBe('b');
    });
  });

  describe('边界：切换 pgroup 不清空历史栈', () => {
    it('historyStore 自身无 setCurrentPgroup action，不会被外部清空', () => {
      history.push(makeCmd('a'));
      // 模拟切换 pgroup 不影响 history
      expect(history.undoStack).toHaveLength(1);
      // historyStore 没有 clear 在切换场景被调用的契约
      expect(typeof (history as unknown as { setCurrentPgroup?: unknown }).setCurrentPgroup).toBe(
        'undefined',
      );
    });
  });
});
