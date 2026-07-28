// @module O 内容工具箱
//
// 验证规则常量集（对齐 validate.js RULE 常量集与 i18n key）
// 每条规则一个唯一 key，用于 i18n 国际化 + 单元测试锚点

import type { ValidateRule } from '../types/validate';

export const VALIDATE_RULES = {
  PLS_RANGE: 'pls_range',
  PGROUP_RANGE: 'pgroup_range',
  TIDE_INVALID: 'tide_invalid',
  FLOOR_INVALID: 'floor_invalid',
  OCCUPY_CONFLICT: 'occupy_conflict',
  REGION_NEXT_DANGLING: 'region_next_dangling',
  REGION_PREV_DANGLING: 'region_prev_dangling',
  REGION_NEXT_PREV_ASYMMETRIC: 'region_next_prev_asymmetric',
  REGION_ENTRANCE_DANGLING: 'region_entrance_dangling',
  REGION_EXIT_DANGLING: 'region_exit_dangling',
  REGION_NO_ENTRANCE: 'region_no_entrance',
  REGION_NO_EXIT: 'region_no_exit',
  NEIGHBOR_DANGLING: 'neighbor_dangling',
  NEIGHBOR_ASYMMETRIC: 'neighbor_asymmetric',
  EXIT_LINK_TO_PGROUP_DANGLING: 'exit_link_to_pgroup_dangling',
  EXIT_LINK_TO_PLS_DANGLING: 'exit_link_to_pls_dangling',
  CONNECTIVITY_ISLAND: 'connectivity_island',
  POI_POOL_REF: 'poi_pool_ref',
  POI_LOOT_TABLE_REF: 'poi_loot_table_ref',
  SCATTER_ITEM_REF: 'scatter_item_ref',
  // P4 新增分布校验规则（O-10 第 5 层 distribution-validator.ts 内联常量的注册表镜像）
  DISTRIBUTION_SCATTER_CANDIDATE_TILE_INSUFFICIENT: 'distribution.scatter.candidate_tile_insufficient',
  DISTRIBUTION_SCATTER_REFRESH_RATE_OVERFLOW: 'distribution.scatter.refresh_rate_overflow',
  DISTRIBUTION_SCATTER_CAPACITY_CONFLICT: 'distribution.scatter.capacity_conflict',
  DISTRIBUTION_ENEMY_CANDIDATE_TILE_INSUFFICIENT: 'distribution.enemy.candidate_tile_insufficient',
  DISTRIBUTION_ENEMY_PER_REGION_CAPACITY_CONFLICT: 'distribution.enemy.per_region_capacity_conflict',
  DISTRIBUTION_ENEMY_COMMENT_DATA_DRIFT: 'distribution.enemy.comment_data_drift',
  // P5-3 新增编译校验规则（O-10 第 7 层 compile-validator.ts 内联常量的注册表镜像）
  COMPILATION_PHP_SYNTAX_ERROR: 'compilation.php_syntax_error',
  COMPILATION_TS_TYPE_ERROR: 'compilation.ts_type_error',
  COMPILATION_ANCHOR_VALIDATION_FAILED: 'compilation.anchor_validation_failed',
  COMPILATION_TARGET_FILE_MISSING: 'compilation.target_file_missing',
  COMPILATION_ROUND_TRIP_INCONSISTENT: 'compilation.round_trip_inconsistent',
  COMPILATION_BYTE_UNSTABLE: 'compilation.byte_unstable',
  COMPILATION_PRODUCT_MANUALLY_EDITED: 'compilation.product_manually_edited',
  // P6 新增镜像校验规则（O-10 第 8 层 mirror-validator.ts 内联常量的注册表镜像）
  // 镜像不一致的 issue 标记 severity='error' + blocking=true，对齐执行案 §4.5.1 决策
  // （不新增 critical severity，保持 ValidateSeverity = 'error' | 'warning' 二档不变）
  MIRROR_WORLD_INIT_COUNT_MISMATCH: 'mirror.world_init.count_mismatch',
  MIRROR_WORLD_INIT_DISTRIBUTION_MISMATCH: 'mirror.world_init.distribution_mismatch',
  MIRROR_WORLD_INIT_INVARIANT_VIOLATION: 'mirror.world_init.invariant_violation',
  MIRROR_DAY_REFRESH_COUNT_MISMATCH: 'mirror.day_refresh.count_mismatch',
  MIRROR_DAY_REFRESH_DISTRIBUTION_MISMATCH: 'mirror.day_refresh.distribution_mismatch',
  MIRROR_LOOT_ROLL_DISTRIBUTION_MISMATCH: 'mirror.loot_roll.distribution_mismatch',
  MIRROR_LOOT_ROLL_INVARIANT_VIOLATION: 'mirror.loot_roll.invariant_violation',
  MIRROR_ENEMY_SPAWN_COUNT_MISMATCH: 'mirror.enemy_spawn.count_mismatch',
  MIRROR_ENEMY_SPAWN_DISTRIBUTION_MISMATCH: 'mirror.enemy_spawn.distribution_mismatch',
  // backend_unreachable 是唯一的 warning + blocking=false 镜像规则——
  // 后端 State API 不可达时 emit，不阻断发布（仅提示用户）
  MIRROR_BACKEND_UNREACHABLE: 'mirror.backend_unreachable',
  MIRROR_INVARIANT_VIOLATION: 'mirror.invariant_violation',
} as const satisfies Record<string, ValidateRule>;

/**
 * 验证规则 ID 列表（用于遍历与覆盖率统计）
 */
export const VALIDATE_RULE_IDS: readonly ValidateRule[] = Object.values(VALIDATE_RULES);
