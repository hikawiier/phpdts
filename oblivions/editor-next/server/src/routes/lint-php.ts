//
// O-1 Workspace Gateway PHP 语法检查路由
//
// POST /api/lint-php  body: { filePath?: string } | { content?: string }
//
// 调用 `php -l`（仅语法检查，不执行业务代码）。
// - filePath 模式：路径必须位于 workspaceRoot 内（越界 403），写入临时文件后 lint
// - content 模式：直接写入临时文件后 lint
//
// @module O 内容工具箱
//

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { Config } from '../config';
import { resolveWorkspacePath } from '../config';
import { runPhpLint } from '../services/php-lint-service';

export interface LintPhpRequest {
  filePath?: string;
  content?: string;
}

export interface LintPhpResponse {
  ok: boolean;
  output: string;
  error?: string;
}

export function registerLintPhpRoute(app: import('express').Express, config: Config): void {
  app.post('/api/lint-php', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LintPhpRequest;
    const { filePath, content } = body;

    let targetFile: string | null = null;
    let cleanupTemp: (() => void) | null = null;

    try {
      if (typeof filePath === 'string' && filePath.length > 0) {
        const absPath = resolveWorkspacePath(config.workspaceRoot, filePath);
        if (!absPath) {
          res.status(403).json({ ok: false, output: '', error: 'path outside workspace' });
          return;
        }
        targetFile = absPath;
      } else if (typeof content === 'string' && content.length > 0) {
        // 写入系统临时目录（OS 自动清理），不污染工作区
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `oblivions-lint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.php`);
        fs.writeFileSync(tmpFile, content, 'utf8');
        targetFile = tmpFile;
        cleanupTemp = () => {
          try {
            fs.unlinkSync(tmpFile);
          } catch {
            // 忽略清理失败
          }
        };
      } else {
        res.status(400).json({ ok: false, output: '', error: 'both filePath and content are empty' });
        return;
      }

      const { code, output } = runPhpLint(targetFile);
      // php -l 成功时退出码 0，输出 "No syntax errors detected"
      const ok = code === 0;
      const resp: LintPhpResponse = ok
        ? { ok: true, output }
        : { ok: false, output, error: `php -l exited with code ${code}` };
      res.json(resp);
    } finally {
      if (cleanupTemp) cleanupTemp();
    }
  });
}
