/**
 * @module O 内容工具箱
 *
 * item.template kind 完整 schema。来源：oblivions/gamedata/item_table.php。
 *
 * 106 个道具模板，标准 map-keyed load——顶层 key 是 item ID，value 是模板字段。
 * 扩展区条目（item_table.php:656+）省略 itm/desc，由 presentation.item 提供中文文案。
 *
 * 字段分组（detailGroups）：
 *   - identity：itmk / tier（标识与稀有度）
 *   - combat：itme / itms / itmsk / itmpara（战斗参数）
 *   - behavior：tags / use_effect / tool_level / stack（行为与钩子）
 *   - legacy：itm / desc（deprecated 后端 fallback，已迁移至 presentation.item）
 *
 * 引用字段：
 * - use_effect：使用效果函数名，引用 effect.func（P2 仅做存在性校验，未注册为 BUILTIN_KIND）
 * - materials[].item_id（recipe.template 反向引用 item.template.id）
 *
 * 不变量（迁移自 item_table.php:19-22 文件头注释，由 O-10 第 4 层语义校验执行）：
 * - itmk ∈ {WP,WK,WG,WD,WF,WC,DB,DH,DF,DA} ⟹ tags 含 tag_equippable
 * - use_effect 非空 ⟺ tags 含 tag_usable
 * - itmk ∈ {MT,HH,HS,DX} ⟹ tags 不含 tag_equippable
 */

import type { KindSchema } from '../types';

/**
 * itmk 枚举选项（与 vex-vue/src/data/itmk-locale.ts 同步）。
 *
 * 13 个已在 itmk-locale.ts 中文化；WC/DB/DH/DF/DA 是旧规则集遗留代码，
 * item_table.php 实际使用（共 16 个），itmk-locale.ts 尚未补中文——
 * P2 阶段 schema 标签先用临时中文，P3 阶段 presentation.itmk 注册时统一补全。
 *
 * AR/AH/AA/AF 是预留护甲类别，itmk-locale.ts 已中文化但 item_table.php 未使用。
 */
export const ITMK_OPTIONS = [
  // 武器
  { value: 'WP', label: '钝器' },
  { value: 'WK', label: '锐器' },
  { value: 'WG', label: '远程兵器' },
  { value: 'WD', label: '爆炸物' },
  { value: 'WC', label: '投掷武器' },
  { value: 'WF', label: '灵力兵器' },
  // 弹药（旧规则集遗留代码，itmk-locale.ts 尚未补中文）
  { value: 'DB', label: '子弹' },
  { value: 'DH', label: '箭矢' },
  { value: 'DF', label: '飞镖' },
  { value: 'DA', label: '投掷弹药' },
  // 防具（预留，itmk-locale.ts 已中文化）
  { value: 'AR', label: '身体护甲' },
  { value: 'AH', label: '头部护甲' },
  { value: 'AA', label: '饰品' },
  { value: 'AF', label: '足部护甲' },
  // 消耗品
  { value: 'HH', label: '生命恢复' },
  { value: 'HS', label: '体力恢复' },
  { value: 'DX', label: '解毒剂' },
  // 素材/工具
  { value: 'MT', label: '素材' },
  { value: 'TK', label: '工具' },
  { value: 'SP', label: '特殊道具' },
] as const;

/**
 * tier 稀有度枚举（item_table.php 实际使用 common/uncommon/rare/epic）。
 * legendary 是预留扩展值，item_table.php 暂未使用。
 */
export const TIER_OPTIONS = [
  { value: 'common', label: '普通' },
  { value: 'uncommon', label: '精良' },
  { value: 'rare', label: '稀有' },
  { value: 'epic', label: '史诗' },
  { value: 'legendary', label: '传说' },
] as const;

/**
 * use_effect 枚举——item.use_effects.func.php 中注册的 6 个效果函数。
 * 空字符串表示无使用效果（默认）。
 *
 * 函数签名：function item_use_effect_{name}($item, &$pdata)
 * 见 oblivions/include/game/item/item.use_effects.func.php。
 */
export const USE_EFFECT_OPTIONS = [
  { value: '', label: '（无）' },
  { value: 'restore_hp', label: '恢复生命' },
  { value: 'restore_sp', label: '恢复体力' },
  { value: 'cure_bs', label: '治疗不良状态' },
  { value: 'gain_resistance', label: '获得抗性' },
  { value: 'open_gift_box', label: '打开礼盒' },
  { value: 'place_poi', label: '放置 POI' },
] as const;

