//
// connectivity 单元测试（对齐 NEW_DESIGN.md §7.3 M2 验收标准：覆盖率 ≥ 95%）
//
// 覆盖点：
//   - EIGHT_DIRECTIONS 常量（8 个方向，不含 (0,0)）
//   - findTileByCoord：按 (x, y) 查找 pls
//   - autoConnect：8 方向自动连通 + 跳过 _breaks + 对称性
//   - disconnectAll：删除格时清理所有邻居引用（对称）
//   - breakConnection：双向写入 _breaks + 幂等
//   - restoreConnection：从 _breaks 移除并恢复 neighbors + 幂等
//   - getBrokenNeighbors：返回相邻但已断开的格列表
//   - detectIslands：BFS 检测孤岛
//
// 边界：
//   - pls 自身不被加入 neighbors
//   - 不存在的 pls 安全返回
//   - 重复 break / restore 幂等无副作用
//   - neighbors / _breaks 数组都为 undefined 时初始化为 []
//
// 注：shared tsconfig 开启 noUncheckedIndexedAccess，tiles[key] 类型为 Tile | undefined，
//     测试中已确保 key 存在，使用非空断言 `!` 简化

import { describe, it, expect } from 'vitest';
import {
  EIGHT_DIRECTIONS,
  findTileByCoord,
  autoConnect,
  disconnectAll,
  breakConnection,
  restoreConnection,
  getBrokenNeighbors,
  detectIslands,
} from '@/shared/algorithms/connectivity';
import type { Pls, Tile } from '@/shared/types/map';

function makeTile(x: number, y: number, neighbors: Pls[] = [], breaks: Pls[] = []): Tile {
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
    _breaks: breaks,
  };
}

describe('EIGHT_DIRECTIONS', () => {
  it('包含 8 个方向', () => {
    expect(EIGHT_DIRECTIONS).toHaveLength(8);
  });

  it('不含 (0, 0)', () => {
    expect(EIGHT_DIRECTIONS).not.toContainEqual([0, 0]);
  });

  it('包含全部 8 个偏移', () => {
    const expected = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];
    for (const dir of expected) {
      expect(EIGHT_DIRECTIONS).toContainEqual(dir);
    }
  });
});

describe('findTileByCoord', () => {
  it('找到匹配坐标的 pls', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(3, 4),
    };
    expect(findTileByCoord(tiles, 3, 4)).toBe(2);
    expect(findTileByCoord(tiles, 0, 0)).toBe(1);
  });

  it('未找到返回 null', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    expect(findTileByCoord(tiles, 5, 5)).toBeNull();
  });

  it('空 tiles 返回 null', () => {
    expect(findTileByCoord({}, 0, 0)).toBeNull();
  });
});

describe('autoConnect', () => {
  it('8 方向相邻格自动建立 neighbors（双向）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1), // 对角相邻
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!.neighbors).toContain(2);
    expect(tiles[2]!.neighbors).toContain(1);
  });

  it('不相邻格不建立连接', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(5, 5),
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!.neighbors).toHaveLength(0);
    expect(tiles[2]!.neighbors).toHaveLength(0);
  });

  it('自身不被加入 neighbors', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!.neighbors).not.toContain(1);
  });

  it('跳过 _breaks 标记的邻居（双向）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [], [2]),
      2: makeTile(1, 1),
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!.neighbors).not.toContain(2);
    expect(tiles[2]!.neighbors).not.toContain(1);
  });

  it('跳过对方 _breaks 标记（反向）', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
      2: makeTile(1, 1, [], [1]),
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!.neighbors).not.toContain(2);
    expect(tiles[2]!.neighbors).not.toContain(1);
  });

  it('8 个方向全部连接', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(1, 1),
      2: makeTile(0, 0),
      3: makeTile(1, 0),
      4: makeTile(2, 0),
      5: makeTile(0, 1),
      6: makeTile(2, 1),
      7: makeTile(0, 2),
      8: makeTile(1, 2),
      9: makeTile(2, 2),
    };
    autoConnect(tiles, 1);
    expect([...tiles[1]!.neighbors].sort()).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('已存在 neighbors 不重复添加', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!.neighbors).toEqual([2]);
    expect(tiles[2]!.neighbors).toEqual([1]);
  });

  it('_breaks undefined 时初始化为 []', () => {
    const tiles: Record<Pls, Tile> = {
      1: { ...makeTile(0, 0), _breaks: undefined },
      2: { ...makeTile(1, 1), _breaks: undefined },
    };
    autoConnect(tiles, 1);
    expect(tiles[1]!._breaks).toEqual([]);
    expect(tiles[2]!._breaks).toEqual([]);
    expect(tiles[1]!.neighbors).toContain(2);
  });

  it('不存在的 pls 安全返回（无副作用）', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    expect(() => autoConnect(tiles, 999)).not.toThrow();
  });
});

