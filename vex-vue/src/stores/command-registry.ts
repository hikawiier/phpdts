// ══════════════════════════════════════════════════
// Oblivions JSON Command Registry
//
// 前端 UI 预判表。后端 contract 才是安全真值源。
// 注意：battle.start 的 mode='battle' 指前端预战斗装填 UI，后端 allowed_actions 仍是普通探索状态。
// ══════════════════════════════════════════════════

export type CommandMode = 'battle' | 'explore' | 'universal';

export interface CommandSpec {
  /** 命令在哪种 UI 模式下可执行 */
  mode: CommandMode;
  /** 是否推进游戏刻（触发 NPC 先攻轮） */
  advancesTick: boolean;
  /** itm0 锁定下是否允许执行（true = 允许，如整理/丢弃/使用手持道具） */
  itm0Allowed: boolean;
}

export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  // ── 探索类（advancesTick=true） ──
  'map.move':        { mode: 'explore', advancesTick: true,  itm0Allowed: false },
  'map.explore':     { mode: 'explore', advancesTick: true,  itm0Allowed: false },
  'poi.search':      { mode: 'explore', advancesTick: true,  itm0Allowed: false },

  // ── 探索类（advancesTick=false） ──
  'item.pickup':        { mode: 'explore', advancesTick: false, itm0Allowed: false },
  'item.discard':       { mode: 'explore', advancesTick: false, itm0Allowed: true  },
  'item.use':           { mode: 'explore', advancesTick: false, itm0Allowed: true  },
  'inventory.organize': { mode: 'explore', advancesTick: false, itm0Allowed: true  },
  'craft.execute':      { mode: 'explore', advancesTick: false, itm0Allowed: false },

  // ── 战斗 UI 类 ──
  'battle.start':       { mode: 'battle', advancesTick: true,  itm0Allowed: false },
  'battle.submit_turn': { mode: 'battle', advancesTick: true,  itm0Allowed: false },

  // ── 战斗预校验类（read-only，不推进 tick） ──
  'combat.can_engage':      { mode: 'explore', advancesTick: false, itm0Allowed: false },
  'combat.preview_single':  { mode: 'battle',  advancesTick: false, itm0Allowed: false },
  'combat.preview_chain':   { mode: 'battle',  advancesTick: false, itm0Allowed: false },
};
