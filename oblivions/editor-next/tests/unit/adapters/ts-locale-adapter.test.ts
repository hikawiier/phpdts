//
// ts-locale-adapter 单元测试——O-4 §4.3.3/4.3.4 写路径
//
// 覆盖点：
//   - serializeTsLocale：空 nodes → 仍生成完整文件骨架
//   - serializeTsLocale：presentation.item → 单常量 ITEM_LOCALE
//   - serializeTsLocale：presentation.recipe → 双常量 RECIPE_LOCALE + RECIPE_CATEGORY_LABELS
//   - serializeTsLocale：未知 kind → 空数组
//   - serializeTsLocale：字符串转义（反斜杠 / 单引号）
//   - serializeTsLocale：键顺序保留
//   - serializeTsLocale：round-trip（parse → serialize → parse 一致）
//   - serializeNodes：按 kindSchema.serializer 路由到 tsLocaleAdapter
//   - serializeNodes：未声明 serializer 时回退到 parser 注册表
//

import { describe, it, expect } from 'vitest';
import {
  parseTsLocale,
  serializeTsLocale,
  type SerializedTsFile,
} from '@/adapters/ts-locale-adapter';
import { serializeNodes } from '@/adapters/adapter-registry';
import { presentationItemSchema } from '@/schema/kinds/presentation-item';
import {
  presentationRecipeSchema,
  RECIPE_CATEGORY_LABELS_DATA,
} from '@/schema/kinds/presentation-recipe';
import type { ResourceNode } from '@/graph/types';

// ─── 测试工具：构造 ResourceNode ─────────────────────────

function makeItemLocaleNode(
  id: string,
  name: string,
  desc: string,
): ResourceNode<{ name: string; desc: string }> {
  return {
    kind: 'presentation.item',
    id,
    data: { name, desc },
    source: [],
    revision: '',
  };
}

function makeRecipeLocaleNode(
  id: string,
  name: string,
  desc: string,
): ResourceNode<{ name: string; desc: string }> {
  return {
    kind: 'presentation.recipe',
    id,
    data: { name, desc },
    source: [],
    revision: '',
  };
}

// ─── 测试：serializeTsLocale ─────────────────────────

