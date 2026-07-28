/**
 * @module O 内容工具箱
 *
 * recipe.template kind 完整 schema。来源：oblivions/gamedata/recipe_table.php。
 *
 * 41 个合成配方，标准 map-keyed load——顶层 key 是 recipe ID，value 是配方字段。
 *
 * 关键设计决策：recipe_table.php 无 name 字段——后端 item_get_visible_recipes()
 * (item.craft.func.php:544-552) 通过首产物 itm 投影 name 作为 fallback。
 * 因此 recipe.template 不声明 name 字段，name 完全由 presentation.recipe 提供；
 * 前端 fallback 链见 recipe-locale.ts getRecipeName(recipeId, fallbackName)。
 *
 * 字段分组（detailGroups）：
 *   - basic：category（配方分类）
 *   - materials：素材列表（entry-list，三选一匹配形式 + 通用字段）
 *   - results：产物列表（entry-list）
 *
 * 引用字段（refFields）：
 * - materials[].item_id：精确匹配指定道具（consumes_item 边）
 * - materials[].itmk：匹配道具类别（consumes_itmk 边）
 * - materials[].tag：匹配性质描述 Tag（consumes_tag 边）
 * - results[].item_id：合成产物（produces_item 边）
 *
 * 匹配优先级不变量（迁移自 recipe_table.php:24-27，由 O-10 第 4 层语义校验执行）：
 * - 同一素材槽位 item_id/itmk/tag 三选一，不能同时出现
 * - consume='none' 的槽位是工作台槽位，必须使用 tag 匹配
 * - 所有放置的素材必须都被消耗（多放也不匹配）——O-12 镜像校验在 P6 覆盖
 *
 * presentationFields 为空：recipe_table.php 注释明确说"仅游戏逻辑，不含文案"，
 * 配方中文文案完全由 presentation.recipe（recipe-locale.ts）提供。
 */

import type { KindSchema } from '../types';
import { ITMK_OPTIONS } from './item-template';

/**
 * category 配方分类枚举（与 vex-vue/src/data/recipe-locale.ts RECIPE_CATEGORY_LABELS 同步）。
 *
 * 新增 category 枚举值时（如未来扩展 medicine），O-5 Change Set 必须同步新增
 * RECIPE_CATEGORY_LABELS 条目，否则 O-10 第 6 层 emit
 * presentation.recipe.category_label_missing warning。
 */
export const RECIPE_CATEGORY_OPTIONS = [
  { value: 'tool', label: '工具' },
  { value: 'armor', label: '护甲' },
  { value: 'food', label: '食物' },
  { value: 'weapon', label: '武器' },
] as const;

/**
 * consume 消耗模式枚举（recipe_table.php:19）。
 *
 * - all：消耗素材（数量减少）
 * - durability：扣减素材耐久（不消耗数量，仅扣 itms）
 * - none：返还——工作台槽位使用，素材不被消耗
 */
export const RECIPE_CONSUME_OPTIONS = [
  { value: 'all', label: '消耗' },
  { value: 'durability', label: '扣耐久' },
  { value: 'none', label: '返还（工作台）' },
] as const;