describe('disconnectAll', () => {
  it('从所有邻居的 neighbors / _breaks 中移除自己', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2, 3]),
      2: makeTile(1, 1, [1]),
      3: makeTile(1, 0, [1]),
    };
    disconnectAll(tiles, 1);
    expect(tiles[2]!.neighbors).not.toContain(1);
    expect(tiles[3]!.neighbors).not.toContain(1);
    // 1 自身的 neighbors 不被清理（调用方 delete）
    expect(tiles[1]!.neighbors).toEqual([2, 3]);
  });

  it('从邻居 _breaks 中也移除自己', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [], [2]),
      2: makeTile(1, 1, [], [1]),
    };
    disconnectAll(tiles, 1);
    expect(tiles[2]!._breaks).not.toContain(1);
  });

  it('不存在的 pls 安全返回', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    expect(() => disconnectAll(tiles, 999)).not.toThrow();
  });

  it('邻居 _breaks undefined 时安全跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: { ...makeTile(1, 1), _breaks: undefined },
    };
    expect(() => disconnectAll(tiles, 1)).not.toThrow();
    expect(tiles[2]!.neighbors).not.toContain(1);
  });
});

describe('breakConnection', () => {
  it('双向写入 _breaks 并从 neighbors 中互移', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    breakConnection(tiles, 1, 2);
    expect(tiles[1]!.neighbors).not.toContain(2);
    expect(tiles[2]!.neighbors).not.toContain(1);
    expect(tiles[1]!._breaks).toContain(2);
    expect(tiles[2]!._breaks).toContain(1);
  });

  it('幂等：重复断开同一对无副作用', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    breakConnection(tiles, 1, 2);
    breakConnection(tiles, 1, 2);
    expect(tiles[1]!._breaks).toEqual([2]);
    expect(tiles[2]!._breaks).toEqual([1]);
  });

  it('同一 pls 断开自己无副作用', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    breakConnection(tiles, 1, 1);
    expect(tiles[1]!._breaks).toEqual([]);
    expect(tiles[1]!.neighbors).toEqual([]);
  });

  it('不存在的 pls 安全返回', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    expect(() => breakConnection(tiles, 1, 999)).not.toThrow();
    expect(tiles[1]!._breaks).toEqual([]);
  });

  it('_breaks undefined 时初始化为 []', () => {
    const tiles: Record<Pls, Tile> = {
      1: { ...makeTile(0, 0, [2]), _breaks: undefined },
      2: { ...makeTile(1, 1, [1]), _breaks: undefined },
    };
    breakConnection(tiles, 1, 2);
    expect(tiles[1]!._breaks).toEqual([2]);
    expect(tiles[2]!._breaks).toEqual([1]);
  });
});

