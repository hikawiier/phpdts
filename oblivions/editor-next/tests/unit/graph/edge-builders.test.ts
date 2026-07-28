//
// edge-builders 单元测试——O-3 §4.4 关系边构建
//
// 覆盖点：
//   - buildEffectFuncNodes：从 item.use_effects.func.php 提取 6 个 effect.func 节点
//   - buildEffectFuncNodes：注释中的 function 定义不匹配
//   - buildEffectFuncNodes：同名函数重复定义时按首次为准
//   - buildItemRecipeEdges：renders_as 边（item.template ↔ presentation.item）
//   - buildItemRecipeEdges：renders_as 边（recipe.template ↔ presentation.recipe）
//   - buildItemRecipeEdges：孤儿 presentation（innate_craft_t0）不构建 renders_as
//   - buildItemRecipeEdges：consumes_item / consumes_tag / consumes_itmk 边
//   - buildItemRecipeEdges：produces_item 边
//   - buildItemRecipeEdges：uses_effect 边
//   - buildItemRecipeEdges：空槽位跳过
//   - buildItemRecipeEdges：同一 recipe 多 slot 引用同一 item 用序号区分
//

import { describe, it, expect } from 'vitest';
import { buildEffectFuncNodes } from '@/graph/edge-builders/effect-func-builder';
import { buildItemRecipeEdges } from '@/graph/edge-builders/item-recipe-edge-builder';
import { KNOWN_USE_EFFECTS } from '@/schema/kinds/effect-func';
import type { ResourceNode } from '@/graph/types';

// ─── 测试工具：构造 ResourceNode ─────────────────────────

function makeItemTemplate(
  id: string,
  data: Partial<{ use_effect: string }> = {},
): ResourceNode {
  return {
    kind: 'item.template',
    id,
    data,
    source: [],
    revision: '',
  };
}

function makeRecipeTemplate(
  id: string,
  data: {
    category?: string;
    materials?: Array<{
      item_id?: string;
      itmk?: string;
      tag?: string;
      count?: number;
      consume?: string;
      min_level?: number;
    }>;
    results?: Array<{ item_id: string; count?: number }>;
  } = {},
): ResourceNode {
  return {
    kind: 'recipe.template',
    id,
    data,
    source: [],
    revision: '',
  };
}

function makePresentationItem(id: string): ResourceNode {
  return {
    kind: 'presentation.item',
    id,
    data: { name: id, desc: '' },
    source: [],
    revision: '',
  };
}

function makePresentationRecipe(id: string): ResourceNode {
  return {
    kind: 'presentation.recipe',
    id,
    data: { name: id, desc: '' },
    source: [],
    revision: '',
  };
}

function makeEffectFunc(id: string): ResourceNode {
  return {
    kind: 'effect.func',
    id,
    data: { name: id, signature: `item_use_effect_${id}($item, &$pdata)` },
    source: [],
    revision: '',
  };
}

// ─── 测试：buildEffectFuncNodes ─────────────────────────

describe('buildEffectFuncNodes', () => {
  it('从 item.use_effects.func.php 提取 6 个 effect.func 节点', () => {
    const content = `<?php
// 注释
function item_use_effect_restore_hp($item, &$pdata) {
    // body
}

function item_use_effect_restore_sp($item, &$pdata) {
    // body
}

function item_use_effect_cure_bs($item, &$pdata) {
    // body
}

function item_use_effect_gain_resistance($item, &$pdata) {
    // body
}

function item_use_effect_open_gift_box($item, &$pdata) {
    // body
}

function item_use_effect_place_poi($item, &$pdata) {
    // body
}
`;

    const nodes = buildEffectFuncNodes(
      'oblivions/include/game/item/item.use_effects.func.php',
      content,
    );

    expect(nodes).toHaveLength(6);
    const names = nodes.map((n) => n.id).sort();
    expect(names).toEqual([...KNOWN_USE_EFFECTS].sort());

    // 节点结构校验
    const first = nodes[0]!;
    expect(first.kind).toBe('effect.func');
    expect(first.data.name).toBe(first.id);
    expect(first.data.signature).toContain('item_use_effect_');
    expect(first.data.signature).toContain('($item, &$pdata)');
  });

  it('注释中的 function 定义不匹配', () => {
    const content = `<?php
// function item_use_effect_fake($item, &$pdata) {
//   注释里的伪定义不应被匹配
// }

function item_use_effect_restore_hp($item, &$pdata) {
    // body
}
`;

    const nodes = buildEffectFuncNodes('test.php', content);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('restore_hp');
  });

  it('同名函数重复定义时按首次为准', () => {
    const content = `<?php
function item_use_effect_restore_hp($item, &$pdata) {
    // 第一次定义
}

function item_use_effect_restore_hp($item, &$pdata) {
    // 第二次定义（不应出现）
}
`;

    const nodes = buildEffectFuncNodes('test.php', content);
    expect(nodes).toHaveLength(1);
  });

  it('空内容返回空数组', () => {
    expect(buildEffectFuncNodes('test.php', '')).toEqual([]);
    expect(buildEffectFuncNodes('test.php', '<?php // 无函数定义')).toEqual([]);
  });
});

