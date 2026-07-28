/**
 * @module O 内容工具箱
 *
 * recipe-match 算法夹具单元测试。
 *
 * 覆盖点（对齐执行案 §4.2.5）：
 *   - 空 graph 返回空输出且无不变量违反
 *   - 正常 graph：每个 recipe 尝试匹配
 *   - 匹配成功的 recipe：count +1，mapping 非 null
 *   - 匹配失败的 recipe（缺素材）：count +0，mapping 为 null
 *   - distribution[recipeId] = 1（成功）/ 0（失败）
 *   - 不变量：material 同时声明多个匹配键（item_id/itmk/tag 互斥）
 *   - 不变量：工作台槽位（consume='none'）必须用 tag 匹配
 *   - 纯函数：相同 graph 产生相同输出
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGraphStore } from '@/graph/graph-store';
import {
  run,
  recipeMatchMirror,
  RECIPE_MATCH_MIRROR_ID,
  type RecipeMatchMirrorOutput,
} from '../recipe-match-mirror';
import type { ResourceNode } from '@/graph/types';

// ─── 测试数据 ───────────────────────────────────────────────────

function makeRecipeNode(
  id: string,
  materials: Array<{
    item_id?: string;
    itmk?: string;
    tag?: string;
    count?: number;
    consume?: 'all' | 'durability' | 'none';
    min_level?: number;
  }>,
  results: Array<{ item_id: string; count: number }>,
): ResourceNode {
  return {
    kind: 'recipe.template',
    id,
    data: {
      category: 'test',
      materials,
      results,
    },
    source: [],
    revision: '',
  };
}

function makeItemNode(
  id: string,
  itmk: string = 'MT',
  tags: string[] = [],
  toolLevel: number = 0,
): ResourceNode {
  return {
    kind: 'item.template',
    id,
    data: {
      itmk,
      itme: 0,
      itms: '1',
      itmsk: '',
      itmpara: '',
      stack: true,
      tags,
      tool_level: toolLevel,
    },
    source: [],
    revision: '',
  };
}

// ─── 测试用例 ───────────────────────────────────────────────────

describe('recipeMatchMirror - 元信息', () => {
  it('ID 正确', () => {
    expect(recipeMatchMirror.id).toBe(RECIPE_MATCH_MIRROR_ID);
    expect(RECIPE_MATCH_MIRROR_ID).toBe('recipe-match');
  });

  it('requiredScopes 包含 craft_preview / craft_recipes / player_inventory', () => {
    expect(recipeMatchMirror.requiredScopes).toContain('craft_preview');
    expect(recipeMatchMirror.requiredScopes).toContain('craft_recipes');
    expect(recipeMatchMirror.requiredScopes).toContain('player_inventory');
  });

  it('compareOptions 是 exactMatch（无容忍度）', () => {
    expect(recipeMatchMirror.compareOptions.exactMatch).toBe(true);
  });
});

describe('recipeMatchMirror - run 边界', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('空 graph 返回空输出且无不变量违反', async () => {
    const result = await run(graphStore, {});
    expect(result.output).not.toBeNull();
    const output = result.output as RecipeMatchMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.matchResults).toEqual([]);
    expect(output.totalRecipes).toBe(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('无 recipe.template 节点但 item.template 节点存在时返回空', async () => {
    graphStore.upsertNodes([makeItemNode('item_a')]);
    const result = await run(graphStore, {});
    const output = result.output as RecipeMatchMirrorOutput;
    expect(output.totalRecipes).toBe(0);
  });
});

describe('recipeMatchMirror - 正常路径', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('匹配成功：item_id 精确匹配 + 素材足够', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [{ item_id: 'item_a', count: 1, consume: 'all' }],
        [{ item_id: 'item_result', count: 1 }],
      ),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as RecipeMatchMirrorOutput;

    expect(output.totalRecipes).toBe(1);
    expect(output.count).toBe(1);
    expect(output.matchResults).toHaveLength(1);
    expect(output.matchResults[0]!.matched).toBe(true);
    expect(output.matchResults[0]!.mapping).not.toBeNull();
    expect(output.distribution['recipe1']).toBe(1);
  });

  it('匹配失败：素材 item_id 在 item.template 中不存在', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [{ item_id: 'item_missing', count: 1, consume: 'all' }],
        [{ item_id: 'item_result', count: 1 }],
      ),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as RecipeMatchMirrorOutput;

    expect(output.count).toBe(0);
    expect(output.matchResults[0]!.matched).toBe(false);
    expect(output.matchResults[0]!.mapping).toBeNull();
    expect(output.distribution['recipe1']).toBe(0);
  });

  it('匹配成功：itmk 类别匹配', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [{ itmk: 'MT', count: 1, consume: 'all' }],
        [{ item_id: 'item_result', count: 1 }],
      ),
      makeItemNode('item_a', 'MT'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as RecipeMatchMirrorOutput;

    expect(output.count).toBe(1);
    expect(output.matchResults[0]!.matched).toBe(true);
  });

  it('匹配成功：tag 性质匹配', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [{ tag: 'tag_sharp', count: 1, consume: 'all' }],
        [{ item_id: 'item_result', count: 1 }],
      ),
      makeItemNode('item_a', 'WP', ['tag_sharp']),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as RecipeMatchMirrorOutput;

    expect(output.count).toBe(1);
    expect(output.matchResults[0]!.matched).toBe(true);
  });

  it('多个 recipe 混合成功/失败', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe_success',
        [{ item_id: 'item_a', count: 1, consume: 'all' }],
        [{ item_id: 'result_a', count: 1 }],
      ),
      makeRecipeNode(
        'recipe_fail',
        [{ item_id: 'item_missing', count: 1, consume: 'all' }],
        [{ item_id: 'result_b', count: 1 }],
      ),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as RecipeMatchMirrorOutput;

    expect(output.totalRecipes).toBe(2);
    expect(output.count).toBe(1);
    expect(output.distribution['recipe_success']).toBe(1);
    expect(output.distribution['recipe_fail']).toBe(0);
  });
});

describe('recipeMatchMirror - 不变量', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('material 同时声明多个匹配键时 emit recipe_material_match_conflict', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [
          {
            item_id: 'item_a',
            itmk: 'MT', // 同时声明 item_id + itmk
            count: 1,
            consume: 'all',
          },
        ],
        [{ item_id: 'result', count: 1 }],
      ),
      makeItemNode('item_a', 'MT'),
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'recipe_material_match_conflict'),
    ).toBeDefined();
  });

  it('工作台槽位（consume=none）未用 tag 时 emit recipe_workbench_slot_not_tag', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [
          {
            item_id: 'item_a', // 应该用 tag，但用了 item_id
            count: 1,
            consume: 'none',
          },
        ],
        [{ item_id: 'result', count: 1 }],
      ),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'recipe_workbench_slot_not_tag'),
    ).toBeDefined();
  });

  it('正常 recipe 不 emit 不变量违反', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [{ item_id: 'item_a', count: 1, consume: 'all' }],
        [{ item_id: 'result', count: 1 }],
      ),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    expect(result.invariantViolations).toEqual([]);
  });
});

describe('recipeMatchMirror - 可复现性', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('相同 graph 产生相同输出（纯函数无 PRNG）', async () => {
    graphStore.upsertNodes([
      makeRecipeNode(
        'recipe1',
        [{ item_id: 'item_a', count: 2, consume: 'all' }],
        [{ item_id: 'result', count: 1 }],
      ),
      makeItemNode('item_a'),
    ]);

    const r1 = await run(graphStore, {});
    const r2 = await run(graphStore, {});

    expect(r1.output).toEqual(r2.output);
    expect(r1.invariantViolations).toEqual(r2.invariantViolations);
  });
});
