/**
 * @module O 内容工具箱
 *
 * presentation.poi kind 完整 schema。来源：vex-vue/src/data/poi-locale.ts。
 *
 * 标准形态：`export const POI_LOCALE: Record<string, PoiLocaleEntry> = { ... }`
 * 27 个条目（P3 修复前），每个 key 是 POI ID（与 poi.template 共享命名空间），value 是 { name, desc }。
 *
 * P3 双源漂移修复（执行案 §4.9）：
 *   - 缺失条目：locked_door / locked_chest（poi_table.php 有 fallback，poi-locale.ts 缺失）
 *   - 修复后 29 条目 = poi_table.php 29 模板，覆盖率 100%，孤儿 0
 *
 * presentation 是图叶子：无 refFields，被 renders_as 边连接（poi.template → presentation.poi）。
 * 自身无 presentationFields（自身就是呈现数据）。
 *
 * fallback 链（vex-vue/src/data/poi-locale.ts）：
 * - getPoiName(poiId, fallbackName)：locale → fallbackName → poiId
 * - getPoiDesc(poiId, fallbackDesc)：locale → fallbackDesc → ''
 *
 * 渲染预览（O-9 呈现工作区）：
 * - 通过 iframe + postMessage 调用 getPoiName / getPoiDesc 纯函数版本
 * - 后端 fallback 取自同 ID poi.template 的 name / desc 字段（deprecated）
 * - 最终值 = getPoiName(id, fallback) 调用结果
 */

import type { KindSchema } from '../types';

export const presentationPoiSchema: KindSchema = {
  kind: 'presentation.poi',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/poi-locale.ts',
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
      placeholder: '如：补给储藏箱',
      description:
        'POI 中文显示名——前端 fallback 链：locale → fallbackName → poiId。' +
        '见 vex-vue/src/data/poi-locale.ts getPoiName()。',
      group: 'basic',
    },
    {
      key: 'desc',
      label: '中文描述',
      type: 'text',
      required: true,
      default: '',
      placeholder: 'POI 中文描述',
      description:
        'POI 中文描述——前端 fallback 链：locale → fallbackDesc → 空字符串。' +
        '见 vex-vue/src/data/poi-locale.ts getPoiDesc()。',
      group: 'basic',
    },
  ],
  refFields: [], // presentation 是图叶子；renders_as 边由同 ID 自动构建（不在 refFields 声明）
  presentationFields: [], // 自身就是呈现
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.poi.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'desc', labelKey: 'schema.presentation.poi.list.desc', filterable: true, defaultVisible: true, width: 320 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.poi.group.basic',
      fields: ['name', 'desc'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'presentation_poi_name_empty',
      layer: 2,
      severity: 'error',
      validatorFn: 'presentation.poi.name_empty',
    },
    {
      ruleId: 'presentation_poi_desc_empty',
      layer: 2,
      severity: 'warning',
      validatorFn: 'presentation.poi.desc_empty',
    },
    // 第 6 层呈现校验（P0 已声明 rule ID）
    // 孤儿 presentation.poi：没有对应 poi.template 节点
    {
      ruleId: 'presentation.poi.orphan',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.poi.orphan',
    },
    // 反向：poi.template 缺少 presentation.poi（无中文文案）
    {
      ruleId: 'presentation.poi.missing',
      layer: 6,
      severity: 'error',
      validatorFn: 'presentation.poi.missing',
    },
    // locale 与后端 fallback 完全相同——冗余但无害（P5 单源编译后消除）
    {
      ruleId: 'presentation.poi.fallback_redundant',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.poi.fallback_redundant',
    },
  ],
  copyStrategy: 'deep-clone',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/poi-locale.yaml',
    rootKey: 'pois',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/poi-locale.ts',
      projector: './projectors/poi-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
