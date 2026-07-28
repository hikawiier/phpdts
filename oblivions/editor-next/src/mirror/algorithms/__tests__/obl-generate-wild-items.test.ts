/**
 * @module O 内容工具箱
 *
 * obl-generate-wild-items 单元测试。
 *
 * 覆盖点（对齐 PHP generate.func.php:142-211 边界）：
 *   - 空 tiles 返回空数组
 *   - 仅 passable=true 的格参与
 *   - tide 缺失按 'shallow' 计
 *   - rate <= 0 跳过该配置
 *   - item_id 空 / 模板缺失跳过
 *   - count 单值生成 N 份
 *   - count=[min,max] 在区间内取值
 *   - count=[max,min]（min>max）自动 swap
 *   - rate 概率判定（高 rate 多命中，低 rate 少命中）
 *   - 纯函数：输入不被修改
 *   - 相同 seed 产生相同结果
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import {
  oblGenerateWildItems,
  resolveScatterCount,
  type TileMap,
} from '../obl-generate-wild-items';
import type { ItemTable, ScatterPool } from '../types';

const itemTable: ItemTable = {
  scrap_metal: {
    itmk: 'MT',
    itme: 0,
    itms: '1',
    itmsk: '',
    itmpara: '',
    stack: true,
    stack_limit: 99,
  },
  rusty_pipe: {
    itmk: 'WP',
    itme: 5,
    itms: '20',
    itmsk: '',
    itmpara: '',
    stack: false,
  },
};

const scatterPool: ScatterPool = {
  shallow: {
    initial: [
      { item_id: 'scrap_metal', rate: 0.5, count: 1 },
      { item_id: 'rusty_pipe', rate: 0.3, count: [1, 3] },
    ],
  },
  deep: {
    initial: [{ item_id: 'scrap_metal', rate: 0.8, count: 2 }],
  },
  empty_tide: {
    initial: [],
  },
};

describe('oblGenerateWildItems - 边界', () => {
  it('空 tiles 返回空数组', () => {
    const rng = createRng(42);
    expect(oblGenerateWildItems(1, {}, scatterPool, itemTable, rng)).toEqual([]);
  });

  it('仅 passable=true 的格参与', () => {
    const rng = createRng(42);
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: false, tide: 'shallow' }, // 不可通行，跳过
      3: { passable: true, tide: 'shallow' },
    };
    const result = oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng);
    // 仅 1 和 3 可能生成（按 rate 概率）
    for (const item of result) {
      expect([1, 3]).toContain(item.pls);
      expect(item.pls).not.toBe(2);
    }
  });

  it('tide 缺失按 shallow 计', () => {
    const rng = createRng(42);
    const tiles: TileMap = {
      1: { passable: true }, // tide 缺失
    };
    // 应从 shallow 桶生成（rate=0.5 + 0.3）
    // 多次运行应至少有一次生成
    let totalGenerated = 0;
    for (let i = 0; i < 50; i++) {
      totalGenerated += oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng).length;
    }
    expect(totalGenerated).toBeGreaterThan(0);
  });

  it('passable 缺失按 false 计（跳过）', () => {
    const rng = createRng(42);
    const tiles: TileMap = {
      1: { tide: 'shallow' }, // passable 缺失
    };
    expect(oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng)).toEqual([]);
  });
});

describe('oblGenerateWildItems - 配置过滤', () => {
  it('rate <= 0 跳过该配置', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [
          { item_id: 'scrap_metal', rate: 0, count: 1 }, // rate=0 跳过
          { item_id: 'rusty_pipe', rate: -0.5, count: 1 }, // rate<0 跳过
        ],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    for (let i = 0; i < 50; i++) {
      expect(oblGenerateWildItems(1, tiles, pool, itemTable, rng)).toEqual([]);
    }
  });

  it('item_id 空跳过', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [{ item_id: '', rate: 1.0, count: 1 }],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    expect(oblGenerateWildItems(1, tiles, pool, itemTable, rng)).toEqual([]);
  });

  it('item_id 模板缺失跳过', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [{ item_id: 'nonexistent', rate: 1.0, count: 1 }],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    expect(oblGenerateWildItems(1, tiles, pool, itemTable, rng)).toEqual([]);
  });

  it('scatter_pool[tide] 缺失跳过', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'nonexistent_tide' } };
    expect(oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng)).toEqual([]);
  });

  it('scatter_pool[tide].initial 缺失跳过', () => {
    const rng = createRng(42);
    const pool: ScatterPool = { shallow: {} }; // 无 initial
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    expect(oblGenerateWildItems(1, tiles, pool, itemTable, rng)).toEqual([]);
  });
});

describe('oblGenerateWildItems - count 解析', () => {
  it('count 单值生成 N 份', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [{ item_id: 'scrap_metal', rate: 1.0, count: 3 }],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const result = oblGenerateWildItems(1, tiles, pool, itemTable, rng);
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.pls).toBe(1);
      expect(r.item.itmid).toBe('scrap_metal');
    }
  });

  it('count=[min,max] 在区间内取值', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [{ item_id: 'scrap_metal', rate: 1.0, count: [2, 5] }],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    for (let i = 0; i < 20; i++) {
      const result = oblGenerateWildItems(1, tiles, pool, itemTable, rng);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(5);
    }
  });

  it('count=[max,min]（min>max）自动 swap', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [{ item_id: 'scrap_metal', rate: 1.0, count: [5, 2] }],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    for (let i = 0; i < 20; i++) {
      const result = oblGenerateWildItems(1, tiles, pool, itemTable, rng);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(5);
    }
  });

  it('count 缺失按 1 计', () => {
    const rng = createRng(42);
    const pool: ScatterPool = {
      shallow: {
        initial: [{ item_id: 'scrap_metal', rate: 1.0 }],
      },
    };
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const result = oblGenerateWildItems(1, tiles, pool, itemTable, rng);
    expect(result).toHaveLength(1);
  });
});

describe('oblGenerateWildItems - rate 概率判定', () => {
  it('高 rate 多命中，低 rate 少命中', () => {
    const highRng = createRng(100);
    const lowRng = createRng(100);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };

    let highHits = 0;
    let lowHits = 0;
    for (let i = 0; i < 100; i++) {
      const highPool: ScatterPool = {
        shallow: { initial: [{ item_id: 'scrap_metal', rate: 0.9, count: 1 }] },
      };
      const lowPool: ScatterPool = {
        shallow: { initial: [{ item_id: 'scrap_metal', rate: 0.1, count: 1 }] },
      };
      if (oblGenerateWildItems(1, tiles, highPool, itemTable, highRng).length > 0) highHits++;
      if (oblGenerateWildItems(1, tiles, lowPool, itemTable, lowRng).length > 0) lowHits++;
    }
    expect(highHits).toBeGreaterThan(lowHits * 3);
  });
});

describe('oblGenerateWildItems - 纯函数与可复现性', () => {
  it('纯函数：输入 tiles 不被修改', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const original = JSON.parse(JSON.stringify(tiles));
    oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng);
    expect(JSON.parse(JSON.stringify(tiles))).toEqual(original);
  });

  it('相同 seed 产生相同结果', () => {
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'shallow' },
    };
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng1);
    const seq2 = oblGenerateWildItems(1, tiles, scatterPool, itemTable, rng2);
    expect(seq1).toEqual(seq2);
  });
});

describe('resolveScatterCount', () => {
  it('undefined 返回 1', () => {
    const rng = createRng(42);
    expect(resolveScatterCount(rng, undefined)).toBe(1);
  });

  it('单值返回该值', () => {
    const rng = createRng(42);
    expect(resolveScatterCount(rng, 5)).toBe(5);
  });

  it('[min,max] 在区间内取值', () => {
    const rng = createRng(42);
    for (let i = 0; i < 20; i++) {
      const n = resolveScatterCount(rng, [2, 5]);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('[max,min]（min>max）自动 swap', () => {
    const rng = createRng(42);
    for (let i = 0; i < 20; i++) {
      const n = resolveScatterCount(rng, [5, 2]);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
