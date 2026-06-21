// ══════════════════════════════════════════════════
// 战斗渲染 / Battle rendering
//
// 职责：
// - 将 BattleLogEntry 渲染为 HTML（供模态框使用）
// - 渲染战斗动作按钮（battle 模式）
//
// 人称渲染规则（后端只传 actor_name + actor_type，前端负责展示）：
// - actor_type=0 且 actor_name===playerName → 显示"你"
// - 否则一律显示 actor_name
//
// 注意：实时日志区已移除，battlelog 通过模态框播放。
// ══════════════════════════════════════════════════

import { escapeHtml } from './utils.js';

/**
 * 渲染单条 BattleLogEntry 为 HTML（供模态框使用）
 *
 * @param {Object} entry 战斗日志条目
 * @param {Object} context 播放上下文 { playerName, enemyName, ... }
 * @returns {string} HTML 字符串（空字符串表示该条目不需要渲染）
 */
export function renderBattleLogEntryHtml(entry, context) {
    const ctx = context || {};
    const playerName = ctx.playerName || '';
    const enemyName = ctx.enemyName || 'renderBattleLogEntryHtml里的敌人';

    // actor 人称渲染：actor_type=0 且 actor_name=玩家名 → "你"，否则显示 actor_name
    function displayActor(e) {
        if (e.actor_type === 0 && e.actor_name === playerName) return '你';
        return e.actor_name || '未知';
    }

    // target 显示（后端暂未加 target_name，用旧逻辑推断）
    function displayTarget(e) {
        if (e.target === 'player') return '你';
        if (e.target && e.target.indexOf('enemy_') === 0) return enemyName;
        return e.target || '';
    }

    const actor = displayActor(entry);
    const target = displayTarget(entry);
    const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';

    switch (entry.action_id) {
        case 'battle_end': {
            // 战斗结束事件，不作为"动作"渲染
            // excute 阶段的 battle_end：actor 是被清除方
            // actor_type != 0（敌人被清除）→ 玩家胜利
            if (entry.actor_type !== 0) {
                return `<span class="yellow">═══ 战斗胜利！你击败了 ${escapeHtml(enemyName)} ═══</span>`;
            }
            // actor_type == 0（玩家方战斗结束）
            return `<span class="text-fg-dim">═══ 战斗结束 ═══</span>`;
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

        // 系统事件（ap_recover / queue_create / queue_update / verify 阶段日志）
        // 这些不在 excute 阶段播放，但以防万一返回空字符串
        case 'ap_recover':
        case 'queue_create':
        case 'queue_update':
            return '';

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
