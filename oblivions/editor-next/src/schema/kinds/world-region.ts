/**
 * @module O 内容工具箱
 *
 * world.region kind 完整 schema。来源：oblivions/gamedata/map.php 顶层 'regions' 子键。
 *
 * P1 阶段从 P0 骨架升级为 map-keyed load：每个 pgroup 顶层 key 一个 region 节点，
 * id 是 pgroup 数字字符串。map.php 同时包含 'regions' 与 'grids' 两个子键：
 * - regions[pgroup] 提供 name / desc / entrance_pls / exit_pls / next_region / prev_region / exit_links / cols / rows
 * - grids[pgroup] 提供 cols / rows 冗余字段（与 regions.cols/rows 同步）
 *
 * O-4 adapter 装配时 regions[pgroup] 与 grids[pgroup] 合并写入同一节点；
 * 序列化时分别写回 regions 与 grids 子键，保持后端契约。
 *
 * 引用字段：
 * - next_region / prev_region：双向链 next/prev，编辑器自动派生对称
 * - exit_links[].to_pgroup：跨区域出口跳转
 */

import type { KindSchema } from '../types';

export const worldRegionSchema: KindSchema = {
  kind: 'world.region',
  idPattern: /^\d+$/,
  sourceFiles: [
    {
      // map.php 顶层包含 regions 与 grids 两个子键；O-4 adapter 按 pgroup 拆分为多个 region 节点
      path: 'oblivions/gamedata/map.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  serializer: 'php-region',
  fields: [
    {
      key: 'name',
      label: '区域名',
      type: 'text',
      required: true,
      placeholder: '如：垃圾平原',
      group: '基本',
    },
    {
      key: 'desc',
      label: '区域描述',
      type: 'text',
      required: false,
      placeholder: '区域风味描述',
      group: '基本',
    },
    {
      key: 'entrance_pls',
      label: '入口 pls',
      type: 'number',
      required: false,
      min: 1,
      max: 254,
      step: 1,
      default: null,
      description: '进入该区域时玩家所在的 tile pls（null 表示无入口）',
      group: '入口出口',
    },
    {
      key: 'exit_pls',
      label: '出口 pls',
      type: 'number',
      required: false,
      min: 1,
      max: 254,
      step: 1,
      default: null,
      description: '从该区域离开时玩家所在的 tile pls（null 表示无出口）',
      group: '入口出口',
    },
    {
      key: 'next_region',
      label: '下一区域',
      type: 'ref',
      required: false,
      refKind: 'world.region',
      refField: 'id',
      default: null,
      description: 'next/prev 双向链——编辑器自动派生 prev_region 对称',
      group: '区域链接',
    },
    {
      key: 'prev_region',
      label: '上一区域',
      type: 'ref',
      required: false,
      refKind: 'world.region',
      refField: 'id',
      default: null,
      description: '自动派生自 next_region 双向同步，编辑器只读',
      group: '区域链接',
    },
    {
      key: 'exit_links',
      label: '跨区域出口',
      type: 'entry-list',
      required: false,
      default: [],
      itemSchema: [
        {
          key: 'from_pls',
          label: '出发 pls',
          type: 'number',
          required: false,
          min: 1,
          max: 254,
          default: null,
        },
        {
          key: 'to_pgroup',
          label: '目标区域',
          type: 'ref',
          required: true,
          refKind: 'world.region',
          refField: 'id',
        },
        {
          key: 'to_pls',
          label: '目标 pls',
          type: 'number',
          required: false,
          min: 1,
          max: 254,
          default: null,
        },
      ],
      group: '区域链接',
    },
    {
      key: 'cols',
      label: '列数',
      type: 'number',
      required: true,
      min: 1,
      max: 254,
      step: 1,
      description: '与 grids[pgroup].cols 同步',
      group: '基本',
    },
    {
      key: 'rows',
      label: '行数',
      type: 'number',
      required: true,
      min: 1,
      max: 254,
      step: 1,
      description: '与 grids[pgroup].rows 同步',
      group: '基本',
    },
  ],
  refFields: [
    { field: 'next_region', refKind: 'world.region', refField: 'id', required: false, refType: 'direct' },
    { field: 'prev_region', refKind: 'world.region', refField: 'id', required: false, refType: 'direct' },
    { field: 'exit_links[].to_pgroup', refKind: 'world.region', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // map.php 的 name/desc 未迁移至 locale，仍为运行时数据
  listColumns: [
    { field: 'name', labelKey: 'schema.world.region.list.name', sortable: true, filterable: true, defaultVisible: true, width: 160 },
    { field: 'cols', labelKey: 'schema.world.region.list.cols', sortable: true, defaultVisible: true, width: 80 },
    { field: 'rows', labelKey: 'schema.world.region.list.rows', sortable: true, defaultVisible: true, width: 80 },
    { field: 'entrance_pls', labelKey: 'schema.world.region.list.entrance_pls', sortable: true, defaultVisible: true, width: 100 },
    { field: 'exit_pls', labelKey: 'schema.world.region.list.exit_pls', sortable: true, defaultVisible: true, width: 100 },
    { field: 'next_region', labelKey: 'schema.world.region.list.next_region', sortable: true, defaultVisible: true, width: 100 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.world.region.group.basic',
      fields: ['name', 'desc', 'cols', 'rows'],
      defaultCollapsed: false,
    },
    {
      id: 'entry-exit',
      labelKey: 'schema.world.region.group.entry_exit',
      fields: ['entrance_pls', 'exit_pls'],
      defaultCollapsed: false,
    },
    {
      id: 'links',
      labelKey: 'schema.world.region.group.links',
      fields: ['next_region', 'prev_region', 'exit_links'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 复用 O-10 第 2 层结构校验现有 rule ID
    {
      ruleId: 'region_entrance_dangling',
      layer: 2,
      severity: 'warning',
      validatorFn: 'region.entrance_pls_in_region',
    },
    {
      ruleId: 'region_exit_dangling',
      layer: 2,
      severity: 'warning',
      validatorFn: 'region.exit_pls_in_region',
    },
    {
      ruleId: 'region_next_prev_asymmetric',
      layer: 2,
      severity: 'error',
      validatorFn: 'region.next_prev_asymmetric',
    },
    {
      ruleId: 'region_no_entrance',
      layer: 2,
      severity: 'warning',
      validatorFn: 'region.no_entrance',
    },
    {
      ruleId: 'region_no_exit',
      layer: 2,
      severity: 'warning',
      validatorFn: 'region.no_exit',
    },
  ],
  copyStrategy: 'deep-clone',
  // p0Loaded=false：跳过通用 schema-driven 路径
  // world.region 由 loader.ts 的 loadWorldResources() 专用装配——
  // 调用 parseMapPhp + assembleMapProject + assembleWorldResources 重建节点
  // （P1 执行案 §4.1.1）。原因：map.php 顶层是 regions/grids 两个分桶 key，
  // 通用 map-keyed 路径会生成 id='regions'/'grids' 的字典形态节点，与
  // projectStore 期望的标准形态（id=pgroup）不匹配。
  p0Loaded: false,

  // —— P5 O-11 单源编译元数据 ——
  // world.region 有 authorFormat 声明 YAML 位置，但无 projectionTargets——
  // P5 阶段由 P1 projectStore 管理世界资源，不进入编译产物。
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/worlds/regions.yaml',
    rootKey: 'regions',
    itemKey: 'pgroup',
  },
};
