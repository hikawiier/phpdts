//
// useTileSelector 单元测试（对齐 P1 执行案 §4.9.1）
//
// 覆盖点：
//   - state 派生：selectedPls / batchSelection / breakFirst 从 projectStore / toolStore 派生
//   - actions 代理：selectTile / toggleBatch / setBatchSelection / clearBatchSelection / setBreakFirst / clearAll
//   - 派生查询：getSelectedTileIds / isTileSelected / isTileInBatch
//   - 边界：currentPgroup 为 null 时 getSelectedTileIds 返回空数组
//

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import { useTileSelector } from '@/composables/useTileSelector';
import type { Pls } from '@/shared';

describe('useTileSelector', () => {
  let project: ReturnType<typeof useProjectStore>;
  let tool: ReturnType<typeof useToolStore>;
  let selector: ReturnType<typeof useTileSelector>;

  beforeEach(() => {
    setActivePinia(createPinia());
    project = useProjectStore();
    tool = useToolStore();
    selector = useTileSelector();
    // 准备一个有区域的 project（currentPgroup 默认为新增的 pgroup=1）
    project.addRegion('A');
  });

  describe('state 派生', () => {
    it('selectedPls 从 projectStore 派生', () => {
      expect(selector.selectedPls.value).toBeNull();
      project.setSelectedPls(5);
      expect(selector.selectedPls.value).toBe(5);
    });

    it('batchSelection 从 toolStore 派生', () => {
      expect(selector.batchSelection.value).toEqual([]);
      tool.setBatchSelection([1, 2, 3]);
      expect(selector.batchSelection.value).toEqual([1, 2, 3]);
    });

    it('breakFirst 从 toolStore 派生', () => {
      expect(selector.breakFirst.value).toBeNull();
      tool.setBreakFirst(7);
      expect(selector.breakFirst.value).toBe(7);
    });
  });

  describe('actions 代理', () => {
    it('selectTile 设置单选 pls', () => {
      selector.selectTile(5 as Pls);
      expect(project.selectedPls).toBe(5);
      expect(selector.selectedPls.value).toBe(5);
    });

    it('selectTile(null) 清空单选', () => {
      project.setSelectedPls(5);
      selector.selectTile(null);
      expect(project.selectedPls).toBeNull();
    });

    it('toggleBatch 切换批量选择状态', () => {
      selector.toggleBatch(1 as Pls);
      expect(tool.batchSelection).toEqual([1]);
      expect(selector.batchSelection.value).toEqual([1]);
      selector.toggleBatch(2 as Pls);
      expect(tool.batchSelection).toEqual([1, 2]);
      selector.toggleBatch(1 as Pls);
      expect(tool.batchSelection).toEqual([2]);
    });

    it('setBatchSelection 替换批量选择', () => {
      selector.setBatchSelection([1, 2, 3]);
      expect(tool.batchSelection).toEqual([1, 2, 3]);
      selector.setBatchSelection([4, 5]);
      expect(tool.batchSelection).toEqual([4, 5]);
    });

    it('clearBatchSelection 清空批量选择（保留单选与 breakFirst）', () => {
      selector.selectTile(5 as Pls);
      selector.setBatchSelection([1, 2, 3]);
      selector.setBreakFirst(7 as Pls);
      selector.clearBatchSelection();
      expect(tool.batchSelection).toEqual([]);
      expect(project.selectedPls).toBe(5);
      expect(tool.breakFirst).toBe(7);
    });

    it('setBreakFirst 设置两步点击第一步', () => {
      selector.setBreakFirst(7 as Pls);
      expect(tool.breakFirst).toBe(7);
      selector.setBreakFirst(null);
      expect(tool.breakFirst).toBeNull();
    });

    it('clearAll 清空所有选择状态', () => {
      selector.selectTile(5 as Pls);
      selector.setBatchSelection([1, 2, 3]);
      selector.setBreakFirst(7 as Pls);
      selector.clearAll();
      expect(project.selectedPls).toBeNull();
      expect(tool.batchSelection).toEqual([]);
      expect(tool.breakFirst).toBeNull();
    });
  });

  describe('派生查询', () => {
    it('getSelectedTileIds 返回 ${pgroup}:${pls} 格式', () => {
      // currentPgroup=1（addRegion 默认）
      selector.setBatchSelection([1, 2, 3]);
      expect(selector.getSelectedTileIds()).toEqual(['1:1', '1:2', '1:3']);
    });

    it('getSelectedTileIds 批量为空时返回空数组', () => {
      expect(selector.getSelectedTileIds()).toEqual([]);
    });

    it('getSelectedTileIds 在 currentPgroup 为 null 时返回空数组', () => {
      selector.setBatchSelection([1, 2, 3]);
      // 模拟无活跃区域：直接操作 projectStore.currentPgroup
      // 注意：setCurrentPgroup 需要 region 存在；这里通过 deleteRegion 清空
      project.deleteRegion(1);
      // currentPgroup 在 deleteRegion 后被置为 null（无其他 region）
      expect(project.currentPgroup).toBeNull();
      expect(selector.getSelectedTileIds()).toEqual([]);
    });

    it('isTileSelected 判断单选', () => {
      selector.selectTile(5 as Pls);
      expect(selector.isTileSelected(5)).toBe(true);
      expect(selector.isTileSelected(6)).toBe(false);
    });

    it('isTileInBatch 判断批量选择', () => {
      selector.setBatchSelection([1, 2, 3]);
      expect(selector.isTileInBatch(1)).toBe(true);
      expect(selector.isTileInBatch(2)).toBe(true);
      expect(selector.isTileInBatch(4)).toBe(false);
    });

    it('isTileInBatch 批量为空时返回 false', () => {
      expect(selector.isTileInBatch(1)).toBe(false);
    });
  });

  describe('响应式联动', () => {
    it('selectedPls computed 响应 projectStore 变化', () => {
      expect(selector.selectedPls.value).toBeNull();
      project.setSelectedPls(10);
      expect(selector.selectedPls.value).toBe(10);
      project.setSelectedPls(null);
      expect(selector.selectedPls.value).toBeNull();
    });

    it('batchSelection computed 响应 toolStore 变化', () => {
      expect(selector.batchSelection.value).toEqual([]);
      tool.setBatchSelection([1, 2]);
      expect(selector.batchSelection.value).toEqual([1, 2]);
      tool.clearBatchSelection();
      expect(selector.batchSelection.value).toEqual([]);
    });

    it('breakFirst computed 响应 toolStore 变化', () => {
      expect(selector.breakFirst.value).toBeNull();
      tool.setBreakFirst(3);
      expect(selector.breakFirst.value).toBe(3);
      tool.setBreakFirst(null);
      expect(selector.breakFirst.value).toBeNull();
    });

    it('getSelectedTileIds 在切换 pgroup 后反映新 pgroup', () => {
      // 当前 pgroup=1，batch=[1,2]
      selector.setBatchSelection([1, 2]);
      expect(selector.getSelectedTileIds()).toEqual(['1:1', '1:2']);
      // 新增第二个区域 pgroup=2 并切换
      project.addRegion('B');
      project.setCurrentPgroup(2);
      selector.setBatchSelection([5, 6]);
      expect(selector.getSelectedTileIds()).toEqual(['2:5', '2:6']);
    });
  });
});
