// ══════════════════════════════════════════════════
// 战斗碰撞动画 / Battle collision animation
//
// 地图上的即时反馈动画：
// - 攻击方冲刺（向受击方方向位移后回位）
// - 受击方抖动
// - 伤害数字浮起淡出
//
// 接口：
// - playCollisionAnimation(entry, enemyPid)
// - playDamageNumber(targetEl, damage, isHeal)
// ══════════════════════════════════════════════════

/**
 * 播放碰撞动画
 *
 * 根据 battlelog 条目判断攻击方/受击方，在地图上播放动画。
 * 玩家元素通过 .current 类定位，敌人元素通过 [data-enemy-pid] 定位。
 *
 * @param {Object} entry BattleLogEntry
 * @param {number} enemyPid 敌人 PID（用于定位敌人元素）
 * @returns {Promise<void>}
 */
export async function playCollisionAnimation(entry, enemyPid) {
    if (!entry) return;

    // 只对攻击动作播放动画（battle.start/initiative.roll/battle.end 跳过）
    const actionId = entry.action_id || '';
    if (actionId === 'battle.start' || actionId === 'initiative.roll' ||
        actionId === 'battle.end' || actionId === 'escape') {
        return;
    }

    // 判断攻击方和受击方
    const isPlayerAttacker = entry.actor_type === 0;
    const attackerEl = isPlayerAttacker ? getPlayerElement() : getEnemyElement(enemyPid);
    const targetEl = isPlayerAttacker ? getEnemyElement(enemyPid) : getPlayerElement();

    if (!attackerEl || !targetEl) return;

    // 计算冲刺方向（攻击方 → 受击方）
    const lunge = calculateLungeVector(attackerEl, targetEl);

    // 1. 攻击方冲刺
    playLunge(attackerEl, lunge.x, lunge.y);

    // 2. 受击方抖动（延迟 120ms，模拟命中时机）
    setTimeout(() => {
        playShake(targetEl);
    }, 120);

    // 等待动画完成（冲刺 300ms + 抖动 120ms延迟/300ms = 420ms）
    await sleep(450);
}

/**
 * 播放伤害数字浮起
 *
 * @param {HTMLElement} targetEl 目标元素
 * @param {number} value 数值
 * @param {boolean} isHeal 是否为治疗（绿色）
 */
export function playDamageNumber(targetEl, value, isHeal) {
    if (!targetEl || !value) return;

    const container = getMapContainer();
    if (!container) return;

    // 计算目标元素相对于地图容器的位置
    const targetRect = targetEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const num = document.createElement('div');
    num.className = 'damage-number' + (isHeal ? ' heal' : '');
    num.textContent = (isHeal ? '+' : '-') + value;
    num.style.left = (targetRect.left - containerRect.left + targetRect.width / 2) + 'px';
    num.style.top = (targetRect.top - containerRect.top + targetRect.height / 2) + 'px';

    container.appendChild(num);

    // 动画结束后移除（600ms，与 playCollisionAnimation 的等待时间匹配）
    setTimeout(() => {
        if (num.parentNode) num.parentNode.removeChild(num);
    }, 600);
}

/**
 * 模态框关闭后，在地图格上淡入显示伤害数字（残留反馈）
 *
 * 遍历该组 battlelog 中的攻击动作，在受击方格子上显示伤害数字。
 * 与 playCollisionAnimation 不同，这里只显示数字（不播冲刺/抖动），
 * 且使用淡入动画（damage-fade-in）而非浮起动画（damage-float）。
 *
 * @param {Array} entries 同一 NPC 的 battlelog 条目
 * @param {number} enemyPid 敌人 PID
 */
export function playDamageNumbersAfterModal(entries, enemyPid) {
    if (!entries || !entries.length) return;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.action_id !== 'unarmed_strike') continue;

        const damage = entry.effect_value || 0;
        if (damage <= 0) continue;

        const isPlayerAttacker = entry.actor_type === 0;
        const targetEl = isPlayerAttacker ? getEnemyElement(enemyPid) : getPlayerElement();
        if (!targetEl) continue;

        // 用视口坐标（position: fixed），避免依赖容器的定位上下文
        const targetRect = targetEl.getBoundingClientRect();

        const num = document.createElement('div');
        num.className = 'damage-number-linger';
        num.textContent = '-' + damage;
        num.style.left = (targetRect.left + targetRect.width / 2) + 'px';
        num.style.top = (targetRect.top + targetRect.height / 2) + 'px';

        // 多条伤害数字错开显示（避免重叠）
        num.style.marginTop = (i * 18) + 'px';

        document.body.appendChild(num);

        // 停留 2s 后移除（与 CSS 动画时长匹配）
        setTimeout(() => {
            if (num.parentNode) num.parentNode.removeChild(num);
        }, 2000);
    }
}

// ══════════════════════════════════════════════════
// 内部实现
// ══════════════════════════════════════════════════

/**
 * 获取玩家地图元素（当前格）
 *
 * @returns {HTMLElement|null}
 */
function getPlayerElement() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return null;
    return grid.querySelector('.map-cell.current');
}

/**
 * 获取敌人地图元素
 *
 * @param {number} enemyPid 敌人 PID
 * @returns {HTMLElement|null}
 */
function getEnemyElement(enemyPid) {
    const grid = document.getElementById('mapGrid');
    if (!grid) return null;
    return grid.querySelector('[data-enemy-pid="' + enemyPid + '"]');
}

/**
 * 获取地图容器（用于定位伤害数字）
 *
 * @returns {HTMLElement|null}
 */
function getMapContainer() {
    return document.querySelector('.map-container') || document.getElementById('mapGrid');
}

/**
 * 计算冲刺向量（攻击方 → 受击方方向，缩放到 4px）
 *
 * @param {HTMLElement} attackerEl
 * @param {HTMLElement} targetEl
 * @returns {{x: number, y: number}}
 */
function calculateLungeVector(attackerEl, targetEl) {
    const aRect = attackerEl.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();

    const dx = tRect.left + tRect.width / 2 - (aRect.left + aRect.width / 2);
    const dy = tRect.top + tRect.height / 2 - (aRect.top + aRect.height / 2);

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return { x: 0, y: 0 };

    // 缩放到 4px 位移
    const scale = 4 / distance;
    return {
        x: Math.round(dx * scale),
        y: Math.round(dy * scale),
    };
}

/**
 * 播放冲刺动画
 *
 * @param {HTMLElement} el 元素
 * @param {number} x X 方向位移
 * @param {number} y Y 方向位移
 */
function playLunge(el, x, y) {
    el.style.setProperty('--lunge-x', x + 'px');
    el.style.setProperty('--lunge-y', y + 'px');
    el.classList.remove('attack-lunge');
    // 触发重排以重启动画
    void el.offsetWidth;
    el.classList.add('attack-lunge');

    // 动画结束后清理
    setTimeout(() => {
        el.classList.remove('attack-lunge');
        el.style.removeProperty('--lunge-x');
        el.style.removeProperty('--lunge-y');
    }, 300);
}

/**
 * 播放抖动动画
 *
 * @param {HTMLElement} el 元素
 */
function playShake(el) {
    el.classList.remove('hit-shake');
    void el.offsetWidth;
    el.classList.add('hit-shake');

    setTimeout(() => {
        el.classList.remove('hit-shake');
    }, 300);
}

/**
 * Promise 化的 setTimeout
 *
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
