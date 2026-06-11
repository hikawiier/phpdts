// ══════════════════════════════════════════════════
// 调试模块 / Debug Module
// 独立的前端调试面板，记录所有API响应和操作数据
// 使用方式：访问页面时加 ?debug=1 启用
// AI 可读模式：?debug=1 时页面底部输出 [VEX DEBUG] 纯文本转储
// ══════════════════════════════════════════════════

var Debug = (function() {
    var CATEGORIES = {
        API: 'api',
        MAP: 'map',
        PLAYER: 'player',
        INVENTORY: 'inventory',
        LOG: 'log',
        ACTION: 'action'
    };

    var logs = {};
    var maxEntries = 50;
    var panelOpen = false;
    var currentTab = 'api';
    var enabled = false;

    // ---- AI dump 专用状态 ----
    var apiCallLog = [];
    var actionLog = [];
    var dumpElement = null;
    var _dumpPending = false;
    var _dumpTimeoutId = null;
    var MAX_API_LOG = 50;
    var MAX_ACTION_LOG = 30;
    var _apiSeq = 0;
    var _actionSeq = 0;

    function init() {
        var params = new URLSearchParams(window.location.search);
        if (params.get('debug') === '1' || params.get('debug') === 'ai') {
            enabled = true;
            createPanel();
            createAiDumpElement();
            console.log('[Debug] debug mode enabled');
            Promise.resolve().then(function() {
                renderAiDump();
            });
        }
    }

    function createPanel() {
        var panel = document.createElement('div');
        panel.id = 'debugPanel';
        panel.className = 'debug-panel';
        panel.style.display = 'none';
        panel.innerHTML =
            '<div class="debug-header">' +
                '<h3>Debug Panel</h3>' +
                '<div class="debug-tabs">' +
                    '<button class="debug-tab active" data-tab="api">API</button>' +
                    '<button class="debug-tab" data-tab="map">Map</button>' +
                    '<button class="debug-tab" data-tab="player">Player</button>' +
                    '<button class="debug-tab" data-tab="inventory">Inv</button>' +
                    '<button class="debug-tab" data-tab="log">Log</button>' +
                    '<button class="debug-tab" data-tab="action">Action</button>' +
                '</div>' +
                '<button class="debug-export" onclick="Debug.exportData()">Export</button>' +
                '<button class="debug-close" onclick="Debug.togglePanel()">x</button>' +
            '</div>' +
            '<div class="debug-content" id="debugContent"></div>';
        document.body.appendChild(panel);

        var btn = document.createElement('button');
        btn.id = 'debugToggleBtn';
        btn.className = 'debug-toggle-btn';
        btn.title = 'Toggle Debug Panel';
        btn.textContent = '?';
        btn.onclick = function() { Debug.togglePanel(); };
        document.body.appendChild(btn);

        var tabs = panel.querySelectorAll('.debug-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].onclick = (function(tab) {
                return function() { Debug.switchTab(tab); };
            })(tabs[i].getAttribute('data-tab'));
        }
    }

    function createAiDumpElement() {
        var el = document.createElement('pre');
        el.id = 'debugAiDump';
        el.className = 'debug-dump';
        el.textContent = '[VEX DEBUG]\nwaiting for data...';
        document.body.appendChild(el);
        dumpElement = el;
    }

    function add(category, step, data) {
        if (!enabled) return;
        if (!logs[category]) logs[category] = [];
        logs[category].push({
            time: new Date().toISOString(),
            step: step,
            data: data
        });
        if (logs[category].length > maxEntries) {
            logs[category].shift();
        }
        if (panelOpen) renderPanel();
        scheduleDump();
    }

    function addApiCall(url, action, status, elapsedMs, info) {
        if (!enabled) return;
        _apiSeq++;
        apiCallLog.push({
            seq: _apiSeq,
            time: new Date().toISOString(),
            action: action,
            method: 'GET',
            url: url,
            status: status,
            code: (info && info.code) || '',
            message: (info && info.message) || '',
            elapsed_ms: elapsedMs
        });
        if (apiCallLog.length > MAX_API_LOG) {
            apiCallLog.shift();
        }
    }

    function addAction(type, params, ok, elapsedMs) {
        if (!enabled) return;
        _actionSeq++;
        actionLog.push({
            seq: _actionSeq,
            time: new Date().toISOString(),
            type: type,
            params: params,
            ok: ok,
            elapsed_ms: elapsedMs
        });
        if (actionLog.length > MAX_ACTION_LOG) {
            actionLog.shift();
        }
    }

    function scheduleDump() {
        if (_dumpPending) return;
        _dumpPending = true;
        if (_dumpTimeoutId) clearTimeout(_dumpTimeoutId);
        _dumpTimeoutId = setTimeout(function() {
            _dumpPending = false;
            _dumpTimeoutId = null;
            renderAiDump();
        }, 50);
    }

    function formatStateSection() {
        var lines = [];
        lines.push('[STATE]');

        var loc = 'unknown';
        var pls = '?';
        var region = '?';
        if (typeof mapData !== 'undefined' && mapData) {
            if (mapData.curLoc !== null && mapData.curLoc !== undefined) {
                pls = mapData.curLoc;
                region = mapData.curRegion !== null ? mapData.curRegion : '?';
                if (mapData.links && mapData.links.tiles && mapData.links.tiles[region]) {
                    var tile = mapData.links.tiles[region][pls];
                    loc = tile ? tile.name : (getPlaceName(pls) || 'unknown');
                } else {
                    loc = getPlaceName(pls);
                }
            }
        }
        lines.push('Location: ' + loc + ' / pls=' + pls + ' / region=' + region);

        var hp = '?', mhp = '?', sp = '?', msp = '?';
        var itemsStr = '?';
        var equipStr = '?';
        if (logs.api && logs.api.length > 0) {
            for (var i = logs.api.length - 1; i >= 0; i--) {
                var entry = logs.api[i];
                if (entry.step === 'player_info' && entry.data && entry.data.data) {
                    var d = entry.data.data;
                    hp = d.hp !== undefined ? d.hp : '?';
                    mhp = d.mhp !== undefined ? d.mhp : '?';
                    sp = d.sp !== undefined ? d.sp : '?';
                    msp = d.msp !== undefined ? d.msp : '?';
                    if (d.equipment) {
                        var eqParts = [];
                        var eqSlots = ['wep', 'wep2', 'arb', 'arh', 'ara', 'arf', 'art'];
                        for (var ei = 0; ei < eqSlots.length; ei++) {
                            var e = d.equipment[eqSlots[ei]];
                            eqParts.push(eqSlots[ei] + '=' + (e && e.name ? e.name : '(none)'));
                        }
                        equipStr = eqParts.join('|');
                    }
                    break;
                }
            }
            for (var j = logs.api.length - 1; j >= 0; j--) {
                var entry2 = logs.api[j];
                if (entry2.step === 'player_inventory' && entry2.data && entry2.data.data) {
                    var inv = entry2.data.data;
                    var slots = inv.slots || [];
                    var names = [];
                    for (var si = 0; si < slots.length; si++) {
                        names.push(slots[si].empty ? '(empty)' : slots[si].name);
                    }
                    itemsStr = names.length > 0 ? '[' + names.join(', ') + ']' : '?';
                    break;
                }
            }
        }
        lines.push('HP: ' + hp + '/' + mhp + '  SP: ' + sp + '/' + msp);
        lines.push('Items: ' + itemsStr);
        lines.push('Equipment: ' + equipStr);

        return lines.join('\n');
    }

    function formatMapSection() {
        var lines = [];
        lines.push('[MAP]');
        if (typeof mapData === 'undefined' || !mapData) {
            lines.push('  (no map data)');
            return lines.join('\n');
        }

        // Oblivions / links 模式：文本网格
        if (mapData.links && mapData.curRegion !== null && mapData.links.tiles && mapData.links.tiles[mapData.curRegion]) {
            var tiles = mapData.links.tiles[mapData.curRegion];
            var regionGrid = mapData.links.grids[mapData.curRegion];
            var regions = mapData.links.regions;
            var regionInfo = regions ? regions[mapData.curRegion] : null;
            var cols = regionGrid ? regionGrid.cols : 10;
            var rows = regionGrid ? regionGrid.rows : 10;
            var exitPls = regionInfo ? regionInfo.exit_pls : null;

            // 查找 entrance_pls（当前区域自己的 entrance，仅 prev_region 存在时标记）
            var entrancePls = null;
            if (regionInfo && regionInfo.prev_region !== null) {
                entrancePls = regionInfo.entrance_pls;
            }

            // 构建坐标→tile 的映射
            var coordMap = {};
            for (var plsKey in tiles) {
                var t = tiles[plsKey];
                if (t.x !== undefined && t.y !== undefined) {
                    var key = t.x + ',' + t.y;
                    coordMap[key] = { pls: parseInt(plsKey), tile: t };
                }
            }

            // 获取当前 tile 的邻居列表
            var curTile = tiles[mapData.curLoc];
            var neighborSet = {};
            if (curTile && curTile.neighbors) {
                for (var ni = 0; ni < curTile.neighbors.length; ni++) {
                    neighborSet[curTile.neighbors[ni]] = true;
                }
            }

            lines.push('  Region: ' + (regionInfo ? regionInfo.name : ('#' + mapData.curRegion)) + ' (' + cols + 'x' + rows + ')');
            lines.push('');

            // 列坐标标题
            var header = '     ';
            for (var c = 0; c < cols; c++) {
                var colLabel = String(c);
                while (colLabel.length < 5) colLabel = ' ' + colLabel;
                header += colLabel;
            }
            lines.push(header);

            for (var r = 0; r < rows; r++) {
                var rowLabel = '  ' + String(r);
                while (rowLabel.length < 4) rowLabel = ' ' + rowLabel;
                var rowStr = rowLabel;

                for (c = 0; c < cols; c++) {
                    var key = c + ',' + r;
                    var entry = coordMap[key];
                    var cell = '';

                    if (!entry) {
                        // 空格
                        cell = '  .  ';
                    } else {
                        var pls = entry.pls;
                        var tile = entry.tile;
                        var symbol = '';

                        // 确定符号
                        if (pls === mapData.curLoc) {
                            symbol = '  @  ';  // 当前位置
                        } else if (!tile.passable) {
                            symbol = '  #  ';  // 不可通行
                        } else if (neighborSet[pls]) {
                            symbol = '  +  ';  // 可到达相邻格
                        } else if (pls === exitPls) {
                            symbol = ' [E] ';  // 出口格
                        } else if (pls === entrancePls) {
                            symbol = ' [I] ';  // 入口格
                        } else {
                            symbol = '  -  ';  // 可通行但非相邻
                        }

                        cell = symbol;
                    }
                    rowStr += cell;
                }
                lines.push(rowStr);
            }

            // 图例
            lines.push('');
            lines.push('  @=current  +=reachable  -=unreachable  #=blocked  [E]=exit  [I]=entrance  .=empty');

            // 当前格信息
            if (curTile) {
                lines.push('  > ' + curTile.name + ': ' + curTile.desc);
            }

            // 列出所有可到达的相邻格
            if (curTile && curTile.neighbors && curTile.neighbors.length > 0) {
                var nbLines = [];
                for (ni = 0; ni < curTile.neighbors.length; ni++) {
                    var nb = tiles[curTile.neighbors[ni]];
                    if (nb) {
                        nbLines.push(nb.name + '(pls=' + curTile.neighbors[ni] + ')');
                    }
                }
                if (nbLines.length > 0) {
                    lines.push('  neighbors: ' + nbLines.join(', '));
                }
            }

            return lines.join('\n');
        }

        // no links data
        lines.push('  (no links map data)');
        return lines.join('\n');
    }

    function formatApiLogSection() {
        var lines = [];
        lines.push('[API LOG] (last ' + apiCallLog.length + '/' + MAX_API_LOG + ')');
        if (apiCallLog.length === 0) {
            lines.push('  (none)');
        } else {
            for (var i = 0; i < apiCallLog.length; i++) {
                var c = apiCallLog[i];
                var timeStr = c.time.substring(11, 19);
                lines.push('  #' + c.seq + ' | ' + c.action + ' | ' + c.method + ' | ' +
                    c.status + ' | ' + c.elapsed_ms + 'ms | ' + timeStr);
            }
        }
        return lines.join('\n');
    }

    function formatActionLogSection() {
        var lines = [];
        lines.push('[ACTION LOG] (last ' + actionLog.length + '/' + MAX_ACTION_LOG + ')');
        if (actionLog.length === 0) {
            lines.push('  (none)');
        } else {
            for (var i = 0; i < actionLog.length; i++) {
                var c = actionLog[i];
                var timeStr = c.time.substring(11, 19);
                var paramsStr = '';
                if (c.params) {
                    var parts = [];
                    for (var k in c.params) {
                        if (k !== 'mode') {
                            parts.push(k + '=' + c.params[k]);
                        }
                    }
                    paramsStr = ' (' + parts.join(', ') + ')';
                }
                lines.push('  #' + c.seq + ' | ' + c.type + paramsStr + ' | ' +
                    (c.ok ? 'OK' : 'FAIL') + ' | ' + c.elapsed_ms + 'ms | ' + timeStr);
            }
        }
        return lines.join('\n');
    }

    function formatRawDataSection() {
        var lines = [];
        lines.push('[RAW DATA]');
        var hasAny = false;
        var categoryLabels = {
            api: 'API', map: 'MAP', player: 'PLAYER',
            inventory: 'INVENTORY', log: 'LOG', action: 'ACTION'
        };
        for (var cat in logs) {
            if (logs[cat].length === 0) continue;
            var entries = logs[cat];
            var startIdx = Math.max(0, entries.length - 2);
            for (var ei = startIdx; ei < entries.length; ei++) {
                var e = entries[ei];
                var label = categoryLabels[cat] || cat.toUpperCase();
                var rawJson = JSON.stringify(e.data, null, 2);
                if (rawJson.length > 2000) {
                    rawJson = rawJson.substring(0, 2000) + '\n  ... (truncated, ' + rawJson.length + ' chars total)';
                }
                lines.push('');
                lines.push('=== ' + label + ':' + e.step + ' (' + e.time.substring(11, 19) + ') ===');
                lines.push(rawJson);
                hasAny = true;
            }
        }
        if (!hasAny) {
            lines.push('  (no data)');
        }
        return lines.join('\n');
    }

    function renderAiDump() {
        if (!enabled || !dumpElement) return;
        var now = new Date();
        var timeStr = now.getFullYear() + '-' +
            ('0' + (now.getMonth() + 1)).slice(-2) + '-' +
            ('0' + now.getDate()).slice(-2) + ' ' +
            ('0' + now.getHours()).slice(-2) + ':' +
            ('0' + now.getMinutes()).slice(-2) + ':' +
            ('0' + now.getSeconds()).slice(-2);
        var lines = [];
        lines.push('[VEX DEBUG]');
        lines.push('[TIME] ' + timeStr);
        lines.push('');
        lines.push(formatStateSection());
        lines.push('');
        lines.push(formatMapSection());
        lines.push('');
        lines.push(formatApiLogSection());
        lines.push('');
        lines.push(formatActionLogSection());
        lines.push('');
        lines.push(formatRawDataSection());
        var text = lines.join('\n');
        dumpElement.textContent = text;
        flushAiDump(text);
    }

    function flushAiDump(text) {
        if (!enabled) return;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', BASE_URL + '/api_v2.php?action=ai_dump_save', false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ dump: text }));
        } catch (e) {
            console.error('[Debug] ai_dump_save failed:', e);
        }
    }

    function togglePanel() {
        var panel = document.getElementById('debugPanel');
        var btn = document.getElementById('debugToggleBtn');
        if (!panel || !btn) return;
        panelOpen = !panelOpen;
        if (panelOpen) {
            panel.style.display = '';
            btn.textContent = 'X';
            renderPanel();
        } else {
            panel.style.display = 'none';
            btn.textContent = '?';
        }
    }

    function switchTab(tab) {
        currentTab = tab;
        var tabs = document.querySelectorAll('.debug-tab');
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].getAttribute('data-tab') === tab) {
                tabs[i].classList.add('active');
            } else {
                tabs[i].classList.remove('active');
            }
        }
        renderPanel();
    }

    function renderPanel() {
        var el = document.getElementById('debugContent');
        if (!el) return;

        var logsForTab = logs[currentTab] || [];
        if (logsForTab.length === 0) {
            el.innerHTML = '<p class="debug-empty">no data</p>';
            return;
        }

        var html = '';
        for (var i = logsForTab.length - 1; i >= 0; i--) {
            var e = logsForTab[i];
            html += '<div class="debug-entry">' +
                '<div class="debug-step">[' + escapeHtml(e.step) + '] <span class="debug-time">' +
                escapeHtml(e.time.substring(11, 23)) + '</span></div>' +
                '<pre class="debug-data">' + escapeHtml(JSON.stringify(e.data, null, 2)) + '</pre>' +
                '</div>';
        }
        el.innerHTML = html;
    }

    function exportData() {
        var blob = new Blob([JSON.stringify(logs, null, 2)], {type: 'application/json'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'debug_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    function getData() {
        return logs;
    }

    function isEnabled() {
        return enabled;
    }

    async function flush() {
        if (!enabled || Object.keys(logs).length === 0) return;

        var snapshot = {};
        for (var category in logs) {
            if (logs[category].length > 0) {
                snapshot[category] = logs[category].slice();
            }
        }

        if (Object.keys(snapshot).length === 0) return;

        try {
            await fetch(BASE_URL + '/api_v2.php?action=debug_log', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categories: snapshot })
            });
        } catch (e) {
            console.error('[Debug] log upload failed:', e);
        }
    }

    return {
        CATEGORIES: CATEGORIES,
        init: init,
        add: add,
        addApiCall: addApiCall,
        addAction: addAction,
        renderAiDump: renderAiDump,
        togglePanel: togglePanel,
        switchTab: switchTab,
        exportData: exportData,
        getData: getData,
        isEnabled: isEnabled,
        flush: flush
    };
})();

Debug.init();