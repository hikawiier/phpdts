// ══════════════════════════════════════════════════
// 地图 / Map (Oblivions dynamic links map)
// ASCII 终端风格：DOM grid + 字符内容（◆/▸/░/▓/·）
// 支持缩放/平移/自动居中
// ══════════════════════════════════════════════════

import { DebugBus, mapData } from './data.js';
import { escapeHtml, getPlaceName, gameApi } from './utils.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';

// ══════════════════════════════════════════════════
// 缩放状态
// ══════════════════════════════════════════════════

let zoomLevel = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;

// ══════════════════════════════════════════════════
// 可达性判定
// ══════════════════════════════════════════════════

function isReachable(areaId) {
    if (!mapData.links) return false;
    if (mapData.curLoc === null || mapData.curRegion === null) return false;
    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return false;
    const curTile = tiles[mapData.curLoc];
    if (!curTile || !curTile.neighbors) return false;

    if (curTile.neighbors.indexOf(areaId) !== -1) {
        // 迷雾格不可作为移动目标
        const fogData = mapData.links.fog;
        const regionFog = fogData && fogData[mapData.curRegion] ? fogData[mapData.curRegion] : {};
        if (!regionFog[areaId]) return false;
        return true;
    }

    // 入口格特殊处理：可回退到前区域
    const regions = mapData.links.regions;
    const curRegionInfo = regions[mapData.curRegion];
    if (curRegionInfo && areaId === curRegionInfo.entrance_pls && curRegionInfo.prev_region !== null) {
        return true;
    }
    return false;
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

            if (isDeep) cell.className += ' tide-deep';
            if (isMetal) cell.className += ' floor-metal';
            if (isSafe) cell.className += ' safe-zone';

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
            } else if (!passable) {
                cell.className += ' blocked';
                const prefix = isExit ? '▸' : (isEntrance ? '◂' : '');
                const label = prefix + name;
                cell.innerHTML = label ? '<span class="cell-name" style="font-size:' + nameFontSize + 'px">' + escapeHtml(label) + '</span>' : '<span class="cell-name" style="font-size:' + nameFontSize + 'px">·</span>';
                cell.style.cursor = 'pointer';
                cell.addEventListener('click', () => {
                    const msg = name ? '无法通过：' + name : '此处无法通行';
                    if (typeof showToast === 'function') showToast(msg, 'error');
                });
            } else {
                const reachable = isReachable(tileInfo.pls);
                if (reachable) {
                    cell.className += ' reachable';
                } else {
                    cell.className += ' unreachable';
                }
                if (isExit) cell.className += ' exit-tile';
                if (isEntrance) cell.className += ' entrance-tile';

                const prefix = isExit ? '▸' : (isEntrance ? '◂' : '');
                const label = prefix + name;
                cell.innerHTML = label ? '<span class="cell-name" style="font-size:' + nameFontSize + 'px">' + escapeHtml(label) + '</span>' : '<span class="cell-name" style="font-size:' + nameFontSize + 'px">·</span>';

                if (reachable) {
                    cell.addEventListener('click', () => clickMove(tileInfo.pls));
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
        if (!e.ctrlKey) return; // 仅 Ctrl+滚轮触发缩放
        e.preventDefault();
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

    // 填充头部状态行 + 底部状态栏（地图维度信息）
    let regionName = 'unknown';
    let curNameShort = curName;
    if (mapData.links && mapData.curRegion !== null && mapData.links.regions[mapData.curRegion]) {
        regionName = mapData.links.regions[mapData.curRegion].name || 'unknown';
    }
    const headerEl = document.getElementById('headerStatus');
    if (headerEl) {
        headerEl.innerHTML =
            '<span>> SECTOR: ' + escapeHtml(regionName) + '</span>'
            + '<span>|</span>'
            + '<span>LOC: ' + escapeHtml(curNameShort) + '</span>'
            + '<span class="ml-auto text-fg-mid">█ SYSTEM ONLINE <span class="cursor-blink">█</span></span>';
    }
    const footerEl = document.getElementById('statusBar');
    if (footerEl) {
        footerEl.innerHTML =
            '<span>> REGION: ' + escapeHtml(regionName) + '</span>'
            + '<span>|</span>'
            + '<span>LOC: ' + escapeHtml(curNameShort) + '</span>'
            + '<span class="ml-auto text-fg-dim/50">OBLIVIONS v0.1</span>';
    }

    // 地图加载完成 → 广播事件（tile-action/inventory 监听刷新）
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
