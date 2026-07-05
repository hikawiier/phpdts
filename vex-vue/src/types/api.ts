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
  /**
   * 战斗状态机：当前玩家所在战场的状态（单一数据源）
   */
  obl_battle_state: BattleState;
  equipment: Record<string, EquipmentSlot | null>;
}

/**
 * 战斗状态机枚举（3 态）
 *
 * - IDLE：无活跃战斗
 * - PLAYER_TURN：轮到玩家操作（可提交指令，停止轮询）
 * - PROCESSING：后端处理中（按钮灰掉，启动轮询直到变回 PLAYER_TURN 或 IDLE）
 */
export type BattleState =
  | 'IDLE'
  | 'PLAYER_TURN'
  | 'PROCESSING';

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
  item_id?: string;
  itmid?: string;
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
 *   - 0/1：已发现，用 item_id + locale 渲染名称，itm 仅表示自定义名
 *   - 2：近视发现，用 fake_item_id + locale 渲染伪装名称
 */
export interface GroundItem {
  iid: string | number;
  item_id: string;
  discovered: number;
  display_name?: string;
  fake_item_id?: string;
  itm?: string;
  itmk?: string;
  itme?: string | number;
  name?: string;
  [key: string]: unknown;
}

export interface Poi {
  iaid: string | number;
  poi_id: string;
  name?: string;
  desc?: string;
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
  /** itm0 缓存槽内容（null 表示无待整理道具） */
  itm0?: InventoryItem | null;
}

/** 背包槽位（player_inventory.slots 的元素） */
export interface InventoryItem {
  slot: number;
  empty: boolean;
  name?: string;
  itmid?: string;
  item_id?: string;
  kind?: string;
  effect?: string | number;
  durability?: string | number;
  iid?: string | number;
  /** 是否可使用（tag_usable） */
  usable?: boolean;
  /** 道具 tags 数组（供合成系统匹配） */
  tags?: string[];
  /** 道具类别（供合成系统匹配） */
  itmk?: string;
  /** 是否可堆叠（true=数量模型，false=耐久模型） */
  stack?: boolean;
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
  /** 是否为终结技（1=是，0=否），终结技永远在队列末尾执行 */
  finisher: number;
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

/** 先攻掷骰结果项（battle_log.rolls / combatants 数组元素） */
export interface RollData {
  pid: number;
  myorder: number;
  roll: number;
  initiative: number;
  type: number;
  is_ambush: boolean;
}

/**
 * 战斗日志条目（api_v2.php?action=battle_log）
 *
 * 字段对应后端 BattleLogCollector::emit() 的实际输出（设计案2 v3）。
 * 后端 obl_battle_log_load 默认过滤 debug=true，前端拿到的全是 debug=false 原料。
 */
export interface BattleLogEntry {
  log_id: number;
  played: number;
  ts: number;

  // 事件标识
  phase: string;
  action_id: string | null;

  // 行动者信息
  actor_pid: number | null;
  actor_type: number | null;
  actor_name: string | null;
  actor_hp: number | null;
  actor_max_hp: number | null;
  actor_ap: number | null;
  actor_max_ap: number | null;

  // 目标信息
  target_pid: number | null;
  target_type: number | null;
  target_name: string | null;
  target_hp: number | null;
  target_max_hp: number | null;

  // 效果
  effect_value: number | null;
  success: boolean | null;

  // 事件元数据
  qid: number | null;
  rolls: RollData[] | null;
  ambush_pid: number | null;
  combatants: RollData[] | null;
  reason: string | null;
  winner_pid: number | null;
  cleared_pid: number | null;
  cleared_name: string | null;
  ambusher_pid: number | null;
  ambusher_name: string | null;

  // 渲染/调试
  debug: boolean;

  // 边界标记（后端 BattleLogCollector 自动填充）
  bl_turn_num: number | null;       // null=Phase 0/尚未开始，1+=第 N turn
  bl_round_num: number | null;      // null=Phase 0 无队列，0+=第 N round（0-indexed）
  bl_segment_flag: 'round_start' | 'turn_start' | 'battle_end' | 'ambush_battle_end' | null;
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
