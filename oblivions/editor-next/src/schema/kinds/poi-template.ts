/**
 * @module O 内容工具箱
 *
 * poi.template kind 完整 schema。来源：oblivions/gamedata/poi_table.php。
 *
 * 29 个 POI 模板，标准 map-keyed load——顶层 key 是 POI ID，value 是模板字段。
 * 模板分四类：基本型（6）+ 机制型（8，含 craft_source/interact_*）+ 任务3/4 可搜索型（15）+
 * campfire_unlit 同时属机制型与 E-12 耐久型。
 *
 * 字段大部分可选——landmark 仅 name/desc/searchable/repeatable；forge_anvil_poi 仅
 * searchable/repeatable/mechanic/mechanic_value；字段缺失由后端按默认值兜底。
 *
 * 字段分组（detailGroups）：
 *   - basic：name / desc / searchable / repeatable / repeat_limit / repeat_cooldown
 *   - e10：base_loot_chance / base_good_event_chance / base_bad_event_chance /
 *          loot_table_id / event_pool / prob_mods_source / loot_table_overrides
 *   - mechanic：mechanic / mechanic_value / mechanic_params
 *   - durability：ttl_days / dismantle_returns
 *
 * 引用字段（refFields）：
 * - loot_table_id：F-4 战利品表 ID（uses_loot_table 边）
 * - loot_table_overrides（kv-list 的 value）：工具/技能路由的改良版表 ID（uses_loot_table 边）
 * - mechanic_value（条件引用）：仅 mechanic=craft_source 时引用 item.template.id（mechanic_ref 边）
 * - dismantle_returns[].item_id：拆除返还道具（dismantle_returns 边）
 *
 * 不变量（迁移自 poi_table.php 文件头注释，由 O-10 第 3/4 层校验执行）：
 * - 所有 searchable=true 的 POI 必须显式配置 loot_table_id（实际数据中已满足）
 * - mechanic=craft_source 时 mechanic_value 必须是已注册的 item.template.id
 * - dismantle_returns[].item_id 必须是已注册的 item.template.id
 *
 * F-4 边界案例纠正（执行案 §4.11）：
 * - 实际数据中所有需要 loot_table 的 POI 均显式配置 loot_table_id，
 *   "表 ID 即 POI ID" 仅注释保留，回退分支从未触发（poi.search.func.php:820-827）。
 */

import type { KindSchema } from '../types';

/**
 * mechanic 机制类型枚举（与 poi_table.php 29 模板实际使用值同步）。
 *
 * - max_hp_up：生命图腾（life_totem），mechanic_value 是数字
 * - learn_skill：技能图腾（skill_totem），mechanic_params 是技能类别数组
 * - craft_source：工作台（forge_anvil_poi/vent_stove/precision_stove_poi），
 *   mechanic_value 引用 item.template.id（条件 refKind）
 * - interact_locked_door/interact_locked_chest/interact_campfire：F-6 道具交互型 POI
 * - 空字符串：无机制（基本型 POI，由 E-10 三档判定接管）
 *
 * mechanic_value 的多态语义：
 *   - max_hp_up：数字（如 10）
 *   - craft_source：item.template.id（如 forge_t1）
 *   - learn_skill：无意义（mechanic_params 承载参数）
 *   - interact_*：无意义
 */
export const POI_MECHANIC_OPTIONS = [
  { value: '', label: '（无）' },
  { value: 'max_hp_up', label: '生命加成' },
  { value: 'learn_skill', label: '技能习得' },
  { value: 'craft_source', label: '工作台' },
  { value: 'interact_locked_door', label: '上锁的门（F-6 交互）' },
  { value: 'interact_locked_chest', label: '上锁的宝箱（F-6 交互）' },
  { value: 'interact_campfire', label: '熄灭的营火（F-6 交互）' },
] as const;

/**
 * event_pool 子结构 kind 字段枚举（与 shared/constants/schema.ts POI_EVENT_KIND_OPTIONS 同步）。
 *
 * E-10 三档判定中 event_pool 的事件分类，影响 base_good_event_chance / base_bad_event_chance
 * 的概率折算路径（详见 poi.search.func.php obl_search_poi）。
 */
export const POI_EVENT_KIND_OPTIONS = [
  { value: 'good', label: '良性' },
  { value: 'bad', label: '恶性' },
] as const;

