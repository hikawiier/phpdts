/**
 * @module O 内容工具箱
 *
 * presentation.recipe 投影器——把 Resource Graph 中的 presentation.recipe 节点投影回
 * vex-vue/src/data/recipe-locale.ts 的 TS locale 形态。
 *
 * 设计意图（执行案 06-P5 §4.3.3）：
 * - P5-2 投影器接管原 ts-locale-adapter.serializeRecipeLocale 的职责，独立维护文件模板。
 * - 文件头注入 `// AUTO-GENERATED FROM ...` 只读保护注释（执行案 §4.8.2）。
 * - 双常量形态：`RECIPE_LOCALE` + `RECIPE_CATEGORY_LABELS` + 辅助函数
 *   （getRecipeName / getRecipeDesc / getCategoryLabel）。
 * - 键顺序按节点数组顺序保留——TS 对象字面量保留 string key 顺序。
 * - RECIPE_CATEGORY_LABELS 从 schema.auxiliaryData.categoryLabels 读取，避免硬编码业务数据。
 * - 辅助函数是固定运行时逻辑（K 状态管理层 fallback 链），不随数据变化，模板中保留。
 *
 * 反向投影字段映射：
 *   - 节点 id                          → RECIPE_LOCALE 字面量 key（合法标识符直接输出，否则字符串字面量）
 *   - node.data.name                   → { name: '...' }
 *   - node.data.desc                   → { desc: '...' }
 *
 * 边界：
 * - 节点 data 为 null/非对象时跳过该节点（不写入常量）
 * - name / desc 缺失时输出空字符串（与 schema default 对齐）
 * - undefined 字段递归移除（与 ts-locale-adapter.stripUndefinedFields 对齐）
 * - 节点数组为空时仍生成完整文件骨架（仅常量为空对象），保证 round-trip 一致性
 * - 字符串转义：单引号字符串，`\\` → `\\\\`，`'` → `\\'`
 * - 文件末尾保留单换行
 *
 * 集成：
 * - ts-locale-adapter.serializeTsLocale 路由到本投影器（当 kind='presentation.recipe' 时）
 * - BuildView 在发布前通过 serializeNodes 间接调用本投影器生成 PublishableFile
 */

import type { KindSchema } from '../../schema/types';
import type { ResourceNode } from '../../graph/types';
import type { SerializedTsFile } from '../../adapters/ts-locale-adapter';

/** 目标文件路径（工作区相对路径） */
const RECIPE_LOCALE_FILE_PATH = 'vex-vue/src/data/recipe-locale.ts';

/** 作者资源 YAML 路径——用于 AUTO-GENERATED 注释 */
const RECIPE_LOCALE_AUTHOR_SOURCE = 'oblivions/content/presentations/recipe-locale.yaml';

/**
 * recipe-locale.ts 尾部辅助函数模板——RECIPE_LOCALE 之后的辅助函数与
 * RECIPE_CATEGORY_LABELS 常量及 getCategoryLabel 函数。
 *
 * 与 vex-vue/src/data/recipe-locale.ts:74-97 保持一致；如运行时契约变化
 * （K 状态管理层 fallback 链），必须同步更新此模板。
 */
