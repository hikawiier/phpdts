// ══════════════════════════════════════════════════
// 页面入口 / Application entry point
// ══════════════════════════════════════════════════

import { loadMap } from './map.js';
import { loadInventory } from './inventory.js';
import { toggleDrawer, closeDrawer } from './player.js';
import { refreshLog } from './log.js';
import { loadTileAction } from './tile-action.js';
import { DebugBus, BASE_URL } from './data.js';

function loadAll() {
    console.log('[App] loadAll() start');
    Promise.allSettled([
        loadMap(),
        loadInventory(),
        loadTileAction(),
        refreshLog()
    ]);
}

// 将 HTML onclick 需要的函数暴露到 window
window.toggleDrawer = toggleDrawer;
window.closeDrawer = closeDrawer;

// 将 debug.js 需要的模块导出暴露到 window
window.__vex_debug_bus = DebugBus;
window.__vex_base_url = BASE_URL;

// 动态加载 debug.js（仅 ?debug=ai 时）
if (new URLSearchParams(window.location.search).get('debug') === 'ai') {
    const script = document.createElement('script');
    script.src = 'js/debug.js';
    document.head.appendChild(script);
}

loadAll();
