// ══════════════════════════════════════════════════
// 战斗渲染 / Battle rendering
//
// 职责：
// - 将 BattleLogEntry 渲染为 HTML（供模态框使用）
// - 渲染战斗动作按钮（battle 模式）
//
// 注意：实时日志区已移除，battlelog 通过模态框播放。
// ══════════════════════════════════════════════════

import { escapeHtml } from './utils.js';

/**
 * 将 actor/target 标识转换为显示名称
 *
 * @param {string} id  标识（'player' 或 'enemy_{pid}'）
 * @param {string} enemyName 敌人名称（用于替换 'enemy_{pid}'）
 * @returns {string} 显示名称
 */
function actorDisplayName(id, enemyName) {
    if (id === 'player') return '你';
    if (id.indexOf('enemy_') === 0) return enemyName || '敌人';
    return id;
}

/**
 * 渲染单条 BattleLogEntry 为 HTML（供模态框使用）
 *
 * @param {Object} entry 战斗日志条目
 * @param {string} enemyName 敌人名称
 * @returns {string} HTML 字符串
 */
export function renderBattleLogEntryHtml(entry, enemyName) {
    const actor = actorDisplayName(entry.actor, enemyName);
    const target = actorDisplayName(entry.target, enemyName);
    const actorClass = entry.actor === 'player' ? 'yellow' : 'red';

    switch (entry.action_id) {
        case 'battle.start': {
            // 战斗开始提示：根据 initiator 显示不同文案
            const initiator = entry.extra && entry.extra.initiator;
            if (initiator === 'enemy') {
                // 遭遇战：NPC 移动到玩家格触发
                return `你遭遇了<span class="red">${escapeHtml(actor)}</span>！战斗开始！`;
            }
            // 玩家主动攻击
            return `你向<span class="red">${escapeHtml(target)}</span>发起了攻击！`;
        }

        case 'initiative.roll': {
            // 先攻判定：entry.target 直接是第一顺位者的名字（非标识符）
            const firstName = entry.target || '';
            const extra = entry.extra || {};
            const playerRoll = extra.player_roll !== undefined ? extra.player_roll : '?';
            const enemyRoll = extra.enemy_roll !== undefined ? extra.enemy_roll : '?';
            return `<span class="text-fg-dim">先攻判定（你 ${playerRoll} vs 敌 ${enemyRoll}）：</span><span class="yellow">${escapeHtml(firstName)}</span> 抢得先机！`;
        }

        case 'battle.end': {
            // 战斗结束：entry.target 是结果标识（victory/defeat/escape）
            const result = entry.target || '';
            const extra = entry.extra || {};
            const resultName = extra.result_name || result;
            if (result === 'victory') {
                return `<span class="yellow">═══ 战斗胜利！你击败了敌人 ═══</span>`;
            }
            if (result === 'defeat') {
                return `<span class="red">═══ 战斗失败...你被击败了 ═══</span>`;
            }
            if (result === 'escape') {
                return `<span class="text-fg-dim">═══ 你成功逃离了战斗 ═══</span>`;
            }
            return `<span class="text-fg-dim">═══ 战斗结束（${escapeHtml(resultName)}）═══</span>`;
        }

        case 'unarmed_strike':
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>对<span class="red">${escapeHtml(target)}</span>使用了${escapeHtml(entry.action_name)}，造成 <span class="yellow">${entry.effect_value}</span> 点伤害。`;

        case 'escape': {
            const success = entry.extra && entry.extra.success;
            if (success) {
                return `<span class="${actorClass}">${escapeHtml(actor)}</span>尝试逃跑，<span class="yellow">成功了！</span>`;
            }
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>尝试逃跑，但<span class="red">失败了</span>。`;
        }

        default:
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>使用了${escapeHtml(entry.action_name)}。`;
    }
}

/**
 * 渲染战斗动作按钮
 *
 * battle 模式：空手攻击 + 逃跑（50% 概率逃离战斗）
 *
 * @param {Function} onAction 动作回调，接收 action_id 参数
 */
export function renderBattleActions(onAction) {
    const el = document.getElementById('battleActionBar');
    if (!el) return;

    const actions = [
        { id: 'unarmed_strike', name: '空手攻击', desc: '徒手攻击敌人' },
        { id: 'escape', name: '逃跑', desc: '50% 概率逃离战斗' },
    ];

    let html = '';
    for (let i = 0; i < actions.length; i++) {
        const act = actions[i];
        html += `<button class="action-btn turn-active w-full text-left px-2 py-1.5 mb-1 border border-fg-dim/30 hover:border-hi hover:bg-fg-dim/10 transition-colors cursor-pointer" data-action-id="${act.id}">`
            + `<span class="text-hi">[${escapeHtml(act.name)}]</span>`
            + `<span class="text-fg-dim text-[10px] ml-2">${escapeHtml(act.desc)}</span>`
            + `</button>`;
    }

    el.innerHTML = html;

    // 绑定动作按钮点击事件
    const buttons = el.querySelectorAll('button[data-action-id]');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener('click', function() {
            const actionId = this.getAttribute('data-action-id');
            if (onAction) onAction(actionId);
        });
    }
}

/**
 * 渲染等待提示（NPC 行动中）
 */
export function renderBattleWaiting() {
    const el = document.getElementById('battleActionBar');
    if (!el) return;
    el.innerHTML = '<div class="text-fg-dim text-[10px] py-2 text-center">敌人正在行动...</div>';
}

/**
 * 渲染战斗模式标题（敌人名称）
 *
 * @param {string} enemyName 敌人名称
 */
export function renderBattleHeader(enemyName) {
    const el = document.getElementById('battleEnemyName');
    if (el) {
        el.textContent = enemyName ? 'vs ' + enemyName : '';
    }
}
