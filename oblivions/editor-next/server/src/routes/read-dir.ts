//
// O-1 Workspace Gateway 目录列举路由
//
// GET /api/read-dir?path=<relPath>&recursive=false
//
// @module O 内容工具箱
//

import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { Config } from '../config';
import { resolveWorkspacePath } from '../config';

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

export function registerReadDirRoute(app: import('express').Express, config: Config): void {
  app.get('/api/read-dir', (req: Request, res: Response) => {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const recursive = req.query.recursive === 'true';
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
          res.status(404).json({ error: 'dir not found' });
        } else {
          res.status(500).json({ error: statErr.message });
        }
        return;
      }
      if (!stat.isDirectory()) {
        res.status(400).json({ error: 'not a directory' });
        return;
      }

      const entries: DirEntry[] = [];
      const walk = (dirAbs: string, cb: (err: NodeJS.ErrnoException | null) => void): void => {
        fs.readdir(dirAbs, { withFileTypes: true }, (readdirErr, dirents) => {
          if (readdirErr) {
            cb(readdirErr);
            return;
          }
          let pending = dirents.length;
          if (pending === 0) {
            cb(null);
            return;
          }
          const next = (): void => {
            pending -= 1;
            if (pending === 0) cb(null);
          };
          for (const dirent of dirents) {
            // 跳过备份目录与 node_modules（与 file-watcher 一致）
            if (dirent.name === '.backups' || dirent.name === 'node_modules') {
              next();
              continue;
            }
            const childAbs = path.join(dirAbs, dirent.name);
            if (dirent.isFile()) {
              fs.stat(childAbs, (eStatErr, cStat) => {
                if (eStatErr) {
                  entries.push({ name: dirent.name, type: 'file' });
                } else {
                  entries.push({
                    name: dirent.name,
                    type: 'file',
                    size: cStat.size,
                    mtime: Math.floor(cStat.mtimeMs),
                  });
                }
                next();
              });
            } else if (dirent.isDirectory()) {
              entries.push({ name: dirent.name, type: 'dir' });
              if (recursive) {
                walk(childAbs, next);
              } else {
                next();
              }
            } else {
              // 符号链接等其他类型，按目录处理跳过递归
              next();
            }
          }
        });
      };

      walk(absPath, (err) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        const body: ReadDirResponse = { path: relPath, entries };
        res.json(body);
      });
    });
  });
}
