// ══════════════════════════════════════════════════
// 错误日志 store / Error log
//
// 检测后端 OblivionsErrorLogger 持久化的错误日志，通过 Toast 抛出。
//
// 职责：
//   - lastTs 增量检测（记录已展示的最大 ts）
//   - refreshErrorLog()：拉取 obl_error + 增量过滤 + Toast 触发
//   - 事件驱动：监听 game:action-completed（POST 命令后即时检测）
//   - 独立轮询：兜底检测非命令路径产生的错误（如 tick 结算异常）
//     默认关闭，URL 参数 ?poll_error=1 开启
//
// 设计依据：oblivions/docs/vex-vue 错误日志检测与展示设计方案.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { useToastStore } from '@/stores/toast';
import type { ErrorLogEntry, OblErrorLogResponse } from '@/types/api';
import type { ApiResponse } from '@/api/client';

/** 独立轮询周期（毫秒） */
const POLLING_INTERVAL = 5000;

/**
 * 错误渲染器：ID → HTML 渲染函数
 *
 * 新增错误类型时在此添加映射。未命中的 ID 走默认渲染。
 */
const ERROR_RENDERERS: Record<
  string,
  (params: Record<string, string | number | boolean>) => string
> = {
  'tick.dispatch.error': (p) =>
    `<span class="red">系统异常</span><br>游戏刻处理出错：${p.error ?? ''}<br>位置：${p.file ?? ''}:${p.line ?? ''}`,
  'tick.player_fetch.error': (p) =>
    `<span class="red">系统异常</span><br>玩家数据抓取失败：${p.user ?? ''}<br>待处理游戏刻：${p.delta ?? ''}`,
  'command.rejected': (p) => {
    const reasonMap: Record<string, string> = {
      command_not_allowed_in_current_state: '当前状态不允许此操作',
      npc_action_pending: 'NPC 事件未结算完毕，请稍候',
    };
    const reason = reasonMap[String(p.reason ?? '')] ?? `操作被拒绝：${p.reason ?? ''}`;
    // npc_action_pending 是正常游戏流程（NPC 结算中），降级为 warning 语义
    const isWarning = String(p.reason ?? '') === 'npc_action_pending';
    const titleClass = isWarning ? 'yellow' : 'red';
    const title = isWarning ? '操作暂不可用' : '操作被拒绝';
    return `<span class="${titleClass}">${title}</span><br>${reason}`;
  },
  'search.data_error': (p) =>
    `<span class="red">数据异常</span><br>建筑物配置缺失（POI: ${p.poi_id ?? ''}）`,
  'enemy_ai.config_missing': (p) =>
    `<span class="red">配置异常</span><br>敌人配置缺失（类型: ${p.enemy_type ?? ''}）`,
};

/** 渲染错误条目为 HTML（供 Toast isHtml=true 渲染） */
function renderErrorEntry(entry: ErrorLogEntry): string {
  const renderer = ERROR_RENDERERS[entry.id];
  if (renderer) return renderer(entry.params);

  // 默认渲染：[错误] ID + params 键值对
  const paramsStr = Object.entries(entry.params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `<span class="red">[错误] ${entry.id}</span>${paramsStr ? '<br>' + paramsStr : ''}`;
}

export const useErrorLogStore = defineStore('error-log', () => {
  /** 增量检测：记录已展示的最大 ts（持久化到 localStorage，页面刷新不丢失） */
  const LS_KEY = 'obl-error-last-ts';
  const lastTs = ref<number>(Number(localStorage.getItem(LS_KEY) || '0'));

  /** 轮询是否运行中 */
  const polling = ref<boolean>(false);

  /** 轮询定时器（非响应式，仅内部使用） */
  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  /** 是否正在加载（防重入） */
  const loading = ref<boolean>(false);

  /**
   * 拉取错误日志 + 增量检测 + Toast 触发
   *
   * 流程：
   *   1. dataManager.fetch('obl_error', true) 拉取错误日志（强制刷新，不缓存）
   *   2. 增量过滤：只处理 ts > lastTs 的新条目
   *   3. 更新 lastTs
   *   4. 逐条触发 Toast（error 类型，4000ms，mergeId=entry.id 同类合并）
   */
  async function refreshErrorLog(): Promise<void> {
    if (loading.value) return;
    loading.value = true;

    try {
      const result: ApiResponse = await dataManager.fetch('obl_error', true);
      if (result.status !== 'success' || !result.data) return;

      const data = result.data as OblErrorLogResponse;
      const allEntries: ErrorLogEntry[] = data.entries || [];
      if (allEntries.length === 0) return;

      // ── 增量检测 ──
      const prevLastTs = lastTs.value;
      const newEntries = allEntries.filter((e) => e.ts > prevLastTs);
      if (newEntries.length === 0) return;

      // ── 更新 lastTs（取全部条目的最大 ts，避免遗漏）+ 持久化 ──
      lastTs.value = allEntries[allEntries.length - 1].ts;
      localStorage.setItem(LS_KEY, String(lastTs.value));

      // ── 触发 Toast ──
      const toastStore = useToastStore();
      for (const entry of newEntries) {
        const content = renderErrorEntry(entry);
        // npc_action_pending 是正常游戏流程（NPC 结算中），降级为 warning 避免误报为错误
        const isWarning =
          entry.id === 'command.rejected' &&
          String(entry.params.reason ?? '') === 'npc_action_pending';
        const toastType = isWarning ? 'warning' : 'error';
        // isHtml=true：content 是已转义的 HTML（含 <br> 和 <span>）
        // mergeId=entry.id：同类错误合并，避免刷屏（不同 type 不会合并）
        toastStore.showToast(content, toastType, 4000, true, entry.id);
      }
    } catch (e) {
      console.error('[ErrorLog] refreshErrorLog error:', e);
      // 错误日志拉取本身失败时，后端错误通知机制失效，需 Toast 提示用户
      useToastStore().showToast('错误日志拉取失败', 'error', 4000, false, 'error-log-fetch');
    } finally {
      loading.value = false;
    }
  }

  /**
   * 启动独立轮询
   *
   * 默认不启动；由 App.vue 根据 URL 参数 ?poll_error=1 决定是否调用。
   */
  function startPolling(): void {
    if (polling.value) return;
    polling.value = true;
    pollingTimer = setInterval(refreshErrorLog, POLLING_INTERVAL);
  }

  /** 停止独立轮询 */
  function stopPolling(): void {
    if (!polling.value) return;
    polling.value = false;
    if (pollingTimer !== null) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  // ═══ 事件监听：桥接 dataManager 的语义事件 ═══

  let _listenersRegistered = false;

  /** 注册 dataManager 事件监听（只注册一次） */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    // 玩家 POST 命令完成后立即检测错误（即时性保障）
    dataManager.listen('game:action-completed', () => {
      refreshErrorLog();
    });
  }

  return {
    // 状态
    lastTs,
    polling,
    loading,
    // actions
    refreshErrorLog,
    startPolling,
    stopPolling,
    registerListeners,
  };
});
