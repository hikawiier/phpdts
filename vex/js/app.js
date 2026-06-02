// ══════════════════════════════════════════════════
// 资源数据预设 / Resource data presets
// 来自 gamedata/cache/resources_1.php
// ══════════════════════════════════════════════════

var PLACE_NAMES = {
    0:'无月之影',1:'端点',2:'RF高校',3:'雪之镇',4:'索拉利斯',5:'指挥中心',
    6:'梦幻馆',7:'清水池',8:'白穗神社',9:'墓地',10:'麦斯克林',
    11:'对天使用作战本部',12:'夏之镇',13:'三体星',14:'光坂高校',15:'守矢神社',
    16:'常磐森林',17:'常磐台中学',18:'秋之镇',19:'精灵中心',20:'春之镇',
    21:'圣Gradius学园',22:'初始之树',23:'幻想世界',24:'永恒的世界',25:'妖精驿站',
    26:'键刃墓场',27:'花菱商厦',28:'FARGO前基地',29:'风祭森林',30:'天使队移动格纳库',
    31:'和田町研究所',32:'SCP研究设施',33:'雏菊之丘',34:'英灵殿'
};

var XY_COORDS = {
    0:'B-2',1:'A-6',2:'H-3',3:'B-6',4:'F-10',5:'D-6',
    6:'H-6',7:'F-3',8:'E-10',9:'J-4',10:'I-8',11:'D-8',
    12:'F-9',13:'H-4',14:'H-8',15:'G-1',16:'I-2',17:'A-5',
    18:'G-4',19:'D-4',20:'I-7',21:'F-7',22:'J-6',23:'A-8',
    24:'C-9',25:'D-2',26:'A-1',27:'F-8',28:'E-1',29:'F-5',
    30:'F-6',31:'J-1',32:'J-2',33:'F-4',34:'J-10'
};

var COORD_TO_AREA = {};
(function() {
    for (var n in XY_COORDS) {
        COORD_TO_AREA[XY_COORDS[n]] = parseInt(n);
    }
})();

var WEATHER_NAMES = {
    0:'晴天',1:'大晴',2:'多云',3:'小雨',4:'暴雨',5:'台风',6:'雷雨',
    7:'下雪',8:'起雾',9:'浓雾',10:'瘴气',11:'龙卷风',12:'暴风雪',
    13:'冰雹',14:'离子暴',15:'辐射尘',16:'臭氧洞',17:'极光',18:'光玉雨'
};

var GAME_STATE_NAMES = {
    0:'已结束',10:'即将开始',20:'开放激活',30:'停止激活',40:'连斗中',50:'死斗中',60:'紧急状态！'
};

var GENDER_NAMES = {0:'未定', m:'男生', f:'女生', n:'投影'};

var RACE_NAMES = {0:'人类',1:'兽人',2:'妖精',3:'龙',4:'鱼人',5:'ＡＩ'};

var CLUB_NAMES = {
    0:'无',1:'街头霸王',2:'见敌必斩',3:'灌篮高手',4:'狙击鹰眼',5:'拆弹专家',
    6:'宛如疾风',7:'锡安成员',8:'黑衣组织',9:'超能力者',10:'天赋异禀',
    11:'富家子弟',12:'全能兄贵',13:'铁拳无敌',15:'L5状态',17:'走路萌物',
    19:'晶莹剔透',20:'元素大师',21:'码语行人',22:'枫火歌者',98:'换装迷宫',99:'第一形态'
};

var HP_STATUS = ['并无大碍','伤痕累累','生命危险','已经死亡'];
var SP_STATUS = ['精力充沛','略有疲惫','精疲力尽','已经死亡'];
var RAGE_STATUS = ['平静','愤怒','暴怒','已经死亡'];
var POSE_NAMES = ['通常','作战姿态','强袭姿态','探物姿态','偷袭姿态','治疗姿态','✧狂飙姿态✧','哨戒姿态'];
var TACTIC_NAMES = ['通常','','重视防御','重视反击','重视躲避'];

// ══════════════════════════════════════════════════
// 工具函数 / Utility functions
// ══════════════════════════════════════════════════

function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function getPlaceName(pls) { return PLACE_NAMES[pls] || ('位置' + pls); }

