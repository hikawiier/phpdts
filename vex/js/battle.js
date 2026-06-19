// ══════════════════════════════════════════════════
// 战斗状态机 / Battle state machine
//
// 检测 player_info.action 变化，进入/退出战斗模式：
// - action='prebattle' → prebattle 模式（显示动作按钮，等待玩家选择）
// - action='battle'    → battle 模式（拉取 battle_log，播放）
//   - 检查 oblpara.battle.queue 判断玩家是否当前顺位：
//     - 玩家顺位 → 显示动作按钮
//     - 敌人顺位 → 显示"敌人正在行动..."等待提示
// - action=''          → 退出战斗模式，恢复 normalMode
//
// 战斗模式下右侧 CHRONICLE + ACTIONS 替换为 COMBAT LOG + ACTIONS。
// 战斗日志通过 api_v2.php?action=battle_log 拉取（待播放队列）。
// ══════════════════════════════════════════════════

import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';
import { renderBattleLog, renderBattleActions, renderBattleEndActions } from './battle-render.js';

// 战斗状态
let currentMode = 'normal';   // 'normal' | 'prebattle' | 'battle' | 'ended'
let currentBid = 0;           // 当前战斗对象 PID
let currentEnemyName = '';    // 当前战斗对象名称

/**
 * 刷新战斗状态：检测 action 变化，进入/退出战斗模式
 *
 * 在 app.js 的 refreshAll 中调用。
 */
export async function refreshBattle() {
    try {
        const result = await dataManager.fetch('player_info', true);
        if (result.status !== 'success' || !result.data) return;

        const action = result.data.action || '';
        const bid = parseInt(result.data.bid) || 0;
        const oblpara = result.data.oblpara || {};
        const battleState = oblpara.battle || null;

        if (action === 'prebattle') {
            await enterPrebattleMode(bid);
        } else if (action === 'battle') {
            // 检查先攻队列，判断玩家是否当前顺位
            const isPlayerTurn = checkPlayerTurn(battleState, bid);
            await enterBattleMode(bid, isPlayerTurn);
        } else {
            // action='' 战斗已结束
            // 若当前仍在战斗界面，先拉取最后的 battle_log 显示，再展示继续按钮
            if (currentMode !== 'normal' && currentMode !== 'ended') {
                await enterBattleEndMode();
            } else if (currentMode === 'ended') {
                // 已在结束态，保持等待玩家点击继续
            } else {
                exitBattleMode();
            }
        }
    } catch (e) {
        console.error('[Battle] refreshBattle error:', e);
    }
}

/**
 * 检查玩家是否当前顺位
 *
 * 先攻队列中第一个 done=0 的是当前顺位者。
 * 由于队列里只有玩家和敌人两个 pid，敌人的 pid 就是 bid，
 * 所以第一个 done=0 的 pid 若等于 bid 则是敌人顺位，否则是玩家顺位。
 *
 * @param {Object|null} battleState oblpara.battle
 * @param {number} enemyPid 敌人 PID（bid）
 * @returns {boolean} true=玩家当前顺位，false=敌人当前顺位
 */
function checkPlayerTurn(battleState, enemyPid) {
    if (!battleState || !Array.isArray(battleState.queue)) return true;
    for (let i = 0; i < battleState.queue.length; i++) {
        if (battleState.queue[i].done == 0) {
            return parseInt(battleState.queue[i].pid) !== parseInt(enemyPid);
        }
    }
    return true;  // 所有人都完成了，默认显示（后端会重新判定）
}

/**
 * 进入 prebattle 模式
 *
 * @param {number} bid 敌人 PID
 */
async function enterPrebattleMode(bid) {
    // 已在 prebattle 模式且 bid 未变，无需重复渲染
    if (currentMode === 'prebattle' && currentBid === bid) return;

    currentMode = 'prebattle';
    currentBid = bid;

    // 获取敌人名称
    await fetchEnemyName(bid);

    // 切换 DOM
    showBattleMode();

    // 渲染空战斗日志（prebattle 阶段无动作日志）
    renderBattleLog([], currentEnemyName);

    // 渲染动作按钮：空手攻击（开始战斗）+ 取消战斗（无条件退出）
    renderBattleActions('prebattle', onBattleAction, cancelBattle);
}

