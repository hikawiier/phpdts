//
// O-5 Workspace Gateway 备份列表路由
//
// GET /api/backups
//   response: { backups: BackupInfo[] }
//
// 列出 config.backupPath 下的所有备份目录（按时间倒序）。
// 仅返回 backup-YYYYMMDD-HHMMSS-<short-hash>/ 命名的目录，过滤其他文件。
//
// @module O 内容工具箱
//

import type { Request, Response } from 'express';
import type { Config } from '../config';
import {
  listBackups,
  type BackupInfo,
} from '../../../src/build/atomic-publisher';

interface BackupListResponse {
  backups: BackupInfo[];
}

export function registerBackupListRoute(app: import('express').Express, config: Config): void {
  app.get('/api/backups', async (_req: Request, res: Response) => {
    try {
      const backups = await listBackups(config.backupPath);
      const body: BackupListResponse = { backups };
      res.json(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        backups: [],
        error: `internal_error: ${message}`,
      });
    }
  });
}