export const itemTemplateSchema: KindSchema = {
  kind: 'item.template',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/item_table.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  fields: [
    // ─── identity（标识与稀有度）──────────────────────
    {
      key: 'itmk',
      label: '道具类别',
      type: 'select',
      options: ITMK_OPTIONS,
      required: true,
      description:
        '道具类别码——决定装备槽位/合成匹配/掉落分类。' +
        'WP/WK/WG/WD/WC/WF 是武器，DB/DH/DF/DA 是弹药，' +
        'AR/AH/AA/AF 是防具，HH/HS/DX 是消耗品，MT/TK/SP 是素材/工具/特殊。',
      group: 'identity',
    },
    {
      key: 'tier',
      label: '稀有度',
      type: 'select',
      options: TIER_OPTIONS,
      required: true,
      default: 'common',
      description: '稀有度等级——影响掉落权重与呈现颜色',
      group: 'identity',
    },

    // ─── combat（战斗参数）────────────────────────────
    {
      key: 'itme',
      label: '效果值',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      step: 1,
      description: '效果值/强度——武器为攻击力，护甲为减伤，消耗品为回复量',
      group: 'combat',
    },
    {
      key: 'itms',
      label: '数量/耐久',
      type: 'text',
      required: true,
      default: '0',
      placeholder: '20 或 ∞',
      description:
        '数量（堆叠道具）或耐久（装备/工具）。' +
        '数字字符串如 "20"，或特殊符号 "∞" 表示无限。' +
        '见 vex-vue/src/data/item-locale.ts isInfinite()。',
      group: 'combat',
    },
    {
      key: 'itmsk',
      label: '技能/属性后缀',
      type: 'text',
      required: false,
      default: '',
      placeholder: '如 p（毒系）',
      description: '技能/属性后缀——后端按字符解析附加效果（如 p=毒系）',
      group: 'combat',
    },
    {
      key: 'itmpara',
      label: '参数协议',
      type: 'text',
      required: false,
      default: '',
      placeholder: '如 poi_id:campfire_unlit',
      description:
        'use_effect 的参数协议字段。' +
        '当前仅 place_poi 使用，格式为 "poi_id:{poi_template_id}"，见 F-7 玩家放置 POI。',
      group: 'combat',
      visibleWhen: "use_effect === 'place_poi'",
    },

    // ─── behavior（行为与钩子）────────────────────────
    {
      key: 'tags',
      label: 'Tag 列表',
      type: 'string-list',
      required: true,
      default: [],
      placeholder: 'tag_equippable / tag_usable / tag_sharp ...',
      description:
        'Tag ID 数组——性质描述 Tag（tag_sharp/tag_combustible 等）' +
        '与系统钩子 Tag（tag_equippable/tag_usable/tag_tool_*）共存。' +
        '不变量由 O-10 第 4 层语义校验保证。',
      group: 'behavior',
    },
    {
      key: 'use_effect',
      label: '使用效果',
      type: 'select',
      options: USE_EFFECT_OPTIONS,
      required: false,
      default: '',
      description:
        '使用效果函数名——非空时 tags 必须含 tag_usable（O-10 强制校验）。' +
        '函数定义见 oblivions/include/game/item/item.use_effects.func.php。',
      group: 'behavior',
    },
    {
      key: 'tool_level',
      label: '工具等级',
      type: 'number',
      required: false,
      default: 0,
      min: 0,
      step: 1,
      description:
        '工具等级——0=无要求，1/2/3=基础/中阶/高阶。' +
        '高级工具兼容低级配方（recipe.materials[].min_level 校验）。' +
        '仅 tags 含 tag_tool_* 时有意义。',
      group: 'behavior',
    },
    {
      key: 'stack',
      label: '可堆叠',
      type: 'boolean',
      required: true,
      default: false,
      description: '是否可堆叠——堆叠道具 itms 是数量，非堆叠是耐久',
      group: 'behavior',
    },

    // ─── legacy（deprecated 后端 fallback）────────────
    {
      key: 'itm',
      label: '后端 fallback 名（deprecated）',
      type: 'text',
      required: false,
      default: '',
      presentation: true,
      deprecated: true,
      description:
        '已迁移至 presentation.item.name（vex-vue/src/data/item-locale.ts）。' +
        '扩展区条目省略此字段；P5 单源编译后从 item_table.php 移除。' +
        'fallback 链见 item-locale.ts getItemName()。',
      group: 'legacy',
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
        '已迁移至 presentation.item.desc。扩展区条目省略此字段；' +
        'P5 单源编译后从 item_table.php 移除。',
      group: 'legacy',
    },
  ],
  refFields: [
    // P2 仅做存在性校验：use_effect 必须是 item.use_effects.func.php 中注册的函数名
    // effect.func 待 P3+ 注册为 BUILTIN_KIND，届时 O-10 反向索引生效
    { field: 'use_effect', refKind: 'effect.func', refField: 'name', required: false, refType: 'effect' },
  ],
  presentationFields: [
    // itm/desc 已迁移至 vex-vue/src/data/item-locale.ts，标记 deprecated
    // P5 单源编译完成后从 item_table.php 中移除
    { field: 'itm', presentation: true, deprecated: true, projectTo: 'presentation.item.name' },
    { field: 'desc', presentation: true, deprecated: true, projectTo: 'presentation.item.desc' },
  ],
  listColumns: [
    { field: 'itmk', labelKey: 'schema.item.template.list.itmk', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'tier', labelKey: 'schema.item.template.list.tier', sortable: true, filterable: true, defaultVisible: true, width: 90 },
    { field: 'itme', labelKey: 'schema.item.template.list.itme', sortable: true, defaultVisible: true, width: 80 },
    { field: 'itms', labelKey: 'schema.item.template.list.itms', sortable: true, defaultVisible: true, width: 80 },
    { field: 'stack', labelKey: 'schema.item.template.list.stack', sortable: true, defaultVisible: true, width: 80 },
    { field: 'use_effect', labelKey: 'schema.item.template.list.use_effect', sortable: true, filterable: true, defaultVisible: true, width: 120 },
    { field: 'tags', labelKey: 'schema.item.template.list.tags', filterable: true, defaultVisible: false, width: 200 },
  ],
  detailGroups: [
    {
      id: 'identity',
      labelKey: 'schema.item.template.group.identity',
      fields: ['itmk', 'tier'],
      defaultCollapsed: false,
    },
    {
      id: 'combat',
      labelKey: 'schema.item.template.group.combat',
      fields: ['itme', 'itms', 'itmsk', 'itmpara'],
      defaultCollapsed: false,
    },
    {
      id: 'behavior',
      labelKey: 'schema.item.template.group.behavior',
      fields: ['tags', 'use_effect', 'tool_level', 'stack'],
      defaultCollapsed: false,
    },
    {
      id: 'legacy',
      labelKey: 'schema.item.template.group.legacy',
      fields: ['itm', 'desc'],
      defaultCollapsed: true,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'item_itmk_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'item.itmk_invalid',
    },
    {
      ruleId: 'item_tier_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'item.tier_invalid',
    },
    {
      ruleId: 'item_use_effect_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'item.use_effect_invalid',
    },
    // 第 4 层语义校验（不变量，迁移自 item_table.php:19-22 文件头注释）
    {
      ruleId: 'item_weapon_missing_tag_equippable',
      layer: 4,
      severity: 'error',
      validatorFn: 'item.weapon_missing_tag_equippable',
    },
    {
      ruleId: 'item_use_effect_tag_mismatch',
      layer: 4,
      severity: 'error',
      validatorFn: 'item.use_effect_tag_mismatch',
    },
    {
      ruleId: 'item_non_equippable_has_tag_equippable',
      layer: 4,
      severity: 'error',
      validatorFn: 'item.non_equippable_has_tag_equippable',
    },
    // 第 6 层呈现校验： itm/desc 已迁移，存在但不阻塞
    {
      ruleId: 'item_legacy_field_should_be_empty',
      layer: 6,
      severity: 'warning',
      validatorFn: 'item.legacy_field_should_be_empty',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/items/items.yaml',
    rootKey: 'items',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/item_table.php',
      projector: './projectors/item-table-projector',
      module: 'F 物品系统',
      sectionTitle: 'Oblivions 道具表',
      fieldOrder: ['itm', 'itmk', 'itme', 'itms', 'itmsk', 'itmpara', 'desc', 'tier', 'stack', 'tags', 'use_effect', 'tool_level'],
      alignmentStyle: 'space-padded',
    },
  ],
};
