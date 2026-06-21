// ══════════════════════════════════════════════════
// Toast 通用提示组件 / Toast notification
//
// 从 tile-action.js 抽取，供 tile-action.js / log.js 等模块共用。
// 支持同类合并（mergeId）：相邻同 mergeId + 同 type 的 Toast 合并显示 ×N，
// 避免批量操作（如"全部拾取"触发 6 条 pickup.bag_full）刷屏。
// ══════════════════════════════════════════════════

import { escapeHtml } from './utils.js';

/**
 * 显示 Toast 提示
 * @param {string} message - 消息内容
 * @param {string} type - 类型：'info' | 'error' | 'success'
 * @param {number} duration - 显示时长（毫秒）
 * @param {boolean} isHtml - true 时 message 视为已转义的 HTML（如 renderLogEntry 输出，含高亮 span）；
 *                           默认 false 转义纯文本
 * @param {string} mergeId - 同类合并标识，相同 mergeId + type 的相邻 Toast 合并显示 ×N
 */
export function showToast(message, type, duration, isHtml, mergeId) {
    type = type || 'info';
    duration = duration || 2000;
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const tag = type === 'error' ? '[ERR]' : (type === 'success' ? '[OK]' : '[i]');

    // ── 同类合并：相邻同 mergeId + 同 type 的 Toast 合并显示 ×N ──
    if (mergeId) {
        const last = container.lastElementChild;
        if (last && last.dataset.mergeId === mergeId && last.dataset.toastType === type) {
            // 合并：更新计数
            const count = parseInt(last.dataset.mergeCount || '1') + 1;
            last.dataset.mergeCount = count;

            // 更新计数显示
            let countEl = last.querySelector('.toast-count');
            if (!countEl) {
                countEl = document.createElement('span');
                countEl.className = 'toast-count';
                last.appendChild(countEl);
            }
            countEl.textContent = ' ×' + count;

            // 重置消失计时器
            const timerId = parseInt(last.dataset.timerId);
            if (timerId) clearTimeout(timerId);
            const newTimerId = setTimeout(function() {
                last.classList.remove('show');
                setTimeout(function() { last.remove(); }, 300);
            }, duration);
            last.dataset.timerId = newTimerId;
            return;
        }
    }

    // ── 正常创建新 Toast ──
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    if (mergeId) {
        toast.dataset.mergeId = mergeId;
        toast.dataset.mergeCount = '1';
        toast.dataset.toastType = type;
    }
    const safeMessage = isHtml ? message : escapeHtml(message);
    toast.innerHTML = '<span class="toast-tag">' + tag + '</span>' + safeMessage;
    container.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('show'); });
    const timerId = setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
    }, duration);
    toast.dataset.timerId = timerId;
}
