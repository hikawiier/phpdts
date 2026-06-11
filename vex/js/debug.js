// ══════════════════════════════════════════════════
// 调试模块 / Debug Module
// 独立的前端调试面板，记录所有API响应和操作数据
// 使用方式：访问页面时加 ?debug=1 启用
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

    function init() {
        var params = new URLSearchParams(window.location.search);
        if (params.get('debug') === '1' || params.get('debug') === 'auto') {
            enabled = true;
            createPanel();
            console.log('[Debug] 调试模式已启用');
        }
    }

    function createPanel() {
        var panel = document.createElement('div');
        panel.id = 'debugPanel';
        panel.className = 'debug-panel';
        panel.style.display = 'none';
        panel.innerHTML =
            '<div class="debug-header">' +
                '<h3>调试面板</h3>' +
                '<div class="debug-tabs">' +
                    '<button class="debug-tab active" data-tab="api">API</button>' +
                    '<button class="debug-tab" data-tab="map">地图</button>' +
                    '<button class="debug-tab" data-tab="player">玩家</button>' +
                    '<button class="debug-tab" data-tab="inventory">背包</button>' +
                    '<button class="debug-tab" data-tab="log">日志</button>' +
                    '<button class="debug-tab" data-tab="action">操作</button>' +
                '</div>' +
                '<button class="debug-export" onclick="Debug.exportData()">导出</button>' +
                '<button class="debug-close" onclick="Debug.togglePanel()">×</button>' +
            '</div>' +
            '<div class="debug-content" id="debugContent"></div>';
        document.body.appendChild(panel);

        var btn = document.createElement('button');
        btn.id = 'debugToggleBtn';
        btn.className = 'debug-toggle-btn';
        btn.title = '调试面板';
        btn.textContent = '\uD83D\uDC1B';
        btn.onclick = function() { Debug.togglePanel(); };
        document.body.appendChild(btn);

        var tabs = panel.querySelectorAll('.debug-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].onclick = (function(tab) {
                return function() { Debug.switchTab(tab); };
            })(tabs[i].getAttribute('data-tab'));
        }
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
    }

    function togglePanel() {
        var panel = document.getElementById('debugPanel');
        var btn = document.getElementById('debugToggleBtn');
        if (!panel || !btn) return;
        panelOpen = !panelOpen;
        if (panelOpen) {
            panel.style.display = '';
            btn.textContent = '\u2715';
            renderPanel();
        } else {
            panel.style.display = 'none';
            btn.textContent = '\uD83D\uDC1B';
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
            el.innerHTML = '<p class="debug-empty">暂无数据</p>';
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
            console.error('[Debug] 日志上传失败:', e);
        }
    }

    return {
        CATEGORIES: CATEGORIES,
        init: init,
        add: add,
        togglePanel: togglePanel,
        switchTab: switchTab,
        exportData: exportData,
        getData: getData,
        isEnabled: isEnabled,
        flush: flush
    };
})();

Debug.init();
