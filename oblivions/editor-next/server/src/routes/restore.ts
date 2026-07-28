//
// O-5 Workspace Gateway 备份还原路由
//
// POST /api/restore
//   body: { name: string }
//   response: { success: boolean; error?: string }
//
// 从 config.backupPath 下指定名称的备份目录还原文件到 workspaceRoot。
// 还原期间暂停 file-watcher 事件广播。
//
// @module O 内容工具箱
//

import path from 'node:path';
import type { Request, Response } from 'express';
import type { Config } from '../config';
import { withWatcherPaused } from '../services/file-watcher';
import { restoreFromBackup } from '../../../src/build/atomic-publisher';

interface RestoreRequestBody {
  name: string;
}

interface RestoreResponse {
  success: boolean;
  error?: string;
}

export function registerRestoreRoute(app: import('express').Express, config: Config): void {
  app.post('/api/restore', async (req: Request, res: Response) => {
    const body = req.body as RestoreRequestBody | undefined;
    if (!body || typeof body.name !== 'string' || !body.name) {
      res.status(400).json({
        success: false,
        error: 'invalid_body: name is required',
      } satisfies RestoreResponse);
      return;
    }

    // 防御路径遍历：name 仅允许 backup-YYYYMMDD-HHMMSS-<hex> 格式
    if (!/^backup-\d{8}-\d{6}-[0-9a-f]+$/.test(body.name)) {
      res.status(400).json({
        success: false,
        error: 'invalid_backup_name: must match backup-YYYYMMDD-HHMMSS-<hex>',
      } satisfies RestoreResponse);
      return;
    }

    const backupDir = path.join(config.backupPath, body.name);

    try {
      await withWatcherPaused(() => restoreFromBackup(backupDir, config.workspaceRoot));
      res.json({ success: true } satisfies RestoreResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        error: `internal_error: ${message}`,
      } satisfies RestoreResponse);
    }
  });
}
