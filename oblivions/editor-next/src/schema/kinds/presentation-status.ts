/**
 * @module O 内容工具箱
 *
 * presentation.status kind 最小 schema。来源：vex-vue/src/data/status-locale.ts。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约。
 *
 * 数据结构：`export const STATUS_LOCALE: Record<string, StatusLocaleEntry> = { ... }`，
 * 其中 `StatusLocaleEntry = { name: string; description: string }`。
 * 每个 key 是 status ID（如 'flustered'），value 含中文名与中文描述。
 *
 * 注意：status-locale.ts 还导出 CAPABILITY_LABELS（ActorCapability→中文标签），
 * 属于与 status 强耦合的辅助静态数据——投影器（P5-2）按 schema.auxiliaryData
 * 重建该常量，避免硬编码。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const presentationStatusSchema: KindSchema = {
  kind: 'presentation.status',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/status-locale.ts',
      format: 'ts',
      parser: 'ts-status-locale',
      load: 'map-keyed',
    },
  ],
  parser: 'ts-status-locale',
  fields: [
    {
      key: 'name',
      label: '中文名',
      type: 'text',
      required: true,
      default: '',
      group: 'basic',
    },
    {
      key: 'description',
      label: '中文描述',
      type: 'text',
      required: true,
      default: '',
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.status.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'description', labelKey: 'schema.presentation.status.list.description', sortable: false, filterable: true, defaultVisible: true, width: 320 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.status.group.basic',
      fields: ['name', 'description'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'deep-clone',
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/status-locale.yaml',
    rootKey: 'status_locale',
    itemKey: 'status_id',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/status-locale.ts',
      projector: './projectors/status-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
