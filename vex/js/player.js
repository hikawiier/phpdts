// ══════════════════════════════════════════════════
// 玩家信息 / Player info (左侧抽屉 + 状态栏)
// ══════════════════════════════════════════════════

import { DebugBus, RAGE_STATUS, POSE_NAMES, TACTIC_NAMES, mapData, BASE_URL } from './data.js';
import { escapeHtml, getPlaceName, getGenderText, getRaceText, getClubText } from './utils.js';
import { dataManager } from './data-manager.js';
import { updateToastPosition } from './toast-position.js';

// ══════════════════════════════════════════════════
// 状态栏渲染
// ══════════════════════════════════════════════════

let statusData = null; // 缓存 player_info 数据

export async function renderStatusBar() {
    const result = await dataManager.fetch('player_info', true);
    if (result.status !== 'success' || !result.data) return;
    statusData = result.data;
    applyStatusBar();
}

function applyStatusBar() {
    if (!statusData) return;
    const d = statusData;

    // 头像
    const avatarEl = document.getElementById('statusAvatar');
    if (avatarEl) {
        const gd = d.gd || 'f';
        const icon = d.icon || '0';
        const imgSrc = BASE_URL + '/img/' + gd + '_' + icon + '.gif';
        avatarEl.innerHTML = '<img src="' + escapeHtml(imgSrc) + '" alt="avatar" onerror="this.parentElement.innerHTML=\'<span class=status-avatar-fallback>???</span>\'">';
    }

    // 位置信息
    let regionName = 'unknown';
    let curName = 'unknown';
    if (mapData.links && mapData.curRegion !== null && mapData.links.regions[mapData.curRegion]) {
        regionName = mapData.links.regions[mapData.curRegion].name || 'unknown';
    }
    if (mapData.curLoc !== null) {
        curName = getPlaceName(mapData.curLoc);
    }
    const regionEl = document.getElementById('regionInfo');
    if (regionEl) regionEl.textContent = regionName;
    const locationEl = document.getElementById('locationInfo');
    if (locationEl) locationEl.textContent = curName;

    // HP 条
    const hp = d.hp || 0;
    const mhp = d.mhp || 1;
    const hpPct = Math.max(0, Math.min(100, (hp / mhp) * 100));
    const hpBar = document.getElementById('hpBar');
    const hpText = document.getElementById('hpText');
    if (hpBar) {
        hpBar.style.width = hpPct + '%';
        if (hp / mhp < 0.3) {
            hpBar.classList.add('danger');
        } else {
            hpBar.classList.remove('danger');
        }
    }
    if (hpText) {
        hpText.textContent = 'HP ' + hp + '/' + mhp;
        if (hp / mhp < 0.3) {
            hpText.classList.add('danger');
        } else {
            hpText.classList.remove('danger');
        }
    }

    // SP 条
    const sp = d.sp || 0;
    const msp = d.msp || 1;
    const spPct = Math.max(0, Math.min(100, (sp / msp) * 100));
    const spBar = document.getElementById('spBar');
    const spText = document.getElementById('spText');
    if (spBar) spBar.style.width = spPct + '%';
    if (spText) spText.textContent = 'SP ' + sp + '/' + msp;
}

