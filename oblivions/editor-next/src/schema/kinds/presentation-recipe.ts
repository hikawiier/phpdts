/**
 * @module O 内容工具箱
 *
 * presentation.recipe kind 完整 schema。来源：vex-vue/src/data/recipe-locale.ts。
 *
 * 多常量形态（同文件双 export）：
 *   export const RECIPE_LOCALE: Record<string, RecipeLocaleEntry> = { ... };  // 40 条
 *   export const RECIPE_CATEGORY_LABELS: Record<string, string> = { ... };    // 4 条
 *
 * presentation.recipe 节点仅来自 RECIPE_LOCALE——每个 key 是 recipe ID（与
 * recipe.template 共享命名空间），value 是 { name, desc }。
 *
 * RECIPE_CATEGORY_LABELS 不作为独立 kind 注册，而是作为 recipe.template.category
 * 字段的派生呈现——O-7 模板工作区编辑 category 时直接调用 getCategoryLabel(category)
 * 显示中文（vex-vue/src/data/recipe-locale.ts:94-97）。
 * 新增 category 枚举值时（如未来扩展 medicine），O-5 Change Set 必须同步新增
 * RECIPE_CATEGORY_LABELS 条目，否则 O-10 第 6 层 emit
 * presentation.recipe.category_label_missing warning。
 *
 * fallback 链（vex-vue/src/data/recipe-locale.ts）：
 * - getRecipeName(recipeId, fallbackName)：locale → fallbackName → recipeId
 *   fallbackName 来自后端首产物 itm 投影（item.craft.func.php:544-552）
 * - getRecipeDesc(recipeId, fallbackDesc)：locale → fallbackDesc → ''
 *
 * 已知漂移：craft_firewood 在 recipe-locale.ts 中缺失（recipe_table.php 中存在），
 * P2 §4.9 修复后双源覆盖率应达 100%。
 */

import type { KindSchema } from '../types';

/**
 * RECIPE_CATEGORY_LABELS 静态数据——recipe-locale.ts 同时导出此常量。
 *
 * 与 recipe.template.category 字段的 options 一一对应：新增 category 枚举值时
 * 必须同步更新 recipe-template.ts 的 RECIPE_CATEGORY_OPTIONS 与此处。
 *
 * 通过 schema.auxiliaryData 暴露给 ts-locale-adapter 的 serialize 路径——
 * adapter 读取此字段重建 RECIPE_CATEGORY_LABELS 部分，避免在 adapter 中硬编码业务数据。
 *
 * O-10 第 6 层 `recipe_category_label_missing` 规则校验 auxiliaryData.categoryLabels
 * 覆盖 recipe.template.category 全部枚举值。
 */
export const RECIPE_CATEGORY_LABELS_DATA: Record<string, string> = {
  food: '食物',
  tool: '工具',
  armor: '护甲',
  weapon: '武器',
};

export const presentationRecipeSchema: KindSchema = {
  kind: 'presentation.recipe',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/recipe-locale.ts',
      format: 'ts',
      parser: 'ts-locale',
      load: 'map-keyed',
    },
  ],
  parser: 'ts-locale',
  fields: [
    {
      key: 'name',
      label: '中文名',
      type: 'text',
      required: true,
      default: '',
      placeholder: '如：绷带',
      description:
        '配方中文显示名——前端 fallback 链：locale → fallbackName（首产物 itm 投影） → recipeId。' +
        '见 vex-vue/src/data/recipe-locale.ts getRecipeName()。',
      group: 'basic',
    },
    {
      key: 'desc',
      label: '中文描述',
      type: 'text',
      required: false,
      default: '',
      placeholder: '配方中文描述',
      description:
        '配方中文描述——前端 fallback 链：locale → fallbackDesc → 空字符串。' +
        '见 vex-vue/src/data/recipe-locale.ts getRecipeDesc()。',
      group: 'basic',
    },
  ],
  refFields: [], // presentation 是图叶子
  presentationFields: [], // 自身就是呈现
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.recipe.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'desc', labelKey: 'schema.presentation.recipe.list.desc', filterable: true, defaultVisible: true, width: 320 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.recipe.group.basic',
      fields: ['name', 'desc'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'presentation_recipe_name_empty',
      layer: 2,
      severity: 'error',
      validatorFn: 'presentation.recipe.name_empty',
    },
    // 第 6 层呈现校验
    // 孤儿 presentation.recipe：没有对应 recipe.template 节点
    {
      ruleId: 'recipe_presentation_orphan',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.recipe.orphan',
    },
    // 反向：recipe.template 缺少 presentation.recipe（无中文文案）
    // 与 recipe-template.ts 的 recipe_presentation_missing 规则互补，
    // 由 O-10 注册时去重——此处声明仅为 schema 自包含
    {
      ruleId: 'recipe_template_missing_presentation',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.recipe.template_missing',
    },
    // category 标签覆盖度：RECIPE_CATEGORY_LABELS 必须覆盖 recipe.template.category 全部枚举值
    {
      ruleId: 'recipe_category_label_missing',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.recipe.category_label_missing',
    },
  ],
  copyStrategy: 'deep-clone',
  auxiliaryData: {
    categoryLabels: RECIPE_CATEGORY_LABELS_DATA,
  },
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/recipe-locale.yaml',
    rootKey: 'recipes',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/recipe-locale.ts',
      projector: './projectors/recipe-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