/**
 * 进入 battle 模式
 *
 * @param {number} bid 敌人 PID
 * @param {boolean} isPlayerTurn 玩家是否当前顺位（true=显示动作按钮，false=显示等待提示）
 */
async function enterBattleMode(bid, isPlayerTurn) {
    // 已在 battle 模式且 bid 未变，只拉取新日志 + 更新动作面板
    if (currentMode === 'battle' && currentBid === bid) {
        await fetchAndRenderBattleLog();
        updateActionPanel(isPlayerTurn);
        return;
    }

    currentMode = 'battle';
    currentBid = bid;

    // 获取敌人名称
    await fetchEnemyName(bid);

    // 切换 DOM
    showBattleMode();

    // 拉取并渲染战斗日志
    await fetchAndRenderBattleLog();

    // 根据顺位渲染动作面板
    updateActionPanel(isPlayerTurn);
}

/**
 * 更新动作面板：玩家顺位时显示动作按钮，否则显示等待提示
 *
 * @param {boolean} isPlayerTurn 玩家是否当前顺位
 */
function updateActionPanel(isPlayerTurn) {
    if (isPlayerTurn) {
        renderBattleActions('battle', onBattleAction);
    } else {
        const el = document.getElementById('battleActionBar');
        if (el) {
            el.innerHTML = '<div class="text-fg-dim text-[10px] py-2 text-center">敌人正在行动...</div>';
        }
    }
}

/**
 * 退出战斗模式
 */
function exitBattleMode() {
    if (currentMode === 'normal') return;

    currentMode = 'normal';
    currentBid = 0;
    currentEnemyName = '';

    // 移除 ended 状态的全局 click 监听器（防御性，防止泄漏）
    document.removeEventListener('click', autoExitBattleEnd, true);

    // 切换 DOM
    showNormalMode();

    // 广播战斗结束事件，触发地图和动作条刷新
    // （杀死敌人后敌人需从地图消失，动作条需恢复探索选项）
    dataManager.invalidateAll();
    dataManager.broadcast('battle:ended');
}

/**
 * 进入战斗结束态
 *
 * 战斗已结束（action=''），但玩家尚未确认。
 * 拉取最后的 battle_log（含 battle.end 条目）渲染，并显示"继续探索"按钮。
 * 玩家点击继续后才真正 exitBattleMode。
 *
 * 体验优化：ended 状态下，点击 battleMode 外的任何元素（如地图）等效于
 * 先点"继续探索"退出结束态，再执行原本的点击操作。
 */
async function enterBattleEndMode() {
    currentMode = 'ended';

    // 确保战斗界面可见（玩家可能从 prebattle/battle 直接进入结束态）
    showBattleMode();

    // 拉取并渲染最后的战斗日志（含最后一击 + battle.end）
    await fetchAndRenderBattleLog();

    // 显示继续按钮
    renderBattleEndActions(() => {
        exitBattleMode();
    });

    // 监听全局 click：ended 状态下点击 battleMode 外的元素，自动退出结束态
    // capture 阶段拦截，先 exitBattleMode，不阻止事件传播，让原本的点击继续执行
    document.addEventListener('click', autoExitBattleEnd, true);
}

/**
 * ended 状态下的全局 click 拦截器
 *
 * 点击 battleMode 外的元素时，先 exitBattleMode，让原本的点击操作继续执行。
 * 点击 battleMode 内的元素（如"继续探索"按钮）不处理，由按钮自身 handler 处理。
 */
function autoExitBattleEnd(e) {
    // 只在 ended 状态下生效（防御性，正常情况下退出 ended 后会移除监听器）
    if (currentMode !== 'ended') {
        document.removeEventListener('click', autoExitBattleEnd, true);
        return;
    }

    // 点击 battleMode 内的元素，不处理
    if (e.target.closest('#battleMode')) return;

    // 点击了 battleMode 外的元素，退出结束态
    document.removeEventListener('click', autoExitBattleEnd, true);
    exitBattleMode();
    // 不调用 e.stopPropagation()，让事件继续传播到原本的 target（如地图点击）
}

/**
 * 从 enemies API 获取敌人名称
 *
 * @param {number} bid 敌人 PID
 */
