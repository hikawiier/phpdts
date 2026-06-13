// ══════════════════════════════════════════════════
// AI Debug Module — 仅 ?debug=ai 时由 app.js 动态加载
// 订阅 DebugBus 事件，按 AI 需求格式化输出为 JSON Lines
// 持久化到服务端缓存文件供 AI 智能体阅读
// 注意：此文件以普通脚本加载，通过 window 访问模块导出
// ══════════════════════════════════════════════════

(function() {

    var FLUSH_INTERVAL = 2000;  // 2秒批量写入
    var FLUSH_THRESHOLD = 20;   // 缓冲区满20条立即写入
    var MAX_LOG_ENTRIES = 500;  // 单次 dump 最大条目数

    var _pending = [];          // 待写入缓冲区
    var _flushTimer = null;
    var _seq = 0;

    // 通过 window 访问模块导出的 DebugBus 和 BASE_URL
    // app.js 在加载 debug.js 之前已完成模块初始化
    var DebugBus = window.__vex_debug_bus;
    var BASE_URL = window.__vex_base_url;

    if (!DebugBus) {
        console.error('[DebugAI] DebugBus not found on window.__vex_debug_bus');
        return;
    }

    // ---- 订阅 DebugBus 事件 ----
    DebugBus.on(function(entry) {
        _seq++;
        var record = {
            ts: entry.ts,
            seq: _seq,
            type: entry.cat,
            step: entry.step,
            data: entry.data
        };
        _pending.push(record);

        if (_pending.length >= FLUSH_THRESHOLD) {
            flush();
        } else if (!_flushTimer) {
            _flushTimer = setTimeout(flush, FLUSH_INTERVAL);
        }
    });

    // ---- 批量写入服务端 ----
    function flush() {
        if (_flushTimer) {
            clearTimeout(_flushTimer);
            _flushTimer = null;
        }
        if (_pending.length === 0) return;

        // 取出待写入数据
        var batch = _pending.splice(0, _pending.length);

        // 附加当前状态快照（每批最后一条附带）
        var stateSnapshot = DebugBus.getState();
        batch.push({
            ts: Date.now(),
            seq: _seq,
            type: 'state',
            step: 'snapshot',
            data: stateSnapshot
        });

        // 序列化为 JSON Lines
        var lines = [];
        for (var i = 0; i < batch.length; i++) {
            try {
                lines.push(JSON.stringify(batch[i]));
            } catch(e) {
                lines.push(JSON.stringify({ts: batch[i].ts, type:'error', step:'serialize_error', data:e.message}));
            }
        }
        var payload = lines.join('\n');

        // 发送到服务端
        try {
            fetch(BASE_URL + '/api_v2.php?action=ai_dump_save', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'text/plain' },
                body: payload
            }).catch(function(e) {
                console.error('[DebugAI] flush failed:', e);
            });
        } catch(e) {
            console.error('[DebugAI] flush error:', e);
        }
    }

    // ---- 页面卸载前强制写入 ----
    window.addEventListener('beforeunload', function() {
        flush();
    });

    // ---- 全局错误捕获 ----
    window.addEventListener('error', function(evt) {
        DebugBus.emit('error', 'window:error', {
            message: evt.message,
            filename: evt.filename,
            lineno: evt.lineno,
            colno: evt.colno
        });
    });

    window.addEventListener('unhandledrejection', function(evt) {
        DebugBus.emit('error', 'window:unhandledrejection', {
            reason: evt.reason ? (evt.reason.message || String(evt.reason)) : 'unknown'
        });
    });

    console.log('[DebugAI] AI debug mode active — outputting JSON Lines to server');
})();