describe('serializeTsLocale', () => {
  it('空 nodes → 仍生成完整文件骨架（presentation.item）', () => {
    const files = serializeTsLocale([], presentationItemSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('vex-vue/src/data/item-locale.ts');

    const content = files[0]!.content;
    expect(content).toContain('@module K 状态管理层');
    expect(content).toContain('export interface ItemLocaleEntry');
    expect(content).toContain('export const ITEM_LOCALE: Record<string, ItemLocaleEntry>');
    // 辅助函数保留
    expect(content).toContain('export function getItemName(');
    expect(content).toContain('export function getItemDesc(');
    expect(content).toContain('export function isInfinite(');
  });

  it('空 nodes → 仍生成完整文件骨架（presentation.recipe）', () => {
    const files = serializeTsLocale([], presentationRecipeSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('vex-vue/src/data/recipe-locale.ts');

    const content = files[0]!.content;
    expect(content).toContain('export interface RecipeLocaleEntry');
    expect(content).toContain('export const RECIPE_LOCALE: Record<string, RecipeLocaleEntry>');
    expect(content).toContain('export const RECIPE_CATEGORY_LABELS: Record<string, string>');
    expect(content).toContain('export function getRecipeName(');
    expect(content).toContain('export function getRecipeDesc(');
    expect(content).toContain('export function getCategoryLabel(');
  });

  it('presentation.item 节点 → ITEM_LOCALE 包含所有条目', () => {
    const nodes = [
      makeItemLocaleNode('rusty_pipe', '生锈的水管', '一根锈迹斑斑的铁管。'),
      makeItemLocaleNode('scrap_blade', '废铁刀', '用废铁片磨出的粗糙刀刃。'),
      makeItemLocaleNode('innate_craft_t0', '徒手合成', '玩家自带的基础合成能力。'),
    ];

    const files = serializeTsLocale(nodes, presentationItemSchema);
    expect(files).toHaveLength(1);

    const content = files[0]!.content;
    expect(content).toContain("rusty_pipe: { name: '生锈的水管', desc: '一根锈迹斑斑的铁管。' },");
    expect(content).toContain("scrap_blade: { name: '废铁刀', desc: '用废铁片磨出的粗糙刀刃。' },");
    expect(content).toContain(
      "innate_craft_t0: { name: '徒手合成', desc: '玩家自带的基础合成能力。' },",
    );
  });

  it('presentation.recipe 节点 → RECIPE_LOCALE 包含所有条目', () => {
    const nodes = [
      makeRecipeLocaleNode('craft_bandage', '绷带', '用三块布料包扎成急救绷带。'),
      makeRecipeLocaleNode('craft_firewood', '木柴捆', '把两根树枝捆成一捆干柴。'),
    ];

    const files = serializeTsLocale(nodes, presentationRecipeSchema);
    expect(files).toHaveLength(1);

    const content = files[0]!.content;
    expect(content).toContain(
      "craft_bandage: { name: '绷带', desc: '用三块布料包扎成急救绷带。' },",
    );
    expect(content).toContain(
      "craft_firewood: { name: '木柴捆', desc: '把两根树枝捆成一捆干柴。' },",
    );
  });

  it('presentation.recipe → RECIPE_CATEGORY_LABELS 从 schema.auxiliaryData 派生', () => {
    const nodes = [makeRecipeLocaleNode('craft_bandage', '绷带', '...')];
    const files = serializeTsLocale(nodes, presentationRecipeSchema);
    const content = files[0]!.content;

    // RECIPE_CATEGORY_LABELS 必须包含 schema 中声明的 4 个 key
    expect(content).toContain("food: '食物',");
    expect(content).toContain("tool: '工具',");
    expect(content).toContain("armor: '护甲',");
    expect(content).toContain("weapon: '武器',");
  });

  it('未知 kind → 空数组', () => {
    const fakeSchema = {
      ...presentationItemSchema,
      kind: 'unknown.kind' as const,
    };
    const nodes = [makeItemLocaleNode('a', 'b', 'c')];
    expect(serializeTsLocale(nodes, fakeSchema)).toEqual([]);
  });

  it('字符串转义：反斜杠与单引号', () => {
    const nodes = [
      // 反斜杠 + 单引号 都需要转义
      makeItemLocaleNode('escape_test', '含\\反斜杠', "含'单引号'"),
    ];

    const files = serializeTsLocale(nodes, presentationItemSchema);
    const content = files[0]!.content;

    // 反斜杠转义为 \\，单引号转义为 \'
    expect(content).toContain("escape_test: { name: '含\\\\反斜杠', desc: '含\\'单引号\\'' },");
  });

  it('键顺序保留：传入顺序 = 输出顺序（非字母序）', () => {
    // 传入顺序故意非字母序，验证输出顺序与传入一致
    const nodes = [
      makeItemLocaleNode('zzz_last', '最后', ''),
      makeItemLocaleNode('aaa_first', '第一', ''),
      makeItemLocaleNode('mmm_middle', '中间', ''),
    ];

    const files = serializeTsLocale(nodes, presentationItemSchema);
    const content = files[0]!.content;

    // 验证键出现顺序与传入顺序一致：zzz_last → aaa_first → mmm_middle
    const idxZzz = content.indexOf('zzz_last');
    const idxAaa = content.indexOf('aaa_first');
    const idxMmm = content.indexOf('mmm_middle');
    expect(idxZzz).toBeGreaterThan(-1);
    expect(idxAaa).toBeGreaterThan(idxZzz);
    expect(idxMmm).toBeGreaterThan(idxAaa);
  });

  it('数据字段缺失时回退到空字符串', () => {
    // 模拟 innate_craft_t0 在原文件中既有 name 也有 desc，但测试缺失场景
    const node: ResourceNode<unknown> = {
      kind: 'presentation.item',
      id: 'no_desc_item',
      data: { name: '只有名字' }, // 缺失 desc
      source: [],
      revision: '',
    };

    const files = serializeTsLocale([node], presentationItemSchema);
    const content = files[0]!.content;

    // desc 缺失时回退到空字符串
    expect(content).toContain("no_desc_item: { name: '只有名字', desc: '' },");
  });
});

// ─── 测试：round-trip ─────────────────────────

describe('serializeTsLocale round-trip', () => {
  it('presentation.item parse → serialize → parse 数据一致', () => {
    const originalContent = `/**
 * @module K 状态管理层
 */

export interface ItemLocaleEntry {
  name: string;
  desc: string;
}

export const ITEM_LOCALE: Record<string, ItemLocaleEntry> = {
  rusty_pipe: { name: '生锈的水管', desc: '一根锈迹斑斑的铁管。' },
  scrap_blade: { name: '废铁刀', desc: '用废铁片磨出的粗糙刀刃。' },
};

export function getItemName(itemId: string | number | undefined, customName?: string): string {
  return '';
}
`;

    // 1. parse
    const nodes = parseTsLocale('vex-vue/src/data/item-locale.ts', originalContent, presentationItemSchema);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe('rusty_pipe');
    expect(nodes[1]!.id).toBe('scrap_blade');

    // 2. serialize
    const files = serializeTsLocale(nodes, presentationItemSchema);
    expect(files).toHaveLength(1);
    const serialized = files[0]!.content;

    // 3. 再次 parse
    const reparsed = parseTsLocale('vex-vue/src/data/item-locale.ts', serialized, presentationItemSchema);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0]!.id).toBe('rusty_pipe');
    expect(reparsed[1]!.id).toBe('scrap_blade');
    expect(reparsed[0]!.data).toEqual(nodes[0]!.data);
    expect(reparsed[1]!.data).toEqual(nodes[1]!.data);
  });

  it('presentation.recipe parse → serialize → parse 数据一致', () => {
    const originalContent = `/**
 * @module K 状态管理层
 */

export interface RecipeLocaleEntry {
  name: string;
  desc: string;
}

export const RECIPE_LOCALE: Record<string, RecipeLocaleEntry> = {
  craft_bandage: { name: '绷带', desc: '用三块布料包扎成急救绷带。' },
  craft_firewood: { name: '木柴捆', desc: '把两根树枝捆成一捆干柴。' },
};

export function getRecipeName(recipeId: string | number | undefined, fallbackName?: string): string {
  return '';
}

export function getRecipeDesc(recipeId: string | number | undefined, fallbackDesc?: string): string {
  return '';
}

// ── 配方分类本地化 ──────────────────────────────

export const RECIPE_CATEGORY_LABELS: Record<string, string> = {
  food: '食物',
  tool: '工具',
  armor: '护甲',
  weapon: '武器',
};

export function getCategoryLabel(category: string | undefined): string {
  if (!category) return '其他';
  return RECIPE_CATEGORY_LABELS[category] || category;
}
`;

    // 1. parse
    const nodes = parseTsLocale('vex-vue/src/data/recipe-locale.ts', originalContent, presentationRecipeSchema);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe('craft_bandage');
    expect(nodes[1]!.id).toBe('craft_firewood');

    // 2. serialize
    const files = serializeTsLocale(nodes, presentationRecipeSchema);
    expect(files).toHaveLength(1);
    const serialized = files[0]!.content;

    // 3. 再次 parse
    const reparsed = parseTsLocale('vex-vue/src/data/recipe-locale.ts', serialized, presentationRecipeSchema);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0]!.id).toBe('craft_bandage');
    expect(reparsed[1]!.id).toBe('craft_firewood');
    expect(reparsed[0]!.data).toEqual(nodes[0]!.data);
    expect(reparsed[1]!.data).toEqual(nodes[1]!.data);
  });
});