describe('restoreConnection', () => {
  it('从 _breaks 移除并恢复双向 neighbors', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [], [2]),
      2: makeTile(1, 1, [], [1]),
    };
    restoreConnection(tiles, 1, 2);
    expect(tiles[1]!._breaks).not.toContain(2);
    expect(tiles[2]!._breaks).not.toContain(1);
    expect(tiles[1]!.neighbors).toContain(2);
    expect(tiles[2]!.neighbors).toContain(1);
  });

  it('幂等：重复恢复同一对无副作用', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [], [2]),
      2: makeTile(1, 1, [], [1]),
    };
    restoreConnection(tiles, 1, 2);
    restoreConnection(tiles, 1, 2);
    expect(tiles[1]!.neighbors).toEqual([2]);
    expect(tiles[2]!.neighbors).toEqual([1]);
    expect(tiles[1]!._breaks).toEqual([]);
    expect(tiles[2]!._breaks).toEqual([]);
  });

  it('同一 pls 恢复自己无副作用', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    restoreConnection(tiles, 1, 1);
    expect(tiles[1]!.neighbors).toEqual([]);
  });

  it('不存在的 pls 安全返回', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    expect(() => restoreConnection(tiles, 1, 999)).not.toThrow();
  });

  it('_breaks undefined 时安全（不抛错）', () => {
    const tiles: Record<Pls, Tile> = {
      1: { ...makeTile(0, 0), _breaks: undefined },
      2: { ...makeTile(1, 1), _breaks: undefined },
    };
    expect(() => restoreConnection(tiles, 1, 2)).not.toThrow();
    expect(tiles[1]!.neighbors).toContain(2);
  });
});

describe('getBrokenNeighbors', () => {
  it('返回与指定格坐标相邻但未连通的格列表', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [], [2]),
      2: makeTile(1, 1),
      3: makeTile(0, 1, [1]),
    };
    const broken = getBrokenNeighbors(tiles, 1);
    expect(broken).toContain(2);
    expect(broken).not.toContain(3);
  });

  it('全部已连通时返回空数组', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    expect(getBrokenNeighbors(tiles, 1)).toEqual([]);
  });

  it('不存在的 pls 返回空数组', () => {
    expect(getBrokenNeighbors({}, 999)).toEqual([]);
  });

  it('跳过自身坐标', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    // 不存在其他格，应返回空
    expect(getBrokenNeighbors(tiles, 1)).toEqual([]);
  });
});

describe('detectIslands', () => {
  it('entrancePls=null 时返回空 visited + 全部 unreachable', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    const result = detectIslands(tiles, null);
    expect(result.visited.size).toBe(0);
    expect(result.unreachable).toEqual([1, 2]);
  });

  it('entrancePls 不存在的 pls 时返回空 visited + 全部 unreachable', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
    };
    const result = detectIslands(tiles, 999);
    expect(result.visited.size).toBe(0);
    expect(result.unreachable).toEqual([1, 2]);
  });

  it('全部连通时 unreachable 为空', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1, 3]),
      3: makeTile(2, 2, [2]),
    };
    const result = detectIslands(tiles, 1);
    expect(result.visited.size).toBe(3);
    expect(result.unreachable).toEqual([]);
  });

  it('存在孤岛时返回 unreachable 列表', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [2]),
      2: makeTile(1, 1, [1]),
      3: makeTile(5, 5, [4]),
      4: makeTile(6, 6, [3]),
    };
    const result = detectIslands(tiles, 1);
    expect(result.visited.has(1)).toBe(true);
    expect(result.visited.has(2)).toBe(true);
    expect(result.visited.has(3)).toBe(false);
    expect(result.visited.has(4)).toBe(false);
    expect(result.unreachable).toContain(3);
    expect(result.unreachable).toContain(4);
  });

  it('单格区域无邻居时只可达自身', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0),
    };
    const result = detectIslands(tiles, 1);
    expect(result.visited.size).toBe(1);
    expect(result.unreachable).toEqual([]);
  });

  it('neighbors 为 undefined 时不崩溃', () => {
    const tiles: Record<Pls, Tile> = {
      1: { ...makeTile(0, 0), neighbors: undefined as unknown as Pls[] },
    };
    expect(() => detectIslands(tiles, 1)).not.toThrow();
    expect(detectIslands(tiles, 1).visited.size).toBe(1);
  });

  it('neighbors 引用不存在的 pls 时安全跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, [99, 2]), // 99 不存在，2 存在
      2: makeTile(1, 1, [1]),
    };
    expect(() => detectIslands(tiles, 1)).not.toThrow();
    const result = detectIslands(tiles, 1);
    expect(result.visited.has(1)).toBe(true);
    expect(result.visited.has(2)).toBe(true);
    expect(result.unreachable).toEqual([]);
  });
});
