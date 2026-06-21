// ══════════════════════════════════════════════════
// 地图交互层 / Map interaction layer
//
// 职责：缩放、平移、键盘、触摸、路径预览、居中。
// 通过 setInteractionCallbacks 注入 onKeyMove（键盘移动业务逻辑），
// 避免 map-interaction ↔ map.js 的循环依赖。
// ══════════════════════════════════════════════════

import { mapData } from './data.js';
import { commandQueue } from './command-queue.js';
import { renderMapGrid, applyZoom, getZoomLevel, ZOOM_STEP } from './map-render.js';
import { findPath, getDirectionArrow, isReachable } from './map-reachability.js';

// ─── 回调注入（由 map.js 主模块设置）───
let _onKeyMove = null;

/**
 * 注入交互回调，由 map.js 主模块调用
 * @param {Object} callbacks
 *   - onKeyMove(areaId): 键盘移动到目标格
 */
export function setInteractionCallbacks(callbacks) {
    if (callbacks.onKeyMove) _onKeyMove = callbacks.onKeyMove;
}

/**
 * 处理方向键/WASD 移动
 * @param {number} dx - X 方向偏移 (-1/0/1)
 * @param {number} dy - Y 方向偏移 (-1/0/1)
 */
async function handleKeyMove(dx, dy) {
    if (mapData.curLoc === null || mapData.curRegion === null) return;
    if (commandQueue.isLocked) return;

    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return;
    const curTile = tiles[mapData.curLoc];
    if (!curTile) return;

    const targetX = curTile.x + dx;
    const targetY = curTile.y + dy;

    // 查找目标坐标对应的 pls
    let targetPls = null;
    for (const pls in tiles) {
        if (tiles[pls].x === targetX && tiles[pls].y === targetY) {
            targetPls = parseInt(pls);
            break;
        }
    }

    // 无效移动判断
    if (targetPls === null) {
        shakeCurrentCell();
        return;
    }

    // 检查可达性（BFS 距离判定，含迷雾过滤）
    if (!isReachable(targetPls)) {
        shakeCurrentCell();
        return;
    }

    // 执行移动（通过回调注入的 clickMove）
    if (_onKeyMove) await _onKeyMove(targetPls);
}

/**
 * 当前格抖动反馈（无效移动时）
 */
export function shakeCurrentCell() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    const cell = grid.querySelector('.map-cell.current');
    if (!cell) return;
    cell.classList.add('cell-shake');
    setTimeout(() => cell.classList.remove('cell-shake'), 300);
}

/**
 * 自动居中到玩家位置
 */
export function centerOnPlayer(smooth = true) {
    const grid = document.getElementById('mapGrid');
    const container = document.getElementById('mapContainer');
    const playerCell = grid ? grid.querySelector('.map-cell.current') : null;
    if (!playerCell || !container) return;

    // 用 offsetLeft/offsetTop 计算玩家格在滚动内容中的绝对位置
    // 这比 getBoundingClientRect 更准确，因为它不受 flex 居中影响
    let cellOffsetLeft = 0;
    let cellOffsetTop = 0;
    let el = playerCell;
    while (el && el !== container) {
        cellOffsetLeft += el.offsetLeft;
        cellOffsetTop += el.offsetTop;
        el = el.offsetParent;
    }

    const cellW = playerCell.offsetWidth;
    const cellH = playerCell.offsetHeight;

    // 滚动到使玩家格居中
    const scrollX = cellOffsetLeft + cellW / 2 - container.clientWidth / 2;
    const scrollY = cellOffsetTop + cellH / 2 - container.clientHeight / 2;

    container.scrollTo({
        left: Math.max(0, scrollX),
        top: Math.max(0, scrollY),
        behavior: smooth ? 'smooth' : 'instant'
    });
}

/**
 * 清除所有路径预览高亮
 */
export function clearPathPreview() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    grid.querySelectorAll('.cell-path').forEach(el => {
        el.classList.remove('cell-path');
        const arrow = el.querySelector('.cell-path-arrow');
        if (arrow) arrow.remove();
    });
}

/**
 * 显示从当前格到目标格的路径预览
 */
