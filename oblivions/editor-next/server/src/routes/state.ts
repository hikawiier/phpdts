//
// O-1 Workspace Gateway 后端 State API 只读代理
//
// @module O 内容工具箱
// @framework O-1 Workspace Gateway
// @framework O-12 运行时镜像校验
//

import type { Request, Response } from 'express';
import type { Config } from '../config';

const STATE_API_URL = 'http://127.0.0.1/phpdts/oblivions/api/state.php';
const FETCH_TIMEOUT_MS = 5000;

const ALLOWED_SCOPES = new Set([
  'game_map',
  'enemies',
  'player_inventory',
  'craft_preview',
  'craft_recipes',
  'debug_poi_all',
  'debug_player_full',
  'debug_gamevars',
  'debug_diag_log',
]);

function getSingleQueryValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function buildStateApiUrl(req: Request): URL | null {
  const scope = getSingleQueryValue(req.query.scope);
  if (scope === null || !ALLOWED_SCOPES.has(scope)) {
    return null;
  }

  const url = new URL(STATE_API_URL);
  url.searchParams.set('scope', scope);

  const debug = getSingleQueryValue(req.query.debug);
  if (debug === 'all') {
    url.searchParams.set('debug', 'all');
  }

  const category = getSingleQueryValue(req.query.category);
  if (category !== null) {
    url.searchParams.set('category', category);
  }

  const lines = getSingleQueryValue(req.query.lines);
  if (lines !== null) {
    url.searchParams.set('lines', lines);
  }

  const slots = getSingleQueryValue(req.query.slots);
  if (scope === 'craft_preview' && slots !== null) {
    url.searchParams.set('slots', slots);
  }

  const workbenchMaterials = getSingleQueryValue(req.query.workbench_materials);
  if (scope === 'craft_preview' && workbenchMaterials !== null) {
    url.searchParams.set('workbench_materials', workbenchMaterials);
  }

  return url;
}

export function registerStateRoute(app: import('express').Express, _config: Config): void {
  app.get('/api/state', async (req: Request, res: Response) => {
    const url = buildStateApiUrl(req);
    if (url === null) {
      res.status(400).json({
        status: 'error',
        error: 'INVALID_STATE_SCOPE',
        message: 'scope is required and must be an allowed State API scope',
      });
      return;
    }

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (typeof req.headers.cookie === 'string' && req.headers.cookie.length > 0) {
        headers.Cookie = req.headers.cookie;
      }

      const upstream = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const contentType = upstream.headers.get('content-type') ?? '';
      const text = await upstream.text();
      res.status(upstream.status);
      if (contentType.includes('application/json')) {
        res.type('application/json').send(text);
        return;
      }
      res.json({
        status: upstream.ok ? 'success' : 'error',
        upstreamStatus: upstream.status,
        body: text,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        status: 'error',
        error: 'STATE_API_UNAVAILABLE',
        message,
      });
    }
  });
}
