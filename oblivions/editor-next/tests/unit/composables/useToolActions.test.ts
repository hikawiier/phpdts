//
// useToolActions 单元测试（对齐 NEW_DESIGN.md §7.3 M2：覆盖率 ≥ 75%）
//
// 覆盖点：
//   - select 工具：clickTileSelect / startDragTile / updateDragHover / endDragTile / cancelDrag
//   - draw 工具：clickEmptyDraw / handleEmptyClick
//   - erase 工具：clickTileErase
//   - paint 工具：clickTilePaint
//   - break / restore 工具：两步点击逻辑
//   - batch-select：clickTileBatchToggle / setBatchSelection / selectRect / batchApplyPatch / batchDelete / batchCopyTo
//   - 统一分发：handleTileClick / handleEmptyClick
//   - 撤销/重做：undo / redo（通过代理 historyStore）
//   - Command 封装：每个操作可 undo / redo 还原状态
//
// 边界：
//   - 同 (pgroup, x, y) 唯一性：endDragTile 目标已占用返回 true 但不移动
//   - 工具不匹配时不响应（如 select 工具下 clickTileErase 无效）
//   - endDragTile 未 moved 时仅清空 drag 状态

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useToolActions } from '@/composables/useToolActions';
import { createI18n } from 'vue-i18n';
import zhCN from '@/i18n/zh-CN';

// 注入 i18n（部分 store / composable 通过 useI18n 读取文案）
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  missingWarn: false,
  fallbackWarn: false,
});