export function showPathPreview(targetPls) {
    clearPathPreview();
    if (mapData.curLoc === null) return;

    const path = findPath(mapData.curLoc, targetPls);
    if (!path || path.length < 2) return;

    const tiles = mapData.links.tiles[mapData.curRegion];
    const grid = document.getElementById('mapGrid');
    if (!grid) return;

    const fogData = mapData.links.fog;
    const regionFog = fogData && fogData[mapData.curRegion] ? fogData[mapData.curRegion] : {};

    // 路径中间格（不含起点和终点）高亮 + 方向箭头
    // 迷雾中间格不高亮（保持神秘感）
    for (let i = 1; i < path.length - 1; i++) {
        const pls = path[i];
        if (!regionFog[pls]) continue; // 迷雾格跳过

        const cell = grid.querySelector('[data-pls="' + pls + '"]');
        if (cell) {
            cell.classList.add('cell-path');
            const fromTile = tiles[path[i - 1]];
            const toTile = tiles[pls];
            const arrow = getDirectionArrow(fromTile, toTile);
            if (arrow) {
                const arrowEl = document.createElement('span');
                arrowEl.className = 'cell-path-arrow';
                arrowEl.textContent = arrow;
                cell.appendChild(arrowEl);
            }
        }
    }
}

/**
 * 计算两个触摸点之间的距离
 */
function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 初始化地图交互事件（缩放/平移/触摸/双击/键盘）
 */
export function initMapInteraction() {
    const container = document.getElementById('mapContainer');
    if (!container) return;

    // ─── 滚轮缩放（桌面端，Ctrl+滚轮） ───
    container.addEventListener('wheel', function(e) {
        e.preventDefault(); // 阻止默认滚动，无论是否 Ctrl
        if (!e.ctrlKey) return; // 仅 Ctrl+滚轮触发缩放
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        applyZoom(getZoomLevel() + delta);
    }, { passive: false });

    // ─── 鼠标拖拽平移（桌面端） ───
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let scrollStartX = 0, scrollStartY = 0;

    container.addEventListener('mousedown', function(e) {
        // 只在空白处/地图格上拖拽，不阻断按钮点击
        if (e.target.closest('.zoom-btn')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        scrollStartX = container.scrollLeft;
        scrollStartY = container.scrollTop;
        container.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        container.scrollLeft = scrollStartX - dx;
        container.scrollTop = scrollStartY - dy;
    });
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = '';
        }
    });

    // ─── 触摸缩放/平移（移动端） ───
    let touchStartDist = 0;
    let touchStartZoom = 1;
    let isTouchZooming = false;

    container.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            isTouchZooming = true;
            touchStartDist = getTouchDistance(e.touches);
            touchStartZoom = getZoomLevel();
        }
    }, { passive: true });

    container.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && isTouchZooming) {
            e.preventDefault();
            const dist = getTouchDistance(e.touches);
            const scale = dist / touchStartDist;
            applyZoom(touchStartZoom * scale);
        }
        // 单指平移由浏览器原生滚动处理
    }, { passive: false });

    container.addEventListener('touchend', function() {
        isTouchZooming = false;
    });

    // ─── 缩放 +/- 按钮 ───
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoom(getZoomLevel() + ZOOM_STEP));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoom(getZoomLevel() - ZOOM_STEP));

    // ─── 窗口 resize ───
    let resizeTimer = null;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            renderMapGrid();
            requestAnimationFrame(() => centerOnPlayer(false));
        }, 150);
    });

    // ─── 键盘方向键/WASD 移动 ───
    document.addEventListener('keydown', function(e) {
        // 输入框聚焦时忽略
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // 模态框/抽屉打开时忽略
        const modal = document.getElementById('modalOverlay');
        if (modal && modal.classList.contains('open')) return;

        let dx = 0, dy = 0;
        switch (e.key) {
            case 'ArrowUp': case 'w': case 'W':    dy = -1; break;
            case 'ArrowDown': case 's': case 'S':  dy = 1;  break;
            case 'ArrowLeft': case 'a': case 'A':  dx = -1; break;
            case 'ArrowRight': case 'd': case 'D': dx = 1;  break;
            default: return;
        }
        e.preventDefault();
        handleKeyMove(dx, dy);
    });
}
