/**
 * @module N API 客户端
 */

// API action 常量：Oblivions 只读端点经 state.php?scope=xxx
export const API_ACTIONS = {
  GAME_MAP: 'game_map',
  TILE_ACTIONS: 'tile_actions',
  PLAYER_INVENTORY: 'player_inventory',
  PLAYER_INFO: 'player_info',
  OBL_LOG: 'obl_log',
  OBL_ERROR: 'obl_error',
  ENEMIES: 'enemies',
  COMBAT_TARGETS: 'combat_targets',
  SKILL_LIST: 'skill_list',
  SKILL_CD_CHECK: 'skill_cd_check',
  // ── 合成系统（v2.2 新增） ──
  CRAFT_PREVIEW: 'craft_preview',
  CRAFT_WORKBENCH_MATERIALS: 'craft_workbench_materials',
  CRAFT_RECIPES: 'craft_recipes',
} as const;

export type ApiAction = (typeof API_ACTIONS)[keyof typeof API_ACTIONS];