// ─── 测试：buildItemRecipeEdges ─────────────────────────

describe('buildItemRecipeEdges', () => {
  describe('renders_as 边', () => {
    it('item.template ↔ presentation.item：ID 相同构建 renders_as 边', () => {
      const nodes = [
        makeItemTemplate('rusty_pipe'),
        makePresentationItem('rusty_pipe'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const rendersAs = edges.filter((e) => e.type === 'renders_as');

      expect(rendersAs).toHaveLength(1);
      expect(rendersAs[0]!.from).toBe('item.template:rusty_pipe');
      expect(rendersAs[0]!.to).toBe('presentation.item:rusty_pipe');
    });

    it('recipe.template ↔ presentation.recipe：ID 相同构建 renders_as 边', () => {
      const nodes = [
        makeRecipeTemplate('craft_bandage'),
        makePresentationRecipe('craft_bandage'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const rendersAs = edges.filter((e) => e.type === 'renders_as');

      expect(rendersAs).toHaveLength(1);
      expect(rendersAs[0]!.from).toBe('recipe.template:craft_bandage');
      expect(rendersAs[0]!.to).toBe('presentation.recipe:craft_bandage');
    });

    it('孤儿 presentation（innate_craft_t0）不构建 renders_as 边', () => {
      const nodes = [
        // 只有 presentation.item，无对应 item.template
        makePresentationItem('innate_craft_t0'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const rendersAs = edges.filter((e) => e.type === 'renders_as');
      expect(rendersAs).toHaveLength(0);
    });

    it('item.template 缺少 presentation.item 时不构建 renders_as 边', () => {
      const nodes = [
        makeItemTemplate('orphan_item'), // 无对应 presentation
      ];

      const edges = buildItemRecipeEdges(nodes);
      const rendersAs = edges.filter((e) => e.type === 'renders_as');
      expect(rendersAs).toHaveLength(0);
    });
  });

  describe('consumes_* 边', () => {
    it('materials[].item_id → consumes_item 边', () => {
      const nodes = [
        makeRecipeTemplate('craft_bandage', {
          materials: [{ item_id: 'cloth', count: 3 }],
        }),
        makeItemTemplate('cloth'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const consumes = edges.filter((e) => e.type === 'consumes_item');

      expect(consumes).toHaveLength(1);
      expect(consumes[0]!.from).toBe('recipe.template:craft_bandage');
      expect(consumes[0]!.to).toBe('item.template:cloth');
      expect(consumes[0]!.metadata).toMatchObject({
        slot_index: 0,
        match_mode: 'item_id',
      });
    });

    it('materials[].itmk → consumes_itmk 边（含 metadata.itmk）', () => {
      const nodes = [
        makeRecipeTemplate('craft_x', {
          materials: [{ itmk: 'WP', count: 1 }],
        }),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const consumes = edges.filter((e) => e.type === 'consumes_itmk');

      expect(consumes).toHaveLength(1);
      expect(consumes[0]!.metadata).toMatchObject({
        slot_index: 0,
        match_mode: 'itmk',
        itmk: 'WP',
      });
    });

    it('materials[].tag → consumes_tag 边（含 metadata.tag）', () => {
      const nodes = [
        makeRecipeTemplate('craft_y', {
          materials: [{ tag: 'tag_cooking_tool', consume: 'none' }],
        }),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const consumes = edges.filter((e) => e.type === 'consumes_tag');

      expect(consumes).toHaveLength(1);
      expect(consumes[0]!.metadata).toMatchObject({
        slot_index: 0,
        match_mode: 'tag',
        tag: 'tag_cooking_tool',
      });
    });

    it('同一 recipe 多 slot 引用同一 item：用 slot_index 序号区分', () => {
      const nodes = [
        makeRecipeTemplate('multi_slot', {
          materials: [
            { item_id: 'cloth', count: 2 },
            { item_id: 'cloth', count: 1 }, // 同一 item，不同 slot
          ],
        }),
        makeItemTemplate('cloth'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const consumes = edges.filter((e) => e.type === 'consumes_item');

      expect(consumes).toHaveLength(2);
      // 边 ID 应不同（slot_index 序号不同）
      const edgeIds = consumes.map((e) => e.id);
      expect(new Set(edgeIds).size).toBe(2);
      // slot_index 元数据不同
      const slotIndices = consumes.map((e) => e.metadata!.slot_index).sort();
      expect(slotIndices).toEqual([0, 1]);
    });

    it('materials 为空数组：跳过 consumes_* 边构建', () => {
      const nodes = [
        makeRecipeTemplate('empty_materials', { materials: [] }),
      ];

      const edges = buildItemRecipeEdges(nodes);
      expect(edges.filter((e) => e.type.startsWith('consumes_'))).toHaveLength(0);
    });

    it('materials 缺失：跳过 consumes_* 边构建', () => {
      const nodes = [makeRecipeTemplate('no_materials', {})];

      const edges = buildItemRecipeEdges(nodes);
      expect(edges.filter((e) => e.type.startsWith('consumes_'))).toHaveLength(0);
    });
  });

  describe('produces_item 边', () => {
    it('results[].item_id → produces_item 边', () => {
      const nodes = [
        makeRecipeTemplate('craft_bandage', {
          results: [{ item_id: 'bandage', count: 1 }],
        }),
        makeItemTemplate('bandage'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const produces = edges.filter((e) => e.type === 'produces_item');

      expect(produces).toHaveLength(1);
      expect(produces[0]!.from).toBe('recipe.template:craft_bandage');
      expect(produces[0]!.to).toBe('item.template:bandage');
      expect(produces[0]!.metadata).toMatchObject({
        slot_index: 0,
        count: 1,
      });
    });

    it('多产物配方：每个 result 一条 produces_item 边', () => {
      const nodes = [
        makeRecipeTemplate('multi_produce', {
          results: [
            { item_id: 'item_a', count: 2 },
            { item_id: 'item_b', count: 1 },
          ],
        }),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const produces = edges.filter((e) => e.type === 'produces_item');
      expect(produces).toHaveLength(2);
    });

    it('results 缺失：跳过 produces_item 边构建', () => {
      const nodes = [makeRecipeTemplate('no_results', {})];
      const edges = buildItemRecipeEdges(nodes);
      expect(edges.filter((e) => e.type === 'produces_item')).toHaveLength(0);
    });
  });

  describe('uses_effect 边', () => {
    it('item.use_effect 非空 → uses_effect 边', () => {
      const nodes = [
        makeItemTemplate('bread', { use_effect: 'restore_hp' }),
        makeEffectFunc('restore_hp'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const uses = edges.filter((e) => e.type === 'uses_effect');

      expect(uses).toHaveLength(1);
      expect(uses[0]!.from).toBe('item.template:bread');
      expect(uses[0]!.to).toBe('effect.func:restore_hp');
    });

    it('item.use_effect 为空字符串：跳过 uses_effect 边', () => {
      const nodes = [makeItemTemplate('no_effect_item', { use_effect: '' })];

      const edges = buildItemRecipeEdges(nodes);
      expect(edges.filter((e) => e.type === 'uses_effect')).toHaveLength(0);
    });

    it('item.use_effect 缺失：跳过 uses_effect 边', () => {
      const nodes = [makeItemTemplate('no_field_item', {})];

      const edges = buildItemRecipeEdges(nodes);
      expect(edges.filter((e) => e.type === 'uses_effect')).toHaveLength(0);
    });

    it('use_effect 引用未注册的 effect.func：仍构建边（O-10 检测 dangling）', () => {
      const nodes = [
        makeItemTemplate('dangling_item', { use_effect: 'unknown_effect' }),
        // 不创建 unknown_effect 的 effect.func 节点
      ];

      const edges = buildItemRecipeEdges(nodes);
      const uses = edges.filter((e) => e.type === 'uses_effect');
      expect(uses).toHaveLength(1);
      expect(uses[0]!.to).toBe('effect.func:unknown_effect');
    });
  });

  describe('综合场景', () => {
    it('完整 recipe：consumes + produces + renders_as 同时构建', () => {
      const nodes = [
        makeItemTemplate('cloth'),
        makeItemTemplate('bandage'),
        makePresentationItem('cloth'),
        makePresentationItem('bandage'),
        makeRecipeTemplate('craft_bandage', {
          materials: [{ item_id: 'cloth', count: 3 }],
          results: [{ item_id: 'bandage', count: 1 }],
        }),
        makePresentationRecipe('craft_bandage'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const types = new Set(edges.map((e) => e.type));

      expect(types.has('renders_as')).toBe(true);
      expect(types.has('consumes_item')).toBe(true);
      expect(types.has('produces_item')).toBe(true);

      // 4 条 renders_as（cloth + bandage + craft_bandage）→ 但只有 3 个有对应 presentation
      // item:clobber↔presentation:clobber + item:bandage↔presentation:bandage + recipe:craft_bandage↔presentation:craft_bandage = 3
      expect(edges.filter((e) => e.type === 'renders_as')).toHaveLength(3);
      expect(edges.filter((e) => e.type === 'consumes_item')).toHaveLength(1);
      expect(edges.filter((e) => e.type === 'produces_item')).toHaveLength(1);
    });

    it('空节点列表返回空边数组', () => {
      expect(buildItemRecipeEdges([])).toEqual([]);
    });

    it('边 ID 唯一性：同类型多边 ID 不冲突', () => {
      const nodes = [
        makeRecipeTemplate('r1', {
          materials: [{ item_id: 'a' }, { item_id: 'b' }],
        }),
        makeItemTemplate('a'),
        makeItemTemplate('b'),
      ];

      const edges = buildItemRecipeEdges(nodes);
      const edgeIds = edges.map((e) => e.id);
      expect(new Set(edgeIds).size).toBe(edgeIds.length);
    });
  });
});
