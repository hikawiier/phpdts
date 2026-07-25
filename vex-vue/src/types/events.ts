/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 语义事件类型定义
//
// 对应现有 vex/js/data-manager.js 的 broadcast/listen 事件。
// 事件清单见迁移计划 1.3 节（代码核对后完整版）。
// ══════════════════════════════════════════════════

/** 语义事件名（独立于 API action） */
export type AppEvent =
  | 'map:loaded'
  | 'game:action-completed'
  | 'game:npc-settled'
  | 'game:tick-advanced'
  | 'game:command-committed'
  | 'map:click-current'
  | 'ui:toast'
  | 'battle:ended'
  | 'battle:started'
  | 'battle:aim-mode'
  | 'battle:aim-exit'
  | 'preload:executed'
  | 'log:force-scroll'
  | 'log:add-unread'
  // ── M6 战斗演出事件（Runner → 组件单向触发） ──
  | 'battle:play-damage-numbers'
  | 'battle:preload-init'
  | 'battle:preload-context-refresh'
  | 'battle:combat-targets-updated'
  // ── M6 瞄准模式事件（组件间通信） ──
  | 'battle:aim-target-selected'

/** 事件回调 */
export type EventCallback = (data?: unknown) => void;

/** Toast 事件数据（ui:toast） */
export interface ToastEventData {
  type: 'info' | 'success' | 'error' | 'warning';
  msg: string;
  [key: string]: unknown;
}

/** 地图点击当前格事件数据（map:click-current） */
export interface MapClickCurrentEventData {
  pls: string | number;
  [key: string]: unknown;
}

/** 战斗开始事件数据（battle:started） */
export interface BattleStartedEventData {
  enemyPid?: number;
  [key: string]: unknown;
}

/** 瞄准模式事件数据（battle:aim-mode / battle:aim-exit） */
export interface AimModeEventData {
  skillId?: string;
  targetMode?: 'enemy' | 'tile';
  actionRange?: number | string;
  /** 瞄准射程的计算原点；缺省时使用当前地图位置 */
  originPls?: number | string | null;
  prefixActions?: import('@/types/api').CombatPreviewAction[];
  [key: string]: unknown;
}

/** 装填区初始化事件数据（battle:preload-init） */
export interface PreloadInitEventData {
  /** 'pre-battle'（战斗前预装填）| 'in-battle'（战斗中玩家回合） */
  mode: 'pre-battle' | 'in-battle';
  /** 敌人 PID（用于 enemy 目标默认值） */
  enemyPid: number;
  /** 玩家 PID（用于 self 目标） */
  playerPid: number;
  /** 战斗上下文视图；预战斗装填时为空 */
  combatContext?: import('@/types/api').CombatViewModel | null;
}

/** 伤害数字事件数据（battle:play-damage-numbers） */
export interface PlayDamageNumbersEventData {
  /** 同一次动作命中的 v2 effect 数组 */
  effects: import('@/stores/battle-director').DirectedEffect[];
}

/** DebugBus 事件条目 */
export interface DebugBusEntry {
  ts: number;
  cat: string; // 事件类别
  step: string; // 事件步骤
  data: unknown;
}

/** DebugBus 状态快照 */
export type DebugStateSnapshot = Record<string, unknown>;
