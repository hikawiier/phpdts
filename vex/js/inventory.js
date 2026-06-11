// ══════════════════════════════════════════════════
// 背包 / Inventory (道具槽 itm1~itm6)
// ══════════════════════════════════════════════════

async function loadInventory() {
    var listEl = document.getElementById('inventoryList');
    listEl.innerHTML = '<div class="loading">加载中...</div>';
    Debug.add(Debug.CATEGORIES.API, 'loadInventory:start', { action: 'player_inventory' });
    var result = await gameApi('player_inventory');
    Debug.add(Debug.CATEGORIES.INVENTORY, 'loadInventory:response', result.data);
    if (result.status !== 'success') { listEl.innerHTML = '<div class="error">加载失败: ' + escapeHtml(result.message) + '</div>'; return; }
    var d = result.data;

    var html = '<div class="slot-grid">';
    if (d.slots && d.slots.length > 0) {
        for (var i = 0; i < d.slots.length; i++) {
            var s = d.slots[i];
            if (s.empty) {
                html += '<div class="slot-card slot-empty"><span class="slot-num">' + s.slot + '</span><span class="slot-empty-text">空</span></div>';
            } else {
                html += '<div class="slot-card slot-filled">' +
                    '<span class="slot-num">' + s.slot + '</span>' +
                    '<span class="slot-name">' + escapeHtml(s.name) + '</span>' +
                    '<span class="slot-kind">' + escapeHtml(s.kind) + '</span>' +
                    '<span class="slot-meta">效:' + s.effect + ' 耐:' + escapeHtml(s.durability) + '</span>' +
                    '</div>';
            }
        }
    }
    html += '</div>';
    html += '<div class="slot-info">道具: ' + (d.num||0) + '/' + (d.limit||20) + '</div>';
    listEl.innerHTML = html;

    loadEquipment();
}

// ══════════════════════════════════════════════════
// 装备 / Equipment
// ══════════════════════════════════════════════════

async function loadEquipment() {
    var eqEl = document.getElementById('equipment');
    var result = await gameApi('player_info');
    if (result.status !== 'success') { eqEl.innerHTML = '<div class="error">加载失败</div>'; return; }
    var eq = result.data.equipment;
    if (!eq) { eqEl.innerHTML = '<div class="error">无装备数据</div>'; return; }

    var eqSlots = [
        { key: 'wep',  label: '主武器', icon: '⚔' },
        { key: 'wep2', label: '副武器', icon: '🗡' },
        { key: 'arb',  label: '身体',   icon: '🛡' },
        { key: 'arh',  label: '头部',   icon: '⛑' },
        { key: 'ara',  label: '饰品',   icon: '💍' },
        { key: 'arf',  label: '脚部',   icon: '👢' },
        { key: 'art',  label: '其他',   icon: '📿' }
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
                '<span class="eq-meta">' + escapeHtml(item.kind||'') + ' 效:' + (item.exp||0) + ' 耐:' + escapeHtml(item.sk||'0') + '</span>' +
                '</div>';
        } else {
            html += '<div class="eq-slot eq-empty">' +
                '<span class="eq-icon">' + es.icon + '</span>' +
                '<span class="eq-label">' + es.label + '</span>' +
                '<span class="eq-name">无</span>' +
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
    el.innerHTML = '<div class="loading">加载中...</div>';
    var result = await gameApi('player_info');
    if (result.status !== 'success') {
        el.innerHTML = '<div class="error">加载失败: ' + escapeHtml(result.message) + '</div>';
        return;
    }
    var d = result.data;
    playerClub = d.club || 0;

    if (!d.items || !d.items[0] || !d.items[0].name) {
        hasFoundItem = false;
        el.innerHTML = '<div class="card"><h3>发现物品</h3><p class="grey">附近没有发现物品。</p></div>';
        return;
    }

    hasFoundItem = true;

    var itm = d.items[0];
    var subKindHtml = '';
    if (itm.skk && isNaN(Number(itm.skk))) {
        subKindHtml = '，属性：' + escapeHtml(itm.skk);
    }

    var clubHtml = '';
    if (playerClub === 20) {
        clubHtml = '<button class="cmdbutton refine" onclick="itemFindRefine()">[C]提炼</button>';
    }

    el.innerHTML =
        '<div class="card itemfind-card">' +
        '<h3>发现物品</h3>' +
        '<p>发现了物品 <span class="yellow">' + escapeHtml(itm.name) + '</span>，' +
        '类型：' + escapeHtml(itm.kind) + subKindHtml + '，' +
        '效：' + escapeHtml(itm.exp) + '，耐：' + escapeHtml(itm.sk) + '。</p>' +
        '<div class="itemfind-buttons">' +
        '<button class="cmdbutton pickup" onclick="itemFindPickup()">[Z]拾取</button>' +
        '<button class="cmdbutton use" onclick="itemFindUse()">[A]使用</button>' +
        clubHtml +
        '<button class="cmdbutton discard" onclick="itemFindDiscard()">[X]丢弃</button>' +
        '</div>' +
        '</div>';
}

async function itemFindPickup() {
    var ok = await submitCommand({ mode: 'itemmain', command: 'itemget' });
    if (ok) { hasFoundItem = false; loadItemFind(); loadInventory(); refreshLog(); } else { alert('拾取失败'); }
}

async function itemFindUse() {
    var ok = await submitCommand({ mode: 'command', command: 'itm0' });
    if (ok) { hasFoundItem = false; loadItemFind(); loadInventory(); refreshLog(); } else { alert('使用失败'); }
}

async function itemFindRefine() {
    var ok = await submitCommand({ mode: 'itemmain', command: 'split_itm0' });
    if (ok) { hasFoundItem = false; loadItemFind(); loadInventory(); refreshLog(); } else { alert('提炼失败'); }
}

async function itemFindDiscard() {
    var ok = await submitCommand({ mode: 'itemmain', command: 'dropitm0' });
    if (ok) { hasFoundItem = false; loadItemFind(); loadInventory(); refreshLog(); } else { alert('丢弃失败'); }
}

// ══════════════════════════════════════════════════
// 探索记忆 / Exploration Memory (smeo)
// 当 $clbpara['smeo'] 存在时显示
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
        var name = mem[2] || '未知';
        var btnText = '';
        var btnClass = '';
        var icon = '';

        if (type === 'itm') {
            btnText = '拾取 ' + name;
            btnClass = 'pickup';
            icon = '📦';
        } else if (type === 'enemy') {
            btnText = '迎战 ' + name;
            btnClass = 'use';
            icon = '⚔';
        } else if (type === 'corpse') {
            btnText = '检查 ' + name + ' 的尸体';
            btnClass = 'refine';
            icon = '💀';
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

    areaEl.innerHTML = html || '<p class="grey">暂无探索记忆</p>';
}

async function explorationMemoryAction(key) {
    var ok = await submitCommand({ mode: 'command', command: 'memory' + key });
    if (ok) {
        loadExplorationMemory();
        loadItemFind();
        loadInventory();
        refreshLog();
    } else {
        alert('操作失败');
    }
}
