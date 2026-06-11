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
    return PLACE_NAMES[pls] || ('position' + pls);
}

function getWeatherText(w)  { return WEATHER_NAMES[w] || 'unknown'; }
function getStateText(s)    { return GAME_STATE_NAMES[s] || 'unknown'; }
function getGenderText(g)   { return GENDER_NAMES[g] || 'unknown'; }
function getRaceText(r)     { return RACE_NAMES[r] || 'unknown'; }
function getClubText(c)     { return CLUB_NAMES[c] || ('club' + c); }

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
            return { status:'error', code:'HTTP_ERROR', message:'server error(' + response.status + ')' };
        }
        var ct = response.headers.get('content-type');
        if (!ct || ct.indexOf('application/json') === -1) {
            console.error('non-JSON response');
            return { status:'error', code:'INVALID_RESPONSE', message:'server returned non-JSON' };
        }
        return await response.json();
    } catch (e) {
        console.error('API failed:', e);
        return { status:'error', code:'NETWORK_ERROR', message:'network error' };
    }
}

// VEX 前端 API 包装 / VEX frontend API wrapper
// 直连 api_v2.php，不经过 game.php 代理
// 自动记录所有调用到 Debug 模块（启用时）
function gameApi(action) {
    var url = BASE_URL + '/api_v2.php?action=' + action;
    var t0 = Date.now();
    return apiRequest(url).then(function(result) {
        var elapsed = Date.now() - t0;
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) {
            Debug.addApiCall(url, action, result.status, elapsed, {
                code: result.code || '',
                message: result.message || ''
            });
            Debug.add(Debug.CATEGORIES.API, action, {
                elapsed_ms: elapsed,
                status: result.status,
                code: result.code || '',
                message: result.message || '',
                data: result.data
            });
        }
        return result;
    });
}

// ══════════════════════════════════════════════════
// 表单提交到后端 / Form submission (走 command.php / chat.php)
// ══════════════════════════════════════════════════

async function submitCommand(params) {
    var body = new URLSearchParams();
    if (!params.mode) { params.mode = 'command'; }
    for (var k in params) { body.append(k, params[k]); }
    var t0 = Date.now();
    try {
        var resp = await fetch(BASE_URL + '/command.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });
        var elapsed = Date.now() - t0;
        var ok = resp.ok;
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) {
            Debug.addAction(params.command || 'unknown', params, ok, elapsed);
        }
        return ok;
    } catch (e) {
        var elapsed = Date.now() - t0;
        if (typeof Debug !== 'undefined' && Debug.isEnabled()) {
            Debug.addAction(params.command || 'unknown', params, false, elapsed);
        }
        console.error('submit failed:', e);
        return false;
    }
}

// ══════════════════════════════════════════════════
// 调试日志上传 / Debug log upload (委托 Debug 模块)
// ══════════════════════════════════════════════════

async function flushDebugLog() {
    await Debug.flush();
}