describe('useToolActions', () => {
  let project: ReturnType<typeof useProjectStore>;
  let tool: ReturnType<typeof useToolStore>;
  let history: ReturnType<typeof useHistoryStore>;
  let actions: ReturnType<typeof useToolActions>;

  beforeEach(() => {
    setActivePinia(createPinia());
    // 设置 i18n 全局
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    project = useProjectStore();
    tool = useToolStore();
    history = useHistoryStore();
    actions = useToolActions();
    // 准备一个有区域的 project
    project.addRegion('A');
  });

  describe('select 工具', () => {
    it('clickTileSelect 选中格', () => {
      const pls = project.addTile(1, 0, 0);
      actions.clickTileSelect(pls!);
      expect(project.selectedPls).toBe(pls);
    });

    it('clickTileSelect 非 select 工具时不响应', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('erase');
      actions.clickTileSelect(pls!);
      expect(project.selectedPls).toBeNull();
    });

    it('startDragTile 初始化 drag 状态', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      expect(actions.drag.value).not.toBeNull();
      expect(actions.drag.value?.pls).toBe(pls);
      expect(actions.drag.value?.moved).toBe(false);
    });

    it('updateDragHover 更新 hover 坐标并标记 moved', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      actions.updateDragHover(3, 4);
      expect(actions.drag.value?.hoverX).toBe(3);
      expect(actions.drag.value?.hoverY).toBe(4);
      expect(actions.drag.value?.moved).toBe(true);
    });

    it('endDragTile 未 moved 时仅清空 drag 状态', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      const result = actions.endDragTile(null, null);
      expect(result).toBe(true);
      expect(actions.drag.value).toBeNull();
      expect(history.canUndo).toBe(false);
    });

    it('endDragTile 同坐标返回 true 不入栈', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      actions.updateDragHover(0, 0);
      const result = actions.endDragTile(0, 0);
      expect(result).toBe(true);
      expect(history.canUndo).toBe(false);
    });

    it('endDragTile 移动到空白坐标成功并入栈', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      actions.updateDragHover(3, 3);
      const result = actions.endDragTile(3, 3);
      expect(result).toBe(true);
      expect(project.project.tiles[1]![pls!]!.x).toBe(3);
      expect(history.canUndo).toBe(true);
    });

    it('endDragTile 目标已占用返回 true 但不移动', () => {
      const pls1 = project.addTile(1, 0, 0);
      project.addTile(1, 1, 1); // pls2
      tool.setTool('select');
      actions.startDragTile(pls1!);
      actions.updateDragHover(1, 1);
      const result = actions.endDragTile(1, 1);
      expect(result).toBe(true);
      expect(project.project.tiles[1]![pls1!]!.x).toBe(0); // 未移动
      expect(history.canUndo).toBe(false); // 未入栈
    });

    it('cancelDrag 清空 drag 状态', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      actions.cancelDrag();
      expect(actions.drag.value).toBeNull();
    });

    it('undo 还原移动', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      actions.updateDragHover(3, 3);
      actions.endDragTile(3, 3);
      expect(project.project.tiles[1]![pls!]!.x).toBe(3);
      actions.undo();
      expect(project.project.tiles[1]![pls!]!.x).toBe(0);
    });

    it('redo 重放移动', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.startDragTile(pls!);
      actions.updateDragHover(3, 3);
      actions.endDragTile(3, 3);
      actions.undo();
      actions.redo();
      expect(project.project.tiles[1]![pls!]!.x).toBe(3);
    });
  });

  describe('draw 工具', () => {
    beforeEach(() => {
      tool.setTool('draw');
    });

    it('clickEmptyDraw 创建新格并入栈', () => {
      const pls = actions.clickEmptyDraw(0, 0);
      expect(pls).toBe(1);
      expect(project.project.tiles[1]![1]!).toBeDefined();
      expect(history.canUndo).toBe(true);
    });

    it('clickEmptyDraw 自动应用画笔预设', () => {
      tool.updateBrush({ floor: 'water', tide: 'deep' });
      const pls = actions.clickEmptyDraw(0, 0);
      expect(project.project.tiles[1]![pls!]!.floor).toBe('water');
      expect(project.project.tiles[1]![pls!]!.tide).toBe('deep');
    });

    it('clickEmptyDraw 同坐标重复返回 null', () => {
      actions.clickEmptyDraw(0, 0);
      const pls2 = actions.clickEmptyDraw(0, 0);
      expect(pls2).toBeNull();
    });

    it('clickEmptyDraw 非 draw 工具时不响应', () => {
      tool.setTool('select');
      const pls = actions.clickEmptyDraw(0, 0);
      expect(pls).toBeNull();
    });

    it('handleEmptyClick 在 draw 工具下创建格', () => {
      actions.handleEmptyClick(0, 0);
      expect(project.project.tiles[1]![1]!).toBeDefined();
    });

    it('undo 还原 draw', () => {
      actions.clickEmptyDraw(0, 0);
      actions.undo();
      // P1-E：tiles[pgroup] 在无 tile 时为 undefined（projectFromGraph 不创建空字典）
      expect(project.project.tiles[1]?.[1]).toBeUndefined();
    });

    it('redo 重放 draw', () => {
      actions.clickEmptyDraw(0, 0);
      actions.undo();
      actions.redo();
      expect(project.project.tiles[1]![1]!).toBeDefined();
    });
  });

  describe('erase 工具', () => {
    beforeEach(() => {
      tool.setTool('erase');
    });

    it('clickTileErase 删除格并入栈', () => {
      const pls = project.addTile(1, 0, 0);
      actions.clickTileErase(pls!);
      expect(project.project.tiles[1]?.[pls!]).toBeUndefined();
      expect(history.canUndo).toBe(true);
    });

    it('undo 还原 erase', () => {
      const pls = project.addTile(1, 0, 0);
      actions.clickTileErase(pls!);
      actions.undo();
      expect(project.project.tiles[1]![pls!]!).toBeDefined();
    });
  });

  describe('paint 工具', () => {
    beforeEach(() => {
      tool.setTool('paint');
    });

    it('clickTilePaint 应用画笔预设到已有格', () => {
      const pls = project.addTile(1, 0, 0, { floor: 'standard', tide: 'shallow' });
      tool.updateBrush({ floor: 'water', tide: 'deep' });
      actions.clickTilePaint(pls!);
      expect(project.project.tiles[1]![pls!]!.floor).toBe('water');
      expect(project.project.tiles[1]![pls!]!.tide).toBe('deep');
      expect(history.canUndo).toBe(true);
    });

    it('clickTilePaint 不覆盖 name / desc / x / y / neighbors', () => {
      const pls = project.addTile(1, 0, 0);
      project.updateTile(1, pls!, { name: 'N', desc: 'D' });
      tool.updateBrush({ floor: 'water' });
      actions.clickTilePaint(pls!);
      expect(project.project.tiles[1]![pls!]!.name).toBe('N');
      expect(project.project.tiles[1]![pls!]!.desc).toBe('D');
      expect(project.project.tiles[1]![pls!]!.x).toBe(0);
    });

    it('undo 还原 paint', () => {
      const pls = project.addTile(1, 0, 0);
      tool.updateBrush({ floor: 'water' });
      actions.clickTilePaint(pls!);
      actions.undo();
      expect(project.project.tiles[1]![pls!]!.floor).toBe('standard');
    });
  });

  describe('break 工具', () => {
    beforeEach(() => {
      tool.setTool('break');
    });

    it('第一次点击设置 breakFirst', () => {
      const pls1 = project.addTile(1, 0, 0);
      project.addTile(1, 1, 1); // pls2
      actions.clickTileBreak(pls1!);
      expect(tool.breakFirst).toBe(pls1);
    });

    it('第二次点击断开连接并入栈', () => {
      const pls1 = project.addTile(1, 0, 0);
      project.addTile(1, 1, 1); // pls2
      actions.clickTileBreak(pls1!);
      actions.clickTileBreak(2);
      expect(project.project.tiles[1]![pls1!]!.neighbors).not.toContain(2);
      expect(project.project.tiles[1]![pls1!]!._breaks).toContain(2);
      expect(history.canUndo).toBe(true);
    });

    it('再次点击同一格取消（不清空 _breaks，仅取消两步状态）', () => {
      const pls1 = project.addTile(1, 0, 0);
      actions.clickTileBreak(pls1!);
      actions.clickTileBreak(pls1!);
      expect(tool.breakFirst).toBeNull();
    });

    it('undo 还原 break', () => {
      const pls1 = project.addTile(1, 0, 0);
      project.addTile(1, 1, 1); // pls2
      actions.clickTileBreak(pls1!);
      actions.clickTileBreak(2);
      actions.undo();
      expect(project.project.tiles[1]![pls1!]!.neighbors).toContain(2);
      expect(project.project.tiles[1]![pls1!]!._breaks).not.toContain(2);
    });
  });

  describe('restore 工具', () => {
    beforeEach(() => {
      tool.setTool('restore');
    });

    it('第二次点击恢复连接并入栈', () => {
      const pls1 = project.addTile(1, 0, 0);
      project.addTile(1, 1, 1); // pls2
      project.breakTileConnection(1, pls1!, 2);
      actions.clickTileRestore(pls1!);
      actions.clickTileRestore(2);
      expect(project.project.tiles[1]![pls1!]!.neighbors).toContain(2);
      expect(history.canUndo).toBe(true);
    });

    it('再次点击同一格取消', () => {
      const pls1 = project.addTile(1, 0, 0);
      actions.clickTileRestore(pls1!);
      actions.clickTileRestore(pls1!);
      expect(tool.breakFirst).toBeNull();
    });
  });

  describe('batch-select 工具', () => {
    beforeEach(() => {
      tool.setTool('batch-select');
    });

    it('clickTileBatchToggle toggle 加入/移出', () => {
      const pls1 = project.addTile(1, 0, 0);
      const pls2 = project.addTile(1, 1, 1);
      actions.clickTileBatchToggle(pls1!);
      expect(tool.batchSelection).toContain(pls1);
      actions.clickTileBatchToggle(pls2!);
      expect(tool.batchSelection).toContain(pls2);
      actions.clickTileBatchToggle(pls1!);
      expect(tool.batchSelection).not.toContain(pls1);
    });

    it('setBatchSelection 替换', () => {
      actions.setBatchSelection([1, 2, 3]);
      expect(tool.batchSelection).toEqual([1, 2, 3]);
    });

    it('selectRect 框选矩形内所有格', () => {
      project.addTile(1, 0, 0); // pls=1
      project.addTile(1, 1, 1); // pls=2
      project.addTile(1, 5, 5); // pls=3（在框外）
      actions.selectRect(0, 0, 1, 1);
      expect(tool.batchSelection).toContain(1);
      expect(tool.batchSelection).toContain(2);
      expect(tool.batchSelection).not.toContain(3);
    });

    it('batchApplyPatch 批量修改并入栈', () => {
      const pls1 = project.addTile(1, 0, 0, { floor: 'standard' });
      const pls2 = project.addTile(1, 1, 1, { floor: 'standard' });
      tool.setBatchSelection([pls1!, pls2!]);
      actions.batchApplyPatch({ floor: 'water' });
      expect(project.project.tiles[1]![pls1!]!.floor).toBe('water');
      expect(project.project.tiles[1]![pls2!]!.floor).toBe('water');
      expect(history.canUndo).toBe(true);
    });

    it('batchDelete 批量删除并入栈', () => {
      const pls1 = project.addTile(1, 0, 0);
      const pls2 = project.addTile(1, 1, 1);
      tool.setBatchSelection([pls1!, pls2!]);
      actions.batchDelete();
      expect(project.project.tiles[1]?.[pls1!]).toBeUndefined();
      expect(project.project.tiles[1]?.[pls2!]).toBeUndefined();
      expect(history.canUndo).toBe(true);
    });

    it('batchCopyTo 复制到目标 pgroup', () => {
      const pls1 = project.addTile(1, 0, 0, { floor: 'water' });
      project.updateTile(1, pls1!, { name: 'Source' });
      tool.setBatchSelection([pls1!]);
      project.addRegion('B'); // pgroup=2
      project.setCurrentPgroup(1); // 切回源 pgroup，batchCopyTo 从当前 pgroup 读取 batchSelection
      const newPlsList = actions.batchCopyTo(2);
      expect(newPlsList).toHaveLength(1);
      const newTile = project.project.tiles[2]![newPlsList[0]!]!;
      expect(newTile).toBeDefined();
      expect(newTile.floor).toBe('water');
      expect(newTile.name).toBe('Source');
      expect(history.canUndo).toBe(true);
    });

    it('batchCopyTo 同坐标冲突时跳过', () => {
      const pls1 = project.addTile(1, 0, 0);
      tool.setBatchSelection([pls1!]);
      project.addRegion('B'); // pgroup=2
      project.addTile(2, 0, 0); // 占用 (0,0)
      project.setCurrentPgroup(1); // 切回源 pgroup
      const newPlsList = actions.batchCopyTo(2);
      expect(newPlsList).toHaveLength(0);
    });

    it('undo 还原 batchApplyPatch', () => {
      const pls1 = project.addTile(1, 0, 0, { floor: 'standard' });
      tool.setBatchSelection([pls1!]);
      actions.batchApplyPatch({ floor: 'water' });
      actions.undo();
      expect(project.project.tiles[1]![pls1!]!.floor).toBe('standard');
    });

    it('undo 还原 batchDelete', () => {
      const pls1 = project.addTile(1, 0, 0);
      tool.setBatchSelection([pls1!]);
      actions.batchDelete();
      actions.undo();
      expect(project.project.tiles[1]![pls1!]!).toBeDefined();
    });
  });

  describe('统一分发：handleTileClick', () => {
    it('select 工具下点击格 → clickTileSelect', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('select');
      actions.handleTileClick(pls!);
      expect(project.selectedPls).toBe(pls);
    });

    it('erase 工具下点击格 → clickTileErase', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('erase');
      actions.handleTileClick(pls!);
      expect(project.project.tiles[1]?.[pls!]).toBeUndefined();
    });

    it('paint 工具下点击格 → clickTilePaint', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('paint');
      tool.updateBrush({ floor: 'water' });
      actions.handleTileClick(pls!);
      expect(project.project.tiles[1]![pls!]!.floor).toBe('water');
    });

    it('break 工具下点击格 → clickTileBreak', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('break');
      actions.handleTileClick(pls!);
      expect(tool.breakFirst).toBe(pls);
    });

    it('batch-select 工具下点击格 → clickTileBatchToggle', () => {
      const pls = project.addTile(1, 0, 0);
      tool.setTool('batch-select');
      actions.handleTileClick(pls!);
      expect(tool.batchSelection).toContain(pls);
    });

    it('draw 工具下点击已有格 → 选中（不重绘）', () => {
      const pls = project.addTile(1, 0, 0, { floor: 'standard' });
      tool.setTool('draw');
      tool.updateBrush({ floor: 'water' });
      actions.handleTileClick(pls!);
      expect(project.selectedPls).toBe(pls);
      expect(project.project.tiles[1]![pls!]!.floor).toBe('standard'); // 未重绘
    });
  });

  describe('统一分发：handleEmptyClick', () => {
    it('draw 工具下点击空白 → clickEmptyDraw', () => {
      tool.setTool('draw');
      actions.handleEmptyClick(0, 0);
      expect(project.project.tiles[1]![1]!).toBeDefined();
    });

    it('其他工具不响应空白格点击', () => {
      tool.setTool('select');
      actions.handleEmptyClick(0, 0);
      expect(project.project.tiles[1]?.[1]).toBeUndefined();
    });
  });

  describe('setTool / updateBrush / resetBrush', () => {
    it('setTool 代理 toolStore.setTool', () => {
      actions.setTool('draw');
      expect(tool.current).toBe('draw');
    });

    it('updateBrush 代理 toolStore.updateBrush', () => {
      actions.updateBrush({ floor: 'water' });
      expect(tool.brush.floor).toBe('water');
    });

    it('resetBrush 代理 toolStore.resetBrush', () => {
      actions.updateBrush({ floor: 'water' });
      actions.resetBrush();
      expect(tool.brush.floor).toBe('standard');
    });
  });
});
