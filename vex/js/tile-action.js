// ══════════════════════════════════════════════════
// 地图格交互 / Tile Action Bar (ASCII 终端风)
// 当前格的统一互动入口：建筑物搜索/检查 + 脚边道具拾取 + 原地探索
// ══════════════════════════════════════════════════

import { mapData } from './data.js';
import { escapeHtml, gameApi } from './utils.js';
import { loadMap } from './map.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';

let tileData = null;

// ══════════════════════════════════════════════════
// Toast（由 ui:toast 事件触发）
// ══════════════════════════════════════════════════

function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 2000;
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const tag = type === 'error' ? '[ERR]' : (type === 'success' ? '[OK]' : '[i]');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML = '<span class="toast-tag">' + tag + '</span>' + escapeHtml(message);
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('show'); });
    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
    }, duration);
}

// ══════════════════════════════════════════════════
// 加载当前格交互数据
// ══════════════════════════════════════════════════

export async function loadTileAction() {
    const el = document.getElementById('tileActionBar');
    if (!el) return;

    if (!mapData.links) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = '<div class="loading">scanning...</div>';

    const result = await gameApi('tile_actions');
    if (result.status !== 'success') {
        el.innerHTML = '<div class="error">load failed</div>';
        return;
    }

    tileData = result.data;
    renderTileActionBar();
}

// ══════════════════════════════════════════════════
// 渲染动作条
// ══════════════════════════════════════════════════

function renderTileActionBar() {
    const el = document.getElementById('tileActionBar');
    if (!tileData) { el.innerHTML = ''; return; }

    const pois = tileData.pois || [];
    const ground_items = tileData.ground_items || [];
    let html = '';

    for (let i = 0; i < pois.length; i++) {
        html += renderPoiRow(pois[i]);
    }

    if (ground_items.length > 0) {
        html += '<div class="tile-row is-action" data-action="check-ground">'
            + '<span class="tile-tag">[G]</span>'
            + '<span class="tile-name">就在脚边... <span class="dim">×' + ground_items.length + '</span></span>'
            + '</div>';
    }

    if (pois.length === 0 && ground_items.length === 0) {
        html = '<div class="tile-empty">这里空无一物...</div>';
    }

    html += '<div class="tile-explore-row">'
        + '<button class="term-btn block" data-action="explore">[E] 探索周围</button>'
        + '</div>';

    // 出入口切换地图按钮
    const regionInfo = mapData.links && mapData.curRegion !== null ? mapData.links.regions[mapData.curRegion] : null;
    const curPls = mapData.curLoc;
    const isOnExit = regionInfo && curPls === regionInfo.exit_pls;
    const isOnEntrance = regionInfo && curPls === regionInfo.entrance_pls && regionInfo.prev_region !== null;
    if (isOnExit || isOnEntrance) {
        const dir = isOnExit ? '前往下一区域' : '返回上一区域';
        html += '<div class="tile-explore-row">'
            + '<button class="term-btn block" data-action="switch-region">' + dir + '</button>'
            + '</div>';
    }

    el.innerHTML = html;
    bindActionBarEvents();
}

function renderPoiRow(poi) {
    const iaid = poi.iaid;
    const name = poi.name;
    const searchable = poi.searchable;
    const repeatable = poi.repeatable;
    const searched = poi.searched;
    const items = poi.items || [];
    const mechanic = poi.mechanic;
    const search_count = poi.search_count || 0;
    const repeat_limit = poi.repeat_limit || 0;

    let row = '<div class="tile-row">';
    row += '<span class="tile-tag">[S]</span>';
    row += '<span class="tile-name">' + escapeHtml(name);

    if (searched) {
        row += ' <span class="dim">(已搜索)</span>';
    }
    if (repeatable && repeat_limit > 0) {
        row += ' <span class="dim">' + search_count + '/' + repeat_limit + '</span>';
    }
    row += '</span>';

    if (!searchable) {
        // 不可搜索，无按钮
    } else if (!searched) {
        const btnText = mechanic ? '[触碰]' : '[搜索]';
        row += '<button class="term-btn" data-action="search" data-iaid="' + iaid + '">' + btnText + '</button>';
    } else if (items.length > 0) {
        row += '<button class="term-btn" data-action="check-poi" data-iaid="' + iaid + '">[检查]</button>';
    } else if (repeatable) {
        if (repeat_limit > 0 && search_count >= repeat_limit) {
            row += '<span class="dim">(上限)</span>';
        } else {
            const btnText = mechanic ? '[再触碰]' : '[再搜索]';
            row += '<button class="term-btn" data-action="search" data-iaid="' + iaid + '">' + btnText + '</button>';
        }
    } else {
        // 一次性已搜索无掉落：标注已在 tile-name 内显示，此处无需重复
    }

    row += '</div>';
    return row;
}

