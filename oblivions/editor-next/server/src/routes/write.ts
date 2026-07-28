//
// O-5 Workspace Gateway 写路径路由
//
// POST /api/write
//   body: { files: PublishableFile[]; baseline: BaselineEntry[]; options?: PublishOptions }
//   response: PublishResult
//
// 在发布期间临时暂停 file-watcher 事件广播，避免 Gateway 自身写入触发 file:changed 事件。
// 备份目录使用 config.backupPath（默认 oblivions/editor-next/.backups，与 .gitignore 一致）。
//
// P3 §4.7.1：注入 prePublishCheck hook，在备份创建前对 PHP 文件执行 `php -l`。
// TS 文件的 vue-tsc 校验在 P5 完整管道中实现——P3 阶段 TS 投影器已保证类型安全
// （投影器输出固定模板 + 节点 data 经 schema 校验）。
//
// @module O 内容工具箱
//

import path from 'node:path';
import type { Request, Response } from 'express';
import type { Config } from '../config';
import { withWatcherPaused } from '../services/file-watcher';
import { runPrePublishPhpLint } from '../services/php-lint-service';
import {
  publishFiles,
  type PublishableFile,
  type BaselineEntry,
  type PublishOptions,
  type PublishResult,
} from '../../../src/build/atomic-publisher';

interface WriteRequestBody {
  files: PublishableFile[];
  baseline: BaselineEntry[];
  options?: Partial<PublishOptions>;
}

export function registerWriteRoute(app: import('express').Express, config: Config): void {
  app.post('/api/write', async (req: Request, res: Response) => {
    const body = req.body as WriteRequestBody | undefined;
    if (!body || !Array.isArray(body.files) || !Array.isArray(body.baseline)) {
      res.status(400).json({
        success: false,
        publishedFiles: [],
        backupDir: '',
        conflicts: [],
        error: 'invalid_body: files and baseline must be arrays',
      } satisfies PublishResult);
      return;
    }

    // 备份目录使用 config.backupPath（绝对路径），转换为相对 workspaceRoot 的相对路径
    // 以便 atomic-publisher 在 workspaceRoot 下统一解析路径
    const backupDirRel = relativePath(config.workspaceRoot, config.backupPath) ?? '.backups';

    const options: PublishOptions = {
      workspaceRoot: config.workspaceRoot,
      keepBackups: body.options?.keepBackups,
      backupDir: backupDirRel,
      // P3 §4.7.1 step 6：发布前对 PHP 文件执行 `php -l` 语法检查
      // TS 文件检查在 P5 完整管道中实现（vue-tsc 需要完整项目上下文）
      prePublishCheck: runPrePublishPhpLint,
    };

    try {
      // 发布期间暂停 file-watcher，避免自身写入触发 file:changed 事件
      const result = await withWatcherPaused(() =>
        publishFiles(body.files, body.baseline, options),
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        publishedFiles: [],
        backupDir: '',
        conflicts: [],
        error: `internal_error: ${message}`,
      } satisfies PublishResult);
    }
  });
}

/**
 * 计算absPath 相对于 workspaceRoot 的相对路径。
 *
 * 如果 absPath 不在 workspaceRoot 下（跨卷或越界），返回 null。
 */
function relativePath(workspaceRoot: string, absPath: string): string | null {
  const rel = path.relative(workspaceRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}
