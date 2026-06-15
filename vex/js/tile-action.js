// ══════════════════════════════════════════════════
// 地图格交互 / Tile Action Bar (ASCII 终端风)
// 当前格的统一互动入口：常驻按钮(探索/区域切换) + 统一交互列表(脚边道具/POI)
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
// 渲染动作条：常驻按钮区 + 统一交互列表
// ══════════════════════════════════════════════════

function renderTileActionBar() {
    const el = document.getElementById('tileActionBar');
    if (!tileData) { el.innerHTML = ''; return; }

    const pois = tileData.pois || [];
    const ground_items = tileData.ground_items || [];
    let html = '';

    // ── 常驻按钮区 ──
    html += '<div class="action-buttons" style="display:flex;gap:6px;margin-bottom:6px;">';
    html += '<button class="term-btn block" data-action="explore" style="flex:3;">[E] 探索周围</button>';

    // 区域切换按钮（条件显示）
    const regionInfo = mapData.links && mapData.curRegion !== null ? mapData.links.regions[mapData.curRegion] : null;
    const curPls = mapData.curLoc;
    const isOnExit = regionInfo && curPls === regionInfo.exit_pls;
    const isOnEntrance = regionInfo && curPls === regionInfo.entrance_pls && regionInfo.prev_region !== null;
    if (isOnExit || isOnEntrance) {
        const dir = isOnExit ? '前往下一区域' : '返回上一区域';
        html += '<button class="term-btn block" data-action="switch-region" style="flex:2;">' + dir + '</button>';
    }
    html += '</div>';

    // ── 统一交互列表 ──
    const hasGround = ground_items.length > 0;
    const hasPois = pois.length > 0;

    if (!hasGround && !hasPois) {
        html += '<div class="tile-empty">此处无可交互对象</div>';
    } else {
        // 统一交互列表（2列网格：脚边道具 + POI）
        html += '<div class="poi-grid">';
        // 脚边道具
        if (hasGround) {
            html += '<div class="tile-row is-action" data-action="check-ground">'
                + '<span class="tile-tag">[G]</span>'
                + '<span class="tile-name">脚边道具 <span class="dim">×' + ground_items.length + '</span></span>'
                + '</div>';
        }

        // POI 条目
        for (let i = 0; i < pois.length; i++) {
            html += renderPoiRow(pois[i]);
        }
        html += '</div>';
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

    let row = '<div class="tile-row is-action" data-action="check-poi" data-iaid="' + iaid + '">';
    row += '<span class="tile-tag">[S]</span>';
    row += '<span class="tile-name">' + escapeHtml(name);

    if (searched) {
        row += ' <span class="dim">(已搜索)</span>';
    } else if (searchable) {
        row += ' <span class="dim">可搜索</span>';
    }
    if (repeatable && repeat_limit > 0) {
        row += ' <span class="dim">' + search_count + '/' + repeat_limit + '</span>';
    }
    row += '</span>';
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

    const poiRows = el.querySelectorAll('[data-action="check-poi"]');
    for (let i = 0; i < poiRows.length; i++) {
        const iaid = parseInt(poiRows[i].dataset.iaid);
        poiRows[i].addEventListener('click', function() { checkPoi(iaid); });
    }
}

// ══════════════════════════════════════════════════
// 模态框
// ══════════════════════════════════════════════════

export function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('open');
}

function openModal(title, bodyHtml) {
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = bodyHtml;
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.add('open');
    bindModalEvents();
}

function renderItemRow(item) {
    const isNearsighted = item.discovered === 2;
    const displayName = isNearsighted ? item.display_name : item.itm;
    let row = '<div class="modal-item" data-action="pickup" data-iid="' + item.iid + '">'
        + '<span class="item-tag">[P]</span>'
        + '<span class="item-name">' + escapeHtml(displayName) + '</span>';
    if (!isNearsighted) {
        row += '<span class="item-meta">' + escapeHtml(item.itmk) + ' eff:' + item.itme + '</span>';
    }
    row += '</div>';
    return row;
}

