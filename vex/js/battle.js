// ══════════════════════════════════════════════════
// 战斗状态机 / Battle state machine
//
// 简化为 normal/battle 两态：
// - normal（探索）→ 玩家点击敌人 → 纯前端确认界面 → 提交 obl_battle_start → battle
// - battle（战斗）→ 玩家提交 obl_battle_action → 播放碰撞动画+模态框 → 继续 battle 或回 normal
//
// battlelog 数据流（played 标记机制）：
// - 后端所有 battlelog 持久化到文件，每条带 log_id + enemy_pid + played=0
// - 前端拉取 played=0 的条目 → 按 enemy_pid 分组 → 每组先播碰撞动画再播模态框
// - 播完调 mark_battle_log_played.php 标记 played=1
// ══════════════════════════════════════════════════

import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';
import { renderBattleActions, renderBattleWaiting, renderBattleHeader } from './battle-render.js';
import { playBattleLog } from './battle-modal.js';
import { playCollisionAnimation, playDamageNumbersAfterModal } from './battle-animation.js';
import { BASE_URL } from './data.js';

// 战斗状态
let currentMode = 'normal';   // 'normal' | 'battle'
let currentBid = 0;           // 当前战斗对象 PID
let currentEnemyName = '';    // 当前战斗对象名称
let currentGroomid = 0;       // 当前房间 ID（用于标记接口）
let currentPid = 0;           // 当前玩家 PID（用于标记接口）
let isPlayingBattleLog = false; // 是否正在播放 battlelog（防重入）
let isProcessingBattle = false; // 命令处理中（覆盖提交+播放全流程，屏蔽快速重复点击）

/**
 * 刷新战斗状态：检测 action 变化，进入/退出战斗模式
 *
 * 在 app.js 的 refreshAll 和 game:action-completed 事件中调用。
 */
