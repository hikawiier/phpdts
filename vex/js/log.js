// ══════════════════════════════════════════════════
// 游戏日志 / Game log (右上角面板)
// ══════════════════════════════════════════════════

async function refreshLog() {
    var el = document.getElementById('logContent');
    var result = await gameApi('game_log');
    if (result.status === 'success') {
        el.innerHTML = result.data.log || '<span class="grey">暂无日志</span>';
        el.scrollTop = el.scrollHeight;
    }
}

// 每3秒自动刷新日志
setInterval(function () {
    refreshLog();
}, 3000);
