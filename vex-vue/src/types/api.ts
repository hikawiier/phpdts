// ══════════════════════════════════════════════════
// API 响应类型定义
//
// 注意（迁移计划 2.9 节 M0 发现）：
// 1. API 返回 status: 'success'（非 'ok'）
// 2. player_info 等端点的数值字段均为字符串（如 "pid":"20"、"hp":"398"）
// 3. 存在未记录字段：tacpara / skillpara / obl_tick / obl_pretick
// ══════════════════════════════════════════════════

/** 玩家信息（api_v2.php?action=player_info） */
export interface PlayerInfo {
  pid: string;
  type: string;
  name: string;
  gd: string; // 'm' | 'f' | 'n' | '0'
  icon: string;
  groomid: string;
  action: '' | 'battle' | string;
  bid: string;
  battle_queue: BattleQueue | null;
  hp: string;
  mhp: string;
  sp: string;
  msp: string;
  att: string;
  def: string;
  ap: string;
  max_ap: string;
  pgroup: string;
  pls: string; // 当前位置 ID
  lvl: string;
  exp: string;
  upexp: string | null;
  state: string;
  itemmaxslots: string;
  // ── M0 发现的未记录字段（2.9 节） ──
  tacpara: Tacpara;
  skillpara: Skillpara;
  oblpara: Oblpara;
  obl_tick: number; // 当前 tick（数字类型，非字符串）
  obl_pretick: number; // 上一次 tick（数字类型）
  /** NPC 待结算标志：true 表示 NPC 事件未结算完，前端应等待（api_v2.php:205） */
  obl_tick_pending_npc: boolean;
  equipment: Record<string, EquipmentSlot | null>;
}

/** 先攻队列（player_info.battle_queue） */
export interface BattleQueue {
  qid: string | number;
  queue: BattleQueueEntry[];
}

export interface BattleQueueEntry {
  pid: string | number;
  type: string | number; // 0=玩家，>0=敌人类型
  myorder: string | number;
  done: string | number; // 0=未完成，1=已完成
}

/** 战术参数（player_info.tacpara） */
export interface Tacpara {
  slots: (unknown | null)[]; // 战术槽位
  [key: string]: unknown;
}

/** 技能参数（player_info.skillpara） */
export interface Skillpara {
  unarmed_strike?: { lstact: number };
  escape?: { lstact: number };
  [key: string]: { lstact: number } | undefined;
}

/** Oblivions 参数（player_info.oblpara） */
export interface Oblpara {
  killnum?: number;
  battle?: unknown;
  ambush_flag?: boolean;
  [key: string]: unknown;
}

/** 装备槽（player_info.equipment 的值） */
export interface EquipmentSlot {
  name: string;
  exp?: string | number;
  [key: string]: unknown;
}

/** 敌人信息（api_v2.php?action=enemies） */
export interface Enemy {
  pid: string | number;
  type: string | number;
  name: string;
  icon: string;
  gd: string;
  pgroup: string | number;
  pls: string | number;
  hp: string | number;
  mhp: string | number;
  lvl: string | number;
  state: string | number;
  discovered: string | number;
}

/** 地图数据（api_v2.php?action=game_map） */
export interface GameMap {
  currentLocation: string | number;
  currentRegion: string | number;
  links: GameMapLinks;
}

export interface GameMapLinks {
  regions: Record<string, unknown>;
  tiles: Record<string, Record<string, TileInfo>>;
  grids: Record<string, unknown>;
  fog: Record<string, unknown>;
}

export interface TileInfo {
  name?: string;
  passable?: boolean | number | string;
  [key: string]: unknown;
}

/** 地格交互（api_v2.php?action=tile_actions） */
export interface TileActions {
  pois: Poi[];
  ground_items: GroundItem[];
}

/**
 * 地格上的道具（ground_items / poi.items 共用）
 *
 * discovered 字段：
 *   - 0/1：已发现，显示 itm/itmk/itme
 *   - 2：近视发现，只显示 display_name
 */
export interface GroundItem {
  iid: string | number;
  discovered: number;
  display_name?: string;
  itm?: string;
  itmk?: string;
  itme?: string | number;
  name?: string;
  [key: string]: unknown;
}

