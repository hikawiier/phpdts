//
// 验证工具类型定义，对齐 validate.js RULE 常量集与 Issue 结构
// 严重级别仅 error / warning 两档（对齐 2.15：无 info 级，避免非阻塞提示噪声）
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
  | 'scatter_item_ref';

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
 */
export interface ValidateIssue {
  rule: ValidateRule;
  severity: ValidateSeverity;
  location: ValidateIssueLocation;
  message: string; // i18n key + params（M6 实现时由 i18n 解析）
  hint?: string; // i18n key + params
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
  byRule: Record<string, number>;
}
