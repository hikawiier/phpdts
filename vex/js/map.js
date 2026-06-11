// ══════════════════════════════════════════════════
// 地图 / Map (HTML 表格风格战场地图)
// 视觉效果类似旧模板 map.htm 的方形网格
// ══════════════════════════════════════════════════

var MAP_ROWS = ['A','B','C','D','E','F','G','H','I','J'];
var MAP_COLS = [1,2,3,4,5,6,7,8,9,10];
var mapData = { curLoc: null, curRegion: null, arealist: [], areanum: -1, areaadd: 0, hack: 0, areaMap: {}, links: null };

(function() {
    for (var n in XY_COORDS) {
        mapData.areaMap[XY_COORDS[n]] = parseInt(n);
    }
})();

// ══════════════════════════════════════════════════
// 移动调试日志 / Move debug log (委托 Debug 模块)
// ══════════════════════════════════════════════════

var moveDebugLog = [];

function moveDebugAdd(step, data) {
    Debug.add(Debug.CATEGORIES.MAP, step, data);
}

function toggleMoveDebug() {
    Debug.togglePanel();
}

// ══════════════════════════════════════════════════
// 地图表格渲染 / Map grid renderer
// ══════════════════════════════════════════════════

function getAreaStatus(areaId) {
    if (!mapData.arealist || !mapData.arealist.length) return 'safe';
    var id = parseInt(areaId);
    var idx = -1;
    for (var i = 0; i < mapData.arealist.length; i++) {
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
    // 非 links 模式：使用旧版禁区判定
    if (!mapData.links) {
        return getAreaStatus(areaId) !== 'danger';
    }
    // links 模式：检查当前格 neighbors 是否包含目标格
    if (mapData.curLoc === null || mapData.curRegion === null) return false;
    var tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return false;
    var curTile = tiles[mapData.curLoc];
    if (!curTile || !curTile.neighbors) return false;
    return curTile.neighbors.indexOf(areaId) !== -1;
}

function getTileByCoord(coord) {
    // 在 links 模式下，根据坐标查找当前区域的 tile
    if (!mapData.links || !mapData.curRegion) return null;
    var tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return null;
    for (var pls in tiles) {
        var t = tiles[pls];
        if (t.x === coord.x && t.y === coord.y) {
            return { pls: parseInt(pls), tile: t };
        }
    }
    return null;
}

function renderMapGrid() {
    var grid = document.getElementById('mapGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // links 模式：动态网格渲染
    if (mapData.links && mapData.curRegion) {
        var regionGrid = mapData.links.grids[mapData.curRegion];
        if (!regionGrid) { grid.innerHTML = '<div class="error">无区域网格数据</div>'; return; }
        var cols = regionGrid.cols || 10;
        var rows = regionGrid.rows || 10;

        // 动态设置网格模板
        grid.style.gridTemplateColumns = '38px repeat(' + cols + ', 52px)';
        grid.style.gridTemplateRows = '32px repeat(' + rows + ', 44px)';

        // 列标题
        var corner = document.createElement('div');
        corner.className = 'map-cell coord';
        corner.textContent = '坐标';
        grid.appendChild(corner);
        for (var c = 0; c < cols; c++) {
            var cell = document.createElement('div');
            cell.className = 'map-cell coord';
            cell.textContent = (c + 1);
            grid.appendChild(cell);
        }

        // 数据行
        for (var r = 0; r < rows; r++) {
            var rowHeader = document.createElement('div');
            rowHeader.className = 'map-cell coord';
            rowHeader.textContent = MAP_ROWS[r] || String.fromCharCode(65 + r);
            grid.appendChild(rowHeader);

            for (c = 0; c < cols; c++) {
                var tileInfo = getTileByCoord({ x: c, y: r });
                cell = document.createElement('div');
                cell.className = 'map-cell';

                if (!tileInfo) {
                    cell.className += ' empty';
                } else {
                    var isCurrent = tileInfo.pls === mapData.curLoc;
                    var reachable = isReachable(tileInfo.pls);
                    var isExit = mapData.links.regions[mapData.curRegion] &&
                                 tileInfo.pls === mapData.links.regions[mapData.curRegion].exit_pls;

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

                    var html = '<span class="cell-name">' + escapeHtml(tileInfo.tile.name) + '</span>';
                    if (isCurrent) html += '<span class="cell-cur">★</span>';
                    cell.innerHTML = html;

                    if (isCurrent || reachable) {
                        cell.onclick = (function(pls) {
                            return function() { clickMove(pls); };
                        })(tileInfo.pls);
                    }
                }
                grid.appendChild(cell);
            }
        }
        return;
    }

    // 旧版：10×10 固定网格渲染
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
    var corner = document.createElement('div');
    corner.className = 'map-cell coord';
    corner.textContent = '坐标';
    grid.appendChild(corner);

    for (var c = 0; c < 10; c++) {
        var cell = document.createElement('div');
        cell.className = 'map-cell coord';
        cell.textContent = MAP_COLS[c];
        grid.appendChild(cell);
    }

    for (var r = 0; r < 10; r++) {
        var rowHeader = document.createElement('div');
        rowHeader.className = 'map-cell coord';
        rowHeader.textContent = MAP_ROWS[r];
        grid.appendChild(rowHeader);

        for (var c = 0; c < 10; c++) {
            var coord = MAP_ROWS[r] + '-' + MAP_COLS[c];
            var areaId = mapData.areaMap[coord];

            var cell = document.createElement('div');
            cell.className = 'map-cell';

            if (areaId === undefined) {
                cell.className += ' empty';
            } else {
                var status = getAreaStatus(areaId);
                var isCurrent = areaId === mapData.curLoc;
                var reachable = isReachable(areaId);

                if (isCurrent) {
                    cell.className += ' current';
                } else {
                    cell.className += ' ' + status;
                }

                var name = getPlaceName(areaId);
                var html = '<span class="cell-name">' + escapeHtml(name) + '</span>';
                if (isCurrent) {
                    html += '<span class="cell-cur">★</span>';
                }
                cell.innerHTML = html;

                if (isCurrent || reachable) {
                    cell.onclick = (function(id) {
                        return function() { clickMove(id); };
                    })(areaId);
                }
            }
            grid.appendChild(cell);
        }
    }
}

async function loadMap() {
    var infoEl = document.getElementById('mapInfo');
    infoEl.innerHTML = '<div class="loading">加载中...</div>';

    Debug.add(Debug.CATEGORIES.API, 'loadMap:start', { action: 'game_map' });
    var t0 = Date.now();
    var result = await gameApi('game_map');
    var elapsed = Date.now() - t0;

    Debug.add(Debug.CATEGORIES.API, 'loadMap:response', {
        elapsed_ms: elapsed,
        status: result.status,
        code: result.code || '',
        message: result.message || '',
        data: result.data
    });

    if (result.status !== 'success') {
        infoEl.innerHTML = '<div class="error">加载失败: ' + escapeHtml(result.message || '未知错误') + '</div>';
        return;
    }
    var d = result.data;
    mapData.curLoc = d.currentLocation !== undefined ? d.currentLocation : null;
    mapData.curRegion = d.currentRegion !== undefined ? d.currentRegion : null;
    mapData.arealist = (d.arealist || []).map(function(v) { return parseInt(v); });
    mapData.areanum = d.areanum !== undefined ? d.areanum : -1;
    mapData.areaadd = d.areaadd !== undefined ? d.areaadd : 0;
    mapData.hack = d.hack || 0;
    mapData.links = d.links || null;

    renderMapGrid();

    var curName = mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : '未知';
    var infoText = '位置: <span class="yellow">' + escapeHtml(curName) + '</span>';
    if (mapData.links) {
        var tiles = mapData.links.tiles[mapData.curRegion];
        var curTile = tiles && mapData.curLoc !== null ? tiles[mapData.curLoc] : null;
        var linkCount = curTile && curTile.neighbors ? curTile.neighbors.length : 0;
        infoText += ' | 相邻格: ' + linkCount;
    } else {
        var dangerCount = 0;
        for (var i = 0; i < mapData.arealist.length; i++) {
            if (i <= mapData.areanum) dangerCount++;
        }
        infoText += ' | 禁区数: ' + dangerCount;
    }
    infoEl.innerHTML = infoText;
}

function clickMove(areaId) {
    if (areaId === undefined || areaId === null) return;

    Debug.add(Debug.CATEGORIES.ACTION, 'clickMove:trigger', {
        target_areaId: areaId,
        target_placeName: getPlaceName(areaId),
        current_pls: mapData.curLoc,
        current_placeName: mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : '未知',
        hasFoundItem: hasFoundItem,
        mapData_snapshot: {
            curLoc: mapData.curLoc,
            curRegion: mapData.curRegion,
            arealist: mapData.arealist,
            areanum: mapData.areanum,
            areaadd: mapData.areaadd,
            hack: mapData.hack
        }
    });

    if (hasFoundItem) {
        Debug.add(Debug.CATEGORIES.ACTION, 'clickMove:blocked', { reason: 'hasFoundItem' });
        alert('附近还有未处理的物品，请先拾取、使用或丢弃后再移动。');
        return;
    }

    var cmdParams = { command: 'move', moveto: parseInt(areaId) };
    Debug.add(Debug.CATEGORIES.ACTION, 'clickMove:submit', {
        url: BASE_URL + '/command.php',
        method: 'POST',
        params: cmdParams
    });

    var t0 = Date.now();
    submitCommand(cmdParams).then(function(ok) {
        var elapsed = Date.now() - t0;
        Debug.add(Debug.CATEGORIES.ACTION, 'clickMove:response', {
            elapsed_ms: elapsed,
            success: ok
        });
        if (ok) {
            Promise.all([
                loadMap(),
                loadPlayerInfo(),
                loadItemFind(),
                loadInventory(),
                refreshLog()
            ]).finally(function() {
                Debug.flush();
            });
        } else {
            Debug.add(Debug.CATEGORIES.ACTION, 'clickMove:failed', {
                command: 'move',
                moveto: areaId
            });
            Debug.flush();
            alert('移动失败');
        }
    }).catch(function(err) {
        Debug.add(Debug.CATEGORIES.ACTION, 'clickMove:error', {
            error: err.message || String(err)
        });
        Debug.flush();
        alert('移动失败');
    });
}
