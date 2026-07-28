/**
 * @module O 内容工具箱
 *
 * obl-roll-group 单元测试。
 *
 * 覆盖点（对齐 PHP loot.engine.func.php:139-205 边界）：
 *   - chance <= 0 返回空数组
 *   - chance >= 1.0 必中（不消耗 rng）
 *   - 0 < chance < 1.0 按 rng 判定
 *   - 空 entries 返回空数组
 *   - count 单值 → 生成 N 个实例
 *   - count=[min,max] → 在区间内取值
 *   - count=[max,min]（min>max）自动 swap
 *   - count <= 0 兜底为 1
 *   - item_id 缺失/空字符串返回空数组
 *   - 模板不存在返回空数组
 *   - stackable 物品 itms=count（超 stack_limit 自动分批）
 *   - 非 stackable 物品 N 个独立实例，itms=模板 itms
 *   - stack_limit < 1 兜底为 1
 *   - itmpara 字符串 JSON 解析为数组
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import { oblRollGroup, instantiateItem } from '../obl-roll-group';
import type { ItemTable, LootGroup } from '../types';

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
  compass: {
    itmk: 'TK',
    itme: 0,
    itms: '∞',
    itmsk: '',
    itmpara: '',
    stack: false,
  },
  scrap_metal: {
    itmk: 'MT',
    itme: 0,
    itms: '1',
    itmsk: '',
    itmpara: '{"key":"value"}',
    stack: true,
    stack_limit: 99,
  },
};

describe('oblRollGroup - chance 判定', () => {
  it('chance <= 0 返回空数组', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 0,
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    expect(oblRollGroup(group, itemTable, rng)).toEqual([]);
  });

  it('chance 为负数返回空数组', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: -0.5,
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    expect(oblRollGroup(group, itemTable, rng)).toEqual([]);
  });

  it('chance >= 1.0 必中（不依赖 rng 概率判定）', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    // 多次调用应都成功
    for (let i = 0; i < 20; i++) {
      const result = oblRollGroup(group, itemTable, rng);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('chance > 1.0 视为必中（防御性）', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 2.5,
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result.length).toBeGreaterThan(0);
  });

  it('0 < chance < 1.0 按 rng 判定——低 chance 多次运行至少有一次失败', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 0.01, // 1% 概率
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    let hitCount = 0;
    for (let i = 0; i < 500; i++) {
      if (oblRollGroup(group, itemTable, rng).length > 0) hitCount++;
    }
    // 1% 概率 × 500 次 → 期望 5 次命中，宽松校验 < 50（必然有失败）
    expect(hitCount).toBeLessThan(50);
    expect(hitCount).toBeGreaterThanOrEqual(0);
  });

  it('chance 缺失按 1.0 计', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('oblRollGroup - entries 边界', () => {
  it('空 entries 返回空数组', () => {
    const rng = createRng(42);
    const group: LootGroup = { chance: 1.0, entries: [] };
    expect(oblRollGroup(group, itemTable, rng)).toEqual([]);
  });

  it('entries 缺失按空数组处理', () => {
    const rng = createRng(42);
    const group = { chance: 1.0 } as LootGroup;
    expect(oblRollGroup(group, itemTable, rng)).toEqual([]);
  });

  it('item_id 为空字符串返回空数组', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: '', weight: 1, count: 1 }],
    };
    expect(oblRollGroup(group, itemTable, rng)).toEqual([]);
  });

  it('item_id 模板不存在返回空数组', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'nonexistent', weight: 1, count: 1 }],
    };
    expect(oblRollGroup(group, itemTable, rng)).toEqual([]);
  });
});

describe('oblRollGroup - count 解析', () => {
  it('count 单值 → 生成 N 个实例', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1, count: 3 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(3);
    // 非 stackable，每个实例 itms=模板 itms
    for (const item of result) {
      expect(item.itms).toBe('20');
      expect(item.itmid).toBe('rusty_pipe');
    }
  });

  it('count=[min,max] → 在区间内取值', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1, count: [2, 5] }],
    };
    for (let i = 0; i < 20; i++) {
      const result = oblRollGroup(group, itemTable, rng);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(5);
    }
  });

  it('count=[max,min]（min>max）自动 swap', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1, count: [5, 2] }],
    };
    for (let i = 0; i < 20; i++) {
      const result = oblRollGroup(group, itemTable, rng);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(5);
    }
  });

  it('count=0 兜底为 1', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1, count: 0 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(1);
  });

  it('count 为负数兜底为 1', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1, count: -3 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(1);
  });

  it('count 缺失按 1 计', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(1);
  });
});

describe('oblRollGroup - stackable 实例化', () => {
  it('stackable 物品 itms=count（单实例）', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'health_potion', weight: 1, count: 5 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(1);
    expect(result[0]!.itms).toBe('5');
    expect(result[0]!.itmid).toBe('health_potion');
  });

  it('stackable 物品超 stack_limit 自动分批', () => {
    const rng = createRng(42);
    // stack_limit=10, count=25 → 3 批（10 + 10 + 5）
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'health_potion', weight: 1, count: 25 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(3);
    expect(result[0]!.itms).toBe('10');
    expect(result[1]!.itms).toBe('10');
    expect(result[2]!.itms).toBe('5');
  });

  it('stack_limit < 1 兜底为 1', () => {
    const rng = createRng(42);
    const customTable: ItemTable = {
      broken_stack: {
        itmk: 'MT',
        itme: 0,
        itms: '1',
        itmsk: '',
        itmpara: '',
        stack: true,
        stack_limit: 0, // 兜底为 1
      },
    };
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'broken_stack', weight: 1, count: 3 }],
    };
    const result = oblRollGroup(group, customTable, rng);
    // stack_limit=1, count=3 → 3 批（1 + 1 + 1）
    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(item.itms).toBe('1');
    }
  });

  it('stack_limit 缺失按 1 计', () => {
    const rng = createRng(42);
    const customTable: ItemTable = {
      no_limit: {
        itmk: 'MT',
        itme: 0,
        itms: '1',
        itmsk: '',
        itmpara: '',
        stack: true,
        // stack_limit 缺失
      },
    };
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'no_limit', weight: 1, count: 3 }],
    };
    const result = oblRollGroup(group, customTable, rng);
    // stack_limit=1, count=3 → 3 批
    expect(result).toHaveLength(3);
  });
});

describe('oblRollGroup - 非 stackable 实例化', () => {
  it('非 stackable 物品 N 个独立实例，各 itms=模板 itms', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'rusty_pipe', weight: 1, count: 3 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(item.itms).toBe('20'); // 模板 itms
      expect(item.itmid).toBe('rusty_pipe');
      expect(item.itmk).toBe('WP');
      expect(item.itme).toBe(5);
    }
  });

  it('非 stackable + itms=\'∞\' 保留 ∞', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'compass', weight: 1, count: 2 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item.itms).toBe('∞');
    }
  });
});

describe('oblRollGroup - itmpara 解析', () => {
  it('itmpara 字符串 JSON 解析为数组', () => {
    const rng = createRng(42);
    const customTable: ItemTable = {
      json_item: {
        itmk: 'MT',
        itme: 0,
        itms: '1',
        itmsk: '',
        itmpara: '[1, 2, 3]',
        stack: true,
        stack_limit: 10,
      },
    };
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'json_item', weight: 1, count: 1 }],
    };
    const result = oblRollGroup(group, customTable, rng);
    expect(result[0]!.itmpara).toEqual([1, 2, 3]);
  });

  it('itmpara 非 JSON 字符串解析为空数组', () => {
    const rng = createRng(42);
    const customTable: ItemTable = {
      bad_json: {
        itmk: 'MT',
        itme: 0,
        itms: '1',
        itmsk: '',
        itmpara: 'not a json',
        stack: true,
        stack_limit: 10,
      },
    };
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'bad_json', weight: 1, count: 1 }],
    };
    const result = oblRollGroup(group, customTable, rng);
    expect(result[0]!.itmpara).toEqual([]);
  });

  it('itmpara 空字符串解析为空数组', () => {
    const rng = createRng(42);
    const group: LootGroup = {
      chance: 1.0,
      entries: [{ item_id: 'health_potion', weight: 1, count: 1 }],
    };
    const result = oblRollGroup(group, itemTable, rng);
    expect(result[0]!.itmpara).toEqual([]);
  });
});

describe('instantiateItem', () => {
  it('从模板实例化物品，字段对齐 itempara 七字段', () => {
    const template = {
      itmk: 'WP',
      itme: 10,
      itms: '20',
      itmsk: 'p',
      itmpara: '{"k":"v"}',
    };
    const instance = instantiateItem(template, 'test_item');
    expect(instance).toEqual({
      itm: '',
      itmk: 'WP',
      itme: 10,
      itms: '20',
      itmsk: 'p',
      itmpara: { k: 'v' }, // 对齐 PHP json_decode(,true)：{...} 解码为对象
      itmid: 'test_item',
    });
  });

  it('itmpara 为数组时直接拷贝', () => {
    const template = {
      itmk: 'WP',
      itme: 10,
      itms: '20',
      itmsk: '',
      itmpara: [1, 2, 3] as unknown[],
    };
    const instance = instantiateItem(template, 'test_item');
    expect(instance.itmpara).toEqual([1, 2, 3]);
  });
});

describe('oblRollGroup - 可复现性', () => {
  it('相同 seed 产生相同掷骰结果', () => {
    const group: LootGroup = {
      chance: 0.5,
      entries: [
        { item_id: 'health_potion', weight: 60, count: [1, 3] },
        { item_id: 'rusty_pipe', weight: 30, count: 1 },
        { item_id: 'compass', weight: 10, count: 1 },
      ],
    };
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 30; i++) {
      seq1.push(oblRollGroup(group, itemTable, rng1).length);
      seq2.push(oblRollGroup(group, itemTable, rng2).length);
    }
    expect(seq1).toEqual(seq2);
  });
});
