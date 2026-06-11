// ══════════════════════════════════════════════════
// 玩家信息 / Player info (render in drawer)
// ══════════════════════════════════════════════════

async function loadPlayerInfo() {
    var el = document.getElementById('playerInfo');
    el.innerHTML = '<div class="loading">loading...</div>';
    Debug.add(Debug.CATEGORIES.API, 'loadPlayerInfo:start', { action: 'player_info' });
    var result = await gameApi('player_info');
    Debug.add(Debug.CATEGORIES.PLAYER, 'loadPlayerInfo:response', result.data);
    if (result.status !== 'success') { el.innerHTML = '<div class="error">load failed: ' + escapeHtml(result.message) + '</div>'; return; }
    var d = result.data;
    var expP = ((d.exp||0)/(d.upexp||1))*100;
    el.innerHTML =
        '<div class="card"><h3>Basic Info</h3>' +
        '<p>name: ' + escapeHtml(d.name) + '</p>' +
        '<p>gender: ' + escapeHtml(getGenderText(d.gd)) + ' | race: ' + escapeHtml(getRaceText(d.race)) + '</p>' +
        '<p>no: ' + escapeHtml(d.sNo) + ' | club: ' + escapeHtml(getClubText(d.club)) + '</p>' +
        '<p>nick: ' + escapeHtml(d.nick) + '</p>' +
        '</div>' +
        '<div class="card"><h3>Level Info</h3>' +
        '<p>level: ' + (d.lvl||0) + ' | exp: ' + (d.exp||0) + '/' + (d.upexp||100) + '</p>' +
        '<div class="stat-bar"><div class="stat-fill exp" style="width:' + expP + '%"></div></div>' +
        '</div>' +
        '<div class="card"><h3>Combat Data</h3>' +
        '<p>HP: ' + (d.hp||0) + '/' + (d.mhp||0) + ' | SP: ' + (d.sp||0) + '/' + (d.msp||0) + '</p>' +
        '<p>ATK: ' + (d.att||0) + ' | DEF: ' + (d.def||0) + ' | SS: ' + (d.ss||0) + '/' + (d.mss||0) + '</p>' +
        '<p>kills: ' + (d.killnum||0) + ' | money: ' + (d.money||0) + ' | rp: ' + (d.rp||0) + '</p>' +
        '<p>rage: ' + escapeHtml(RAGE_STATUS[d.rage]||d.rage) + '</p>' +
        '<p>pos: ' + escapeHtml(getPlaceName(d.pls)) + ' [' + d.pls + ']</p>' +
        '<p>pose: ' + escapeHtml(POSE_NAMES[d.pose]||d.pose) + ' | tac: ' + escapeHtml(TACTIC_NAMES[d.tactic]||d.tactic) + '</p>' +
        '</div>' +
        '<div class="card"><h3>Weapon Proficiency</h3>' +
        '<p>wp: '+(d.wp||0)+' | wk: '+(d.wk||0)+' | wg: '+(d.wg||0)+' | wc: '+(d.wc||0)+' | wd: '+(d.wd||0)+' | wf: '+(d.wf||0)+'</p>' +
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
        loadPlayerInfo().then(function() {
            if (typeof Debug !== 'undefined' && Debug.isEnabled()) {
                Debug.renderAiDump();
            }
        });
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