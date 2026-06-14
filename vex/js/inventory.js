// ══════════════════════════════════════════════════
// 背包 / Inventory (item slots itm1~itm6)
// ══════════════════════════════════════════════════

import { DebugBus, mapData } from './data.js';
import { escapeHtml, gameApi } from './utils.js';
import { dataManager } from './data-manager.js';

export async function loadInventory() {
    const listEl = document.getElementById('inventoryList');
    listEl.innerHTML = '<div class="loading">loading...</div>';
    DebugBus.emit('api', 'loadInventory:start', { action: 'player_inventory' });
    const result = await gameApi('player_inventory');
    DebugBus.emit('inventory', 'loadInventory:response', { slotCount: result.data ? (result.data.slots || []).length : 0 });
    if (result.status !== 'success') { listEl.innerHTML = '<div class="error">load failed: ' + escapeHtml(result.message) + '</div>'; return; }
    const d = result.data;

    let html = '<div class="slot-grid">';
    if (d.slots && d.slots.length > 0) {
        for (let i = 0; i < d.slots.length; i++) {
            const s = d.slots[i];
            if (s.empty) {
                html += '<div class="slot-card slot-empty"><span class="slot-num">' + s.slot + '</span><span class="slot-empty-text">empty</span></div>';
            } else {
                html += '<div class="slot-card slot-filled">' +
                    '<span class="slot-num">' + s.slot + '</span>' +
                    '<span class="slot-name">' + escapeHtml(s.name) + '</span>' +
                    '<span class="slot-kind">' + escapeHtml(s.kind) + '</span>' +
                    '<span class="slot-meta">eff:' + s.effect + ' dur:' + escapeHtml(s.durability) + '</span>';
                // Oblivions 模式下增加丢弃按钮（丢弃到当前地图格）
                if (mapData.links) {
                    html += '<button class="cmdbutton discard-btn" onclick="window._tileActionDiscard(' + s.slot + ')">[丢弃]</button>';
                }
                html += '</div>';
            }
        }
    }
    html += '</div>';
    html += '<div class="slot-info">items: ' + (d.num||0) + '/' + (d.limit||20) + '</div>';
    listEl.innerHTML = html;

    loadEquipment();
}

// ══════════════════════════════════════════════════
// 装备 / Equipment
// ══════════════════════════════════════════════════

async function loadEquipment() {
    const eqEl = document.getElementById('equipment');
    const result = await dataManager.fetch('player_info');
    if (result.status !== 'success') { eqEl.innerHTML = '<div class="error">load failed</div>'; return; }
    const eq = result.data.equipment;
    if (!eq) { eqEl.innerHTML = '<div class="error">no equipment data</div>'; return; }

    const eqSlots = [
        { key: 'wep',  label: 'Weapon', icon: 'W' },
        { key: 'wep2', label: 'Sub',    icon: 'S' },
        { key: 'arb',  label: 'Body',   icon: 'B' },
        { key: 'arh',  label: 'Head',   icon: 'H' },
        { key: 'ara',  label: 'Acc',    icon: 'A' },
        { key: 'arf',  label: 'Foot',   icon: 'F' },
        { key: 'art',  label: 'Other',  icon: 'O' }
    ];

    let html = '';
    for (let i = 0; i < eqSlots.length; i++) {
        const es = eqSlots[i];
        const item = eq[es.key];
        if (item && item.name) {
            html += '<div class="eq-slot eq-filled">' +
                '<span class="eq-icon">' + es.icon + '</span>' +
                '<span class="eq-label">' + es.label + '</span>' +
                '<span class="eq-name">' + escapeHtml(item.name) + '</span>' +
                '<span class="eq-meta">' + escapeHtml(item.kind||'') + ' eff:' + (item.exp||0) + ' dur:' + escapeHtml(item.sk||'0') + '</span>' +
                '</div>';
        } else {
            html += '<div class="eq-slot eq-empty">' +
                '<span class="eq-icon">' + es.icon + '</span>' +
                '<span class="eq-label">' + es.label + '</span>' +
                '<span class="eq-name">(none)</span>' +
                '</div>';
        }
    }
    eqEl.innerHTML = html;
}

// 地图加载完成后重新渲染背包（确保 mapData.links 就绪时 Oblivions 丢弃按钮正确显示）
DebugBus.on(function(entry) {
    if (entry.cat === 'map' && entry.step === 'loaded') {
        loadInventory();
    }
});

