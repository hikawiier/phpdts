//
// O-1 Workspace Gateway HTTP 客户端
//
// fetch 包装，统一错误处理。检测 Gateway 不可达时抛 GatewayUnavailableError，
// 由调用方决定是否回退到浏览器只读 FSAA 模式。
//
// base url 默认 '/api'，开发环境走 vite proxy 转发到 http://127.0.0.1:5180。
//
// @module O 内容工具箱
// @framework O-1 Workspace Gateway
//

import type {
  HealthResponse,
  LintResponse,
  ParseResponse,
  ReadDirResponse,
  ReadResponse,
  WriteRequestBody,
  PublishResult,
  BackupListResponse,
  RestoreRequestBody,
  RestoreResponse,
  MigrationResult,
  MigrateRequestBody,
  MigrationStatusResponse,
} from './types';
import type {
  PublishableFile,
  BaselineEntry,
  BackupInfo,
} from '@/build/atomic-publisher';

/**
 * Gateway 不可达错误。调用方可捕获后回退到浏览器 FSAA 只读路径。
 */
export class GatewayUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'GatewayUnavailableError';
  }
}

/**
 * Gateway 业务错误（4xx / 5xx 但有响应体）
 */
export class GatewayApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'GatewayApiError';
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_BASE = '/api';

export interface ClientOptions {
  base?: string;
}

/**
 * 构造查询字符串（仅包含值为 string/number/boolean 的键）
 */
function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      params.set(k, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Record<string, unknown>; body?: unknown; base?: string } = {},
): Promise<T> {
  const base = opts.base ?? DEFAULT_BASE;
  const url = `${base}${path}${buildQuery(opts.query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // fetch 抛 TypeError 通常是网络不可达（Gateway 未启动）
    throw new GatewayUnavailableError(
      `Gateway 不可达：${method} ${url}`,
      err,
    );
  }

  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    throw new GatewayApiError(
      `Gateway ${method} ${path} 返回 ${res.status}`,
      res.status,
      body,
    );
  }
  return body as T;
}

/**
 * GET 包装。
 *
 * @param path 形如 '/read'（不含 /api 前缀）
 */
export function gatewayGet<T>(
  path: string,
  query?: Record<string, unknown>,
  opts?: ClientOptions,
): Promise<T> {
  return request<T>('GET', path, { query, base: opts?.base });
}

/**
 * POST 包装。
 */
export function gatewayPost<T>(
  path: string,
  body?: unknown,
  opts?: ClientOptions,
): Promise<T> {
  return request<T>('POST', path, { body, base: opts?.base });
}

// 便捷封装 ----------------------------------------------------------------

export function getHealth(opts?: ClientOptions): Promise<HealthResponse> {
  return gatewayGet<HealthResponse>('/health', undefined, opts);
}

export function readFile(relPath: string, opts?: ClientOptions): Promise<ReadResponse> {
  return gatewayGet<ReadResponse>('/read', { path: relPath }, opts);
}

export function readDir(
  relPath: string,
  recursive = false,
  opts?: ClientOptions,
): Promise<ReadDirResponse> {
  return gatewayGet<ReadDirResponse>('/read-dir', { path: relPath, recursive }, opts);
}

export function parsePhp(
  payload: { filePath?: string; content?: string },
  opts?: ClientOptions,
): Promise<ParseResponse> {
  return gatewayPost<ParseResponse>('/parse-php', payload, opts);
}

export function parseTsLocale(
  payload: { filePath?: string; content?: string },
  opts?: ClientOptions,
): Promise<ParseResponse> {
  return gatewayPost<ParseResponse>('/parse-ts-locale', payload, opts);
}

export function lintPhp(
  payload: { filePath?: string; content?: string },
  opts?: ClientOptions,
): Promise<LintResponse> {
  return gatewayPost<LintResponse>('/lint-php', payload, opts);
}

// ─── O-5 写路径便捷封装 ───────────────────────────────────────

/**
 * 原子发布——把 files 写入 workspaceRoot 下对应路径。
 *
 * Gateway 不可达时抛 GatewayUnavailableError，调用方可捕获后决定是否回退到
 * 浏览器 FSAA 路径（useImportExport.writeBackToSource，仅支持单文件写入，
 * 不支持原子发布）。
 *
 * Gateway 业务错误（4xx/5xx 但响应体是 PublishResult）直接返回 PublishResult，
 * 让调用方通过 result.success / result.error / result.conflicts 处理。
 *
 * @param files 已序列化的待发布文件
 * @param baseline 基线条目数组（含 filePath + FileRevision）
 * @param opts 可选配置（keepBackups / backupDir）
 */
export function publishFiles(
  files: PublishableFile[],
  baseline: BaselineEntry[],
  opts?: { keepBackups?: number; backupDir?: string } & ClientOptions,
): Promise<PublishResult> {
  const { keepBackups, backupDir, ...clientOpts } = opts ?? {};
  const body: WriteRequestBody = {
    files,
    baseline,
    options: keepBackups !== undefined || backupDir !== undefined
      ? { keepBackups, backupDir }
      : undefined,
  };
  return gatewayPost<PublishResult>('/write', body, clientOpts);
}

/**
 * 列出 Gateway 备份目录下所有备份（按时间倒序）。
 *
 * Gateway 不可达时抛 GatewayUnavailableError。
 */
export function listBackups(opts?: ClientOptions): Promise<BackupInfo[]> {
  return gatewayGet<BackupListResponse>('/backups', undefined, opts).then(
    (r) => r.backups,
  );
}

/**
 * 从指定备份还原——把备份目录中的文件复制回 workspaceRoot。
 *
 * Gateway 不可达时抛 GatewayUnavailableError。
 *
 * @param name 备份目录名（如 backup-20260727-120000-abc123）
 */
export function restoreBackup(
  name: string,
  opts?: ClientOptions,
): Promise<RestoreResponse> {
  const body: RestoreRequestBody = { name };
  return gatewayPost<RestoreResponse>('/restore', body, opts);
}

// ─── O-11 迁移路由便捷封装 ───────────────────────────────────

/**
 * 一次性迁移——从 PHP/TS 双源形态迁移到 YAML 单源形态。
 *
 * Gateway 不可达时抛 GatewayUnavailableError。
 * 迁移是高风险操作，调用方必须先通过 MigrationConfirmModal 让用户显式确认。
 *
 * @param body 可选参数：skipRoundTrip / skipCompile（仅用于开发模式）
 */
export function migrateWorkspace(
  body?: MigrateRequestBody,
  opts?: ClientOptions,
): Promise<MigrationResult> {
  return gatewayPost<MigrationResult>('/migrate', body ?? {}, opts);
}

/**
 * 探测工作区是否已完成 P5-4 单源迁移。
 *
 * Gateway 不可达时抛 GatewayUnavailableError。
 * 用于 OverviewView 显示"待迁移"卡片 vs "已迁移"状态。
 */
export function getMigrationStatus(
  opts?: ClientOptions,
): Promise<MigrationStatusResponse> {
  return gatewayGet<MigrationStatusResponse>('/migration-status', undefined, opts);
}
