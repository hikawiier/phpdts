/**
 * @module O 内容工具箱
 *
 * obl-roll-loot-table 单元测试。
 *
 * 覆盖点（对齐 PHP loot.engine.func.php:63-117 边界）：
 *   - 表不存在返回空数组
 *   - loot_table_override 优先于 tableId
 *   - loot_table_override 为空字符串时使用 tableId
 *   - 空 groups 返回空数组
 *   - entries 总数 > OBL_LOOT_MAX_ENTRIES 返回空数组
 *   - 单 group 单 entry 正常掷骰
 *   - 多 group 累积物品实例
 *   - durability_decay=true 应用耐久衰减
 *   - durability_decay=false 不应用耐久衰减
 *   - 纯函数：输入不被修改
 *   - 相同 seed 产生相同掷骰结果
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import { oblRollLootTable, OBL_LOOT_MAX_ENTRIES } from '../obl-roll-loot-table';
import type { ItemTable, LootTables } from '../types';

const itemTable: ItemTable = {
  health_potion: {
    itmk: 'HH',
    itme: 30,
    itms: '1',
    itmsk: '',
    itmpara: '',
    stack: true,
    stack_limit: 10,
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

const lootTables: LootTables = {
  basic_loot: {
    name: '基础掉落表',
    durability_decay: false,
    groups: [
      {
        chance: 1.0,
        entries: [
          { item_id: 'health_potion', weight: 1, count: 1 },
        ],
      },
    ],
  },
  multi_group_loot: {
    name: '多组掉落表',
    durability_decay: false,
    groups: [
      {
        chance: 1.0,
        entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
      },
      {
        chance: 1.0,
        entries: [{ item_id: 'rusty_pipe', weight: 1, count: 1 }],
      },
    ],
  },
  decay_loot: {
    name: '衰减掉落表',
    durability_decay: true,
    groups: [
      {
        chance: 1.0,
        entries: [{ item_id: 'rusty_pipe', weight: 1, count: 1 }],
      },
    ],
  },
  empty_loot: {
    name: '空表',
    durability_decay: false,
    groups: [],
  },
};

describe('oblRollLootTable - 表查询', () => {
  it('表不存在返回空数组', () => {
    const rng = createRng(42);
    expect(oblRollLootTable('nonexistent', lootTables, itemTable, rng)).toEqual([]);
  });

  it('loot_table_override 优先于 tableId', () => {
    const rng = createRng(42);
    const result = oblRollLootTable('empty_loot', lootTables, itemTable, rng, {
      loot_table_override: 'basic_loot',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.itmid).toBe('health_potion');
  });

  it('loot_table_override 为空字符串时使用 tableId', () => {
    const rng = createRng(42);
    const result = oblRollLootTable('basic_loot', lootTables, itemTable, rng, {
      loot_table_override: '',
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.itmid).toBe('health_potion');
  });

  it('loot_table_override 指向不存在的表返回空数组', () => {
    const rng = createRng(42);
    expect(
      oblRollLootTable('basic_loot', lootTables, itemTable, rng, {
        loot_table_override: 'missing_table',
      }),
    ).toEqual([]);
  });

  it('空 groups 返回空数组', () => {
    const rng = createRng(42);
    expect(oblRollLootTable('empty_loot', lootTables, itemTable, rng)).toEqual([]);
  });
});

describe('oblRollLootTable - entries 上限校验', () => {
  it('entries 总数 > OBL_LOOT_MAX_ENTRIES 返回空数组', () => {
    const rng = createRng(42);
    // 构造一个超限表：101 个 entries
    const entries = Array.from({ length: 101 }, () => ({
      item_id: 'health_potion',
      weight: 1,
      count: 1,
    }));
    const oversizedTable: LootTables = {
      oversized: {
        name: '超限表',
        durability_decay: false,
        groups: [{ chance: 1.0, entries }],
      },
    };
    expect(oblRollLootTable('oversized', oversizedTable, itemTable, rng)).toEqual([]);
  });

  it('entries 总数 = OBL_LOOT_MAX_ENTRIES 正常掷骰', () => {
    const rng = createRng(42);
    const entries = Array.from({ length: OBL_LOOT_MAX_ENTRIES }, () => ({
      item_id: 'health_potion',
      weight: 1,
      count: 1,
    }));
    const limitTable: LootTables = {
      limit: {
        name: '上限表',
        durability_decay: false,
        groups: [{ chance: 1.0, entries }],
      },
    };
    const result = oblRollLootTable('limit', limitTable, itemTable, rng);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('oblRollLootTable - 多组累积', () => {
  it('单 group 单 entry 正常掷骰', () => {
    const rng = createRng(42);
    const result = oblRollLootTable('basic_loot', lootTables, itemTable, rng);
    expect(result).toHaveLength(1);
    expect(result[0]!.itmid).toBe('health_potion');
  });

  it('多 group 累积物品实例', () => {
    const rng = createRng(42);
    const result = oblRollLootTable('multi_group_loot', lootTables, itemTable, rng);
    expect(result).toHaveLength(2);
    expect(result[0]!.itmid).toBe('health_potion');
    expect(result[1]!.itmid).toBe('rusty_pipe');
  });
});

describe('oblRollLootTable - durability_decay', () => {
  it('durability_decay=false 不应用耐久衰减', () => {
    const rng = createRng(42);
    // health_potion 是 stackable，本就不衰减；改用非 stackable 验证
    const result2 = oblRollLootTable(
      'multi_group_loot',
      lootTables,
      itemTable,
      rng,
    );
    const pipe = result2.find((r) => r.itmid === 'rusty_pipe');
    expect(pipe).toBeDefined();
    // durability_decay=false，itms 保留模板原值 '20'
    expect(pipe!.itms).toBe('20');
  });

  it('durability_decay=true 应用耐久衰减', () => {
    const rng = createRng(42);
    const result = oblRollLootTable('decay_loot', lootTables, itemTable, rng);
    expect(result).toHaveLength(1);
    expect(result[0]!.itmid).toBe('rusty_pipe');
    // 衰减后 itms 在 [1, 20] 范围内
    const decayed = parseInt(result[0]!.itms, 10);
    expect(decayed).toBeGreaterThanOrEqual(1);
    expect(decayed).toBeLessThanOrEqual(20);
  });
});

describe('oblRollLootTable - 纯函数与可复现性', () => {
  it('纯函数：输入 lootTables 不被修改', () => {
    const rng = createRng(42);
    const original = JSON.parse(JSON.stringify(lootTables));
    oblRollLootTable('basic_loot', lootTables, itemTable, rng);
    expect(JSON.parse(JSON.stringify(lootTables))).toEqual(original);
  });

  it('相同 seed 产生相同掷骰结果', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = oblRollLootTable('multi_group_loot', lootTables, itemTable, rng1);
    const seq2 = oblRollLootTable('multi_group_loot', lootTables, itemTable, rng2);
    expect(seq1).toEqual(seq2);
  });
});
