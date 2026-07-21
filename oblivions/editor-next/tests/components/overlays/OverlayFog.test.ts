//
// OverlayFog 组件测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 SVG 容器，width / height 根据 cols/rows 计算
//   - fog=0 的格渲染 rect（C-10：仅保留半透明遮罩，无 ASCII 字符）
//   - fog=1 的格不渲染（清晰状态）
//   - 未在 Map 中的 pls 不渲染
//   - 不存在的 pls（tile 不存在）被跳过
//   - data-pls / data-fog 属性正确暴露

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import OverlayFog from '@/components/overlays/OverlayFog.vue';
import type { Tile, Pls } from '@/shared';

function makeTile(x: number, y: number, overrides: Partial<Tile> = {}): Tile {
  return {
    name: '',
    desc: '',
    floor: 'standard',
    tide: 'shallow',
    height: 0,
    passable: true,
    destructible: false,
    neighbors: [],
    x,
    y,
    preset_safe: false,
    _breaks: [],
    ...overrides,
  };
}

describe('OverlayFog', () => {
  const cellWidth = 52;
  const cellHeight = 44;
  const headerWidth = 38;
  const headerHeight = 28;

  function mountFog(
    tiles: Record<Pls, Tile>,
    fogData: Map<Pls, 0 | 1>,
    cols = 4,
    rows = 3,
  ) {
    return mount(OverlayFog, {
      props: {
        tiles,
        cols,
        rows,
        cellWidth,
        cellHeight,
        headerWidth,
        headerHeight,
        fogData,
      },
    });
  }

  it('渲染 SVG 容器', () => {
    const wrapper = mountFog({}, new Map());
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('svg width = headerWidth + cols * cellWidth', () => {
    const wrapper = mountFog({}, new Map(), 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('width')).toBe(String(headerWidth + 4 * cellWidth));
  });

  it('svg height = headerHeight + rows * cellHeight', () => {
    const wrapper = mountFog({}, new Map(), 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('height')).toBe(String(headerHeight + 3 * cellHeight));
  });

  it('fog=0 的格渲染 rect（C-10：仅半透明遮罩，无 ASCII 字符）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1),
    };
    const fogData = new Map<Pls, 0 | 1>([[1, 0]]);
    const wrapper = mountFog(tiles, fogData);
    // 应渲染 1 个 rect，无 text（C-10 移除 ASCII 字符，仅保留半透明遮罩）
    expect(wrapper.findAll('rect')).toHaveLength(1);
    expect(wrapper.findAll('text')).toHaveLength(0);
  });

  it('fog=1 的格不渲染（清晰状态）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1),
    };
    const fogData = new Map<Pls, 0 | 1>([
      [1, 1], // fog=1 跳过
      [2, 0], // fog=0 渲染
    ]);
    const wrapper = mountFog(tiles, fogData);
    expect(wrapper.findAll('rect')).toHaveLength(1);
    expect(wrapper.findAll('text')).toHaveLength(0);
  });

  it('多个 fog=0 的格渲染多个 rect', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1),
      3: makeTile(2, 2),
    };
    const fogData = new Map<Pls, 0 | 1>([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const wrapper = mountFog(tiles, fogData);
    expect(wrapper.findAll('rect')).toHaveLength(3);
    expect(wrapper.findAll('text')).toHaveLength(0);
  });

  it('空 fogData 不渲染任何 rect / text', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const wrapper = mountFog(tiles, new Map());
    expect(wrapper.findAll('rect')).toHaveLength(0);
    expect(wrapper.findAll('text')).toHaveLength(0);
  });

  it('不存在的 pls（tile 不存在）被跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const fogData = new Map<Pls, 0 | 1>([
      [1, 0],
      [999, 0], // pls 999 不存在
    ]);
    const wrapper = mountFog(tiles, fogData);
    expect(wrapper.findAll('rect')).toHaveLength(1);
  });

  it('rect 暴露 data-pls 与 data-fog 属性', () => {
    const tiles: Record<Pls, Tile> = {
      5: makeTile(2, 1),
    };
    const fogData = new Map<Pls, 0 | 1>([[5, 0]]);
    const wrapper = mountFog(tiles, fogData);
    const rect = wrapper.find('rect');
    expect(rect.attributes('data-pls')).toBe('5');
    expect(rect.attributes('data-fog')).toBe('0');
  });

  it('不渲染任何 text（C-10：ASCII 字符已移除）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
      3: makeTile(2, 0),
    };
    const fogData = new Map<Pls, 0 | 1>([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const wrapper = mountFog(tiles, fogData);
    expect(wrapper.findAll('text')).toHaveLength(0);
  });

  it('rect 坐标基于 tile.x / tile.y 与 header 偏移', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(2, 3),
    };
    const fogData = new Map<Pls, 0 | 1>([[1, 0]]);
    const wrapper = mountFog(tiles, fogData);
    const rect = wrapper.find('rect');
    const expectedX = headerWidth + 2 * cellWidth;
    const expectedY = headerHeight + 3 * cellHeight;
    expect(rect.attributes('x')).toBe(String(expectedX));
    expect(rect.attributes('y')).toBe(String(expectedY));
  });

  it('aria-hidden=true', () => {
    const wrapper = mountFog({}, new Map());
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
  });
});