// ─── 测试：serializeNodes 路由 ─────────────────────────

describe('serializeNodes 路由', () => {
  it('按 kindSchema.serializer 路由 presentation.item 到 tsLocaleAdapter', () => {
    const nodes = [makeItemLocaleNode('rusty_pipe', '生锈的水管', '...')];
    const files = serializeNodes(nodes, presentationItemSchema);
    expect(files).toHaveLength(1);
    expect((files[0] as SerializedTsFile).filePath).toBe('vex-vue/src/data/item-locale.ts');
  });

  it('按 kindSchema.serializer 路由 presentation.recipe 到 tsLocaleAdapter', () => {
    const nodes = [makeRecipeLocaleNode('craft_bandage', '绷带', '...')];
    const files = serializeNodes(nodes, presentationRecipeSchema);
    expect(files).toHaveLength(1);
    expect((files[0] as SerializedTsFile).filePath).toBe('vex-vue/src/data/recipe-locale.ts');
  });

  it('未声明 serializer 时回退到 parser 注册表（兼容旧 schema）', () => {
    // 构造无 serializer 字段的 schema（模拟 P0 旧 schema）
    const legacySchema = {
      ...presentationItemSchema,
      serializer: undefined,
    };
    const nodes = [makeItemLocaleNode('rusty_pipe', '生锈的水管', '...')];
    const files = serializeNodes(nodes, legacySchema);
    // parser='ts-locale'，tsLocaleAdapter 已注册，应能正常序列化
    expect(files).toHaveLength(1);
    expect((files[0] as SerializedTsFile).filePath).toBe('vex-vue/src/data/item-locale.ts');
  });
});

// ─── 测试：auxiliaryData 派生 ─────────────────────────

describe('schema.auxiliaryData 派生 RECIPE_CATEGORY_LABELS', () => {
  it('presentation-recipe schema 声明了 auxiliaryData.categoryLabels', () => {
    expect(presentationRecipeSchema.auxiliaryData).toBeDefined();
    expect(presentationRecipeSchema.auxiliaryData!.categoryLabels).toEqual(
      RECIPE_CATEGORY_LABELS_DATA,
    );
  });

  it('序列化时 RECIPE_CATEGORY_LABELS 包含 schema 中声明的全部 key', () => {
    const nodes = [makeRecipeLocaleNode('test_recipe', '测试', '...')];
    const files = serializeTsLocale(nodes, presentationRecipeSchema);
    const content = files[0]!.content;

    // 提取 RECIPE_CATEGORY_LABELS 部分
    const labelsBlock = content.match(
      /export const RECIPE_CATEGORY_LABELS[^{]*\{([^}]+)\}/,
    )?.[1];
    expect(labelsBlock).toBeDefined();

    for (const [key, label] of Object.entries(RECIPE_CATEGORY_LABELS_DATA)) {
      expect(labelsBlock!).toContain(`${key}: '${label}'`);
    }
  });

  it('schema 未声明 auxiliaryData 时回退到 TRAILING_CODE 中的默认值', () => {
    // 构造无 auxiliaryData 的 schema
    const schemaWithoutAux = {
      ...presentationRecipeSchema,
      auxiliaryData: undefined,
    };
    const nodes = [makeRecipeLocaleNode('test', '测试', '...')];
    const files = serializeTsLocale(nodes, schemaWithoutAux);
    const content = files[0]!.content;

    // 默认 TRAILING_CODE 仍包含 4 个固定 key
    expect(content).toContain("food: '食物',");
    expect(content).toContain("tool: '工具',");
  });
});
