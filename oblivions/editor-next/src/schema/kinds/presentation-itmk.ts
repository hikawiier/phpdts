/**
 * @module O 内容工具箱
 *
 * presentation.itmk kind 最小 schema。来源：vex-vue/src/data/itmk-locale.ts。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约。
 *
 * 数据结构：`export const ITMK_LOCALE: Record<string, string> = { ... }`——
 * 简单形态（key→中文名扁平映射，无 name/desc 结构）。每个 key 是 itmk 代码
 * （如 'WP' / 'WK'），value 是中文名。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const presentationItmkSchema: KindSchema = {
  kind: 'presentation.itmk',
  idPattern: /^[A-Z]{2}$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/itmk-locale.ts',
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
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.itmk.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.itmk.group.basic',
      fields: ['name'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'deep-clone',
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/itmk-locale.yaml',
    rootKey: 'itmk_locale',
    itemKey: 'itmk',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/itmk-locale.ts',
      projector: './projectors/itmk-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
