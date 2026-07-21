//
// toolStore 单元测试（对齐 NEW_DESIGN.md §7.3 M2 验收标准 1：覆盖率 ≥ 85%）
//
// 覆盖点：
//   - state：current / brush / batchSelection / breakFirst
//   - getters：isBatchMode / isBrushActive / batchCount
//   - actions：setTool / updateBrush / resetBrush / setBatchSelection / addToBatchSelection /
//             removeFromBatchSelection / toggleBatchSelection / clearBatchSelection / setBreakFirst
//   - 边界：切换工具清空 breakFirst + batchSelection（除 batch-select）
//   - tide 不含 safe：sanitizeBrush 校验非法 tide 回退为 shallow
//   - DEFAULT_BRUSH / sanitizeBrush 导出
//   - TOOL_SHORTCUTS / TOOL_SHORTCUT_LABELS / EDITOR_TOOL_LIST 常量

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  useToolStore,
  DEFAULT_BRUSH,
  sanitizeBrush,
  EDITOR_TOOL_LIST,
  TOOL_SHORTCUTS,
  TOOL_SHORTCUT_LABELS,
} from '@/stores/toolStore';

describe('toolStore', () => {
  let tool: ReturnType<typeof useToolStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    tool = useToolStore();
  });

  describe('常量导出', () => {
    it('EDITOR_TOOL_LIST 包含 7 个编辑工具（不含 sim-*）', () => {
      expect(EDITOR_TOOL_LIST).toEqual([
        'select',
        'draw',
        'erase',
        'paint',
        'break',
        'restore',
        'batch-select',
      ]);
    });

    it('TOOL_SHORTCUTS 包含 9 个映射（含 sim-player / sim-explore）', () => {
      expect(TOOL_SHORTCUTS.v).toBe('select');
      expect(TOOL_SHORTCUTS.b).toBe('draw');
      expect(TOOL_SHORTCUTS.e).toBe('erase');
      expect(TOOL_SHORTCUTS.f).toBe('paint');
      expect(TOOL_SHORTCUTS.d).toBe('break');
      expect(TOOL_SHORTCUTS.r).toBe('restore');
      expect(TOOL_SHORTCUTS.q).toBe('batch-select');
      expect(TOOL_SHORTCUTS.p).toBe('sim-player');
      expect(TOOL_SHORTCUTS.x).toBe('sim-explore');
    });

    it('TOOL_SHORTCUT_LABELS 反向映射为大写', () => {
      expect(TOOL_SHORTCUT_LABELS.select).toBe('V');
      expect(TOOL_SHORTCUT_LABELS.draw).toBe('B');
      expect(TOOL_SHORTCUT_LABELS['sim-player']).toBe('P');
    });

    it('DEFAULT_BRUSH 字段齐全且合法', () => {
      expect(DEFAULT_BRUSH).toEqual({
        floor: 'standard',
        tide: 'shallow',
        passable: true,
        height: 0,
        destructible: false,
        preset_safe: false,
      });
    });
  });

  describe('sanitizeBrush', () => {
    it('undefined 入参 → 全部默认', () => {
      expect(sanitizeBrush(undefined)).toEqual(DEFAULT_BRUSH);
    });

    it('合法 partial → 合并', () => {
      const result = sanitizeBrush({ floor: 'water', tide: 'deep' });
      expect(result.floor).toBe('water');
      expect(result.tide).toBe('deep');
      expect(result.passable).toBe(true); // 默认
    });

    it('非法 floor → 回退为 standard', () => {
      const result = sanitizeBrush({ floor: 'invalid' as never });
      expect(result.floor).toBe('standard');
    });

    it('非法 tide → 回退为 shallow（不含 safe）', () => {
      const result = sanitizeBrush({ tide: 'safe' as never });
      expect(result.tide).toBe('shallow');
    });

    it('passable 非布尔 → 回退为 true', () => {
      const result = sanitizeBrush({ passable: 'yes' as unknown as boolean });
      expect(result.passable).toBe(true);
    });

    it('height 非数字 → 回退为 0', () => {
      const result = sanitizeBrush({ height: Number.NaN });
      expect(result.height).toBe(0);
    });

    it('destructible 非布尔 → 回退为 false', () => {
      const result = sanitizeBrush({ destructible: 1 as unknown as boolean });
      expect(result.destructible).toBe(false);
    });

    it('preset_safe 非布尔 → 回退为 false', () => {
      const result = sanitizeBrush({ preset_safe: 'true' as unknown as boolean });
      expect(result.preset_safe).toBe(false);
    });
  });

  describe('初始状态', () => {
    it('current 为 select', () => {
      expect(tool.current).toBe('select');
    });

    it('brush 等于 DEFAULT_BRUSH 副本', () => {
      expect(tool.brush).toEqual(DEFAULT_BRUSH);
      expect(tool.brush).not.toBe(DEFAULT_BRUSH); // 不同引用
    });

    it('batchSelection 为空数组', () => {
      expect(tool.batchSelection).toEqual([]);
    });

    it('breakFirst 为 null', () => {
      expect(tool.breakFirst).toBeNull();
    });

    it('isBatchMode 为 false', () => {
      expect(tool.isBatchMode).toBe(false);
    });

    it('isBrushActive 为 false', () => {
      expect(tool.isBrushActive).toBe(false);
    });

    it('batchCount 为 0', () => {
      expect(tool.batchCount).toBe(0);
    });
  });

  describe('setTool', () => {
    it('切换工具', () => {
      tool.setTool('draw');
      expect(tool.current).toBe('draw');
    });

    it('切换到 draw → isBrushActive = true', () => {
      tool.setTool('draw');
      expect(tool.isBrushActive).toBe(true);
    });

    it('切换到 paint → isBrushActive = true', () => {
      tool.setTool('paint');
      expect(tool.isBrushActive).toBe(true);
    });

    it('切换到 batch-select → isBatchMode = true', () => {
      tool.setTool('batch-select');
      expect(tool.isBatchMode).toBe(true);
    });

    it('切换非 batch-select 工具时清空 batchSelection', () => {
      tool.setTool('batch-select');
      tool.addToBatchSelection(1);
      tool.addToBatchSelection(2);
      expect(tool.batchSelection).toHaveLength(2);
      tool.setTool('select');
      expect(tool.batchSelection).toHaveLength(0);
    });

    it('切换到 batch-select 时不清空 batchSelection', () => {
      tool.setTool('batch-select');
      tool.addToBatchSelection(1);
      tool.setTool('batch-select'); // 再次切换到自身
      expect(tool.batchSelection).toHaveLength(1);
    });

    it('切换工具时清空 breakFirst', () => {
      tool.setTool('break');
      tool.setBreakFirst(5);
      expect(tool.breakFirst).toBe(5);
      tool.setTool('restore');
      expect(tool.breakFirst).toBeNull();
    });
  });

  describe('updateBrush', () => {
    it('部分更新合并', () => {
      tool.updateBrush({ floor: 'metal' });
      expect(tool.brush.floor).toBe('metal');
      expect(tool.brush.tide).toBe('shallow'); // 未变
    });

    it('非法值经 sanitizeBrush 校正', () => {
      tool.updateBrush({ tide: 'safe' as never });
      expect(tool.brush.tide).toBe('shallow');
    });
  });

  describe('resetBrush', () => {
    it('重置为 DEFAULT_BRUSH', () => {
      tool.updateBrush({ floor: 'water', tide: 'deep', height: 5 });
      tool.resetBrush();
      expect(tool.brush).toEqual(DEFAULT_BRUSH);
    });
  });

  describe('batchSelection 操作', () => {
    it('setBatchSelection 替换', () => {
      tool.setBatchSelection([1, 2, 3]);
      expect(tool.batchSelection).toEqual([1, 2, 3]);
    });

    it('addToBatchSelection 去重添加', () => {
      tool.addToBatchSelection(1);
      tool.addToBatchSelection(2);
      tool.addToBatchSelection(1); // 重复
      expect(tool.batchSelection).toEqual([1, 2]);
    });

    it('removeFromBatchSelection 移除', () => {
      tool.setBatchSelection([1, 2, 3]);
      tool.removeFromBatchSelection(2);
      expect(tool.batchSelection).toEqual([1, 3]);
    });

    it('toggleBatchSelection 切换', () => {
      tool.toggleBatchSelection(1);
      expect(tool.batchSelection).toEqual([1]);
      tool.toggleBatchSelection(1);
      expect(tool.batchSelection).toEqual([]);
    });

    it('clearBatchSelection 清空', () => {
      tool.setBatchSelection([1, 2, 3]);
      tool.clearBatchSelection();
      expect(tool.batchSelection).toEqual([]);
    });

    it('batchCount getter 同步', () => {
      tool.setBatchSelection([1, 2]);
      expect(tool.batchCount).toBe(2);
      tool.addToBatchSelection(3);
      expect(tool.batchCount).toBe(3);
    });
  });

  describe('setBreakFirst', () => {
    it('设置为指定 pls', () => {
      tool.setBreakFirst(7);
      expect(tool.breakFirst).toBe(7);
    });

    it('清空为 null', () => {
      tool.setBreakFirst(7);
      tool.setBreakFirst(null);
      expect(tool.breakFirst).toBeNull();
    });
  });
});
