// ══════════════════════════════════════════════════
// 装填区模块 / Battle preload area module
//
// 职责：
// - 拉取 skill_list API，渲染技能列表（右上半区）
// - 管理装填队列，渲染 AP + 队列 + 执行按钮（右下半区）
// - 处理瞄准模式（target=enemy 技能需选择目标）
// - 提交动作队列到后端（obl_battle_start 或 obl_battle_action）
//
// 两种模式：
// - 'pre-battle'：玩家点击敌人后、战斗开始前。执行 → obl_battle_start
// - 'in-battle'：战斗中玩家回合。执行 → obl_battle_action
// ══════════════════════════════════════════════════

import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';
import { getSkillTemplate } from '../data/skill-templates.js';
import { escapeHtml } from './utils.js';
import { mapData } from './data.js';

// 模块状态
const state = {
    mode: '',               // 'pre-battle' | 'in-battle' | ''
    skills: [],             // skill_list API 返回的技能数组
    playerAp: 0,
    playerMaxAp: 0,
    queue: [],              // 装填队列：[{act_id, target}]
    aimMode: false,         // 是否处于瞄准模式
    pendingActId: null,     // 等待选择目标的技能 ID
    enemyPid: 0,            // 当前敌人 PID
    playerPid: 0,           // 当前玩家 PID（用于 self 目标）
};

/**
 * 初始化装填区
 *
 * 由 battle.js 在进入战斗模式或玩家回合时调用。
 * 拉取 skill_list API，渲染技能列表和装填区。
 *
 * @param {string} mode      'pre-battle'（战斗前预装填）| 'in-battle'（战斗中玩家回合）
 * @param {number} enemyPid  敌人 PID（用于 enemy 目标默认值）
 * @param {number} playerPid 玩家 PID（用于 self 目标）
 */
export async function initPreloadArea(mode, enemyPid, playerPid) {
    state.mode = mode;
    state.enemyPid = enemyPid || 0;
    state.playerPid = playerPid || 0;
    state.queue = [];
    state.aimMode = false;
    state.pendingActId = null;

    await fetchSkillList();
    renderAll();
}

/**
 * 拉取 skill_list API
 */
async function fetchSkillList() {
    try {
        const result = await dataManager.fetch('skill_list', true);
        if (result.status === 'success' && result.data) {
            state.skills = result.data.skills || [];
            state.playerAp = result.data.player_ap || 0;
            state.playerMaxAp = result.data.player_max_ap || 0;
        } else {
            state.skills = [];
            state.playerAp = 0;
            state.playerMaxAp = 0;
        }
    } catch (e) {
        console.error('[Preload] fetchSkillList error:', e);
        state.skills = [];
        state.playerAp = 0;
        state.playerMaxAp = 0;
    }
}

/**
 * 渲染整个装填区（技能列表 + 队列区）
 */
function renderAll() {
    const container = document.getElementById('battleActionBar');
    if (!container) return;

    // 构建装填区 DOM 结构
    // 上半区（技能列表）动态高度：内容少则按内容，多则上限 60% 滚动
    // 下半区（AP+队列）贴底显示：mt-auto 推到底部
    container.innerHTML = ''
        + '<div class="flex flex-col h-full min-h-0">'
        +   '<div id="preloadSkillList" class="overflow-y-auto min-h-0 max-h-[60%]"></div>'
        +   '<div id="preloadQueueArea" class="mt-auto border-t border-fg-dim/20 pt-2 overflow-y-auto min-h-0"></div>'
        + '</div>';

    renderSkillList();
    renderQueueArea();
}

/**
 * 渲染技能列表（右上半区）
 */
function renderSkillList() {
    const el = document.getElementById('preloadSkillList');
    if (!el) return;

    if (state.skills.length === 0) {
        el.innerHTML = '<div class="text-fg-dim text-[10px] py-2 text-center">无可用技能</div>';
        return;
    }

    let html = '';
    for (const skill of state.skills) {
        const tpl = getSkillTemplate(skill.act_id);
        const apText = skill.apcost > 0 ? ` AP:${skill.apcost}` : '';
        const cdText = skill.on_cd ? ` CD:${Math.max(0, skill.cd - (skill.current_tick - skill.lstact))}t` : (skill.cd > 0 ? ` CD:${skill.cd}t` : '');
        const disabled = !skill.available;
        const cls = disabled
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:border-fg-mid hover:bg-fg-dim/10 cursor-pointer turn-active';

        html += '<button class="obl-btn w-full text-left px-2 py-1.5 mb-1 transition-colors ' + cls + '"'
            + ' data-skill-id="' + escapeHtml(skill.act_id) + '"'
            + (disabled ? ' disabled' : '')
            + '>'
            + '<span class="text-fg-bright font-bold">[' + escapeHtml(tpl.name) + ']</span>'
            + '<span class="text-fg-dim text-[10px] ml-2">' + escapeHtml(tpl.desc) + '</span>'
            + '<span class="text-fg-dim text-[10px] ml-2">' + apText + cdText + '</span>'
            + '</button>';
    }

    el.innerHTML = html;

    // 绑定点击事件
    const buttons = el.querySelectorAll('button[data-skill-id]');
    for (const btn of buttons) {
        btn.addEventListener('click', function() {
            onSkillClick(this.getAttribute('data-skill-id'));
        });
    }
}

