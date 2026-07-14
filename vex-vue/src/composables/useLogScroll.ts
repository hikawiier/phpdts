/**
 * @module M 组合式函数
 */

// ══════════════════════════════════════════════════
// 日志滚动 + 未读计数 composable / Log scroll & unread
//
// 替代现有 vex/js/log.js 的滚动监听 + 未读计数逻辑。
//
// 职责：
//   - isAtBottom ref（滚动容器是否在底部附近，< 50px）
//   - unreadCount ref（未读新日志计数，forceScroll=false 场景累加）
//   - scrollToBottom()：命令式滚动到底部 + 清零未读
//   - checkIsAtBottom()：判断当前是否在底部
//   - onScroll()：滚动事件处理（玩家手动滚动到底部时清零未读）
//   - bindScroll(scrollerEl)：绑定滚动事件监听
//
// 事件转发（来自 logStore.refreshLog）：
//   - LOG_EVENTS.FORCE_SCROLL → scrollToBottom()
//   - LOG_EVENTS.ADD_UNREAD   → 累加未读（仅在 !isAtBottom 时）
//
// 保留命令式滚动逻辑（scrollTop = scrollHeight），不依赖 Vue 响应式驱动滚动。
// ══════════════════════════════════════════════════

import { ref, onUnmounted } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { LOG_EVENTS } from '@/stores/log';

/** 底部判定阈值（px） */
const BOTTOM_THRESHOLD = 50;

/**
 * 日志滚动 + 未读计数 composable
 *
 * 使用方式：
 *   const { isAtBottom, unreadCount, scrollToBottom, bindScroll } = useLogScroll();
 *   bindScroll(scrollerRef.value);  // 在 onMounted 中绑定
 */
export function useLogScroll() {
  /** 滚动容器是否在底部附近（初始为 true，首次加载自动滚动） */
  const isAtBottom = ref<boolean>(true);

  /** 未读新日志计数（forceScroll=false 场景累加） */
  const unreadCount = ref<number>(0);

  /** 滚动容器元素引用（模块内闭包，避免响应式开销） */
  let _scroller: HTMLElement | null = null;

  /** 滚动事件处理函数引用（用于解绑） */
  let _scrollHandler: (() => void) | null = null;

  /** 强制滚动事件处理函数引用 */
  let _forceScrollHandler: (() => void) | null = null;

  /** 累加未读事件处理函数引用 */
  let _addUnreadHandler: ((data: unknown) => void) | null = null;

  // ── 判断是否在底部附近（< 50px） ──
  function checkIsAtBottom(): boolean {
    if (!_scroller) return true;
    return (
      _scroller.scrollHeight - _scroller.scrollTop - _scroller.clientHeight <
      BOTTOM_THRESHOLD
    );
  }

  // ── 滚动到底部并清零未读 ──
  function scrollToBottom(): void {
    if (_scroller) {
      _scroller.scrollTop = _scroller.scrollHeight;
    }
    unreadCount.value = 0;
    isAtBottom.value = true;
  }

  // ── 滚动事件监听 ──
  function onScroll(): void {
    const wasAtBottom = isAtBottom.value;
    isAtBottom.value = checkIsAtBottom();
    // 玩家手动滚动到底部时清零未读
    if (!wasAtBottom && isAtBottom.value) {
      unreadCount.value = 0;
    }
  }

  /**
   * 绑定滚动事件监听 + logStore 事件转发
   *
   * 应在 LogPanel.vue 的 onMounted 中调用，传入滚动容器元素。
   *
   * @param scrollerEl 滚动容器元素（#logContent 的父级）
   */
  function bindScroll(scrollerEl: HTMLElement | null): void {
    // 清理旧绑定
    unbindScroll();

    _scroller = scrollerEl;
    if (!_scroller) return;

    // 绑定滚动事件
    _scrollHandler = onScroll;
    _scroller.addEventListener('scroll', _scrollHandler, { passive: true });

    // 监听 logStore 的强制滚动事件
    _forceScrollHandler = () => {
      scrollToBottom();
    };
    dataManager.listen(LOG_EVENTS.FORCE_SCROLL, _forceScrollHandler);

    // 监听 logStore 的累加未读事件
    _addUnreadHandler = (data) => {
      // 仅在不在底部时累加未读（在底部时 logStore 已自动滚动）
      if (!isAtBottom.value) {
        const count = typeof data === 'number' ? data : 0;
        if (count > 0) {
          unreadCount.value += count;
        }
      } else if (_scroller) {
        // 在底部：自动滚动到新底部
        _scroller.scrollTop = _scroller.scrollHeight;
      }
    };
    dataManager.listen(LOG_EVENTS.ADD_UNREAD, _addUnreadHandler);
  }

  /** 解绑所有事件监听 */
  function unbindScroll(): void {
    if (_scroller && _scrollHandler) {
      _scroller.removeEventListener('scroll', _scrollHandler);
    }
    _scroller = null;
    _scrollHandler = null;

    if (_forceScrollHandler) {
      dataManager.unlisten(LOG_EVENTS.FORCE_SCROLL, _forceScrollHandler);
      _forceScrollHandler = null;
    }
    if (_addUnreadHandler) {
      dataManager.unlisten(LOG_EVENTS.ADD_UNREAD, _addUnreadHandler);
      _addUnreadHandler = null;
    }
  }

  // 组件卸载时自动清理
  onUnmounted(() => {
    unbindScroll();
  });

  return {
    isAtBottom,
    unreadCount,
    scrollToBottom,
    checkIsAtBottom,
    onScroll,
    bindScroll,
    unbindScroll,
  };
}
