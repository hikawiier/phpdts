// ══════════════════════════════════════════════════
// 页面入口 / Application entry point
// ══════════════════════════════════════════════════

function loadAll() {
    console.log('[App] loadAll() 开始执行');
    loadMap();
    loadItemFind();
    loadExplorationMemory();
    loadInventory();
    refreshLog();
}

loadAll();
