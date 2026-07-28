//
// O-1 Workspace Gateway 健康检查路由
//
// @module O 内容工具箱
//

import type { Request, Response } from 'express';
import type { Config } from '../config';

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  workspaceRoot: string;
  gamedataPath: string;
}

const startedAt = Date.now();

export function registerHealthRoute(app: import('express').Express, config: Config): void {
  app.get('/api/health', (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      workspaceRoot: config.workspaceRoot,
      gamedataPath: config.gamedataPath,
    };
    res.json(body);
  });
}
