//
// O-1 Workspace Gateway PHP 解析路由
//
// POST /api/parse-php  body: { filePath?: string; content?: string }
//
// content 为空时从 filePath 读取。两个都为空返回 400。
// 解析调用客户端的 php-array-parser（共享源码）。
//
// @module O 内容工具箱
//

import fs from 'node:fs';
import type { Request, Response } from 'express';
import type { Config } from '../config';
import { resolveWorkspacePath } from '../config';
// 跨项目 import：复用 editor-next 客户端的 PHP 解析器。
// 该文件位于 editor-next/src/shared/serializer/，目录下 package.json 显式声明
// "type": "commonjs" 以覆盖 editor-next/package.json 的 "type": "module"，
// 使 Node.js（ts-node）能以 require() 加载该文件。
// Vite/vue-tsc 使用 bundler 解析，不受此 package.json 影响。
import { parsePhpArray, type PhpParseResult } from '../../../src/shared/serializer/php-array-parser';

export interface ParsePhpRequest {
  filePath?: string;
  content?: string;
}

export interface ParsePhpResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function registerParsePhpRoute(app: import('express').Express, config: Config): void {
  app.post('/api/parse-php', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ParsePhpRequest;
    const { filePath, content } = body;

    let phpCode: string | null = null;

    if (typeof content === 'string' && content.length > 0) {
      phpCode = content;
    } else if (typeof filePath === 'string' && filePath.length > 0) {
      const absPath = resolveWorkspacePath(config.workspaceRoot, filePath);
      if (!absPath) {
        res.status(403).json({ ok: false, error: 'path outside workspace' });
        return;
      }
      try {
        phpCode = fs.readFileSync(absPath, 'utf8');
      } catch (err) {
        res.status(404).json({ ok: false, error: `read failed: ${(err as Error).message}` });
        return;
      }
    }

    if (phpCode === null) {
      res.status(400).json({ ok: false, error: 'both filePath and content are empty' });
      return;
    }

    let result: PhpParseResult;
    try {
      result = parsePhpArray(phpCode);
    } catch (err) {
      res.status(200).json({ ok: false, error: `parse threw: ${(err as Error).message}` });
      return;
    }

    if (!result.ok) {
      const resp: ParsePhpResponse = { ok: false, error: result.error?.message ?? 'parse failed' };
      res.json(resp);
      return;
    }

    const resp: ParsePhpResponse = { ok: true, data: result.value };
    res.json(resp);
  });
}
