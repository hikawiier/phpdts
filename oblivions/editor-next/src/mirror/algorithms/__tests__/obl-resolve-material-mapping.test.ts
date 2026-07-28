/**
 * @module O 内容工具箱
 *
 * obl-resolve-material-mapping 单元测试。
 *
 * 覆盖点（对齐 PHP item.craft.func.php:227-338 边界）：
 *   - itemCanConsume: consume='none' 任何素材可匹配
 *   - itemCanConsume: 工作台素材不能匹配 consume='all'/'durability'
 *   - 空 materials 返回 null（无素材被消耗）
 *   - 空 placedItems 返回 null（素材未全部消耗）
 *   - 精确匹配 item_id 优先
 *   - 类别匹配 itmk 次之
 *   - 性质匹配 tag 最后
 *   - min_level 检查：素材 tool_level < min_level 不匹配
 *   - consume='none' 工作台素材可匹配
 *   - 工作台素材不能匹配 consume='all'/'durability'
 *   - 完全消耗约束：多放也不匹配
 *   - 同一素材不能同时满足多个槽位
 *   - count 多份：同 item_id 多个 placed_item
 *   - 纯函数：输入不被修改
 *   - itemMaterialsMatch 布尔包装一致
 */

import { describe, it, expect } from 'vitest';
import {
  itemResolveMaterialMapping,
  itemMaterialsMatch,
  itemCanConsume,
  type MaterialRequirement,
  type PlacedItem,
} from '../obl-resolve-material-mapping';

function makeBagItem(
  itemId: string,
  itmk: string,
  tags: string[] = [],
  toolLevel = 0,
): PlacedItem {
  return {
    item_id: itemId,
    itmk,
    tags,
    tool_level: toolLevel,
    source: 'bag',
  };
}

function makeWorkbenchItem(
  itemId: string,
  itmk: string,
  tags: string[] = [],
  toolLevel = 0,
): PlacedItem {
  return {
    item_id: itemId,
    itmk,
    tags,
    tool_level: toolLevel,
    source: 'workbench',
  };
}

describe('itemCanConsume', () => {
  it("consume='none' 任何素材可匹配", () => {
    expect(itemCanConsume({ source: 'bag' }, 'none')).toBe(true);
    expect(itemCanConsume({ source: 'workbench' }, 'none')).toBe(true);
  });

  it("工作台素材不能匹配 consume='all'", () => {
    expect(itemCanConsume({ source: 'workbench' }, 'all')).toBe(false);
    expect(itemCanConsume({ source: 'bag' }, 'all')).toBe(true);
  });

  it("工作台素材不能匹配 consume='durability'", () => {
    expect(itemCanConsume({ source: 'workbench' }, 'durability')).toBe(false);
    expect(itemCanConsume({ source: 'bag' }, 'durability')).toBe(true);
  });
});

describe('itemResolveMaterialMapping - 边界', () => {
  it('空 materials 返回 null（无消耗）', () => {
    const placed: PlacedItem[] = [makeBagItem('a', 'MT')];
    expect(itemResolveMaterialMapping([], placed)).toBeNull();
  });

  it('空 placedItems 返回 null（素材未全部消耗）', () => {
    const materials: MaterialRequirement[] = [{ item_id: 'a', count: 1 }];
    expect(itemResolveMaterialMapping(materials, [])).toBeNull();
  });

  it('两者都空返回 []（vacuous match）', () => {
    // PHP: 空 materials + 空 placed_items → 无需求 + 无素材 → 所有素材（0个）都被消耗 → 返回 []
    expect(itemResolveMaterialMapping([], [])).toEqual([]);
  });
});

