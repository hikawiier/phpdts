//
// OverlayTideHeatmap 组件测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 SVG 容器，width / height 根据 cols/rows 计算
//   - 所有 tile 都渲染 tide rect（与 OverlayFog 不同，TideHeatmap 渲染所有 tile）
//   - 三档灰阶亮度 class：tide-shallow / tide-deep / tide-abyss
//   - 三档 fill-opacity 区分：0.35 / 0.45 / 0.55（通过 scoped class 验证）
//   - data-pls / data-tide 属性正确暴露
//   - rect 坐标基于 tile.x / tile.y + header 偏移
//   - 空 tiles 不渲染 rect
//   - aria-hidden=true
//   - 多个 tide 类型混合渲染

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import OverlayTideHeatmap from '@/components/overlays/OverlayTideHeatmap.vue';
import type { Tile, Pls, Tide } from '@/shared';

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

describe('OverlayTideHeatmap', () => {
  const cellWidth = 52;
  const cellHeight = 44;
  const headerWidth = 38;
  const headerHeight = 28;

  function mountTide(
    tiles: Record<Pls, Tile>,
    cols = 4,
    rows = 3,
  ) {
    return mount(OverlayTideHeatmap, {
      props: {
        tiles,
        cols,
        rows,
        cellWidth,
        cellHeight,
        headerWidth,
        headerHeight,
      },
    });
  }

  it('渲染 SVG 容器', () => {
    const wrapper = mountTide({});
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('svg width = headerWidth + cols * cellWidth', () => {
    const wrapper = mountTide({}, 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('width')).toBe(String(headerWidth + 4 * cellWidth));
  });

  it('svg height = headerHeight + rows * cellHeight', () => {
    const wrapper = mountTide({}, 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('height')).toBe(String(headerHeight + 3 * cellHeight));
  });

  it('所有 tile 都渲染 tide rect（与 OverlayFog 不同，TideHeatmap 渲染所有 tile）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1),
      3: makeTile(2, 2),
    };
    const wrapper = mountTide(tiles);
    expect(wrapper.findAll('rect')).toHaveLength(3);
  });

  it('shallow tide 渲染 tide-shallow class', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, { tide: 'shallow' }),
    };
    const wrapper = mountTide(tiles);
    const rect = wrapper.find('rect[data-pls="1"]');
    expect(rect.classes()).toContain('tide-shallow');
    expect(rect.classes()).toContain('tide-rect');
  });

  it('deep tide 渲染 tide-deep class', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, { tide: 'deep' }),
    };
    const wrapper = mountTide(tiles);
    const rect = wrapper.find('rect[data-pls="1"]');
    expect(rect.classes()).toContain('tide-deep');
    expect(rect.classes()).toContain('tide-rect');
  });

  it('abyss tide 渲染 tide-abyss class', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, { tide: 'abyss' }),
    };
    const wrapper = mountTide(tiles);
    const rect = wrapper.find('rect[data-pls="1"]');
    expect(rect.classes()).toContain('tide-abyss');
    expect(rect.classes()).toContain('tide-rect');
  });

  it('多个 tide 类型混合渲染各自的 class', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, { tide: 'shallow' }),
      2: makeTile(1, 0, { tide: 'deep' }),
      3: makeTile(2, 0, { tide: 'abyss' }),
    };
    const wrapper = mountTide(tiles);
    expect(wrapper.findAll('rect.tide-shallow')).toHaveLength(1);
    expect(wrapper.findAll('rect.tide-deep')).toHaveLength(1);
    expect(wrapper.findAll('rect.tide-abyss')).toHaveLength(1);
  });

  it('rect 暴露 data-pls 与 data-tide 属性', () => {
    const tiles: Record<Pls, Tile> = {
      5: makeTile(2, 1, { tide: 'deep' }),
    };
    const wrapper = mountTide(tiles);
    const rect = wrapper.find('rect[data-pls="5"]');
    expect(rect.attributes('data-pls')).toBe('5');
    expect(rect.attributes('data-tide')).toBe('deep');
  });

  it('rect 坐标基于 tile.x / tile.y 与 header 偏移', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(2, 3, { tide: 'shallow' }),
    };
    const wrapper = mountTide(tiles);
    const rect = wrapper.find('rect[data-pls="1"]');
    const expectedX = headerWidth + 2 * cellWidth;
    const expectedY = headerHeight + 3 * cellHeight;
    expect(rect.attributes('x')).toBe(String(expectedX));
    expect(rect.attributes('y')).toBe(String(expectedY));
  });

  it('rect width/height 等于 cellWidth/cellHeight', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const wrapper = mountTide(tiles);
    const rect = wrapper.find('rect[data-pls="1"]');
    expect(rect.attributes('width')).toBe(String(cellWidth));
    expect(rect.attributes('height')).toBe(String(cellHeight));
  });

  it('空 tiles 不渲染任何 rect', () => {
    const wrapper = mountTide({});
    expect(wrapper.findAll('rect')).toHaveLength(0);
  });

  it('aria-hidden=true', () => {
    const wrapper = mountTide({});
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
  });

  it('svg 暴露 overlay-tide-heatmap-layer class', () => {
    const wrapper = mountTide({});
    const svg = wrapper.find('svg');
    expect(svg.classes()).toContain('overlay-tide-heatmap-layer');
  });

  it('每个 rect 都有 tide-rect 基础 class', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, { tide: 'shallow' }),
      2: makeTile(1, 0, { tide: 'deep' }),
      3: makeTile(2, 0, { tide: 'abyss' }),
    };
    const wrapper = mountTide(tiles);
    const rects = wrapper.findAll('rect');
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.classes()).toContain('tide-rect');
    }
  });

  it('key 基于 pls 唯一（vue key 稳定性）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const wrapper = mountTide(tiles);
    const rects = wrapper.findAll('rect');
    // 每个 rect 都对应一个 pls
    const plsSet = new Set(rects.map((r) => r.attributes('data-pls')));
    expect(plsSet.size).toBe(2);
  });

  it('Tide 类型集合覆盖完整三档', () => {
    const tideValues: Tide[] = ['shallow', 'deep', 'abyss'];
    const tiles: Record<Pls, Tile> = {};
    tideValues.forEach((tide, idx) => {
      const pls = (idx + 1) as Pls;
      tiles[pls] = makeTile(idx, 0, { tide });
    });
    const wrapper = mountTide(tiles);
    const rects = wrapper.findAll('rect');
    expect(rects).toHaveLength(3);
    const tideAttrs = rects.map((r) => r.attributes('data-tide'));
    expect(tideAttrs.sort()).toEqual(['abyss', 'deep', 'shallow']);
  });
});
