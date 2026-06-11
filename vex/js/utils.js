// ══════════════════════════════════════════════════
// 工具函数 / Utility functions
// ══════════════════════════════════════════════════

function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function getPlaceName(pls) {
    if (mapData && mapData.links && mapData.curRegion) {
        var tiles = mapData.links.tiles[mapData.curRegion];
        if (tiles && tiles[pls]) return tiles[pls].name;
    }
    return PLACE_NAMES[pls] || ('位置' + pls);
}

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

// VEX 前端 API 包装 / VEX frontend API wrapper
// 直连 api_v2.php，不经过 game.php 代理
function gameApi(action) {
    return apiRequest(BASE_URL + '/api_v2.php?action=' + action);
}

// ══════════════════════════════════════════════════
// 表单提交到后端 / Form submission (走 command.php / chat.php)
// ══════════════════════════════════════════════════

async function submitCommand(params) {
    var body = new URLSearchParams();
    if (!params.mode) { params.mode = 'command'; }
    for (var k in params) { body.append(k, params[k]); }
    try {
        var resp = await fetch(BASE_URL + '/command.php', {
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
// 调试日志上传 / Debug log upload (委托 Debug 模块)
// ══════════════════════════════════════════════════

async function flushDebugLog() {
    await Debug.flush();
}
