// ══════════════════════════════════════════════════
// 工具函数 / Utility functions
// ══════════════════════════════════════════════════

import { BASE_URL, GENDER_NAMES, RACE_NAMES, CLUB_NAMES, mapData } from './data.js';

export function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

export function getPlaceName(pls) {
    if (mapData && mapData.links && mapData.curRegion) {
        const tiles = mapData.links.tiles[mapData.curRegion];
        if (tiles && tiles[pls]) return tiles[pls].name;
    }
    return '位置' + pls;
}

export function getGenderText(g)   { return GENDER_NAMES[g] || '未知'; }
export function getRaceText(r)     { return RACE_NAMES[r] || '未知'; }
export function getClubText(c)     { return CLUB_NAMES[c] || ('社团' + c); }

// ══════════════════════════════════════════════════
// API请求 / API request (只读)
// ══════════════════════════════════════════════════

export async function apiRequest(url, method, data) {
    method = method || 'GET';
    data = data || null;
    try {
        const options = { method: method, credentials: 'include' };
        if (data) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(data);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            console.error('HTTP ' + response.status);
            return { status:'error', code:'HTTP_ERROR', message:'服务器错误(' + response.status + ')' };
        }
        const ct = response.headers.get('content-type');
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
export function gameApi(action) {
    return apiRequest(BASE_URL + '/api_v2.php?action=' + action);
}

// ══════════════════════════════════════════════════
// 表单提交到后端 / Form submission (走 command.php / chat.php)
// ══════════════════════════════════════════════════

export async function submitCommand(params) {
    const body = new URLSearchParams();
    if (!params.mode) { params.mode = 'command'; }
    for (const k in params) { body.append(k, params[k]); }
    try {
        const resp = await fetch(BASE_URL + '/command.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!resp.ok) {
            return { success: false, error: 'HTTP_ERROR', status: resp.status };
        }

        // 尝试解析 JSON 响应
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const gamedata = await resp.json();
            return {
                success: true,
                gamedata: gamedata,
                redirect: gamedata.redirect || null,
                timer: gamedata.timer || null,
                error: gamedata.error || null
            };
        }

        return { success: true };
    } catch (e) {
        console.error('提交失败:', e);
        return { success: false, error: 'NETWORK_ERROR', message: e.message };
    }
}
