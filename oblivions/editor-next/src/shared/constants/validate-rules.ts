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
} as const satisfies Record<string, ValidateRule>;

/**
 * 验证规则 ID 列表（用于遍历与覆盖率统计）
 */
export const VALIDATE_RULE_IDS: readonly ValidateRule[] = Object.values(VALIDATE_RULES);