/**
 * 渲染队列区（右下半区：AP + 队列 + 执行按钮）
 */
function renderQueueArea() {
    const el = document.getElementById('preloadQueueArea');
    if (!el) return;

    let html = '';

    // AP 显示 — 进度条式预测扣除
    // 计算：当前 AP、队列累计消耗、预测剩余
    const queueCost = state.queue.reduce((sum, item) => {
        const skill = state.skills.find(s => s.act_id === item.act_id);
        return sum + (skill ? (skill.apcost || 0) : 0);
    }, 0);
    const predictedAp = Math.max(0, state.playerAp - queueCost);
    const maxAp = state.playerMaxAp > 0 ? state.playerMaxAp : 1;
    // 进度条比例：当前 AP 占比、预测扣除段占比
    const currentRatio = (state.playerAp / maxAp) * 100;
    const costRatio = (queueCost / maxAp) * 100;
    const remainingRatio = Math.max(0, currentRatio - costRatio);

    html += '<div class="mb-2">';
    // 数值行
    html += '<div class="flex items-center justify-between mb-1 px-1">';
    html += '<span class="text-fg-bright text-[12px] font-bold tracking-wider">AP</span>';
    if (queueCost > 0) {
        html += '<span class="text-fg-bright text-[13px] font-bold">' + state.playerAp + ' → ' + predictedAp + ' <span class="text-red text-[10px]">(-' + queueCost + ')</span></span>';
    } else {
        html += '<span class="text-fg-bright text-[13px] font-bold">' + state.playerAp + ' / ' + state.playerMaxAp + '</span>';
    }
    html += '</div>';
    // 进度条
    html += '<div class="bar-container ap-bar-container">';
    // 预测剩余段（亮色）：从左开始
    html += '<div class="bar-fill ap-remaining" style="width:' + remainingRatio + '%"></div>';
    // 预测扣除段（警告色）：从剩余段右边缘开始
    if (costRatio > 0) {
        html += '<div class="bar-fill ap-cost" style="left:' + remainingRatio + '%; width:' + Math.min(costRatio, currentRatio) + '%"></div>';
    }
    html += '</div>';
    html += '</div>';

    // 队列标签
    html += '<div class="text-fg-mid text-[11px] mb-1 px-1">装填队列 (' + state.queue.length + ')</div>';

    // 队列项
    if (state.queue.length === 0) {
        html += '<div class="text-fg-dim text-[11px] py-2 text-center border border-dashed border-fg-dim/30">点击上方技能加入队列</div>';
    } else {
        for (let i = 0; i < state.queue.length; i++) {
            const item = state.queue[i];
            const tpl = getSkillTemplate(item.act_id);
            const targetText = getTargetDisplayText(item.target);
            html += '<div class="obl-btn flex items-center justify-between px-2 py-1.5 mb-1">'
                + '<span class="text-fg-mid text-[11px]">[' + escapeHtml(tpl.name) + '] → ' + escapeHtml(targetText) + '</span>'
                + '<button class="text-fg-dim hover:text-red text-[11px] px-1 transition-colors" data-queue-index="' + i + '">[x]</button>'
                + '</div>';
        }
    }

    // 操作按钮
    html += '<div class="flex gap-1 mt-2">';
    if (state.queue.length > 0) {
        html += '<button id="preloadExecuteBtn" class="obl-btn turn-active flex-1 px-2 py-2 hover:border-fg-mid hover:bg-fg-dim/10 transition-colors cursor-pointer">'
            + '<span class="text-fg-bright font-bold">[执行]</span>'
            + '</button>';
        html += '<button id="preloadClearBtn" class="obl-btn flex-none px-2 py-2 hover:border-red hover:text-red transition-colors cursor-pointer">'
            + '<span class="text-fg-mid text-[11px]">[清空]</span>'
            + '</button>';
    }
    html += '</div>';

    el.innerHTML = html;

    // 绑定队列移除按钮
    const removeBtns = el.querySelectorAll('button[data-queue-index]');
    for (const btn of removeBtns) {
        btn.addEventListener('click', function() {
            removeFromQueue(parseInt(this.getAttribute('data-queue-index')));
        });
    }

    // 绑定执行按钮
    const execBtn = el.querySelector('#preloadExecuteBtn');
    if (execBtn) execBtn.addEventListener('click', onExecute);

    // 绑定清空按钮
    const clearBtn = el.querySelector('#preloadClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearQueue);
}

/**
 * 技能点击处理
 */
function onSkillClick(actId) {
    const skill = state.skills.find(s => s.act_id === actId);
    if (!skill || !skill.available) return;

    // 瞄准模式下再次点击同一技能 → 退出瞄准（toggle）
    if (state.aimMode && state.pendingActId === actId) {
        exitAimMode();
        return;
    }

    if (skill.target === 'self') {
        // self 目标：直接加入队列，target 为玩家自己的 PID
        addToQueue(actId, state.playerPid);
    } else {
        // enemy 目标：MVP 单敌人战斗，直接使用当前敌人 PID
        // 未来多敌人时可启用瞄准模式：enterAimMode(actId)
        if (state.enemyPid > 0) {
            addToQueue(actId, state.enemyPid);
        } else {
            enterAimMode(actId);
        }
    }
}

/**
 * 进入瞄准模式
 */
function enterAimMode(actId) {
    state.aimMode = true;
    state.pendingActId = actId;
    dataManager.broadcast('battle:aim-mode', { actId });
}

/**
 * 退出瞄准模式
 */
export function exitAimMode() {
    state.aimMode = false;
    state.pendingActId = null;
    dataManager.broadcast('battle:aim-exit');
}

/**
 * 瞄准模式下选择目标（供 map-interaction.js 调用）
 */
export function onTargetSelect(targetPid) {
    if (!state.aimMode || !state.pendingActId) return;
    addToQueue(state.pendingActId, targetPid);
    exitAimMode();
}

/**
 * 根据 PID 查询目标显示文本
 *
 * 从 mapData.enemies 中查找敌人信息，渲染为「位于位置X的 敌人名」。
 * 玩家自身 PID → 「自己」；未找到 → 「目标{pid}」兜底。
 *
 * @param {number} targetPid 目标 PID
 * @returns {string} 显示文本
 */
function getTargetDisplayText(targetPid) {
    const pid = parseInt(targetPid);
    if (pid === parseInt(state.playerPid)) return '自己';

    const enemy = mapData.enemies.find(e => parseInt(e.pid) === pid && parseInt(e.state) === 0);
    if (enemy) {
        return '位于位置' + enemy.pls + '的 ' + enemy.name;
    }
    return '目标' + pid;
}

/**
 * 加入队列
 */
function addToQueue(actId, targetPid) {
    state.queue.push({ act_id: actId, target: targetPid });
    renderQueueArea();
}

/**
 * 从队列移除
 */
function removeFromQueue(index) {
    if (index < 0 || index >= state.queue.length) return;
    state.queue.splice(index, 1);
    renderQueueArea();
}

/**
 * 清空队列
 */
function clearQueue() {
    state.queue = [];
    renderQueueArea();
}

/**
 * 执行装填队列
 *
 * 根据 mode 提交不同命令：
 * - 'pre-battle' → obl_battle_start（带 enemy_pid + actions）
 * - 'in-battle'  → obl_battle_action（带 actions）
 *
 * 返回结果给 battle.js 处理后续刷新
 */
async function onExecute() {
    if (state.queue.length === 0) return;
    if (commandQueue.isLocked) return;

    const actions = state.queue.slice();

    let result;
    if (state.mode === 'pre-battle') {
        result = await commandQueue.execute({
            command: 'obl_battle_start',
            enemy_pid: state.enemyPid,
            actions: JSON.stringify(actions),
        });
    } else {
        result = await commandQueue.execute({
            command: 'obl_battle_action',
            action_id: actions[0].act_id,
            target_pid: actions[0].target,
            actions: JSON.stringify(actions),
        });
    }

    // 清空队列和瞄准状态
    state.queue = [];
    state.mode = '';
    if (state.aimMode) {
        exitAimMode();
    }
    renderQueueArea();

    // 广播执行完成事件，battle.js 监听后刷新
    dataManager.broadcast('preload:executed', { result });
}
