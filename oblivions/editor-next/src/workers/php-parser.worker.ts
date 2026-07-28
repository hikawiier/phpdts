// @module O 内容工具箱
//
// PHP 解析 Web Worker（对齐 NEW_DESIGN.md §3.2.5 + §9.2 workers/）
//
// 大地图（10000+ 格）后台解析，避免阻塞 UI
// 算法实现复用 @/shared/serializer（不在 Worker 内重写）
//
// 支持两种消息类型：
//   - 'parse-php'：解析单个 PHP 字符串，返回 { result: PhpParseResult }
//   - 'parse-files'：解析多个 FileEntry，返回 Record<filename, PhpParseResult>
//
// 错误处理：
//   - 解析失败（result.ok === false）作为正常响应返回（ok=true, data 含 result）
//   - Worker 内部异常（如内存溢出）返回 ok=false + error 信息
//   - 主线程通过 worker-bridge 接收，超时/取消时回退主线程解析

import { parsePhpArray } from '@/shared';
import type { PhpParseResult } from '@/shared';
import type { FileEntry } from '@/services/file-io';

interface WorkerRequest<T = unknown> {
  readonly id: number;
  readonly type: string;
  readonly payload: T;
}

interface WorkerResponse<T = unknown> {
  readonly id: number;
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const response = handleRequest(request);
    self.postMessage(response satisfies WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: WorkerResponse = { id: request.id, ok: false, error: message };
    self.postMessage(response);
  }
});

function handleRequest(request: WorkerRequest): WorkerResponse {
  switch (request.type) {
    case 'parse-php':
      return handleParsePhp(request.id, request.payload as { phpString: string });
    case 'parse-files':
      return handleParseFiles(request.id, request.payload as FileEntry[]);
    default:
      return {
        id: request.id,
        ok: false,
        error: `unknown request type: ${request.type}`,
      };
  }
}

function handleParsePhp(id: number, payload: { phpString: string }): WorkerResponse {
  // parsePhpArray 不抛异常，解析失败返回 { ok: false, ... }
  // 这里作为正常响应返回（ok=true, data 含 result），让调用方按 result.ok 判断
  const result: PhpParseResult = parsePhpArray(payload.phpString);
  return { id, ok: true, data: { result } };
}

function handleParseFiles(id: number, entries: FileEntry[]): WorkerResponse {
  const results: Record<string, PhpParseResult> = {};
  for (const entry of entries) {
    // parsePhpArray 不抛异常，逐个解析并收集结果
    results[entry.path] = parsePhpArray(entry.content);
  }
  return { id, ok: true, data: results };
}

export {};