function getWeatherText(w)  { return WEATHER_NAMES[w] || '未知'; }
function getStateText(s)    { return GAME_STATE_NAMES[s] || '未知'; }
function getGenderText(g)   { return GENDER_NAMES[g] || '未知'; }
function getRaceText(r)     { return RACE_NAMES[r] || '未知'; }
function getClubText(c)     { return CLUB_NAMES[c] || ('社团' + c); }

// ══════════════════════════════════════════════════
// API请求 / API request (只读)
// ══════════════════════════════════════════════════

async function apiRequest(url, method, data) {
    method = method || 'GET';
    data = data || null;
    try {
        var options = { method: method, credentials: 'include' };
        if (data) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(data);
        }
        var response = await fetch(url, options);
        if (!response.ok) {
            console.error('HTTP ' + response.status);
            return { status:'error', code:'HTTP_ERROR', message:'服务器错误(' + response.status + ')' };
        }
        var ct = response.headers.get('content-type');
        if (!ct || ct.indexOf('application/json') === -1) {
            console.error('非JSON');
            return { status:'error', code:'INVALID_RESPONSE', message:'服务器返回格式错误' };
        }
        return await response.json();
    } catch (e) {
        console.error('API失败:', e);
        return { status:'error', code:'NETWORK_ERROR', message:'网络错误' };
    }
}

// ══════════════════════════════════════════════════
// 表单提交到后端 / Form submission (走 command.php / chat.php)
// ══════════════════════════════════════════════════

