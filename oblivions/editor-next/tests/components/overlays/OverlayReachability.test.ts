//
// OverlayReachability 组件测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 SVG 容器，width / height 根据 cols/rows 计算
//   - 可达格渲染 reach-reachable kind
//   - 不可达格渲染 reach-unreachable kind
//   - 路径线 polyline 在 pathPreview.length >= 2 时渲染
//   - 路径线 polyline 在 pathPreview.length < 2 时不渲染
//   - 路径线坐标基于 tile 坐标 + header 偏移
//   - 路径线 stroke 为灰阶白（C-6：原绿色路径线已下线，对齐 2.15 唯一强调色仅剩 error 红）
//   - 不存在的 pls 被跳过
//   - data-pls / data-reach-dist / data-reach-kind 属性正确暴露

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import OverlayReachability from '@/components/overlays/OverlayReachability.vue';
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

describe('OverlayReachability', () => {
  const cellWidth = 52;
  const cellHeight = 44;
  const headerWidth = 38;
  const headerHeight = 28;

  function mountReach(
    tiles: Record<Pls, Tile>,
    reachabilityDistance: Map<Pls, number>,
    pathPreview: Pls[] = [],
    cols = 4,
    rows = 3,
  ) {
    return mount(OverlayReachability, {
      props: {
        tiles,
        cols,
        rows,
        cellWidth,
        cellHeight,
        headerWidth,
        headerHeight,
        reachabilityDistance,
        pathPreview,
      },
    });
  }

  it('渲染 SVG 容器', () => {
    const wrapper = mountReach({}, new Map());
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('svg width = headerWidth + cols * cellWidth', () => {
    const wrapper = mountReach({}, new Map(), [], 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('width')).toBe(String(headerWidth + 4 * cellWidth));
  });

  it('svg height = headerHeight + rows * cellHeight', () => {
    const wrapper = mountReach({}, new Map(), [], 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('height')).toBe(String(headerHeight + 3 * cellHeight));
  });

  it('可达格渲染 reach-reachable kind', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const reachability = new Map<Pls, number>([
      [1, 0],
      [2, 1],
    ]);
    const wrapper = mountReach(tiles, reachability);
    const reachableRects = wrapper.findAll('rect.reach-reachable');
    expect(reachableRects).toHaveLength(2);
  });

  it('不可达格渲染 reach-unreachable kind', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0), // 可达
      2: makeTile(1, 0), // 不可达
    };
    const reachability = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountReach(tiles, reachability);
    const unreachableRect = wrapper.find('rect[data-pls="2"]');
    expect(unreachableRect).toBeDefined();
    expect(unreachableRect.classes()).toContain('reach-unreachable');
    expect(unreachableRect.attributes('data-reach-kind')).toBe('unreachable');
    expect(unreachableRect.attributes('data-reach-dist')).toBe('-1');
  });

  it('可达格的 data-reach-dist 等于距离', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const reachability = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountReach(tiles, reachability);
    const rect = wrapper.find('rect[data-pls="1"]');
    expect(rect.attributes('data-reach-dist')).toBe('0');
    expect(rect.attributes('data-reach-kind')).toBe('reachable');
  });

  it('路径线 polyline 在 pathPreview.length >= 2 时渲染', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1, 2]);
    const polyline = wrapper.find('polyline');
    expect(polyline.exists()).toBe(true);
  });

  it('路径线 polyline 在 pathPreview.length < 2 时不渲染', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1]);
    expect(wrapper.find('polyline').exists()).toBe(false);
  });

  it('路径线 polyline 在 pathPreview 为空时不渲染', () => {
    const wrapper = mountReach({}, new Map(), []);
    expect(wrapper.find('polyline').exists()).toBe(false);
  });

  it('路径线坐标基于 tile 坐标 + header 偏移', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1, 2]);
    const polyline = wrapper.find('polyline');
    const points = polyline.attributes('points');
    // 第一个点：headerWidth + 0*cellWidth + cellWidth/2, headerHeight + 0*cellHeight + cellHeight/2
    const expectedX1 = headerWidth + 0 * cellWidth + cellWidth / 2;
    const expectedY1 = headerHeight + 0 * cellHeight + cellHeight / 2;
    // 第二个点：headerWidth + 1*cellWidth + cellWidth/2, headerHeight + 0*cellHeight + cellHeight/2
    const expectedX2 = headerWidth + 1 * cellWidth + cellWidth / 2;
    const expectedY2 = headerHeight + 0 * cellHeight + cellHeight / 2;
    expect(points).toBe(`${expectedX1},${expectedY1} ${expectedX2},${expectedY2}`);
  });

  it('路径线 stroke 为灰阶白（C-6：原绿色路径线已下线）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1, 2]);
    const polyline = wrapper.find('polyline');
    const stroke = polyline.attributes('stroke');
    expect(stroke).toContain('gray-100');
  });

  it('路径线暴露 data-path-preview 属性', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1, 2]);
    const polyline = wrapper.find('polyline');
    expect(polyline.attributes('data-path-preview')).toBe('true');
  });

  it('路径线 stroke-width=3', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1, 2]);
    const polyline = wrapper.find('polyline');
    expect(polyline.attributes('stroke-width')).toBe('3');
  });

  it('路径中包含不存在的 pls 时跳过该点', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      // pls 999 不存在
      3: makeTile(2, 0),
    };
    const wrapper = mountReach(tiles, new Map(), [1, 999 as Pls, 3]);
    const polyline = wrapper.find('polyline');
    expect(polyline.exists()).toBe(true);
    const points = polyline.attributes('points');
    // 跳过 999，只有 2 个点
    const parts = (points ?? '').split(' ');
    expect(parts).toHaveLength(2);
  });

  it('aria-hidden=true', () => {
    const wrapper = mountReach({}, new Map());
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
  });

  it('rect 坐标基于 tile.x / tile.y 与 header 偏移', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(2, 3),
    };
    const reachability = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountReach(tiles, reachability);
    const rect = wrapper.find('rect[data-pls="1"]');
    const expectedX = headerWidth + 2 * cellWidth;
    const expectedY = headerHeight + 3 * cellHeight;
    expect(rect.attributes('x')).toBe(String(expectedX));
    expect(rect.attributes('y')).toBe(String(expectedY));
  });
});
