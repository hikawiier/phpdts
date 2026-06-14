// ══════════════════════════════════════════════════
// 地图格交互 / Tile Action Bar
// 当前格的统一互动入口：建筑物搜索/检查 + 脚边道具拾取 + 原地探索
// ══════════════════════════════════════════════════

import { DebugBus, mapData } from './data.js';
import { escapeHtml, gameApi } from './utils.js';
import { refreshLog } from './log.js';
import { loadInventory } from './inventory.js';
import { loadMap } from './map.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';

let tileData = null;  // 当前格交互数据缓存

// ══════════════════════════════════════════════════
// Toast 提示
// ══════════════════════════════════════════════════

function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 2000;
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('show'); });
    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
    }, duration);
}

// ══════════════════════════════════════════════════
// 主加载函数
// ══════════════════════════════════════════════════

export async function loadTileAction() {
    const el = document.getElementById('tileActionBar');
    if (!el) return;

    // 非 Oblivions 模式不渲染
    if (!mapData.links) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = '<div class="loading">加载中...</div>';

    const result = await gameApi('tile_actions');
    if (result.status !== 'success') {
        el.innerHTML = '<div class="error">加载失败</div>';
        return;
    }

    tileData = result.data;
    renderTileActionBar();
}

// ══════════════════════════════════════════════════
// 渲染底部动作条
// ══════════════════════════════════════════════════

function renderTileActionBar() {
    const el = document.getElementById('tileActionBar');
    if (!tileData) { el.innerHTML = ''; return; }

    const pois = tileData.pois || [];
    const ground_items = tileData.ground_items || [];
    let html = '';

    // 建筑物列表
    for (let i = 0; i < pois.length; i++) {
        html += renderPoiRow(pois[i]);
    }

    // 脚边道具入口（仅有 iaid=0 道具时显示）
    if (ground_items.length > 0) {
        html += '<div class="tile-row tile-ground">'
            + '<span class="tile-icon">🗡️</span>'
            + '<span class="tile-name">就在脚边...</span>'
            + '<button class="cmdbutton" onclick="window._tileActionCheckGround()">[检查]</button>'
            + '</div>';
    }

    // 空状态：无建筑物且无脚边道具
    if (pois.length === 0 && ground_items.length === 0) {
        html = '<div class="tile-empty">这里空无一物...</div>';
    }

    // 原地探索按钮固定在动作条底部
    html += '<div class="tile-row tile-explore">'
        + '<button class="cmdbutton explore-btn" onclick="window._tileActionExplore()">🔍 原地探索</button>'
        + '</div>';

    el.innerHTML = html;
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
    const repeat_cooldown_remaining = poi.repeat_cooldown_remaining || 0;

    let row = '<div class="tile-row tile-poi">';
    row += '<span class="tile-icon">📦</span>';
    row += '<span class="tile-name">' + escapeHtml(name);

    // 状态标注
    if (searched) {
        row += ' <span class="grey">(已搜索)</span>';
    }

    // 可重复搜索次数显示
    if (repeatable && repeat_limit > 0) {
        row += ' <span class="repeat-count">' + search_count + '/' + repeat_limit + '</span>';
    }

    row += '</span>';

    // 按钮逻辑
    if (!searchable) {
        // 不可搜索 → 无按钮
    } else if (!searched) {
        const btnText = mechanic ? '[触碰]' : '[搜索]';
        row += '<button class="cmdbutton" onclick="window._tileActionSearch(' + iaid + ')">' + btnText + '</button>';
    } else if (items.length > 0) {
        row += '<button class="cmdbutton" onclick="window._tileActionCheckPoi(' + iaid + ')">[检查]</button>';
    } else if (repeatable) {
        if (repeat_limit > 0 && search_count >= repeat_limit) {
            row += '<span class="grey">(已达上限)</span>';
        } else if (repeat_cooldown_remaining > 0) {
            row += '<button class="cmdbutton" disabled>[冷却' + repeat_cooldown_remaining + '回合]</button>';
        } else {
            const btnText = mechanic ? '[再触碰]' : '[再搜索]';
            row += '<button class="cmdbutton" onclick="window._tileActionSearch(' + iaid + ')">' + btnText + '</button>';
        }
    } else {
        row += '<span class="grey">(已搜索)</span>';
    }

    row += '</div>';
    return row;
}

