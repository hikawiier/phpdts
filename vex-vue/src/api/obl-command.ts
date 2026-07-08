import { API_BASE, type CommandResult } from './client';
import { perf } from '@/utils/perf';

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
      const res = await fetch(`${API_BASE}/oblivions/api/command.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        console.error('[sendOblCommand] non-JSON response:', await res.text().catch(() => '(empty)'));
        return { success: false, error: 'SERVER_ERROR', message: '服务器内部错误', status: res.status };
      }
      const response = await res.json() as OblCommandResponse<Record<string, unknown>>;
      const ok = response.status === 'success';
      return {
        success: ok,
        gamedata: response.data || {},
        redirect: null,
        timer: null,
        error: ok ? null : response.code,
        message: response.message || (ok ? null : response.code),
        status: res.status,
      };
    } catch (e) {
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });
}
