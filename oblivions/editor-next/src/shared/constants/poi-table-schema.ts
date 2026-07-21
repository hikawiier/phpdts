//
// poi_table 字段 schema（对齐 gamedata/poi_table.php）
//
// 字段分组：
//   - 基本：name / desc / searchable / repeatable / repeat_limit / repeat_cooldown
//   - E-10 三档判定：base_loot_chance / base_good_event_chance / base_bad_event_chance /
//                   loot_table_id / event_pool / prob_mods_source / loot_table_overrides
//   - 机制型：mechanic / mechanic_value / mechanic_params（JSON 字符串）
//   - E-12 耐久：ttl_days / dismantle_returns
//
// 字段大部分可选——landmark / forge_anvil_poi 等仅含部分字段
// mechanic_params 用 json 类型（文本框 + JSON.parse 校验，不强行结构化）

import type { EntrySchema, FieldSchema } from './schema';
import { POI_EVENT_KIND_OPTIONS } from './schema';

/**
 * event_pool 子列表 entry schema
 */
export const POI_EVENT_POOL_ENTRY_SCHEMA: EntrySchema = {
  fields: [
    {
      key: 'event_id',
      label: '事件 ID',
      type: 'text',
      required: true,
      placeholder: 'find_extra_cache',
      default: '',
      group: 'event_pool',
    },
    {
      key: 'weight',
      label: '权重',
      type: 'number',
      required: true,
      min: 0,
      default: 30,
      group: 'event_pool',
    },
    {
      key: 'kind',
      label: '类型',
      type: 'select',
      options: POI_EVENT_KIND_OPTIONS,
      required: true,
      default: 'good',
      group: 'event_pool',
    },
  ] satisfies FieldSchema[],
};

/**
 * dismantle_returns 子列表 entry schema（E-12 耐久系统）
 */
export const POI_DISMANTLE_RETURN_ENTRY_SCHEMA: EntrySchema = {
  fields: [
    {
      key: 'item_id',
      label: '道具 ID',
      type: 'text',
      required: true,
      placeholder: 'tree_branch',
      default: '',
      group: 'dismantle_returns',
    },
    {
      key: 'count',
      label: '数量',
      type: 'number',
      required: true,
      min: 0,
      default: 1,
      group: 'dismantle_returns',
    },
  ] satisfies FieldSchema[],
};

/**
 * poi_table 单条模板的字段 schema
 *
 * 字段分组对齐设计案：基本 / E-10 三档判定 / 机制型 / E-12 耐久
 * 通过 group 字段在 UI 中分组渲染
 */
export const POI_TABLE_ENTRY_SCHEMA: EntrySchema = {
  fields: [
    // ─── 基本 ──────────────────────────────────────
    {
      key: 'name',
      label: '名称',
      type: 'text',
      default: '',
      group: '基本',
    },
    {
      key: 'desc',
      label: '描述',
      type: 'text',
      default: '',
      group: '基本',
    },
    {
      key: 'searchable',
      label: '可搜索',
      type: 'boolean',
      required: true,
      default: false,
      group: '基本',
    },
    {
      key: 'repeatable',
      label: '可重复',
      type: 'boolean',
      required: true,
      default: false,
      group: '基本',
    },
    {
      key: 'repeat_limit',
      label: '重复次数上限',
      type: 'number',
      min: 0,
      default: 0,
      group: '基本',
      description: '0=无限',
    },
    {
      key: 'repeat_cooldown',
      label: '重复冷却回合',
      type: 'number',
      min: 0,
      default: 0,
      group: '基本',
    },
    // ─── E-10 三档判定 ──────────────────────────────
    {
      key: 'base_loot_chance',
      label: '基础物资概率',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      group: 'E-10 三档判定',
      description: '0-1，基础概率不折算',
    },
    {
      key: 'base_good_event_chance',
      label: '基础良性事件概率',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      group: 'E-10 三档判定',
    },
    {
      key: 'base_bad_event_chance',
      label: '基础恶性事件概率',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      group: 'E-10 三档判定',
    },
    {
      key: 'loot_table_id',
      label: '战利品表 ID',
      type: 'text',
      placeholder: 'supply_cache_loot',
      default: '',
      group: 'E-10 三档判定',
      description: '关联 F-4 战利品表 ID，存在性校验由 O-3 验证工具负责',
    },
    {
      key: 'event_pool',
      label: '事件池',
      type: 'entry-list',
      itemSchema: POI_EVENT_POOL_ENTRY_SCHEMA.fields,
      default: [],
      group: 'E-10 三档判定',
      description: '事件 ID 列表（带 weight/kind）',
    },
    {
      key: 'prob_mods_source',
      label: '概率修正来源',
      type: 'string-list',
      default: [],
      group: 'E-10 三档判定',
      description: '接受哪些工具/技能的 prob_mods（白名单）',
    },
    {
      key: 'loot_table_overrides',
      label: '战利品表覆盖',
      type: 'kv-list',
      keyPlaceholder: '工具/技能 ID',
      valuePlaceholder: 'loot_table_id',
      default: {},
      group: 'E-10 三档判定',
      description: '工具/技能 ID → loot_table_id 映射',
    },
    // ─── 机制型 ──────────────────────────────────────
    {
      key: 'mechanic',
      label: '机制类型',
      type: 'text',
      placeholder: 'max_hp_up / craft_source / interact_locked_door',
      default: '',
      group: '机制型',
      description: '机制类型由后端注册集决定，存在性校验由 O-3 验证工具负责',
    },
    {
      key: 'mechanic_value',
      label: '机制值',
      type: 'text',
      default: '',
      group: '机制型',
      description: '数字（如 10）或字符串（如 forge_t1），由 mechanic 类型决定',
    },
    {
      key: 'mechanic_params',
      label: '机制参数',
      type: 'json',
      default: '',
      group: '机制型',
      description: 'JSON 字符串字段，文本框 + JSON.parse 校验，不强行结构化',
    },
    // ─── E-12 耐久 ──────────────────────────────────
    {
      key: 'ttl_days',
      label: '耐久天数',
      type: 'number',
      min: 0,
      default: 0,
      group: 'E-12 耐久',
      description: '0=永不过期',
    },
    {
      key: 'dismantle_returns',
      label: '拆解返还',
      type: 'entry-list',
      itemSchema: POI_DISMANTLE_RETURN_ENTRY_SCHEMA.fields,
      default: [],
      group: 'E-12 耐久',
      description: 'poi.dismantle 命令的返还材料配置',
    },
  ] satisfies FieldSchema[],
};

/**
 * POI 模板字段分组顺序（UI 渲染时按此顺序分组）
 */
export const POI_TABLE_FIELD_GROUPS = ['基本', 'E-10 三档判定', '机制型', 'E-12 耐久'] as const;
