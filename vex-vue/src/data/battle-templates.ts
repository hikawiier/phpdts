// ══════════════════════════════════════════════════
// battle_log 渲染模板 / Battle log render templates
//
// 按 directedKind 分发渲染（设计案3 v3）。
// 后端只传索引 ID（actor_pid/target_pid/action_id），前端负责渲染文案。
//
// 人称渲染规则：
//   actor_type === 0 → "你"
//   actor_type > 0  → 显示 actor_name（从 entry 直接读，不查 API）
//
// 关联文档：oblivions/docs/设计案3-重构前端播放系统.md §六
// ══════════════════════════════════════════════════

import { escapeHtml } from '@/utils/format';
import type { DirectedEntry, DirectedKind } from '@/stores/battle-director';

/**
 * idle 动作文案映射
 *
 * key 为 enemies_config.php 中的敌人类型 ID（actor_type）。
 * 后端 idle_calc 只 emit actor_type，文案完全由前端控制（前后端职责分离）。
 */
const IDLE_FLAVOR: Record<number, string> = {
  1: '废铁史莱姆摇晃着身体，似乎在发呆',
  2: '锈蚀守卫的齿轮卡住了，一动不动',
  // 未来扩展
};

/** 按 directedKind 分发的渲染模板映射 */
const KIND_TEMPLATES: Record<DirectedKind, (e: DirectedEntry, playerPid: number) => string> = {
  action: renderAction,
  initiative: renderInitiative,
  flee: renderFlee,
  combatant_cleared: renderCombatantCleared,
  battle_end: renderBattleEnd,
  ambush_battle_end: renderAmbushBattleEnd,
  display: renderDisplay,
};

/**
 * 渲染 DirectedEntry 为 HTML 字符串
 *
 * @param entry 导演编排后的条目
 * @param playerPid 当前玩家 PID（供判断胜负等，当前未用，预留）
 * @returns HTML 字符串（空字符串表示该条目不需要渲染）
 */
export function renderDirectedEntryHtml(entry: DirectedEntry, playerPid: number = 0): string {
  const template = KIND_TEMPLATES[entry.directedKind];
  return template ? template(entry, playerPid) : '';
}

// ─────────────────────────────────────────────────
// 各 directedKind 渲染函数
// ─────────────────────────────────────────────────

/** action：pre+post 合并动作 */
function renderAction(e: DirectedEntry, _playerPid: number): string {
  const actor = e.actor_name || displayActorByType(e.actor_type);
  const target = e.target_name || displayTargetByType(e.target_type);
  const actorClass = Number(e.actor_type) === 0 ? 'yellow' : 'red';
  const actionName = e.action_id ?? '未知动作';

  if (actionName === 'unarmed_strike') {
    return (
      `<span class="${actorClass}">${escapeHtml(actor)}</span>` +
      `对<span class="red">${escapeHtml(target)}</span>` +
      `使用了空手攻击，造成 <span class="yellow">${e.effect_value}</span> 点伤害。`
    );
  }

  if (actionName === 'throw') {
    return (
      `<span class="${actorClass}">${escapeHtml(actor)}</span>` +
      `向<span class="red">${escapeHtml(target)}</span>` +
      `发起投掷，造成 <span class="yellow">${e.effect_value}</span> 点伤害。`
    );
  }

  if (actionName === 'idle') {
    const typeId = Number(e.actor_type) || 0;
    const flavor = IDLE_FLAVOR[typeId] || '似乎在发呆';
    return `<span class="${actorClass}">${escapeHtml(actor)}</span>${flavor}。`;
  }

  return `<span class="${actorClass}">${escapeHtml(actor)}</span>使用了${escapeHtml(actionName)}。`;
}


/** initiative：先攻掷骰，不渲染为模态框条目（先攻顺序面板由 BattleModal 单独渲染） */
function renderInitiative(_e: DirectedEntry, _playerPid: number): string {
  return '';
}

/** flee：逃跑 */
function renderFlee(e: DirectedEntry, _playerPid: number): string {
  const actor = e.actor_name || '未知';
  const actorClass = Number(e.actor_type) === 0 ? 'yellow' : 'red';
  return `<span class="${actorClass}">${escapeHtml(actor)}</span>成功逃离了战斗！`;
}

/** combatant_cleared：某人被清出队列（死亡/逃跑） */
function renderCombatantCleared(e: DirectedEntry, _playerPid: number): string {
  const clearedName = e.cleared_name ?? '未知';
  const reason = e.reason ?? 'unknown';
  if (reason === 'death') {
    return `<span class="red">${escapeHtml(clearedName)}</span>被击倒。`;
  }
  if (reason === 'escaped') {
    return `<span class="yellow">${escapeHtml(clearedName)}</span>逃离了战场。`;
  }
  return '';
}

/** battle_end：标准战斗终结，统一显示"战斗结束"（不区分玩家胜负） */
function renderBattleEnd(_e: DirectedEntry, _playerPid: number): string {
  return `<span class="text-fg-dim">═══ 战斗结束 ═══</span>`;
}

/** ambush_battle_end：突袭阶段结束 */
function renderAmbushBattleEnd(e: DirectedEntry, _playerPid: number): string {
  const ambusherName = e.ambusher_name ?? '未知';
  const reason = e.reason ?? '';
  if (reason === 'ambush_killed_all') {
    return `<span class="yellow">═══ 突袭成功，${escapeHtml(ambusherName)} 杀光了所有敌人 ═══</span>`;
  }
  if (reason === 'ambush_dead') {
    return `<span class="red">═══ 突袭失败，${escapeHtml(ambusherName)} 被击倒 ═══</span>`;
  }
  if (reason === 'ambush_escaped') {
    return `<span class="yellow">═══ 突袭结束，${escapeHtml(ambusherName)} 已逃离 ═══</span>`;
  }
  return `<span class="text-fg-dim">═══ 突袭结束 ═══</span>`;
}

/** display：其他纯展示（ap_recover/verify_failed/middle_check 等） */
function renderDisplay(e: DirectedEntry, _playerPid: number): string {
  if (e.phase === 'ap_recover') return '';
  if (e.phase === 'execute_verify_failed') {
    const actor = e.actor_name || '未知';
    const reason = e.reason ?? '';
    if (reason === 'forbid:out_of_range') {
      const range = e.range !== undefined ? `（射程 ${escapeHtml(String(e.range))}）` : '';
      return `<span class="yellow">${escapeHtml(actor)}</span>的目标距离过远，无法攻击${range}。`;
    }
    return `<span class="yellow">${escapeHtml(actor)}</span>的动作校验失败：${escapeHtml(reason)}`;
  }
  if (e.phase === 'middle_check_target_dead') return '';
  return '';
}


function displayActorByType(actorType: number | null): string {
  if (Number(actorType) === 0) return '你';
  return '未知敌人';
}

function displayTargetByType(targetType: number | null): string {
  if (Number(targetType) === 0) return '你';
  if (Number(targetType) > 0) return '未知敌人';
  return '';
}
