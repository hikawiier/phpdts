// ══════════════════════════════════════════════════
// 游戏日志 / Chronicle log (Oblivions 结构化日志)
//
// 事件驱动刷新，从 obl_log API 拉取结构化日志条目，
// 委托 log-templates.js 渲染为 HTML。
//
// 增量检测：通过 ts 对比识别新增条目，在 2 级页面（模态框/抽屉）
// 打开时触发 Toast 即时反馈，避免遮罩遮挡日志区导致操作结果不可见。
//
// 新日志高亮：渲染时对 ts > prevLastTs 的条目加 log-new 类，
// CSS 动画 1.5s 背景闪烁淡出，方便玩家定位新增日志。
//
// 未读提示：forceScroll=false 场景下尊重玩家滚动位置，
// 不在底部时不强制滚动，改为显示"↓ N 条新日志"浮层按钮。
// ══════════════════════════════════════════════════

import { DebugBus } from './data.js';
import { gameApi } from './utils.js';
import { dataManager } from './data-manager.js';
import { renderLogEntry } from '../data/log-templates.js';
import { showToast } from './tile-action.js';
import { isAnyOverlayOpen } from './toast-position.js';

// 日志类别 → 前端显示标签
const LOGCATEGORY_TAGS = {
    move:    'MOV',
    explore: 'EXP',
    search:  'SRC',
    pickup:  'PKG',
    discard: 'DSC',
    enemy:   'EMY',
    battle:  'BTL',
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

// debug 日志开关：?debug=ai 启用时显示 debug 日志（默认隐藏）
const isDebugLogMode = new URLSearchParams(window.location.search).get('debug') === 'ai';

let lastTs = 0;        // 增量检测：记录上次拉取的最大 ts
let unreadCount = 0;   // 未读新日志计数（forceScroll=false 场景累加）
let isAtBottom = true; // 滚动容器是否在底部附近（初始为 true，首次加载自动滚动）

// ── 滚动容器引用 ──
function getScroller() {
    const el = document.getElementById('logContent');
    return el ? el.parentElement : null;
}

// ── 判断是否在底部附近（< 50px） ──
function checkIsAtBottom() {
    const scroller = getScroller();
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50;
}

// ── 更新未读计数和提示按钮显示 ──
function updateUnreadButton() {
    const btn = document.getElementById('logUnreadBtn');
    const countEl = document.getElementById('logUnreadCount');
    if (!btn || !countEl) return;

    if (unreadCount > 0) {
        countEl.textContent = unreadCount;
        btn.style.display = '';
    } else {
        btn.style.display = 'none';
    }
}

// ── 滚动到底部并清零未读 ──
function scrollToBottom() {
    const scroller = getScroller();
    if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
    }
    unreadCount = 0;
    isAtBottom = true;
    updateUnreadButton();
}

// ── 滚动事件监听 ──
function bindScrollListener() {
    const scroller = getScroller();
    if (!scroller) return;
    scroller.addEventListener('scroll', function() {
        const wasAtBottom = isAtBottom;
        isAtBottom = checkIsAtBottom();
        // 玩家手动滚动到底部时清零未读
        if (!wasAtBottom && isAtBottom) {
            unreadCount = 0;
            updateUnreadButton();
        }
    });
}

// ── 提示按钮点击处理 ──
function bindUnreadButton() {
    const btn = document.getElementById('logUnreadBtn');
    if (btn) {
        btn.addEventListener('click', scrollToBottom);
    }
}

/**
 * 初始化日志模块：绑定滚动监听和提示按钮点击
 * 应在 app.js 的 loadAll() 中调用
 */
export function initLog() {
    bindScrollListener();
    bindUnreadButton();
}

