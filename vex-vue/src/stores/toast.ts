/**
 * @module K 状态管理层
 * @framework K-8 日志增量获取 + 智能 Toast 分发
 */

// ══════════════════════════════════════════════════
// Toast store
//
// 替代现有 vex/js/toast.js 的 showToast + 同类合并逻辑。
//
// 职责：
//   - toasts 状态（数组）
//   - showToast(msg, type, duration, isHtml, mergeId)
//   - removeToast(id)
//   - 同类合并：相邻同 mergeId + 同 type 的 Toast 合并显示 ×N
//
// 事件监听：
//   - ui:toast → showToast（桥接 dataManager 广播）
//
// M4 阶段：ToastContainer.vue 简单 v-for 渲染（M5 完善位置/动画）。
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dataManager } from '@/stores/data-manager';
import type { ToastEventData } from '@/types/events';
import { debugBus } from '@/composables/useDebugBus';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  isHtml: boolean;
  mergeId?: string;
  count: number;
  timerId: number | null;
}

let _nextId = 1;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<ToastItem[]>([]);

  /**
   * 显示 Toast 提示
   *
   * 迁移自现有 vex/js/toast.js showToast()：
   *   - 同类合并：相邻同 mergeId + 同 type 的 Toast 合并显示 ×N
   *   - 自动消失（duration 毫秒后）
   *
   * @param message 消息内容
   * @param type 类型：'info' | 'error' | 'success' | 'warning'
   * @param duration 显示时长（毫秒，默认 2000）
   * @param isHtml true 时 message 视为已转义的 HTML
   * @param mergeId 同类合并标识
   */
  function showToast(
    message: string,
    type: ToastType = 'info',
    duration: number = 2000,
    isHtml: boolean = false,
    mergeId?: string,
  ): void {
    // ── 同类合并：相邻同 mergeId + 同 type 的 Toast 合并显示 ×N ──
    if (mergeId) {
      const last = toasts.value[toasts.value.length - 1];
      if (last && last.mergeId === mergeId && last.type === type) {
        last.count++;
        debugBus.emit('ui', 'ui.toast.merge', {
          id: last.id,
          type,
          duration,
          mergeId,
          count: last.count,
          message: message.slice(0, 160),
        });
        // 重置消失计时器
        if (last.timerId !== null) {
          clearTimeout(last.timerId);
        }
        last.timerId = setTimeout(() => {
          removeToast(last.id);
        }, duration);
        return;
      }
    }

    // ── 正常创建新 Toast ──
    const id = _nextId++;
    const timerId = setTimeout(() => {
      removeToast(id);
    }, duration);

    toasts.value.push({
      id,
      message,
      type,
      isHtml,
      mergeId,
      count: 1,
      timerId,
    });
    debugBus.emit('ui', 'ui.toast.show', {
      id,
      type,
      duration,
      mergeId: mergeId ?? null,
      count: 1,
      message: message.slice(0, 160),
    });
  }

  /** 移除 Toast */
  function removeToast(id: number): void {
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx >= 0) {
      const toast = toasts.value[idx];
      if (toast.timerId !== null) {
        clearTimeout(toast.timerId);
      }
      toasts.value.splice(idx, 1);
      debugBus.emit('ui', 'ui.toast.remove', {
        id: toast.id,
        type: toast.type,
        mergeId: toast.mergeId ?? null,
        count: toast.count,
        message: toast.message.slice(0, 160),
      });
    }
  }

  // ═══ 事件监听：桥接 dataManager 的 ui:toast 事件 ═══

  let _listenersRegistered = false;

  /** 注册 dataManager 事件监听（只注册一次） */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    dataManager.listen('ui:toast', (data) => {
      const d = data as ToastEventData | undefined;
      if (d && d.msg) {
        showToast(
          d.msg,
          (d.type as ToastType) || 'info',
          typeof d.duration === 'number' ? d.duration : 2000,
          !!d.isHtml,
          typeof d.mergeId === 'string' ? d.mergeId : undefined,
        );
      }
    });
  }

  return {
    // 状态
    toasts,
    // actions
    showToast,
    removeToast,
    registerListeners,
  };
});