describe('itemResolveMaterialMapping - item_id 精确匹配', () => {
  it('单素材单需求匹配', () => {
    const materials: MaterialRequirement[] = [{ item_id: 'scrap_metal', count: 1 }];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]!.placed_index).toBe(0);
    expect(result![0]!.consume).toBe('all');
  });

  it('count > 1：需要多个同 item_id 素材', () => {
    const materials: MaterialRequirement[] = [{ item_id: 'scrap_metal', count: 3 }];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('scrap_metal', 'MT'),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
  });

  it('素材数量不足返回 null', () => {
    const materials: MaterialRequirement[] = [{ item_id: 'scrap_metal', count: 3 }];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('scrap_metal', 'MT'),
    ];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });

  it('item_id 不匹配返回 null', () => {
    const materials: MaterialRequirement[] = [{ item_id: 'scrap_metal', count: 1 }];
    const placed: PlacedItem[] = [makeBagItem('rusty_pipe', 'WP')];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });
});

describe('itemResolveMaterialMapping - itmk 类别匹配', () => {
  it('itmk 匹配成功', () => {
    const materials: MaterialRequirement[] = [{ itmk: 'MT', count: 1 }];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });

  it('itmk 不匹配返回 null', () => {
    const materials: MaterialRequirement[] = [{ itmk: 'MT', count: 1 }];
    const placed: PlacedItem[] = [makeBagItem('rusty_pipe', 'WP')];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });
});

describe('itemResolveMaterialMapping - tag 性质匹配', () => {
  it('tag 匹配成功', () => {
    const materials: MaterialRequirement[] = [{ tag: 'tag_sharp', count: 1 }];
    const placed: PlacedItem[] = [
      makeBagItem('rusty_pipe', 'WP', ['tag_sharp', 'tag_metal']),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });

  it('tag 不匹配返回 null', () => {
    const materials: MaterialRequirement[] = [{ tag: 'tag_sharp', count: 1 }];
    const placed: PlacedItem[] = [
      makeBagItem('rusty_pipe', 'WP', ['tag_metal']),
    ];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });

  it('tags 为空数组不匹配任何 tag', () => {
    const materials: MaterialRequirement[] = [{ tag: 'tag_sharp', count: 1 }];
    const placed: PlacedItem[] = [makeBagItem('rusty_pipe', 'WP', [])];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });
});

describe('itemResolveMaterialMapping - 匹配优先级', () => {
  it('item_id 优先于 itmk', () => {
    // 一个素材同时满足 item_id 和 itmk 需求，应优先匹配 item_id
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
      { itmk: 'MT', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'), // 同时满足 item_id 和 itmk
      makeBagItem('other_metal', 'MT'), // 仅满足 itmk
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    // 第一个匹配 item_id 需求 → placed_index=0
    // 第二个匹配 itmk 需求 → placed_index=1
    expect(result![0]!.placed_index).toBe(0);
    expect(result![1]!.placed_index).toBe(1);
  });

  it('itmk 优先于 tag', () => {
    const materials: MaterialRequirement[] = [
      { itmk: 'MT', count: 1 },
      { tag: 'tag_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT', ['tag_metal']), // 同时满足 itmk 和 tag
      makeBagItem('other', 'XX', ['tag_metal']), // 仅满足 tag
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]!.placed_index).toBe(0);
    expect(result![1]!.placed_index).toBe(1);
  });

  it('item_id 优先于 tag（无 itmk 需求）', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
      { tag: 'tag_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT', ['tag_metal']),
      makeBagItem('other', 'XX', ['tag_metal']),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]!.placed_index).toBe(0);
    expect(result![1]!.placed_index).toBe(1);
  });
});

describe('itemResolveMaterialMapping - min_level 检查', () => {
  it('素材 tool_level >= min_level 匹配', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'forge_t1', count: 1, min_level: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('forge_t1', 'TK', [], 2),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
  });

  it('素材 tool_level < min_level 不匹配', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'forge_t1', count: 1, min_level: 2 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('forge_t1', 'TK', [], 1),
    ];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });

  it('min_level 缺失按 0 计（任何 tool_level 都满足）', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'forge_t1', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('forge_t1', 'TK', [], 0),
    ];
    expect(itemResolveMaterialMapping(materials, placed)).not.toBeNull();
  });
});

