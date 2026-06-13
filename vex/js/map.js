// ══════════════════════════════════════════════════
// 地图 / Map (Oblivions dynamic links map)
// ══════════════════════════════════════════════════

import { DebugBus, mapData } from './data.js';
import { escapeHtml, getPlaceName, gameApi } from './utils.js';
import { hasFoundItem, loadItemFind, loadInventory } from './inventory.js';
import { loadPlayerInfo } from './player.js';
import { refreshLog } from './log.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';

// ══════════════════════════════════════════════════
// 地图表格渲染 / Map grid renderer
// ══════════════════════════════════════════════════

function getAreaStatus(areaId) {
    if (!mapData.arealist || !mapData.arealist.length) return 'safe';
    const id = parseInt(areaId);
    let idx = -1;
    for (let i = 0; i < mapData.arealist.length; i++) {
        if (parseInt(mapData.arealist[i]) === id) {
            idx = i;
            break;
        }
    }
    if (idx === -1) return 'safe';
    if (mapData.hack) return 'safe';
    if (idx <= mapData.areanum) return 'danger';
    if (idx <= (mapData.areanum + mapData.areaadd)) return 'warning';
    return 'safe';
}

function isReachable(areaId) {
    if (!mapData.links) {
        return getAreaStatus(areaId) !== 'danger';
    }
    if (mapData.curLoc === null || mapData.curRegion === null) return false;
    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return false;
    const curTile = tiles[mapData.curLoc];
    if (!curTile || !curTile.neighbors) return false;

    if (curTile.neighbors.indexOf(areaId) !== -1) return true;

    // 入口格特殊处理：在相邻格上，且当前区域可回退到前区域
    const regions = mapData.links.regions;
    const curRegionInfo = regions[mapData.curRegion];
    if (curRegionInfo && areaId === curRegionInfo.entrance_pls && curRegionInfo.prev_region !== null) {
        return true;
    }

    return false;
}

function buildCoordIndex(tiles) {
    const index = {};  // "x,y" -> { pls, tile }
    for (const pls in tiles) {
        const t = tiles[pls];
        index[t.x + ',' + t.y] = { pls: parseInt(pls), tile: t };
    }
    return index;
}

function renderMapGrid() {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // links mode: dynamic grid
    if (mapData.links && mapData.curRegion) {
        const regionGrid = mapData.links.grids[mapData.curRegion];
        if (!regionGrid) { grid.innerHTML = '<div class="error">no grid data</div>'; return; }
        const cols = regionGrid.cols || 10;
        const rows = regionGrid.rows || 10;

        grid.style.gridTemplateColumns = '38px repeat(' + cols + ', 52px)';
        grid.style.gridTemplateRows = '32px repeat(' + rows + ', 44px)';

        const corner = document.createElement('div');
        corner.className = 'map-cell coord';
        corner.textContent = 'coord';
        grid.appendChild(corner);
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'map-cell coord';
            cell.textContent = c;
            grid.appendChild(cell);
        }

        const tiles = mapData.links.tiles[mapData.curRegion];
        const coordIndex = tiles ? buildCoordIndex(tiles) : {};

        for (let r = 0; r < rows; r++) {
            const rowHeader = document.createElement('div');
            rowHeader.className = 'map-cell coord';
            rowHeader.textContent = String.fromCharCode(65 + r);
            grid.appendChild(rowHeader);

            for (let c = 0; c < cols; c++) {
                const tileInfo = coordIndex[c + ',' + r];
                let cell = document.createElement('div');
                cell.className = 'map-cell';

                if (!tileInfo) {
                    cell.className += ' empty';
                } else {
                    const isCurrent = tileInfo.pls === mapData.curLoc;
                    const reachable = isReachable(tileInfo.pls);
                    const isExit = mapData.links.regions[mapData.curRegion] &&
                                 tileInfo.pls === mapData.links.regions[mapData.curRegion].exit_pls;
                    const isEntrance = mapData.links.regions[mapData.curRegion] &&
                                     tileInfo.pls === mapData.links.regions[mapData.curRegion].entrance_pls &&
                                     mapData.links.regions[mapData.curRegion].prev_region !== null;

                    if (isCurrent) {
                        cell.className += ' current';
                    } else if (!tileInfo.tile.passable) {
                        cell.className += ' blocked';
                    } else if (reachable) {
                        cell.className += ' safe';
                    } else {
                        cell.className += ' unreachable';
                    }
                    if (isExit) {
                        cell.className += ' exit-tile';
                    }
                    if (isEntrance) {
                        cell.className += ' entrance-tile';
                    }

                    let html = '<span class="cell-name">' + escapeHtml(tileInfo.tile.name) + '</span>';
                    if (isCurrent) html += '<span class="cell-cur">*</span>';
                    cell.innerHTML = html;

                    if (isCurrent || reachable) {
                        cell.onclick = ((pls) => () => clickMove(pls))(tileInfo.pls);
                    }
                }
                grid.appendChild(cell);
            }
        }
        return;
    }

    // no links data — Oblivions 模式下 links 必须存在
    grid.innerHTML = '<div class="error">地图数据加载失败，请刷新页面重试</div>';
}

