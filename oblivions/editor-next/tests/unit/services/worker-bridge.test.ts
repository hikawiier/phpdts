//
// worker-bridge 单元测试（对齐 NEW_DESIGN.md §4.1）
// 覆盖目标：≥80%
//
// 测试策略：
//   - WorkerBridge：用 mock Worker 测试 send / timeout / abort / terminate
//   - PhpParserBridge：用 mock Worker 测试 parsePhp / parseFiles / 回退主线程
//   - shouldUseWorker / parseOnMainThread / 常量：纯函数测试
//   - createPhpParserWorker：mock dynamic import

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WorkerBridge,
  PhpParserBridge,
  DEFAULT_WORKER_TIMEOUT_MS,
  LARGE_MAP_THRESHOLD,
  shouldUseWorker,
  parseOnMainThread,
  parseFilesInBackground,
  type WorkerBridgeResponse,
} from '@/services/worker-bridge';
import { parsePhpArray } from '@/shared';
import type { FileEntry } from '@/services/file-io';

// ─── Mock Worker 工厂 ────────────────────────────────────────

interface MockWorkerOptions {
  respond?: (request: { id: number; type: string; payload: unknown }) => WorkerBridgeResponse | null;
  delay?: number;
}

function createMockWorker(options: MockWorkerOptions = {}): Worker {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const errorListeners: Array<(event: ErrorEvent) => void> = [];
  const worker = {
    addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
      if (type === 'message') listeners.push(handler as (event: MessageEvent) => void);
      if (type === 'error') errorListeners.push(handler as (event: ErrorEvent) => void);
    }),
    removeEventListener: vi.fn(),
    postMessage: vi.fn((request: unknown) => {
      const { respond, delay = 0 } = options;
      if (!respond) return;
      const response = respond(request as { id: number; type: string; payload: unknown });
      if (response) {
        setTimeout(() => {
          listeners.forEach((l) => l({ data: response } as MessageEvent));
        }, delay);
      }
    }),
    terminate: vi.fn(),
  };
  return worker as unknown as Worker;
}

// ─── 常量 ────────────────────────────────────────────────────

describe('常量', () => {
  it('DEFAULT_WORKER_TIMEOUT_MS = 30000', () => {
    expect(DEFAULT_WORKER_TIMEOUT_MS).toBe(30_000);
  });

  it('LARGE_MAP_THRESHOLD = 10000', () => {
    expect(LARGE_MAP_THRESHOLD).toBe(10_000);
  });
});

// ─── shouldUseWorker ─────────────────────────────────────────

describe('shouldUseWorker', () => {
  it('小于阈值返回 false', () => {
    expect(shouldUseWorker(0)).toBe(false);
    expect(shouldUseWorker(9999)).toBe(false);
  });

  it('等于或大于阈值返回 true', () => {
    expect(shouldUseWorker(10_000)).toBe(true);
    expect(shouldUseWorker(50_000)).toBe(true);
  });
});

// ─── parseOnMainThread ───────────────────────────────────────

