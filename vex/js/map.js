// ══════════════════════════════════════════════════
// 地图 / Map (Oblivions dynamic links map)
// ASCII 终端风格：DOM grid + 字符内容（◆/▸/░/▓/·）
// 支持缩放/平移/自动居中
// ══════════════════════════════════════════════════

import { DebugBus, mapData } from './data.js';
import { escapeHtml, getPlaceName, gameApi } from './utils.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';
import { startBattle } from './battle.js';

// ══════════════════════════════════════════════════
// 缩放状态
// ══════════════════════════════════════════════════

let zoomLevel = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;

// ══════════════════════════════════════════════════
// 可达性判定（BFS 距离缓存）
// ══════════════════════════════════════════════════

// 缓存：从当前格出发，所有可达格的 pls → distance 映射
let reachableMap = new Map();

/**
 * 从当前格 BFS 计算所有 move_range 内可达格的距离
 * 在 renderMapGrid() 中调用，结果缓存到 reachableMap
 */
function computeReachableMap() {
    reachableMap = new Map();
    if (!mapData.links || mapData.curLoc === null || mapData.curRegion === null) return;

    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return;
    const curTile = tiles[mapData.curLoc];
    if (!curTile || !curTile.neighbors) return;

    const moveRange = mapData.links.move_range || 1;
    const fogData = mapData.links.fog;
    const regionFog = fogData && fogData[mapData.curRegion] ? fogData[mapData.curRegion] : {};

    // BFS
    const queue = [[mapData.curLoc, 0]];
    const visited = { [mapData.curLoc]: true };

    while (queue.length > 0) {
        const [curPls, dist] = queue.shift();
        if (dist >= moveRange) continue; // 超过移动距离，不再扩展

        const tile = tiles[curPls];
        if (!tile || !tile.neighbors) continue;

        for (const next of tile.neighbors) {
            if (visited[next]) continue;
            const nextTile = tiles[next];
            if (!nextTile) continue;

            // 不可通行格既不作为中转，也不作为目标
            if (!nextTile.passable) continue;

            visited[next] = true;
            reachableMap.set(next, dist + 1);
            queue.push([next, dist + 1]);
        }
    }

    // 过滤掉迷雾格作为目标（目标格必须非迷雾）
    for (const pls of reachableMap.keys()) {
        if (!regionFog[pls]) {
            reachableMap.delete(pls);
        }
    }
}

function isReachable(areaId) {
    if (!mapData.links) return false;
    if (mapData.curLoc === null || mapData.curRegion === null) return false;

    // 入口格特殊处理：可回退到前区域
    const regions = mapData.links.regions;
    const curRegionInfo = regions[mapData.curRegion];
    if (curRegionInfo && areaId === curRegionInfo.entrance_pls && curRegionInfo.prev_region !== null) {
        return true;
    }

    return reachableMap.has(areaId);
}

function buildCoordIndex(tiles) {
    const index = {};
    for (const pls in tiles) {
        const t = tiles[pls];
        index[t.x + ',' + t.y] = { pls: parseInt(pls), tile: t };
    }
    return index;
}

// ══════════════════════════════════════════════════
// ASCII 地图渲染
// ══════════════════════════════════════════════════