// 绑定动作条内所有按钮/行的点击事件（事件委托）
function bindActionBarEvents() {
    const el = document.getElementById('tileActionBar');
    if (!el) return;

    const exploreBtn = el.querySelector('button[data-action="explore"]');
    if (exploreBtn) exploreBtn.addEventListener('click', handleExplore);

    const switchBtn = el.querySelector('button[data-action="switch-region"]');
    if (switchBtn) switchBtn.addEventListener('click', handleSwitchRegion);

    const groundRow = el.querySelector('[data-action="check-ground"]');
    if (groundRow) groundRow.addEventListener('click', checkGround);

    const searchBtns = el.querySelectorAll('button[data-action="search"]');
    for (let i = 0; i < searchBtns.length; i++) {
        const iaid = parseInt(searchBtns[i].dataset.iaid);
        searchBtns[i].addEventListener('click', function() { handleSearch(iaid); });
    }

    const checkBtns = el.querySelectorAll('button[data-action="check-poi"]');
    for (let i = 0; i < checkBtns.length; i++) {
        const iaid = parseInt(checkBtns[i].dataset.iaid);
        checkBtns[i].addEventListener('click', function() { checkPoi(iaid); });
    }
}

// ══════════════════════════════════════════════════
// 底部弹窗
// ══════════════════════════════════════════════════

export function closeBottomSheet() {
    const overlay = document.getElementById('bottomSheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    if (overlay) overlay.classList.remove('active');
    if (sheet) sheet.classList.remove('active');
}

function openBottomSheet(title, sub, bodyHtml) {
    const headerEl = document.getElementById('sheetHeader');
    const subEl = document.getElementById('sheetSub');
    const bodyEl = document.getElementById('sheetBody');
    if (headerEl) headerEl.textContent = title;
    if (subEl) subEl.textContent = sub || '';
    if (bodyEl) bodyEl.innerHTML = bodyHtml;
    document.getElementById('bottomSheetOverlay').classList.add('active');
    document.getElementById('bottomSheet').classList.add('active');
    bindSheetEvents();
}

function renderItemRow(item) {
    const isNearsighted = item.discovered === 2;
    const displayName = isNearsighted ? item.display_name : item.itm;
    let row = '<div class="sheet-item" data-action="pickup" data-iid="' + item.iid + '">'
        + '<span class="item-tag">[P]</span>'
        + '<span class="item-name">' + escapeHtml(displayName) + '</span>';
    if (!isNearsighted) {
        row += '<span class="item-meta">' + escapeHtml(item.itmk) + ' eff:' + item.itme + '</span>';
    }
    row += '</div>';
    return row;
}

// 绑定弹窗内道具行 + footer 按钮事件
function bindSheetEvents() {
    const body = document.getElementById('sheetBody');
    if (!body) return;

    // 道具行点击 → 拾取单个
    const itemRows = body.querySelectorAll('.sheet-item[data-action="pickup"]');
    for (let i = 0; i < itemRows.length; i++) {
        const iid = parseInt(itemRows[i].dataset.iid);
        itemRows[i].addEventListener('click', function(e) {
            if (e.target.tagName === 'BUTTON') return; // footer 按钮另处理
            handlePickup(iid);
        });
    }

    // 全部拾取 / 确认按钮
    const footerBtn = body.querySelector('.sheet-footer button');
    if (footerBtn) {
        const action = footerBtn.dataset.action;
        if (action === 'pickup-all-poi') {
            const iaid = parseInt(footerBtn.dataset.iaid);
            footerBtn.addEventListener('click', function() { pickupAllPoi(iaid); });
        } else if (action === 'pickup-all-ground') {
            footerBtn.addEventListener('click', pickupAllGround);
        } else if (action === 'close') {
            footerBtn.addEventListener('click', closeBottomSheet);
        }
    }
}

// ══════════════════════════════════════════════════
// 按钮禁用（命令执行期间防重复提交）
// ══════════════════════════════════════════════════

function setActionBarDisabled(disabled) {
    const el = document.getElementById('tileActionBar');
    if (!el) return;
    const buttons = el.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].disabled = disabled;
    }
}

// ══════════════════════════════════════════════════
// 交互处理
// ══════════════════════════════════════════════════

async function handleExplore() {
    setActionBarDisabled(true);
    try {
        const result = await commandQueue.execute({ mode: 'command', command: 'obl_explore' });
        if (result.success) {
            dataManager.invalidateAll();
            await loadMap();
            dataManager.broadcast('game:action-completed');
        } else {
            showToast(result.error || 'explore failed', 'error');
        }
    } finally {
        setActionBarDisabled(false);
    }
}