describe('parseOnMainThread', () => {
  it('调用 parsePhpArray 返回结果', () => {
    const result = parseOnMainThread('<?php return [1, 2];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2]);
  });

  it('解析失败返回 ok=false', () => {
    const result = parseOnMainThread('<?php echo "no return";');
    expect(result.ok).toBe(false);
  });
});

// ─── WorkerBridge ────────────────────────────────────────────

describe('WorkerBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('send 成功返回 data', async () => {
    const worker = createMockWorker({
      respond: (req) => ({ id: req.id, ok: true, data: { result: 'ok' } }),
    });
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', { x: 1 });
    await vi.runAllTimersAsync();
    const data = await promise;
    expect(data).toEqual({ result: 'ok' });
    bridge.terminate();
  });

  it('send 失败（ok=false）reject', async () => {
    const worker = createMockWorker({
      respond: (req) => ({ id: req.id, ok: false, error: 'parse error' }),
    });
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', {});
    // 先挂接 reject 处理器，再跑定时器，避免 Node 触发 PromiseRejectionHandledWarning
    const assertion = expect(promise).rejects.toThrow('parse error');
    await vi.runAllTimersAsync();
    await assertion;
    bridge.terminate();
  });

  it('send 超时 reject', async () => {
    const worker = createMockWorker({
      respond: () => null, // 不响应
      delay: 10_000,
    });
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', {}, { timeoutMs: 100 });
    // 先挂接 reject 处理器，再推进定时器，避免 Node 触发 PromiseRejectionHandledWarning
    const assertion = expect(promise).rejects.toThrow('Worker timeout after 100ms');
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    bridge.terminate();
  });

  it('AbortSignal 已取消时立即 reject', async () => {
    const worker = createMockWorker();
    const bridge = new WorkerBridge(worker);
    const controller = new AbortController();
    controller.abort();
    await expect(bridge.send('test', {}, { signal: controller.signal })).rejects.toThrow('aborted');
    bridge.terminate();
  });

  it('AbortSignal 在 send 后取消触发 reject', async () => {
    const worker = createMockWorker({
      respond: () => null, // 不响应
    });
    const bridge = new WorkerBridge(worker);
    const controller = new AbortController();
    const promise = bridge.send('test', {}, { signal: controller.signal, timeoutMs: 10_000 });
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
    bridge.terminate();
  });

  it('terminate 清理 pending 请求', async () => {
    const worker = createMockWorker({ respond: () => null });
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', {}, { timeoutMs: 10_000 });
    bridge.terminate();
    await expect(promise).rejects.toThrow('Worker terminated');
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('Worker error 事件拒绝所有 pending 请求', async () => {
    const errorListeners: Array<(event: ErrorEvent) => void> = [];
    const worker = {
      addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
        if (type === 'error') errorListeners.push(handler as (event: ErrorEvent) => void);
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', {}, { timeoutMs: 10_000 });
    // 触发 error 事件
    errorListeners.forEach((l) =>
      l(new ErrorEvent('error', { message: 'Worker boom' })),
    );
    await expect(promise).rejects.toThrow('Worker error: Worker boom');
    bridge.terminate();
  });

  it('未匹配 id 的消息被忽略', async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const worker = {
      addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
        if (type === 'message') listeners.push(handler as (event: MessageEvent) => void);
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', {}, { timeoutMs: 10_000 });
    // 发送一个不匹配 id 的消息
    listeners.forEach((l) =>
      l({ data: { id: 99999, ok: true, data: 'wrong' } } as MessageEvent),
    );
    // 正确的消息
    listeners.forEach((l) =>
      l({ data: { id: 1, ok: true, data: 'right' } } as MessageEvent),
    );
    const data = await promise;
    expect(data).toBe('right');
    bridge.terminate();
  });

  it('timeoutMs=0 不设置超时定时器', async () => {
    const worker = createMockWorker({
      respond: (req) => ({ id: req.id, ok: true, data: 'ok' }),
      delay: 50,
    });
    const bridge = new WorkerBridge(worker);
    const promise = bridge.send('test', {}, { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(100);
    const data = await promise;
    expect(data).toBe('ok');
    bridge.terminate();
  });
});

// ─── PhpParserBridge ─────────────────────────────────────────

describe('PhpParserBridge', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parsePhp 成功返回 PhpParseResult', async () => {
    const worker = createMockWorker({
      respond: (req) => ({
        id: req.id,
        ok: true,
        data: { result: { ok: true, value: [1, 2], error: undefined } },
      }),
    });
    const bridge = new PhpParserBridge(worker);
    const result = await bridge.parsePhp('<?php return [1, 2];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2]);
    bridge.terminate();
  });

  it('parsePhp Worker 失败回退主线程（返回主线程解析结果）', async () => {
    const worker = createMockWorker({
      respond: (req) => ({ id: req.id, ok: false, error: 'Worker error' }),
    });
    const bridge = new PhpParserBridge(worker);
    const result = await bridge.parsePhp('<?php return [1, 2];');
    // 回退主线程：parsePhpArray 成功
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2]);
    bridge.terminate();
  });

  it('parsePhp Worker 超时回退主线程', async () => {
    vi.useFakeTimers();
    const worker = createMockWorker({ respond: () => null });
    const bridge = new PhpParserBridge(worker);
    const promise = bridge.parsePhp('<?php return [42];', { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([42]);
    bridge.terminate();
  });

  it('parseFiles 成功返回 Record<path, PhpParseResult>', async () => {
    const worker = createMockWorker({
      respond: (req) => {
        const entries = req.payload as FileEntry[];
        const results: Record<string, unknown> = {};
        for (const e of entries) {
          results[e.path] = parsePhpArray(e.content);
        }
        return { id: req.id, ok: true, data: results };
      },
    });
    const bridge = new PhpParserBridge(worker);
    const entries: FileEntry[] = [
      { path: 'a.php', content: '<?php return [1];' },
      { path: 'b.php', content: '<?php return [2];' },
    ];
    const results = await bridge.parseFiles(entries);
    expect(Object.keys(results)).toHaveLength(2);
    expect(results['a.php']?.ok).toBe(true);
    expect(results['a.php']?.value).toEqual([1]);
    expect(results['b.php']?.ok).toBe(true);
    bridge.terminate();
  });

  it('parseFiles Worker 失败回退主线程逐个解析', async () => {
    const worker = createMockWorker({
      respond: (req) => ({ id: req.id, ok: false, error: 'boom' }),
    });
    const bridge = new PhpParserBridge(worker);
    const entries: FileEntry[] = [
      { path: 'a.php', content: '<?php return [1];' },
      { path: 'b.php', content: '<?php return [2];' },
    ];
    const results = await bridge.parseFiles(entries);
    expect(results['a.php']?.ok).toBe(true);
    expect(results['a.php']?.value).toEqual([1]);
    expect(results['b.php']?.ok).toBe(true);
    bridge.terminate();
  });

  it('terminate 委托给 WorkerBridge.terminate', () => {
    const worker = createMockWorker();
    const bridge = new PhpParserBridge(worker);
    bridge.terminate();
    expect(worker.terminate).toHaveBeenCalled();
  });
});

// ─── parseFilesInBackground（兼容 M1 接口） ─────────────────

describe('parseFilesInBackground', () => {
  it('调用 bridge.send 并返回 Promise', async () => {
    const worker = createMockWorker({
      respond: (req) => ({ id: req.id, ok: true, data: { done: true } }),
    });
    const bridge = new WorkerBridge(worker);
    const entries: FileEntry[] = [{ path: 'a.php', content: '<?php' }];
    // mock worker 通过 setTimeout(0) 异步响应，await promise 自然推进微任务 + 宏任务
    const data = await parseFilesInBackground(bridge, entries);
    expect(data).toEqual({ done: true });
    bridge.terminate();
  });
});