export async function refreshBattle() {
    try {
        const result = await dataManager.fetch('player_info', true);
        if (result.status !== 'success' || !result.data) return;

        const action = result.data.action || '';
        const bid = parseInt(result.data.bid) || 0;
        const oblpara = result.data.oblpara || {};
        const battleState = oblpara.battle || null;

        // 记录 groomid 和 pid（用于标记接口）
        currentGroomid = parseInt(result.data.groomid) || 0;
        currentPid = parseInt(result.data.pid) || 0;

        if (action === 'battle') {
            // 检查先攻队列，判断玩家是否当前顺位
            const isPlayerTurn = checkPlayerTurn(battleState, bid);
            await enterBattleMode(bid, isPlayerTurn);
        } else {
            // action='' 战斗已结束
            if (currentMode !== 'normal') {
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
 * 进入 battle 模式
 *
 * @param {number} bid 敌人 PID
 * @param {boolean} isPlayerTurn 玩家是否当前顺位
 */
async function enterBattleMode(bid, isPlayerTurn) {
    // 已在 battle 模式且 bid 未变，只更新动作面板
    if (currentMode === 'battle' && currentBid === bid) {
        updateActionPanel(isPlayerTurn);
        return;
    }

    currentMode = 'battle';
    currentBid = bid;

    // 获取敌人名称
    await fetchEnemyName(bid);

    // 切换 DOM
    showBattleMode();
    renderBattleHeader(currentEnemyName);

    // 根据顺位渲染动作面板
    updateActionPanel(isPlayerTurn);

    // 拉取并播放未播放的 battlelog
    await fetchAndPlayBattleLog();
}

/**
 * 退出战斗模式
 */
function exitBattleMode() {
    if (currentMode === 'normal') return;

    currentMode = 'normal';
    currentBid = 0;
    currentEnemyName = '';

    // 切换 DOM
    showNormalMode();

    // 移除战斗边框光效
    document.body.classList.remove('battle-active');

    // 广播战斗结束事件，触发地图和动作条刷新
    dataManager.invalidateAll();
    dataManager.broadcast('battle:ended');
}

/**
 * 更新动作面板：玩家顺位时显示动作按钮，否则显示等待提示
 *
 * @param {boolean} isPlayerTurn 玩家是否当前顺位
 */
function updateActionPanel(isPlayerTurn) {
    if (isPlayerTurn) {
        renderBattleActions(onBattleAction);
    } else {
        renderBattleWaiting();
    }
}

// ══════════════════════════════════════════════════
// 玩家主动攻击流程
// ══════════════════════════════════════════════════

/**
 * 玩家主动攻击：显示确认界面
 *
 * 供外部调用（如地图点击敌人）。
 * 纯前端确认界面，玩家确认后提交 obl_battle_start 命令。
 *
 * @param {number} enemyPid 敌人 PID
 */
export async function startBattle(enemyPid) {
    if (currentMode !== 'normal') return;

    // 获取敌人名称
    const enemyName = await fetchEnemyNameByPid(enemyPid);

    // 显示确认界面
    showBattleConfirm(enemyName, async () => {
        await confirmStartBattle(enemyPid);
    });
}

/**
 * 确认发起攻击
 *
 * @param {number} enemyPid 敌人 PID
 */
async function confirmStartBattle(enemyPid) {
    if (isProcessingBattle) return;
    isProcessingBattle = true;
    try {
        hideBattleConfirm();

        // 提交 obl_battle_start 命令
        const result = await commandQueue.execute({
            command: 'obl_battle_start',
            enemy_pid: enemyPid,
        });

        if (!result.success) {
            console.error('[Battle] start failed:', result);
            dataManager.broadcast('ui:toast', { type: 'error', msg: result.error || '无法发起攻击' });
            return;
        }

        // 失效缓存，确保下次拉取最新数据
        dataManager.invalidate('player_info');
        dataManager.invalidate('enemies');
        dataManager.invalidate('battle_log');

        // 刷新战斗状态（会进入 battle 模式并拉取播放 battlelog）
        await refreshBattle();
    } finally {
        isProcessingBattle = false;
    }
}

// ══════════════════════════════════════════════════
// 战斗动作流程
// ══════════════════════════════════════════════════

/**
 * 战斗动作回调
 *
 * @param {string} actionId 动作 ID（如 'unarmed_strike'）
 */
async function onBattleAction(actionId) {
    if (currentMode !== 'battle') return;
    if (!currentBid) return;
    if (isProcessingBattle) return;
    isProcessingBattle = true;
    try {
        // 提交战斗动作
        const result = await commandQueue.execute({
            command: 'obl_battle_action',
            action_id: actionId,
        });

        if (!result.success) {
            console.error('[Battle] action failed:', result);
            return;
        }

        // 失效缓存
        dataManager.invalidate('player_info');
        dataManager.invalidate('enemies');
        dataManager.invalidate('battle_log');

        // 拉取并播放新产生的 battlelog
        await fetchAndPlayBattleLog();

        // 刷新战斗状态
        await refreshBattle();
    } finally {
        isProcessingBattle = false;
    }
}

// ══════════════════════════════════════════════════
// battlelog 拉取 + 分组 + 播放 + 标记
// ══════════════════════════════════════════════════

/**
 * 拉取未播放的 battlelog，按 enemy_pid 分组播放，播完标记
 */
async function fetchAndPlayBattleLog() {
    if (isPlayingBattleLog) return;  // 防重入
    if (!currentGroomid || !currentPid) return;

    try {
        // 失效缓存，确保拉取最新
        dataManager.invalidate('battle_log');
        const result = await dataManager.fetch('battle_log', true);
        if (result.status !== 'success' || !result.data) return;

        const entries = result.data.entries || [];
        if (entries.length === 0) return;

        isPlayingBattleLog = true;

        // 按 enemy_pid 分组
        const groups = groupByEnemyPid(entries);

        // 收集所有要标记的 log_id
        const allLogIds = entries.map(e => e.log_id).filter(id => id);

        // 逐组播放
        for (const enemyPid of Object.keys(groups)) {
            const groupEntries = groups[enemyPid];
            await playBattleLogGroup(groupEntries, parseInt(enemyPid));
        }

        // 标记为已播放
        await markBattleLogPlayed(allLogIds);

        // 播放完后，如果当前是玩家回合，显示"你的回合"提示
        const playerInfo = await dataManager.fetch('player_info', true);
        if (playerInfo.status === 'success' && playerInfo.data) {
            const action = playerInfo.data.action || '';
            if (action === 'battle') {
                const battleState = (playerInfo.data.oblpara || {}).battle || null;
                const isPlayerTurn = checkPlayerTurn(battleState, parseInt(playerInfo.data.bid));
                if (isPlayerTurn) {
                    // 定位到屏幕正中央（模态框消失的位置）
                    const toastContainer = document.getElementById('toastContainer');
                    if (toastContainer) {
                        toastContainer.classList.add('pos-screen-center');
                    }
                    dataManager.broadcast('ui:toast', { type: 'info', msg: '你的回合' });
                    // toast 消失后恢复默认位置（显示 2000ms + 淡出 300ms + 缓冲）
                    setTimeout(() => {
                        if (toastContainer) toastContainer.classList.remove('pos-screen-center');
                    }, 2500);
                }
            }
        }
    } catch (e) {
        console.error('[Battle] fetchAndPlayBattleLog error:', e);
    } finally {
        isPlayingBattleLog = false;
    }
}

/**
 * 按 enemy_pid 分组
 *
 * @param {Array} entries battlelog 条目数组
 * @returns {Object} { enemy_pid: [entries...] }
 */
function groupByEnemyPid(entries) {
    const groups = {};
    for (const entry of entries) {
        const key = entry.enemy_pid || 0;
        if (!groups[key]) groups[key] = [];
        groups[key].push(entry);
    }
    return groups;
}

/**
 * 播放一组的 battlelog：先碰撞动画，再模态框
 *
 * @param {Array} entries 同一 enemy_pid 的 battlelog 条目
 * @param {number} enemyPid 敌人 PID
 */
async function playBattleLogGroup(entries, enemyPid) {
    // 获取敌人名称和 HP 信息
    const context = await buildPlayContext(enemyPid);

    // 1. 先播放碰撞动画（冲刺+抖动，不含伤害数字）
    for (const entry of entries) {
        if (entry.action_id === 'unarmed_strike') {
            await playCollisionAnimation(entry, enemyPid);
        }
    }

    // 2. 播放模态框前移除按钮光效（避免透过模态框遮罩闪烁）
    removeTurnActiveGlow();

    // 3. 播放模态框（详细战斗日志）
    await playBattleLog(entries, context, null);

    // 4. 模态框关闭后，伤害数字淡入显示在地图格上（残留反馈）
    playDamageNumbersAfterModal(entries, enemyPid);

    // 5. 恢复按钮光效（如果仍是玩家回合）
    restoreTurnActiveGlow();
}

/**
 * 移除动作按钮的回合光效
 */
function removeTurnActiveGlow() {
    const buttons = document.querySelectorAll('#battleActionBar .action-btn.turn-active');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove('turn-active');
    }
}

/**
 * 恢复动作按钮的回合光效（仅当动作按钮可见时，即玩家回合）
 */
function restoreTurnActiveGlow() {
    const buttons = document.querySelectorAll('#battleActionBar .action-btn[data-action-id]');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.add('turn-active');
    }
}

/**
 * 构建播放上下文（敌人名称 + HP 信息）
 *
 * @param {number} enemyPid 敌人 PID
 * @returns {Promise<Object>} { enemyName, enemyHp, enemyMaxHp, playerHp, playerMaxHp }
 */
async function buildPlayContext(enemyPid) {
    let enemyName = '敌人';
    let enemyHp = 0, enemyMaxHp = 1;
    let playerHp = 0, playerMaxHp = 1;

    try {
        const playerInfo = await dataManager.fetch('player_info', true);
        if (playerInfo.status === 'success' && playerInfo.data) {
            playerHp = playerInfo.data.hp || 0;
            playerMaxHp = playerInfo.data.mhp || 1;
        }

        const enemiesResult = await dataManager.fetch('enemies', true);
        if (enemiesResult.status === 'success' && enemiesResult.data) {
            const enemies = enemiesResult.data.enemies || [];
            for (let i = 0; i < enemies.length; i++) {
                if (parseInt(enemies[i].pid) === parseInt(enemyPid)) {
                    enemyName = enemies[i].name || '敌人';
                    enemyHp = enemies[i].hp || 0;
                    enemyMaxHp = enemies[i].mhp || 1;
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[Battle] buildPlayContext error:', e);
    }

    return {
        enemyName: enemyName,
        enemyHp: enemyHp,
        enemyMaxHp: enemyMaxHp,
        playerHp: playerHp,
        playerMaxHp: playerMaxHp,
    };
}

/**
 * 调用零依赖接口标记 battlelog 为已播放
 *
 * @param {Array} logIds log_id 数组
 */
async function markBattleLogPlayed(logIds) {
    if (!logIds || logIds.length === 0) return;
    if (!currentGroomid || !currentPid) return;

    try {
        const body = new URLSearchParams();
        body.append('groomid', currentGroomid);
        body.append('pid', currentPid);
        body.append('log_ids', logIds.join(','));

        await fetch(BASE_URL + '/vex/mark_battle_log_played.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
    } catch (e) {
        console.error('[Battle] markBattleLogPlayed error:', e);
    }
}

// ══════════════════════════════════════════════════
// 敌人信息获取
// ══════════════════════════════════════════════════

/**
 * 从 enemies API 获取敌人名称（内部使用，设置 currentEnemyName）
 *
 * @param {number} bid 敌人 PID
 */
async function fetchEnemyName(bid) {
    currentEnemyName = await fetchEnemyNameByPid(bid);
}

/**
 * 从 enemies API 获取敌人名称
 *
 * @param {number} pid 敌人 PID
 * @returns {Promise<string>} 敌人名称
 */
async function fetchEnemyNameByPid(pid) {
    if (!pid) return '';

    try {
        const result = await dataManager.fetch('enemies', true);
        if (result.status !== 'success' || !result.data) return '敌人';

        const enemies = result.data.enemies || [];
        for (let i = 0; i < enemies.length; i++) {
            if (parseInt(enemies[i].pid) === pid) {
                return enemies[i].name || '敌人';
            }
        }
        return '敌人';
    } catch (e) {
        return '敌人';
    }
}

// ══════════════════════════════════════════════════
// DOM 切换
// ══════════════════════════════════════════════════

function showBattleMode() {
    const normal = document.getElementById('normalMode');
    const battle = document.getElementById('battleMode');
    if (normal) normal.style.display = 'none';
    if (battle) battle.style.display = '';

    // 添加战斗边框光效
    document.body.classList.add('battle-active');

    // 地图切换到战斗模式
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) mapContainer.classList.add('battle-mode');
}

function showNormalMode() {
    const normal = document.getElementById('normalMode');
    const battle = document.getElementById('battleMode');
    if (normal) normal.style.display = '';
    if (battle) battle.style.display = 'none';

    // 移除战斗边框光效
    document.body.classList.remove('battle-active');

    // 地图切换回探索模式
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) mapContainer.classList.remove('battle-mode');
}

// ══════════════════════════════════════════════════
// 战斗确认界面（纯前端）
// ══════════════════════════════════════════════════

/**
 * 显示战斗确认界面
 *
 * @param {string} enemyName 敌人名称
 * @param {Function} onConfirm 确认回调
 */
function showBattleConfirm(enemyName, onConfirm) {
    const overlay = document.getElementById('battleConfirmOverlay');
    const nameEl = document.getElementById('battleConfirmEnemyName');
    const yesBtn = document.getElementById('battleConfirmYes');
    const noBtn = document.getElementById('battleConfirmNo');

    if (!overlay) return;

    if (nameEl) nameEl.textContent = enemyName || '敌人';

    // 移除旧的事件监听器（通过克隆节点）
    if (yesBtn) {
        const newYes = yesBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        newYes.addEventListener('click', onConfirm);
    }

    if (noBtn) {
        const newNo = noBtn.cloneNode(true);
        noBtn.parentNode.replaceChild(newNo, noBtn);
        newNo.addEventListener('click', () => hideBattleConfirm());
    }

    overlay.classList.add('open');
}

/**
 * 隐藏战斗确认界面
 */
function hideBattleConfirm() {
    const overlay = document.getElementById('battleConfirmOverlay');
    if (overlay) overlay.classList.remove('open');
}

// ══════════════════════════════════════════════════
// 初始化
// ══════════════════════════════════════════════════

/**
 * 初始化战斗模块
 *
 * 订阅 game:action-completed 事件：任何推进 tick 的命令（move/obl_explore/obl_search）
 * 都可能触发遭遇战（NPC 移动到玩家格），需要刷新战斗状态以及时进入战斗界面。
 */
export function initBattle() {
    dataManager.listen('game:action-completed', function() {
        refreshBattle();
    });
}

/**
 * 获取当前战斗模式（供外部查询）
 *
 * @returns {string} 'normal' | 'battle'
 */
export function getBattleMode() {
    return currentMode;
}