/**
 * 刷新日志：从 obl_log API 拉取结构化日志并渲染
 *
 * @param {boolean} forceScroll 是否强制滚动到底部
 *   - true（默认）：玩家主动操作触发，需要立刻看到反馈，强制滚到底部 + 清零未读
 *   - false：被动刷新（如 map:loaded），尊重玩家滚动位置：
 *           在底部则滚动；不在底部则累加未读 + 显示提示按钮
 */
export async function refreshLog(forceScroll = true) {
    const el = document.getElementById('logContent');
    if (!el) return;

    const result = await gameApi('obl_log');
    if (result.status !== 'success') return;

    const entries = result.data.entries || [];

    // ── 增量检测 ──
    // prevLastTs 用于 Toast 增量触发（2 级页面打开时按白名单弹 Toast）
    // debug 日志不触发 Toast、不计入未读（即使 debug 模式开启）
    const prevLastTs = lastTs;
    const newEntries = entries.filter(e => e.ts > prevLastTs && !e.debug);

    // ── Toast 触发（仅在 2 级页面打开时，避免遮罩遮挡日志区） ──
    if (isAnyOverlayOpen() && newEntries.length > 0) {
        for (let i = 0; i < newEntries.length; i++) {
            const entry = newEntries[i];
            const rule = TOAST_RULES[entry.id];
            if (rule) {
                const content = renderLogEntry(entry);
                // content 是 HTML（含高亮 span），showToast 第 4 参数 isHtml=true 直接渲染
                // 第 5 参数 mergeId=entry.id 启用同类合并（避免批量操作刷屏）
                if (content) showToast(content, rule.style, 2000, true, entry.id);
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
    // 每条日志包裹在 <span class="log-entry"> 中（CSS 设为 display:block，每条独占一行）
    // 最后一条加 log-new 类，触发 1.5s 高亮动画，作为"最新操作结果"的视觉提示
    // debug 日志：非 debug 模式下跳过；debug 模式下加 [DBG] 前缀 + log-debug 暗化样式
    const lastIdx = entries.length - 1;
    const htmlParts = entries.map((entry, idx) => {
        // debug 日志过滤：非 debug 模式下跳过
        if (entry.debug && !isDebugLogMode) return '';
        const tag = LOGCATEGORY_TAGS[entry.logcategory] || 'SYS';
        const content = renderLogEntry(entry);
        if (!content) return '';
        const isNew = idx === lastIdx;
        const newClass = isNew ? ' log-new' : '';
        const debugClass = entry.debug ? ' log-debug' : '';
        const debugPrefix = entry.debug ? '<span class="log-tag-dbg">[DBG]</span>' : '';
        return `<span class="log-entry${newClass}${debugClass}">${debugPrefix}<span class="log-tag">[${tag}]</span>${content}</span>`;
    }).filter(p => p);

    el.innerHTML = htmlParts.join('');

    // ── 滚动逻辑 ──
    const scroller = getScroller();
    if (!scroller) return;

    if (forceScroll) {
        // 玩家主动操作：始终强制滚动到底部 + 清零未读
        scrollToBottom();
    } else {
        // 被动刷新：尊重玩家滚动位置
        if (isAtBottom) {
            // 在底部：自动滚动
            scroller.scrollTop = scroller.scrollHeight;
        } else if (newEntries.length > 0) {
            // 不在底部：累加未读 + 显示提示按钮
            unreadCount += newEntries.length;
            updateUnreadButton();
        }
    }

    DebugBus.emit('log', 'refreshLog:done', { count: entries.length, newCount: newEntries.length });
}

// ─── 事件驱动刷新（替代 setInterval 轮询） ───
// 玩家主动操作完成：强制滚动，用户要看操作结果
dataManager.listen('game:action-completed', function() { refreshLog(); });
// 地图加载（含首次加载 + 操作后 loadMap 触发）：
// 改为 forceScroll=false，避免与 game:action-completed 重复强制滚动
// 首次加载时 isAtBottom=true，仍会自动滚动到底部
dataManager.listen('map:loaded', function() { refreshLog(false); });
