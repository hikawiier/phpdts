// ══════════════════════════════════════════════════
// 游戏日志 / Game log (右上角面板)
// ══════════════════════════════════════════════════

import { DebugBus } from './data.js';
import { gameApi } from './utils.js';

let _lastLogLength = -1;

export async function refreshLog() {
    const el = document.getElementById('logContent');
    const result = await gameApi('game_log');
    if (result.status === 'success') {
        const newLen = result.data.log ? result.data.log.length : 0;
        // 仅当日志长度变化时 emit debug 事件，避免轮询产生大量冗余数据
        if (newLen !== _lastLogLength) {
            DebugBus.emit('log', 'refreshLog:changed', { logLength: newLen, prevLength: _lastLogLength });
            _lastLogLength = newLen;
        }
        el.innerHTML = result.data.log || '<span class="grey">暂无日志</span>';
        el.scrollTop = el.scrollHeight;
    }
}

// 每3秒自动刷新日志
setInterval(function () {
    refreshLog();
}, 3000);
