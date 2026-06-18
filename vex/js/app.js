// ══════════════════════════════════════════════════
// 页面入口 / Application entry point
// ══════════════════════════════════════════════════

import { loadMap, initMapInteraction } from './map.js';
import { loadInventory, setActiveTab } from './inventory.js';
import { toggleDrawer, closeDrawer, isDrawerOpen, renderStatusBar } from './player.js';
import { refreshLog, initLog } from './log.js';
import { loadTileAction, closeModal } from './tile-action.js';
import { DebugBus, BASE_URL } from './data.js';
import { updateToastPosition } from './toast-position.js';

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
    initLog();  // 绑定日志区滚动监听和未读提示按钮
    await refreshAll();
    renderStatusBar();
}

// ══════════════════════════════════════════════════
// 右侧道具抽屉
// ══════════════════════════════════════════════════

let invDrawerOpen = false;

function openInvDrawer() {
    // 互斥：关闭左侧抽屉
    if (isDrawerOpen()) closeDrawer();

    const drawer = document.getElementById('invDrawer');
    const overlay = document.getElementById('invDrawerOverlay');
    if (!drawer || !overlay) return;
    invDrawerOpen = true;
    drawer.classList.add('open');
    overlay.classList.add('open');
    // 加载数据并渲染当前标签
    loadInventory();
    updateToastPosition();
}

function closeInvDrawer() {
    const drawer = document.getElementById('invDrawer');
    const overlay = document.getElementById('invDrawerOverlay');
    if (!drawer || !overlay) return;
    invDrawerOpen = false;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    updateToastPosition();
}

function toggleInvDrawer() {
    if (invDrawerOpen) {
        closeInvDrawer();
    } else {
        openInvDrawer();
    }
}

// ══════════════════════════════════════════════════
// 左侧属性抽屉（增强：互斥关闭右侧）
// ══════════════════════════════════════════════════

function openPlayerDrawer() {
    // 互斥：关闭右侧抽屉
    if (invDrawerOpen) closeInvDrawer();
    if (!isDrawerOpen()) toggleDrawer();
}

// ══════════════════════════════════════════════════
// 绑定全局 DOM 事件
// ══════════════════════════════════════════════════

function bindGlobalEvents() {
    // 左侧抽屉（玩家属性）
    const playerBtn = document.getElementById('playerDrawerBtn');
    const overlay = document.getElementById('drawerOverlay');
    const closeBtn = document.getElementById('drawerCloseBtn');
    if (playerBtn) playerBtn.addEventListener('click', openPlayerDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    // 右侧抽屉（道具/装备）
    const invBtn = document.getElementById('inventoryDrawerBtn');
    const invOverlay = document.getElementById('invDrawerOverlay');
    const invCloseBtn = document.getElementById('invDrawerCloseBtn');
    if (invBtn) invBtn.addEventListener('click', toggleInvDrawer);
    if (invOverlay) invOverlay.addEventListener('click', closeInvDrawer);
    if (invCloseBtn) invCloseBtn.addEventListener('click', closeInvDrawer);

    // 右侧抽屉标签切换
    const invTabs = document.querySelectorAll('.inv-tab');
    for (let i = 0; i < invTabs.length; i++) {
        invTabs[i].addEventListener('click', function() {
            setActiveTab(this.dataset.tab);
        });
    }

    // 模态框关闭
    const modalOverlay = document.getElementById('modalOverlay');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalOverlay) modalOverlay.addEventListener('click', function(e) {
        if (e.target === modalOverlay) closeModal();
    });
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);

    // 键盘快捷键
    document.addEventListener('keydown', function(e) {
        // 忽略输入框内的按键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'Escape') {
            // 优先级：模态框 > 右侧抽屉 > 左侧抽屉
            const modalOverlay = document.getElementById('modalOverlay');
            if (modalOverlay && modalOverlay.classList.contains('open')) {
                closeModal();
            } else if (invDrawerOpen) {
                closeInvDrawer();
            } else if (isDrawerOpen()) {
                closeDrawer();
            }
        } else if (e.key === 'i' || e.key === 'I') {
            toggleInvDrawer();
        } else if (e.key === 'p' || e.key === 'P') {
            openPlayerDrawer();
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
    document.body.classList.add('debug-ai');
    const script = document.createElement('script');
    script.src = 'js/debug.js';
    document.head.appendChild(script);
}

loadAll();
