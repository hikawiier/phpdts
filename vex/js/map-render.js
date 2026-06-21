// ══════════════════════════════════════════════════
// 地图渲染层 / Map rendering layer
//
// 职责：地图网格 DOM 渲染 + 坐标索引 + 缩放状态管理。
// 事件处理（click/mouseenter）通过 setRenderCallbacks 注入，
// 避免 map-render ↔ map / map-interaction 的循环依赖。
// ══════════════════════════════════════════════════

import { mapData } from './data.js';
import { escapeHtml, isFalsy } from './utils.js';
import { computeReachableMap, isReachable } from './map-reachability.js';
import { dataManager } from './data-manager.js';

// ─── 缩放状态 ───
let zoomLevel = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;

// ─── 模块级状态（替代原函数对象挂载）───
let zoomInitialized = false;
let applyZoomTimer = null;

// ─── 回调注入（由 map.js 主模块设置）───
let _callbacks = {
    onCellClick: () => {},
    onEnemyClick: () => {},
    onCellHover: () => {},
    onCellLeave: () => {},
    centerOnPlayer: () => {}
};

/**
 * 注入事件回调，由 map.js 主模块调用
 * @param {Object} callbacks
 *   - onCellClick(areaId): 点击可达格 → 移动
 *   - onEnemyClick(enemy): 点击敌人格 → 战斗确认
 *   - onCellHover(areaId): 悬停可达格 → 路径预览
 *   - onCellLeave(): 离开可达格 → 清除预览
 *   - centerOnPlayer(smooth): 居中到玩家位置
 */
export function setRenderCallbacks(callbacks) {
    _callbacks = Object.assign(_callbacks, callbacks);
}

/**
 * 构建坐标索引：{x,y} → { pls, tile }
 */
function buildCoordIndex(tiles) {
    const index = {};
    for (const pls in tiles) {
        const t = tiles[pls];
        index[t.x + ',' + t.y] = { pls: parseInt(pls), tile: t };
    }
    return index;
}

/**
 * 渲染地图网格
 */
