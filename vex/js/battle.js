// ══════════════════════════════════════════════════
// 战斗状态机 / Battle state machine
//
// 简化为 normal/battle 两态：
// - normal（探索）→ 玩家点击敌人 → 纯前端确认界面 → 提交 obl_battle_start → battle
// - battle（战斗）→ 玩家提交 obl_battle_action → 播放碰撞动画+模态框 → 继续 battle 或回 normal
//
// battlelog 数据流（played 标记机制）：
// - 后端所有 battlelog 持久化到文件，每条带 log_id + played=0
// - 前端拉取 played=0 的条目 → 按战斗分组 → 每组先播碰撞动画再播模态框
// - 播完调 mark_battle_log_played.php 标记 played=1
// ══════════════════════════════════════════════════

import { dataManager } from './data-manager.js';
import { renderBattleWaiting, renderBattleHeader } from './battle-render.js';
import { initPreloadArea } from './battle-preload.js';
import { playBattleLog } from './battle-modal.js';
import { playCollisionAnimation, playDamageNumbersAfterModal } from './battle-animation.js';
import { BASE_URL } from './data.js';

// 战斗状态
let currentMode = 'normal';   // 'normal' | 'battle'
let currentEnemyPid = 0;      // 当前战斗对象 PID（敌人）
let currentGroomid = 0;       // 当前房间 ID（用于标记接口）
let currentPid = 0;           // 当前玩家 PID（用于标记接口）
let isPlayingBattleLog = false; // 是否正在播放 battlelog（防重入）
let npcTurnRefreshTimer = null; // NPC 回合自动刷新定时器（NPC 顺位时定时拉取等待执行）
const NPC_TURN_REFRESH_INTERVAL = 2000; // NPC 回合自动刷新间隔（毫秒）

/**
 * 刷新战斗状态：检测 action 变化，进入/退出战斗模式
 *
 * 在 app.js 的 refreshAll 和 game:action-completed 事件中调用。
 * NPC 顺位时会由 startNpcTurnRefresh 定时循环调用本函数。
 */
export async function refreshBattle() {
    try {
        const result = await dataManager.fetch('player_info', true);
        if (result.status !== 'success' || !result.data) return;

        const action = result.data.action || '';
        const battleQueue = result.data.battle_queue || null;

        // 记录 groomid 和 pid（用于标记接口）
        currentGroomid = parseInt(result.data.groomid) || 0;
        currentPid = parseInt(result.data.pid) || 0;

        if (action === 'battle') {
            // 从先攻队列中提取敌人 PID（第一个 type>0 的参战者）
            const enemyPid = extractEnemyPid(battleQueue);
            // 检查先攻队列，判断玩家是否当前顺位
            const isPlayerTurn = checkPlayerTurn(battleQueue);
            await enterBattleMode(enemyPid, isPlayerTurn);

            // NPC 顺位时启动自动刷新循环，玩家顺位时停止
            if (isPlayerTurn) {
                stopNpcTurnRefresh();
            } else {
                startNpcTurnRefresh();
            }
        } else {
            // action='' 战斗已结束
            stopNpcTurnRefresh();
            exitBattleMode();
        }

        // 独立播放积压的 battlelog（不管模式，有就播放，没有就跳过）
        await fetchAndPlayBattleLog();
    } catch (e) {
        console.error('[Battle] refreshBattle error:', e);
    }
}

/**
 * 检查玩家是否当前顺位
 *
 * 先攻队列中第一个 done=0 的是当前顺位者。
 * type=0 是玩家，type>0 是 NPC。
 *
 * @param {Object|null} battleQueue result.data.battle_queue
 * @returns {boolean} true=玩家当前顺位，false=NPC 当前顺位
 */
function checkPlayerTurn(battleQueue) {
    if (!battleQueue || !Array.isArray(battleQueue.queue)) return true;
    for (let i = 0; i < battleQueue.queue.length; i++) {
        if (battleQueue.queue[i].done == 0) {
            return battleQueue.queue[i].type == 0;  // type=0 是玩家
        }
    }
    return true;  // 所有人都完成了，默认显示（后端会重新判定）
}

