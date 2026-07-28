/**
 * @module O 内容工具箱
 *
 * distribution.enemy kind 完整 schema。来源：oblivions/gamedata/enemy_pool.php。
 *
 * 按 DistributionRule 统一模型重组字段——每个敌人在某个 tide 桶下的分布规则作为
 * 一个独立 distribution.enemy 节点。当前数据：3 桶 / 2 启用条目（shallow 1 + deep 1
 * + abyss 0 空桶）。
 *
 * 与 enemy_pool.php 原始结构的映射（编译投影回写）：
 *   - 原始：`{ shallow: [{enemy_type, count}, ...], deep: [...], abyss: [...] }`
 *   - 统一模型：每个 `{enemy_type, count}` 在 tide 桶下投影为一个 distribution.enemy 节点
 *
 * 字段映射（enemy_pool.{tide}[i] → distribution.enemy 节点）：
 *   - id                  = `${tide}:${enemy_type}`（如 `shallow:1`）
 *   - subject.enemy_type  = enemy_type（number，引用 enemy.template.id）
 *   - selector.tides      = [tide]（从桶 key 派生）
 *   - selector.regions    = []（留空=所有区域）
 *   - selector.excludeEntrance = true（对齐 J-1 / init.func.php:241-245 运行时默认）
 *   - selector.excludeExit     = true
 *   - selector.excludeOccupied = true（敌人放置不可重叠，对齐 obl_get_occupied_positions）
 *   - placement.mode      = `per_region_count`
 *   - placement.count     = count（int 或 [min,max]）
 *
 * 当前运行时契约（执行案 §4.2.1）：
 *   - phase = `game_init`（敌人仅开局放置，无 day_refresh）
 *   - selector.tides 每条规则只有一个值（多 tide 投影回 enemy_pool.php 时构建失败）
 *   - selector.regions 留空=所有区域（运行时不支持 per-region 过滤）
 *   - placement.mode 固定为 `per_region_count`
 *
 * 反向派生字段（不可编辑，由图查询）：
 *   - selects_tiles：按 selector.tides + excludeEntrance + excludeExit + excludeOccupied
 *     匹配 world.tile，运行时动态计算不持久化
 *
 * id 格式 `${tide}:${enemy_type}` 不可手编——idPattern 校验 + UI 自动生成（选择
 * enemy_type + tide 后拼接）。abyss 桶全注释条目不解析为节点（保留为设计上的"无
 * abyss 敌人"状态）。
 *
 * 注释漂移修复（执行案 §4.7.3）：O-5 投影器在序列化 enemy_pool.php 时从代码权威
 * 派生注释（`// ${enemy_name} ${count_desc}`），覆盖手写注释。
 */

import type { KindSchema } from '../types';

/**
 * tide 三档枚举（与 distribution-poi / world.tile.tide 同步）。
 *
 * 对齐 J-2 潮汐区主键——distribution.enemy.selector.tides 必须是这三个值之一。
 */
export const DISTRIBUTION_ENEMY_TIDE_OPTIONS = [
  { value: 'shallow', label: '浅滩' },
  { value: 'deep', label: '深水' },
  { value: 'abyss', label: '深海' },
] as const;

