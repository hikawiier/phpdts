/**
 * @module O 内容工具箱
 *
 * presentation.ui kind 最小 schema。来源：vex-vue/src/data/ui-locale.ts。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约。
 *
 * 数据结构：`export const UI_TEXT = { CARTOGRAPHY: '地图', ... } as const`——
 * 简单形态（UPPER_SNAKE_CASE key→中文文案扁平映射，无 name/desc 结构）。
 * 每个 key 是 UI 文本 ID（如 'CARTOGRAPHY'），value 是中文文案。
 *
 * 注意：UI_TEXT 中部分 key 是 ASCII 终端风格资源缩写（HP/SP/AP/LV），
 * value 与 key 相同——投影器（P5-2）按 schema.auxiliaryData 声明的 asciiPassthrough
 * 集合保留 value=key 行为，避免误中文化破坏终端风格。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const presentationUiSchema: KindSchema = {
  kind: 'presentation.ui',
  idPattern: /^[A-Z][A-Z0-9_]*$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/ui-locale.ts',
      format: 'ts',
      parser: 'ts-locale',
      load: 'map-keyed',
    },
  ],
  parser: 'ts-locale',
  fields: [
    {
      key: 'name',
      label: '中文文案',
      type: 'text',
      required: true,
      default: '',
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.ui.list.name', sortable: true, filterable: true, defaultVisible: true, width: 220 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.ui.group.basic',
      fields: ['name'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'deep-clone',
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/ui-locale.yaml',
    rootKey: 'ui_text',
    itemKey: 'ui_key',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/ui-locale.ts',
      projector: './projectors/ui-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
