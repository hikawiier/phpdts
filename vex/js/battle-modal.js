// ══════════════════════════════════════════════════
// 战斗演出模态框 / Battle presentation modal
//
// 纯展示模态框，播放 battlelog 条目：
// - 逐条显示，每条带打字机效果
// - 播放完自动关闭
// - 支持连续模态框过渡（淡出→过渡→淡入）
// - 遮罩拦截点击，播放期间禁止操作
//
// 接口：
// - playBattleLog(entries, context, onComplete)
// - closeBattleModal()
// - isBattleModalPlaying()
// ══════════════════════════════════════════════════

import { renderBattleLogEntryHtml } from './battle-render.js';

// 播放状态
let playing = false;
let currentTimer = null;
let currentSleepResolve = null;
let cancelRequested = false;

// 播放参数
const TYPEWRITER_SPEED = 25;      // 打字机速度 ms/字符
const ENTRY_INTERVAL = 500;       // 条目间隔 ms
const COMPLETE_HOLD = 1200;       // 播放完停留 ms
const TRANSITION_INTERVAL = 200;  // 连续模态框过渡 ms

/**
 * 播放 battlelog 条目
 *
 * @param {Array} entries BattleLogEntry 数组
 * @param {Object} context 播放上下文 { enemyName, enemyHp, enemyMaxHp, playerHp, playerMaxHp }
 * @param {Function} [onComplete] 播放完关闭后的回调
 * @returns {Promise<void>}
 */
export async function playBattleLog(entries, context, onComplete) {
    if (!entries || entries.length === 0) {
        if (onComplete) onComplete();
        return;
    }

    // 如果正在播放，先关闭当前模态框（连续过渡）
    if (playing) {
        await closeBattleModalInternal(true);
        await sleep(TRANSITION_INTERVAL);
    }

    playing = true;
    cancelRequested = false;

    // 准备上下文
    const ctx = context || {};
    const enemyName = ctx.enemyName || 'playBattleLog里的敌人';
    const playerHp = ctx.playerHp || 0;
    const playerMaxHp = ctx.playerMaxHp || 1;
    const enemyHp = ctx.enemyHp || 0;
    const enemyMaxHp = ctx.enemyMaxHp || 1;

    // 渲染头部信息
    renderHeader(enemyName, enemyHp, enemyMaxHp, playerHp, playerMaxHp);

    // 清空正文
    const body = document.getElementById('battleModalBody');
    if (body) body.innerHTML = '';

    // 显示模态框
    showOverlay();

    // 等待模态框淡入
    await sleep(250);

    // 按 log_id 排序（log_id 是持久化时按 emit 顺序分配的递增值，代表 log 的产生顺序）
    const sorted = entries.slice().sort((a, b) => (a.log_id || 0) - (b.log_id || 0));

    // 逐条播放
    let currentTurn = -1;
    for (let i = 0; i < sorted.length; i++) {
        if (cancelRequested) break;

        const entry = sorted[i];

        // 回合分隔符（turn=0 显示"战斗开始"，turn>=1 显示"回合 N"）
        if (entry.turn !== currentTurn) {
            currentTurn = entry.turn;
            const dividerText = currentTurn === 0 ? '── 战斗开始 ──' : '── 回合 ' + currentTurn + ' ──';
            await appendDivider(body, dividerText);
            await sleep(ENTRY_INTERVAL / 2);
        }

        // 渲染条目 HTML
        const html = renderBattleLogEntryHtml(entry, ctx);
        if (html) {
            await appendEntry(body, html);
        }

        // 更新 HP 条（如果 extra 中有 hp_after）
        updateHpBars(entry, ctx);

        await sleep(ENTRY_INTERVAL);
    }

    if (cancelRequested) {
        playing = false;
        return;
    }

    // 播放完停留
    await sleep(COMPLETE_HOLD);

    // 关闭模态框
    await closeBattleModalInternal(false);

    playing = false;

    if (onComplete) onComplete();
}

/**
 * 关闭模态框（带淡出动画）
 *
 * @returns {Promise<void>}
 */
export async function closeBattleModal() {
    await closeBattleModalInternal(false);
    playing = false;
}

/**
 * 检查模态框是否正在播放
 *
 * @returns {boolean}
 */
export function isBattleModalPlaying() {
    return playing;
}

// ══════════════════════════════════════════════════
// 内部实现
// ══════════════════════════════════════════════════

/**
 * 关闭模态框内部实现
 *
 * @param {boolean} isTransition 是否为连续过渡（不重置 playing 状态）
 * @returns {Promise<void>}
 */
