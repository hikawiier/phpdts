//
// GridCell 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 空白格渲染：不显示坐标标签（C-8：信息密度精简），无 pls data-attr
//   - 已有格渲染：显示 name（C-8：移除 pls / 坐标文字）
//   - 选中态 class：cell-selected
//   - 入口 / 出口标记 badge
//   - 不可通行纹理标记（C-8：移除 ✕ 文字，改用斜线纹理）
//   - preset_safe 标记 class: cell-safe
//   - 拖拽源：cell-dragging + opacity-50
//   - drop target：cell-drop-target + ring-2
//   - batch 选中：cell-batch-selected
//   - break-first：cell-break-first
//   - floor 形状纹理 class
//   - tide 灰阶亮度 class
//   - 点击事件：emptyClick / click
//   - mousedown 拖拽：dragStart（select 工具下）
//   - mouseenter 拖拽移动：dragMove
//   - mouseup 拖拽结束：dragEnd

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GridCell from '@/components/grid/GridCell.vue';
import type { Tile, Pls } from '@/shared';
import type { DragState } from '@/composables/useToolActions';

function makeTile(overrides: Partial<Tile> = {}): Tile {
  return {
    name: '',
    desc: '',
    floor: 'standard',
    tide: 'shallow',
    height: 0,
    passable: true,
    destructible: false,
    neighbors: [],
    x: 0,
    y: 0,
    preset_safe: false,
    _breaks: [],
    ...overrides,
  };
}

