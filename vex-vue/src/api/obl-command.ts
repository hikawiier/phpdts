import { API_BASE, fetchWithTimeout, type CommandResult } from './client';
import { renderCommandFeedback } from '@/data/command-feedback';
import { perf } from '@/utils/perf';
import type { PresentationBatchV1 } from '@/types/api';

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

export interface OblCommandResponse<TData = Record<string, unknown>> {
  status: 'success' | 'error';
  code: string;
  request_id?: string;
  message?: string;
  data?: TData;
  details?: unknown;
  presentation_head_seq?: number;
  presentation?: PresentationBatchV1;
}

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
      const res = await fetchWithTimeout(`${API_BASE}/oblivions/api/command.php`, {
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
