/**
 * @module O 内容工具箱
 *
 * obl-init-enemies 单元测试。
 *
 * 覆盖点（对齐 PHP init.func.php:214-268 边界）：
 *   - 空 tiles 返回空数组
 *   - 仅 passable=true 的格参与
 *   - tide 缺失按 'shallow' 计
 *   - 排除区域出入口（entrance_pls / exit_pls）
 *   - 排除已占用格（玩家初始位置）
 *   - 每格最多一个敌人
 *   - count=[min,max] 在区间内取值
 *   - count=[max,min]（min>max）自动 swap
 *   - count 单值生成对应数量
 *   - 候选格不足时停止该 entry 的放置（break）
 *   - 纯函数：输入不被修改
 *   - 相同 seed 产生相同结果
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import {
  oblInitEnemies,
  oblPickAvailableTile,
  bucketTilesByTide,
  resolveEnemyCount,
} from '../obl-init-enemies';
import type { TileMap } from '../obl-generate-wild-items';
import type { EnemyPool, RegionInfo } from '../types';

const defaultRegion: RegionInfo = {
  entrance_pls: 100,
  exit_pls: 200,
};

const enemyPool: EnemyPool = {
  shallow: [
    { enemy_type: 1, count: 3 },
    { enemy_type: 2, count: [1, 2] },
  ],
  deep: [{ enemy_type: 3, count: 2 }],
  abyss: [{ enemy_type: 4, count: 1 }],
};

function makeTiles(): TileMap {
  return {
    1: { passable: true, tide: 'shallow' },
    2: { passable: true, tide: 'shallow' },
    3: { passable: true, tide: 'shallow' },
    4: { passable: true, tide: 'shallow' },
    5: { passable: true, tide: 'deep' },
    6: { passable: true, tide: 'deep' },
    7: { passable: true, tide: 'abyss' },
    // 不可通行格
    8: { passable: false, tide: 'shallow' },
    // 出入口
    100: { passable: true, tide: 'shallow' },
    200: { passable: true, tide: 'shallow' },
  };
}

describe('oblPickAvailableTile', () => {
  it('候选为空返回 null', () => {
    const rng = createRng(42);
    expect(oblPickAvailableTile(rng, [], new Set())).toBeNull();
  });

  it('所有候选都被占用返回 null', () => {
    const rng = createRng(42);
    const occupied = new Set([1, 2, 3]);
    expect(oblPickAvailableTile(rng, [1, 2, 3], occupied)).toBeNull();
  });

  it('从未占用候选中随机选一个', () => {
    const rng = createRng(42);
    const occupied = new Set([1]);
    const result = oblPickAvailableTile(rng, [1, 2, 3], occupied);
    expect([2, 3]).toContain(result);
  });

  it('选中后不修改 occupied 集合（调用方负责）', () => {
    const rng = createRng(42);
    const occupied = new Set<number>([1]);
    const sizeBefore = occupied.size;
    oblPickAvailableTile(rng, [1, 2, 3], occupied);
    expect(occupied.size).toBe(sizeBefore);
  });
});

describe('bucketTilesByTide', () => {
  it('仅 passable=true 的格参与', () => {
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: false, tide: 'shallow' },
      3: { passable: true, tide: 'deep' },
    };
    const result = bucketTilesByTide(tiles);
    expect(result.shallow).toEqual([1]);
    expect(result.deep).toEqual([3]);
    expect(result.abyss).toEqual([]);
  });

  it('tide 缺失按 shallow 计', () => {
    const tiles: TileMap = { 1: { passable: true } };
    const result = bucketTilesByTide(tiles);
    expect(result.shallow).toEqual([1]);
  });

  it('仅 shallow/deep/abyss 三个 tide 桶', () => {
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'deep' },
      3: { passable: true, tide: 'abyss' },
      4: { passable: true, tide: 'unknown' }, // 不计入任何桶
    };
    const result = bucketTilesByTide(tiles);
    expect(result.shallow).toEqual([1]);
    expect(result.deep).toEqual([2]);
    expect(result.abyss).toEqual([3]);
  });
});

describe('resolveEnemyCount', () => {
  it('undefined 返回 1', () => {
    const rng = createRng(42);
    expect(resolveEnemyCount(rng, undefined)).toBe(1);
  });

  it('单值返回该值', () => {
    const rng = createRng(42);
    expect(resolveEnemyCount(rng, 5)).toBe(5);
  });

  it('[min,max] 在区间内取值', () => {
    const rng = createRng(42);
    for (let i = 0; i < 20; i++) {
      const n = resolveEnemyCount(rng, [2, 5]);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('[max,min]（min>max）自动 swap', () => {
    const rng = createRng(42);
    for (let i = 0; i < 20; i++) {
      const n = resolveEnemyCount(rng, [5, 2]);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});

describe('oblInitEnemies - 边界', () => {
  it('空 tiles 返回空数组', () => {
    const rng = createRng(42);
    const result = oblInitEnemies(1, defaultRegion, {}, enemyPool, new Set(), rng);
    expect(result).toEqual([]);
  });

  it('enemy_pool 为空返回空数组', () => {
    const rng = createRng(42);
    const result = oblInitEnemies(1, defaultRegion, makeTiles(), {}, new Set(), rng);
    expect(result).toEqual([]);
  });

  it('enemy_pool[tide] 缺失跳过该 tide 桶', () => {
    const rng = createRng(42);
    const pool: EnemyPool = { deep: [{ enemy_type: 1, count: 1 }] }; // 仅 deep
    const result = oblInitEnemies(1, defaultRegion, makeTiles(), pool, new Set(), rng);
    // 应仅在 deep 桶生成（5,6 两个格）
    for (const e of result) {
      expect([5, 6]).toContain(e.pls);
    }
  });
});

describe('oblInitEnemies - 排除规则', () => {
  it('排除区域出入口（entrance_pls / exit_pls）', () => {
    const rng = createRng(42);
    const result = oblInitEnemies(1, defaultRegion, makeTiles(), enemyPool, new Set(), rng);
    for (const e of result) {
      expect(e.pls).not.toBe(defaultRegion.entrance_pls);
      expect(e.pls).not.toBe(defaultRegion.exit_pls);
    }
  });

  it('排除已占用格（玩家初始位置）', () => {
    const rng = createRng(42);
    const occupied = new Set<number>([1, 2, 3, 4, 5, 6, 7]); // 占用所有可通行格
    const result = oblInitEnemies(1, defaultRegion, makeTiles(), enemyPool, occupied, rng);
    expect(result).toEqual([]);
  });

  it('entrance_pls=null 不排除', () => {
    const rng = createRng(42);
    const region: RegionInfo = { entrance_pls: null, exit_pls: null };
    const pool: EnemyPool = {
      shallow: [{ enemy_type: 1, count: 1 }],
    };
    // 单独构造一个 tiles 让 pls=100 可被放置
    const tiles: TileMap = { 100: { passable: true, tide: 'shallow' } };
    const result = oblInitEnemies(1, region, tiles, pool, new Set(), rng);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.pls).toBe(100);
  });
});

describe('oblInitEnemies - 每格最多一个敌人', () => {
  it('每格最多一个敌人（count 多但不重复占用）', () => {
    const rng = createRng(42);
    const pool: EnemyPool = {
      shallow: [{ enemy_type: 1, count: 10 }], // count=10 但只有 4 个可用格
    };
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'shallow' },
      3: { passable: true, tide: 'shallow' },
      4: { passable: true, tide: 'shallow' },
    };
    const region: RegionInfo = { entrance_pls: null, exit_pls: null };
    const result = oblInitEnemies(1, region, tiles, pool, new Set(), rng);
    expect(result.length).toBeLessThanOrEqual(4);

    // 校验 pls 不重复
    const plsSet = new Set(result.map((r) => r.pls));
    expect(plsSet.size).toBe(result.length);
  });

  it('候选格不足时停止该 entry 的放置（break）', () => {
    const rng = createRng(42);
    const pool: EnemyPool = {
      shallow: [
        { enemy_type: 1, count: 2 }, // 用掉 2 个格
        { enemy_type: 2, count: 5 }, // 只剩 2 个格，应只放置 2 个后 break
      ],
    };
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'shallow' },
      3: { passable: true, tide: 'shallow' },
      4: { passable: true, tide: 'shallow' },
    };
    const region: RegionInfo = { entrance_pls: null, exit_pls: null };
    const result = oblInitEnemies(1, region, tiles, pool, new Set(), rng);
    expect(result.length).toBeLessThanOrEqual(4);
    // pls 不重复
    const plsSet = new Set(result.map((r) => r.pls));
    expect(plsSet.size).toBe(result.length);
  });
});

describe('oblInitEnemies - count 解析', () => {
  it('count 单值生成对应数量', () => {
    const rng = createRng(42);
    const pool: EnemyPool = {
      shallow: [{ enemy_type: 1, count: 2 }],
    };
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'shallow' },
      3: { passable: true, tide: 'shallow' },
    };
    const region: RegionInfo = { entrance_pls: null, exit_pls: null };
    const result = oblInitEnemies(1, region, tiles, pool, new Set(), rng);
    expect(result).toHaveLength(2);
    for (const e of result) {
      expect(e.enemy_type).toBe(1);
      expect(e.pgroup).toBe(1);
    }
  });

  it('count=[min,max] 在区间内取值', () => {
    const rng = createRng(42);
    const pool: EnemyPool = {
      shallow: [{ enemy_type: 1, count: [1, 3] }],
    };
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'shallow' },
      3: { passable: true, tide: 'shallow' },
      4: { passable: true, tide: 'shallow' },
      5: { passable: true, tide: 'shallow' },
    };
    const region: RegionInfo = { entrance_pls: null, exit_pls: null };
    for (let i = 0; i < 20; i++) {
      const result = oblInitEnemies(1, region, tiles, pool, new Set(), rng);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('oblInitEnemies - 纯函数与可复现性', () => {
  it('纯函数：输入 tiles 不被修改', () => {
    const rng = createRng(42);
    const tiles = makeTiles();
    const original = JSON.parse(JSON.stringify(tiles));
    oblInitEnemies(1, defaultRegion, tiles, enemyPool, new Set(), rng);
    expect(JSON.parse(JSON.stringify(tiles))).toEqual(original);
  });

  it('纯函数：输入 initialOccupied 不被修改', () => {
    const rng = createRng(42);
    const occupied = new Set<number>([1]);
    const sizeBefore = occupied.size;
    oblInitEnemies(1, defaultRegion, makeTiles(), enemyPool, occupied, rng);
    expect(occupied.size).toBe(sizeBefore);
  });

  it('相同 seed 产生相同结果', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = oblInitEnemies(1, defaultRegion, makeTiles(), enemyPool, new Set(), rng1);
    const seq2 = oblInitEnemies(1, defaultRegion, makeTiles(), enemyPool, new Set(), rng2);
    expect(seq1).toEqual(seq2);
  });
});

describe('oblInitEnemies - 综合场景', () => {
  it('综合：tide 桶 + 排除占用 + count 取值', () => {
    const rng = createRng(2024);
    const occupied = new Set<number>([1]); // 玩家在 pls=1
    const result = oblInitEnemies(1, defaultRegion, makeTiles(), enemyPool, occupied, rng);

    // pls 不重复
    const plsSet = new Set(result.map((r) => r.pls));
    expect(plsSet.size).toBe(result.length);

    // 不放置在 pls=1（玩家占用）和出入口
    for (const e of result) {
      expect(e.pls).not.toBe(1);
      expect(e.pls).not.toBe(defaultRegion.entrance_pls);
      expect(e.pls).not.toBe(defaultRegion.exit_pls);
      expect(e.pgroup).toBe(1);
    }
  });
});
