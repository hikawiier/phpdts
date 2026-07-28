/**
 * @module O 内容工具箱
 *
 * world.tile kind 完整 schema。来源：oblivions/gamedata/tiles/region_${pgroup}.php。
 *
 * 每个区域一个文件，文件内是 Map<pls, tileEntry>，pls 是区域内局部索引。
 * 节点 id 是 `${pgroup}:${pls}` 复合字符串，保证跨区域全局唯一。
 *
 * pgroup 由文件名派生（不参与 codegen——codegen 时按 pgroup 分组输出文件），
 * pls 由 PHP 数组 key 派生。
 *
 * 邻接关系 neighbors 是无向图：A.neighbors 包含 B 等价于 B.neighbors 包含 A，
 * 由 graph-store 自动维护 adjacent_to 边。
 *
 * _breaks 是编辑器专用字段，记录被显式断开的连通 pls（不参与 codegen，
 * stripEditorFields 在序列化时剥离）。
 */

import type { KindSchema } from '../types';

export const worldTileSchema: KindSchema = {
  kind: 'world.tile',
  idPattern: /^\d+:\d+$/,
  sourceFiles: [
    {
      // ${id} 是 pgroup（region ID），文件内每个 pls key 一个 tile 节点
      path: 'oblivions/gamedata/tiles/region_${id}.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  serializer: 'php-tile',
  fields: [
    {
      key: 'pgroup',
      label: '所属区域',
      type: 'number',
      required: true,
      min: 1,
      max: 254,
      step: 1,
      description: '派生自文件名 region_${pgroup}.php，不参与 codegen',
      group: '基本属性',
    },
    {
      key: 'pls',
      label: '区域内 pls',
      type: 'number',
      required: true,
      min: 1,
      max: 254,
      step: 1,
      description: '区域内局部索引，pls=0 保留不使用',
      group: '基本属性',
    },
    {
      key: 'name',
      label: 'tile 名',
      type: 'text',
      required: false,
      default: '',
      placeholder: '可选，默认空字符串',
      group: '基本属性',
    },
    {
      key: 'desc',
      label: 'tile 描述',
      type: 'text',
      required: false,
      default: '',
      group: '基本属性',
    },
    {
      key: 'floor',
      label: '地板类型',
      type: 'select',
      required: true,
      options: [
        { value: 'standard', label: '标准' },
        { value: 'water', label: '水域' },
        { value: 'vegetation', label: '植被' },
        { value: 'metal', label: '金属' },
        { value: 'magic', label: '魔法' },
      ],
      default: 'standard',
      group: '地形',
    },
    {
      key: 'tide',
      label: '潮汐等级',
      type: 'select',
      required: true,
      options: [
        { value: 'shallow', label: '浅滩' },
        { value: 'deep', label: '深水' },
        { value: 'abyss', label: '深海' },
      ],
      default: 'shallow',
      group: '地形',
    },
    {
      key: 'height',
      label: '高度',
      type: 'number',
      required: false,
      default: 0,
      step: 1,
      group: '地形',
    },
    {
      key: 'passable',
      label: '可通行',
      type: 'boolean',
      required: true,
      default: true,
      group: '地形',
    },
    {
      key: 'destructible',
      label: '可破坏',
      type: 'boolean',
      required: false,
      default: false,
      group: '地形',
    },
    {
      key: 'preset_safe',
      label: '预设安全格',
      type: 'boolean',
      required: false,
      default: false,
      description: '独立标记，与 tide 三档互斥（safe 不在 tide 选项中）',
      group: '地形',
    },
    {
      key: 'neighbors',
      label: '邻接 tile',
      type: 'ref-list',
      required: true,
      refKind: 'world.tile',
      refField: 'id',
      default: [],
      description: '无向图邻接关系——graph-store 自动维护 adjacent_to 边',
      group: '邻接',
    },
    {
      key: 'x',
      label: 'x 坐标',
      type: 'number',
      required: true,
      step: 1,
      group: '位置',
    },
    {
      key: 'y',
      label: 'y 坐标',
      type: 'number',
      required: true,
      step: 1,
      group: '位置',
    },
    {
      key: '_breaks',
      label: '显式断开的连通 pls',
      type: 'ref-list',
      required: false,
      refKind: 'world.tile',
      refField: 'id',
      default: [],
      description: '编辑器专用，不参与 codegen——stripEditorFields 在序列化时剥离',
      group: '邻接',
    },
  ],
  refFields: [
    { field: 'neighbors[]', refKind: 'world.tile', refField: 'id', required: false, refType: 'direct' },
    { field: '_breaks[]', refKind: 'world.tile', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // region_*.php 的 name/desc 未迁移至 locale，仍为运行时数据
  listColumns: [
    { field: 'pgroup', labelKey: 'schema.world.tile.list.pgroup', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'pls', labelKey: 'schema.world.tile.list.pls', sortable: true, defaultVisible: true, width: 80 },
    { field: 'floor', labelKey: 'schema.world.tile.list.floor', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'tide', labelKey: 'schema.world.tile.list.tide', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'passable', labelKey: 'schema.world.tile.list.passable', sortable: true, defaultVisible: true, width: 80 },
    { field: 'x', labelKey: 'schema.world.tile.list.x', sortable: true, defaultVisible: true, width: 60 },
    { field: 'y', labelKey: 'schema.world.tile.list.y', sortable: true, defaultVisible: true, width: 60 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.world.tile.group.basic',
      fields: ['pgroup', 'pls', 'name', 'desc'],
      defaultCollapsed: false,
    },
    {
      id: 'terrain',
      labelKey: 'schema.world.tile.group.terrain',
      fields: ['floor', 'tide', 'height', 'passable', 'destructible', 'preset_safe'],
      defaultCollapsed: false,
    },
    {
      id: 'position',
      labelKey: 'schema.world.tile.group.position',
      fields: ['x', 'y'],
      defaultCollapsed: false,
    },
    {
      id: 'adjacency',
      labelKey: 'schema.world.tile.group.adjacency',
      fields: ['neighbors', '_breaks'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 复用 O-10 第 2 层结构校验现有 rule ID
    {
      ruleId: 'pls_range',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.pls_range',
    },
    {
      ruleId: 'tile_floor_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.floor_invalid',
    },
    {
      ruleId: 'tile_tide_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.tide_invalid',
    },
    {
      ruleId: 'occupy_conflict',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.occupy_conflict',
    },
    {
      ruleId: 'tile_neighbor_dangling',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.neighbor_dangling',
    },
    {
      ruleId: 'tile_neighbor_asymmetric',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.neighbor_asymmetric',
    },
    // 新增 rule ID：同 pgroup 内 pls 唯一（idPattern 已保证全局唯一，本规则做语义校验）
    {
      ruleId: 'tile_pgroup_unique_for_pls',
      layer: 2,
      severity: 'error',
      validatorFn: 'tile.pgroup_unique_for_pls',
    },
  ],
  copyStrategy: 'deep-clone',
  // p0Loaded=false：跳过通用 schema-driven 路径
  // world.tile 由 loader.ts 的 loadWorldResources() 专用装配——
  // 与 world.region 共同从 MapProject 重建（P1 执行案 §4.1.1）。
  // 原因：world.tile 节点需要 contains / adjacent_to 边与 world.region 联动，
  // 必须通过 assembleWorldResources 统一装配，不能走单文件 map-keyed 路径。
  p0Loaded: false,

  // —— P5 O-11 单源编译元数据 ——
  // world.tile 有 authorFormat 声明 YAML 位置（按 pgroup 分文件），但无 projectionTargets——
  // P5 阶段由 P1 projectStore 管理世界资源，不进入编译产物。
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/worlds/tiles/region_${id}.yaml',
    rootKey: 'tiles',
    itemKey: 'pls',
  },
};
