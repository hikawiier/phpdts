/**
 * @module K 状态管理层
 * @framework K-3 多层命令门控
 */

// ══════════════════════════════════════════════════
// Oblivions JSON Command Registry
//
// 前端 UI 预判表。后端 contract 才是安全真值源。
// 注意：battle.start 的 mode='battle' 指前端预战斗装填 UI，后端 allowed_actions 仍是普通探索状态。
// ══════════════════════════════════════════════════

export type CommandMode = 'battle' | 'explore' | 'universal';

import type { ActorCapability } from '@/types/api';

export interface CommandSpec {
  /** 命令在哪种 UI 模式下可执行 */
  mode: CommandMode;
  /** 是否推进游戏刻（触发 NPC 先攻轮） */
  advancesTick: boolean;
  /** itm0 锁定下是否允许执行（true = 允许，如整理/丢弃/使用手持道具） */
  itm0Allowed: boolean;
  readOnly: boolean;
  requiredCapabilities: ActorCapability[];
  /**
   * handler 内多次推进 tick（F-K4-Director §3.4 / 设计案 §3.4）。
   * 与 advancesTick 的差异：advancesTick=true 表示命令推进 tick（触发一次 NPC 先攻轮）；
   * internalTickAdvances=true 表示 handler 内部多次推进 tick（如 map.navigate 的逐次移动），
   * 前端演出层需消费多次移动结果序列，不依赖命令队列的单次 tick 后检查。
   */
  internalTickAdvances?: boolean;
}

export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  // ── 探索类（advancesTick=true） ──
  'map.move':        { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['voluntary_move'] },
  // 高层导航：后端选目标 + 多次原子移动 + 中断判断（F-K4-Director §3.1 / 设计案 §8.1）
  // internalTickAdvances=true：handler 内多次推进 tick，前端移动导演消费多次移动结果序列
  'map.navigate':    { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['voluntary_move'], internalTickAdvances: true },
  'map.explore':     { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
  'poi.search':      { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
  'poi.interact':    { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
  'poi.dismantle':   { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
  'world.wait':      { mode: 'explore', advancesTick: true,  itm0Allowed: true,  readOnly: false, requiredCapabilities: ['time_pass'] },

  // ── 探索类（advancesTick=false） ──
  'item.pickup':        { mode: 'explore', advancesTick: false, itm0Allowed: false, readOnly: false, requiredCapabilities: ['free_mutation'] },
  'item.discard':       { mode: 'explore', advancesTick: false, itm0Allowed: true,  readOnly: false, requiredCapabilities: ['free_mutation'] },
  'item.use':           { mode: 'explore', advancesTick: false, itm0Allowed: true,  readOnly: false, requiredCapabilities: ['free_mutation'] },
  'item.equip':         { mode: 'explore', advancesTick: false, itm0Allowed: false, readOnly: false, requiredCapabilities: ['free_mutation'] },
  'item.unequip':       { mode: 'explore', advancesTick: false, itm0Allowed: true,  readOnly: false, requiredCapabilities: ['free_mutation'] },
  'item.swap_weapon':   { mode: 'explore', advancesTick: false, itm0Allowed: false, readOnly: false, requiredCapabilities: ['free_mutation'] },
  'inventory.organize': { mode: 'explore', advancesTick: false, itm0Allowed: true,  readOnly: false, requiredCapabilities: ['free_mutation'] },
  'craft.execute':      { mode: 'explore', advancesTick: false, itm0Allowed: false, readOnly: false, requiredCapabilities: ['free_mutation'] },

  // ── 战斗 UI 类 ──
  'battle.start':       { mode: 'battle', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['enter_combat'] },
  'battle.submit_turn': { mode: 'battle', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['combat_action'] },

  // ── 战斗预校验类（read-only，不推进 tick） ──
  'combat.can_engage':      { mode: 'explore', advancesTick: false, itm0Allowed: true,  readOnly: true, requiredCapabilities: [] },
  'combat.preview_single':  { mode: 'battle',  advancesTick: false, itm0Allowed: false, readOnly: true, requiredCapabilities: [] },
  'combat.preview_chain':   { mode: 'battle',  advancesTick: false, itm0Allowed: false, readOnly: true, requiredCapabilities: [] },
  'combat.preview_targets': { mode: 'battle',  advancesTick: false, itm0Allowed: false, readOnly: true, requiredCapabilities: [] },
};