async function closeBattleModalInternal(isTransition) {
    cancelRequested = true;
    cancelCurrentSleep();

    const overlay = document.getElementById('battleModalOverlay');
    if (!overlay) return;

    overlay.classList.add('closing');
    overlay.classList.remove('open');

    await sleep(200);

    overlay.classList.remove('closing');
    if (!isTransition) {
        // 完全关闭时清空内容
        const body = document.getElementById('battleModalBody');
        if (body) body.innerHTML = '';
    }
}

/**
 * 显示模态框遮罩
 */
function showOverlay() {
    const overlay = document.getElementById('battleModalOverlay');
    if (overlay) {
        overlay.classList.add('open');
    }
}

/**
 * 渲染头部信息（双方名称 + HP 条）
 */
function renderHeader(enemyName, enemyHp, enemyMaxHp, playerHp, playerMaxHp) {
    const enemyNameEl = document.getElementById('battleModalEnemyName');
    if (enemyNameEl) enemyNameEl.textContent = enemyName;

    const playerNameEl = document.getElementById('battleModalPlayerName');
    if (playerNameEl) playerNameEl.textContent = '你';

    updateHpBar('battleModalEnemyHpFill', 'battleModalEnemyHpText', enemyHp, enemyMaxHp);
    updateHpBar('battleModalPlayerHpFill', 'battleModalPlayerHpText', playerHp, playerMaxHp);
}

/**
 * 更新 HP 条
 *
 * @param {string} fillId HP 条填充元素 ID
 * @param {string} textId HP 文本元素 ID
 * @param {number} hp 当前 HP
 * @param {number} maxHp 最大 HP
 */
function updateHpBar(fillId, textId, hp, maxHp) {
    const fill = document.getElementById(fillId);
    const text = document.getElementById(textId);
    if (!fill || !text) return;

    const safeMaxHp = maxHp > 0 ? maxHp : 1;
    const percent = Math.max(0, Math.min(100, (hp / safeMaxHp) * 100));
    fill.style.width = percent + '%';

    // HP 状态类
    fill.classList.remove('low', 'critical');
    if (percent < 25) {
        fill.classList.add('critical');
    } else if (percent < 50) {
        fill.classList.add('low');
    }

    text.textContent = 'HP: ' + hp + '/' + maxHp;
}

/**
 * 根据 battlelog 条目更新 HP 条
 *
 * @param {Object} entry BattleLogEntry
 * @param {Object} ctx 播放上下文
 */
function updateHpBars(entry, ctx) {
    if (!entry.extra) return;

    // 玩家攻击敌人 → 更新敌人 HP
    if (entry.actor_type === 0 && entry.extra.enemy_hp_after !== undefined) {
        updateHpBar('battleModalEnemyHpFill', 'battleModalEnemyHpText',
            entry.extra.enemy_hp_after, ctx.enemyMaxHp);
    }

    // 敌人攻击玩家 → 更新玩家 HP
    if (entry.actor_type !== 0 && entry.extra.player_hp_after !== undefined) {
        updateHpBar('battleModalPlayerHpFill', 'battleModalPlayerHpText',
            entry.extra.player_hp_after, ctx.playerMaxHp);
    }
}

/**
 * 追加分隔符到正文
 *
 * @param {HTMLElement} body 正文容器
 * @param {string} text 分隔符文本
 * @returns {Promise<void>}
 */
async function appendDivider(body, text) {
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'battle-log-entry turn-divider shown';
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

/**
 * 追加条目到正文（带打字机效果）
 *
 * @param {HTMLElement} body 正文容器
 * @param {string} html 条目 HTML
 * @returns {Promise<void>}
 */
async function appendEntry(body, html) {
    if (!body) return;

    const div = document.createElement('div');
    div.className = 'battle-log-entry';
    div.innerHTML = html;
    body.appendChild(div);

    // 触发显示动画
    await sleep(20);
    div.classList.add('shown');
    body.scrollTop = body.scrollHeight;
}

/**
 * Promise 化的 setTimeout
 *
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => {
        currentSleepResolve = resolve;
        currentTimer = setTimeout(() => {
            currentTimer = null;
            currentSleepResolve = null;
            resolve();
        }, ms);
    });
}

/**
 * 取消当前正在等待的 sleep，并 resolve 其 Promise（避免永久挂起）
 */
function cancelCurrentSleep() {
    if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = null;
    }
    if (currentSleepResolve) {
        currentSleepResolve();
        currentSleepResolve = null;
    }
}