function renderMapGrid() {
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
    if (!renderMapGrid._zoomInitialized) {
        const fitZoomX = containerWidth / (cols * baseSize);
        const containerHeight = grid.parentElement.offsetHeight - 16;
        const fitZoomY = containerHeight / (rows * baseHeight);
        const fitZoom = Math.min(fitZoomX, fitZoomY);
        zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom * 1.25));
        // 四舍五入到 0.05 精度
        zoomLevel = Math.round(zoomLevel * 20) / 20;
        renderMapGrid._zoomInitialized = true;
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
            const passable = !empty(tileInfo.tile.passable);
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
                cell.addEventListener('click', () => clickMove(tileInfo.pls));
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
                const enemy = mapData.enemies.find(e => parseInt(e.pls) === tileInfo.pls);
                if (enemy) {
                    cell.innerHTML = '<span class="cell-name"><span class="cell-enemy">[' + escapeHtml(enemy.name) + ']</span>' + escapeHtml(label) + '</span>';
                } else {
                    cell.innerHTML = label ? '<span class="cell-name" style="font-size:' + nameFontSize + 'px">' + escapeHtml(label) + '</span>' : '<span class="cell-coord">' + coordLabel + '</span>';
                }

                if (enemy) {
                    // 敌人格：点击发起攻击（进入 prebattle）
                    cell.style.cursor = 'crosshair';
                    cell.title = '点击攻击 ' + enemy.name;
                    cell.addEventListener('click', () => {
                        // 前端校验攻击距离（阶段一射程=1，相邻格）
                        // Oblivions 命令返回空 {}，无法依赖后端错误反馈，需前端自行拦截
                        const path = findPath(mapData.curLoc, tileInfo.pls);
                        const distance = path ? path.length - 1 : -1;
                        if (distance !== 1) {
                            dataManager.broadcast('ui:toast', { type: 'error', msg: '目标距离过远，需先靠近' });
                            return;
                        }
                        startBattle(parseInt(enemy.pid));
                    });
                } else if (reachable) {
                    cell.addEventListener('click', () => clickMove(tileInfo.pls));
                    // 路径预览：悬停时显示从当前格到目标格的最短路径
                    cell.addEventListener('mouseenter', () => showPathPreview(tileInfo.pls));
                    cell.addEventListener('mouseleave', () => clearPathPreview());
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

// 兼容空值判断（passable 可能是 true/1/''）
function empty(v) { return v === undefined || v === null || v === '' || v === 0 || v === false; }

// ══════════════════════════════════════════════════
// BFS 最短路径（基于 neighbors 连通关系）
// ══════════════════════════════════════════════════

/**
 * 计算从 fromPls 到 toPls 的最短路径
 * 纯 neighbors BFS，跳过不可通行中转格（与后端 obl_get_distance 一致）
 * @returns {number[]} pls 数组（含起点和终点），找不到返回 null
 */
function findPath(fromPls, toPls) {
    if (!mapData.links || mapData.curRegion === null) return null;
    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles || !tiles[fromPls] || !tiles[toPls]) return null;

    if (fromPls === toPls) return [fromPls];

    const queue = [fromPls];
    const visited = { [fromPls]: true };
    const parent = {};

    while (queue.length > 0) {
        const cur = queue.shift();
        const tile = tiles[cur];
        if (!tile || !tile.neighbors) continue;

        for (const next of tile.neighbors) {
            if (visited[next]) continue;
            const nextTile = tiles[next];
            if (!nextTile) continue;

            // 中转格必须可通行（与后端 obl_get_distance 一致），目标格除外
            if (next !== toPls && !nextTile.passable) continue;

            visited[next] = true;
            parent[next] = cur;

            if (next === toPls) {
                // 回溯路径
                const path = [toPls];
                let p = toPls;
                while (parent[p] !== undefined) {
                    p = parent[p];
                    path.unshift(p);
                }
                return path;
            }
            queue.push(next);
        }
    }
    return null;
}

/**
 * 根据两个格子的坐标差计算方向箭头
 */
function getDirectionArrow(fromTile, toTile) {
    const dx = toTile.x - fromTile.x;
    const dy = toTile.y - fromTile.y;
    if (dx === 0 && dy < 0) return '↑';
    if (dx === 0 && dy > 0) return '↓';
    if (dx < 0 && dy === 0) return '←';
    if (dx > 0 && dy === 0) return '→';
    if (dx > 0 && dy < 0) return '↗';
    if (dx > 0 && dy > 0) return '↘';
    if (dx < 0 && dy < 0) return '↖';
    if (dx < 0 && dy > 0) return '↙';
    return '';
}

