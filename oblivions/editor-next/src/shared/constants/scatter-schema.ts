// @module O 内容工具箱
//
// scatter_pool 字段 schema（对齐 gamedata/scatter_pool.php）
//
// 字段：item_id + count（number | [min, max]）+ rate（基础率，不折算）
// 三 tide × 两 phase（initial / refresh）= 6 个列表共享同一 schema
// rate 提示文案：基础率，运行时倍率由后端应用（对齐 DESIGN.md 2.6 + §3.4.1）

import type { EntrySchema, FieldSchema } from './schema';

/**
 * scatter_pool 单条 entry 的字段 schema
 */
export const SCATTER_POOL_ENTRY_SCHEMA: EntrySchema = {
  fields: [
    {
      key: 'item_id',
      label: '道具 ID',
      type: 'text',
      required: true,
      placeholder: 'scrap_metal',
      default: '',
      group: '基本',
      description: '野生道具 ID，外部引用存在性校验由 O-3 验证工具负责',
    },
    {
      key: 'count',
      label: '数量',
      type: 'count-range',
      required: true,
      min: 0,
      default: 1,
      group: '基本',
      description: '固定数或 [min, max] 范围；min == max 时为固定数',
    },
    {
      key: 'rate',
      label: '基础率',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.1,
      group: '基本',
      description: '基础率，不与运行时倍率预先折算——倍率由后端 wild_item_refresh_rate_by_tide 应用',
    },
  ] satisfies FieldSchema[],
};

/**
 * scatter_pool 三档 tide 列表（schema 驱动 UI 渲染 Tab）
 */
export const SCATTER_POOL_TIDES = ['shallow', 'deep', 'abyss'] as const;

/**
 * scatter_pool 每档下的两个相位
 */
export const SCATTER_POOL_PHASES = ['initial', 'refresh'] as const;
