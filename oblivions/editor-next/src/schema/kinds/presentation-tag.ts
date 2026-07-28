/**
 * @module O 内容工具箱
 *
 * presentation.tag kind 最小 schema。来源：vex-vue/src/data/tag-locale.ts。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约。
 *
 * 数据结构：`export const TAG_LOCALE: Record<string, string> = { ... }`——
 * 简单形态（tag_id→中文标签扁平映射）。每个 key 是 tag ID（如 'tag_combustible'），
 * value 是中文标签。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const presentationTagSchema: KindSchema = {
  kind: 'presentation.tag',
  idPattern: /^tag_[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/tag-locale.ts',
      format: 'ts',
      parser: 'ts-locale',
      load: 'map-keyed',
    },
  ],
  parser: 'ts-locale',
  fields: [
    {
      key: 'name',
      label: '中文标签',
      type: 'text',
      required: true,
      default: '',
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.tag.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.tag.group.basic',
      fields: ['name'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'deep-clone',
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/tag-locale.yaml',
    rootKey: 'tag_locale',
    itemKey: 'tag_id',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/tag-locale.ts',
      projector: './projectors/tag-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
