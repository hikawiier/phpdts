// ══════════════════════════════════════════════════
// battle_log 渲染模板 / Battle log render templates
//
// 按 action_id 索引，每个模板定义渲染函数。
// 后端只传索引 ID（actor_pid/target_pid/action_id），前端负责渲染文案。
//
// 人称渲染规则：
//   actor_type === 0 → "你"
//   actor_type > 0  → 显示 actor 名称（从 context.npcName 获取）
//
// 迁移自现有 vex/data/battle-templates.js（M6 阶段 1）。
// ══════════════════════════════════════════════════

import { escapeHtml } from '@/utils/format';
import type { BattleLogEntry } from '@/types/api';

/**
 * 战斗播放上下文
 *
 * 由 battleStore.buildPlayContext() 构建，供 BattleModal + battle-templates 共用。
 * 包含双方名称/HP/位置等运行时信息。
 *
 * 兼容字段（enemyName/enemyHp/enemyMaxHp）保留，与原前端 battle-modal.js renderHeader 一致。
 */
export interface BattlePlayContext {
  /** 敌人 PID */
  npcPid: number;
  /** 敌人名称 */
  npcName: string;
  /** 敌人当前 HP */
  npcHp: number;
  /** 敌人最大 HP */
  npcMaxHp: number;
  /** 敌人位置 pls（可选，用于战斗标题） */
  npcLocation: string | number | null;
  /** 玩家当前 HP */
  playerHp: number;
  /** 玩家最大 HP */
  playerMaxHp: number;
  /** 玩家名称 */
  playerName: string;
  // ── 兼容旧字段名（供 battle-modal.js renderHeader 使用） ──
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
}

/** battle_log 渲染模板接口 */
export interface BattleLogTemplate {
  /**
   * 渲染单条 battle_log 为 HTML 字符串
   * @param entry battle_log 条目
   * @param ctx 播放上下文
   * @returns HTML 字符串（空字符串表示该条目不需要渲染）
   */
  render: (entry: BattleLogEntry, ctx: BattlePlayContext) => string;
}

/** action_id → 渲染模板映射 */
export const BATTLE_TEMPLATES: Record<string, BattleLogTemplate> = {
  unarmed_strike: {
    render(entry, ctx) {
      const actor = displayActor(entry, ctx);
      const target = displayTarget(entry, ctx);
      const actorClass = Number(entry.actor_type) === 0 ? 'yellow' : 'red';
      return (
        `<span class="${actorClass}">${escapeHtml(actor)}</span>` +
        `对<span class="red">${escapeHtml(target)}</span>` +
        `使用了空手攻击，造成 <span class="yellow">${entry.effect_value}</span> 点伤害。`
      );
    },
  },
  escape: {
    render(entry, ctx) {
      const actor = displayActor(entry, ctx);
      const actorClass = Number(entry.actor_type) === 0 ? 'yellow' : 'red';
      return (
        `<span class="${actorClass}">${escapeHtml(actor)}</span>` +
        `尝试逃跑。`
      );
    },
  },
  flee: {
    render(entry, ctx) {
      const actor = displayActor(entry, ctx);
      const actorClass = Number(entry.actor_type) === 0 ? 'yellow' : 'red';
      return (
        `<span class="${actorClass}">${escapeHtml(actor)}</span>` +
        `成功逃离了战斗！`
      );
    },
  },
  battle_end: {
    render(entry, ctx) {
      if (Number(entry.actor_type) !== 0) {
        // NPC 被清除 → 玩家胜利
        return `<span class="yellow">═══ 战斗胜利！你击败了 ${escapeHtml(ctx.npcName)} ═══</span>`;
      }
      return `<span class="text-fg-dim">═══ 战斗结束 ═══</span>`;
    },
  },
  ap_recover: {
    // AP 恢复：轻量提示，不渲染为模态框条目
    render() {
      return '';
    },
  },
  'initiative.roll': {
    // 先攻掷骰：不渲染为模态框条目（投掷结果保留在 entry.extra.rolls 供 debug 或未来扩展使用）
    render() {
      return '';
    },
  },
  queue_create: {
    render() {
      return '';
    },
  },
  queue_update: {
    render() {
      return '';
    },
  },
};

/**
 * 显示攻击方人称
 *
 * actor_type === 0 → "你"
 * actor_type > 0  → ctx.npcName（兜底"未知敌人"）
 */
function displayActor(entry: BattleLogEntry, ctx: BattlePlayContext): string {
  if (Number(entry.actor_type) === 0) return '你';
  return ctx.npcName || '未知敌人';
}

/**
 * 显示受击方人称
 *
 * target_type === 0 → "你"
 * target_type > 0  → ctx.npcName（兜底"未知敌人"）
 */
function displayTarget(entry: BattleLogEntry, ctx: BattlePlayContext): string {
  if (Number(entry.target_type) === 0) return '你';
  if (Number(entry.target_type) > 0) return ctx.npcName || '未知敌人';
  return '';
}

/**
 * 渲染单条 battle_log 条目为 HTML
 *
 * 迁移自现有 vex/data/battle-templates.js renderBattleLogEntryHtml()。
 *
 * @param entry battle_log 条目
 * @param context 播放上下文 { npcName, npcLocation, ... }
 * @returns HTML 字符串（空字符串表示该条目不需要渲染）
 */
export function renderBattleLogEntryHtml(
  entry: BattleLogEntry,
  context: BattlePlayContext | null | undefined,
): string {
  const ctx: BattlePlayContext = context || {
    npcPid: 0,
    npcName: '未知敌人',
    npcHp: 0,
    npcMaxHp: 1,
    npcLocation: null,
    playerHp: 0,
    playerMaxHp: 1,
    playerName: '',
    enemyName: '未知敌人',
    enemyHp: 0,
    enemyMaxHp: 1,
  };

  const template = BATTLE_TEMPLATES[entry.action_id];
  if (template && template.render) {
    return template.render(entry, ctx);
  }

  // 默认模板
  const actor = displayActor(entry, ctx);
  const actorClass = Number(entry.actor_type) === 0 ? 'yellow' : 'red';
  return (
    `<span class="${actorClass}">${escapeHtml(actor)}</span>` +
    `使用了${escapeHtml(entry.action_id)}。`
  );
}
