// ══════════════════════════════════════════════════
// 玩家信息 / Player info (drawer, ASCII 终端风)
// ══════════════════════════════════════════════════

import { DebugBus, RAGE_STATUS, POSE_NAMES, TACTIC_NAMES } from './data.js';
import { escapeHtml, getPlaceName, getGenderText, getRaceText, getClubText } from './utils.js';
import { dataManager } from './data-manager.js';

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
    const toggle = document.getElementById('drawerToggle');
    drawerOpen = !drawerOpen;
    if (drawerOpen) {
        drawer.classList.add('open');
        overlay.classList.add('open');
        toggle.classList.add('shifted');
        loadPlayerInfo();
    } else {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
        toggle.classList.remove('shifted');
    }
}

export function closeDrawer() {
    const drawer = document.getElementById('playerDrawer');
    const overlay = document.getElementById('drawerOverlay');
    const toggle = document.getElementById('drawerToggle');
    drawerOpen = false;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    toggle.classList.remove('shifted');
}

// 操作完成时刷新 drawer 内容（若已打开）
dataManager.listen('game:action-completed', function() {
    if (drawerOpen) loadPlayerInfo();
});
