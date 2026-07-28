/**
 * @module O 内容工具箱
 *
 * loot.table kind 完整 schema。来源：oblivions/gamedata/loot_tables.php。
 *
 * 23 个战利品表，标准 map-keyed load——顶层 key 是表 ID，value 是表定义。
 * 表 ID 命名规律：{poi_id}_loot（如 supply_cache_loot）+ 语义名（medical_supplies / ammo_basic /
 * food_cache / empty_loot / extra_cache_loot / locked_chest_loot）。
 *
 * 三层嵌套结构：表 → groups[] → entries[]，每组独立掷骰，组内 entries 按 weight 加权选一。
 * F-4 引擎实现：oblivions/include/game/loot/loot.engine.func.php（obl_roll_loot_table /
 * obl_roll_group / obl_apply_durability_decay 原语）。
 *
 * 字段语义：
 *   - 表级 name               : 表名（日志/调试用，不算 deprecated 呈现字段）
 *   - 表级 durability_decay    : bool 是否对产出物品应用耐久衰减（仅对非 stackable 装备生效）
 *   - 表级 groups              : 物品组列表，每组独立掷骰
 *   - 组级 chance             : float 0-1 组级概率（先于 entry 判定），默认 1.0
 *   - 组级 entries            : 互斥选项列表，按 weight 加权选一
 *   - entry item_id           : 物品模板 ID（引用 item.template.id，drops_item 边）
 *   - entry weight            : int/float 组内互斥权重（非概率，组内归一化），默认 1
 *   - entry count             : int 或 [min,max] 生成数量
 *                                - stackable 物品作为 itms（超 stack_limit 自动分批）
 *                                - 非 stackable 物品作为实例数
 *
 * 引用字段（refFields）：
 * - groups[].entries[].item_id：合成产物（drops_item 边，对同一 loot_table/item 对可有多条）
 *
 * 与 poi.template 的反向关系：poi.template.loot_table_id 引用 loot.table.id（uses_loot_table 边）。
 *
 * 表 ID 与 POI 模板 ID 共用同一命名空间——F-4 引擎历史约定，但实际数据中所有 POI 显式配置
 * loot_table_id（详见 Dian F-4 边界案例纠正）。
 */

import type { KindSchema } from '../types';

export const lootTableSchema: KindSchema = {
  kind: 'loot.table',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/loot_tables.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  fields: [
    // ─── basic（表级定义）──────────────────────────────
    {
      key: 'name',
      label: '表名',
      type: 'text',
      required: true,
      default: '',
      placeholder: '如 医疗物资表',
      description:
        '表名（日志/调试用）——不算 deprecated 呈现字段，loot.table 不投影到 presentation。' +
        '后端 F-4 引擎在 obl_roll_loot_table 日志中输出该字段便于追踪掷骰链路。',
      group: 'basic',
    },
    {
      key: 'durability_decay',
      label: '装备耐久衰减',
      type: 'boolean',
      required: true,
      default: false,
      description:
        '是否对产出物品应用耐久衰减（obl_apply_durability_decay 原语）。' +
        '仅对非 stackable 装备生效——stackable 物品 itms 是数量，衰减无意义。' +
        '启用时按 item.tier 与 itme 折算初始耐久（详见 loot.engine.func.php）。',
      group: 'basic',
    },
    {
      key: 'groups',
      label: '物品组列表',
      type: 'entry-list',
      required: true,
      default: [],
      description:
        '物品组数组——每组独立掷骰。F-4 引擎按 groups 顺序依次调用 obl_roll_group，' +
        '组级 chance 先于 entry 判定（不命中则该组跳过）。' +
        '空数组（如 empty_loot）表示无产出，用于不可搜索或机制触发型 POI。',
      group: 'basic',
      itemSchema: [
        {
          key: 'chance',
          label: '组级概率',
          type: 'number',
          required: false,
          default: 1.0,
          min: 0,
          max: 1,
          step: 0.05,
          description:
            '0-1 组级概率——先于 entry 判定。1.0=必出该组，0.5=50% 概率掷骰该组。' +
            '不命中则该组所有 entries 跳过。',
          group: 'basic',
        },
        {
          key: 'entries',
          label: '互斥选项列表',
          type: 'entry-list',
          required: true,
          default: [],
          description:
            '互斥选项数组——按 weight 加权选一（非概率，组内归一化）。' +
            'F-4 引擎按 weight 计算累积权重，掷骰落在哪个区间取哪个 entry。',
          group: 'basic',
          itemSchema: [
            {
              key: 'item_id',
              label: '产物道具',
              type: 'text',
              required: true,
              default: '',
              placeholder: '如 health_potion',
              refKind: 'item.template',
              refField: 'id',
              description:
                '产物道具 ID——引用 item.template.id（drops_item 边）。' +
                '对应 item_table.php 的 key。',
              group: 'basic',
            },
            {
              key: 'weight',
              label: '组内互斥权重',
              type: 'number',
              required: false,
              default: 1,
              min: 0,
              step: 1,
              description:
                'int/float 组内互斥权重（非概率，组内归一化）。' +
                '默认 1。weight 全 0 时 F-4 引擎按均匀随机选择（可能非设计意图，' +
                '由 O-10 loot_table.weight_all_zero warning 提示）。',
              group: 'basic',
            },
            {
              key: 'count',
              label: '产物数量',
              type: 'count-range',
              required: true,
              default: 1,
              description:
                'int 或 [min,max] 生成数量——' +
                'stackable 物品作为 itms（超 stack_limit 自动分批）；' +
                '非 stackable 物品作为实例数（每个实例独立扣耐久）。' +
                '如 [2,5] 表示 2-5 之间随机（含端点）。',
              group: 'basic',
            },
          ],
        },
      ],
    },
  ],
  refFields: [
    // 战利品表 → item 的产出关系（drops_item 边）
    // 对同一 (loot_table, item) 对可有多条（不同 group/entry），metadata.groupIndex + entryIndex 区分
    { field: 'groups[].entries[].item_id', refKind: 'item.template', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // loot_tables 的 name 字段仅日志/调试用，不算 deprecated 呈现字段
  listColumns: [
    { field: 'name', labelKey: 'schema.loot.table.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'durability_decay', labelKey: 'schema.loot.table.list.durability_decay', sortable: true, filterable: true, defaultVisible: true, width: 110 },
    { field: 'groups', labelKey: 'schema.loot.table.list.groups', defaultVisible: true, width: 200 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.loot.table.group.basic',
      fields: ['name', 'durability_decay', 'groups'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'loot_table_entries_empty',
      layer: 2,
      severity: 'warning',
      validatorFn: 'loot_table.entries_empty',
    },
    {
      ruleId: 'loot_table_weight_all_zero',
      layer: 2,
      severity: 'warning',
      validatorFn: 'loot_table.weight_all_zero',
    },
    // 第 3 层引用校验（P0 已声明 rule ID）
    {
      ruleId: 'loot_table.item_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'loot_table.item_ref_dangling',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/loot-tables/loot-tables.yaml',
    rootKey: 'loot_tables',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/loot_tables.php',
      projector: './projectors/loot-tables-projector',
      module: 'F 物品系统',
      sectionTitle: 'Oblivions 战利品表',
    },
  ],
};
