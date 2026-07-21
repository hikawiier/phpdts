//
// shortest-path 单元测试（对齐 NEW_DESIGN.md §7.3 M4 验收标准：算法覆盖率 ≥ 95%）
//
// 覆盖点：
//   - findShortestPath：起始即目标 / 起始或目标不存在 / 不可达 / 直接邻居 / 多步路径
//   - 路径回溯：含起点和终点 / 顺序正确
//   - 边界：只走 passable=true / 环形去重 / neighbors 为空

import { describe, it, expect } from 'vitest';
import { findShortestPath } from '@/shared/algorithms/shortest-path';
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

describe('findShortestPath', () => {
  describe('基础场景', () => {
    it('起始即目标返回 distance=0, path=[from]', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1]),
      };
      const result = findShortestPath(tiles, 1, 1);
      expect(result.distance).toBe(0);
      expect(result.path).toEqual([1]);
    });

    it('起始格不存在返回 distance=-1, path=[]', () => {
      const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
      const result = findShortestPath(tiles, 99, 1);
      expect(result.distance).toBe(-1);
      expect(result.path).toEqual([]);
    });

    it('目标格不存在返回 distance=-1, path=[]', () => {
      const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
      const result = findShortestPath(tiles, 1, 99);
      expect(result.distance).toBe(-1);
      expect(result.path).toEqual([]);
    });

    it('直接邻居路径含起点和终点', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1]),
      };
      const result = findShortestPath(tiles, 1, 2);
      expect(result.distance).toBe(1);
      expect(result.path).toEqual([1, 2]);
    });

    it('多步路径返回完整路径', () => {
      // 1 - 2 - 3 - 4
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(2, 0, {}, [2, 4]),
        4: makeTile(3, 0, {}, [3]),
      };
      const result = findShortestPath(tiles, 1, 4);
      expect(result.distance).toBe(3);
      expect(result.path).toEqual([1, 2, 3, 4]);
    });
  });

  describe('可达性边界', () => {
    it('不可达返回 distance=-1, path=[]', () => {
      // 1 - 2    3 - 4
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1]),
        3: makeTile(2, 0, {}, [4]),
        4: makeTile(3, 0, {}, [3]),
      };
      const result = findShortestPath(tiles, 1, 3);
      expect(result.distance).toBe(-1);
      expect(result.path).toEqual([]);
    });

    it('只走 passable=true：经过不可通行格返回不可达', () => {
      // 1 - 2(blocked) - 3
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, { passable: false }, [1, 3]),
        3: makeTile(2, 0, {}, [2]),
      };
      const result = findShortestPath(tiles, 1, 3);
      expect(result.distance).toBe(-1);
      expect(result.path).toEqual([]);
    });

    it('不可通行格作为分支节点时不被纳入', () => {
      // 1 - 2 - 3(blocked) - 4
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(2, 0, { passable: false }, [2, 4]),
        4: makeTile(3, 0, {}, [3]),
      };
      const result = findShortestPath(tiles, 1, 4);
      expect(result.distance).toBe(-1);
    });
  });

  describe('路径选择', () => {
    it('BFS 选择最短路径（多条候选取最短）', () => {
      // 1 - 2 - 4 (dist=2)
      // 1 - 3 - 5 - 4 (dist=3)
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1, 4]),
        3: makeTile(0, 1, {}, [1, 5]),
        4: makeTile(1, 1, {}, [2, 5]),
        5: makeTile(2, 1, {}, [3, 4]),
      };
      const result = findShortestPath(tiles, 1, 4);
      expect(result.distance).toBe(2);
      // BFS 首次命中即返回，路径应为 1 → 2 → 4
      expect(result.path).toEqual([1, 2, 4]);
    });

    it('环形拓扑不死循环', () => {
      // 1 - 2 - 3 - 1
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(1, 1, {}, [2, 1]),
      };
      const result = findShortestPath(tiles, 1, 3);
      expect(result.distance).toBe(1);
      expect(result.path).toEqual([1, 3]);
    });

    it('neighbors 为空时只返回起始格（起始即目标）', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, []),
      };
      const result = findShortestPath(tiles, 1, 1);
      expect(result.distance).toBe(0);
      expect(result.path).toEqual([1]);
    });

    it('neighbors 引用不存在的 pls 时被跳过', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [99]),
      };
      const result = findShortestPath(tiles, 1, 99);
      expect(result.distance).toBe(-1);
      expect(result.path).toEqual([]);
    });
  });

  describe('路径完整性', () => {
    it('路径第一个元素是起点', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1, 4]),
        3: makeTile(0, 1, {}, [1, 4]),
        4: makeTile(1, 1, {}, [2, 3]),
      };
      const result = findShortestPath(tiles, 1, 4);
      expect(result.path[0]).toBe(1);
    });

    it('路径最后一个元素是终点', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(2, 0, {}, [2]),
      };
      const result = findShortestPath(tiles, 1, 3);
      const lastIdx = result.path.length - 1;
      expect(result.path[lastIdx]).toBe(3);
    });

    it('路径长度 = distance + 1（边数 + 1 = 节点数）', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(2, 0, {}, [2, 4]),
        4: makeTile(3, 0, {}, [3]),
      };
      const result = findShortestPath(tiles, 1, 4);
      expect(result.path.length).toBe(result.distance + 1);
    });
  });
});
