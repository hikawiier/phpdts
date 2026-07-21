//
// reachability 单元测试（对齐 NEW_DESIGN.md §7.3 M4 验收标准：算法覆盖率 ≥ 95%）
//
// 覆盖点：
//   - getDistance：起始即目标 / 起始或目标不存在 / 不可达 / 直接邻居 / 多步路径
//   - calcReachableTiles：movePower=0/1/N / 不可通行格跳过 / 环形去重
//   - 边界：neighbors 为空 / 引用不存在的 pls

import { describe, it, expect } from 'vitest';
import { getDistance, calcReachableTiles } from '@/shared/algorithms/reachability';
import type { Pls, Tile } from '@/shared/types/map';

function makeTile(
  x: number,
  y: number,
  overrides: Partial<Tile> = {},
  neighbors: Pls[] = [],
): Tile {
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
    ...overrides,
  };
}

describe('getDistance', () => {
  it('起始即目标返回 0', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1]),
    };
    expect(getDistance(tiles, 1, 1)).toBe(0);
  });

  it('起始格不存在返回 -1', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    expect(getDistance(tiles, 99, 1)).toBe(-1);
  });

  it('目标格不存在返回 -1', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    expect(getDistance(tiles, 1, 99)).toBe(-1);
  });

  it('直接邻居返回 1', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1]),
    };
    expect(getDistance(tiles, 1, 2)).toBe(1);
  });

  it('多步路径返回最短距离', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1, 3]),
      3: makeTile(2, 0, {}, [2, 4]),
      4: makeTile(3, 0, {}, [3]),
    };
    expect(getDistance(tiles, 1, 4)).toBe(3);
  });

  it('不可达返回 -1', () => {
    // 1 - 2    3 - 4
    // 1 与 3 不连通
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1]),
      3: makeTile(2, 0, {}, [4]),
      4: makeTile(3, 0, {}, [3]),
    };
    expect(getDistance(tiles, 1, 3)).toBe(-1);
  });

  it('只走 passable=true：经过不可通行格返回 -1', () => {
    // 1 - 2(blocked) - 3
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, { passable: false }, [1, 3]),
      3: makeTile(2, 0, {}, [2]),
    };
    expect(getDistance(tiles, 1, 3)).toBe(-1);
  });

  it('BFS 给出最短路径距离（多条路径取最短）', () => {
    // 1 - 2 - 4 (dist=2)
    // 1 - 3 - 4 (dist=2)
    // 1 - 5 - 6 - 4 (dist=3)
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2, 3, 5]),
      2: makeTile(1, 0, {}, [1, 4]),
      3: makeTile(0, 1, {}, [1, 4]),
      4: makeTile(1, 1, {}, [2, 3, 6]),
      5: makeTile(0, 2, {}, [1, 6]),
      6: makeTile(1, 2, {}, [5, 4]),
    };
    expect(getDistance(tiles, 1, 4)).toBe(2);
  });

  it('环形拓扑不死循环', () => {
    // 1 - 2 - 3 - 1
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2, 3]),
      2: makeTile(1, 0, {}, [1, 3]),
      3: makeTile(1, 1, {}, [2, 1]),
    };
    expect(getDistance(tiles, 1, 3)).toBe(1); // 直接邻居
  });

  it('起始或目标为不可通行格仍可计算距离', () => {
    // 起始格不可通行但作为根节点仍可计算
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, { passable: false }, [2]),
      2: makeTile(1, 0, {}, [1]),
    };
    // 后端 obl_get_distance 不检查起始格 passable，只检查路径中间格
    expect(getDistance(tiles, 1, 2)).toBe(1);
  });
});

describe('calcReachableTiles', () => {
  it('起始格不存在返回空 Map', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    const result = calcReachableTiles(tiles, 99, 3);
    expect(result.size).toBe(0);
  });

  it('movePower=0 时只包含起始格', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1]),
    };
    const result = calcReachableTiles(tiles, 1, 0);
    expect(result.size).toBe(1);
    expect(result.get(1)).toBe(0);
  });

  it('movePower=1 时包含起始格 + 直接可达邻居', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2, 3]),
      2: makeTile(1, 0, {}, [1]),
      3: makeTile(0, 1, {}, [1]),
      4: makeTile(2, 0, {}, [2]),
    };
    const result = calcReachableTiles(tiles, 1, 1);
    expect(result.size).toBe(3); // 1, 2, 3
    expect(result.get(1)).toBe(0);
    expect(result.get(2)).toBe(1);
    expect(result.get(3)).toBe(1);
    expect(result.has(4)).toBe(false);
  });

  it('movePower=N 时扩展 N 步', () => {
    // 1 - 2 - 3 - 4
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1, 3]),
      3: makeTile(2, 0, {}, [2, 4]),
      4: makeTile(3, 0, {}, [3]),
    };
    const result = calcReachableTiles(tiles, 1, 2);
    expect(result.size).toBe(3); // 1, 2, 3
    expect(result.has(4)).toBe(false);
  });

  it('只走 passable=true：跳过不可通行格', () => {
    // 1 - 2(blocked) - 3
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, { passable: false }, [1, 3]),
      3: makeTile(2, 0, {}, [2]),
    };
    const result = calcReachableTiles(tiles, 1, 5);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(false); // blocked 格不可达
    expect(result.has(3)).toBe(false); // 经过 2 才能到 3
  });

  it('不可通行格作为分支起点时不被纳入', () => {
    // 1 - 2 - 3(blocked) - 4
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1, 3]),
      3: makeTile(2, 0, { passable: false }, [2, 4]),
      4: makeTile(3, 0, {}, [3]),
    };
    const result = calcReachableTiles(tiles, 1, 5);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(false); // 3 blocked，不可达
    expect(result.has(4)).toBe(false); // 经过 3 才能到 4
  });

  it('环形拓扑不死循环（visited 去重）', () => {
    // 1 - 2 - 3 - 1
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2, 3]),
      2: makeTile(1, 0, {}, [1, 3]),
      3: makeTile(1, 1, {}, [2, 1]),
    };
    const result = calcReachableTiles(tiles, 1, 5);
    expect(result.size).toBe(3);
  });

  it('neighbors 为空时只返回起始格', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, []),
    };
    const result = calcReachableTiles(tiles, 1, 5);
    expect(result.size).toBe(1);
    expect(result.get(1)).toBe(0);
  });

  it('neighbors 引用不存在的 pls 时被跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [99]),
    };
    const result = calcReachableTiles(tiles, 1, 5);
    expect(result.size).toBe(1);
    expect(result.has(99)).toBe(false);
  });

  it('BFS 给出最短距离', () => {
    // 1 - 2 - 4 (dist=2)
    // 1 - 3 - 4 (dist=2)
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2, 3]),
      2: makeTile(1, 0, {}, [1, 4]),
      3: makeTile(0, 1, {}, [1, 4]),
      4: makeTile(1, 1, {}, [2, 3]),
    };
    const result = calcReachableTiles(tiles, 1, 5);
    expect(result.get(4)).toBe(2);
  });
});
