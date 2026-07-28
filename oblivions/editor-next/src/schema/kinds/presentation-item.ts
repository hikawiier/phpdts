/**
 * @module O 内容工具箱
 *
 * presentation.item kind 完整 schema。来源：vex-vue/src/data/item-locale.ts。
 *
 * 标准形态：`export const ITEM_LOCALE: Record<string, ItemLocaleEntry> = { ... }`
 * 107 个条目，每个 key 是 item ID（与 item.template 共享命名空间），value 是 { name, desc }。
 *
 * presentation 是图叶子：无 refFields，被 renders_as 边连接（item.template → presentation.item）。
 * 自身无 presentationFields（自身就是呈现数据）。
 *
 * 特殊条目：innate_craft_t0（item-locale.ts:65，注释"虚拟素材（被动技能）"）
 * 是已知孤儿——没有对应 item.template 节点，但合法存在。通过 KNOWN_VIRTUAL_MATERIAL_IDS
 * 标记，O-9 呈现工作区据此显示"虚拟素材"徽章，O-10 第 6 层校验据此区分"孤儿"与"已知虚拟素材"。
 *
 * fallback 链（vex-vue/src/data/item-locale.ts）：
 * - getItemName(itemId, customName)：locale → customName → itemId
 * - getItemDesc(itemId)：locale → ''
 */

import type { KindSchema } from '../types';

/**
 * 已知虚拟素材 ID 清单——这些 presentation.item 条目没有对应 item.template，
 * 但合法存在（通常是被动技能/系统虚拟素材）。
 *
 * O-10 第 6 层 item_presentation_orphan 校验规则据此白名单跳过 error，
 * 改为 info 级别提示。
 */
export const KNOWN_VIRTUAL_MATERIAL_IDS = [
  'innate_craft_t0', // 徒手合成——玩家自带的基础合成能力，无对应 item.template
] as const;

export const presentationItemSchema: KindSchema = {
  kind: 'presentation.item',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/item-locale.ts',
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
      placeholder: '如：生锈的水管',
      description:
        '道具中文显示名——前端 fallback 链：locale → customName → itemId。' +
        '见 vex-vue/src/data/item-locale.ts getItemName()。',
      group: 'basic',
    },
    {
      key: 'desc',
      label: '中文描述',
      type: 'text',
      required: false,
      default: '',
      placeholder: '道具中文描述',
      description:
        '道具中文描述——前端 fallback 链：locale → 空字符串。' +
        '见 vex-vue/src/data/item-locale.ts getItemDesc()。',
      group: 'basic',
    },
  ],
  refFields: [], // presentation 是图叶子
  presentationFields: [], // 自身就是呈现
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.item.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'desc', labelKey: 'schema.presentation.item.list.desc', filterable: true, defaultVisible: true, width: 320 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.item.group.basic',
      fields: ['name', 'desc'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'presentation_item_name_empty',
      layer: 2,
      severity: 'error',
      validatorFn: 'presentation.item.name_empty',
    },
    // 第 6 层呈现校验
    // 孤儿 presentation.item：没有对应 item.template 节点
    // 已知虚拟素材（KNOWN_VIRTUAL_MATERIAL_IDS）跳过 error，改为 info
    {
      ruleId: 'item_presentation_orphan',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.item.orphan',
    },
    // 反向：item.template 缺少 presentation.item（无中文文案）
    {
      ruleId: 'item_template_missing_presentation',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.item.template_missing',
    },
  ],
  copyStrategy: 'deep-clone',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/item-locale.yaml',
    rootKey: 'items',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/item-locale.ts',
      projector: './projectors/item-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
