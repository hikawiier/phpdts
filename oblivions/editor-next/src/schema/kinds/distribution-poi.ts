/**
 * @module O 内容工具箱
 *
 * distribution.poi kind 完整 schema。来源：oblivions/gamedata/poi_pool.php。
 *
 * 按 DistributionRule 统一模型重组字段——每个 POI 在某个 tide 桶下的分布规则作为一个独立
 * distribution.poi 节点。当前数据：3 桶 / 23 条目（shallow 9 + deep 11 + abyss 3）。
 *
 * 与 poi_pool.php 原始结构的映射（编译投影回写）：
 *   - 原始：`{ shallow: [{poi_id, per_region}, ...], deep: [...], abyss: [...] }`
 *   - 统一模型：每个 `{poi_id, per_region}` 在 tide 桶下投影为一个 distribution.poi 节点
 *
 * 字段映射（poi_pool.{tide}[i] → distribution.poi 节点）：
 *   - id            = `${tide}:${poi_id}`（如 `shallow:supply_cache`）
 *   - subject.poi_id = poi_id
 *   - selector.tides = [tide]（从桶 key 派生）
 *   - placement.mode = `per_region_count`
 *   - placement.count = per_region
 *   - selector.excludeEntrance / excludeExit 默认 true（对齐 J-1 / E-9 运行时行为）
 *
 * 当前运行时契约（执行案 §4.2.2）：
 *   - phase = `game_init`（POI 仅开局放置，无 day_refresh）
 *   - selector.tides 每条规则只有一个值（多 tide 投影回 poi_pool.php 时构建失败）
 *   - selector.regions 留空=所有区域（运行时不支持 per-region 过滤，留作未来扩展）
 *   - placement.mode 固定为 `per_region_count`
 *
 * 反向派生字段（不可编辑，由图查询）：
 *   - selects_tiles：按 selector.tides 匹配 world.tile 的 tide 属性，运行时动态计算不持久化
 *
 * id 格式 `${tide}:${poi_id}` 不可手编——idPattern 校验 + UI 自动生成（选择 poi_id + tide 后
 * 拼接）。新建规则时由 RuleTablePanel 计算 id，编辑器禁止修改 id 字段。
 */

import type { KindSchema } from '../types';

/**
 * tide 三档枚举（与 vex-vue TIDE_SCHEMA_OPTIONS / world.tile.tide 同步）。
 *
 * 对齐 J-2 潮汐区主键——distribution.poi.selector.tides 必须是这三个值之一。
 */
export const DISTRIBUTION_POI_TIDE_OPTIONS = [
  { value: 'shallow', label: '浅滩' },
  { value: 'deep', label: '深水' },
  { value: 'abyss', label: '深海' },
] as const;

