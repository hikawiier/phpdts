// ══════════════════════════════════════════════════
// 游戏日志 / Chronicle log (Oblivions 结构化日志)
//
// 事件驱动刷新，从 obl_log API 拉取结构化日志条目，
// 委托 log-templates.js 渲染为 HTML。
//
// 增量检测：通过 ts 对比识别新增条目，在 2 级页面（模态框/抽屉）
// 打开时触发 Toast 即时反馈，避免遮罩遮挡日志区导致操作结果不可见。
// ══════════════════════════════════════════════════

import { DebugBus } from './data.js';
import { gameApi } from './utils.js';
import { dataManager } from './data-manager.js';
import { renderLogEntry } from '../data/log-templates.js';
import { showToast } from './tile-action.js';
import { isAnyOverlayOpen } from './toast-position.js';

// 动作标记 → 前端显示标签
const ACTION_TAGS = {
    move:    'MOV',
    explore: 'EXP',
    search:  'SRC',
    pickup:  'PKG',
    discard: 'DSC',
    system:  'SYS',
};

// Toast 白名单：仅这些日志 ID 触发即时反馈（2 级页面打开时）
// move.* 不加入（地图变化已足够明显）
// ID 与结构化日志系统实际实现的 ID 对齐
const TOAST_RULES = {
    'pickup.bag_full':         { style: 'error' },
    'pickup.success':          { style: 'success' },
    'pickup.not_found':        { style: 'error' },
    'search.result':           { style: 'success' },
    'search.already_searched': { style: 'error' },
    'discard.success':         { style: 'success' },
};

let lastTs = 0;  // 增量检测：记录上次拉取的最大 ts

/**
 * 刷新日志：从 obl_log API 拉取结构化日志并渲染
 *
 * @param {boolean} forceScroll 是否强制滚动到底部
 *   - true（默认）：操作触发刷新，用户要看操作结果，强制滚到底部
 *   - false：被动刷新（如定时同步），仅在用户已接近底部时滚动，不打断翻看历史
 */
export async function refreshLog(forceScroll = true) {
    const el = document.getElementById('logContent');
    if (!el) return;

    const result = await gameApi('obl_log');
    if (result.status !== 'success') return;

    const entries = result.data.entries || [];

    // ── 增量检测 ──
    const newEntries = entries.filter(e => e.ts > lastTs);

    // ── Toast 触发（仅在 2 级页面打开时，避免遮罩遮挡日志区） ──
    if (isAnyOverlayOpen() && newEntries.length > 0) {
        for (let i = 0; i < newEntries.length; i++) {
            const entry = newEntries[i];
            const rule = TOAST_RULES[entry.id];
            if (rule) {
                const content = renderLogEntry(entry);
                // content 是 HTML（含高亮 span），showToast 第 4 参数 isHtml=true 直接渲染
                if (content) showToast(content, rule.style, 2000, true);
            }
        }
    }

    // ── 更新 lastTs（首次加载 lastTs=0，会把全部 entries 的最大 ts 记下，后续仅新增触发） ──
    lastTs = entries.length ? entries[entries.length - 1].ts : lastTs;

    // ── 渲染日志区 ──
    if (entries.length === 0) {
        el.innerHTML = '<span class="grey">[SYS] 暂无日志</span>';
        return;
    }

    // 渲染所有条目，过滤空内容（如 move.tile_desc 无 desc 时返回空字符串）
    const htmlParts = entries.map(entry => {
        const tag = ACTION_TAGS[entry.action] || 'SYS';
        const content = renderLogEntry(entry);
        if (!content) return '';
        return `<span class="log-tag">[${tag}]</span>${content}`;
    }).filter(p => p);

    el.innerHTML = htmlParts.join('<br>');

    // ── 滚动逻辑：滚动容器是 #logContent 的父级 div（overflow-y-auto） ──
    const scroller = el.parentElement;
    if (forceScroll) {
        // 操作触发：强制滚到底部，确保用户看到最新操作结果
        scroller.scrollTop = scroller.scrollHeight;
    } else {
        // 被动刷新：仅在用户已接近底部时滚动，不打断翻看历史
        const isNearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50;
        if (isNearBottom) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    }

    DebugBus.emit('log', 'refreshLog:done', { count: entries.length });
}

// ─── 事件驱动刷新（替代 setInterval 轮询） ───
// 操作完成 / 地图加载后刷新日志（强制滚动，用户要看操作结果）
dataManager.listen('game:action-completed', function() { refreshLog(); });
dataManager.listen('map:loaded', function() { refreshLog(); });