/**
 * 从先攻队列中提取敌人 PID（第一个 type>0 的参战者）
 *
 * @param {Object|null} battleQueue result.data.battle_queue
 * @returns {number} 敌人 PID，找不到返回 0
 */
function extractEnemyPid(battleQueue) {
    if (!battleQueue || !Array.isArray(battleQueue.queue)) return 0;
    for (let i = 0; i < battleQueue.queue.length; i++) {
        if (parseInt(battleQueue.queue[i].type) > 0) {
            return parseInt(battleQueue.queue[i].pid);
        }
    }
    return 0;
}

/**
 * 进入 battle 模式
 *
 * 只负责 DOM 切换和首次进入的初始化（敌人名称、模式切换、动作面板）。
 * battlelog 的拉取播放由 refreshBattle() 独立调用，避免 NPC 回合定时器
 * 触发的 refreshBattle 因"敌人未变"分支跳过 battlelog 拉取。
 *
 * @param {number} enemyPid 敌人 PID
 * @param {boolean} isPlayerTurn 玩家是否当前顺位
 */
async function enterBattleMode(enemyPid, isPlayerTurn) {
    // 已在 battle 模式且敌人未变，只更新动作面板
    if (currentMode === 'battle' && currentEnemyPid === enemyPid) {
        updateActionPanel(isPlayerTurn);
        return;
    }

    currentMode = 'battle';
    currentEnemyPid = enemyPid;

    // 切换 DOM（敌人名称暂空，等 playBattleLogGroup 从 battlelog 提取后更新）
    showBattleMode();
    renderBattleHeader('');

    // 根据顺位渲染动作面板
    updateActionPanel(isPlayerTurn);
}

/**
 * 退出战斗模式
 */
export function exitBattleMode() {
    if (currentMode === 'normal') return;

    currentMode = 'normal';
    currentEnemyPid = 0;

    // 切换 DOM
    showNormalMode();

    // 移除战斗边框光效
    document.body.classList.remove('battle-active');

    // 广播战斗结束事件，触发地图和动作条刷新
    // 战斗不涉及白名单 action（game_map/tile_actions/player_inventory），
    // loadMap 会重新拉取 game_map，无需 invalidateAll
    dataManager.broadcast('battle:ended');
}

// ══════════════════════════════════════════════════
// NPC 回合自动刷新循环
// ══════════════════════════════════════════════════

/**
 * 启动 NPC 回合自动刷新循环
 *
 * NPC 顺位时，后端会在下次 common.inc 加载时执行 NPC 先攻轮。
 * 前端通过定时拉取 player_info 触发 common.inc，从而推进 NPC 行动。
 * 已有定时器时不重复启动。
 */
function startNpcTurnRefresh() {
    if (npcTurnRefreshTimer !== null) return;
    npcTurnRefreshTimer = setInterval(() => {
        // 失效缓存确保拉取最新数据（触发后端 common.inc）
        dataManager.invalidate('player_info');
        dataManager.invalidate('battle_log');
        refreshBattle();
    }, NPC_TURN_REFRESH_INTERVAL);
}

/**
 * 停止 NPC 回合自动刷新循环
 */
function stopNpcTurnRefresh() {
    if (npcTurnRefreshTimer !== null) {
        clearInterval(npcTurnRefreshTimer);
        npcTurnRefreshTimer = null;
    }
}

/**
 * 更新动作面板：玩家顺位时显示装填区，否则显示等待提示
 *
 * @param {boolean} isPlayerTurn 玩家是否当前顺位
 */
function updateActionPanel(isPlayerTurn) {
    if (isPlayerTurn) {
        // 初始化装填区（in-battle 模式）
        initPreloadArea('in-battle', currentEnemyPid, currentPid);
    } else {
        renderBattleWaiting();
    }
}

// ══════════════════════════════════════════════════
// 玩家主动攻击流程
// ══════════════════════════════════════════════════

/**
 * 玩家主动攻击：切换到预装填界面
 *
 * 供外部调用（如地图点击敌人）。
 * 不再显示确认对话框，直接切换到战斗模式并初始化装填区。
 * 玩家在装填区预装填动作后点击"执行"提交 obl_battle_start。
 *
 * @param {number} enemyPid 敌人 PID
 */