export const distributionEnemySchema: KindSchema = {
  kind: 'distribution.enemy',
  // id 格式：${tide}:${enemy_type}，如 shallow:1
  // 不可手编——UI 由 RuleTablePanel 自动拼接 tide + enemy_type
  idPattern: /^(shallow|deep|abyss):[1-9]\d*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/enemy_pool.php',
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
      placeholder: '自动生成：${tide}:${enemy_type}',
      description:
        '${tide}:${enemy_type} 格式（如 shallow:1）——不可手编。' +
        '新建规则时由 RuleTablePanel 选择 enemy_type + tide 后自动拼接。' +
        '编辑器禁止修改 id 字段（重命名等价于删除+新建）。',
      group: 'definition',
    },
    {
      key: 'subject.enemy_type',
      label: '敌人模板',
      type: 'select',
      required: true,
      default: '',
      options: [], // UI 渲染时由 RuleTablePanel 从 enemy.template 列表动态注入
      placeholder: '选择敌人模板',
      refKind: 'enemy.template',
      refField: 'id',
      description:
        '引用 enemy.template.id（数字字符串）——UI 渲染时从 enemy.template 节点列表动态填充 options。' +
        '选择后自动联动生成 id（${tide}:${enemy_type}）。',
      group: 'definition',
    },
    {
      key: 'selector.tides',
      label: '潮汐区',
      type: 'string-list',
      required: true,
      default: [],
      itemType: 'select',
      itemOptions: DISTRIBUTION_ENEMY_TIDE_OPTIONS,
      description:
        '分布生效的潮汐区列表——枚举 shallow/deep/abyss。' +
        '当前运行时契约每条规则只有一个 tide（编译投影回 enemy_pool.php 时多 tide 构建失败）。' +
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
        '留作未来扩展。P4 阶段保持空数组。',
      group: 'definition',
    },
    {
      key: 'selector.excludeEntrance',
      label: '排除入口格',
      type: 'boolean',
      required: false,
      default: true,
      description:
        'true=排除区域入口格（对齐 J-1 / init.func.php:241-245 运行时默认）。' +
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
        'true=排除区域出口格（对齐 J-1 / init.func.php:241-245 运行时默认）。' +
        '候选格计算时按 tile.isExit 过滤。',
      group: 'definition',
    },
    {
      key: 'selector.excludeOccupied',
      label: '排除已占用格',
      type: 'boolean',
      required: false,
      default: true,
      description:
        'true=排除已占用格（敌人放置不可重叠，对齐 obl_get_occupied_positions）。' +
        'P4 阶段是静态派生——假设所有 candidate tile 未被占用；' +
        '运行时实际占用由数据库查询决定，P6 镜像校验时引入动态占用。',
      group: 'definition',
    },
    {
      key: 'placement.count',
      label: '每区域数量',
      type: 'count-range',
      required: true,
      default: 1,
      description:
        'per_region 数量——int 或 [min,max] 区间。' +
        'placement.mode 固定为 per_region_count（不在 schema 中暴露，由编译投影器隐式应用）。' +
        '运行时按 rand($lo, $hi) 取值；候选格不足时由 obl_init_enemies 自动调整。',
      group: 'definition',
    },
  ],
  refFields: [
    // distribution.enemy → enemy.template 的分布关系（spawned_by 反向边）
    { field: 'subject.enemy_type', refKind: 'enemy.template', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [], // distribution.enemy 无呈现字段
  listColumns: [
    { field: 'id', labelKey: 'schema.distribution.enemy.list.id', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'subject.enemy_type', labelKey: 'schema.distribution.enemy.list.subject_enemy_type', sortable: true, filterable: true, defaultVisible: true, width: 140 },
    { field: 'selector.tides', labelKey: 'schema.distribution.enemy.list.tides', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'placement.count', labelKey: 'schema.distribution.enemy.list.count', sortable: true, defaultVisible: true, width: 100 },
  ],
  detailGroups: [
    {
      id: 'definition',
      labelKey: 'schema.distribution.enemy.group.definition',
      fields: [
        'id',
        'subject.enemy_type',
        'selector.tides',
        'selector.regions',
        'selector.excludeEntrance',
        'selector.excludeExit',
        'selector.excludeOccupied',
        'placement.count',
      ],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'distribution_enemy_id_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'distribution.enemy.id_invalid',
    },
    {
      ruleId: 'distribution_enemy_tides_multi',
      layer: 2,
      severity: 'error',
      validatorFn: 'distribution.enemy.tides_multi',
    },
    // 第 3 层引用校验
    {
      ruleId: 'distribution_enemy_enemy_type_ref_dangling',
      layer: 3,
      severity: 'error',
      validatorFn: 'distribution.enemy.enemy_type_ref_dangling',
    },
    // 第 5 层分布校验（warning 级别——运行时按 init.func.php 既有"可用 tile 不足时自动调整"逻辑兜底）
    {
      ruleId: 'distribution.enemy.candidate_tile_insufficient',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.enemy.candidate_tile_insufficient',
    },
    {
      ruleId: 'distribution.enemy.per_region_capacity_conflict',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.enemy.per_region_capacity_conflict',
    },
    {
      ruleId: 'distribution.enemy.comment_data_drift',
      layer: 5,
      severity: 'warning',
      validatorFn: 'distribution.enemy.comment_data_drift',
    },
  ],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/distributions/enemy-pool.yaml',
    rootKey: 'enemy_pool',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/enemy_pool.php',
      projector: './projectors/enemy-pool-projector',
      module: 'E 游戏逻辑',
      sectionTitle: 'Oblivions 敌人分布池',
    },
  ],
};