export const distributionPoiSchema: KindSchema = {
  kind: 'distribution.poi',
  // id 格式：${tide}:${poi_id}，如 shallow:supply_cache
  // 不可手编——UI 由 RuleTablePanel 自动拼接 tide + poi_id
  idPattern: /^(shallow|deep|abyss):[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/poi_pool.php',
      format: 'php',
      parser: 'php-array',
      load: 'partitioned',
    },
  ],
  parser: 'php-array',
  fields: [
    // ─── definition（规则定义）────────────────────────
    {
      key: 'id',
      label: '规则 ID',
      type: 'text',
      required: true,
      default: '',
      placeholder: '自动生成：${tide}:${poi_id}',
      description:
        '${tide}:${poi_id} 格式（如 shallow:supply_cache）——不可手编。' +
        '新建规则时由 RuleTablePanel 选择 poi_id + tide 后自动拼接。' +
        '编辑器禁止修改 id 字段（重命名等价于删除+新建）。',
      group: 'definition',
    },
    {
      key: 'subject.poi_id',
      label: 'POI 模板',
      type: 'select',
      required: true,
      default: '',
      options: [], // UI 渲染时由 RuleTablePanel 从 poi.template 列表动态注入
      placeholder: '选择 POI 模板',
      refKind: 'poi.template',
      refField: 'id',
      description:
        '引用 poi.template.id——UI 渲染时从 poi.template 节点列表动态填充 options。' +
        '选择后自动联动生成 id（${tide}:${poi_id}）。',
      group: 'definition',
    },
    {
      key: 'selector.tides',
      label: '潮汐区',
      type: 'string-list',
      required: true,
      default: [],
      itemType: 'select',
      itemOptions: DISTRIBUTION_POI_TIDE_OPTIONS,
      description:
        '分布生效的潮汐区列表——枚举 shallow/deep/abyss。' +
        '当前运行时契约每条规则只有一个 tide（编译投影回 poi_pool.php 时多 tide 构建失败）。' +
        'UI 通过单选下拉模拟单值约束。',
      group: 'definition',
    },
    {
      key: 'selector.regions',
      label: '区域限制',
      type: 'string-list',
      required: false,
      default: [],
      placeholder: '留空=所有区域',
      description:
        '分布生效的区域 ID 列表——留空=所有区域。' +
        '当前运行时不支持 per-region 过滤（per_region 在 tide 桶内全 region 统一），' +
        '留作未来扩展。P3 阶段保持空数组。',
      group: 'definition',
    },
    {
      key: 'selector.excludeEntrance',
      label: '排除入口格',
      type: 'boolean',
      required: false,
      default: true,
      description:
        'true=排除区域入口格（对齐 J-1 / E-9 运行时默认）。' +
        '候选格计算时按 tile.isEntrance 过滤。',
      group: 'definition',
    },
    {
      key: 'selector.excludeExit',
      label: '排除出口格',
      type: 'boolean',
      required: false,
      default: true,
      description:
        'true=排除区域出口格（对齐 J-1 / E-9 运行时默认）。' +
        '候选格计算时按 tile.isExit 过滤。',
      group: 'definition',
    },
    {
      key: 'placement.count',
      label: '每区域数量',
      type: 'number',
      required: true,
      default: 1,
      min: 0,
      step: 1,
      description:
        'per_region 数量——每个区域生成 N 个该 POI 实例。' +
        'placement.mode 固定为 per_region_count（不在 schema 中暴露，由编译投影器隐式应用）。' +
        '候选格不足时由 E-9 obl_init_pois 自动调整（跳过无法放置的条目）。',
      group: 'definition',
    },
  ],
  refFields: [
    // distribution.poi → poi.template 的分布关系（distributed_by 反向边）
    { field: 'subject.poi_id', refKind: 'poi.template', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // distribution.poi 无呈现字段
  listColumns: [
    { field: 'id', labelKey: 'schema.distribution.poi.list.id', sortable: true, filterable: true, defaultVisible: true, width: 200 },
    { field: 'subject.poi_id', labelKey: 'schema.distribution.poi.list.subject_poi_id', sortable: true, filterable: true, defaultVisible: true, width: 160 },
    { field: 'selector.tides', labelKey: 'schema.distribution.poi.list.tides', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'placement.count', labelKey: 'schema.distribution.poi.list.count', sortable: true, defaultVisible: true, width: 90 },
  ],
  detailGroups: [
    {
      id: 'definition',
      labelKey: 'schema.distribution.poi.group.definition',
      fields: ['id', 'subject.poi_id', 'selector.tides', 'selector.regions', 'selector.excludeEntrance', 'selector.excludeExit', 'placement.count'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'distribution_poi_id_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'distribution.poi.id_invalid',
    },
    {
      ruleId: 'distribution_poi_tides_multi',
      layer: 2,
      severity: 'error',
      validatorFn: 'distribution.poi.tides_multi',
    },
    // 第 3 层引用校验
    {
      ruleId: 'distribution_poi_poi_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'distribution.poi.poi_ref_dangling',
    },
    // 第 5 层分布校验（warning 级别——运行时按 E-9 既有"可用 tile 不足时自动调整"逻辑兜底）
    {
      ruleId: 'distribution.poi.candidate_tile_insufficient',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.poi.candidate_tile_insufficient',
    },
    {
      ruleId: 'distribution.poi.per_region_capacity_conflict',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.poi.per_region_capacity_conflict',
    },
    {
      ruleId: 'distribution.poi.no_generatable_region',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.poi.no_generatable_region',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/distributions/poi-pool.yaml',
    rootKey: 'poi_pool',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/poi_pool.php',
      projector: './projectors/poi-pool-projector',
      module: 'E 游戏逻辑',
      sectionTitle: 'Oblivions POI 分布池',
    },
  ],
};