/**
 * 清除所有路径预览高亮
 */
function clearPathPreview() {
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
function showPathPreview(targetPls) {
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

// ══════════════════════════════════════════════════
// 键盘方向键移动
// ══════════════════════════════════════════════════

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

    // 执行移动（复用 clickMove）
    await clickMove(targetPls);
}

/**
 * 当前格抖动反馈（无效移动时）
 */
function shakeCurrentCell() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    const cell = grid.querySelector('.map-cell.current');
    if (!cell) return;
    cell.classList.add('cell-shake');
    setTimeout(() => cell.classList.remove('cell-shake'), 300);
}

// ══════════════════════════════════════════════════
// 自动居中
// ══════════════════════════════════════════════════

function centerOnPlayer(smooth = true) {
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

// ══════════════════════════════════════════════════
// 缩放标签更新
// ══════════════════════════════════════════════════

function updateZoomLabel() {
    const label = document.getElementById('zoomLevel');
    if (label) label.textContent = zoomLevel.toFixed(1) + 'x';
}

// ══════════════════════════════════════════════════
// 缩放操作
// ══════════════════════════════════════════════════

function applyZoom(newZoom) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(newZoom * 100) / 100));
    if (clamped === zoomLevel) return;
    zoomLevel = clamped;
    renderMapGrid();
    // 延迟居中：等缩放操作稳定后再居中，避免连续快速缩放时反复计算
    clearTimeout(applyZoom._centerTimer);
    applyZoom._centerTimer = setTimeout(() => {
        centerOnPlayer(false);
    }, 80);
}

// ══════════════════════════════════════════════════
// 交互事件初始化（缩放/平移/触摸/双击）
// ══════════════════════════════════════════════════

