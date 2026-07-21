//
// OverlayVision 组件测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 SVG 容器，width / height 根据 cols/rows 计算
//   - 玩家格（dist=0）渲染 vision-player kind
//   - 视野内（dist ≤ 1）渲染 vision-near kind
//   - 视野边缘（dist > 1）渲染 vision-edge kind
//   - 感知外圈渲染 vision-sense kind
//   - 玩家中心点 circle 渲染（playerPls 非空时）
//   - playerPls 为 null 时不渲染 circle
//   - 不存在的 pls 被跳过
//   - data-pls / data-vision-dist / data-vision-kind 属性正确暴露

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import OverlayVision from '@/components/overlays/OverlayVision.vue';
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

describe('OverlayVision', () => {
  const cellWidth = 52;
  const cellHeight = 44;
  const headerWidth = 38;
  const headerHeight = 28;

  function mountVision(
    tiles: Record<Pls, Tile>,
    visionDistance: Map<Pls, number>,
    enemySenseDistance: Map<Pls, number>,
    playerPls: Pls | null = null,
    cols = 4,
    rows = 3,
  ) {
    return mount(OverlayVision, {
      props: {
        tiles,
        cols,
        rows,
        cellWidth,
        cellHeight,
        headerWidth,
        headerHeight,
        visionDistance,
        enemySenseDistance,
        playerPls,
      },
    });
  }

  it('渲染 SVG 容器', () => {
    const wrapper = mountVision({}, new Map(), new Map());
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('svg width = headerWidth + cols * cellWidth', () => {
    const wrapper = mountVision({}, new Map(), new Map(), null, 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('width')).toBe(String(headerWidth + 4 * cellWidth));
  });

  it('svg height = headerHeight + rows * cellHeight', () => {
    const wrapper = mountVision({}, new Map(), new Map(), null, 4, 3);
    const svg = wrapper.find('svg');
    expect(svg.attributes('height')).toBe(String(headerHeight + 3 * cellHeight));
  });

  it('玩家格（dist=0）渲染 vision-player kind', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const vision = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    const rect = wrapper.find('rect');
    expect(rect.classes()).toContain('vision-player');
    expect(rect.attributes('data-vision-kind')).toBe('player');
    expect(rect.attributes('data-vision-dist')).toBe('0');
  });

  it('视野内（dist=1）渲染 vision-near kind', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const vision = new Map<Pls, number>([
      [1, 0], // 玩家格
      [2, 1], // dist=1 → near
    ]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    const rects = wrapper.findAll('rect');
    expect(rects).toHaveLength(2);
    const nearRect = rects.find((r) => r.attributes('data-pls') === '2');
    expect(nearRect).toBeDefined();
    expect(nearRect!.classes()).toContain('vision-near');
    expect(nearRect!.attributes('data-vision-kind')).toBe('near');
  });

  it('视野边缘（dist > 1）渲染 vision-edge kind', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      3: makeTile(2, 0),
    };
    const vision = new Map<Pls, number>([
      [1, 0], // 玩家
      [3, 2], // dist=2 > 1 → edge
    ]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    const edgeRect = wrapper.find('rect[data-pls="3"]');
    expect(edgeRect.classes()).toContain('vision-edge');
    expect(edgeRect.attributes('data-vision-kind')).toBe('edge');
  });

  it('感知外圈渲染 vision-sense kind', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      5: makeTile(3, 3),
    };
    const vision = new Map<Pls, number>([[1, 0]]); // 只含玩家
    const enemySense = new Map<Pls, number>([
      [1, 0],
      [5, 2], // 在感知范围但不在视野范围
    ]);
    const wrapper = mountVision(tiles, vision, enemySense, 1);
    const senseRect = wrapper.find('rect[data-pls="5"]');
    expect(senseRect).toBeDefined();
    expect(senseRect.classes()).toContain('vision-sense');
    expect(senseRect.attributes('data-vision-kind')).toBe('sense');
  });

  it('感知范围与视野范围重叠时不重复渲染', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 0),
    };
    const vision = new Map<Pls, number>([
      [1, 0],
      [2, 1],
    ]);
    const enemySense = new Map<Pls, number>([
      [1, 0],
      [2, 1], // 与视野重叠
    ]);
    const wrapper = mountVision(tiles, vision, enemySense, 1);
    const rects = wrapper.findAll('rect');
    // 只渲染 2 个（重叠的不重复）
    expect(rects).toHaveLength(2);
  });

  it('玩家中心点 circle 在 playerPls 非空时渲染', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const vision = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    const circle = wrapper.find('circle');
    expect(circle.exists()).toBe(true);
    expect(circle.classes()).toContain('vision-player-dot');
  });

  it('playerPls 为 null 时不渲染 circle', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const vision = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountVision(tiles, vision, new Map(), null);
    expect(wrapper.find('circle').exists()).toBe(false);
  });

  it('不存在的 pls 被跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const vision = new Map<Pls, number>([
      [1, 0],
      [999, 1], // pls 999 不存在
    ]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    expect(wrapper.findAll('rect')).toHaveLength(1);
  });

  it('空 vision + 空 enemySense 不渲染 rect', () => {
    const wrapper = mountVision({}, new Map(), new Map());
    expect(wrapper.findAll('rect')).toHaveLength(0);
  });

  it('aria-hidden=true', () => {
    const wrapper = mountVision({}, new Map(), new Map());
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
  });

  it('rect 坐标基于 tile.x / tile.y 与 header 偏移', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(2, 3),
    };
    const vision = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    const rect = wrapper.find('rect');
    const expectedX = headerWidth + 2 * cellWidth;
    const expectedY = headerHeight + 3 * cellHeight;
    expect(rect.attributes('x')).toBe(String(expectedX));
    expect(rect.attributes('y')).toBe(String(expectedY));
  });

  it('circle 坐标在玩家格中心', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(2, 3),
    };
    const vision = new Map<Pls, number>([[1, 0]]);
    const wrapper = mountVision(tiles, vision, new Map(), 1);
    const circle = wrapper.find('circle');
    const expectedCx = headerWidth + 2 * cellWidth + cellWidth / 2;
    const expectedCy = headerHeight + 3 * cellHeight + cellHeight / 2;
    expect(circle.attributes('cx')).toBe(String(expectedCx));
    expect(circle.attributes('cy')).toBe(String(expectedCy));
  });

  it('playerPls 指向不存在的 tile 时不渲染 circle', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const vision = new Map<Pls, number>([[1, 0]]);
    // playerPls=999 不存在于 tiles
    const wrapper = mountVision(tiles, vision, new Map(), 999 as Pls);
    expect(wrapper.find('circle').exists()).toBe(false);
  });
});
