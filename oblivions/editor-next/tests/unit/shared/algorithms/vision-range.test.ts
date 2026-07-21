//
// vision-range 单元测试（对齐 NEW_DESIGN.md §7.3 M4 验收标准：算法覆盖率 ≥ 95%）
//
// 覆盖点：
//   - calcVisionRange：基础 BFS / 不可通行格可见但不再扩展 / visionRange=0/1/N
//   - calcEnemySenseRange：无视 passable 扩展
//   - 边界：起始格不存在 / neighbors 为空 / 起始即目标
//
// 注：shared tsconfig 开启 noUncheckedIndexedAccess，测试中已确保 key 存在

import { describe, it, expect } from 'vitest';
import { calcVisionRange, calcEnemySenseRange } from '@/shared/algorithms/vision-range';
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

describe('calcVisionRange', () => {
  describe('基础场景', () => {
    it('起始格不存在时返回空 Map', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0),
      };
      const result = calcVisionRange(tiles, 99, 2);
      expect(result.size).toBe(0);
    });

    it('起始格存在但 visionRange=0 时只包含起始格', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1]),
        3: makeTile(0, 1, {}, [1]),
      };
      const result = calcVisionRange(tiles, 1, 0);
      expect(result.size).toBe(1);
      expect(result.get(1)).toBe(0);
    });

    it('起始格存在且 visionRange=1 时包含起始格 + 直接邻居', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1]),
        3: makeTile(0, 1, {}, [1]),
        4: makeTile(2, 0, {}, [2]),
      };
      const result = calcVisionRange(tiles, 1, 1);
      expect(result.size).toBe(3);
      expect(result.get(1)).toBe(0);
      expect(result.get(2)).toBe(1);
      expect(result.get(3)).toBe(1);
      // 距离 2 的格不被纳入（visionRange=1）
      expect(result.has(4)).toBe(false);
    });

    it('visionRange=2 时包含距离 0/1/2 的格', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(2, 0, {}, [2, 4]),
        4: makeTile(3, 0, {}, [3]),
      };
      const result = calcVisionRange(tiles, 1, 2);
      expect(result.size).toBe(3); // 1, 2, 3
      expect(result.get(1)).toBe(0);
      expect(result.get(2)).toBe(1);
      expect(result.get(3)).toBe(2);
      expect(result.has(4)).toBe(false);
    });
  });

  describe('不可通行格语义对齐', () => {
    it('不可通行格可见（出现在结果中）但不再扩展', () => {
      // 1 - 2(blocked) - 3
      // 若 2 不可通行，3 不应被纳入（除非有其他路径）
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, { passable: false }, [1, 3]),
        3: makeTile(2, 0, {}, [2]),
      };
      const result = calcVisionRange(tiles, 1, 5);
      expect(result.has(2)).toBe(true); // 可见
      expect(result.has(3)).toBe(false); // 不再扩展，3 不可见
    });

    it('起始格不可通行时仍能扩展（仅起始格不受 passable 限制）', () => {
      // 起始格 passable=false，但作为根节点仍可扩展
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, { passable: false }, [2]),
        2: makeTile(1, 0, {}, [1]),
      };
      const result = calcVisionRange(tiles, 1, 2);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true);
    });

    it('多步路径中遇到不可通行格只阻挡该方向扩展', () => {
      // 1 - 2(blocked) - 3
      //     |
      //     4 - 5
      // 1 视野内：1, 2, 4（通过 2 但 2 blocked 后只可见 4 通过其他路径？）
      // 实际：从 1 出发扩展到 2（dist=1），2 blocked 不再扩展，所以 3/4 都不可见
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2]),
        2: makeTile(1, 0, { passable: false }, [1, 3, 4]),
        3: makeTile(2, 0, {}, [2]),
        4: makeTile(1, 1, {}, [2]),
        5: makeTile(1, 2, {}, [4]),
      };
      const result = calcVisionRange(tiles, 1, 5);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true); // 2 不可通行但可见
      expect(result.has(3)).toBe(false); // 2 blocked，3 不再扩展
      expect(result.has(4)).toBe(false); // 2 blocked，4 不再扩展
    });
  });

  describe('邻居字段缺失', () => {
    it('neighbors 为空时只返回起始格', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, []),
      };
      const result = calcVisionRange(tiles, 1, 5);
      expect(result.size).toBe(1);
      expect(result.get(1)).toBe(0);
    });

    it('邻居引用不存在的 pls 时被跳过', () => {
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 99]), // 99 不存在
      };
      const result = calcVisionRange(tiles, 1, 2);
      expect(result.size).toBe(1); // 仅起始格
      expect(result.has(99)).toBe(false);
    });
  });

  describe('环形 / 重复访问', () => {
    it('环形拓扑不会死循环（visited 去重）', () => {
      // 1 - 2 - 3 - 1（环）
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1, 3]),
        3: makeTile(1, 1, {}, [2, 1]),
      };
      const result = calcVisionRange(tiles, 1, 5);
      expect(result.size).toBe(3);
    });

    it('BFS 给出最短距离而非首次访问距离', () => {
      // 1 - 2 - 4 (dist=2 from 1)
      // 1 - 3 - 4 (dist=2 from 1)
      // 4 应该是 dist=2，不是更长的路径
      const tiles: Record<Pls, Tile> = {
        1: makeTile(0, 0, {}, [2, 3]),
        2: makeTile(1, 0, {}, [1, 4]),
        3: makeTile(0, 1, {}, [1, 4]),
        4: makeTile(1, 1, {}, [2, 3]),
      };
      const result = calcVisionRange(tiles, 1, 5);
      expect(result.get(4)).toBe(2);
    });
  });
});

describe('calcEnemySenseRange', () => {
  it('起始格不存在时返回空 Map', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile(0, 0) };
    const result = calcEnemySenseRange(tiles, 99, 3);
    expect(result.size).toBe(0);
  });

  it('senseRange=0 时只包含起始格', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, {}, [1]),
    };
    const result = calcEnemySenseRange(tiles, 1, 0);
    expect(result.size).toBe(1);
    expect(result.get(1)).toBe(0);
  });

  it('senseRange=N 时无视 passable 扩展 N 步', () => {
    // 1 - 2(blocked) - 3
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, { passable: false }, [1, 3]),
      3: makeTile(2, 0, {}, [2]),
    };
    const result = calcEnemySenseRange(tiles, 1, 3);
    // 感知范围无视 passable：3 应被纳入
    expect(result.has(3)).toBe(true);
    expect(result.get(3)).toBe(2);
  });

  it('与 calcVisionRange 的差异：感知能穿透不可通行格', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2]),
      2: makeTile(1, 0, { passable: false }, [1, 3]),
      3: makeTile(2, 0, {}, [2]),
    };
    const vision = calcVisionRange(tiles, 1, 5);
    const sense = calcEnemySenseRange(tiles, 1, 5);
    expect(vision.has(3)).toBe(false);
    expect(sense.has(3)).toBe(true);
  });

  it('环形拓扑不死循环', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [2, 3]),
      2: makeTile(1, 0, { passable: false }, [1, 3]),
      3: makeTile(1, 1, { passable: false }, [2, 1]),
    };
    const result = calcEnemySenseRange(tiles, 1, 5);
    expect(result.size).toBe(3);
  });

  it('neighbors 引用不存在的 pls 时被跳过', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile(0, 0, {}, [99]),
    };
    const result = calcEnemySenseRange(tiles, 1, 3);
    expect(result.size).toBe(1);
    expect(result.has(99)).toBe(false);
  });
});
