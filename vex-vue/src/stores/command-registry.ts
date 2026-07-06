// ══════════════════════════════════════════════════
// 命令注册表 / Command Registry
//
// 命令三维度分类（与后端对齐）：
//   - mode:           命令在哪种 UI 模式下可执行（对应后端 obl_command_allowed_by_state）
//   - advancesTick:   是否推进游戏刻，触发 NPC 先攻轮（对应后端 obl_command_advances_tick）
//   - itm0Allowed:    itm0 锁定下是否允许执行（对应后端 oblivions_router.php 的 itm0 门控）
//
// 详见 docs/战斗锁定白名单-设计案.md §2.2/§2.3。
//
// 单一真值源：前端 canExecute(command) 与 execute() 内部 _checkLocks(command)
// 共用本注册表，避免 isLocked 与 execute 行为分叉。
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

/**
 * 命令注册表
 *
 * 新增命令时需同步登记：
 *   - 后端：obl_command_allowed_by_state / obl_command_advances_tick / oblivions_router.php itm0 门控
 *   - 前端：本注册表
 * 三维度取值必须语义一致。
 */
export const COMMAND_REGISTRY: Record<string, CommandSpec> = {
  // ── 探索类（mode='explore', advancesTick=true） ──
  move:             { mode: 'explore', advancesTick: true,  itm0Allowed: false },
  obl_explore:      { mode: 'explore', advancesTick: true,  itm0Allowed: false },
  obl_search:       { mode: 'explore', advancesTick: true,  itm0Allowed: false },

  // ── 探索类（mode='explore', advancesTick=false） ──
  obl_pickup:       { mode: 'explore', advancesTick: false, itm0Allowed: false },
  obl_discard:      { mode: 'explore', advancesTick: false, itm0Allowed: true  }, // slot=0 时丢弃手持
  obl_use_item:     { mode: 'explore', advancesTick: false, itm0Allowed: true  }, // slot=0 时使用手持
  obl_organize:     { mode: 'explore', advancesTick: false, itm0Allowed: true  },
  obl_craft:        { mode: 'explore', advancesTick: false, itm0Allowed: false },

  // ── 战斗类（mode='battle'） ──
  // obl_battle_start 前端归 battle（UI 状态：startBattle 立即切换 currentMode='battle'），
  // 后端归探索内（action='normal' 时允许）。两端分类不同但语义自洽——详见设计案 §4 决策 1。
  obl_battle_start:  { mode: 'battle', advancesTick: true,  itm0Allowed: false },
  obl_battle_action: { mode: 'battle', advancesTick: true,  itm0Allowed: false },
};
