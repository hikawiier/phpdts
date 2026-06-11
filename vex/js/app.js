// ══════════════════════════════════════════════════
// 页面入口 / Application entry point
// ══════════════════════════════════════════════════

function loadAll() {
    console.log('[App] loadAll() start');
    Promise.allSettled([
        loadMap(),
        loadItemFind(),
        loadExplorationMemory(),
        loadInventory(),
        refreshLog()
    ]).then(function() {
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) {
            Debug.renderAiDump();
        }
    });
}

loadAll();