export async function startBattle(enemyPid) {
    if (currentMode !== 'normal') return;

    // 切换到战斗模式（DOM 切换，后端尚未知道战斗开始）
    currentMode = 'battle';
    currentEnemyPid = enemyPid;
    showBattleMode();

    // 无目标时显示瞄准提示
    const headerEl = document.getElementById('battleEnemyName');
    if (headerEl) {
        headerEl.textContent = enemyPid > 0 ? '' : '瞄准模式';
    }

    // 初始化装填区（pre-battle 模式）
    await initPreloadArea('pre-battle', enemyPid, currentPid);

    // 广播战斗开始事件
    dataManager.broadcast('battle:started');
}

// ══════════════════════════════════════════════════
// 装填区事件处理
// ══════════════════════════════════════════════════

/**
 * 装填区执行完成后的刷新处理
 *
 * battle-preload.js 提交命令后广播 preload:executed 事件，
 * 本函数监听该事件并刷新战斗状态。
 */
async function onPreloadExecuted() {
    // 失效缓存
    dataManager.invalidate('player_info');
    dataManager.invalidate('enemies');
    dataManager.invalidate('battle_log');

    // 刷新战斗状态
    await refreshBattle();
}

// ══════════════════════════════════════════════════
// battlelog 拉取 + 分组 + 播放 + 标记
// ══════════════════════════════════════════════════

/**
 * 拉取未播放的 battlelog，按战斗分组播放，播完标记
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

        // 检测战斗结束日志（battle_end 标记战斗已结束）
        const hasBattleEnd = entries.some(e =>
            e.action_id === 'battle_end' ||
            (e.phase === 'finish_check' && e.extra && e.extra.ended === true)
        );

        // 按战斗分组（非 excute 阶段的日志会被过滤掉，不播放动画）
        const groups = groupByEncounter(entries);

        // 收集所有要标记的 log_id（包括非 excute 阶段的日志）
        const allLogIds = entries.map(e => e.log_id).filter(id => id);

        // 逐组播放
        for (const enemyPid of Object.keys(groups)) {
            const groupEntries = groups[enemyPid];
            await playBattleLogGroup(groupEntries, parseInt(enemyPid));
        }

        // 标记为已播放
        await markBattleLogPlayed(allLogIds);

        // 如果检测到战斗结束日志，停止 NPC 自动刷新并退出战斗模式
        if (hasBattleEnd) {
            stopNpcTurnRefresh();
            dataManager.invalidate('enemies');
            exitBattleMode();
        }

        // 播放完后，如果当前是玩家回合，显示"你的回合"提示
        const playerInfo = await dataManager.fetch('player_info', true);
        if (playerInfo.status === 'success' && playerInfo.data) {
            const action = playerInfo.data.action || '';
            if (action === 'battle') {
                const battleQueue = playerInfo.data.battle_queue || null;
                const isPlayerTurn = checkPlayerTurn(battleQueue);
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
 * 按战斗分组（从 entries 推导 NPC pid）
 *
 * 单 NPC 战斗约束下，从 entries 中找 type>0 的一方作为 NPC pid，
 * 所有条目归入同一组。
 *
 * @param {Array} entries battlelog 条目数组
 * @returns {Object} { npcPid: [entries...] }
 */
function groupByEncounter(entries) {
    let npcPid = 0;
    for (const e of entries) {
        if (e.actor_type > 0) { npcPid = e.actor_pid; break; }
        if (e.target_type > 0) { npcPid = e.target_pid; break; }
    }
    if (npcPid === 0) return {};
    return { [npcPid]: entries };
}

/**
 * 播放一组的 battlelog：先碰撞动画，再模态框
 *
 * @param {Array} entries 同一 NPC 的 battlelog 条目
 * @param {number} npcPid NPC PID
 */
