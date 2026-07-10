// ══════════════════════════════════════════════════
// API 响应类型定义
//
// 注意（迁移计划 2.9 节 M0 发现）：
// 1. API 返回 status: 'success'（非 'ok'）
// 2. player_info 等端点的数值字段均为字符串（如 "pid":"20"、"hp":"398"）
// 3. 存在未记录字段：tacpara / skillpara / obl_tick / obl_pretick
// ══════════════════════════════════════════════════

/** 玩家信息（oblivions/api/state.php?scope=player_info） */
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
  combat_context: CombatViewModel | null;
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
  /** 道具索引（从 itempara[].itmid 提取的模板 ID 列表，含 itm0 手持缓存槽） */
  itemIds: string[];
  // ── M0 发现的未记录字段（2.9 节） ──
  tacpara: Tacpara;
  skillpara: Skillpara;
  oblpara: Oblpara;
  obl_tick: number; // 当前 tick（数字类型，非字符串）
  obl_pretick: number; // 上一次 tick（数字类型）
  /** 当前已提交的实时演出批次水位；冷启动时直接从此处开始。 */
  presentation_head_seq: number;
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

export interface CombatViewModel {
  qid: number;
  state: BattleState;
  playerPid: number;
  roundNum: number;
  currentActorPid: number | null;
  currentActorType: number | null;
  canSubmitTurn: boolean;
  combatants: CombatantViewModel[];
  validTargets: CombatTargetViewModel[];
  suggestedTargetPid: number | null;
}

export interface CombatantViewModel {
  pid: number;
  type: number;
  name: string;
  hp: number;
  mhp: number;
  ap: number;
  max_ap: number;
  pgroup: number;
  pls: number;
  state: number;
  active: boolean;
  done: number;
  myorder: number;
}

export interface CombatTargetViewModel {
  pid: number;
  type: number;
  name: string;
  pgroup: number;
  pls: number;
  hp: number;
  mhp: number;
  state: number;
}

export type CombatTargetParticipation = 'member' | 'joinable' | 'left' | 'other_battle' | 'blocked';

export interface CombatTargetCandidate {
  pid: number;
  relation: 'hostile' | 'friendly' | 'self' | 'unknown';
  participation: CombatTargetParticipation;
  selectable: boolean;
  reason: string | null;
  character?: Enemy;
}

export interface CombatTargetsResponse {
  qid: number | null;
  suggestedTargetPid: number | null;
  candidates: CombatTargetCandidate[];
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
  kind?: string;
  exp?: string | number;
  [key: string]: unknown;
}

/**
 * 敌人信息（oblivions/api/state.php?scope=enemies）
 *
 * enemies scope 返回完整标准标量字段（与 player_info 一致）+ 装备索引。
 * 不含装备运行时参数 JSON（wep/wepk/wepe/weps/wepsk/weppara 各槽同理）和
 * 完整 itempara/tacpara/skillpara/oblpara JSON 大字段——这些按需通过 player_info scope 加载。
 */
export interface Enemy {
  pid: string | number;
  type: string | number;
  name: string;
  gd: string;
  icon: string;
  action: '' | 'battle' | string;
  bid: string | number;
  hp: string | number;
  mhp: string | number;
  sp: string | number;
  msp: string | number;
  att: string | number;
  def: string | number;
  ap: string | number;
  max_ap: string | number;
  pgroup: string | number;
  pls: string | number;
  lvl: string | number;
  exp: string | number;
  state: string | number;
  itemmaxslots: string | number;
  // 装备索引（7 槽模板 ID，轻量级标量）
  wepid: string;
  wep2id: string;
  arbid: string;
  arhid: string;
  araid: string;
  arfid: string;
  artid: string;
  // 道具索引（从 itempara[].itmid 提取的模板 ID 列表，含 itm0 手持缓存槽）
  itemIds: string[];
  discovered: string | number;
}

/** 地图数据（oblivions/api/state.php?scope=game_map） */
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

/** 地格交互（oblivions/api/state.php?scope=tile_actions） */
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
  itms?: string | number;
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

