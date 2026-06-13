// ══════════════════════════════════════════════════
// 背包 / Inventory (item slots itm1~itm6)
// ══════════════════════════════════════════════════

import { DebugBus } from './data.js';
import { escapeHtml, gameApi } from './utils.js';
import { refreshLog } from './log.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';

export let playerClub = 0;
export let hasFoundItem = false;

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
                    '<span class="slot-meta">eff:' + s.effect + ' dur:' + escapeHtml(s.durability) + '</span>' +
                    '</div>';
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

// ══════════════════════════════════════════════════
// 发现物品 / Item find
// ══════════════════════════════════════════════════

export async function loadItemFind() {
    const el = document.getElementById('itemFindArea');
    el.innerHTML = '<div class="loading">loading...</div>';
    const result = await dataManager.fetch('player_info');
    if (result.status !== 'success') {
        el.innerHTML = '<div class="error">load failed: ' + escapeHtml(result.message) + '</div>';
        return;
    }
    const d = result.data;
    playerClub = d.club || 0;

    if (!d.items || !d.items[0] || !d.items[0].name) {
        hasFoundItem = false;
        el.innerHTML = '<div class="card"><h3>items found</h3><p class="grey">nothing nearby.</p></div>';
        return;
    }

    hasFoundItem = true;

    const itm = d.items[0];
    let subKindHtml = '';
    if (itm.skk && isNaN(Number(itm.skk))) {
        subKindHtml = ' | props: ' + escapeHtml(itm.skk);
    }

    let clubHtml = '';
    if (playerClub === 20) {
        clubHtml = '<button class="cmdbutton refine" onclick="itemFindRefine()">[C]refine</button>';
    }

    el.innerHTML =
        '<div class="card itemfind-card">' +
        '<h3>items found</h3>' +
        '<p>found <span class="yellow">' + escapeHtml(itm.name) + '</span>, ' +
        'type: ' + escapeHtml(itm.kind) + subKindHtml + ', ' +
        'eff: ' + escapeHtml(itm.exp) + ', dur: ' + escapeHtml(itm.sk) + '.</p>' +
        '<div class="itemfind-buttons">' +
        '<button class="cmdbutton pickup" onclick="itemFindPickup()">[Z]pickup</button>' +
        '<button class="cmdbutton use" onclick="itemFindUse()">[A]use</button>' +
        clubHtml +
        '<button class="cmdbutton discard" onclick="itemFindDiscard()">[X]discard</button>' +
        '</div>' +
        '</div>';
}

export async function itemFindPickup() {
    const result = await commandQueue.execute({ mode: 'itemmain', command: 'itemget' });
    if (result.success) {
        hasFoundItem = false;
        dataManager.invalidateAll();
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
    } else {
        alert('pickup failed' + (result.error ? ': ' + result.error : ''));
    }
}

export async function itemFindUse() {
    const result = await commandQueue.execute({ mode: 'command', command: 'itm0' });
    if (result.success) {
        hasFoundItem = false;
        dataManager.invalidateAll();
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
    } else {
        alert('use failed' + (result.error ? ': ' + result.error : ''));
    }
}

export async function itemFindRefine() {
    const result = await commandQueue.execute({ mode: 'itemmain', command: 'split_itm0' });
    if (result.success) {
        hasFoundItem = false;
        dataManager.invalidateAll();
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
    } else {
        alert('refine failed' + (result.error ? ': ' + result.error : ''));
    }
}

export async function itemFindDiscard() {
    const result = await commandQueue.execute({ mode: 'itemmain', command: 'dropitm0' });
    if (result.success) {
        hasFoundItem = false;
        dataManager.invalidateAll();
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
    } else {
        alert('discard failed' + (result.error ? ': ' + result.error : ''));
    }
}