export interface Poi {
  iaid: string | number;
  name: string;
  searchable: boolean | number;
  repeatable: boolean | number;
  searched: boolean | number;
  items: GroundItem[];
  mechanic?: string;
  mechanic_value?: string | number;
  search_count?: number;
  repeat_limit?: number;
  [key: string]: unknown;
}

/** 玩家背包（api_v2.php?action=player_inventory） */
export interface PlayerInventory {
  slots: InventoryItem[];
  num: number;
  limit: number;
}

/** 背包槽位（player_inventory.slots 的元素） */
export interface InventoryItem {
  slot: number;
  empty: boolean;
  name?: string;
  kind?: string;
  effect?: string | number;
  durability?: string | number;
  iid?: string | number;
  [key: string]: unknown;
}

/** 技能列表（api_v2.php?action=skill_list） */
export interface SkillList {
  skills: Skill[];
  player_ap: string | number;
  player_max_ap: string | number;
}

/**
 * 技能对象（api_v2.php?action=skill_list 返回的 skills 数组元素）
 *
 * 字段名以原前端 battle-preload.js 实际使用为准（act_id 而非 skill_id）。
 */
export interface Skill {
  /** 技能 ID（用于 getSkillTemplate 查询 + 提交队列时使用） */
  act_id: string;
  /** 技能名称（后端 skill_config.php 提供，前端 SKILL_TEMPLATES 优先） */
  name: string;
  /** AP 消耗（后端返回字符串，使用处用 Number() 转换） */
  apcost: string;
  /** 是否在冷却中 */
  on_cd: boolean;
  /** 冷却总回合数（后端返回字符串） */
  cd: string;
  /** 当前 tick（冷却剩余，后端返回字符串） */
  current_tick: string;
  /** 上一动作 tick（后端返回字符串） */
  lstact: string;
  /** 是否可用（综合判断：AP 足够 + 未冷却 + ...） */
  available: boolean;
  /** 目标类型：'self'（自身）/ 'enemy'（敌人，需选目标） */
  target: 'self' | 'enemy';
  [key: string]: unknown;
}

/** 结构化日志条目（api_v2.php?action=obl_log） */
export interface LogEntry {
  id: string; // {logcategory}.{subevent}
  logcategory:
    | 'move'
    | 'explore'
    | 'search'
    | 'pickup'
    | 'discard'
    | 'system'
    | 'enemy'
    | 'battle';
  params: Record<string, string | number | boolean>;
  html: string | null;
  debug: boolean;
  ts: number;
}

/** 日志响应（api_v2.php?action=obl_log） */
export interface OblLogResponse {
  entries: LogEntry[];
  total: number;
}

/** 错误日志条目（api_v2.php?action=obl_error） */
export interface ErrorLogEntry {
  /** 错误 ID，命名规则 {模块}.{错误类型}，如 'tick.dispatch.error' */
  id: string;
  /** 错误详情，值限 string/number/boolean */
  params: Record<string, string | number | boolean>;
  /** 产生时间戳（秒） */
  ts: number;
  /** 请求来源：'command' / 'api' / 'unknown'，便于定位错误入口 */
  request: string;
}

/** 错误日志响应（api_v2.php?action=obl_error） */
export interface OblErrorLogResponse {
  entries: ErrorLogEntry[];
  total: number;
}

/** 战斗日志条目（api_v2.php?action=battle_log） */
export interface BattleLogEntry {
  id: string; // 'battle.action'
  log_id: string;
  turn: string;
  actor: string; // 'player' | 'enemy_{pid}'
  actor_type: string; // '0'=玩家，>'0'=敌人类型（后端返回字符串）
  actor_pid: string;
  target: string;
  target_type: string;
  target_pid: string;
  action_id: string; // unarmed_strike / escape / battle.start / battle_end / ...
  action_name: string;
  effect_value: string;
  extra: Record<string, unknown> | null;
  phase: string; // 'excute' / 'finish_check' 等（控制动画播放）
  played: string;
  ts: string;
}

/** 战斗日志响应（api_v2.php?action=battle_log） */
export interface BattleLogResponse {
  entries: BattleLogEntry[];
  total: number;
}

/** 敌人列表响应（api_v2.php?action=enemies） */
export interface EnemiesResponse {
  enemies: Enemy[];
}
