// @module O 内容工具箱
//
// 配置 schema 接口定义（对齐 NEW_DESIGN.md §3.4.5 schema 驱动 UI）
//
// 设计意图（对齐 2.6 配置驱动）：
//   - 每个配置类型声明 schema（字段描述：key/label/type/options/validation/required）
//   - 表单组件按 schema 自动渲染控件
//   - 新增字段只需更新 schema，无需修改组件
//
// 研判：
//   - schema 是配置编辑框架的核心契约
//   - 复用 Tide 类型作为 phase 选项
//   - validateStore 可读取 schema 元数据生成校验规则（未来扩展）

import type { Tide } from '../types/map';

/**
 * 字段类型枚举
 *
 * - text：单行文本
 * - number：数字（含整数/浮点）
 * - boolean：复选框
 * - select：下拉选择
 * - json：JSON 文本框（mechanic_params 等结构不定的字段，文本框 + JSON.parse 校验）
 * - count-range：count 字段（number | [min, max]），渲染为 min/max 双数字输入
 * - string-list：字符串数组（prob_mods_source 等）
 * - kv-list：键值对映射（loot_table_overrides 等）
 * - entry-list：结构化条目数组（event_pool / dismantle_returns 等）
 * - ref：单值引用（next_region 等），渲染为资源选择器；目标 kind/字段由 refKind / refField 指定
 * - ref-list：引用数组（neighbors / _breaks 等），渲染为多选资源选择器
 */
export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'json'
  | 'count-range'
  | 'string-list'
  | 'kv-list'
  | 'entry-list'
  | 'ref'
  | 'ref-list';

/**
 * 字段 schema 描述
 */
export interface FieldSchema {
  /** 字段名（snake_case，对齐后端 PHP） */
  key: string;
  /** UI 显示标签（中文） */
  label: string;
  /** 字段类型 */
  type: FieldType;
  /** select 类型的选项 */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** 是否必填（默认 false） */
  required?: boolean;
  /** number 类型的最小值 */
  min?: number;
  /** number 类型的最大值 */
  max?: number;
  /** number 类型的步进 */
  step?: number;
  /** 占位符文案 */
  placeholder?: string;
  /** 默认值（新增条目时使用） */
  default?: unknown;
  /** 字段分组（基本 / E-10 三档判定 / 机制型 / E-12 耐久） */
  group?: string;
  /** 帮助文案 */
  description?: string;
  /** entry-list 子 schema（type='entry-list' 时必填） */
  itemSchema?: FieldSchema[];
  /** string-list 元素类型（默认 text） */
  itemType?: 'text' | 'select';
  /** string-list select 选项（itemType='select' 时） */
  itemOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** kv-list 值类型（默认 text） */
  valueType?: 'text' | 'select';
  /** kv-list value select 选项（valueType='select' 时） */
  valueOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** kv-list key 占位符 */
  keyPlaceholder?: string;
  /** kv-list value 占位符 */
  valuePlaceholder?: string;
}

/**
 * 条目 schema（一个完整条目由多个字段组成）
 */
export interface EntrySchema {
  /** 字段列表 */
  fields: FieldSchema[];
}

/**
 * Tide 三档选项（schema 复用）
 */
export const TIDE_SCHEMA_OPTIONS: ReadonlyArray<{ value: Tide; label: string }> = [
  { value: 'shallow', label: '浅滩' },
  { value: 'deep', label: '深水' },
  { value: 'abyss', label: '深海' },
] as const;

/**
 * Scatter 相位选项（initial / refresh）
 */
export const SCATTER_PHASE_OPTIONS: ReadonlyArray<{ value: 'initial' | 'refresh'; label: string }> = [
  { value: 'initial', label: '初始' },
  { value: 'refresh', label: '刷新' },
] as const;

/**
 * POI 事件 kind 选项
 */
export const POI_EVENT_KIND_OPTIONS: ReadonlyArray<{ value: 'good' | 'bad'; label: string }> = [
  { value: 'good', label: '良性' },
  { value: 'bad', label: '恶性' },
] as const;
