/**
 * @module O 内容工具箱
 *
 * distribution.scatter kind 完整 schema。来源：oblivions/gamedata/scatter_pool.php。
 *
 * 废弃原 3 节点 tide-bucket stub 模型，重写为 42 节点 entry-per-rule 模型
 * （审查补丁 A1）。每个野生道具在某个 tide × phase 下的分布规则作为一个独立
 * distribution.scatter 节点。当前数据：3 tide × 2 phase = 6 列表 / 42 条目
 * （initial 24 + refresh 18，每 tide 各 8 initial + 6 refresh）。
 *
 * 与 scatter_pool.php 原始结构的映射（编译投影回写）：
 *   - 原始：`{ shallow: { initial: [...], refresh: [...] }, deep: {...}, abyss: {...} }`
 *   - 统一模型：每个 `{item_id, count, rate}` 在 tide × phase 矩阵下投影为一个节点
 *
 * 字段映射（scatter_pool.{tide}.{phase}[i] → distribution.scatter 节点）：
 *   - id                  = `${tide}:${phase}:${item_id}`（如 `shallow:initial:scrap_metal`）
 *   - subject.item_id     = item_id（引用 item.template.id）
 *   - selector.tides      = [tide]（从桶 key 派生）
 *   - selector.regions    = []（留空=所有区域）
 *   - selector.excludeEntrance = false（scatter 无入口/出口排除，运行时不查）
 *   - selector.excludeExit     = false
 *   - phase               = `game_init`（initial）或 `day_refresh`（refresh）
 *   - placement.mode      = `per_tile_probability`
 *   - placement.rate      = rate（基础率，0-1）
 *   - placement.count     = count（int 或 [min,max]）
 *
 * 当前运行时契约（执行案 §4.2.2）：
 *   - selector.tides 每条规则只有一个值（多 tide 投影回 scatter_pool.php 时构建失败）
 *   - selector.regions 留空=所有区域
 *   - placement.mode 固定为 `per_tile_probability`
 *
 * refresh 相位 effective_rate（派生字段，不可编辑）：
 *   - effective_rate = rate × obl_config.wild_item_refresh_rate_by_tide[tide]
 *   - 运行时 clamp 到 [0,1]——工具箱显示 effective_rate 但不预 clamp
 *   - O-10 校验 distribution.scatter.refresh_rate_overflow 提示超 1.0 的情况
 *
 * 反向派生字段（不可编辑，由图查询）：
 *   - selects_tiles：按 selector.tides 匹配 world.tile（无 entrance/exit/occupied 排除）
 *
 * id 格式 `${tide}:${phase}:${item_id}` 不可手编——idPattern 校验 + UI 自动生成。
 *
 * 现有 oblivions/editor-next/src/shared/constants/scatter-schema.ts 保留作为
 * configStore 过渡期读写契约，P5 单源编译时退役。
 */

import type { KindSchema } from '../types';

/**
 * tide 三档枚举（与 distribution-poi / distribution-enemy / world.tile.tide 同步）。
 */
export const DISTRIBUTION_SCATTER_TIDE_OPTIONS = [
  { value: 'shallow', label: '浅滩' },
  { value: 'deep', label: '深水' },
  { value: 'abyss', label: '深海' },
] as const;

/**
 * scatter 相位枚举（与运行时 phase 字段对齐）。
 *
 * - game_init：开局放置（obl_generate_wild_items），rate 较高、池较丰富
 * - day_refresh：时间流逝刷新（obl_refresh_wild_items），rate 较低、池较稀疏，
 *   实际生效倍率 = rate × obl_config.wild_item_refresh_rate_by_tide[tide]
 */
export const DISTRIBUTION_SCATTER_PHASE_OPTIONS = [
  { value: 'game_init', label: '初始' },
  { value: 'day_refresh', label: '刷新' },
] as const;

