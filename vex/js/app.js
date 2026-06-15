// ══════════════════════════════════════════════════
// 页面入口 / Application entry point
// ══════════════════════════════════════════════════

import { loadMap, initMapInteraction } from './map.js';
import { loadInventory } from './inventory.js';
import { toggleDrawer, closeDrawer } from './player.js';
import { refreshLog } from './log.js';
import { loadTileAction, closeBottomSheet } from './tile-action.js';
import { DebugBus, BASE_URL } from './data.js';

// 统一刷新：地图优先（触发 map:loaded），其余并发
async function refreshAll() {
    try {
        await loadMap();
        await Promise.allSettled([
            loadInventory(),
            loadTileAction(),
            refreshLog()
        ]);
    } catch (e) {
        console.error('[App] refreshAll error:', e);
    }
}

async function loadAll() {
    console.log('[App] loadAll() start');
    await refreshAll();
}

// 绑定全局 DOM 事件（替代原 HTML onclick 内联）
function bindGlobalEvents() {
    // Drawer 开关
    const toggle = document.getElementById('drawerToggle');
    const overlay = document.getElementById('drawerOverlay');
    const closeBtn = document.getElementById('drawerCloseBtn');
    if (toggle) toggle.addEventListener('click', toggleDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    // Bottom Sheet 关闭（点遮罩 / [ESC] 按钮）
    const bsOverlay = document.getElementById('bottomSheetOverlay');
    const bsClose = document.getElementById('sheetCloseBtn');
    if (bsOverlay) bsOverlay.addEventListener('click', closeBottomSheet);
    if (bsClose) bsClose.addEventListener('click', closeBottomSheet);

    // ESC 键关闭弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeBottomSheet();
        }
    });
}

bindGlobalEvents();
initMapInteraction();

// debug.js 需要的模块导出暴露到 window（仅调试用）
window.__vex_debug_bus = DebugBus;
window.__vex_base_url = BASE_URL;

// 动态加载 debug.js（仅 ?debug=ai 时）
if (new URLSearchParams(window.location.search).get('debug') === 'ai') {
    const script = document.createElement('script');
    script.src = 'js/debug.js';
    document.head.appendChild(script);
}

loadAll();
