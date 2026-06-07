// ══════════════════════════════════════════════════
// 地图 / Map (HTML 表格风格战场地图)
// 视觉效果类似旧模板 map.htm 的方形网格
// ══════════════════════════════════════════════════

var MAP_ROWS = ['A','B','C','D','E','F','G','H','I','J'];
var MAP_COLS = [1,2,3,4,5,6,7,8,9,10];
var mapData = { curLoc: null, arealist: [], areanum: -1, areaadd: 0, hack: 0, areaMap: {} };

(function() {
    for (var n in XY_COORDS) {
        mapData.areaMap[XY_COORDS[n]] = parseInt(n);
    }
})();

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

function renderMapGrid() {
    var grid = document.getElementById('mapGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // 左上角空白
    var corner = document.createElement('div');
    corner.className = 'map-cell coord';
    corner.textContent = '坐标';
    grid.appendChild(corner);

    // 列标题 1-10
    for (var c = 0; c < 10; c++) {
        var cell = document.createElement('div');
        cell.className = 'map-cell coord';
        cell.textContent = MAP_COLS[c];
        grid.appendChild(cell);
    }

    // 数据行
    for (var r = 0; r < 10; r++) {
        // 行标题 A-J
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

                if (status !== 'danger') {
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

    var result = await gameApi('game_map');
    if (result.status !== 'success') {
        infoEl.innerHTML = '<div class="error">加载失败: ' + escapeHtml(result.message || '未知错误') + '</div>';
        return;
    }
    var d = result.data;
    mapData.curLoc = d.currentLocation !== undefined ? d.currentLocation : null;
    mapData.arealist = (d.arealist || []).map(function(v) { return parseInt(v); });
    mapData.areanum = d.areanum !== undefined ? d.areanum : -1;
    mapData.areaadd = d.areaadd !== undefined ? d.areaadd : 0;
    mapData.hack = d.hack || 0;

    renderMapGrid();

    var curName = mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : '未知';
    var dangerCount = 0;
    for (var i = 0; i < mapData.arealist.length; i++) {
        if (i <= mapData.areanum) dangerCount++;
    }
    infoEl.innerHTML = '位置: <span class="yellow">' + escapeHtml(curName) + '</span>' +
        ' | 禁区数: ' + dangerCount;
}

function clickMove(areaId) {
    if (areaId === undefined || areaId === null) return;
    if (hasFoundItem) {
        alert('附近还有未处理的物品，请先拾取、使用或丢弃后再移动。');
        return;
    }
    submitCommand({ command:'move', moveto: parseInt(areaId) }).then(function(ok) {
        if (ok) {
            loadMap();
            loadPlayerInfo();
            loadItemFind();
            loadInventory();
            refreshLog();
        } else {
            alert('移动失败');
        }
    });
}