async function submitCommand(params) {
    var body = new URLSearchParams();
    if (!params.mode) { params.mode = 'command'; }
    for (var k in params) { body.append(k, params[k]); }
    try {
        var resp = await fetch('/phpdts/command.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        return resp.ok;
    } catch (e) {
        console.error('提交失败:', e);
        return false;
    }
}

// ══════════════════════════════════════════════════
// 玩家信息 / Player info (渲染到抽屉内)
// ══════════════════════════════════════════════════

async function loadPlayerInfo() {
    var el = document.getElementById('playerInfo');
    el.innerHTML = '<div class="loading">加载中...</div>';
    var result = await apiRequest('/phpdts/api_v2.php?action=player_info');
    if (result.status !== 'success') { el.innerHTML = '<div class="error">加载失败: ' + escapeHtml(result.message) + '</div>'; return; }
    var d = result.data;
    var expP = ((d.exp||0)/(d.upexp||1))*100;
    el.innerHTML =
        '<div class="card"><h3>基本信息</h3>' +
        '<p>名称: ' + escapeHtml(d.name) + '</p>' +
        '<p>性别: ' + escapeHtml(getGenderText(d.gd)) + ' | 种族: ' + escapeHtml(getRaceText(d.race)) + '</p>' +
        '<p>编号: ' + escapeHtml(d.sNo) + ' | 社团: ' + escapeHtml(getClubText(d.club)) + '</p>' +
        '<p>昵称: ' + escapeHtml(d.nick) + '</p>' +
        '</div>' +
        '<div class="card"><h3>等级信息</h3>' +
        '<p>等级: ' + (d.lvl||0) + ' | 经验: ' + (d.exp||0) + '/' + (d.upexp||100) + '</p>' +
        '<div class="stat-bar"><div class="stat-fill exp" style="width:' + expP + '%"></div></div>' +
        '</div>' +
        '<div class="card"><h3>战斗数据</h3>' +
        '<p>HP: ' + (d.hp||0) + '/' + (d.mhp||0) + ' | SP: ' + (d.sp||0) + '/' + (d.msp||0) + '</p>' +
        '<p>攻击: ' + (d.att||0) + ' | 防御: ' + (d.def||0) + ' | SS: ' + (d.ss||0) + '/' + (d.mss||0) + '</p>' +
        '<p>击杀: ' + (d.killnum||0) + ' | 金钱: ' + (d.money||0) + ' | 积分: ' + (d.rp||0) + '</p>' +
        '<p>怒气: ' + escapeHtml(RAGE_STATUS[d.rage]||d.rage) + '</p>' +
        '<p>位置: ' + escapeHtml(getPlaceName(d.pls)) + ' [' + d.pls + ']</p>' +
        '<p>姿态: ' + escapeHtml(POSE_NAMES[d.pose]||d.pose) + ' | 战术: ' + escapeHtml(TACTIC_NAMES[d.tactic]||d.tactic) + '</p>' +
        '</div>' +
        '<div class="card"><h3>武器熟练度</h3>' +
        '<p>殴: '+(d.wp||0)+' | 斩: '+(d.wk||0)+' | 射: '+(d.wg||0)+' | 投: '+(d.wc||0)+' | 爆: '+(d.wd||0)+' | 灵: '+(d.wf||0)+'</p>' +
        '</div>';
}

// ══════════════════════════════════════════════════
// 背包 / Inventory (道具槽 itm1~itm6)
// ══════════════════════════════════════════════════

async function loadInventory() {
    var listEl = document.getElementById('inventoryList');
    listEl.innerHTML = '<div class="loading">加载中...</div>';
    var result = await apiRequest('/phpdts/api_v2.php?action=player_inventory');
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
    var result = await apiRequest('/phpdts/api_v2.php?action=player_info');
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
    var result = await apiRequest('/phpdts/api_v2.php?action=player_info');
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

    var result = await apiRequest('/phpdts/api_v2.php?action=player_info');
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

// ══════════════════════════════════════════════════
// 地图 / Map (Canvas 立体剪纸风格六边形 + 玩家棋子)
// 融合 paperdemo.html 的剪纸美术风格
// ══════════════════════════════════════════════════

var HEX_R = 28;
var HEX_SIDE = 14;
var HEX_PAD = 24;
var HEX_SCALE = 0.88;
var HEX_COLS = 10;
var HEX_ROWS = 10;
var mapData = { curLoc: null, dangerSet: {}, areaMap: {} };

var AREA_TO_COORD = {};
(function() {
    for (var coord in COORD_TO_AREA) {
        AREA_TO_COORD[COORD_TO_AREA[coord]] = coord;
    }
})();

var playerState = {
    col: -1, row: -1,
    animating: false,
    fromCol: 0, fromRow: 0,
    toCol: 0, toRow: 0,
    animStart: 0,
    animDuration: 500,
    drawX: 0, drawY: 0,
    drawScale: 1,
    idleBounce: 0,
    breathePhase: 0
};

var hoveredHex = null;
var hoveredAreaId = null;
var hoveredAdjacent = false;
var animTime = 0;

// 剪纸风格配色 / Paper-cut color palette
var PAPER_COLORS = {
    bg: '#ede4d3',
    empty: '#e8dcc8',
    safe: '#c8e6c0',
    safeLight: '#ddf0d8',
    danger: '#ffcccc',
    dangerLight: '#ffe0e0',
    current: '#ffeaa7',
    currentLight: '#fff3c4',
    hoverReachable: '#b3c756',
    hoverReachableLight: '#c8da70',
    stroke: '#2d3436',
    shadow: 'rgba(65, 55, 45, 0.22)'
};

function hexCorner(cx, cy, i) {
    var angle = Math.PI / 180 * (60 * i - 30);
    return { x: cx + HEX_R * Math.cos(angle), y: cy + HEX_R * Math.sin(angle) };
}

function hexCenter(col, row) {
    return {
        x: col * HEX_R * 2 + HEX_R + (row % 2 === 0 ? 0 : HEX_R) + HEX_PAD,
        y: row * HEX_R * 1.5 + HEX_R + HEX_PAD
    };
}

function hexVertices(cx, cy) {
    var verts = [];
    for (var i = 0; i < 6; i++) {
        verts.push(hexCorner(cx, cy, i));
    }
    return verts;
}

function hexVerticesScaled(cx, cy, scale) {
    var verts = [];
    for (var i = 0; i < 6; i++) {
        var p = hexCorner(cx, cy, i);
        verts.push({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale });
    }
    return verts;
}

// 带 Live2D 呼吸变形的顶点计算 / Live2D breathe deformation
function hexVerticesBreathed(cx, cy, scale, breatheT) {
    var verts = [];
    var breatheScale = 1 + Math.sin(breatheT) * 0.015;
    var breatheRot = Math.sin(breatheT * 1.3) * 0.02;
    for (var i = 0; i < 6; i++) {
        var p = hexCorner(cx, cy, i);
        var dx = p.x - cx;
        var dy = p.y - cy;
        var rx = dx * Math.cos(breatheRot) - dy * Math.sin(breatheRot);
        var ry = dx * Math.sin(breatheRot) + dy * Math.cos(breatheRot);
        verts.push({
            x: cx + rx * scale * breatheScale,
            y: cy + ry * scale * breatheScale
        });
    }
    return verts;
}

function pointInHex(px, py, cx, cy) {
    var verts = hexVertices(cx, cy);
    var inside = false;
    for (var i = 0, j = 5; i < 6; j = i++) {
        var xi = verts[i].x, yi = verts[i].y;
        var xj = verts[j].x, yj = verts[j].y;
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function hexFromPixel(px, py) {
    for (var row = 0; row < HEX_ROWS; row++) {
        for (var col = 0; col < HEX_COLS; col++) {
            var c = hexCenter(col, row);
            if (pointInHex(px, py, c.x, c.y)) {
                return { col: col, row: row };
            }
        }
    }
    return null;
}

function areaIdToHexPos(areaId) {
    var coord = AREA_TO_COORD[areaId];
    if (!coord) return null;
    var parts = coord.split('-');
    var col = parts[0].charCodeAt(0) - 65;
    var displayRow = parseInt(parts[1]);
    var row = HEX_ROWS - displayRow;
    return { col: col, row: row };
}

// ══════════════════════════════════════════════════
// 剪纸风格阴影绘制 / Paper-cut shadow rendering
// ══════════════════════════════════════════════════

function drawPaperShadow(ctx, vertices, offsetX, offsetY, opacity) {
    ctx.save();
    ctx.fillStyle = 'rgba(65, 55, 45, ' + opacity + ')';
    ctx.beginPath();
    ctx.moveTo(vertices[0].x + offsetX, vertices[0].y + offsetY);
    for (var i = 1; i < 6; i++) {
        ctx.lineTo(vertices[i].x + offsetX, vertices[i].y + offsetY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// ══════════════════════════════════════════════════
// 主地图绘制 / Main map renderer
// ══════════════════════════════════════════════════

function drawHexMap() {
    var canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;

    var w = HEX_COLS * HEX_R * 2 + HEX_R + HEX_PAD * 2;
    var h = HEX_ROWS * HEX_R * 1.5 + HEX_R * 0.5 + HEX_SIDE + HEX_PAD * 2 + 10;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 牛皮纸质感背景 / Kraft paper background
    ctx.fillStyle = PAPER_COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // 点状纹理 / Dot texture
    ctx.fillStyle = 'rgba(219, 206, 180, 0.4)';
    for (var tx = 0; tx < w; tx += 24) {
        for (var ty = 0; ty < h; ty += 24) {
            ctx.beginPath();
            ctx.arc(tx + 12, ty + 12, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (var row = 0; row < HEX_ROWS; row++) {
        for (var col = 0; col < HEX_COLS; col++) {
            drawHexPaperCut(ctx, col, row);
        }
    }

    drawPlayerPaperCut(ctx);
    drawHoverEffects(ctx);
}

// ══════════════════════════════════════════════════
// 立体剪纸六边形绘制 / 3D paper-cut hex tile
// ══════════════════════════════════════════════════

function drawHexPaperCut(ctx, col, row) {
    var displayRow = HEX_ROWS - row;
    var coord = String.fromCharCode(65 + col) + '-' + displayRow;
    var areaId = mapData.areaMap[coord];
    var c = hexCenter(col, row);

    var isCurrent = areaId !== undefined && areaId === mapData.curLoc;
    var isDanger = areaId !== undefined && mapData.dangerSet[areaId];
    var isSafe = areaId !== undefined && !isCurrent && !isDanger;
    var isEmpty = areaId === undefined;

    var isHovered = hoveredHex && hoveredHex.col === col && hoveredHex.row === row;

    // 计算该格子的呼吸相位 / Per-tile breathe phase
    var tileBreathe = animTime * 0.03 + (col + row) * 0.5;
    var sv = hexVerticesBreathed(c.x, c.y, HEX_SCALE, tileBreathe);

    // 颜色选择
    var topColor = PAPER_COLORS.empty;
    var topColorLight = '#f0e8d8';
    var strokeColor = PAPER_COLORS.stroke;
    var sideColor1 = 'rgba(45,52,54,0.32)';
    var sideColor2 = 'rgba(45,52,54,0.22)';

    if (isCurrent) {
        topColor = PAPER_COLORS.current;
        topColorLight = PAPER_COLORS.currentLight;
        strokeColor = '#c9a030';
    } else if (isDanger) {
        topColor = PAPER_COLORS.danger;
        topColorLight = PAPER_COLORS.dangerLight;
        strokeColor = '#c06050';
        sideColor1 = 'rgba(192, 96, 80, 0.35)';
        sideColor2 = 'rgba(192, 96, 80, 0.25)';
    } else if (isSafe) {
        topColor = PAPER_COLORS.safe;
        topColorLight = PAPER_COLORS.safeLight;
        strokeColor = '#5a8a4a';
        sideColor1 = 'rgba(90, 138, 74, 0.3)';
        sideColor2 = 'rgba(90, 138, 74, 0.2)';
    }

    if (isHovered && hoveredAdjacent) {
        topColor = PAPER_COLORS.hoverReachable;
        topColorLight = PAPER_COLORS.hoverReachableLight;
        strokeColor = '#819430';
    } else if (isHovered && !hoveredAdjacent && !isEmpty && !isCurrent) {
        topColorLight = '#f5ecd8';
    }

    ctx.save();

    // 1. 绘制立体阴影层 / Drop shadow layer (paper-cut effect)
    if (!isEmpty) {
        drawPaperShadow(ctx, sv, 5, 10, 0.18);
    }

    // 2. 绘制3D侧面厚度 / 3D side thickness
    if (!isEmpty) {
        // 左下侧面
        ctx.fillStyle = sideColor1;
        ctx.beginPath();
        ctx.moveTo(sv[2].x, sv[2].y);
        ctx.lineTo(sv[3].x, sv[3].y);
        ctx.lineTo(sv[3].x + 3, sv[3].y + HEX_SIDE);
        ctx.lineTo(sv[2].x + 3, sv[2].y + HEX_SIDE);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = PAPER_COLORS.stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 右下侧面
        ctx.fillStyle = sideColor2;
        ctx.beginPath();
        ctx.moveTo(sv[3].x, sv[3].y);
        ctx.lineTo(sv[4].x, sv[4].y);
        ctx.lineTo(sv[4].x + 3, sv[4].y + HEX_SIDE);
        ctx.lineTo(sv[3].x + 3, sv[3].y + HEX_SIDE);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = PAPER_COLORS.stroke;
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    // 3. 绘制顶面 / Top surface with gradient
    if (!isEmpty) {
        var grad = ctx.createLinearGradient(c.x, sv[0].y, c.x, sv[3].y);
        grad.addColorStop(0, topColorLight);
        grad.addColorStop(0.4, topColor);
        grad.addColorStop(1, topColor);
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = topColor;
    }

    ctx.beginPath();
    ctx.moveTo(sv[0].x, sv[0].y);
    for (var i = 1; i < 6; i++) {
        ctx.lineTo(sv[i].x, sv[i].y);
    }
    ctx.closePath();
    ctx.fill();

    // 4. 粗黑边框 / Bold outline (paper-cut style)
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 5. 内部高光描边 / Inner highlight stroke
    if (!isEmpty) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(sv[0].x, sv[0].y);
        ctx.lineTo(sv[1].x, sv[1].y);
        ctx.lineTo(sv[2].x, sv[2].y);
        ctx.stroke();

        // 内部阴影描边
        ctx.strokeStyle = 'rgba(45,52,54,0.15)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sv[3].x, sv[3].y);
        ctx.lineTo(sv[4].x, sv[4].y);
        ctx.lineTo(sv[5].x, sv[5].y);
        ctx.stroke();
    }

    // 6. 内部虚线装饰框 / Dashed inner border (from paperdemo)
    if (!isEmpty) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.lineJoin = 'round';
        var innerScale = HEX_SCALE * 0.55;
        var inner = hexVerticesBreathed(c.x, c.y, innerScale, tileBreathe);
        ctx.beginPath();
        ctx.moveTo(inner[0].x, inner[0].y);
        for (var i = 1; i < 6; i++) {
            ctx.lineTo(inner[i].x, inner[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 7. 文字标签 / Text labels
    if (!isEmpty) {
        ctx.fillStyle = PAPER_COLORS.stroke;
        ctx.font = 'bold 10px "Comic Sans MS", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(areaId, c.x, c.y - 7);

        var name = getPlaceName(areaId);
        if (name.length > 3) name = name.substring(0, 3);
        ctx.font = 'bold 9px "Comic Sans MS", "Microsoft YaHei", sans-serif';
        ctx.fillText(name, c.x, c.y + 7);
    }

    // 8. 当前位置虚线边框 / Current location dashed border
    if (isCurrent) {
        ctx.strokeStyle = 'rgba(45,52,54,0.7)';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 5]);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(sv[0].x, sv[0].y);
        for (var i = 1; i < 6; i++) {
            ctx.lineTo(sv[i].x, sv[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // 当前位置小星星装饰
        ctx.fillStyle = '#ff7675';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('★', c.x + HEX_R * 0.6, c.y - HEX_R * 0.5);
    }

    ctx.restore();
}

// ══════════════════════════════════════════════════
// 剪纸风格玩家棋子 / Paper-cut style player token
// ══════════════════════════════════════════════════

function drawPlayerPaperCut(ctx) {
    if (playerState.col < 0 || playerState.row < 0) return;

    var px, py, scale;
    var walkBob = 0;
    var breatheT = animTime * 0.04;

    if (playerState.animating) {
        px = playerState.drawX;
        py = playerState.drawY;
        scale = playerState.drawScale;
        walkBob = Math.abs(Math.sin(playerState.animStart / 200)) * 3;
    } else {
        var c = hexCenter(playerState.col, playerState.row);
        px = c.x;
        py = c.y - playerState.idleBounce;
        scale = 1;
    }

    ctx.save();
    ctx.translate(px, py);

    // Live2D 呼吸变形 / Live2D breathe deformation
    var breatheScaleX = 1 + Math.sin(breatheT) * 0.03;
    var breatheScaleY = 1 + Math.cos(breatheT * 1.2) * 0.03;
    var breatheRot = Math.sin(breatheT * 0.8) * 0.03;
    ctx.scale(scale * breatheScaleX, scale * breatheScaleY);
    ctx.rotate(breatheRot);

    var s = HEX_R * 0.5;

    // 1. 剪纸阴影 / Paper shadow
    ctx.fillStyle = 'rgba(65, 55, 45, 0.2)';
    ctx.beginPath();
    ctx.ellipse(4, s * 0.95 + 4, s * 0.75, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. 身体（三角形剪纸披风）/ Body - triangular paper cloak
    ctx.fillStyle = '#ff7675';
    ctx.strokeStyle = PAPER_COLORS.stroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.1);
    ctx.lineTo(-s * 0.7, s * 0.85);
    ctx.lineTo(s * 0.7, s * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 披风内部白色弧线装饰
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.25, s * 0.1);
    ctx.quadraticCurveTo(0, -s * 0.15, s * 0.25, s * 0.1);
    ctx.stroke();

    // 3. 头部（圆形剪纸）/ Head - circular paper cut
    ctx.fillStyle = '#ffeaa7';
    ctx.strokeStyle = PAPER_COLORS.stroke;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, -s * 0.55, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. 腮红 / Blush marks
    ctx.fillStyle = '#ff8787';
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(-s * 0.22, -s * 0.45, s * 0.1, 0, Math.PI * 2);
    ctx.arc(s * 0.22, -s * 0.45, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 5. 眼睛 / Eyes
    ctx.fillStyle = PAPER_COLORS.stroke;
    ctx.beginPath();
    ctx.arc(-s * 0.12, -s * 0.62, s * 0.07, 0, Math.PI * 2);
    ctx.arc(s * 0.12, -s * 0.62, s * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // 6. 微笑 / Smile
    ctx.strokeStyle = PAPER_COLORS.stroke;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -s * 0.48, s * 0.18, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();

    // 7. 小背包 / Tiny backpack
    ctx.fillStyle = '#5a4030';
    ctx.strokeStyle = PAPER_COLORS.stroke;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.rect(-s * 0.3, s * 0.05, s * 0.22, s * 0.32);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
}

function drawHoverEffects(ctx) {
    if (!hoveredHex || !hoveredAdjacent) return;
    if (playerState.col < 0 || playerState.row < 0) return;

    var from = hexCenter(playerState.col, playerState.row);
    var to = hexCenter(hoveredHex.col, hoveredHex.row);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = 'rgba(100, 223, 223, 0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -animTime * 0.8;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function animLoop(timestamp) {
    if (!timestamp) timestamp = performance.now();
    animTime++;

    if (playerState.animating) {
        var elapsed = timestamp - playerState.animStart;
        var progress = Math.min(elapsed / playerState.animDuration, 1);
        var t = 1 - Math.pow(1 - progress, 3);

        var from = hexCenter(playerState.fromCol, playerState.fromRow);
        var to = hexCenter(playerState.toCol, playerState.toRow);

        playerState.drawX = from.x + (to.x - from.x) * t;
        playerState.drawY = from.y + (to.y - from.y) * t;
        playerState.drawY -= Math.sin(progress * Math.PI) * HEX_R * 1.2;
        playerState.drawScale = 1 + Math.sin(progress * Math.PI) * 0.25;

        if (progress >= 1) {
            playerState.animating = false;
            playerState.col = playerState.toCol;
            playerState.row = playerState.toRow;
            loadMap();
            loadPlayerInfo();
            loadItemFind();
            loadInventory();
            refreshLog();
        }
    } else {
        playerState.idleBounce = Math.sin(timestamp / 600) * 2;
    }

    drawHexMap();
    requestAnimationFrame(animLoop);
}

function startPlayerJump(fromCol, fromRow, toCol, toRow) {
    playerState.fromCol = fromCol;
    playerState.fromRow = fromRow;
    playerState.toCol = toCol;
    playerState.toRow = toRow;
    playerState.animStart = performance.now();
    playerState.animating = true;
}

async function loadMap() {
    var infoEl = document.getElementById('mapInfo');
    infoEl.innerHTML = '<div class="loading">加载中...</div>';

    var canvas = document.getElementById('mapCanvas');
    if (!canvas) return;

    var result = await apiRequest('/phpdts/api_v2.php?action=game_map');
    if (result.status !== 'success') {
        infoEl.innerHTML = '<div class="error">加载失败: ' + escapeHtml(result.message || '未知错误') + '</div>';
        return;
    }
    var d = result.data;
    mapData.curLoc = d.currentLocation !== undefined ? d.currentLocation : null;
    mapData.dangerSet = {};
    if (d.dangerAreas) {
        for (var i = 0; i < d.dangerAreas.length; i++) {
            mapData.dangerSet[d.dangerAreas[i]] = true;
        }
    }
    mapData.areaMap = COORD_TO_AREA;

    if (mapData.curLoc !== null && playerState.col < 0) {
        var pos = areaIdToHexPos(mapData.curLoc);
        if (pos) {
            playerState.col = pos.col;
            playerState.row = pos.row;
        }
    }

    infoEl.innerHTML = '位置: <span class="yellow">' + escapeHtml(mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : '未知') + '</span>' +
        ' | 禁区: ' + (d.dangerAreas && d.dangerAreas.length ? d.dangerAreas.map(function(v){return getPlaceName(v);}).join(', ') : '无');
}

function initMapCanvas() {
    var canvas = document.getElementById('mapCanvas');
    var tooltip = document.getElementById('hexTooltip');
    if (!canvas) return;

    canvas.addEventListener('mousemove', function(e) {
        var rect = canvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var px = (e.clientX - rect.left) * (canvas.width / rect.width) / dpr;
        var py = (e.clientY - rect.top) * (canvas.height / rect.height) / dpr;

        var hex = hexFromPixel(px, py);
        if (hex) {
            var displayRow = HEX_ROWS - hex.row;
            var coord = String.fromCharCode(65 + hex.col) + '-' + displayRow;
            var areaId = mapData.areaMap[coord];

            hoveredHex = hex;
            hoveredAreaId = areaId !== undefined ? areaId : null;
            hoveredAdjacent = false;

            if (playerState.col >= 0 && playerState.row >= 0 && !playerState.animating) {
                var dcol = Math.abs(hex.col - playerState.col);
                var drow = Math.abs(hex.row - playerState.row);
                if (dcol <= 1 && drow <= 1 && (dcol + drow > 0)) {
                    hoveredAdjacent = true;
                }
            }

            if (tooltip && hoveredAreaId !== null && hoveredAreaId !== undefined) {
                var name = getPlaceName(hoveredAreaId);
                tooltip.textContent = '[' + hoveredAreaId + '] ' + name;
                tooltip.style.display = 'block';
                var wrap = canvas.parentElement;
                var wrapRect = wrap.getBoundingClientRect();
                tooltip.style.left = (e.clientX - wrapRect.left) + 'px';
                tooltip.style.top = (e.clientY - wrapRect.top) + 'px';
            } else if (tooltip) {
                tooltip.style.display = 'none';
            }

            canvas.style.cursor = hoveredAdjacent ? 'pointer' : 'crosshair';
        } else {
            hoveredHex = null;
            hoveredAreaId = null;
            hoveredAdjacent = false;
            if (tooltip) { tooltip.style.display = 'none'; }
            canvas.style.cursor = 'crosshair';
        }
    });

    canvas.addEventListener('mouseleave', function() {
        hoveredHex = null;
        hoveredAreaId = null;
        hoveredAdjacent = false;
        if (tooltip) { tooltip.style.display = 'none'; }
        canvas.style.cursor = 'crosshair';
    });

    canvas.addEventListener('click', function(e) {
        if (playerState.animating) return;
        var rect = canvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var px = (e.clientX - rect.left) * (canvas.width / rect.width) / dpr;
        var py = (e.clientY - rect.top) * (canvas.height / rect.height) / dpr;

        var hex = hexFromPixel(px, py);
        if (hex) {
            var displayRow = HEX_ROWS - hex.row;
            var coord = String.fromCharCode(65 + hex.col) + '-' + displayRow;
            var areaId = mapData.areaMap[coord];
            if (areaId !== undefined) {
                clickMove(areaId);
            }
        }
    });

    requestAnimationFrame(animLoop);
}

initMapCanvas();

function clickMove(areaId) {
    if (areaId === undefined || areaId === null) return;
    if (playerState.animating) return;
    if (hasFoundItem) {
        alert('附近还有未处理的物品，请先拾取、使用或丢弃后再移动。');
        return;
    }
    submitCommand({ command:'move', moveto: parseInt(areaId) }).then(function(ok) {
        if (ok) {
            var toPos = areaIdToHexPos(areaId);
            if (toPos && playerState.col >= 0) {
                startPlayerJump(playerState.col, playerState.row, toPos.col, toPos.row);
            } else {
                loadMap();
                loadPlayerInfo();
                loadItemFind();
                loadInventory();
                refreshLog();
            }
        } else {
            alert('移动失败');
        }
    });
}

// ══════════════════════════════════════════════════
// 游戏日志 / Game log (右上角面板)
// ══════════════════════════════════════════════════

async function refreshLog() {
    var el = document.getElementById('logContent');
    var result = await apiRequest('/phpdts/api_v2.php?action=game_log');
    if (result.status === 'success') {
        el.innerHTML = result.data.log || '<span class="grey">暂无日志</span>';
        el.scrollTop = el.scrollHeight;
    }
}

// 每3秒自动刷新日志
setInterval(function () {
    refreshLog();
}, 3000);

// ══════════════════════════════════════════════════
// 玩家信息抽屉 / Player info drawer
// ══════════════════════════════════════════════════

var drawerOpen = false;

function toggleDrawer() {
    var drawer = document.getElementById('playerDrawer');
    var overlay = document.getElementById('drawerOverlay');
    var toggle = document.getElementById('drawerToggle');
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

function closeDrawer() {
    var drawer = document.getElementById('playerDrawer');
    var overlay = document.getElementById('drawerOverlay');
    var toggle = document.getElementById('drawerToggle');
    drawerOpen = false;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    toggle.classList.remove('shifted');
}

// ══════════════════════════════════════════════════
// 页面加载 / Page load
// ══════════════════════════════════════════════════

function loadAll() {
    loadMap();
    loadItemFind();
    loadExplorationMemory();
    loadInventory();
    refreshLog();
}

loadAll();