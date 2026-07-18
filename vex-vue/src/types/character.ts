/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// CharacterHub 类型定义
//
// Character 是 CharacterHub 的统一角色数据结构，以 pid 为 key 存储。
// 它包含 oblplayers 表的所有标准标量字段 + 装备索引（轻量级模板 ID）。
// 战斗上下文派生字段拆到独立的 CombatState 类型（可选挂载）。
//
// 设计要点（见 oblivions/docs/地图实体真值源统一设计案.md §3.2）：
//   - 字段名统一用 oblplayers 表字段名（mhp / max_ap），消除 maxHp/max_hp 命名分裂
//   - 数值字段统一为 number 类型（merge* 方法做 Number() 转换）
//   - 装备索引纳入 Character（轻量级），运行时参数 JSON 不纳入（按需通过 player_info 加载）
//   - CombatState 是战斗派生字段，由 mergeCombatContext 写入，mergeCombatContext(null) 置 undefined
// ══════════════════════════════════════════════════

/**
 * oblplayers 标准标量字段（玩家与 NPC 共用）
 *
 * 数值字段统一为 number 类型（merge* 方法对 API 字符串值做 Number() 转换）。
 * 装备索引字段（wepid/wep2id/dbid/dhid/daid/dfid/acid/itemIds）是轻量级模板 ID，
 * 不含运行时参数 JSON（wep/wepk/wepe/weps/wepsk/weppara 各槽同理 + itempara 完整结构）。
 */
import type { ActorCapabilitiesProjection, ActorStatusProjection } from './api';

export interface Character {
  // ── 身份 ──
  pid: number;
  type: number;           // 0 = player, >0 = enemy type
  name: string;
  gd: string;             // 性别
  icon: string;

  // ── 战斗状态 ──
  action: string;         // '' / 'battle' / ...
  bid: number;            // 战场编号（qid）

  // ── 属性（玩家与 NPC 共用）──
  hp: number;
  mhp: number;            // max hp（统一用 oblplayers 表字段名 mhp）
  sp: number;
  msp: number;            // max sp
  att: number;
  def: number;

  // ── AP ──
  ap: number;
  max_ap: number;         // 统一用表字段名 max_ap

  // ── 位置 ──
  pgroup: number;
  pls: number;

  // ── 进度 ──
  lvl: number;
  exp: number;
  state: number;          // 0 = alive, 其他 = 死亡/逃跑/隐藏

  // ── 道具 ──
  itemmaxslots: number;

  // ── 装备索引（7 槽模板 ID，轻量级标量，供快速查询角色装备了什么）──
  wepid: string;          // 主武器
  wep2id: string;         // 副武器
  dbid: string;           // 护甲（Defense Body）
  dhid: string;           // 头部防具（Defense Head）
  daid: string;           // 手部防具（Defense Arm）
  dfid: string;           // 足部防具（Defense Foot）
  acid: string;           // 饰品（Accessory）

  // ── 道具索引（从 itempara[].itmid 提取的模板 ID 列表，含 itm0 手持缓存槽）──
  itemIds: string[];

  // ── 发现状态（仅 enemies scope 返回；player_info 不返回，mergePlayer 主动设 true）──
  discovered: boolean;

  statuses: ActorStatusProjection[];
  capabilities: ActorCapabilitiesProjection;

  // ── 战斗上下文派生（由 combat_context 派生，非 oblplayers 字段）──
  combat?: CombatState;
}

/**
 * 战斗上下文派生状态
 *
 * 由 mergeCombatContext 写入，mergeCombatContext(null) 时置 undefined。
 * 标准属性字段（hp/mhp/ap/max_ap 等）不在此处——它们仍是 Character 的标准字段，
 * mergeCombatContext 会用 combat_context 的 (int) 强转数字覆盖 Character 的对应字段。
 */
export interface CombatState {
  inCombat: boolean;      // 是否在当前战斗中
  active: boolean;        // 战斗中是否活跃（entities 过滤用）
  done: number;           // 战斗队列完成标记
  myorder: number;        // 先攻顺序
}