/** 玩家背包（oblivions/api/state.php?scope=player_inventory） */
export interface PlayerInventory {
  slots: InventoryItem[];
  num: number;
  limit: number;
  /** itm0 手持道具（null 表示空手） */
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
  /** 堆叠数量或耐久值（'∞' 表示无限，由后端 item_is_infinite() 判断） */
  itms?: string | number;
  [key: string]: unknown;
}

/** 技能列表（oblivions/api/state.php?scope=skill_list） */
export interface SkillList {
  skills: Skill[];
  player_ap: string | number;
  player_max_ap: string | number;
}

/**
 * 技能对象（oblivions/api/state.php?scope=skill_list 返回的 skills 数组元素）
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
  aimType: 'pid' | 'tile' | 'self' | 'none';
  selectionMode: 'explicit' | 'implicit';
  captureResolver: 'direct_character' | 'battle_hostiles' | 'tile_characters' | 'identity';
  range_mode?: 'fixed' | 'inherit' | 'additive' | 'capped_additive';
  range_max?: string | number;
  range_bonus?: string | number;
  action_range?: string | number;
  /** 前端不显示标记（true=隐藏，后端正常返回，前端过滤） */
  hidden?: boolean;
  [key: string]: unknown;
}

/** 结构化日志条目（oblivions/api/state.php?scope=obl_log） */
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

/** 日志响应（oblivions/api/state.php?scope=obl_log） */
export interface OblLogResponse {
  entries: LogEntry[];
  total: number;
}

/** 错误日志条目（oblivions/api/state.php?scope=obl_error） */
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

/** 错误日志响应（oblivions/api/state.php?scope=obl_error） */
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

export type BattleLogV2EventType =
  | 'round_start'
  | 'turn_start'
  | 'action_start'
  | 'action_delivery'
  | 'combatant_joined'
  | 'effect_applied'
  | 'action_end'
  | 'action_failed'
  | 'combatant_cleared'
  | 'battle_end'
  | 'notice';

export type BattleLogV2Channel = 'render' | 'debug' | 'diagnostic';

export interface CombatantSnapshot {
  pid: number;
  type: number;
  name: string;
  hp: number;
  mhp: number;
  ap?: number;
  max_ap?: number;
  pgroup?: number;
  pls?: number;
  state?: number;
}

export type CombatTargetRef =
  | { kind: 'pid'; pid: number; snapshot?: CombatantSnapshot | null }
  | { kind: 'tile'; pgroup: number; pls: number; name?: string }
  | { kind: 'self'; pid: number; snapshot?: CombatantSnapshot | null }
  | { kind: 'none' };

export interface StateDelta {
  hp_before?: number;
  hp_after?: number;
  ap_before?: number;
  ap_after?: number;
  pls_before?: number;
  pls_after?: number;
  state_before?: number;
  state_after?: number;
}

export interface BattleLogV2Payload {
  qid?: number | null;
  action_uid?: string | null;
  action_id?: string | null;
  actor?: CombatantSnapshot | null;
  targets?: CombatTargetRef[];
  target?: CombatTargetRef;
  ap_cost?: number;
  ap_spent?: number;
  effect_uid?: string | null;
  effect_type?: string;
  source?: CombatantSnapshot | null;
  value?: number;
  delta?: StateDelta;
  flags?: Record<string, boolean | undefined>;
  success?: boolean;
  reason?: string | null;
  message?: string;
  text?: string;
  title?: string;
  detail?: Record<string, unknown>;
  combatant?: CombatantSnapshot | null;
  by_action_uid?: string | null;
  by_effect_uid?: string | null;
  winner_pid?: number | null;
  survivors?: CombatantSnapshot[];
  [key: string]: unknown;
}

export interface BattleLogV2Event {
  /** presentation.v1 批次内的稳定顺序；旧 fixture/兼容数据可能缺省。 */
  event_seq?: number;
  log_id: number;
  played: number;
  ts: number;
  phase: 'battlelog_v2' | string;
  schema: 'battlelog.v2';
  event_type: BattleLogV2EventType;
  channel: BattleLogV2Channel;
  event_uid: string;
  action_uid: string | null;
  effect_uid: string | null;
  payload: BattleLogV2Payload;
  debug: boolean;
  qid: number | null;
  actor_pid: number | null;
  target_pid: number | null;
  action_id: string | null;
  effect_type: string | null;
  effect_value: number | null;
  success: boolean | null;
  reason: string | null;
  winner_pid: number | null;
  cleared_pid: number | null;
  cleared_name: string | null;
  bl_turn_num: number | null;
  bl_round_num: number | null;
  bl_segment_flag: 'round_start' | 'turn_start' | 'battle_end' | 'ambush_battle_end' | null;
}