describe('itemResolveMaterialMapping - consume 约束', () => {
  it("consume='none' 工作台素材可匹配", () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'forge_t1', count: 1, consume: 'none' },
    ];
    const placed: PlacedItem[] = [
      makeWorkbenchItem('forge_t1', 'TK'),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result![0]!.consume).toBe('none');
  });

  it("consume='all' 工作台素材不能匹配", () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'forge_t1', count: 1, consume: 'all' },
    ];
    const placed: PlacedItem[] = [
      makeWorkbenchItem('forge_t1', 'TK'),
    ];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });

  it("consume='durability' 工作台素材不能匹配", () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'forge_t1', count: 1, consume: 'durability' },
    ];
    const placed: PlacedItem[] = [
      makeWorkbenchItem('forge_t1', 'TK'),
    ];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });

  it('consume 缺失按 all 计', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result![0]!.consume).toBe('all');
  });
});

describe('itemResolveMaterialMapping - 完全消耗约束', () => {
  it('多放也不匹配（有未被消耗的素材）', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('other', 'XX'), // 未被消耗
    ];
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });

  it('所有素材都被消耗返回映射', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
      { item_id: 'other', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('other', 'XX'),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
  });
});

describe('itemResolveMaterialMapping - 同一素材不重复消耗', () => {
  it('同一素材不能同时满足多个槽位', () => {
    // 一个素材 + 两个需求 → 第一个需求消耗后第二个无法满足
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
      { itmk: 'MT', count: 1 },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'),
    ];
    // 第一个需求消耗该素材，第二个需求无素材可用 → 返回 null
    expect(itemResolveMaterialMapping(materials, placed)).toBeNull();
  });
});

describe('itemResolveMaterialMapping - 纯函数', () => {
  it('纯函数：输入 materials 不被修改', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    const original = JSON.parse(JSON.stringify(materials));
    itemResolveMaterialMapping(materials, placed);
    expect(JSON.parse(JSON.stringify(materials))).toEqual(original);
  });

  it('纯函数：输入 placedItems 不被修改', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    const original = JSON.parse(JSON.stringify(placed));
    itemResolveMaterialMapping(materials, placed);
    expect(JSON.parse(JSON.stringify(placed))).toEqual(original);
  });
});

describe('itemMaterialsMatch - 布尔包装', () => {
  it('匹配成功返回 true', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 1 },
    ];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    expect(itemMaterialsMatch(materials, placed)).toBe(true);
  });

  it('匹配失败返回 false', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'nonexistent', count: 1 },
    ];
    const placed: PlacedItem[] = [makeBagItem('scrap_metal', 'MT')];
    expect(itemMaterialsMatch(materials, placed)).toBe(false);
  });
});

describe('itemResolveMaterialMapping - 综合场景', () => {
  it('综合：item_id + itmk + tag + min_level + consume', () => {
    const materials: MaterialRequirement[] = [
      { item_id: 'scrap_metal', count: 2, consume: 'all' },
      { itmk: 'WP', count: 1, consume: 'durability', min_level: 1 },
      { tag: 'tag_tool', count: 1, consume: 'none' },
    ];
    const placed: PlacedItem[] = [
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('scrap_metal', 'MT'),
      makeBagItem('rusty_pipe', 'WP', ['tag_sharp'], 1),
      makeWorkbenchItem('forge_t1', 'TK', ['tag_tool'], 2),
    ];
    const result = itemResolveMaterialMapping(materials, placed);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);
    // item_id 需求消耗 placed[0] 和 placed[1]
    // itmk 需求消耗 placed[2]
    // tag 需求消耗 placed[3]（工作台素材只能匹配 consume='none'）
    const consumeMap = new Map(result!.map((r) => [r.placed_index, r.consume]));
    expect(consumeMap.get(0)).toBe('all');
    expect(consumeMap.get(1)).toBe('all');
    expect(consumeMap.get(2)).toBe('durability');
    expect(consumeMap.get(3)).toBe('none');
  });
});
