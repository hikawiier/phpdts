// @module O 内容工具箱
//
// worker-bridge：Web Worker 通信桥（对齐 NEW_DESIGN.md §3.2.5）
//
// 用于 php-parser.worker.ts 后台解析 PHP 文件，避免大地图（10000+ 格）阻塞 UI
// 设计要点：
//   - parseInWorker(phpString)：postMessage 到 worker，返回 Promise<PhpParseResult>
//   - 超时处理（默认 30s）：超时自动取消，回退到主线程
//   - 取消支持（AbortController）：调用方可主动取消
//   - 大地图（>10000 格）默认走 Worker；小地图走主线程避免 Worker 通信开销
//   - Worker 失败回退到主线程（对齐 §3.2.5）

import { parsePhpArray } from '@/shared';
import type { PhpParseResult } from '@/shared';
import type { FileEntry } from './file-io';

/**
 * Worker 通信消息（请求）
 */
export interface WorkerBridgeRequest<T = unknown> {
  readonly id: number;
  readonly type: string;
  readonly payload: T;
}

/**
 * Worker 通信消息（响应）
 */
export interface WorkerBridgeResponse<T = unknown> {
  readonly id: number;
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

/**
 * 默认 Worker 超时时间：30 秒
 *
 * 大地图（255 区域 × 254 格 = ~65k 格）解析通常 < 1s，
 * 30s 作为兜底防止 Worker 卡死
 */
export const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

/**
 * 大地图阈值：超过此值自动走 Worker
 *
 * 阈值取 10000，对齐 NEW_DESIGN.md §3.2.5 验收标准
 */
export const LARGE_MAP_THRESHOLD = 10_000;

/**
 * Worker 通信桥：管理请求-响应配对，支持超时与取消
 */
export class WorkerBridge<TWorker extends Worker> {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (response: WorkerBridgeResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  constructor(private readonly worker: TWorker) {
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('error', this.handleError);
  }

  private handleMessage = (event: MessageEvent<WorkerBridgeResponse>): void => {
    const response = event.data;
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(response);
  };

  private handleError = (event: ErrorEvent): void => {
    // Worker 全局错误：拒绝所有 pending 请求
    const error = new Error(`Worker error: ${event.message}`);
    for (const [id, entry] of this.pending.entries()) {
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
  };

  /**
   * 发送请求到 Worker
   *
   * @param type 消息类型（如 'parse-files'）
   * @param payload 消息负载
   * @param options.timeoutMs 超时时间（默认 30s）
   * @param options.signal AbortController.signal，可主动取消
   * @param transfer 可转移对象列表（如 ArrayBuffer）
   */
  send<T>(
    type: string,
    payload: T,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
    },
    transfer?: Transferable[],
  ): Promise<unknown> {
    const id = this.nextId++;
    const request: WorkerBridgeRequest<T> = { id, type, payload };
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
    const signal = options?.signal;

    return new Promise((resolve, reject) => {
      // 已取消则直接拒绝
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }

      // 设置超时
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (this.pending.has(id)) {
                this.pending.delete(id);
                reject(new Error(`Worker timeout after ${timeoutMs}ms`));
              }
            }, timeoutMs)
          : null;

      // 监听取消信号
      const onAbort = (): void => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          if (timer) clearTimeout(timer);
          reject(new Error('aborted'));
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        resolve: (response) => {
          signal?.removeEventListener('abort', onAbort);
          if (response.ok && response.data !== undefined) {
            resolve(response.data);
          } else {
            reject(new Error(response.error ?? 'worker bridge: unknown error'));
          }
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        timer,
      });

      this.worker.postMessage(request, transfer ?? []);
    });
  }

  /**
   * 终止 Worker 并清理所有 pending 请求
   */
  terminate(): void {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.worker.terminate();
    for (const [, entry] of this.pending.entries()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
  }
}

/**
 * PHP 解析 Worker 桥：封装 WorkerBridge，提供高级 API
 */
export class PhpParserBridge {
  private readonly bridge: WorkerBridge<Worker>;

  constructor(worker: Worker) {
    this.bridge = new WorkerBridge(worker);
  }

  /**
   * 在 Worker 中解析单个 PHP 字符串
   *
   * Worker 失败 / 超时 / 中止时自动回退到主线程解析（对齐 §3.2.5）
   * 回退后返回的是主线程 parsePhpArray 的真实结果，而非错误占位
   */
  async parsePhp(
    phpString: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<PhpParseResult> {
    try {
      const data = (await this.bridge.send(
        'parse-php',
        { phpString },
        options,
      )) as { result: PhpParseResult };
      return data.result;
    } catch {
      // Worker 失败回退到主线程（对齐 §3.2.5）：返回主线程解析的真实结果
      return parsePhpArray(phpString);
    }
  }

  /**
   * 在 Worker 中解析多个 PHP 文件
   *
   * @param entries FileEntry 列表
   * @returns Map<filename, PhpParseResult>
   */
  async parseFiles(
    entries: FileEntry[],
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Record<string, PhpParseResult>> {
    try {
      const data = (await this.bridge.send(
        'parse-files',
        entries,
        options,
      )) as Record<string, PhpParseResult>;
      return data;
    } catch {
      // Worker 失败回退到主线程：逐个解析
      const results: Record<string, PhpParseResult> = {};
      for (const entry of entries) {
        results[entry.path] = parsePhpArray(entry.content);
      }
      return results;
    }
  }

  terminate(): void {
    this.bridge.terminate();
  }
}

/**
 * 创建 PHP 解析 Worker 实例
 *
 * Vite 通过 ?worker query 自动打包 Worker 入口
 */
export async function createPhpParserWorker(): Promise<PhpParserBridge> {
  const WorkerFactory = (await import('../workers/php-parser.worker.ts?worker'))
    .default;
  const worker = new WorkerFactory();
  return new PhpParserBridge(worker);
}

/**
 * 主线程解析（用于小地图或 Worker 回退）
 *
 * 大地图（>LARGE_MAP_THRESHOLD）走 Worker，小地图走主线程避免 Worker 通信开销
 */
export function parseOnMainThread(phpString: string): PhpParseResult {
  return parsePhpArray(phpString);
}

/**
 * 根据地图大小决定是否走 Worker
 *
 * @param totalTiles 总格数（regions × grids 或 tiles 总数）
 */
export function shouldUseWorker(totalTiles: number): boolean {
  return totalTiles >= LARGE_MAP_THRESHOLD;
}

/**
 * 兼容 M1 空壳接口：parseFilesInBackground
 *
 * 推荐使用 PhpParserBridge.parseFiles
 */
export async function parseFilesInBackground(
  bridge: WorkerBridge<Worker>,
  entries: FileEntry[],
): Promise<unknown> {
  return bridge.send('parse-files', entries);
}
