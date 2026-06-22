// ══════════════════════════════════════════════════
// 战斗渲染 / Battle rendering
//
// 职责：
// - 渲染战斗等待提示（battle 模式，NPC 回合）
// - 渲染战斗模式标题（敌人名称+位置）
//
// 注意：战斗动作按钮已委托给 battle-preload.js（装填区模块）
// 注意：battle_log 条目渲染已委托给 vex/data/battle-templates.js
// ══════════════════════════════════════════════════

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
