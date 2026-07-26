/**
 * @module N API 客户端
 */

import { API_ACTIONS, type ApiAction } from './endpoints';
import { perf } from '@/utils/perf';
import { debugBus } from '@/composables/useDebugBus';
import type { PresentationBatchV1 } from '@/types/api';

export const API_BASE = import.meta.env.VITE_API_BASE || '/phpdts';

const DEFAULT_FETCH_TIMEOUT = 15000;

/** 判断是否为游戏 API 请求（排除 Vite HMR / 字体 / 静态资源） */
function isGameApiRequest(url: string): boolean {
  return url.includes('/oblivions/api/');
}

function buildReadApiUrl(action: ApiAction, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...params, scope: action }).toString();
  return `${API_BASE}/oblivions/api/state.php?${query}`;
}

/**
 * 带超时的 fetch 封装：超时后 abort，避免网络挂起永久阻塞调用方。
 * dataManager 去重会让一个挂起的 Promise 阻塞后续同 action 的所有 fetch，
 * 因此所有 API 调用必须经过此封装。
 *
 * 调试埋桩：所有游戏 API 请求（/oblivions/api/）自动 emit 到 debugBus 的 'api' 类别，
 * 可通过 window.__phpdtsDebug.since(seq).filter(e => e.cat === 'api') 获取纯游戏请求，
 * 避免使用 list_network_requests 被 Vite HMR 请求淹没。
 */