export const poiTemplateSchema: KindSchema = {
  kind: 'poi.template',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/poi_table.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  fields: [
    // ─── basic（基本属性）──────────────────────────────
    {
      key: 'name',
      label: '后端 fallback 名（deprecated）',
      type: 'text',
      required: false,
      default: '',
      presentation: true,
      deprecated: true,
      description:
        '已迁移至 presentation.poi.name（vex-vue/src/data/poi-locale.ts）。' +
        'P5 单源编译后从 poi_table.php 移除。' +
        'fallback 链见 poi-locale.ts getPoiName()。',
      group: 'basic',
    },
    {
      key: 'desc',
      label: '后端 fallback 描述（deprecated）',
      type: 'text',
      required: false,
      default: '',
      presentation: true,
      deprecated: true,
      description:
        '已迁移至 presentation.poi.desc。P5 单源编译后从 poi_table.php 移除。',
      group: 'basic',
    },
    {
      key: 'searchable',
      label: '可搜索',
      type: 'boolean',
      required: true,
      default: false,
      description:
        '是否可搜索（E-10 三档判定入口）。' +
        'false 时仅作为地标或机制型 POI，不触发 obl_search_poi。',
      group: 'basic',
    },
    {
      key: 'repeatable',
      label: '可重复搜索',
      type: 'boolean',
      required: true,
      default: false,
      description: '是否可重复搜索——配合 repeat_limit / repeat_cooldown 控制频次',
      group: 'basic',
    },
    {
      key: 'repeat_limit',
      label: '重复次数上限',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      step: 1,
      description: '0=无限；repeatable=false 时无意义',
      group: 'basic',
    },
    {
      key: 'repeat_cooldown',
      label: '重复冷却回合',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      step: 1,
      description: '两次搜索间的冷却回合数；repeatable=false 时无意义',
      group: 'basic',
    },

    // ─── e10（E-10 三档判定）──────────────────────────
    {
      key: 'base_loot_chance',
      label: '基础物资概率',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      description:
        '0-1 基础物资概率——未折算工具/技能修正的原始概率。' +
        '由 obl_search_poi 三档判定主流程消费（poi.search.func.php）。',
      group: 'e10',
    },
    {
      key: 'base_good_event_chance',
      label: '基础良性事件概率',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      description: '0-1 基础良性事件概率——从 event_pool 中 kind=good 的事件按 weight 加权选择',
      group: 'e10',
    },
    {
      key: 'base_bad_event_chance',
      label: '基础恶性事件概率',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      description: '0-1 基础恶性事件概率——从 event_pool 中 kind=bad 的事件按 weight 加权选择',
      group: 'e10',
    },
    {
      key: 'loot_table_id',
      label: '战利品表 ID',
      type: 'text',
      required: false,
      default: '',
      placeholder: '如 supply_cache_loot',
      refKind: 'loot.table',
      refField: 'id',
      description:
        '关联 F-4 战利品表 ID——searchable=true 的 POI 必须显式配置。' +
        '实际数据中所有需要 loot 的 POI 均显式配置，"表 ID 即 POI ID" 回退分支从未触发' +
        '（poi.search.func.php:820-827）。引用闭合由 O-10 第 3 层 poi.loot_table_ref_dangling 校验。',
      group: 'e10',
    },
    {
      key: 'event_pool',
      label: '事件池',
      type: 'entry-list',
      required: false,
      default: [],
      description:
        '事件 ID 列表（带 weight/kind）——E-10 三档判定中良/恶性事件按 weight 加权选择。' +
        '纯掉落型 POI（如 swamp_spring）事件池为空，仅触发 loot 掷骰。',
      group: 'e10',
      itemSchema: [
        {
          key: 'event_id',
          label: '事件 ID',
          type: 'text',
          required: true,
          default: '',
          placeholder: '如 find_extra_cache',
          description: '事件函数 ID——后端按 event_id 路由到 obl_event_{event_id} 处理函数',
          group: 'e10',
        },
        {
          key: 'weight',
          label: '权重',
          type: 'number',
          required: true,
          default: 30,
          min: 0,
          step: 1,
          description: '组内互斥权重——同 kind 的事件按 weight 归一化选择',
          group: 'e10',
        },
        {
          key: 'kind',
          label: '事件类型',
          type: 'select',
          options: POI_EVENT_KIND_OPTIONS,
          required: true,
          default: 'good',
          description: '良/恶性分类——决定走 base_good_event_chance 还是 base_bad_event_chance 概率路径',
          group: 'e10',
        },
      ],
    },
    {
      key: 'prob_mods_source',
      label: '概率修正来源白名单',
      type: 'string-list',
      required: false,
      default: [],
      placeholder: '如 lockpick / crowbar',
      description:
        '接受哪些工具/技能的 prob_mods（白名单）。' +
        '未列入的工具/技能不触发 loot_table_overrides 路由，按 base 概率掷骰。',
      group: 'e10',
    },
    {
      key: 'loot_table_overrides',
      label: '战利品表覆盖映射',
      type: 'kv-list',
      required: false,
      default: {},
      keyPlaceholder: '工具/技能 ID（如 lockpick）',
      valuePlaceholder: 'loot_table_id（如 supply_cache_loot）',
      valueType: 'text',
      description:
        '工具/技能 ID → loot_table_id 映射——使用指定工具/技能搜索时，' +
        '用改良版表替代默认 loot_table_id。kv-list 的 value 引用 loot.table.id' +
        '（uses_loot_table 边对同一 POI 可有多条，metadata.field=loot_table_overrides 区分）。',
      group: 'e10',
    },

    // ─── mechanic（机制型）────────────────────────────
    {
      key: 'mechanic',
      label: '机制类型',
      type: 'select',
      options: POI_MECHANIC_OPTIONS,
      required: false,
      default: '',
      description:
        '机制类型——非空时走 obl_execute_mechanic 分发框架，与 E-10 三档判定并列。' +
        'mechanic=craft_source 时 mechanic_value 引用 item.template.id（条件 refKind）；' +
        '其他类型 mechanic_value 是数字或无意义字符串。' +
        'interact_* 类型由 F-6 poi_interact 主流程接管，交互后 state 变更。',
      group: 'mechanic',
    },
    {
      key: 'mechanic_value',
      label: '机制值（多态）',
      type: 'text',
      required: false,
      default: '',
      placeholder: '数字（max_hp_up）或 item_id（craft_source）',
      description:
        '多态字段，语义由 mechanic 类型决定：' +
        'max_hp_up=数字（如 10）；craft_source=item.template.id（如 forge_t1）；' +
        'learn_skill/interact_*=无意义。' +
        'refKind 仅在 mechanic=craft_source 时生效（条件引用），由 O-3 边构建器按 mechanic 类型决定是否建边。',
      group: 'mechanic',
      visibleWhen: "mechanic !== ''",
    },
    {
      key: 'mechanic_params',
      label: '机制参数',
      type: 'json',
      required: false,
      default: '',
      placeholder: '如 ["passive","strategy","damage"]',
      description:
        'JSON 字符串字段——PHP 中是数组（如 skill_totem 的 ["passive","strategy","damage"]），' +
        '适配器原样保留为 JSON 字符串。文本框 + JSON.parse 校验，不强行结构化。',
      group: 'mechanic',
      visibleWhen: "mechanic === 'learn_skill'",
    },

    // ─── durability（E-12 耐久）──────────────────────
    {
      key: 'ttl_days',
      label: '耐久天数',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      step: 1,
      description:
        '0=永不过期；玩家放置 POI 专用（F-7）。' +
        'campfire_unlit=1，到期由 day_cycle.func.php 的 day_changed 监听器清理。' +
        '世界生成路径不写 placed_by_pid/placed_at_day/ttl_days 三字段（默认 0）。',
      group: 'durability',
    },
    {
      key: 'dismantle_returns',
      label: '拆解返还材料',
      type: 'entry-list',
      required: false,
      default: [],
      description:
        'poi.dismantle 命令的返还材料配置——任意 state 都可拆除。' +
        'item_id 引用 item.template.id（dismantle_returns 边）。',
      group: 'durability',
      itemSchema: [
        {
          key: 'item_id',
          label: '道具 ID',
          type: 'text',
          required: true,
          default: '',
          placeholder: '如 tree_branch',
          refKind: 'item.template',
          refField: 'id',
          description: '返还道具 ID——引用 item.template.id',
          group: 'durability',
        },
        {
          key: 'count',
          label: '数量',
          type: 'number',
          required: true,
          default: 1,
          min: 0,
          step: 1,
          description: '返还数量',
          group: 'durability',
        },
      ],
    },
  ],
  refFields: [
    // POI → loot.table 的核心引用（uses_loot_table 边）
    { field: 'loot_table_id', refKind: 'loot.table', refField: 'id', required: false, refType: 'loot_table' },
    // 工具/技能路由的改良版表 ID 映射（kv-list 的 value 引用 loot.table.id）
    { field: 'loot_table_overrides[]', refKind: 'loot.table', refField: 'id', required: false, refType: 'loot_table' },
    // mechanic_value 条件引用：仅 mechanic=craft_source 时引用 item.template.id
    // O-3 边构建器按 mechanic 类型决定是否建 mechanic_ref 边
    { field: 'mechanic_value', refKind: 'item.template', refField: 'id', required: false, refType: 'direct' },
    // 拆除返还道具引用（dismantle_returns 边）
    { field: 'dismantle_returns[].item_id', refKind: 'item.template', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [
    // name/desc 已迁移至 vex-vue/src/data/poi-locale.ts，标记 deprecated
    // P5 单源编译完成后从 poi_table.php 中移除
    { field: 'name', presentation: true, deprecated: true, projectTo: 'presentation.poi.name' },
    { field: 'desc', presentation: true, deprecated: true, projectTo: 'presentation.poi.desc' },
  ],
  listColumns: [
    { field: 'name', labelKey: 'schema.poi.template.list.name', sortable: true, filterable: true, defaultVisible: true, width: 160 },
    { field: 'searchable', labelKey: 'schema.poi.template.list.searchable', sortable: true, filterable: true, defaultVisible: true, width: 80 },
    { field: 'mechanic', labelKey: 'schema.poi.template.list.mechanic', sortable: true, filterable: true, defaultVisible: true, width: 140 },
    { field: 'loot_table_id', labelKey: 'schema.poi.template.list.loot_table_id', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'repeatable', labelKey: 'schema.poi.template.list.repeatable', sortable: true, defaultVisible: false, width: 90 },
    { field: 'ttl_days', labelKey: 'schema.poi.template.list.ttl_days', sortable: true, defaultVisible: false, width: 90 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.poi.template.group.basic',
      fields: ['name', 'desc', 'searchable', 'repeatable', 'repeat_limit', 'repeat_cooldown'],
      defaultCollapsed: false,
    },
    {
      id: 'e10',
      labelKey: 'schema.poi.template.group.e10',
      fields: ['base_loot_chance', 'base_good_event_chance', 'base_bad_event_chance', 'loot_table_id', 'event_pool', 'prob_mods_source', 'loot_table_overrides'],
      defaultCollapsed: false,
    },
    {
      id: 'mechanic',
      labelKey: 'schema.poi.template.group.mechanic',
      fields: ['mechanic', 'mechanic_value', 'mechanic_params'],
      defaultCollapsed: false,
    },
    {
      id: 'durability',
      labelKey: 'schema.poi.template.group.durability',
      fields: ['ttl_days', 'dismantle_returns'],
      defaultCollapsed: true,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'poi_mechanic_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'poi.mechanic_invalid',
    },
    // 第 3 层引用校验（P0 已声明 rule ID，P3 阶段生效）
    {
      ruleId: 'poi.loot_table_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'poi.loot_table_ref_dangling',
    },
    {
      ruleId: 'poi.loot_table_override_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'poi.loot_table_override_ref_dangling',
    },
    {
      ruleId: 'poi.mechanic_value_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'poi.mechanic_value_ref_dangling',
    },
    {
      ruleId: 'poi.dismantle_returns_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'poi.dismantle_returns_ref_dangling',
    },
    // 第 6 层呈现校验（P0 已声明 rule ID）
    {
      ruleId: 'presentation.poi.missing',
      layer: 6,
      severity: 'error',
      validatorFn: 'presentation.poi.missing',
    },
    {
      ruleId: 'presentation.poi.orphan',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.poi.orphan',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/pois/pois.yaml',
    rootKey: 'pois',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/poi_table.php',
      projector: './projectors/poi-table-projector',
      module: 'E 游戏逻辑',
      sectionTitle: 'Oblivions POI 模板表',
    },
  ],
};
