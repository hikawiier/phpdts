// @module O 内容工具箱
//
// 验证工具类型定义，对齐 validate.js RULE 常量集与 Issue 结构
// 严重级别仅 error / warning 两档（对齐 2.15：无 info 级，避免非阻断提示噪声）
//
// P6 扩展（执行案 §4.5.1）：
//   - ValidateIssue 新增 blocking?: boolean 字段（默认 false）
//   - 镜像不一致的 issue 标记 blocking=true + severity='error'，阻断构建发布
//   - ValidateSummary 新增 blockingCount 字段，统计 blocking=true 的 issue 数量
//   - 不新增 critical severity——保持 error / warning 二档设计不变
//
// 研判：
//   - 验证工具的类型契约层
//   - ValidateOptions.config 字段引用 O-2 类型（ScatterPool / PoiTable / PoiPool）
//   - M8 生成器调用 runFullValidation(project, { includeConfig: false }) 形成闭环

import type { Pgroup, Pls } from './map';
import type { ScatterPool, PoiTable, PoiPool } from './config';

/**
 * 验证严重级别
 */
export type ValidateSeverity = 'error' | 'warning';

/**
 * 验证规则 ID（与 i18n key 对齐，对齐 validate.js 中 RULE 常量集）
 *
 * O-10 新增的规则 ID（P3 distribution.poi.* / P4 distribution.scatter.* /
 * distribution.enemy.* / enemy.* / presentation.enemy.*）使用点分命名空间，
 * 在 VALIDATE_RULES 常量集中注册以便覆盖率统计与 i18n key 对齐。
 */
export type ValidateRule =
  | 'pls_range'
  | 'pgroup_range'
  | 'tide_invalid'
  | 'floor_invalid'
  | 'occupy_conflict'
  | 'region_next_dangling'
  | 'region_prev_dangling'
  | 'region_next_prev_asymmetric'
  | 'region_entrance_dangling'
  | 'region_exit_dangling'
  | 'region_no_entrance'
  | 'region_no_exit'
  | 'neighbor_dangling'
  | 'neighbor_asymmetric'
  | 'exit_link_to_pgroup_dangling'
  | 'exit_link_to_pls_dangling'
  | 'connectivity_island'
  | 'poi_pool_ref'
  | 'poi_loot_table_ref'
  | 'scatter_item_ref'
  // P4 新增分布校验规则（distribution-validator.ts 内联常量的注册表镜像）
  | 'distribution.scatter.candidate_tile_insufficient'
  | 'distribution.scatter.refresh_rate_overflow'
  | 'distribution.scatter.capacity_conflict'
  | 'distribution.enemy.candidate_tile_insufficient'
  | 'distribution.enemy.per_region_capacity_conflict'
  | 'distribution.enemy.comment_data_drift'
  // P5-3 新增编译校验规则（compile-validator.ts 内联常量的注册表镜像）
  | 'compilation.php_syntax_error'
  | 'compilation.ts_type_error'
  | 'compilation.anchor_validation_failed'
  | 'compilation.target_file_missing'
  | 'compilation.round_trip_inconsistent'
  | 'compilation.byte_unstable'
  | 'compilation.product_manually_edited'
  // P6 新增镜像校验规则（mirror-validator.ts 内联常量的注册表镜像）
  | 'mirror.world_init.count_mismatch'
  | 'mirror.world_init.distribution_mismatch'
  | 'mirror.world_init.invariant_violation'
  | 'mirror.day_refresh.count_mismatch'
  | 'mirror.day_refresh.distribution_mismatch'
  | 'mirror.loot_roll.distribution_mismatch'
  | 'mirror.loot_roll.invariant_violation'
  | 'mirror.enemy_spawn.count_mismatch'
  | 'mirror.enemy_spawn.distribution_mismatch'
  | 'mirror.backend_unreachable'
  | 'mirror.invariant_violation';

/**
 * 验证问题位置（跳转锚点）
 */
export interface ValidateIssueLocation {
  pgroup?: Pgroup | null;
  pls?: Pls | null;
  field?: string;
}

/**
 * 验证问题（一条）
 *
 * rule 字段类型为 string（O-10 引入新规则 ID 后放宽），已知 rule ID 见 ValidateRule 联合。
 */
export interface ValidateIssue {
  rule: string; // 稳定规则 ID（已知 ID 见 ValidateRule 联合，O-10 新增 ID 直接用 string）
  severity: ValidateSeverity;
  location: ValidateIssueLocation;
  message: string; // i18n key + params（M6 实现时由 i18n 解析）
  hint?: string; // i18n key + params
  blocking?: boolean; // P6 新增：true 表示该 issue 阻断构建发布（默认 false）
  // 镜像不一致的 issue 标记 blocking=true + severity='error'
  // 用户显式确认"我已知晓镜像差异，仍要发布"后可跳过 blocking=true 的 issue
}

/**
 * 验证选项
 *
 * - includeConfig / includeConnectivity 默认 true
 * - lootTableIds / itemTableIds 未提供时跳过对应外部引用校验（warning 类）
 * - config 字段在 includeConfig=true 时使用；任一为 null 时跳过对应规则的引用校验
 */
export interface ValidateOptions {
  includeConfig?: boolean; // 默认 true
  includeConnectivity?: boolean; // 默认 true（Full 验证含连通性 BFS，Light 验证跳过）
  lootTableIds?: string[]; // 外部提供的 loot_tables.php 已知 ID（warning 校验）
  itemTableIds?: string[]; // 外部提供的 item_table.php 已知 ID（warning 校验）
  // 配置数据（仅在 includeConfig=true 时使用，validate-rules.ts 纯函数读取）
  scatterPool?: ScatterPool | null;
  poiTable?: PoiTable | null;
  poiPool?: PoiPool | null;
}

/**
 * 验证模式
 */
export type ValidateMode = 'light' | 'full';

/**
 * 验证结果汇总
 */
export interface ValidateSummary {
  errors: number;
  warnings: number;
  blockingCount: number; // P6 新增：blocking=true 的 issue 数量
  byRule: Record<string, number>;
}