export async function loadPlayerInfo() {
    const el = document.getElementById('playerInfo');
    if (!el) return;
    el.innerHTML = '<div class="loading">loading...</div>';
    DebugBus.emit('api', 'loadPlayerInfo:start', { action: 'player_info' });
    const result = await dataManager.fetch('player_info', true);
    if (result.status !== 'success') { el.innerHTML = '<div class="error">load failed</div>'; return; }
    const d = result.data;
    if (!d) { el.innerHTML = '<div class="error">no data</div>'; return; }

    const hpPct = d.mhp ? (d.hp / d.mhp) * 100 : 0;
    const spPct = d.msp ? (d.sp / d.msp) * 100 : 0;
    const expPct = d.upexp ? (d.exp / d.upexp) * 100 : 0;

    let html = '';

    html += '<div>'
        + '<div class="drawer-section-title">├─ VITALITY</div>'
        + '<div class="stat-bar"><div class="stat-fill hp" style="width:' + hpPct + '%"></div></div>'
        + '<div class="drawer-stat-line">' + (d.hp || 0) + ' / ' + (d.mhp || 0) + '</div>'
        + '</div>';

    html += '<div>'
        + '<div class="drawer-section-title">├─ STAMINA</div>'
        + '<div class="stat-bar"><div class="stat-fill sp" style="width:' + spPct + '%"></div></div>'
        + '<div class="drawer-stat-line">' + (d.sp || 0) + ' / ' + (d.msp || 0) + '</div>'
        + '</div>';

    html += '<div>'
        + '<div class="drawer-section-title">├─ EXPERIENCE</div>'
        + '<div class="stat-bar"><div class="stat-fill exp" style="width:' + expPct + '%"></div></div>'
        + '<div class="drawer-stat-line">LV' + (d.lvl || 0) + ' — ' + (d.exp || 0) + ' / ' + (d.upexp || 100) + '</div>'
        + '</div>';

    html += '<div class="drawer-stat-line" style="padding-top:8px; border-top:1px solid rgba(68,68,68,0.2);">'
        + '<div>├─ ATK: ' + (d.att || 0) + ' | DEF: ' + (d.def || 0) + '</div>'
        + '<div>├─ KILLS: ' + (d.killnum || 0) + ' | MONEY: ' + (d.money || 0) + '</div>'
        + '<div>├─ RAGE: ' + escapeHtml(RAGE_STATUS[d.rage] || d.rage) + '</div>'
        + '<div>├─ POS: ' + escapeHtml(getPlaceName(d.pls)) + ' [' + d.pls + ']</div>'
        + '<div>└─ POSE: ' + escapeHtml(POSE_NAMES[d.pose] || d.pose) + ' | TAC: ' + escapeHtml(TACTIC_NAMES[d.tactic] || d.tactic) + '</div>'
        + '</div>';

    html += '<div class="drawer-stat-line" style="padding-top:8px; border-top:1px solid rgba(68,68,68,0.2);">'
        + '<div class="drawer-section-title">├─ PROFILE</div>'
        + '<div>├─ name: ' + escapeHtml(d.name) + '</div>'
        + '<div>├─ ' + escapeHtml(getGenderText(d.gd)) + ' | ' + escapeHtml(getRaceText(d.race)) + '</div>'
        + '<div>├─ club: ' + escapeHtml(getClubText(d.club)) + '</div>'
        + '<div>└─ nick: ' + escapeHtml(d.nick) + '</div>'
        + '</div>';

    el.innerHTML = html;
}

// ══════════════════════════════════════════════════
// 抽屉开关
// ══════════════════════════════════════════════════

let drawerOpen = false;

export function toggleDrawer() {
    const drawer = document.getElementById('playerDrawer');
    const overlay = document.getElementById('drawerOverlay');
    drawerOpen = !drawerOpen;
    if (drawerOpen) {
        drawer.classList.add('open');
        overlay.classList.add('open');
        loadPlayerInfo();
    } else {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    }
    updateToastPosition();
}

export function closeDrawer() {
    const drawer = document.getElementById('playerDrawer');
    const overlay = document.getElementById('drawerOverlay');
    drawerOpen = false;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    updateToastPosition();
}

export function isDrawerOpen() {
    return drawerOpen;
}

// 操作完成时刷新 drawer 内容（若已打开）+ 状态栏
dataManager.listen('game:action-completed', function() {
    if (drawerOpen) loadPlayerInfo();
    dataManager.invalidate('player_info');
    renderStatusBar();
});

// 地图加载完成时更新位置信息
dataManager.listen('map:loaded', function() {
    applyStatusBar();
});