export function renderMapGrid() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!mapData.links || !mapData.curRegion) {
        grid.innerHTML = '<div class="error">地图数据加载失败，请刷新页面重试</div>';
        return;
    }

    const regionGrid = mapData.links.grids[mapData.curRegion];
    if (!regionGrid) { grid.innerHTML = '<div class="error">no grid data</div>'; return; }
    const cols = regionGrid.cols || 10;
    const rows = regionGrid.rows || 10;

    // 自适应格子尺寸：根据容器宽度计算，移动端允许更小，应用缩放倍率
    const isMobile = window.innerWidth <= 900;
    const baseMin = isMobile ? 32 : 48;
    const baseMax = isMobile ? 48 : 80;
    const containerWidth = grid.parentElement.offsetWidth - 16;
    const baseSize = Math.max(baseMin, Math.min(baseMax, Math.floor(containerWidth / cols)));
    const baseHeight = Math.max(isMobile ? 22 : 32, Math.floor(baseSize * 0.6));

    // 智能默认缩放：首次渲染时自动计算，让地图比容器大 25%（边缘裁切，引导探索）
    if (!zoomInitialized) {
        const fitZoomX = containerWidth / (cols * baseSize);
        const containerHeight = grid.parentElement.offsetHeight - 16;
        const fitZoomY = containerHeight / (rows * baseHeight);
        const fitZoom = Math.min(fitZoomX, fitZoomY);
        zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom * 1.25));
        // 四舍五入到 0.05 精度
        zoomLevel = Math.round(zoomLevel * 20) / 20;
        zoomInitialized = true;
    }

    const cellSize = Math.round(baseSize * zoomLevel);
    const cellHeight = Math.round(baseHeight * zoomLevel);
    const nameFontSize = Math.max(7, Math.round(9 * zoomLevel));
    const meFontSize = Math.max(6, Math.round(8 * zoomLevel));

    grid.style.gridTemplateColumns = 'repeat(' + cols + ', ' + cellSize + 'px)';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', ' + cellHeight + 'px)';

    // 当 grid 小于容器时居中显示，大于容器时从左上角开始（允许滚动居中）
    const gridW = cols * cellSize;
    const gridH = rows * cellHeight;
    const containerEl = document.getElementById('mapContainer');
    if (containerEl) {
        const needCenterX = gridW <= containerEl.clientWidth;
        const needCenterY = gridH <= containerEl.clientHeight;
        containerEl.style.display = 'flex';
        containerEl.style.alignItems = needCenterY ? 'center' : 'flex-start';
        containerEl.style.justifyContent = needCenterX ? 'center' : 'flex-start';
    }

    const fogData = mapData.links.fog;
    const regionFog = fogData && fogData[mapData.curRegion] ? fogData[mapData.curRegion] : {};
    const regionInfo = mapData.links.regions[mapData.curRegion];

    const tiles = mapData.links.tiles[mapData.curRegion];
    const coordIndex = tiles ? buildCoordIndex(tiles) : {};

    // 计算可达性格缓存（BFS 从当前格出发，move_range 内）
    computeReachableMap();

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tileInfo = coordIndex[c + ',' + r];
            const cell = document.createElement('div');

            if (!tileInfo) {
                cell.className = 'map-cell empty';
                grid.appendChild(cell);
                continue;
            }

            cell.className = 'map-cell';
            cell.dataset.pls = tileInfo.pls;
            const isCurrent = tileInfo.pls === mapData.curLoc;
            const isFogged = !isCurrent && !regionFog[tileInfo.pls];
            const isExit = regionInfo && tileInfo.pls === regionInfo.exit_pls;
            const isEntrance = regionInfo && tileInfo.pls === regionInfo.entrance_pls && regionInfo.prev_region !== null;
            const passable = !isFalsy(tileInfo.tile.passable);
            const isDeep = tileInfo.tile.tide === 'deep';
            const isMetal = tileInfo.tile.floor === 'metal';
            const isSafe = !!tileInfo.tile.preset_safe;
            const name = tileInfo.tile.name || '';

            // 已探索（非迷雾）格才有微背景 + 潮汐/地板视觉
            if (!isFogged) {
                cell.className += ' explored';
                if (isDeep) cell.className += ' tide-deep';
                if (isMetal) cell.className += ' floor-metal';
                if (isSafe) cell.className += ' safe-zone';
            }

            // 无名格坐标标签（极淡）
            const coordLabel = String.fromCharCode(65 + tileInfo.tile.y) + tileInfo.tile.x;

            if (isFogged) {
                cell.className += ' fogged';
                cell.innerHTML = '<span class="cell-name" style="font-size:' + nameFontSize + 'px">?</span>';
            } else if (isCurrent) {
                cell.className += ' current';
                if (isExit) cell.className += ' exit-tile';
                if (isEntrance) cell.className += ' entrance-tile';
                const prefix = isExit ? '▸' : (isEntrance ? '◂' : '');
                cell.innerHTML = '<span class="cell-name pulse-white"><span class="cell-me" style="font-size:' + meFontSize + 'px">[我]</span>' + prefix + escapeHtml(name || ('位置' + tileInfo.pls)) + '</span>';
                cell.classList.add('reachable');
                cell.addEventListener('click', () => _callbacks.onCellClick(tileInfo.pls));
            } else {
                const reachable = isReachable(tileInfo.pls);
                if (reachable) {
                    cell.className += ' reachable';
                } else {
                    cell.className += ' unreachable';
                }
                if (!passable) cell.className += ' blocked';
                if (isExit) cell.className += ' exit-tile';
                if (isEntrance) cell.className += ' entrance-tile';

                const prefix = isExit ? '▸' : (isEntrance ? '◂' : '');
                const label = prefix + name;
                const enemy = mapData.enemies.find(e => parseInt(e.pls) === tileInfo.pls && parseInt(e.state) === 0);
                if (enemy) {
                    cell.innerHTML = '<span class="cell-name"><span class="cell-enemy">[' + escapeHtml(enemy.name) + ']</span>' + escapeHtml(label) + '</span>';
                    cell.setAttribute('data-enemy-pid', enemy.pid);
                } else {
                    cell.innerHTML = label ? '<span class="cell-name" style="font-size:' + nameFontSize + 'px">' + escapeHtml(label) + '</span>' : '<span class="cell-coord">' + coordLabel + '</span>';
                }

                if (enemy) {
                    // 敌人格：点击触发战斗确认界面（纯前端确认，不再直接提交）
                    cell.style.cursor = 'crosshair';
                    cell.title = '点击攻击 ' + enemy.name;
                    cell.addEventListener('click', () => _callbacks.onEnemyClick(enemy));
                } else if (reachable) {
                    cell.addEventListener('click', () => _callbacks.onCellClick(tileInfo.pls));
                    // 路径预览：悬停时显示从当前格到目标格的最短路径
                    cell.addEventListener('mouseenter', () => _callbacks.onCellHover(tileInfo.pls));
                    cell.addEventListener('mouseleave', () => _callbacks.onCellLeave());
                } else if (!passable) {
                    // 不可通行格点击反馈
                    cell.style.cursor = 'pointer';
                    cell.addEventListener('click', () => {
                        const msg = name ? '无法通过：' + name : '此处无法通行';
                        dataManager.broadcast('ui:toast', { type: 'error', msg: msg });
                    });
                }
            }
            grid.appendChild(cell);
        }
    }

    // 更新缩放显示
    updateZoomLabel();
}

/**
 * 更新缩放标签
 */
export function updateZoomLabel() {
    const label = document.getElementById('zoomLevel');
    if (label) label.textContent = zoomLevel.toFixed(1) + 'x';
}

/**
 * 应用缩放
 */
export function applyZoom(newZoom) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(newZoom * 100) / 100));
    if (clamped === zoomLevel) return;
    zoomLevel = clamped;
    renderMapGrid();
    // 延迟居中：等缩放操作稳定后再居中，避免连续快速缩放时反复计算
    clearTimeout(applyZoomTimer);
    applyZoomTimer = setTimeout(() => {
        _callbacks.centerOnPlayer(false);
    }, 80);
}

/**
 * 获取当前缩放级别（供 DebugBus 状态注册使用）
 */
export function getZoomLevel() {
    return zoomLevel;
}

// 导出缩放常量（供 map-interaction.js 使用）
export { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP };
