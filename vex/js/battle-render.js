// ══════════════════════════════════════════════════
// 战斗日志渲染 / Battle log rendering
//
// 将后端返回的 BattleLogEntry 数组渲染为文字列表，
// 并渲染战斗动作按钮。后端只传数据，前端完全控制视觉呈现。
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
 * 渲染单条 BattleLogEntry 为 HTML
 *
 * @param {Object} entry 战斗日志条目
 * @param {string} enemyName 敌人名称
 * @returns {string} HTML 字符串
 */
function renderBattleEntry(entry, enemyName) {
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
 * 渲染战斗日志列表到 DOM
 *
 * @param {Array} entries BattleLogEntry 数组
 * @param {string} enemyName 敌人名称
 */
export function renderBattleLog(entries, enemyName) {
    const el = document.getElementById('battleLogContent');
    if (!el) return;

    if (!entries || entries.length === 0) {
        el.innerHTML = '<div class="text-fg-dim">等待战斗开始...</div>';
        return;
    }

    // 按 turn 值排序，确保显示顺序正确
    // （battle_log 生成时已标记 turn 值，追加持久化可能导致数组顺序与 turn 顺序不一致）
    const sorted = entries.slice().sort((a, b) => (a.turn || 0) - (b.turn || 0));

    // 按先攻轮分组渲染
    let html = '';
    let currentTurn = -1;
    for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        // 先攻轮分隔符
        if (entry.turn !== currentTurn) {
            currentTurn = entry.turn;
            html += `<div class="text-fg-dim text-[10px] py-0.5">── 回合 ${currentTurn} ──</div>`;
        }
        html += `<div>${renderBattleEntry(entry, enemyName)}</div>`;
    }
    el.innerHTML = html;

    // 自动滚动到底部
    el.parentElement.scrollTop = el.parentElement.scrollHeight;
}

/**
 * 渲染战斗动作按钮
 *
 * - prebattle 模式：空手攻击（开始战斗）+ 取消战斗（无条件退出 prebattle）
 * - battle 模式：空手攻击 + 逃跑（50% 概率逃离战斗）
 *
 * @param {string} mode 战斗模式（'prebattle' 或 'battle'）
 * @param {Function} onAction 动作回调，接收 action_id 参数
 * @param {Function} [onCancel] 取消战斗回调（仅 prebattle 模式使用）
 */
export function renderBattleActions(mode, onAction, onCancel) {
    const el = document.getElementById('battleActionBar');
    if (!el) return;

    const actions = [
        { id: 'unarmed_strike', name: '空手攻击', desc: '徒手攻击敌人' },
    ];
    // battle 模式额外显示逃跑
    if (mode === 'battle') {
        actions.push({ id: 'escape', name: '逃跑', desc: '50% 概率逃离战斗' });
    }

    let html = '';
    if (mode === 'prebattle') {
        html += '<div class="text-fg-dim text-[10px] py-1 mb-2">战斗准备：选择动作开始战斗</div>';
    }
    for (let i = 0; i < actions.length; i++) {
        const act = actions[i];
        html += `<button class="action-btn w-full text-left px-2 py-1.5 mb-1 border border-fg-dim/30 hover:border-hi hover:bg-fg-dim/10 transition-colors cursor-pointer" data-action-id="${act.id}">`
            + `<span class="text-hi">[${escapeHtml(act.name)}]</span>`
            + `<span class="text-fg-dim text-[10px] ml-2">${escapeHtml(act.desc)}</span>`
            + `</button>`;
    }

    // prebattle 模式下追加"取消战斗"按钮（无条件退出，区别于 battle 中的"逃跑"）
    if (mode === 'prebattle') {
        html += `<button class="action-btn w-full text-left px-2 py-1.5 mb-1 border border-fg-dim/30 hover:border-hi hover:bg-fg-dim/10 transition-colors cursor-pointer" id="battleCancelBtn">`
            + `<span class="text-fg-dim">[取消战斗]</span>`
            + `<span class="text-fg-dim text-[10px] ml-2">无条件退出战斗准备</span>`
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

    // 绑定取消战斗按钮（仅 prebattle）
    if (mode === 'prebattle') {
        const cancelBtn = document.getElementById('battleCancelBtn');
        if (cancelBtn && onCancel) {
            cancelBtn.addEventListener('click', onCancel);
        }
    }
}

/**
 * 渲染战斗结束界面（继续按钮）
 *
 * 战斗结束后，显示"继续探索"按钮，玩家点击后退出战斗模式。
 * 让玩家有机会看到最后的战斗日志（含 battle.end 条目）。
 *
 * @param {Function} onContinue 继续回调（点击后退出战斗模式）
 */
export function renderBattleEndActions(onContinue) {
    const el = document.getElementById('battleActionBar');
    if (!el) return;

    el.innerHTML = '<div class="text-fg-dim text-[10px] py-1 mb-2">战斗已结束</div>'
        + `<button class="action-btn w-full text-left px-2 py-1.5 mb-1 border border-hi/50 hover:bg-hi/10 transition-colors cursor-pointer" id="battleContinueBtn">`
        + `<span class="text-hi">[继续探索]</span>`
        + `<span class="text-fg-dim text-[10px] ml-2">离开战斗界面，返回探索</span>`
        + `</button>`;

    const btn = document.getElementById('battleContinueBtn');
    if (btn && onContinue) {
        btn.addEventListener('click', onContinue);
    }
}

/**
 * 显示战斗模式切换提示
 *
 * @param {string} mode 战斗模式
 * @param {string} enemyName 敌人名称
 */
export function renderBattleHeader(mode, enemyName) {
    const el = document.getElementById('battleActionBar');
    if (!el) return;

    // 在动作按钮区上方显示战斗信息（通过前置插入）
    // 实际渲染由 renderBattleActions 处理，这里只做辅助
}
