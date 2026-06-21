// ══════════════════════════════════════════════════
// 战斗渲染 / Battle rendering
//
// 职责：
// - 渲染战斗动作按钮（battle 模式）
// - 渲染战斗模式标题（敌人名称+位置）
//
// 注意：battle_log 条目渲染已委托给 vex/data/battle-templates.js
// ══════════════════════════════════════════════════

import { escapeHtml } from './utils.js';

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
 * 渲染战斗模式标题（敌人名称+位置）
 *
 * @param {string} enemyName 敌人名称
 * @param {number|string} [npcLocation] 敌人位置 pls（可选）
 */
export function renderBattleHeader(enemyName, npcLocation) {
    const el = document.getElementById('battleEnemyName');
    if (el) {
        if (enemyName) {
            const locText = npcLocation ? `位于(${npcLocation})的` : '';
            el.textContent = 'vs ' + locText + enemyName;
        } else {
            el.textContent = '';
        }
    }
}
