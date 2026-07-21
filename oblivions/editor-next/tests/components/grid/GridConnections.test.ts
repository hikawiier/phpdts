//
// GridConnections 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 SVG 容器，width / height 根据 cols/rows 计算
//   - 连通线去重：A↔B 只画一次
//   - 多组连通对应多条 line
//   - 无连通时不渲染 line
//   - 不存在的 neighbor pls 被跳过

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GridConnections from '@/components/grid/GridConnections.vue';
import type { Tile, Pls } from '@/shared';

function makeTile(x: number, y: number, neighbors: Pls[] = []): Tile {
  return {
    name: '',
    desc: '',
    floor: 'standard',
    tide: 'shallow',
    height: 0,
    passable: true,
    destructible: false,
    neighbors,
    x,
    y,
    preset_safe: false,
    _breaks: [],
  };
}

describe('GridConnections', () => {
  const cellWidth = 52;
  const cellHeight = 44;
  const headerWidth = 38;
  const headerHeight = 28;

  function mountConnections(
    tiles: Record<Pls, Tile>,
    cols = 4,
    rows = 3,
    visible = true,
  ) {
    return mount(GridConnections, {
      props: {
        tiles,
        cols,
        rows,
        cellWidth,
        cellHeight,
        headerWidth,
        headerHeight,
        visible,
      },
    });
  }

  it('渲染 SVG 容器', () => {
    const wrapper = mountConnections({});
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('visible=false 时不渲染 SVG（C-9：仅 break/restore 工具下显示）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    const wrapper = mountConnections(tiles, 4, 3, false);
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.findAll('line')).toHaveLength(0);
  });

  it('svg width = headerWidth + cols * cellWidth', () => {
    const wrapper = mountConnections({}, 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('width')).toBe(String(headerWidth + 4 * cellWidth));
  });

  it('svg height = headerHeight + rows * cellHeight', () => {
    const wrapper = mountConnections({}, 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('height')).toBe(String(headerHeight + 3 * cellHeight));
  });

  it('无连通时不渲染 line', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1),
    };
    const wrapper = mountConnections(tiles);
    expect(wrapper.findAll('line')).toHaveLength(0);
  });

  it('双向连通去重：A.neighbors=[2] + B.neighbors=[1] 只画 1 条 line', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    const wrapper = mountConnections(tiles);
    expect(wrapper.findAll('line')).toHaveLength(1);
  });

  it('多组连通渲染多条 line', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2, 3]),
      2: makeTile(1, 1, [1]),
      3: makeTile(2, 2, [1]),
    };
    const wrapper = mountConnections(tiles);
    expect(wrapper.findAll('line')).toHaveLength(2);
  });

  it('单向连通也渲染（仅 A.neighbors 含 B，无 B 反指）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1),
    };
    const wrapper = mountConnections(tiles);
    expect(wrapper.findAll('line')).toHaveLength(1);
  });

  it('neighbor pls 不存在时跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [99]), // 99 不存在
    };
    const wrapper = mountConnections(tiles);
    expect(wrapper.findAll('line')).toHaveLength(0);
  });

  it('line 坐标计算正确', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    const wrapper = mountConnections(tiles);
    const line = wrapper.find('line');
    // (0,0) 中心：headerWidth + 0*cellWidth + cellWidth/2, headerHeight + 0*cellHeight + cellHeight/2
    const x1Expected = headerWidth + 0 * cellWidth + cellWidth / 2;
    const y1Expected = headerHeight + 0 * cellHeight + cellHeight / 2;
    const x2Expected = headerWidth + 1 * cellWidth + cellWidth / 2;
    const y2Expected = headerHeight + 1 * cellHeight + cellHeight / 2;
    expect(line.attributes('x1')).toBe(String(x1Expected));
    expect(line.attributes('y1')).toBe(String(y1Expected));
    expect(line.attributes('x2')).toBe(String(x2Expected));
    expect(line.attributes('y2')).toBe(String(y2Expected));
  });

  it('line stroke 为灰色，opacity 0.6', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    const wrapper = mountConnections(tiles);
    const line = wrapper.find('line');
    expect(line.attributes('stroke')).toBe('var(--color-gray-500)');
    expect(line.attributes('opacity')).toBe('0.6');
  });
});