export function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT,
): Promise<Response> {
  const isGameApi = isGameApiRequest(url);
  const method = options.method || 'GET';
  const startedAt = performance.now();

  if (isGameApi) {
    debugBus.emit('api', 'fetch.request', {
      url: url.replace(API_BASE, ''),
      method,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .then(res => {
      if (isGameApi) {
        debugBus.emit('api', 'fetch.response', {
          url: url.replace(API_BASE, ''),
          method,
          status: res.status,
          duration: Math.round(performance.now() - startedAt),
        });
      }
      return res;
    })
    .catch(err => {
      if (isGameApi) {
        debugBus.emit('api', 'fetch.error', {
          url: url.replace(API_BASE, ''),
          method,
          error: err instanceof Error ? err.message : String(err),
          duration: Math.round(performance.now() - startedAt),
        });
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

let oblHeartbeatInFlight: Promise<OblHeartbeatResponse> | null = null;

const API_ACTION_SET = new Set<string>(Object.values(API_ACTIONS));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Oblivions 显式 tick 心跳。
 *
 * 阶段三后 State API 纯读，不再通过读请求隐式推进 tick，
 * 战斗状态机和 battlelog 导演在读取状态前必须显式等待 heartbeat 完成。
 * 这里做前端侧请求去重，避免 daemon 与 refreshBattle 同时抢房间锁。
 */
export async function oblHeartbeat(): Promise<OblHeartbeatResponse> {
  if (oblHeartbeatInFlight) return oblHeartbeatInFlight;

  oblHeartbeatInFlight = perf.spanAsync('oblHeartbeat', 'api', async () => {
    let lastLockResponse: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetchWithTimeout(`${API_BASE}/oblivions/api/heartbeat.php`, {
        method: 'POST',
        credentials: 'include',
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error('heartbeat 返回格式错误（非 JSON）');
      }
      const data = await res.json();

      // heartbeat 与 command 共享房间锁。daemon / refreshBattle / command 临界区偶发重叠时，
      // 后端会返回 COMMAND_IN_PROGRESS；短重试可恢复“读状态前已结算”的确定性。
      const code = typeof data?.code === 'string' ? data.code : '';
      if (!res.ok && res.status === 409 && code === 'COMMAND_IN_PROGRESS') {
        lastLockResponse = data;
        await sleep(80 + attempt * 120);
        continue;
      }

      if (!res.ok) {
        const message = typeof data?.message === 'string' ? data.message : res.statusText;
        throw new Error(`heartbeat HTTP ${res.status}: ${message}`);
      }
      return data as OblHeartbeatResponse;
    }

    // 锁持续占用时软返回，避免导演刷新链路直接报错；下一轮刷新会继续推进。
    return (lastLockResponse || { ok: false, code: 'COMMAND_IN_PROGRESS' }) as OblHeartbeatResponse;
  }).finally(() => {
    oblHeartbeatInFlight = null;
  });

  return oblHeartbeatInFlight;
}

export function getHeartbeatChangedScopes(response: unknown): ApiAction[] {
  const root = response as {
    data?: Record<string, unknown>;
    gamedata?: Record<string, unknown>;
  } | null;
  const data = root?.data ?? root?.gamedata;
  const raw = data?.changed_scopes ?? data?.changedScopes;
  if (!Array.isArray(raw)) return [];

  const scopes: ApiAction[] = [];
  for (const scope of raw) {
    if (typeof scope !== 'string') continue;
    if (!API_ACTION_SET.has(scope)) continue;
    if (!scopes.includes(scope as ApiAction)) {
      scopes.push(scope as ApiAction);
    }
  }
  return scopes;
}

/**
 * 判断 heartbeat 是否软失败（3 次锁冲突后未推进 tick）。
 * 软失败时调用方不应继续读取 player_info，否则会基于旧状态决策。
 */
export function isHeartbeatSoftFailed(heartbeat: OblHeartbeatResponse): boolean {
  return heartbeat.ok === false || heartbeat.code === 'COMMAND_IN_PROGRESS';
}


/**
 * Oblivions 只读 State API：GET oblivions/api/state.php?scope=xxx。
 *
 * 返回完整响应对象 `{status: 'success'|'error', data, ...}`，调用方负责检查 status。
 * 仅在 HTTP 错误或网络异常时抛出（这些是真正的异常情况）。
 */
export async function gameApi(action: ApiAction): Promise<ApiResponse> {
  const url = buildReadApiUrl(action);
  return perf.spanAsync(`gameApi(${action})`, 'api', async () => {
    const res = await fetchWithTimeout(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('服务器返回格式错误（非 JSON）');
    }
    return res.json();
  });
}

/**
 * 带参 Oblivions 只读 State API：GET state.php?scope=xxx&key=val&...。
 *
 * 供 craft_preview 等需要查询参数的端点使用（gameApi 不带参数，无法覆盖）。
 * 不走 dataManager 缓存（参数化端点每次实时拉取）。
 *
 * 与 gameApi() 语义一致：返回完整响应对象
 * {status: 'success'|'error', data, ...}，调用方负责检查 status。
 */
export async function gameApiWithParams(
  action: ApiAction,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const url = buildReadApiUrl(action, params);
  return perf.spanAsync(`gameApi(${action})`, 'api', async () => {
    const res = await fetchWithTimeout(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('服务器返回格式错误（非 JSON）');
    }
    return res.json();
  });
}

/**
 * 便捷封装：调用 gameApi() 并提取 data，失败时抛异常。
 * 适用于不需要访问 status/code 等元信息的简单场景。
 */
export async function gameApiData<T = unknown>(action: ApiAction): Promise<T> {
  const resp = await gameApi(action);
  if (resp.status !== 'success') {
    throw new Error(
      `API error: ${resp.status || 'unknown'}${resp.msg ? ' - ' + resp.msg : ''}`,
    );
  }
  return resp.data as T;
}

// ─── 响应类型定义 ───

/** API 通用响应结构（Oblivions State API） */
export interface ApiResponse {
  status: 'success' | 'error';
  data?: unknown;
  msg?: string;
  code?: string;
  [key: string]: unknown;
}

/** 命令提交结果（JSON Command API 适配旧调用语义） */
export interface CommandResult {
  success: boolean;
  gamedata?: Record<string, unknown>;
  redirect?: string | null;
  timer?: number | null;
  error?: string | null;
  lockReason?: string | null;
  message?: string | null;
  messageIsHtml?: boolean;
  status?: number;
  details?: Record<string, unknown> | null;
  presentation_head_seq?: number;
  presentation?: PresentationBatchV1;
}

export interface TickDomainPhaseResult {
  name: string;
  legacy_phase?: string;
  listeners?: number;
  ran?: boolean;
  advanced_requested?: boolean;
  changed_scopes?: string[];
  events?: Array<{ event: string; payload?: Record<string, unknown> }>;
  [key: string]: unknown;
}

export interface TickFrameResult {
  delta: number;
  tick?: number;
  processed_tick?: number;
  next_tick?: number;
  phases: TickDomainPhaseResult[];
  changed_scopes: string[];
  [key: string]: unknown;
}

export interface OblHeartbeatData {
  resolved?: boolean;
  advanced?: boolean;
  delta?: number;
  tick?: number;
  processed_tick?: number;
  pending_tick?: boolean;
  reason?: string;
  recovered_battles?: number[];
  tick_frame?: TickFrameResult | null;
  changed_scopes?: string[];
  [key: string]: unknown;
}

export interface OblHeartbeatResponse {
  ok?: boolean;
  code?: string;
  message?: string;
  data?: OblHeartbeatData;
  presentation_head_seq?: number;
  presentation?: PresentationBatchV1;
  [key: string]: unknown;
}
