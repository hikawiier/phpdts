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
}

export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  // ── 探索类（advancesTick=true） ──
  'map.move':        { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['voluntary_move'] },
  'map.explore':     { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
  'poi.search':      { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
  'poi.interact':    { mode: 'explore', advancesTick: true,  itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
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