// 绑定模态框内道具行 + footer 按钮事件
function bindModalEvents() {
    const body = document.getElementById('modalBody');
    if (!body) return;

    // 道具行点击 → 拾取单个
    const itemRows = body.querySelectorAll('.modal-item[data-action="pickup"]');
    for (let i = 0; i < itemRows.length; i++) {
        const iid = parseInt(itemRows[i].dataset.iid);
        itemRows[i].addEventListener('click', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            handlePickup(iid);
        });
    }

    // 搜索按钮
    const searchBtn = body.querySelector('button[data-action="search"]');
    if (searchBtn) {
        const iaid = parseInt(searchBtn.dataset.iaid);
        searchBtn.addEventListener('click', function() { handleSearch(iaid); });
    }

    // 全部拾取按钮
    const footerBtn = body.querySelector('.modal-footer button[data-action="pickup-all"]');
    if (footerBtn) {
        const source = footerBtn.dataset.source;
        const iaid = footerBtn.dataset.iaid ? parseInt(footerBtn.dataset.iaid) : null;
        footerBtn.addEventListener('click', function() {
            if (source === 'ground') {
                pickupAllGround();
            } else if (source === 'poi' && iaid !== null) {
                pickupAllPoi(iaid);
            }
        });
    }

    // 关闭按钮
    const closeBtn = body.querySelector('.modal-footer button[data-action="close"]');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
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
            // 搜索成功后重新打开该 POI 的模态框（刷新内容）
            closeModal();
            await loadTileAction();
            checkPoi(iaid);
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
        // 从模态框 DOM 移除已拾取行
        const body = document.getElementById('modalBody');
        if (body) {
            const row = body.querySelector('.modal-item[data-iid="' + iid + '"]');
            if (row) row.remove();
            if (body.querySelectorAll('.modal-item').length === 0) {
                closeModal();
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
    closeModal();
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

    // 机制触发型 POI（已搜索）
    if (poi.mechanic && poi.searched) {
        const body = '<div class="mechanic-result">'
            + '<div class="mechanic-effect">✦ ' + escapeHtml(poi.mechanic) + ' +' + (poi.mechanic_value || 0) + '</div>'
            + '</div>'
            + '<div class="modal-footer"><button class="term-btn" data-action="close">[确认]</button></div>';
        openModal(poi.name, body);
        return;
    }

    const items = poi.items || [];

    // 可搜索且未搜索 → 模态框显示搜索按钮 + 已有道具
    let body = '';
    if (poi.searchable && !poi.searched) {
        const btnText = poi.mechanic ? '[触碰]' : '[搜索]';
        body += '<div style="margin-bottom:8px;"><button class="term-btn block" data-action="search" data-iaid="' + iaid + '">' + btnText + '</button></div>';
    } else if (poi.searchable && poi.repeatable) {
        const repeat_limit = poi.repeat_limit || 0;
        const search_count = poi.search_count || 0;
        if (repeat_limit > 0 && search_count >= repeat_limit) {
            body += '<div class="tile-empty" style="margin-bottom:8px;">已达搜索上限</div>';
        } else {
            const btnText = poi.mechanic ? '[再触碰]' : '[再搜索]';
            body += '<div style="margin-bottom:8px;"><button class="term-btn block" data-action="search" data-iaid="' + iaid + '">' + btnText + '</button></div>';
        }
    }

    if (items.length > 0) {
        for (let i = 0; i < items.length; i++) {
            body += renderItemRow(items[i]);
        }
        body += '<div class="modal-footer"><button class="term-btn" data-action="pickup-all" data-source="poi" data-iaid="' + iaid + '">[全部拾取]</button></div>';
    } else if (!poi.searchable) {
        body += '<div class="tile-empty">无可交互内容</div>';
    }

    openModal(poi.name, body);
}

function checkGround() {
    const items = (tileData && tileData.ground_items) ? tileData.ground_items : [];
    if (items.length === 0) return;

    let body = '';
    for (let i = 0; i < items.length; i++) {
        body += renderItemRow(items[i]);
    }
    body += '<div class="modal-footer"><button class="term-btn" data-action="pickup-all" data-source="ground">[全部拾取]</button></div>';
    openModal('脚边道具', body);
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