export async function loadMap() {
    const infoEl = document.getElementById('mapInfo');
    infoEl.innerHTML = '<div class="loading">loading...</div>';

    DebugBus.emit('api', 'loadMap:start', { action: 'game_map' });
    const t0 = Date.now();
    const result = await gameApi('game_map');
    const elapsed = Date.now() - t0;

    DebugBus.emit('api', 'loadMap:response', {
        elapsed_ms: elapsed,
        status: result.status,
        code: result.code || '',
        message: result.message || '',
        currentLocation: result.data ? result.data.currentLocation : null,
        currentRegion: result.data ? result.data.currentRegion : null,
        hasLinks: !!(result.data && result.data.links)
    });

    if (result.status !== 'success') {
        infoEl.innerHTML = '<div class="error">load failed: ' + escapeHtml(result.message || 'unknown') + '</div>';
        return;
    }
    const d = result.data;
    mapData.curLoc = d.currentLocation !== undefined ? d.currentLocation : null;
    mapData.curRegion = d.currentRegion !== undefined ? d.currentRegion : null;
    mapData.arealist = (d.arealist || []).map(function(v) { return parseInt(v); });
    mapData.areanum = d.areanum !== undefined ? d.areanum : -1;
    mapData.areaadd = d.areaadd !== undefined ? d.areaadd : 0;
    mapData.hack = d.hack || 0;
    mapData.links = d.links || null;

    renderMapGrid();

    const curName = mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : 'unknown';
    let infoText = 'Location: <span class="yellow">' + escapeHtml(curName) + '</span>';
    if (mapData.links && mapData.links.tiles && mapData.curRegion !== null) {
        const tiles = mapData.links.tiles[mapData.curRegion];
        const curTile = tiles && mapData.curLoc !== null ? tiles[mapData.curLoc] : null;
        const linkCount = curTile && curTile.neighbors ? curTile.neighbors.length : 0;
        infoText += ' | neighbors: ' + linkCount;
    }
    infoEl.innerHTML = infoText;
}

function clickMove(areaId) {
    if (areaId === undefined || areaId === null) return;

    DebugBus.emit('action', 'clickMove:trigger', {
        target_areaId: areaId,
        target_placeName: getPlaceName(areaId),
        current_pls: mapData.curLoc,
        current_region: mapData.curRegion,
        hasFoundItem: hasFoundItem
    });

    if (hasFoundItem) {
        DebugBus.emit('action', 'clickMove:blocked', { reason: 'hasFoundItem' });
        alert('There are items nearby. Pick them up, use or discard them before moving.');
        return;
    }

    const cmdParams = { command: 'move', moveto: parseInt(areaId) };
    DebugBus.emit('action', 'clickMove:submit', { params: cmdParams });

    const t0 = Date.now();
    commandQueue.execute(cmdParams).then(function(result) {
        const elapsed = Date.now() - t0;
        DebugBus.emit('action', 'clickMove:response', {
            elapsed_ms: elapsed,
            success: result.success
        });
        if (result.success) {
            dataManager.invalidateAll();
            Promise.all([
                loadMap(),
                loadPlayerInfo(),
                loadItemFind(),
                loadInventory(),
                refreshLog()
            ]);
        } else {
            DebugBus.emit('action', 'clickMove:failed', { moveto: areaId, error: result.error });
            alert('move failed' + (result.error ? ': ' + result.error : ''));
        }
    }).catch(function(err) {
        DebugBus.emit('error', 'clickMove:error', { error: err.message || String(err) });
        alert('move failed');
    });
}

// 注册地图状态钩子 / Register map state hook
DebugBus.registerState('map', function() {
    const tiles = (mapData.links && mapData.curRegion) ? mapData.links.tiles[mapData.curRegion] : null;
    const curTile = tiles && mapData.curLoc !== null ? tiles[mapData.curLoc] : null;
    const regionInfo = (mapData.links && mapData.curRegion) ? mapData.links.regions[mapData.curRegion] : null;
    return {
        pgroup: mapData.curRegion,
        pls: mapData.curLoc,
        regionName: regionInfo ? regionInfo.name : null,
        tileName: curTile ? curTile.name : null,
        neighbors: curTile ? curTile.neighbors : [],
        hasLinks: !!mapData.links
    };
});

// 注册渲染状态钩子 / Register render state hook
DebugBus.registerState('render', function() {
    const grid = document.getElementById('mapGrid');
    const log = document.getElementById('logContent');
    const inv = document.getElementById('inventoryList');
    const itemFind = document.getElementById('itemFindArea');
    return {
        panels: {
            mapGrid: grid ? {
                visible: grid.offsetParent !== null,
                childCount: grid.children.length,
                inlineStyle: grid.getAttribute('style') || ''
            } : null,
            logContent: log ? {
                visible: log.offsetParent !== null,
                scrollHeight: log.scrollHeight,
                clientHeight: log.clientHeight,
                scrollTop: log.scrollTop
            } : null,
            inventoryList: inv ? { visible: inv.offsetParent !== null, childCount: inv.children.length } : null,
            itemFindArea: itemFind ? { visible: itemFind.offsetParent !== null } : null
        },
        viewport: {
            w: window.innerWidth,
            h: window.innerHeight,
            dpr: window.devicePixelRatio || 1
        }
    };
});
