// ══════════════════════════════════════════════════
// 背包 + 装备 / Inventory & Equipment (ASCII 终端风)
// ══════════════════════════════════════════════════

import { DebugBus, mapData } from './data.js';
import { escapeHtml, gameApi } from './utils.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';

// ══════════════════════════════════════════════════
// 背包渲染
// ══════════════════════════════════════════════════

export async function loadInventory() {
    const listEl = document.getElementById('inventoryList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="loading">loading...</div>';
    DebugBus.emit('api', 'loadInventory:start', { action: 'player_inventory' });
    const result = await gameApi('player_inventory');
    if (result.status !== 'success') {
        listEl.innerHTML = '<div class="error">load failed</div>';
        return;
    }
    const d = result.data;
    const isOblivions = !!mapData.links;

    let html = '<div class="inv-grid">';
    if (d.slots && d.slots.length > 0) {
        for (let i = 0; i < d.slots.length; i++) {
            const s = d.slots[i];
            if (s.empty) {
                html += '<div class="slot-card slot-empty">'
                    + '<span class="slot-num">[' + s.slot + ']</span>'
                    + '<span class="slot-kind">···</span>'
                    + '</div>';
            } else {
                html += '<div class="slot-card slot-filled">'
                    + '<span class="slot-num">[' + s.slot + ']</span>'
                    + '<span class="slot-name">' + escapeHtml(s.name) + '</span>'
                    + '<span class="slot-kind">' + escapeHtml(s.kind) + '</span>'
                    + '<span class="slot-meta">eff:' + s.effect + ' dur:' + escapeHtml(s.durability) + '</span>';
                if (isOblivions) {
                    html += '<div class="discard-wrap"><button class="term-btn discard" data-action="discard" data-slot="' + s.slot + '">[丢弃]</button></div>';
                }
                html += '</div>';
            }
        }
    }
    html += '</div>';
    html += '<div class="slot-info">items: ' + (d.num || 0) + '/' + (d.limit || 20) + '</div>';
    listEl.innerHTML = html;

    // 绑定丢弃按钮事件
    const discardBtns = listEl.querySelectorAll('button[data-action="discard"]');
    for (let i = 0; i < discardBtns.length; i++) {
        discardBtns[i].addEventListener('click', function() {
            handleDiscard(parseInt(this.dataset.slot));
        });
    }

    loadEquipment();
}

// ══════════════════════════════════════════════════
// 装备渲染
// ══════════════════════════════════════════════════

async function loadEquipment() {
    const eqEl = document.getElementById('equipment');
    if (!eqEl) return;
    const result = await dataManager.fetch('player_info');
    if (result.status !== 'success') { eqEl.innerHTML = '<div class="error">load failed</div>'; return; }
    const d = result.data;
    if (!d) { eqEl.innerHTML = '<div class="error">no data</div>'; return; }

    const eq = d.equipment || {};
    const eqSlots = [
        { key: 'wep',  label: 'WPN' },
        { key: 'wep2', label: 'SUB' },
        { key: 'arb',  label: 'BOD' },
        { key: 'arh',  label: 'HED' },
        { key: 'ara',  label: 'ACC' },
        { key: 'arf',  label: 'FT'  },
        { key: 'art',  label: 'OTH' }
    ];

    let html = '';
    for (let i = 0; i < eqSlots.length; i++) {
        const es = eqSlots[i];
        const item = eq[es.key];
        if (item && item.name) {
            html += '<div class="eq-slot">'
                + '<span class="eq-label">' + es.label + '</span>'
                + '<span class="eq-name">' + escapeHtml(item.name) + '</span>'
                + '<span class="eq-meta">ATK:' + (item.exp || 0) + '</span>'
                + '</div>';
        } else {
            html += '<div class="eq-slot eq-empty">'
                + '<span class="eq-label">' + es.label + '</span>'
                + '<span class="eq-name">---</span>'
                + '</div>';
        }
    }

    eqEl.innerHTML = html;
}

// ══════════════════════════════════════════════════
// 丢弃（Oblivions）
// ══════════════════════════════════════════════════

async function handleDiscard(slot) {
    const result = await commandQueue.execute({
        mode: 'command',
        command: 'obl_discard',
        slot: slot
    });
    if (result.success) {
        dataManager.invalidateAll();
        dataManager.broadcast('game:action-completed');
    } else {
        dataManager.broadcast('ui:toast', { type: 'error', msg: result.error || 'discard failed' });
    }
}

// ══════════════════════════════════════════════════
// 事件订阅：地图加载/操作完成时刷新背包
// ══════════════════════════════════════════════════

dataManager.listen('map:loaded', function() { loadInventory(); });
dataManager.listen('game:action-completed', function() { loadInventory(); });
