import { API_ACTIONS, type ApiAction } from './endpoints';
import { perf } from '@/utils/perf';

const API_BASE = import.meta.env.VITE_API_BASE || '/phpdts';

/**
 * 只读 API：GET api_v2.php?action=xxx
 *
 * 与现有 vex/js/utils.js 的 gameApi() 语义一致：返回完整响应对象
 * `{status: 'success'|'error', data, ...}`，调用方负责检查 status。
 * 仅在 HTTP 错误或网络异常时抛出（这些是真正的异常情况）。
 *
 * 注意：实际 API 返回 status: 'success'（非 'ok'），见迁移计划 2.9 节。
 */
export async function gameApi(action: ApiAction): Promise<ApiResponse> {
  const url = `${API_BASE}/api_v2.php?action=${action}`;
  return perf.spanAsync(`gameApi(${action})`, 'api', async () => {
    const res = await fetch(url, { credentials: 'include' });
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

/**
 * 写入 API：POST command.php（Oblivions 模式）
 *
 * 与现有 vex/js/utils.js 的 submitCommand() 语义一致：
 * 返回 `{success, gamedata, redirect, timer, error, message}`。
 * Oblivions 模式后端返回空对象（无 gamedata），此时 success=true。
 */
export async function submitCommand(
  params: Record<string, string>,
): Promise<CommandResult> {
  const body = new URLSearchParams({ mode: 'command', ...params });
  return perf.spanAsync(`submitCommand(${params.command || 'unknown'})`, 'api', async () => {
    try {
      const res = await fetch(`${API_BASE}/command.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'include',
      });
      if (!res.ok) {
        return { success: false, error: 'HTTP_ERROR', status: res.status };
      }
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        return { success: true };
      }
      const gamedata = await res.json();
      // P2 修复：gamedata.error 存在时（如 COMMAND_IN_PROGRESS）不应误判为成功
      const hasError = !!gamedata.error;
      return {
        success: !hasError,
        gamedata,
        redirect: gamedata.redirect || null,
        timer: gamedata.timer || null,
        error: gamedata.error || null,
        message: hasError ? '命令执行中，请稍候' : null,
      };
    } catch (e) {
      // 网络错误（断网/CORS/DNS 失败）返回错误对象，不抛异常（与原 vex/js/utils.js 一致）
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

/**
 * 零依赖接口：标记战斗日志已播放
 * POST vex/mark_battle_log_played.php（groomid/pid/log_ids）
 */
export async function markBattleLogPlayed(
  groomid: number,
  pid: number,
  logIds: number[],
): Promise<{ success: boolean; marked?: number }> {
  const body = new URLSearchParams({
    groomid: String(groomid),
    pid: String(pid),
    log_ids: logIds.join(','),
  });
  const res = await fetch(`${API_BASE}/vex/mark_battle_log_played.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * 调试用：批量写入 AI dump（JSON Lines 格式）
 * POST api_v2.php?action=ai_dump_save
 *
 * 注意：现有 debug.js 使用 Content-Type: text/plain，这里保持一致。
 */
export async function aiDumpSave(jsonLines: string): Promise<unknown> {
  const res = await fetch(
    `${API_BASE}/api_v2.php?action=${API_ACTIONS.AI_DUMP_SAVE}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: jsonLines,
      credentials: 'include',
    },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ─── 响应类型定义 ───

/** API 通用响应结构（api_v2.php 所有只读端点共用） */
export interface ApiResponse {
  status: 'success' | 'error';
  data?: unknown;
  msg?: string;
  code?: string;
  [key: string]: unknown;
}

/** command.php 提交结果（与现有 utils.js submitCommand 返回结构一致） */
export interface CommandResult {
  success: boolean;
  gamedata?: Record<string, unknown>;
  redirect?: string | null;
  timer?: number | null;
  error?: string | null;
  message?: string | null;
  status?: number;
}