async function fetchEnemyName(bid) {
    if (!bid) {
        currentEnemyName = '';
        return;
    }

    try {
        const result = await dataManager.fetch('enemies', true);
        if (result.status !== 'success' || !result.data) {
            currentEnemyName = '敌人';
            return;
        }

        const enemies = result.data.enemies || [];
        for (let i = 0; i < enemies.length; i++) {
            if (parseInt(enemies[i].pid) === bid) {
                currentEnemyName = enemies[i].name || '敌人';
                return;
            }
        }
        currentEnemyName = '敌人';
    } catch (e) {
        currentEnemyName = '敌人';
    }
}

/**
 * 拉取并渲染战斗日志
 *
 * 只在有新日志时更新渲染，避免空数组覆盖已有日志
 * （obl_battle_log_load 返回后清空文件，定时刷新时第二次拉取会拿到空数组）
 */
async function fetchAndRenderBattleLog() {
    try {
        const result = await dataManager.fetch('battle_log', true);
        if (result.status !== 'success' || !result.data) return;

        const entries = result.data.entries || [];
        // 只在有新日志时更新渲染
        if (entries.length > 0) {
            renderBattleLog(entries, currentEnemyName);
        }
    } catch (e) {
        console.error('[Battle] fetchAndRenderBattleLog error:', e);
    }
}

/**
 * 战斗动作回调
 *
 * @param {string} actionId 动作 ID（如 'unarmed_strike'）
 */
async function onBattleAction(actionId) {
    if (currentMode !== 'prebattle' && currentMode !== 'battle') return;
    if (!currentBid) return;

    // 提交战斗动作
    const result = await commandQueue.execute({
        command: 'obl_battle_action',
        action_id: actionId,
    });

    if (!result.success) {
        console.error('[Battle] action failed:', result);
        return;
    }

    // 失效缓存，确保下次拉取最新数据
    dataManager.invalidate('player_info');
    dataManager.invalidate('battle_log');
    dataManager.invalidate('enemies');

    // 刷新战斗状态（拉取新的 battle_log 并播放）
    await refreshBattle();
}

/**
 * 玩家主动攻击：进入 prebattle 状态
 *
 * 供外部调用（如敌人列表的攻击按钮）。
 *
 * @param {number} enemyPid 敌人 PID
 */
export async function startBattle(enemyPid) {
    if (currentMode !== 'normal') return;

    const result = await commandQueue.execute({
        command: 'obl_battle_start',
        enemy_pid: enemyPid,
    });

    if (!result.success) {
        console.error('[Battle] start failed:', result);
        dataManager.broadcast('ui:toast', { type: 'error', msg: result.error || '无法发起攻击' });
        return;
    }

    dataManager.invalidate('player_info');
    await refreshBattle();
}

/**
 * 取消 prebattle 状态
 */
export async function cancelBattle() {
    if (currentMode !== 'prebattle') return;

    const result = await commandQueue.execute({
        command: 'obl_battle_cancel',
    });

    if (!result.success) {
        console.error('[Battle] cancel failed:', result);
        return;
    }

    dataManager.invalidate('player_info');
    await refreshBattle();
}

// ══════════════════════════════════════════════════
// DOM 切换
// ══════════════════════════════════════════════════

function showBattleMode() {
    const normal = document.getElementById('normalMode');
    const battle = document.getElementById('battleMode');
    if (normal) normal.style.display = 'none';
    if (battle) battle.style.display = '';
}

function showNormalMode() {
    const normal = document.getElementById('normalMode');
    const battle = document.getElementById('battleMode');
    if (normal) normal.style.display = '';
    if (battle) battle.style.display = 'none';
}

/**
 * 初始化战斗模块
 *
 * 订阅 game:action-completed 事件：任何推进 tick 的命令（move/obl_explore/obl_search）
 * 都可能触发遭遇战（NPC 移动到玩家格），需要刷新战斗状态以及时进入战斗界面。
 * 战斗内部命令（obl_battle_action/obl_battle_start/obl_battle_cancel）不广播此事件，
 * 已手动调用 refreshBattle()，不会重复刷新。
 */
export function initBattle() {
    dataManager.listen('game:action-completed', function() {
        refreshBattle();
    });
}

/**
 * 获取当前战斗模式（供外部查询）
 *
 * @returns {string} 'normal' | 'prebattle' | 'battle' | 'ended'
 */
export function getBattleMode() {
    return currentMode;
}