export const recipeTemplateSchema: KindSchema = {
  kind: 'recipe.template',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/recipe_table.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  fields: [
    // ─── basic（配方分类）─────────────────────────────
    {
      key: 'category',
      label: '配方分类',
      type: 'select',
      options: RECIPE_CATEGORY_OPTIONS,
      required: true,
      description:
        '配方分类标识——前端用于显示过滤（getCategoryLabel），' +
        '与 vex-vue/src/data/recipe-locale.ts RECIPE_CATEGORY_LABELS 同步。',
      group: 'basic',
    },

    // ─── materials（素材列表）─────────────────────────
    {
      key: 'materials',
      label: '素材列表',
      type: 'entry-list',
      required: true,
      default: [],
      description:
        '素材数组——每个槽位支持三种匹配形式（item_id > itmk > tag 优先级）。' +
        'consume="none" 的槽位是工作台槽位，必须用 tag 匹配；' +
        '所有放置的素材必须都被消耗（多放也不匹配，由 O-12 镜像校验在 P6 覆盖）。',
      group: 'materials',
      itemSchema: [
        // 三选一匹配字段
        {
          key: 'item_id',
          label: '指定道具',
          type: 'text',
          required: false,
          default: '',
          placeholder: '如 cloth（精确匹配）',
          description:
            '精确匹配指定道具 ID。与 itmk/tag 互斥（O-10 第 4 层校验）。',
          group: 'materials',
        },
        {
          key: 'itmk',
          label: '道具类别',
          type: 'select',
          options: ITMK_OPTIONS,
          required: false,
          default: '',
          description:
            '匹配任一使用该 itmk 的道具（如 MT 匹配所有金属素材）。' +
            '与 item_id/tag 互斥。',
          group: 'materials',
        },
        {
          key: 'tag',
          label: 'Tag 匹配',
          type: 'text',
          required: false,
          default: '',
          placeholder: '如 tag_combustible / tag_tool_cooking',
          description:
            '匹配任一含该 tag 的道具。consume="none" 工作台槽位必须用 tag 匹配。',
          group: 'materials',
        },
        // 通用字段
        {
          key: 'count',
          label: '数量',
          type: 'number',
          required: false,
          default: 1,
          min: 1,
          step: 1,
          description: '素材数量（默认 1）',
          group: 'materials',
        },
        {
          key: 'consume',
          label: '消耗模式',
          type: 'select',
          options: RECIPE_CONSUME_OPTIONS,
          required: false,
          default: 'all',
          description:
            'all=消耗 / durability=扣耐久 / none=返还（工作台槽位）。' +
            '工作台槽位（consume=none）必须用 tag 匹配。',
          group: 'materials',
        },
        {
          key: 'min_level',
          label: '最低工具等级',
          type: 'number',
          required: false,
          default: 0,
          min: 0,
          step: 1,
          description:
            '要求素材 tool_level >= min_level（高级工具兼容低级配方）。' +
            '通常用于工作台槽位（如 tag_tool_cooking min_level=1）。',
          group: 'materials',
        },
      ],
    },

    // ─── results（产物列表）───────────────────────────
    {
      key: 'results',
      label: '产物列表',
      type: 'entry-list',
      required: true,
      default: [],
      description:
        '产物数组——支持多产物。首产物 itm 用于后端 name fallback 投影' +
        '（item.craft.func.php:544-552）。',
      group: 'results',
      itemSchema: [
        {
          key: 'item_id',
          label: '产物道具',
          type: 'text',
          required: true,
          default: '',
          placeholder: '如 bandage',
          description: '产物道具 ID——引用 item.template.id',
          group: 'results',
        },
        {
          key: 'count',
          label: '产物数量',
          type: 'number',
          required: true,
          default: 1,
          min: 1,
          step: 1,
          description: '产物数量',
          group: 'results',
        },
      ],
    },
  ],
  refFields: [
    // 素材引用：三种匹配形式（item_id > itmk > tag 优先级）
    { field: 'materials[].item_id', refKind: 'item.template', refField: 'id', required: false, refType: 'direct' },
    // itmk 反向索引：引用"任一使用该 itmk 的 item"，由 O-3 反向索引校验
    { field: 'materials[].itmk', refKind: 'item.template', refField: 'itmk', required: false, refType: 'itmk' },
    // tag 反向索引：引用"任一含该 tag 的 item"
    { field: 'materials[].tag', refKind: 'item.template', refField: 'tags', required: false, refType: 'tag' },
    // 产物引用
    { field: 'results[].item_id', refKind: 'item.template', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // recipe_table 无 name/desc 字段，文案完全由 presentation.recipe 提供
  listColumns: [
    { field: 'category', labelKey: 'schema.recipe.template.list.category', sortable: true, filterable: true, defaultVisible: true, width: 90 },
    { field: 'materials', labelKey: 'schema.recipe.template.list.materials', defaultVisible: true, width: 280 },
    { field: 'results', labelKey: 'schema.recipe.template.list.results', defaultVisible: true, width: 200 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.recipe.template.group.basic',
      fields: ['category'],
      defaultCollapsed: false,
    },
    {
      id: 'materials',
      labelKey: 'schema.recipe.template.group.materials',
      fields: ['materials'],
      defaultCollapsed: false,
    },
    {
      id: 'results',
      labelKey: 'schema.recipe.template.group.results',
      fields: ['results'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'recipe_category_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'recipe.category_invalid',
    },
    {
      ruleId: 'recipe_consume_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'recipe.consume_invalid',
    },
    {
      ruleId: 'recipe_materials_empty',
      layer: 2,
      severity: 'error',
      validatorFn: 'recipe.materials_empty',
    },
    {
      ruleId: 'recipe_results_empty',
      layer: 2,
      severity: 'error',
      validatorFn: 'recipe.results_empty',
    },
    // 第 4 层语义校验（匹配规则不变量，迁移自 recipe_table.php:24-27）
    {
      ruleId: 'recipe_material_match_conflict',
      layer: 4,
      severity: 'error',
      validatorFn: 'recipe.material_match_conflict',
    },
    {
      ruleId: 'recipe_workbench_slot_not_tag',
      layer: 4,
      severity: 'error',
      validatorFn: 'recipe.workbench_slot_not_tag',
    },
    {
      ruleId: 'recipe_material_dangling',
      layer: 4,
      severity: 'error',
      validatorFn: 'recipe.material_dangling',
    },
    {
      ruleId: 'recipe_result_dangling',
      layer: 4,
      severity: 'error',
      validatorFn: 'recipe.result_dangling',
    },
    // 第 6 层呈现校验：recipe.template 无文案，检查 presentation.recipe 是否存在
    {
      ruleId: 'recipe_presentation_missing',
      layer: 6,
      severity: 'warning',
      validatorFn: 'recipe.presentation_missing',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/recipes/recipes.yaml',
    rootKey: 'recipes',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/recipe_table.php',
      projector: './projectors/recipe-table-projector',
      module: 'F 物品系统',
      sectionTitle: 'Oblivions 配方表',
    },
  ],
};
