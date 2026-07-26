/**
 * @module N API 客户端
 * @framework N-1 请求去重
 */

// Oblivions 命令发送 API：封装 POST 请求到后端 command.php 端点
// 自动处理 request_id、JSON 序列化、错误响应、演出事件收件箱
import { API_BASE, fetchWithTimeout, type CommandResult } from './client';
import { renderCommandFeedback } from '@/data/command-feedback';
import { perf } from '@/utils/perf';
import type { PresentationBatchV1 } from '@/types/api';
import { isDebugAllEnabled } from '@/utils/debug-flags';

// 命令请求信封：command/request_id/payload/expected/client
export interface OblCommandEnvelope<TPayload = unknown> {
  command: string;
  request_id?: string;
  payload?: TPayload;
  expected?: Record<string, unknown>;
  client?: {
    app?: string;
    version?: string;
    sent_at?: number;
  };
}

// 命令响应格式：status / code / data / presentation 事件
export interface OblCommandResponse<TData = Record<string, unknown>> {
  status: 'success' | 'error';
  code: string;
  request_id?: string;
  message?: string;
  data?: TData;
  details?: Record<string, unknown>;
  presentation_head_seq?: number;
  presentation?: PresentationBatchV1;
}

// 生成唯一请求 ID：格式 "obl-{timestamp36}-{random}"
function createRequestId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `obl-${Date.now().toString(36)}-${random}`;
}

export async function sendOblCommand<TPayload = unknown>(
  envelope: OblCommandEnvelope<TPayload>,
): Promise<CommandResult> {
  const requestId = envelope.request_id || createRequestId();
  const body: OblCommandEnvelope<TPayload> = {
    ...envelope,
    request_id: requestId,
    payload: envelope.payload ?? ({} as TPayload),
    client: {
      app: 'vex-vue',
      sent_at: Date.now(),
      ...(envelope.client || {}),
    },
  };

  return perf.spanAsync(`sendOblCommand(${body.command})`, 'api', async () => {
    try {
      const debugQuery = body.command.startsWith('debug.') && isDebugAllEnabled() ? '?debug=all' : '';
      const res = await fetchWithTimeout(`${API_BASE}/oblivions/api/command.php${debugQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        console.error('[sendOblCommand] non-JSON response:', await res.text().catch(() => '(empty)'));
        const feedback = renderCommandFeedback('SERVER_ERROR');
        return {
          success: false,
          error: 'SERVER_ERROR',
          message: feedback.message,
          messageIsHtml: feedback.isHtml,
          status: res.status,
        };
      }
      const response = await res.json() as OblCommandResponse<Record<string, unknown>>;
      const ok = response.status === 'success';
      const feedback = ok
        ? { message: response.message || null, isHtml: false }
        : renderCommandFeedback(response.code, response.data, response.message || response.code);
      return {
        success: ok,
        gamedata: response.data || {},
        redirect: null,
        timer: null,
        error: ok ? null : response.code,
        message: feedback.message,
        messageIsHtml: feedback.isHtml,
        status: res.status,
        details: response.details
          ?? (response.data?.details as Record<string, unknown> | undefined)
          ?? null,
        presentation_head_seq: response.presentation_head_seq,
        presentation: response.presentation,
      };
    } catch (e) {
      const feedback = renderCommandFeedback('NETWORK_ERROR');
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: feedback.message || (e instanceof Error ? e.message : String(e)),
        messageIsHtml: feedback.isHtml,
      };
    }
  });
}
