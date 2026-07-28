//
// O-11 Workspace Gateway 一次性迁移路由
//
// POST /api/migrate
//   body: { skipRoundTrip?: boolean; skipCompile?: boolean }
//   response: MigrationResult
//
// GET /api/migration-status
//   response: { migrated: boolean; yamlFileCount: number; contentDirExists: boolean }
//
// 在迁移期间临时暂停 file-watcher 事件广播，避免 Gateway 自身写入触发 file:changed 事件。
// 迁移是高风险操作（覆盖 PHP/TS 文件为编译产物），由前端 MigrationConfirmModal 显式确认后调用。
//
// migration-flow.ts 位于 editor-next/src/build/，该目录受 editor-next/package.json
// "type": "module" 约束为 ESM。server 以 CommonJS 运行（ts-node），无法静态 require()
// ESM 模块，因此使用动态 import() 在请求时按需加载。
//
// @module O 内容工具箱
//

import type { Request, Response } from 'express';
import type { Config } from '../config';
import { withWatcherPaused } from '../services/file-watcher';

// 类型仅用于注解，编译时擦除，不产生运行时 require
type MigrationResult = {
  success: boolean;
  diagnostics: Array<{
    severity: string;
    code: string;
    message: string;
    source: string;
  }>;
  stepStates: unknown[];
};

interface MigrateRequestBody {
  skipRoundTrip?: boolean;
  skipCompile?: boolean;
}

export function registerMigrateRoute(app: import('express').Express, config: Config): void {
  // ─── POST /api/migrate ──────────────────────────────────────
  app.post('/api/migrate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as MigrateRequestBody;

    try {
      // 动态 import() 加载 ESM 模块（migration-flow.ts 及其依赖链）
      const { migrateToSingleSource } = await import('../../../src/build/migration-flow');

      // 迁移期间暂停 file-watcher，避免自身写入触发 file:changed 事件
      const result = await withWatcherPaused(() =>
        migrateToSingleSource({
          workspaceRoot: config.workspaceRoot,
          backupDir: 'oblivions/editor-next/.backups',
          skipRoundTrip: body.skipRoundTrip ?? false,
          skipCompile: body.skipCompile ?? false,
        }),
      );
      res.json(result as MigrationResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed: MigrationResult = {
        success: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'migration.route_threw',
            message: `迁移路由异常：${message}`,
            source: 'migration-flow',
          },
        ],
        stepStates: [],
      };
      res.status(500).json(failed);
    }
  });

  // ─── GET /api/migration-status ─────────────────────────────
  app.get('/api/migration-status', async (_req: Request, res: Response) => {
    try {
      const { detectMigrationStatus } = await import('../../../src/build/migration-flow');
      const status = await detectMigrationStatus(config.workspaceRoot);
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        migrated: false,
        yamlFileCount: 0,
        contentDirExists: false,
        error: `internal_error: ${message}`,
      });
    }
  });
}
