//
// O-1 Workspace Gateway 前端共享类型
//
// 与 server 端 routes/* 与 services/file-watcher 输出结构对齐。
//
// @module O 内容工具箱
//

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  workspaceRoot: string;
  gamedataPath: string;
}

export interface ReadResponse {
  /** 相对 workspaceRoot 的路径（斜杠分隔） */
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  mtime?: number;
}

export interface ReadDirResponse {
  path: string;
  entries: DirEntry[];
}

export interface ParseResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface LintResponse {
  ok: boolean;
  output: string;
  error?: string;
}

export interface FileChangeEvent {
  /** 相对 workspaceRoot 的路径（斜杠分隔） */
  path: string;
  type: 'changed' | 'added' | 'removed';
  mtime?: number;
}

// ─── O-5 写路径响应类型 ───────────────────────────────────────
//
// 类型定义在 src/build/atomic-publisher.ts，前端通过 `import type` 复用
// （编译时擦除，不引入 Node.js fs 依赖）。
//

/** POST /api/write 响应体 */
export type PublishResult = import('@/build/atomic-publisher').PublishResult;

/** POST /api/write 请求体 */
export interface WriteRequestBody {
  files: import('@/build/atomic-publisher').PublishableFile[];
  baseline: import('@/build/atomic-publisher').BaselineEntry[];
  options?: {
    keepBackups?: number;
    backupDir?: string;
  };
}

/** GET /api/backups 响应体 */
export interface BackupListResponse {
  backups: import('@/build/atomic-publisher').BackupInfo[];
}

/** POST /api/restore 请求体 */
export interface RestoreRequestBody {
  name: string;
}

/** POST /api/restore 响应体 */
export interface RestoreResponse {
  success: boolean;
  error?: string;
}

// ─── O-11 迁移路由类型 ────────────────────────────────────────

/** POST /api/migrate 响应体（与 build/migration-flow.ts MigrationResult 对齐） */
export type MigrationResult = import('@/build/migration-flow').MigrationResult;

/** POST /api/migrate 请求体 */
export interface MigrateRequestBody {
  skipRoundTrip?: boolean;
  skipCompile?: boolean;
}

/** GET /api/migration-status 响应体 */
export interface MigrationStatusResponse {
  migrated: boolean;
  yamlFileCount: number;
  contentDirExists: boolean;
  error?: string;
}
