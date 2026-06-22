// ══════════════════════════════════════════════════
// battle-aim.js — 瞄准模式：地图选目标 + 实时路径线
//
// 职责：
// - 监听 battle:aim-mode / battle:aim-exit 事件
// - 瞄准模式下标记敌人格为可选目标
// - mousemove 实时绘制 SVG 贝塞尔曲线（AP 栏 → 光标/敌人）
// - 点击敌人格确认目标 → onTargetSelect(pid)
//
// 依赖：
// - data-manager.js（事件订阅）
// - battle-preload.js（onTargetSelect）
// ══════════════════════════════════════════════════

import { dataManager } from './data-manager.js';
import { onTargetSelect, exitAimMode } from './battle-preload.js';

let aimModeActive = false;

/**
 * 初始化瞄准模式：注册事件监听
 * 在 map.js initMap 中调用
 */
export function initBattleAim() {
    // 进入瞄准模式：标记敌人格 + 绑定 mousemove
    dataManager.listen('battle:aim-mode', function() {
        aimModeActive = true;
        applyAimTargetable();
    });

    // 退出瞄准模式：清理
    dataManager.listen('battle:aim-exit', function() {
        aimModeActive = false;
        clearAimTargetable();
        clearAimLine();
    });

    // 战斗结束/取消时也清理（调用 exitAimMode 统一清理 state + 广播 aim-exit）
    dataManager.listen('battle:ended', function() {
        if (aimModeActive) {
            exitAimMode();
        }
    });

    // 地图重新渲染后，若仍在瞄准模式，重新标记
    dataManager.listen('map:loaded', function() {
        if (aimModeActive) applyAimTargetable();
    });

    // ESC 键退出瞄准模式
    document.addEventListener('keydown', function(e) {
        if (aimModeActive && e.key === 'Escape') {
            exitAimMode();
        }
    });
}

/**
 * 标记所有敌人格为瞄准可选目标
 * 添加 .aim-targetable 类 + 点击事件
 * 在 mapGrid 上绑定 mousemove 实时跟随光标
 */
function applyAimTargetable() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    const enemyCells = grid.querySelectorAll('[data-enemy-pid]');
    enemyCells.forEach(function(cell) {
        cell.classList.add('aim-targetable');
        cell.addEventListener('click', onAimCellClick);
    });
    grid.addEventListener('mousemove', onAimMouseMove);
    grid.addEventListener('mouseleave', onAimMouseLeave);
}

/**
 * 清除所有敌人格的瞄准标记和事件
 */
function clearAimTargetable() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    const enemyCells = grid.querySelectorAll('[data-enemy-pid]');
    enemyCells.forEach(function(cell) {
        cell.classList.remove('aim-targetable', 'aim-hover');
        cell.removeEventListener('click', onAimCellClick);
    });
    grid.removeEventListener('mousemove', onAimMouseMove);
    grid.removeEventListener('mouseleave', onAimMouseLeave);
}

/**
 * mousemove：实时绘制瞄准线
 * 光标在敌人格上时吸附到格中心 + 高亮；否则跟随光标
 */
function onAimMouseMove(e) {
    const target = e.target;
    const enemyCell = target && target.closest && target.closest('[data-enemy-pid]');

    // 清除所有敌人格的 aim-hover，仅高亮当前
    const grid = document.getElementById('mapGrid');
    if (grid) {
        grid.querySelectorAll('.aim-hover').forEach(function(c) { c.classList.remove('aim-hover'); });
    }

    if (enemyCell) {
        enemyCell.classList.add('aim-hover');
        const rect = enemyCell.getBoundingClientRect();
        drawAimLine(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else {
        drawAimLine(e.clientX, e.clientY);
    }
}

/**
 * 光标离开地图区域：清除瞄准线
 */
function onAimMouseLeave() {
    const grid = document.getElementById('mapGrid');
    if (grid) {
        grid.querySelectorAll('.aim-hover').forEach(function(c) { c.classList.remove('aim-hover'); });
    }
    clearAimLine();
}

function onAimCellClick(e) {
    e.stopPropagation();
    const pid = parseInt(this.getAttribute('data-enemy-pid'));
    if (pid > 0) {
        onTargetSelect(pid);
    }
}

/**
 * 绘制瞄准路径线（AP 栏左边缘 → 指定坐标）
 * 使用 fixed 定位的 SVG 覆盖层，柔化贝塞尔曲线
 *
 * @param {number} endX 终点 X（视口坐标）
 * @param {number} endY 终点 Y（视口坐标）
 */
function drawAimLine(endX, endY) {
    let svg = document.getElementById('aimLineOverlay');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'aimLineOverlay';
        document.body.appendChild(svg);
    }

    // 起点：AP 进度栏左边缘，垂直居中
    let startEl = document.querySelector('.ap-bar-container');
    if (!startEl) startEl = document.getElementById('preloadQueueArea');
    if (!startEl) startEl = document.getElementById('battleActionBar');
    if (!startEl) return;
    const startRect = startEl.getBoundingClientRect();
    const startX = startRect.left;
    const startY = startRect.top + startRect.height / 2;

    svg.setAttribute('width', window.innerWidth);
    svg.setAttribute('height', window.innerHeight);
    svg.style.display = '';

    // 柔化三次贝塞尔曲线：两端切线水平，平滑过渡
    const dx = Math.abs(startX - endX);
    const offset = Math.max(40, dx * 0.35);
    const cp1X = startX - offset;
    const cp1Y = startY;
    const cp2X = endX + offset;
    const cp2Y = endY;

    const pathData = 'M ' + startX + ' ' + startY
        + ' C ' + cp1X + ' ' + cp1Y + ', ' + cp2X + ' ' + cp2Y + ', ' + endX + ' ' + endY;

    const dotR = 3;
    svg.innerHTML = '<path d="' + pathData + '" />'
        + '<circle cx="' + startX + '" cy="' + startY + '" r="' + dotR + '" class="aim-dot" />'
        + '<circle cx="' + endX + '" cy="' + endY + '" r="' + dotR + '" class="aim-dot" />';
}

/**
 * 清除瞄准路径线
 */
function clearAimLine() {
    const svg = document.getElementById('aimLineOverlay');
    if (svg) {
        svg.innerHTML = '';
        svg.style.display = 'none';
    }
}