export type BattleLogRawEntry = BattleLogV2Event;

export interface PresentationStateAfter {
  pid: number;
  action: string;
  bid: number;
  battle_state: BattleState;
  pgroup: number;
  pls: number;
  state: number;
  hp: number;
  ap: number;
}

/** command/heartbeat 事务提交后随响应返回的不可变演出批次。 */
export interface PresentationBatchV1 {
  schema: 'presentation.v1';
  batch_seq: number;
  groomid: number;
  recipient_pid: number;
  qid: number | null;
  request_id: string;
  tick: number;
  state_after: PresentationStateAfter;
  events: BattleLogV2Event[];
}

/** 敌人列表响应（oblivions/api/state.php?scope=enemies） */
export interface EnemiesResponse {
  enemies: Enemy[];
}

// ══════════════════════════════════════════════════
// 合成系统类型（v2.2 新增，依赖契约补丁设计案 C1/C2）
// ══════════════════════════════════════════════════

/** craft_preview 响应（oblivions/api/state.php?scope=craft_preview） */
export interface CraftPreviewResult {
  /** 匹配配方数（0=不匹配，1=可合成，≥2=指向不明确） */
  match_count: number;
  /** 是否可合成（match_count === 1） */
  craftable: boolean;
  /** match_count=1 时为匹配配方 ID，否则 null（供前端查 recipes 显示消耗） */
  recipe_id: string | null;
  /** 预判日志单对象（非数组） */
  preview_log: PreviewLog;
}

/** 预判日志条目（与 LogEntry 结构兼容，复用 renderLogEntry 渲染） */
export interface PreviewLog {
  /** 反馈 ID：'craft.empty_pool' | 'craft.tool_missing' | 'craft.extra_material' | 'craft.insufficient' | 'craft.fail_no_match' | 'craft.fail_ambiguous' | 'craft.ready' */
  id: string;
  params: Record<string, string | number | boolean>;
}

/** workbench_materials 的元素（依赖契约补丁 C2：补齐 tags/itmk 字段） */
export interface WorkbenchMaterial {
  /** 来源类型（'cat'=猫身上 / 'poi'=地图格 POI） */
  source: 'cat' | 'poi';
  /** 工作台素材唯一标识（用于 craft.execute 和 craft_preview 的 workbench_materials 参数） */
  id: string;
  /** 关联的 item_table 道具 ID */
  item_id: string;
  /** 工具等级 */
  tool_level: number;
  /** 道具 tags 数组（供 quickCraft 匹配） */
  tags: string[];
  /** 道具类别（供 quickCraft 匹配） */
  itmk: string;
}

/** craft_workbench_materials 响应 */
export interface CraftWorkbenchMaterialsResponse {
  workbench_materials: WorkbenchMaterial[];
}

/** craft_recipes 的元素 */
export interface CraftRecipe {
  recipe_id: string;
  /** 配方分类：'food' | 'tool' | 'armor' | 'weapon' */
  category: string;
  materials: CraftMaterial[];
  results: CraftResult[];
}

/** 配方素材项 */
export interface CraftMaterial {
  /** 精确匹配：item_id（优先级最高） */
  item_id?: string;
  /** 类别匹配：itmk（优先级次之） */
  itmk?: string;
  /** 性质匹配：tag（优先级最低） */
  tag?: string;
  /** 需求数量 */
  count: number;
  /** 消耗模式：'all'=全消耗 / 'durability'=扣耐久 / 'none'=不消耗（工作台素材） */
  consume?: 'all' | 'durability' | 'none';
  /** 工具等级要求（素材 tool_level 必须 ≥ min_level） */
  min_level?: number;
  [key: string]: unknown;
}

/** 配方产物项 */
export interface CraftResult {
  item_id: string;
  count: number;
  [key: string]: unknown;
}

/** craft_recipes 响应 */
export interface CraftRecipesResponse {
  recipes: CraftRecipe[];
}