function initMapInteraction() {
    const container = document.getElementById('mapContainer');
    if (!container) return;

    // ─── 滚轮缩放（桌面端，Ctrl+滚轮） ───
    container.addEventListener('wheel', function(e) {
        e.preventDefault(); // 阻止默认滚动，无论是否 Ctrl
        if (!e.ctrlKey) return; // 仅 Ctrl+滚轮触发缩放
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        applyZoom(zoomLevel + delta);
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
            touchStartZoom = zoomLevel;
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
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoom(zoomLevel + ZOOM_STEP));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoom(zoomLevel - ZOOM_STEP));

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

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// ══════════════════════════════════════════════════
// 加载地图数据
// ══════════════════════════════════════════════════

export async function loadMap() {
    const infoEl = document.getElementById('mapInfo');
    if (infoEl) infoEl.innerHTML = '<span class="grey">loading...</span>';

    DebugBus.emit('api', 'loadMap:start', { action: 'game_map' });
    const t0 = Date.now();
    const result = await gameApi('game_map');
    const elapsed = Date.now() - t0;

    DebugBus.emit('api', 'loadMap:response', {
        elapsed_ms: elapsed,
        status: result.status,
        hasLinks: !!(result.data && result.data.links)
    });

    if (result.status !== 'success') {
        if (infoEl) infoEl.innerHTML = '<span class="grey">load failed</span>';
        return;
    }
    const d = result.data;
    const prevRegion = mapData.curRegion;
    mapData.curLoc = d.currentLocation !== undefined ? d.currentLocation : null;
    mapData.curRegion = d.currentRegion !== undefined ? d.currentRegion : null;
    mapData.links = d.links || null;

    // 区域切换 CRT 闪烁过渡
    if (prevRegion !== null && prevRegion !== mapData.curRegion) {
        const grid = document.getElementById('mapGrid');
        if (grid) {
            grid.classList.add('crt-transition');
            setTimeout(() => grid.classList.remove('crt-transition'), 500);
        }
    }

    // 加载敌人数据（在渲染前获取，确保敌人标记与地图同步显示）
    try {
        const enemiesResult = await gameApi('enemies');
        mapData.enemies = (enemiesResult.status === 'success' && enemiesResult.data)
            ? (enemiesResult.data.enemies || [])
            : [];
    } catch (e) {
        mapData.enemies = [];
    }

    renderMapGrid();
    // 渲染后居中到玩家位置
    requestAnimationFrame(() => centerOnPlayer(true));

    // mapInfo 状态行
    const curName = mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : 'unknown';
    let infoText = '> LOC: <span class="yellow">' + escapeHtml(curName) + '</span>';
    if (mapData.links && mapData.curRegion !== null) {
        const regionInfo = mapData.links.regions[mapData.curRegion];
        if (regionInfo) {
            infoText += ' | REGION: ' + escapeHtml(regionInfo.name);
        }
    }
    if (infoEl) infoEl.innerHTML = infoText;

    // 统一状态栏：由 player.js 管理，地图加载完成后广播 map:loaded
    dataManager.broadcast('map:loaded', { curLoc: mapData.curLoc, curRegion: mapData.curRegion, hasLinks: !!mapData.links });
}

// ══════════════════════════════════════════════════
// 点击移动 / 点击当前格探索
// ══════════════════════════════════════════════════

async function clickMove(areaId) {
    if (areaId === undefined || areaId === null) return;

    // 点击当前格 → 触发探索（广播事件，tile-action 监听执行）
    if (areaId === mapData.curLoc) {
        dataManager.broadcast('map:click-current');
        return;
    }

    DebugBus.emit('action', 'clickMove:trigger', { target: areaId, current: mapData.curLoc });

    const cmdParams = { command: 'move', moveto: parseInt(areaId) };
    const t0 = Date.now();
    try {
        const result = await commandQueue.execute(cmdParams);
        DebugBus.emit('action', 'clickMove:response', { elapsed_ms: Date.now() - t0, success: result.success });
        if (result.success) {
            // 统一刷新：地图优先（触发 map:loaded），其余由 game:action-completed 订阅刷新
            dataManager.invalidateAll();
            await loadMap();
            dataManager.broadcast('game:action-completed');
            // 移动路径高亮：目标格闪烁
            highlightCell(areaId);
        } else {
            DebugBus.emit('action', 'clickMove:failed', { moveto: areaId, error: result.error });
            dataManager.broadcast('ui:toast', { type: 'error', msg: 'move failed' + (result.error ? ': ' + result.error : '') });
        }
    } catch (err) {
        DebugBus.emit('error', 'clickMove:error', { error: err.message || String(err) });
        dataManager.broadcast('ui:toast', { type: 'error', msg: 'move failed' });
    }
}

// ══════════════════════════════════════════════════
// 移动路径高亮
// ══════════════════════════════════════════════════

function highlightCell(areaId) {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    const cells = grid.querySelectorAll('.map-cell');
    for (const cell of cells) {
        if (cell.dataset.pls == areaId) {
            cell.classList.add('move-highlight');
            setTimeout(() => cell.classList.remove('move-highlight'), 600);
            break;
        }
    }
}

// ══════════════════════════════════════════════════
// 调试状态钩子（保留）
// ══════════════════════════════════════════════════

// 战斗结束 → 刷新地图（敌人可能已死亡，需从地图移除）
dataManager.listen('battle:ended', function() {
    loadMap();
});

DebugBus.registerState('map', function() {
    const tiles = (mapData.links && mapData.curRegion) ? mapData.links.tiles[mapData.curRegion] : null;
    const curTile = tiles && mapData.curLoc !== null ? tiles[mapData.curLoc] : null;
    const regionInfo = (mapData.links && mapData.curRegion) ? mapData.links.regions[mapData.curRegion] : null;
    return {
        pgroup: mapData.curRegion,
        pls: mapData.curLoc,
        regionName: regionInfo ? regionInfo.name : null,
        tileName: curTile ? curTile.name : null,
        hasLinks: !!mapData.links,
        zoomLevel: zoomLevel
    };
});

// 导出初始化函数
export { initMapInteraction };
