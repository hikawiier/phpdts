//
// O-1 Workspace Gateway TS locale 解析路由（占位）
//
// POST /api/parse-ts-locale  body: { filePath?: string; content?: string }
//
// P0-D 任务实现 ts-locale-adapter 后接入。本任务仅返回 501 Not Implemented。
//
// @module O 内容工具箱
//

import type { Request, Response } from 'express';
import type { Config } from '../config';

export function registerParseTsLocaleRoute(app: import('express').Express, _config: Config): void {
  app.post('/api/parse-ts-locale', (_req: Request, res: Response) => {
    res.status(501).json({
      ok: false,
      error: 'parse-ts-locale not implemented (planned in P0-D)',
    });
  });
}
