// ══════════════════════════════════════════════════
// 游戏日志 store / Chronicle log
//
// 替代现有 vex/js/log.js 的 refreshLog + 增量检测 + Toast 触发逻辑。
//
// 职责：
//   - entries 状态（LogEntry[]）
//   - lastTs 增量检测（记录上次拉取的最大 ts）
//   - refreshLog(forceScroll) action：
//       * dataManager.fetch('obl_log', true) 拉取日志
//       * 增量检测：newEntries = entries.filter(e => e.ts > prevLastTs && !e.debug)
//       * Toast 触发：isAnyOverlayOpen() && newEntries.length > 0 时按 TOAST_RULES 白名单弹 Toast
//       * 更新 lastTs
//   - registerListeners()：监听 game:action-completed / map:loaded
//
// 事件驱动刷新：
//   - game:action-completed → refreshLog(true)  （强制滚动）
//   - map:loaded            → refreshLog(false) （尊重滚动位置）
//
// 滚动逻辑 / 未读计数由 useLogScroll composable 处理（不在 store 内做 DOM 操作）。
// Toast 触发通过 toastStore.showToast 直接调用（HTML 内容，mergeId=entry.id）。
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { useToastStore } from '@/stores/toast';
import { isAnyOverlayOpen } from '@/composables/useToastPosition';
import { renderLogEntry } from '@/data/log-templates';
import { debugBus } from '@/composables/useDebugBus';
import { commandQueue } from '@/stores/command-queue';
import type { LogEntry } from '@/types/api';
import type { ApiResponse } from '@/api/client';

/** 日志类别 → 前端显示标签 */
export const LOGCATEGORY_TAGS: Record<string, string> = {
  move: 'MOV',
  explore: 'EXP',
  search: 'SRC',
  pickup: 'PKG',
  discard: 'DSC',
  enemy: 'EMY',
  battle: 'BTL',
  system: 'SYS',
};

/** Toast 样式类型 */
type ToastStyle = 'info' | 'success' | 'error' | 'warning';

/**
 * Toast 白名单：仅这些日志 ID 触发即时反馈（2 级页面打开时）
 * move.* 不加入（地图变化已足够明显）
 * ID 与结构化日志系统实际实现的 ID 对齐
 */
export const TOAST_RULES: Record<string, { style: ToastStyle }> = {
  'pickup.bag_full': { style: 'error' },
  'pickup.success': { style: 'success' },
  'pickup.not_found': { style: 'error' },
  'search.result': { style: 'success' },
  'search.already_searched': { style: 'error' },
  'discard.success': { style: 'success' },
};

/** 强制滚动事件名（由 useLogScroll 监听） */
const LOG_FORCE_SCROLL_EVENT = 'log:force-scroll';
/** 累加未读事件名（由 useLogScroll 监听） */
const LOG_ADD_UNREAD_EVENT = 'log:add-unread';

