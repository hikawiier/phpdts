//
// O-1 Workspace Gateway 文件读取路由
//
// GET /api/read?path=<relPath>
//
// @module O 内容工具箱
//

import fs from 'node:fs';
import type { Request, Response } from 'express';
import type { Config } from '../config';
import { resolveWorkspacePath } from '../config';

export interface ReadResponse {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export function registerReadRoute(app: import('express').Express, config: Config): void {
  app.get('/api/read', (req: Request, res: Response) => {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!relPath) {
      res.status(400).json({ error: 'missing path' });
      return;
    }

    const absPath = resolveWorkspacePath(config.workspaceRoot, relPath);
    if (!absPath) {
      res.status(403).json({ error: 'path outside workspace' });
      return;
    }

    fs.stat(absPath, (statErr, stat) => {
      if (statErr) {
        if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
          res.status(404).json({ error: 'file not found' });
        } else {
          res.status(500).json({ error: statErr.message });
        }
        return;
      }
      if (!stat.isFile()) {
        res.status(400).json({ error: 'not a file' });
        return;
      }
      fs.readFile(absPath, 'utf8', (readErr, content) => {
        if (readErr) {
          res.status(500).json({ error: readErr.message });
          return;
        }
        const body: ReadResponse = {
          path: relPath,
          content,
          mtime: Math.floor(stat.mtimeMs),
          size: stat.size,
        };
        res.json(body);
      });
    });
  });
}
