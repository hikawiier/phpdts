// ══════════════════════════════════════════════════
// 背包 / Inventory (item slots itm1~itm6)
// ══════════════════════════════════════════════════

async function loadInventory() {
    var listEl = document.getElementById('inventoryList');
    listEl.innerHTML = '<div class="loading">loading...</div>';
    Debug.add(Debug.CATEGORIES.API, 'loadInventory:start', { action: 'player_inventory' });
    var result = await gameApi('player_inventory');
    Debug.add(Debug.CATEGORIES.INVENTORY, 'loadInventory:response', result.data);
    if (result.status !== 'success') { listEl.innerHTML = '<div class="error">load failed: ' + escapeHtml(result.message) + '</div>'; return; }
    var d = result.data;

    var html = '<div class="slot-grid">';
    if (d.slots && d.slots.length > 0) {
        for (var i = 0; i < d.slots.length; i++) {
            var s = d.slots[i];
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
    var eqEl = document.getElementById('equipment');
    var result = await gameApi('player_info');
    if (result.status !== 'success') { eqEl.innerHTML = '<div class="error">load failed</div>'; return; }
    var eq = result.data.equipment;
    if (!eq) { eqEl.innerHTML = '<div class="error">no equipment data</div>'; return; }

    var eqSlots = [
        { key: 'wep',  label: 'Weapon', icon: 'W' },
        { key: 'wep2', label: 'Sub',    icon: 'S' },
        { key: 'arb',  label: 'Body',   icon: 'B' },
        { key: 'arh',  label: 'Head',   icon: 'H' },
        { key: 'ara',  label: 'Acc',    icon: 'A' },
        { key: 'arf',  label: 'Foot',   icon: 'F' },
        { key: 'art',  label: 'Other',  icon: 'O' }
    ];

    var html = '';
    for (var i = 0; i < eqSlots.length; i++) {
        var es = eqSlots[i];
        var item = eq[es.key];
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

var playerClub = 0;
var hasFoundItem = false;

async function loadItemFind() {
    var el = document.getElementById('itemFindArea');
    el.innerHTML = '<div class="loading">loading...</div>';
    var result = await gameApi('player_info');
    if (result.status !== 'success') {
        el.innerHTML = '<div class="error">load failed: ' + escapeHtml(result.message) + '</div>';
        return;
    }
    var d = result.data;
    playerClub = d.club || 0;

    if (!d.items || !d.items[0] || !d.items[0].name) {
        hasFoundItem = false;
        el.innerHTML = '<div class="card"><h3>items found</h3><p class="grey">nothing nearby.</p></div>';
        return;
    }

    hasFoundItem = true;

    var itm = d.items[0];
    var subKindHtml = '';
    if (itm.skk && isNaN(Number(itm.skk))) {
        subKindHtml = ' | props: ' + escapeHtml(itm.skk);
    }

    var clubHtml = '';
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

async function itemFindPickup() {
    var ok = await submitCommand({ mode: 'itemmain', command: 'itemget' });
    if (ok) {
        hasFoundItem = false;
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) Debug.renderAiDump();
    } else {
        alert('pickup failed');
    }
}

async function itemFindUse() {
    var ok = await submitCommand({ mode: 'command', command: 'itm0' });
    if (ok) {
        hasFoundItem = false;
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) Debug.renderAiDump();
    } else {
        alert('use failed');
    }
}

async function itemFindRefine() {
    var ok = await submitCommand({ mode: 'itemmain', command: 'split_itm0' });
    if (ok) {
        hasFoundItem = false;
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) Debug.renderAiDump();
    } else {
        alert('refine failed');
    }
}

async function itemFindDiscard() {
    var ok = await submitCommand({ mode: 'itemmain', command: 'dropitm0' });
    if (ok) {
        hasFoundItem = false;
        await Promise.all([loadItemFind(), loadInventory(), refreshLog()]);
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) Debug.renderAiDump();
    } else {
        alert('discard failed');
    }
}

// ══════════════════════════════════════════════════
// 探索记忆 / Exploration Memory (smeo)
// ══════════════════════════════════════════════════

var explorationMemory = {};
var hasExplorationMemory = false;

async function loadExplorationMemory() {
    var sectionEl = document.getElementById('memorySection');
    var areaEl = document.getElementById('memoryArea');
    if (!sectionEl || !areaEl) return;

    var result = await gameApi('player_info');
    if (result.status !== 'success') return;

    var d = result.data;
    var smeo = (d.clbpara && d.clbpara.smeo) ? d.clbpara.smeo : null;

    if (!smeo || Object.keys(smeo).length === 0) {
        hasExplorationMemory = false;
        explorationMemory = {};
        sectionEl.style.display = 'none';
        return;
    }

    hasExplorationMemory = true;
    explorationMemory = smeo;
    sectionEl.style.display = '';

    var html = '';
    for (var key in smeo) {
        var mem = smeo[key];
        if (!mem || !mem[1]) continue;

        var type = mem[1];
        var name = mem[2] || 'unknown';
        var btnText = '';
        var btnClass = '';
        var icon = '';

        if (type === 'itm') {
            btnText = 'pickup ' + name;
            btnClass = 'pickup';
            icon = 'I';
        } else if (type === 'enemy') {
            btnText = 'fight ' + name;
            btnClass = 'use';
            icon = 'F';
        } else if (type === 'corpse') {
            btnText = 'check ' + name + '\'s corpse';
            btnClass = 'refine';
            icon = 'C';
        } else {
            continue;
        }

        html +=
            '<div class="card memory-card">' +
            '<div class="memory-header">' +
            '<span class="memory-icon">' + icon + '</span>' +
            '<span class="memory-name">' + escapeHtml(name) + '</span>' +
            '</div>' +
            '<div class="memory-buttons">' +
            '<button class="cmdbutton ' + btnClass + '" onclick="explorationMemoryAction(\'' + key + '\')">' + escapeHtml(btnText) + '</button>' +
            '</div>' +
            '</div>';
    }

    areaEl.innerHTML = html || '<p class="grey">no memory</p>';
}

async function explorationMemoryAction(key) {
    var ok = await submitCommand({ mode: 'command', command: 'memory' + key });
    if (ok) {
        await Promise.all([loadExplorationMemory(), loadItemFind(), loadInventory(), refreshLog()]);
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) Debug.renderAiDump();
    } else {
        alert('action failed');
    }
}