export const useLogStore = defineStore('log', () => {
  /** 日志条目（按时间顺序，最新在末尾） */
  const entries = ref<LogEntry[]>([]);

  /** 增量检测：记录上次拉取的最大 ts */
  const lastTs = ref<number>(0);

  /** 是否正在加载 */
  const loading = ref<boolean>(false);

  /**
   * 刷新日志：从 obl_log API 拉取结构化日志
   *
   * @param forceScroll 是否强制滚动到底部
   *   - true（默认）：玩家主动操作触发，需要立刻看到反馈，强制滚到底部 + 清零未读
   *   - false：被动刷新（如 map:loaded），尊重玩家滚动位置：
   *           在底部则滚动；不在底部则累加未读 + 显示提示按钮
   */
  async function refreshLog(forceScroll: boolean = true): Promise<void> {
    if (loading.value) return;
    loading.value = true;

    try {
      // 统一读取入口：经 dataManager.fetch（去重，obl_log 非白名单不缓存）
      const result: ApiResponse = await dataManager.fetch('obl_log', true);
      if (result.status !== 'success') return;

      const data = result.data as { entries?: LogEntry[] } | undefined;
      const newAllEntries: LogEntry[] = data?.entries || [];

      // ── 增量检测 ──
      // prevLastTs 用于 Toast 增量触发（2 级页面打开时按白名单弹 Toast）
      // debug 日志不触发 Toast、不计入未读（即使 debug 模式开启）
      const prevLastTs = lastTs.value;
      const newEntries = newAllEntries.filter(
        (e) => e.ts > prevLastTs && !e.debug,
      );

      // ── Toast 触发（仅在 2 级页面打开时，避免遮罩遮挡日志区） ──
      if (isAnyOverlayOpen() && newEntries.length > 0) {
        const toastStore = useToastStore();
        for (let i = 0; i < newEntries.length; i++) {
          const entry = newEntries[i];
          const rule = TOAST_RULES[entry.id];
          if (rule) {
            const content = renderLogEntry(entry);
            // content 是 HTML（含高亮 span），isHtml=true 直接渲染
            // mergeId=entry.id 启用同类合并（避免批量操作刷屏）
            if (content) {
              toastStore.showToast(content, rule.style, 2000, true, entry.id);
            }
          }
        }
      }

      // ── 更新 lastTs（首次加载 lastTs=0，会把全部 entries 的最大 ts 记下，后续仅新增触发） ──
      lastTs.value = newAllEntries.length
        ? newAllEntries[newAllEntries.length - 1].ts
        : lastTs.value;

      // ── 更新 entries 状态（驱动 v-for 渲染） ──
      entries.value = newAllEntries;

      // ── 滚动逻辑（通过事件转发给 useLogScroll） ──
      if (forceScroll) {
        // 玩家主动操作：始终强制滚动到底部 + 清零未读
        dataManager.broadcast(LOG_FORCE_SCROLL_EVENT);
      } else {
        // 被动刷新：尊重玩家滚动位置
        // 在底部：useLogScroll 自动滚动；不在底部：累加未读
        if (newEntries.length > 0) {
          dataManager.broadcast(LOG_ADD_UNREAD_EVENT, newEntries.length);
        }
      }

      debugBus.emit('log', 'refreshLog:done', {
        count: newAllEntries.length,
        newCount: newEntries.length,
      });
    } catch (e) {
      console.error('[Log] refreshLog error:', e);
      useToastStore().showToast('游戏日志拉取失败', 'error', 4000, false, 'log-fetch');
    } finally {
      loading.value = false;
    }
  }

  // ═══ 事件监听：桥接 dataManager 的语义事件 ═══

  let _listenersRegistered = false;

  /** 注册 dataManager 事件监听（只注册一次） */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    // 玩家主动操作完成：强制滚动，用户要看操作结果
    // 但若 NPC 事件正在结算（pendingNpc=true），延迟刷新等 game:npc-settled
    dataManager.listen('game:action-completed', () => {
      if (commandQueue.pendingNpc) return; // 等 NPC 结算完毕再刷新
      refreshLog(true);
    });
    // NPC 结算完毕：刷新日志（补全 NPC 事件条目），强制滚动
    dataManager.listen('game:npc-settled', () => {
      refreshLog(true);
    });
    // 地图加载（含首次加载 + 操作后 loadMap 触发）：
    // forceScroll=false，避免与 game:action-completed 重复强制滚动
    // 首次加载时 useLogScroll.isAtBottom=true，仍会自动滚动到底部
    dataManager.listen('map:loaded', () => {
      refreshLog(false);
    });
  }

  return {
    // 状态
    entries,
    lastTs,
    loading,
    // actions
    refreshLog,
    registerListeners,
  };
});

/** 暴露给 useLogScroll 监听的事件名 */
export const LOG_EVENTS = {
  FORCE_SCROLL: LOG_FORCE_SCROLL_EVENT,
  ADD_UNREAD: LOG_ADD_UNREAD_EVENT,
} as const;
