/**
 * @module O 内容工具箱
 *
 * presentation.terrain kind 最小 schema。来源：vex-vue/src/data/terrain-desc.ts。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约。
 * terrain-desc 结构与其他 locale 不同（嵌套词库 vs 扁平 name/desc），需要独立投影器
 * （ts-terrain 投影器，P5-2 实现）。
 *
 * 数据结构：单一 TerrainDescConfig 对象（非 map-keyed），含 floor / tide /
 * impassable_suffix / templates 四个顶层字段。每个 floor 类型对应 FloorConfig
 * （name[] / adj[]），tide 类型对应 string[]。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const presentationTerrainSchema: KindSchema = {
  kind: 'presentation.terrain',
  idPattern: /^(floor|tide|impassable_suffix|templates)$/,
  sourceFiles: [
    {
      path: 'vex-vue/src/data/terrain-desc.ts',
      format: 'ts',
      parser: 'ts-terrain-desc',
      load: 'single',
      singleNodeId: 'terrain_desc',
    },
  ],
  parser: 'ts-terrain-desc',
  fields: [
    {
      key: 'floor',
      label: '地面类型词库',
      type: 'kv-list',
      required: true,
      group: 'basic',
    },
    {
      key: 'tide',
      label: '潮汐修饰词库',
      type: 'kv-list',
      required: true,
      group: 'basic',
    },
    {
      key: 'impassable_suffix',
      label: '不可通行后缀',
      type: 'string-list',
      required: true,
      group: 'basic',
    },
    {
      key: 'templates',
      label: '描述模板',
      type: 'json',
      required: true,
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.terrain.group.basic',
      fields: ['floor', 'tide', 'impassable_suffix', 'templates'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'none',
  readOnly: true,
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/terrain-desc.yaml',
    rootKey: 'terrain_desc',
    itemKey: 'section',
  },
  projectionTargets: [
    {
      kind: 'ts-terrain',
      filePath: 'vex-vue/src/data/terrain-desc.ts',
      projector: './projectors/terrain-desc-projector',
      module: 'K 状态管理层',
    },
  ],
};
