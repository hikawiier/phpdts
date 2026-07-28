// @module O 内容工具箱
//
// poi_pool 字段 schema（对齐 gamedata/poi_pool.php）
//
// 字段：poi_id（从 poi_table 联动下拉）+ per_region
// 三 tide 共享同一 schema，UI 渲染时 poi_id 选项由 configStore.poiTable 动态填充

import type { EntrySchema, FieldSchema } from './schema';

/**
 * poi_pool 单条 entry 的字段 schema
 *
 * poi_id 字段在 UI 渲染时动态注入 options（来自 poi_table 模板列表），
 * schema 默认 options 为空数组，由 PoiPoolEditor 在挂载时填充
 */
export const POI_POOL_ENTRY_SCHEMA: EntrySchema = {
  fields: [
    {
      key: 'poi_id',
      label: 'POI ID',
      type: 'select',
      required: true,
      options: [],
      placeholder: '选择 POI 模板',
      default: '',
      group: '基本',
      description: '从 poi_table 模板列表中选择，存在性校验由 O-3 验证工具负责',
    },
    {
      key: 'per_region',
      label: '每区域数量',
      type: 'number',
      required: true,
      min: 0,
      default: 1,
      group: '基本',
    },
  ] satisfies FieldSchema[],
};

/**
 * poi_pool 三档 tide 列表（schema 驱动 UI 渲染 Tab）
 */
export const POI_POOL_TIDES = ['shallow', 'deep', 'abyss'] as const;