export const distributionScatterSchema: KindSchema = {
  kind: 'distribution.scatter',
  // id 格式：${tide}:${phase}:${item_id}，如 shallow:game_init:scrap_metal
  // phase 用运行时枚举值（game_init / day_refresh），与原始 initial/refresh 一一对应
  // 不可手编——UI 由 RuleTablePanel 自动拼接 tide + phase + item_id
  idPattern: /^(shallow|deep|abyss):(game_init|day_refresh):[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/scatter_pool.php',
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
      placeholder: '自动生成：${tide}:${phase}:${item_id}',
      description:
        '${tide}:${phase}:${item_id} 格式（如 shallow:game_init:scrap_metal）——不可手编。' +
        '新建规则时由 RuleTablePanel 选择 item_id + tide + phase 后自动拼接。' +
        '编辑器禁止修改 id 字段（重命名等价于删除+新建）。',
      group: 'definition',
    },
    {
      key: 'subject.item_id',
      label: '道具模板',
      type: 'select',
      required: true,
      default: '',
      options: [], // UI 渲染时由 RuleTablePanel 从 item.template 列表动态注入
      placeholder: '选择道具模板',
      refKind: 'item.template',
      refField: 'id',
      description:
        '引用 item.template.id——UI 渲染时从 item.template 节点列表动态填充 options。' +
        '选择后自动联动生成 id（${tide}:${phase}:${item_id}）。',
      group: 'definition',
    },
    {
      key: 'selector.tides',
      label: '潮汐区',
      type: 'string-list',
      required: true,
      default: [],
      itemType: 'select',
      itemOptions: DISTRIBUTION_SCATTER_TIDE_OPTIONS,
      description:
        '分布生效的潮汐区列表——枚举 shallow/deep/abyss。' +
        '当前运行时契约每条规则只有一个 tide（编译投影回 scatter_pool.php 时多 tide 构建失败）。' +
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
        '当前运行时不支持 per-region 过滤，留作未来扩展。P4 阶段保持空数组。',
      group: 'definition',
    },
    {
      key: 'phase',
      label: '相位',
      type: 'select',
      options: DISTRIBUTION_SCATTER_PHASE_OPTIONS,
      required: true,
      default: 'game_init',
      description:
        '分布相位——game_init 开局放置（initial）/ day_refresh 时间流逝刷新（refresh）。' +
        'refresh 相位的实际生效倍率 = rate × obl_config.wild_item_refresh_rate_by_tide[tide]。',
      group: 'definition',
    },
    {
      key: 'placement.rate',
      label: '基础生成率',
      type: 'number',
      required: true,
      default: 0.1,
      min: 0,
      max: 1,
      step: 0.01,
      description:
        '0-1 基础率——每格独立判定是否生成。' +
        'initial 相位运行时按 mt_rand/mt_getrandmax 判定；' +
        'refresh 相位实际生效倍率 = rate × obl_config.wild_item_refresh_rate_by_tide[tide]，' +
        '运行时 clamp 到 [0,1]，工具箱显示 effective_rate 但不预 clamp。',
      group: 'definition',
    },
    {
      key: 'placement.count',
      label: '生成数量',
      type: 'count-range',
      required: true,
      default: 1,
      description:
        'int 或 [min,max] 区间——生成成功时该格产出的道具数量。' +
        'placement.mode 固定为 per_tile_probability（不在 schema 中暴露，由编译投影器隐式应用）。',
      group: 'definition',
    },
  ],
  refFields: [
    // distribution.scatter → item.template 的分布关系（distributed_by 反向边）
    { field: 'subject.item_id', refKind: 'item.template', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // distribution.scatter 无呈现字段
  listColumns: [
    { field: 'id', labelKey: 'schema.distribution.scatter.list.id', sortable: true, filterable: true, defaultVisible: true, width: 280 },
    { field: 'subject.item_id', labelKey: 'schema.distribution.scatter.list.subject_item_id', sortable: true, filterable: true, defaultVisible: true, width: 160 },
    { field: 'selector.tides', labelKey: 'schema.distribution.scatter.list.tides', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'phase', labelKey: 'schema.distribution.scatter.list.phase', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'placement.rate', labelKey: 'schema.distribution.scatter.list.rate', sortable: true, defaultVisible: true, width: 90 },
    { field: 'placement.count', labelKey: 'schema.distribution.scatter.list.count', sortable: true, defaultVisible: true, width: 100 },
  ],
  detailGroups: [
    {
      id: 'definition',
      labelKey: 'schema.distribution.scatter.group.definition',
      fields: [
        'id',
        'subject.item_id',
        'selector.tides',
        'selector.regions',
        'phase',
        'placement.rate',
        'placement.count',
      ],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'distribution_scatter_id_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'distribution.scatter.id_invalid',
    },
    {
      ruleId: 'distribution_scatter_tides_multi',
      layer: 2,
      severity: 'error',
      validatorFn: 'distribution.scatter.tides_multi',
    },
    // 第 3 层引用校验
    {
      ruleId: 'distribution_scatter_item_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'distribution.scatter.item_ref_dangling',
    },
    // 第 5 层分布校验（warning 级别——运行时按既有"可用 tile 不足时自动调整"逻辑兜底）
    {
      ruleId: 'distribution.scatter.candidate_tile_insufficient',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.scatter.candidate_tile_insufficient',
    },
    {
      ruleId: 'distribution.scatter.refresh_rate_overflow',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.scatter.refresh_rate_overflow',
    },
    {
      ruleId: 'distribution.scatter.capacity_conflict',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.scatter.capacity_conflict',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/distributions/scatter-pool.yaml',
    rootKey: 'scatter_pool',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/scatter_pool.php',
      projector: './projectors/scatter-pool-projector',
      module: 'E 游戏逻辑',
      sectionTitle: 'Oblivions 野生道具分布池',
    },
  ],
};
