// ══════════════════════════════════════════════════
// battle_log 渲染模板 / Battle log render templates
//
// 按 action_id 索引，每个模板定义渲染函数。
// 后端只传索引 ID（actor_pid/target_pid/action_id），前端负责渲染文案。
//
// 人称渲染规则：
//   actor_type === 0 → "你"
//   actor_type > 0  → 显示 actor 名称（从 context.npcName 获取）
// ══════════════════════════════════════════════════

import { escapeHtml } from '../js/utils.js';

const BATTLE_TEMPLATES = {
    'unarmed_strike': {
        render(entry, ctx) {
            const actor = displayActor(entry, ctx);
            const target = displayTarget(entry, ctx);
            const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>对<span class="red">${escapeHtml(target)}</span>使用了空手攻击，造成 <span class="yellow">${entry.effect_value}</span> 点伤害。`;
        }
    },
    'escape': {
        render(entry, ctx) {
            const actor = displayActor(entry, ctx);
            const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';
            const success = entry.extra && entry.extra.success;
            if (success) {
                return `<span class="${actorClass}">${escapeHtml(actor)}</span>尝试逃跑，<span class="yellow">成功了！</span>`;
            }
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>尝试逃跑，但<span class="red">失败了</span>。`;
        }
    },
    'battle_end': {
        render(entry, ctx) {
            if (entry.actor_type !== 0) {
                // NPC 被清除 → 玩家胜利
                return `<span class="yellow">═══ 战斗胜利！你击败了 ${escapeHtml(ctx.npcName)} ═══</span>`;
            }
            return `<span class="text-fg-dim">═══ 战斗结束 ═══</span>`;
        }
    },
    'ap_recover': {
        render(entry, ctx) {
            // AP 恢复：轻量提示，不渲染为模态框条目
            return '';
        }
    },
    'queue_create': {
        render(entry, ctx) {
            return '';
        }
    },
    'queue_update': {
        render(entry, ctx) {
            return '';
        }
    },
};

function displayActor(entry, ctx) {
    if (entry.actor_type === 0) return '你';
    return ctx.npcName || '未知敌人';
}

function displayTarget(entry, ctx) {
    if (entry.target_type === 0) return '你';
    if (entry.target_type > 0) return ctx.npcName || '未知敌人';
    return '';
}

/**
 * 渲染单条 battle_log 条目为 HTML
 *
 * @param {Object} entry battle_log 条目（新结构）
 * @param {Object} context 播放上下文 { npcName, npcLocation, ... }
 * @returns {string} HTML 字符串（空字符串表示该条目不需要渲染）
 */
export function renderBattleLogEntryHtml(entry, context) {
    const template = BATTLE_TEMPLATES[entry.action_id];
    if (template && template.render) {
        return template.render(entry, context || {});
    }
    // 默认模板
    const actor = displayActor(entry, context || {});
    const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';
    return `<span class="${actorClass}">${escapeHtml(actor)}</span>使用了${escapeHtml(entry.action_id)}。`;
}

export { BATTLE_TEMPLATES };