async function playBattleLogGroup(entries, npcPid) {
    // 过滤出 excute 阶段的日志（核心伤害日志），其他阶段不播放动画
    const excuteEntries = entries.filter(e => e.phase === 'excute');
    if (excuteEntries.length === 0) return;

    // 获取播放上下文（敌人名称+HP 从 API 获取）
    const context = await buildPlayContext(npcPid);

    // 更新战斗 header（敌人名称+位置）
    renderBattleHeader(context.enemyName, context.npcLocation);

    // 1. 先播放碰撞动画（冲刺+抖动，不含伤害数字）
    for (const entry of excuteEntries) {
        if (entry.action_id === 'unarmed_strike') {
            await playCollisionAnimation(entry, npcPid);
        }
    }

    // 2. 播放模态框前移除按钮光效（避免透过模态框遮罩闪烁）
    removeTurnActiveGlow();

    // 3. 播放模态框（详细战斗日志）
    await playBattleLog(excuteEntries, context, null);

    // 4. 模态框关闭后，伤害数字淡入显示在地图格上（残留反馈）
    playDamageNumbersAfterModal(excuteEntries, npcPid);

    // 5. 恢复按钮光效（如果仍是玩家回合）
    restoreTurnActiveGlow();
}

/**
 * 移除动作按钮的回合光效
 */
function removeTurnActiveGlow() {
    const buttons = document.querySelectorAll('#battleActionBar .obl-btn.turn-active');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove('turn-active');
    }
}

/**
 * 恢复动作按钮的回合光效（仅当技能按钮可见时，即玩家回合）
 */
function restoreTurnActiveGlow() {
    const buttons = document.querySelectorAll('#battleActionBar .obl-btn[data-skill-id]');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].classList.add('turn-active');
    }
}

/**
 * 从 API 获取最新状态，更新 ctx
 * 供 buildPlayContext（首次构建）和 playBattleLog 循环（每条 entry 前同步）共用
 */
export async function refreshContextFromApi(ctx) {
    try {
        const playerInfo = await dataManager.fetch('player_info', true);
        if (playerInfo.status === 'success' && playerInfo.data) {
            ctx.playerHp = playerInfo.data.hp || 0;
            ctx.playerMaxHp = playerInfo.data.mhp || 1;
            ctx.playerName = playerInfo.data.name || '';
        }

        const enemiesResult = await dataManager.fetch('enemies', true);
        if (enemiesResult.status === 'success' && enemiesResult.data) {
            const enemies = enemiesResult.data.enemies || [];
            for (let i = 0; i < enemies.length; i++) {
                if (parseInt(enemies[i].pid) === parseInt(ctx.npcPid)) {
                    ctx.npcName = enemies[i].name || '敌人';
                    ctx.npcHp = enemies[i].hp || 0;
                    ctx.npcMaxHp = enemies[i].mhp || 1;
                    if (enemies[i].pls) ctx.npcLocation = enemies[i].pls;
                    // 兼容旧字段名（供 battle-modal.js 的 renderHeader 使用）
                    ctx.enemyName = ctx.npcName;
                    ctx.enemyHp = ctx.npcHp;
                    ctx.enemyMaxHp = ctx.npcMaxHp;
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[Battle] refreshContextFromApi error:', e);
    }
}

/**
 * 首次构建播放上下文
 *
 * @param {number} npcPid NPC PID
 * @returns {Promise<Object>} 播放上下文
 */
async function buildPlayContext(npcPid) {
    const ctx = {
        npcPid,
        npcName: '敌人',
        npcHp: 0,
        npcMaxHp: 1,
        npcLocation: null,
        playerHp: 0,
        playerMaxHp: 1,
        playerName: '',
        // 兼容旧字段名
        enemyName: '敌人',
        enemyHp: 0,
        enemyMaxHp: 1,
    };
    await refreshContextFromApi(ctx);
    return ctx;
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
// 初始化
// ══════════════════════════════════════════════════

/**
 * 初始化战斗模块
 *
 * 订阅事件：
 * - game:action-completed：任何推进 tick 的命令都可能触发遭遇战
 * - preload:executed：装填区执行完成后刷新战斗状态
 */
export function initBattle() {
    dataManager.listen('game:action-completed', function() {
        refreshBattle();
    });
    dataManager.listen('preload:executed', function() {
        onPreloadExecuted();
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
