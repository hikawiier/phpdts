/**
 * @module O 内容工具箱
 *
 * config.runtime kind 完整 schema。来源：oblivions/gamedata/obl_config.php。
 *
 * 单文件单资源（load: 'single'），ID 固定为字符串 'obl_config'。
 * 节点 data.entries 是 kv-list，key 是 obl_config 顶层项名，value 是
 * number / string / boolean / 嵌套数组（如 wild_item_refresh_rate_by_tide）。
 *
 * P1 阶段采用动态字段策略——不为 23 个 obl_config 项逐个声明 schema，
 * 仅在 KNOWN_OBL_CONFIG_KEYS 中维护"已知顶层 key 清单"，
 * config.runtime.unknown_field 校验规则通过此清单识别未授权的新增字段。
 *
 * 节点是只读的——P1 不允许通过 graph-store 编辑器修改其字段。
 * serializePhpResource 仅在用户显式触发"重建 obl_config.php"时调用（用于 round-trip 验证）。
 */

import type { KindSchema } from '../types';

/**
 * 已知 obl_config 顶层 key 清单（共 23 项）。
 * 从 oblivions/gamedata/obl_config.php 实际读取后硬编码——
 * 新增字段时同步更新此清单与 obl_config.php，否则触发 config.runtime.unknown_field warning。
 */
export const KNOWN_OBL_CONFIG_KEYS = [
  // ─── 探索 / Explore ───
  'explore_sp_cost',
  'vision_range',
  'memory_range',
  'discover_base',
  'discover_per_level',
  // ─── 移动 / Move ───
  'move_sp_cost',
  // ─── 移动方式注册表 / Move Types ───
  'move_types',
  // ─── 统一信息获取 / Information Acquisition ───
  'info_acquisition',
  // ─── 自动导航 / Navigation ───
  'navigation_max_steps_default',
  'navigation_max_steps_limit',
  // ─── 移动倾向差异化参数 / Move Tendency Parameters ───
  'tendencies',
  // ─── 日志 / Log ───
  'log_max_entries',
  'log_max_debug_entries',
  // ─── 战斗 / Battle ───
  'battlelog_schema',
  // ─── 战斗引擎 / Combat Engine ───
  'combat_engine',
  // ─── 道具系统 / Item ───
  'use_item_advances_tick',
  'craft_advances_tick',
  // ─── 野生道具刷新 / Wild Item Refresh ───
  'wild_item_refresh_mode',
  'wild_item_refresh_interval_ticks',
  'wild_item_capacity_per_tile',
  'wild_item_refresh_rate_by_tide',
  // ─── 天与昼夜 / Day & Day-Night Cycle ───
  'day_length_ticks',
  'day_phase_ticks',
] as const;

export const configRuntimeSchema: KindSchema = {
  kind: 'config.runtime',
  idPattern: /^obl_config$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/obl_config.php',
      format: 'php',
      parser: 'php-array',
      load: 'single',
      // 节点 ID 固定为 'obl_config'——configStore.oblConfig computed 按 ID 查找
      singleNodeId: 'obl_config',
    },
  ],
  parser: 'php-array',
  serializer: 'php-config',
  fields: [
    {
      key: 'entries',
      label: '配置项',
      type: 'kv-list',
      required: true,
      valueType: 'text',
      keyPlaceholder: '配置项名（如 day_length_ticks）',
      valuePlaceholder: '值（number / string / boolean / 嵌套数组）',
      description:
        'key 是 obl_config 顶层项名，value 是 number / string / boolean / 嵌套数组。' +
        '未知 key 会触发 config.runtime.unknown_field warning。',
      group: '配置项',
    },
  ],
  refFields: [], // 配置参数无跨资源引用
  presentationFields: [], // 配置参数无呈现字段
  listColumns: [], // 单一节点，列表列不适用
  detailGroups: [
    {
      id: 'numeric',
      labelKey: 'schema.config.runtime.group.numeric',
      fields: ['entries'],
      defaultCollapsed: false,
    },
    {
      id: 'string',
      labelKey: 'schema.config.runtime.group.string',
      fields: [],
      defaultCollapsed: false,
    },
    {
      id: 'boolean',
      labelKey: 'schema.config.runtime.group.boolean',
      fields: [],
      defaultCollapsed: false,
    },
    {
      id: 'array',
      labelKey: 'schema.config.runtime.group.array',
      fields: [],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 出现未在 KNOWN_OBL_CONFIG_KEYS 中的字段时 emit warning
    {
      ruleId: 'config_runtime_unknown_field',
      layer: 2,
      severity: 'warning',
      validatorFn: 'config.runtime.unknown_field',
    },
  ],
  copyStrategy: 'none', // 只读资源不允许复制
  readOnly: true, // P1 不允许通过 graph-store 编辑器修改其字段
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  // config.runtime 节点 data.entries 是 kv-list，authorFormat.itemKey='key' 表示
  // YAML 中每个 entry 的 key 字段名（kv-list 形态，非标准 map-keyed）。
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/runtime-config/obl-config.yaml',
    rootKey: 'obl_config',
    itemKey: 'key',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/obl_config.php',
      projector: './projectors/obl-config-projector',
      module: 'C 核心运行时',
      sectionTitle: 'Oblivions 运行时配置',
    },
  ],
};
