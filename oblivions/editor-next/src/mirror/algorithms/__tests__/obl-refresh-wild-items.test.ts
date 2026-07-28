/**
 * @module O 内容工具箱
 *
 * obl-refresh-wild-items 单元测试。
 *
 * 覆盖点（对齐 PHP wild_refresh.func.php:54-215 边界）：
 *   - mode != 'daily' 不刷新
 *   - currentDay <= 0 不刷新
 *   - 仅"已发现过（fog=1 OR last_refresh_day>0）"的格参与
 *   - 仅"本天未刷新（last_refresh_day < currentDay）"的格参与
 *   - 容量上限保护：cnt >= capacity 跳过
 *   - effective_rate = rate × mult，clamp 到 [0,1]
 *   - rate <= 0 跳过
 *   - item_id 空 / 模板缺失跳过
 *   - tide 倍率正确应用
 *   - 纯函数：输入不被修改
 *   - 相同 seed 产生相同结果
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import {
  oblRefreshWildItems,
  type DayTransition,
  type TileRefreshStateMap,
  type TileRefreshState,
} from '../obl-refresh-wild-items';
import type { TileMap } from '../obl-generate-wild-items';
import type {
  ItemTable,
  ScatterPool,
  WildItemRefreshConfig,
} from '../types';

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
};

const scatterPool: ScatterPool = {
  shallow: {
    refresh: [{ item_id: 'scrap_metal', rate: 0.5, count: 1 }],
  },
  deep: {
    refresh: [{ item_id: 'scrap_metal', rate: 0.8, count: 2 }],
  },
};

const defaultCfg: WildItemRefreshConfig = {
  wild_item_refresh_mode: 'daily',
  wild_item_capacity_per_tile: 5,
  wild_item_refresh_rate_by_tide: {
    shallow: 0.5,
    deep: 1.0,
    abyss: 1.5,
  },
};

const defaultTransition: DayTransition = {
  from: { day: 1, phase: 'night' },
  to: { day: 2, phase: 'day' },
  tick: 100,
};

function makeState(fog: number, lastRefreshDay: number): TileRefreshState {
  return { fog, last_refresh_day: lastRefreshDay };
}

describe('oblRefreshWildItems - 模式与天数', () => {
  it('mode != "daily" 不刷新', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const cfg: WildItemRefreshConfig = { ...defaultCfg, wild_item_refresh_mode: 'weekly' };
    expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, cfg, rng)).toEqual([]);
  });

  it('currentDay <= 0 不刷新', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const transition: DayTransition = {
      from: { day: 0, phase: 'night' },
      to: { day: 0, phase: 'day' },
      tick: 0,
    };
    expect(oblRefreshWildItems(transition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng)).toEqual([]);
  });

  it('mode 缺失按 "daily" 计', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const cfg: WildItemRefreshConfig = {}; // mode 缺失
    // 应该会刷新（rate=0.5 × mult=0.5 = 0.25，多次运行至少有一次）
    let totalGenerated = 0;
    for (let i = 0; i < 100; i++) {
      totalGenerated += oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, cfg, rng).length;
    }
    expect(totalGenerated).toBeGreaterThan(0);
  });
});

describe('oblRefreshWildItems - 图格过滤', () => {
  it('仅 fog=1 的格参与', () => {
    const rng = createRng(42);
    const tiles: TileMap = {
      1: { passable: true, tide: 'shallow' },
      2: { passable: true, tide: 'shallow' },
    };
    const states: TileRefreshStateMap = {
      1: makeState(1, 0), // fog=1，参与
      2: makeState(0, 0), // fog=0 且 last_refresh_day=0，跳过
    };
    let generated = 0;
    for (let i = 0; i < 100; i++) {
      const result = oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng);
      for (const r of result) {
        expect(r.pls).not.toBe(2);
        generated++;
      }
    }
    // 至少有几次生成在 pls=1
    // 注：rate=0.5 × mult=0.5 = 0.25，100 次期望 25 次
    expect(generated).toBeGreaterThan(0);
  });

  it('last_refresh_day > 0 的格也参与（即使 fog=0）', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = {
      1: makeState(0, 1), // fog=0 但 last_refresh_day=1，参与
    };
    let generated = 0;
    for (let i = 0; i < 100; i++) {
      generated += oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng).length;
    }
    expect(generated).toBeGreaterThan(0);
  });

  it('last_refresh_day >= currentDay 的格不参与（本天已刷新）', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = {
      1: makeState(1, 2), // last_refresh_day=2 = currentDay，跳过
    };
    for (let i = 0; i < 50; i++) {
      expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng)).toEqual([]);
    }
  });
});

describe('oblRefreshWildItems - 容量上限', () => {
  it('cnt >= capacity 跳过该格', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    // 当前容量 = 5 = capacity
    const currentCounts: Record<string, number> = { '1': 5 };
    for (let i = 0; i < 50; i++) {
      expect(oblRefreshWildItems(defaultTransition, tiles, states, currentCounts, scatterPool, itemTable, defaultCfg, rng)).toEqual([]);
    }
  });

  it('容量上限保护：不超过 capacity', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    // 当前容量 = 4，capacity = 5，最多生成 1 个
    const currentCounts: Record<string, number> = { '1': 4 };
    const pool: ScatterPool = {
      shallow: {
        // rate=1.0 + count=10，但容量上限只允许 1 个
        refresh: [{ item_id: 'scrap_metal', rate: 1.0, count: 10 }],
      },
    };
    // 使用 mult=1.0 确保必中（rate=1.0 × mult=1.0 = 1.0），让测试确定性校验容量上限
    const cfg: WildItemRefreshConfig = {
      ...defaultCfg,
      wild_item_refresh_rate_by_tide: { shallow: 1.0 },
    };
    const result = oblRefreshWildItems(defaultTransition, tiles, states, currentCounts, pool, itemTable, cfg, rng);
    expect(result).toHaveLength(1);
  });

  it('capacity 缺失按 5 计', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const currentCounts: Record<string, number> = { '1': 5 };
    const cfg: WildItemRefreshConfig = { ...defaultCfg };
    delete cfg.wild_item_capacity_per_tile;
    for (let i = 0; i < 50; i++) {
      expect(oblRefreshWildItems(defaultTransition, tiles, states, currentCounts, scatterPool, itemTable, cfg, rng)).toEqual([]);
    }
  });
});

describe('oblRefreshWildItems - tide 倍率', () => {
  it('effective_rate = rate × mult，clamp 到 [0,1]', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'abyss' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const pool: ScatterPool = {
      abyss: {
        // rate=0.8 × mult=1.5 = 1.2，clamp 到 1.0
        refresh: [{ item_id: 'scrap_metal', rate: 0.8, count: 1 }],
      },
    };
    // 100% 概率应每次都生成
    for (let i = 0; i < 20; i++) {
      const result = oblRefreshWildItems(defaultTransition, tiles, states, {}, pool, itemTable, defaultCfg, rng);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('mult 缺失按 1.0 计', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const cfg: WildItemRefreshConfig = {
      ...defaultCfg,
      wild_item_refresh_rate_by_tide: {}, // 倍率表空
    };
    // rate=0.5 × mult=1.0 = 0.5，多次运行应至少有一次生成
    let generated = 0;
    for (let i = 0; i < 100; i++) {
      generated += oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, cfg, rng).length;
    }
    expect(generated).toBeGreaterThan(0);
  });
});

describe('oblRefreshWildItems - 配置过滤', () => {
  it('rate <= 0 跳过', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const pool: ScatterPool = {
      shallow: {
        refresh: [
          { item_id: 'scrap_metal', rate: 0, count: 1 },
          { item_id: 'scrap_metal', rate: -0.5, count: 1 },
        ],
      },
    };
    for (let i = 0; i < 50; i++) {
      expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, pool, itemTable, defaultCfg, rng)).toEqual([]);
    }
  });

  it('item_id 空跳过', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const pool: ScatterPool = {
      shallow: { refresh: [{ item_id: '', rate: 1.0, count: 1 }] },
    };
    expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, pool, itemTable, defaultCfg, rng)).toEqual([]);
  });

  it('item_id 模板缺失跳过', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const pool: ScatterPool = {
      shallow: { refresh: [{ item_id: 'nonexistent', rate: 1.0, count: 1 }] },
    };
    expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, pool, itemTable, defaultCfg, rng)).toEqual([]);
  });

  it('scatter_pool[tide].refresh 缺失跳过', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const pool: ScatterPool = { shallow: {} }; // 无 refresh
    expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, pool, itemTable, defaultCfg, rng)).toEqual([]);
  });

  it('tile 不存在跳过', () => {
    const rng = createRng(42);
    const tiles: TileMap = {}; // 无 tile
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    expect(oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng)).toEqual([]);
  });
});

describe('oblRefreshWildItems - 纯函数与可复现性', () => {
  it('纯函数：输入 tileStates 不被修改', () => {
    const rng = createRng(42);
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const original = JSON.parse(JSON.stringify(states));
    oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng);
    expect(JSON.parse(JSON.stringify(states))).toEqual(original);
  });

  it('相同 seed 产生相同结果', () => {
    const tiles: TileMap = { 1: { passable: true, tide: 'shallow' } };
    const states: TileRefreshStateMap = { 1: makeState(1, 0) };
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng1);
    const seq2 = oblRefreshWildItems(defaultTransition, tiles, states, {}, scatterPool, itemTable, defaultCfg, rng2);
    expect(seq1).toEqual(seq2);
  });
});
