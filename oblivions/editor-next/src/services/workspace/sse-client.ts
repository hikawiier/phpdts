//
// O-1 Workspace Gateway SSE 客户端
//
// EventSource 包装，订阅 file:changed 事件。
// 自动重连（指数退避，最大 30s），连接状态变化时 emit 事件。
//
// @module O 内容工具箱
//

import type { FileChangeEvent } from './types';

export type SseConnectionState = 'connecting' | 'open' | 'closed';

export interface SseClientOptions {
  /** EventSource URL，默认 '/api/events'（走 vite proxy） */
  url?: string;
  /** 是否在调用 subscribe 后立即连接，默认 true */
  autoConnect?: boolean;
  /** 初始退避毫秒，默认 1000 */
  initialBackoffMs?: number;
  /** 最大退避毫秒，默认 30000 */
  maxBackoffMs?: number;
}

type StateListener = (state: SseConnectionState) => void;

/**
 * SSE 客户端单例。P0-H 阶段在 main.ts 中显式调用 connect() 启动；
 * 在 P0 阶段的其他视图（如 OverviewView 的 GatewayStatus 组件）可订阅 state 变化。
 */
export class SseClient {
  private readonly url: string;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  private es: EventSource | null = null;
  private state: SseConnectionState = 'closed';
  private readonly stateListeners = new Set<StateListener>();
  private readonly fileChangedHandlers = new Set<(e: FileChangeEvent) => void>();

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBackoff: number;
  private manuallyClosed = false;

  constructor(opts: SseClientOptions = {}) {
    this.url = opts.url ?? '/api/events';
    this.initialBackoffMs = opts.initialBackoffMs ?? 1000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30000;
    this.currentBackoff = this.initialBackoffMs;
    if (opts.autoConnect !== false) {
      // 延迟到下一个微任务，避免构造函数中抛错无法被 try/catch 捕获
      Promise.resolve().then(() => this.connect()).catch(() => undefined);
    }
  }

  /**
   * 显式建立连接。可重复调用，已连接时为 no-op。
   */
  connect(): void {
    this.manuallyClosed = false;
    if (this.es !== null) return;
    this.setState('connecting');

    const es = new EventSource(this.url, { withCredentials: false });
    this.es = es;

    es.onopen = () => {
      this.currentBackoff = this.initialBackoffMs;
      this.setState('open');
    };

    es.addEventListener('file:changed', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as FileChangeEvent;
        for (const handler of this.fileChangedHandlers) {
          try {
            handler(data);
          } catch (err) {
            console.warn('[sse-client] file:changed handler 抛错:', err);
          }
        }
      } catch (err) {
        console.warn('[sse-client] 无法解析 file:changed 数据:', err, ev.data);
      }
    });

    es.onerror = () => {
      // EventSource 在 error 后会自动尝试重连，但浏览器策略不可控；
      // 这里主动关闭并按指数退避手动重连，确保跨浏览器行为一致。
      this.cleanupEventSource();
      this.setState('closed');
      if (this.manuallyClosed) return;
      this.scheduleReconnect();
    };
  }

  /**
   * 关闭连接，不再自动重连。
   */
  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupEventSource();
    this.setState('closed');
  }

  /**
   * 订阅 file:changed 事件。返回取消订阅函数。
   */
  subscribeFileChanged(handler: (e: FileChangeEvent) => void): () => void {
    this.fileChangedHandlers.add(handler);
    return () => {
      this.fileChangedHandlers.delete(handler);
    };
  }

  /**
   * 订阅连接状态变化。返回取消订阅函数。
   */
  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    // 立即推送当前状态，方便新订阅者初始化 UI
    try {
      listener(this.state);
    } catch (err) {
      console.warn('[sse-client] state listener 抛错:', err);
    }
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getState(): SseConnectionState {
    return this.state;
  }

  private setState(s: SseConnectionState): void {
    if (this.state === s) return;
    this.state = s;
    for (const listener of this.stateListeners) {
      try {
        listener(s);
      } catch (err) {
        console.warn('[sse-client] state listener 抛错:', err);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = this.currentBackoff;
    this.currentBackoff = Math.min(this.currentBackoff * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cleanupEventSource(): void {
    if (this.es !== null) {
      this.es.onopen = null;
      this.es.onerror = null;
      this.es.onmessage = null;
      this.es.close();
      this.es = null;
    }
  }
}

/**
 * 全局单例。在 main.ts 启动时通过 ensureSseClient() 初始化。
 * P0-H 任务在 main.ts 中调用 ensureSseClient() 即可。
 */
let globalClient: SseClient | null = null;

export function ensureSseClient(opts?: SseClientOptions): SseClient {
  if (globalClient === null) {
    globalClient = new SseClient(opts ?? { autoConnect: false });
  }
  return globalClient;
}

export function getSseClient(): SseClient | null {
  return globalClient;
}

/**
 * 订阅 file:changed 事件的便捷封装。
 * 如果全局单例尚未初始化，会先创建并连接。
 */
export function subscribeFileChanged(handler: (e: FileChangeEvent) => void): () => void {
  const client = ensureSseClient();
  client.connect();
  return client.subscribeFileChanged(handler);
}