// ══════════════════════════════════════════════════
// 底部弹窗
// ══════════════════════════════════════════════════

function openBottomSheet(title, bodyHtml) {
    document.getElementById('sheetHeader').innerHTML = title;
    document.getElementById('sheetBody').innerHTML = bodyHtml;
    document.getElementById('bottomSheetOverlay').classList.add('active');
    document.getElementById('bottomSheet').classList.add('active');
}

function closeBottomSheet() {
    document.getElementById('bottomSheetOverlay').classList.remove('active');
    document.getElementById('bottomSheet').classList.remove('active');
}

function renderItemRow(item) {
    const isNearsighted = item.discovered === 2;
    const displayName = isNearsighted ? item.display_name : item.itm;

    let row = '<div class="sheet-item">'
        + '<span class="item-name">' + escapeHtml(displayName) + '</span>';

    if (!isNearsighted) {
        row += '<span class="item-meta">' + escapeHtml(item.itmk)
            + ' eff:' + item.itme + ' dur:' + escapeHtml(item.itms) + '</span>';
    }

    row += '<button class="cmdbutton" onclick="window._tileActionPickup(' + item.iid + ')">[拾取]</button>'
        + '</div>';
    return row;
}

// ══════════════════════════════════════════════════
// 按钮禁用/启用（命令执行期间防重复提交）
// ══════════════════════════════════════════════════

function setActionBarDisabled(disabled) {
    const el = document.getElementById('tileActionBar');
    if (!el) return;
    const buttons = el.querySelectorAll('.cmdbutton');
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
        const result = await commandQueue.execute({
            mode: 'command',
            command: 'obl_explore'
        });
        if (result.success) {
            dataManager.invalidateAll();
            await Promise.all([loadTileAction(), loadMap(), refreshLog()]);
        } else {
            showToast(result.error || '探索失败', 'error');
        }
    } finally {
        setActionBarDisabled(false);
    }
}

async function handleSearch(iaid) {
    setActionBarDisabled(true);
    try {
        const result = await commandQueue.execute({
            mode: 'command',
            command: 'obl_search',
            iaid: iaid
        });
        if (result.success) {
            dataManager.invalidateAll();
            await Promise.all([loadTileAction(), loadInventory(), refreshLog()]);
        } else {
            showToast(result.error || '搜索失败', 'error');
        }
    } finally {
        setActionBarDisabled(false);
    }
}

async function handlePickup(iid) {
    const result = await commandQueue.execute({
        mode: 'command',
        command: 'obl_pickup',
        iid: iid
    });
    if (result.success) {
        // 从弹窗 DOM 中移除已拾取的道具行
        const body = document.getElementById('sheetBody');
        if (body) {
            const items = body.querySelectorAll('.sheet-item');
            for (let i = 0; i < items.length; i++) {
                const btn = items[i].querySelector('.cmdbutton');
                if (btn && btn.getAttribute('onclick') &&
                    btn.getAttribute('onclick').indexOf('window._tileActionPickup(' + iid + ')') !== -1) {
                    items[i].remove();
                    break;
                }
            }
            // 弹窗内道具清空后自动关闭
            if (body.querySelectorAll('.sheet-item').length === 0) {
                closeBottomSheet();
            }
        }
        dataManager.invalidateAll();
        await Promise.all([loadTileAction(), loadInventory(), refreshLog()]);
    } else {
        showToast(result.error || '拾取失败', 'error');
    }
}

async function handlePickupAll(items) {
    for (let i = 0; i < items.length; i++) {
        await commandQueue.execute({
            mode: 'command',
            command: 'obl_pickup',
            iid: items[i].iid
        });
    }
    dataManager.invalidateAll();
    await Promise.all([loadTileAction(), loadInventory(), refreshLog()]);
    closeBottomSheet();
}

