// API action 常量（代码核对后完整版，共 13 个只读端点 + HEARTBEAT）
export const API_ACTIONS = {
  GAME_MAP: 'game_map',
  TILE_ACTIONS: 'tile_actions',
  PLAYER_INVENTORY: 'player_inventory',
  PLAYER_INFO: 'player_info',
  OBL_LOG: 'obl_log',
  OBL_ERROR: 'obl_error',
  BATTLE_LOG: 'battle_log',
  ENEMIES: 'enemies',
  SKILL_LIST: 'skill_list',
  AI_DUMP_SAVE: 'ai_dump_save',
  // ── 合成系统（v2.2 新增） ──
  CRAFT_PREVIEW: 'craft_preview',
  CRAFT_WORKBENCH_MATERIALS: 'craft_workbench_materials',
  CRAFT_RECIPES: 'craft_recipes',
  HEARTBEAT: 'heartbeat',
} as const;

export type ApiAction = (typeof API_ACTIONS)[keyof typeof API_ACTIONS];