const RECIPE_LOCALE_TRAILING_CODE = `export function getRecipeName(recipeId: string | number | undefined, fallbackName?: string): string {
  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackName || '';
  const key = String(recipeId);
  return RECIPE_LOCALE[key]?.name || fallbackName || key;
}

export function getRecipeDesc(recipeId: string | number | undefined, fallbackDesc?: string): string {
  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackDesc || '';
  return RECIPE_LOCALE[String(recipeId)]?.desc || fallbackDesc || '';
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

/**
 * 把 presentation.recipe 节点投影回 recipe-locale.ts 形态。
 *
 * @param nodes presentation.recipe 节点数组（顺序保留为 RECIPE_LOCALE 字面量 key 顺序）
 * @param kindSchema 资源 kind 的 schema 契约（用于读取 auxiliaryData.categoryLabels）
 * @returns 单个 SerializedTsFile（filePath 指向 vex-vue/src/data/recipe-locale.ts）
 */
export function projectRecipeLocale(
  nodes: ResourceNode[],
  kindSchema: KindSchema,
): SerializedTsFile[] {
  const entries: string[] = [];
  for (const node of nodes) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      continue;
    }
    const cleaned = stripUndefinedFields(node.data) as { name?: string; desc?: string };
    const name = tsString(cleaned.name ?? '');
    const desc = tsString(cleaned.desc ?? '');
    entries.push(`  ${tsKey(node.id)}: { name: ${name}, desc: ${desc} },`);
  }

  // 从 schema.auxiliaryData 读取 categoryLabels——避免在投影器硬编码业务数据
  // 若 schema 未声明 auxiliaryData.categoryLabels，使用 TRAILING_CODE 中的默认值
  const auxiliaryLabels = kindSchema.auxiliaryData?.categoryLabels as
    | Record<string, string>
    | undefined;

  const trailingCode =
    auxiliaryLabels !== undefined
      ? buildRecipeTrailingCode(auxiliaryLabels)
      : RECIPE_LOCALE_TRAILING_CODE;

  const content =
    `// AUTO-GENERATED FROM ${RECIPE_LOCALE_AUTHOR_SOURCE}\n` +
    `// DO NOT EDIT MANUALLY - modify the source YAML and recompile\n\n` +
    `/**\n` +
    ` * @module K 状态管理层\n` +
    ` */\n\n` +
    `export interface RecipeLocaleEntry {\n` +
    `  name: string;\n` +
    `  desc: string;\n` +
    `}\n\n` +
    `export const RECIPE_LOCALE: Record<string, RecipeLocaleEntry> = {\n` +
    `${entries.join('\n')}\n` +
    `};\n\n` +
    trailingCode;

  return [{ filePath: RECIPE_LOCALE_FILE_PATH, content }];
}

/**
 * 根据动态 categoryLabels 构建 recipe-locale.ts 的尾部代码。
 *
 * RECIPE_LOCALE 与 RECIPE_CATEGORY_LABELS 之间的辅助函数（getRecipeName/getRecipeDesc）
 * 是固定运行时逻辑，模板中保留。仅 RECIPE_CATEGORY_LABELS 字典内容从 schema 派生。
 */
function buildRecipeTrailingCode(categoryLabels: Record<string, string>): string {
  const labelEntries = Object.entries(categoryLabels).map(
    ([key, label]) => `  ${tsKey(key)}: ${tsString(label)},`,
  );

  return (
    `export function getRecipeName(recipeId: string | number | undefined, fallbackName?: string): string {\n` +
    `  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackName || '';\n` +
    `  const key = String(recipeId);\n` +
    `  return RECIPE_LOCALE[key]?.name || fallbackName || key;\n` +
    `}\n\n` +
    `export function getRecipeDesc(recipeId: string | number | undefined, fallbackDesc?: string): string {\n` +
    `  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackDesc || '';\n` +
    `  return RECIPE_LOCALE[String(recipeId)]?.desc || fallbackDesc || '';\n` +
    `}\n\n` +
    `// ── 配方分类本地化 ──────────────────────────────\n\n` +
    `export const RECIPE_CATEGORY_LABELS: Record<string, string> = {\n` +
    `${labelEntries.join('\n')}\n` +
    `};\n\n` +
    `export function getCategoryLabel(category: string | undefined): string {\n` +
    `  if (!category) return '其他';\n` +
    `  return RECIPE_CATEGORY_LABELS[category] || category;\n` +
    `}\n`
  );
}

// ─── codegen 工具（与 ts-locale-adapter 对齐，独立声明以保持投影器自包含） ───

/**
 * 标识符 key——若是合法标识符直接输出，否则用字符串字面量。
 */
function tsKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : tsString(key);
}

/**
 * 单引号字符串字面量——转义 `\\` 与 `'`。
 */
function tsString(str: string): string {
  const escaped = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * 递归移除 undefined 字段（与 php-adapter.stripUndefinedFields / ts-locale-adapter
 * stripUndefinedFields 行为一致）。
 *
 * 保留所有显式值（含 false / 0 / '' / null），仅移除 undefined。
 */
function stripUndefinedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedFields);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      result[k] = stripUndefinedFields(v);
    }
    return result;
  }
  return value;
}