describe('GridCell', () => {
  function mountCell(props: Record<string, unknown>) {
    return mount(GridCell, {
      props: {
        pls: 0 as Pls,
        tile: null,
        x: 0,
        y: 0,
        isSelected: false,
        isEntrance: false,
        isExit: false,
        isInBatch: false,
        isBreakFirst: false,
        tool: 'select' as const,
        dragState: null,
        isDragHover: false,
        isDragSource: false,
        ...props,
      },
    });
  }

  describe('空白格渲染', () => {
    it('不显示坐标标签（C-8：信息密度精简）', () => {
      const wrapper = mountCell({ x: 2, y: 1 });
      // C-8：坐标文字已移除，不再渲染 B2 等坐标标签
      expect(wrapper.text()).not.toContain('B2');
    });

    it('无 pls data 属性', () => {
      const wrapper = mountCell({});
      expect(wrapper.attributes('data-pls')).toBeUndefined();
    });
  });

  describe('已有格渲染', () => {
    it('不显示 pls 编号（C-8：信息密度精简）', () => {
      const wrapper = mountCell({
        pls: 5,
        tile: makeTile({ x: 0, y: 0 }),
      });
      // C-8：pls 编号文字已移除，不再渲染 #5 等 pls 标签
      expect(wrapper.text()).not.toContain('#5');
    });

    it('显示 name（若有）', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ name: 'MyTile' }),
      });
      expect(wrapper.text()).toContain('MyTile');
    });

    it('data-pls 等于 pls', () => {
      const wrapper = mountCell({
        pls: 7,
        tile: makeTile(),
      });
      expect(wrapper.attributes('data-pls')).toBe('7');
    });
  });

  describe('视觉态 class', () => {
    it('选中态添加 cell-selected', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isSelected: true,
      });
      expect(wrapper.classes()).toContain('cell-selected');
    });

    it('入口标记显示"入"', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isEntrance: true,
      });
      expect(wrapper.text()).toContain('入');
      expect(wrapper.classes()).toContain('cell-entrance');
    });

    it('出口标记显示"出"', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isExit: true,
      });
      expect(wrapper.text()).toContain('出');
      expect(wrapper.classes()).toContain('cell-exit');
    });

    it('不可通行使用纹理标记 cell-blocked + cell-blocked-texture（C-8：移除 ✕ 文字）', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ passable: false }),
      });
      // C-8：✕ 文字已移除，改用斜线纹理 class
      expect(wrapper.text()).not.toContain('✕');
      expect(wrapper.classes()).toContain('cell-blocked');
      expect(wrapper.classes()).toContain('cell-blocked-texture');
    });

    it('preset_safe 标记 cell-safe', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ preset_safe: true }),
      });
      expect(wrapper.classes()).toContain('cell-safe');
    });

    it('拖拽源添加 cell-dragging + opacity-50', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isDragSource: true,
      });
      expect(wrapper.classes()).toContain('cell-dragging');
      expect(wrapper.classes()).toContain('opacity-50');
    });

    it('drop target 添加 cell-drop-target + ring-2', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isDragHover: true,
      });
      expect(wrapper.classes()).toContain('cell-drop-target');
      expect(wrapper.classes()).toContain('ring-2');
    });

    it('batch 选中添加 cell-batch-selected + ring-1', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isInBatch: true,
      });
      expect(wrapper.classes()).toContain('cell-batch-selected');
      expect(wrapper.classes()).toContain('ring-1');
    });

    it('break-first 添加 cell-break-first + ring-2 + ring-accent-error', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile(),
        isBreakFirst: true,
      });
      expect(wrapper.classes()).toContain('cell-break-first');
      expect(wrapper.classes()).toContain('ring-2');
      expect(wrapper.classes()).toContain('ring-accent-error');
    });
  });

  describe('floor / tide 形状纹理', () => {
    it('floor=water 添加 floor-water class', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ floor: 'water' }),
      });
      expect(wrapper.classes()).toContain('floor-water');
    });

    it('floor=vegetation 添加 floor-vegetation', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ floor: 'vegetation' }),
      });
      expect(wrapper.classes()).toContain('floor-vegetation');
    });

    it('floor=standard 不添加额外 class', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ floor: 'standard' }),
      });
      expect(wrapper.classes()).not.toContain('floor-standard');
    });

    it('tide=deep 添加 tide-deep', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ tide: 'deep' }),
      });
      expect(wrapper.classes()).toContain('tide-deep');
    });

    it('tide=abyss 添加 tide-abyss', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ tide: 'abyss' }),
      });
      expect(wrapper.classes()).toContain('tide-abyss');
    });

    it('tide=shallow 不添加额外 class', () => {
      const wrapper = mountCell({
        pls: 1,
        tile: makeTile({ tide: 'shallow' }),
      });
      expect(wrapper.classes()).not.toContain('tide-shallow');
    });
  });

  describe('事件触发', () => {
    it('点击空白格触发 emptyClick', async () => {
      const wrapper = mountCell({ tile: null, x: 2, y: 3 });
      await wrapper.trigger('click');
      expect(wrapper.emitted('emptyClick')).toBeTruthy();
      expect(wrapper.emitted('emptyClick')![0]).toEqual([2, 3]);
    });

    it('点击已有格触发 click', async () => {
      const wrapper = mountCell({ pls: 5, tile: makeTile() });
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeTruthy();
      expect(wrapper.emitted('click')![0]).toEqual([5]);
    });

    it('select 工具下 mousedown 触发 dragStart', async () => {
      const wrapper = mountCell({
        pls: 3,
        tile: makeTile(),
        tool: 'select',
      });
      // button=0 是左键
      await wrapper.trigger('mousedown', { button: 0 });
      expect(wrapper.emitted('dragStart')).toBeTruthy();
      expect(wrapper.emitted('dragStart')![0]).toEqual([3]);
    });

    it('非 select 工具下 mousedown 不触发 dragStart', async () => {
      const wrapper = mountCell({
        pls: 3,
        tile: makeTile(),
        tool: 'draw',
      });
      await wrapper.trigger('mousedown', { button: 0 });
      expect(wrapper.emitted('dragStart')).toBeFalsy();
    });

    it('空白格 mousedown 不触发 dragStart', async () => {
      const wrapper = mountCell({
        tile: null,
        tool: 'select',
      });
      await wrapper.trigger('mousedown', { button: 0 });
      expect(wrapper.emitted('dragStart')).toBeFalsy();
    });

    it('右键 mousedown 不触发 dragStart', async () => {
      const wrapper = mountCell({
        pls: 3,
        tile: makeTile(),
        tool: 'select',
      });
      await wrapper.trigger('mousedown', { button: 2 });
      expect(wrapper.emitted('dragStart')).toBeFalsy();
    });

    it('dragState 非 null 时 mouseenter 触发 dragMove', async () => {
      const dragState: DragState = {
        pls: 1,
        originX: 0,
        originY: 0,
        hoverX: null,
        hoverY: null,
        moved: false,
      };
      const wrapper = mountCell({
        pls: 2,
        tile: makeTile(),
        x: 3,
        y: 4,
        dragState,
      });
      await wrapper.trigger('mouseenter');
      expect(wrapper.emitted('dragMove')).toBeTruthy();
      expect(wrapper.emitted('dragMove')![0]).toEqual([3, 4]);
    });

    it('dragState 为 null 时 mouseenter 不触发 dragMove', async () => {
      const wrapper = mountCell({
        pls: 2,
        tile: makeTile(),
        dragState: null,
      });
      await wrapper.trigger('mouseenter');
      expect(wrapper.emitted('dragMove')).toBeFalsy();
    });

    it('dragState 非 null 时 mouseup 触发 dragEnd', async () => {
      const dragState: DragState = {
        pls: 1,
        originX: 0,
        originY: 0,
        hoverX: null,
        hoverY: null,
        moved: false,
      };
      const wrapper = mountCell({
        pls: 2,
        tile: makeTile(),
        x: 5,
        y: 6,
        dragState,
      });
      await wrapper.trigger('mouseup');
      expect(wrapper.emitted('dragEnd')).toBeTruthy();
      expect(wrapper.emitted('dragEnd')![0]).toEqual([5, 6]);
    });
  });
});