async function handleSwitchRegion() {
    const regionInfo = mapData.links && mapData.curRegion !== null ? mapData.links.regions[mapData.curRegion] : null;
    if (!regionInfo) return;

    const isOnExit = mapData.curLoc === regionInfo.exit_pls;
    const isOnEntrance = mapData.curLoc === regionInfo.entrance_pls && regionInfo.prev_region !== null;
    if (!isOnExit && !isOnEntrance) return;

    // 站在出入口格 → move 到当前位置 → 后端 obl_move() 检测到出入口同位置移动 → 触发区域切换
    const targetPls = isOnExit ? regionInfo.exit_pls : regionInfo.entrance_pls;

    setActionBarDisabled(true);
    try {
        const result = await commandQueue.execute({ command: 'move', moveto: targetPls });
        if (result.success) {
            dataManager.invalidateAll();
            await loadMap();
            dataManager.broadcast('game:action-completed');
        } else {
            showToast(result.error || '切换区域失败', 'error');
        }
    } finally {
        setActionBarDisabled(false);
    }
}

async function handleSearch(iaid) {
    setActionBarDisabled(true);
    try {
        const result = await commandQueue.execute({ mode: 'command', command: 'obl_search', iaid: iaid });
        if (result.success) {
            dataManager.invalidateAll();
            dataManager.broadcast('game:action-completed');
        } else {
            showToast(result.error || 'search failed', 'error');
        }
    } finally {
        setActionBarDisabled(false);
    }
}

async function handlePickup(iid) {
    const result = await commandQueue.execute({ mode: 'command', command: 'obl_pickup', iid: iid });
    if (result.success) {
        // 从弹窗 DOM 移除已拾取行
        const body = document.getElementById('sheetBody');
        if (body) {
            const row = body.querySelector('.sheet-item[data-iid="' + iid + '"]');
            if (row) row.remove();
            if (body.querySelectorAll('.sheet-item').length === 0) {
                closeBottomSheet();
            }
        }
        dataManager.invalidateAll();
        dataManager.broadcast('game:action-completed');
    } else {
        showToast(result.error || 'pickup failed', 'error');
    }
}

async function handlePickupAll(items) {
    for (let i = 0; i < items.length; i++) {
        await commandQueue.execute({ mode: 'command', command: 'obl_pickup', iid: items[i].iid });
    }
    dataManager.invalidateAll();
    dataManager.broadcast('game:action-completed');
    closeBottomSheet();
}

function pickupAllPoi(iaid) {
    let poi = null;
    const pois = (tileData && tileData.pois) ? tileData.pois : [];
    for (let i = 0; i < pois.length; i++) {
        if (pois[i].iaid === iaid) { poi = pois[i]; break; }
    }
    if (poi && poi.items) handlePickupAll(poi.items);
}

function pickupAllGround() {
    if (tileData && tileData.ground_items) handlePickupAll(tileData.ground_items);
}

function checkPoi(iaid) {
    let poi = null;
    const pois = (tileData && tileData.pois) ? tileData.pois : [];
    for (let i = 0; i < pois.length; i++) {
        if (pois[i].iaid === iaid) { poi = pois[i]; break; }
    }
    if (!poi) return;

    // 机制触发型 POI
    if (poi.mechanic && poi.searched) {
        const body = '<div class="mechanic-result">'
            + '<div class="mechanic-effect">✦ ' + escapeHtml(poi.mechanic) + ' +' + (poi.mechanic_value || 0) + '</div>'
            + '</div>'
            + '<div class="sheet-footer"><button class="term-btn" data-action="close">[确认]</button></div>';
        openBottomSheet(poi.name, '', body);
        return;
    }

    const items = poi.items || [];
    if (items.length === 0) return;

    let body = '';
    for (let i = 0; i < items.length; i++) {
        body += renderItemRow(items[i]);
    }
    body += '<div class="sheet-footer"><button class="term-btn" data-action="pickup-all-poi" data-iaid="' + iaid + '">[全部拾取]</button></div>';
    openBottomSheet(poi.name, poi.desc || '', body);
}

function checkGround() {
    const items = (tileData && tileData.ground_items) ? tileData.ground_items : [];
    if (items.length === 0) return;

    let body = '';
    for (let i = 0; i < items.length; i++) {
        body += renderItemRow(items[i]);
    }
    body += '<div class="sheet-footer"><button class="term-btn" data-action="pickup-all-ground">[全部拾取]</button></div>';
    openBottomSheet('脚边的物品', '', body);
}

// ══════════════════════════════════════════════════
// 事件订阅
// ══════════════════════════════════════════════════

// 地图加载完成 → 刷新动作条
dataManager.listen('map:loaded', function(data) {
    if (data && data.hasLinks) loadTileAction();
});

// 操作完成 → 刷新动作条
dataManager.listen('game:action-completed', function() {
    loadTileAction();
});

// 点击当前格 → 探索（由 map.js 广播）
dataManager.listen('map:click-current', function() {
    handleExplore();
});

// Toast 事件（由各模块广播）
dataManager.listen('ui:toast', function(data) {
    if (data) showToast(data.msg, data.type);
});
