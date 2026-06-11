// ══════════════════════════════════════════════════
// 玩家信息 / Player info (渲染到抽屉内)
// ══════════════════════════════════════════════════

async function loadPlayerInfo() {
    var el = document.getElementById('playerInfo');
    el.innerHTML = '<div class="loading">加载中...</div>';
    Debug.add(Debug.CATEGORIES.API, 'loadPlayerInfo:start', { action: 'player_info' });
    var result = await gameApi('player_info');
    Debug.add(Debug.CATEGORIES.PLAYER, 'loadPlayerInfo:response', result.data);
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