async function handleDiscard(slot) {
    const result = await commandQueue.execute({
        mode: 'command',
        command: 'obl_discard',
        slot: slot
    });
    if (result.success) {
        dataManager.invalidateAll();
        await Promise.all([loadTileAction(), loadInventory(), refreshLog()]);
    } else {
        showToast(result.error || '丢弃失败', 'error');
    }
}

function checkPoi(iaid) {
    let poi = null;
    const pois = (tileData && tileData.pois) ? tileData.pois : [];
    for (let i = 0; i < pois.length; i++) {
        if (pois[i].iaid === iaid) { poi = pois[i]; break; }
    }
    if (!poi) return;

    // 机制触发型 POI（已搜索后显示机制效果）
    if (poi.mechanic && poi.searched) {
        const body = '<div class="mechanic-result">'
            + '<div class="mechanic-effect">✦ 最大生命值 +' + (poi.mechanic_value || 0) + '</div>'
            + '</div>'
            + '<div class="sheet-footer"><button class="cmdbutton" onclick="window._tileActionCloseSheet()">[确认]</button></div>';
        openBottomSheet(escapeHtml(poi.name), body);
        return;
    }

    // 掉落型 POI
    const items = poi.items || [];
    if (items.length === 0) return;

    let body = '';
    for (let i = 0; i < items.length; i++) {
        body += renderItemRow(items[i]);
    }
    body += '<div class="sheet-footer"><button class="cmdbutton" onclick="window._tileActionPickupAllPoi(' + iaid + ')">[全部拾取]</button></div>';
    openBottomSheet(escapeHtml(poi.name) + '<br><span class="grey">' + escapeHtml(poi.desc || '') + '</span>', body);
}

function checkGround() {
    const items = (tileData && tileData.ground_items) ? tileData.ground_items : [];
    if (items.length === 0) return;

    let body = '';
    for (let i = 0; i < items.length; i++) {
        body += renderItemRow(items[i]);
    }
    body += '<div class="sheet-footer"><button class="cmdbutton" onclick="window._tileActionPickupAllGround()">[全部拾取]</button></div>';
    openBottomSheet('脚边的物品', body);
}

// ══════════════════════════════════════════════════
// 事件监听 — 移动完成后 / 地图加载后刷新动作条
// ══════════════════════════════════════════════════

DebugBus.on(function(entry) {
    // 移动完成后刷新（携带 success 标记）
    if (entry.cat === 'action' && entry.step === 'clickMove:response') {
        if (entry.data && entry.data.success) {
            loadTileAction();
        }
        return;
    }
    // 地图加载完成后刷新（解决 loadAll 并发时 mapData.links 尚未就绪的顺序问题）
    if (entry.cat === 'map' && entry.step === 'loaded') {
        if (entry.data && entry.data.hasLinks) {
            loadTileAction();
        }
        return;
    }
});

// ══════════════════════════════════════════════════
// 暴露到 window（HTML onclick + map.js 点击当前格探索需要）
// ══════════════════════════════════════════════════

window._tileActionExplore = handleExplore;
window._tileActionSearch = handleSearch;
window._tileActionPickup = handlePickup;
window._tileActionDiscard = handleDiscard;
window._tileActionCheckPoi = checkPoi;
window._tileActionCheckGround = checkGround;
window._tileActionCloseSheet = closeBottomSheet;

window._tileActionPickupAllPoi = function(iaid) {
    let poi = null;
    const pois = (tileData && tileData.pois) ? tileData.pois : [];
    for (let i = 0; i < pois.length; i++) {
        if (pois[i].iaid === iaid) { poi = pois[i]; break; }
    }
    if (poi && poi.items) handlePickupAll(poi.items);
};

window._tileActionPickupAllGround = function() {
    if (tileData && tileData.ground_items) handlePickupAll(tileData.ground_items);
};

window.closeBottomSheet = closeBottomSheet;
