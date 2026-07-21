//
// 性能基准测试（对齐 NEW_DESIGN.md §7.3 M3 验收标准）
//
// 验收要求：
//   - 10000 格地图主线程解析 < 500ms
//   - 大地图（>= LARGE_MAP_THRESHOLD）走 Worker 非阻塞
//   - Worker 超时/失败回退主线程
//
// 注：性能基准为相对值（受运行机器影响），这里用宽松阈值确保 CI 稳定
//     本地开发机典型值：10000 格主线程解析 ~50-100ms

import { describe, it, expect, vi } from 'vitest';
import {
  parseOnMainThread,
  shouldUseWorker,
  LARGE_MAP_THRESHOLD,
  PhpParserBridge,
} from '@/services/worker-bridge';
import {
  parsePhpArray,
  generateMapPhp,
  generateRegionPhp,
  type MapProject,
  type Pgroup,
  type Pls,
  type Tile,
  type Region,
  type Grid,
} from '@/shared';
import type { FileEntry } from '@/services/file-io';

// ─── 测试用大地图生成器 ───────────────────────────────────────

interface LargeMapData {
  project: MapProject;
  mapPhp: string;
  regionFiles: FileEntry[];
  totalCells: number;
}

/**
 * 生成大地图测试数据
 *
 * @param totalCells 目标格数（如 10000）
 * @returns project + 序列化后的 PHP 文件
 */
function generateLargeMap(totalCells: number): LargeMapData {
  const regions: Record<Pgroup, Region> = {};
  const grids: Record<Pgroup, Grid> = {};
  const tiles: Record<Pgroup, Record<Pls, Tile>> = {};

  // 按 100 格/区域分配，生成 totalCells/100 个区域
  const cellsPerRegion = 100;
  const regionCount = Math.ceil(totalCells / cellsPerRegion);
  let remainingCells = totalCells;

  for (let r = 1; r <= regionCount; r++) {
    const pgroup = r as Pgroup;
    const cols = 10;
    const rows = 10;
    regions[pgroup] = {
      name: `区域${r}`,
      desc: '',
      entrance_pls: null,
      exit_pls: null,
      next_region: r < regionCount ? ((r + 1) as Pgroup) : null,
      prev_region: r > 1 ? ((r - 1) as Pgroup) : null,
      exit_links: [],
      cols,
      rows,
    };
    grids[pgroup] = { cols, rows };
    tiles[pgroup] = {} as Record<Pls, Tile>;

    const cellsInThisRegion = Math.min(cellsPerRegion, remainingCells);
    for (let i = 1; i <= cellsInThisRegion; i++) {
      const pls = i as Pls;
      const x = (i - 1) % cols;
      const y = Math.floor((i - 1) / cols);
      tiles[pgroup][pls] = {
        name: `tile_${r}_${i}`,
        desc: '',
        floor: 'standard',
        tide: 'shallow',
        height: i % 5,
        passable: true,
        destructible: i % 3 === 0,
        neighbors: i > 1 ? [(i - 1) as Pls] : [],
        x,
        y,
        preset_safe: i % 7 === 0,
        _breaks: [],
      };
    }
    remainingCells -= cellsInThisRegion;
  }

  const project: MapProject = { regions, grids, tiles };
  const mapPhp = generateMapPhp(regions, grids);
  const regionFiles: FileEntry[] = [];
  for (const pgroupKey of Object.keys(tiles)) {
    const pgroup = Number(pgroupKey) as Pgroup;
    const regionTiles = tiles[pgroup];
    if (!regionTiles) continue;
    const php = generateRegionPhp(pgroup, regionTiles);
    regionFiles.push({ path: `tiles/region_${pgroup}.php`, content: php });
  }

  return { project, mapPhp, regionFiles, totalCells };
}

// ─── 性能基准测试 ─────────────────────────────────────────────

describe('M3 性能基准（对齐 NEW_DESIGN.md §7.3）', () => {
  it('10000 格地图生成测试数据 < 200ms', () => {
    const start = performance.now();
    const data = generateLargeMap(10_000);
    const elapsed = performance.now() - start;
    expect(data.totalCells).toBe(10_000);
    expect(Object.keys(data.project.regions)).toHaveLength(100);
    expect(data.regionFiles).toHaveLength(100);
    // 生成 + 序列化应在 200ms 内（含 map.php + 100 个 region_*.php）
    expect(elapsed).toBeLessThan(200);
  });

  it('10000 格地图 shouldUseWorker 返回 true（触发 Worker 路径）', () => {
    expect(shouldUseWorker(10_000)).toBe(true);
    expect(LARGE_MAP_THRESHOLD).toBe(10_000);
  });

  it('10000 格地图主线程 parseOnMainThread < 500ms（单 region_*.php）', () => {
    const data = generateLargeMap(10_000);
    // 取最大的 region_*.php（100 格）解析
    const largestRegion = data.regionFiles[0]!;
    const start = performance.now();
    const result = parseOnMainThread(largestRegion.content);
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it('10000 格地图主线程解析全部 region_*.php < 500ms', () => {
    const data = generateLargeMap(10_000);
    const start = performance.now();
    for (const file of data.regionFiles) {
      const result = parsePhpArray(file.content);
      if (!result.ok) {
        throw new Error(`parse failed for ${file.path}`);
      }
    }
    const elapsed = performance.now() - start;
    // 100 个 region_*.php（每个 100 格）总解析时间 < 500ms
    expect(elapsed).toBeLessThan(500);
  });

  it('10000 格地图 map.php 解析 < 100ms', () => {
    const data = generateLargeMap(10_000);
    const start = performance.now();
    const result = parseOnMainThread(data.mapPhp);
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });

  it('Worker 路径非阻塞：parseFiles 在 Worker 中执行不阻塞主线程', async () => {
    // 用 mock worker 模拟非阻塞：postMessage 后立即返回，主线程可继续执行
    const data = generateLargeMap(10_000);
    const listeners: Array<(event: MessageEvent) => void> = [];
    const worker = {
      addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
        if (type === 'message') listeners.push(handler as (event: MessageEvent) => void);
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn((request: unknown) => {
        // 模拟 Worker 异步处理：将解析工作放到 microtask 队列，
        // postMessage 本身立即返回（仅记录 id），不阻塞主线程
        const req = request as { id: number; type: string; payload: FileEntry[] };
        Promise.resolve().then(() => {
          // 这部分在 microtask 中执行，模拟 Worker 线程
          const results: Record<string, unknown> = {};
          for (const e of req.payload) {
            results[e.path] = parsePhpArray(e.content);
          }
          listeners.forEach((l) =>
            l({ data: { id: req.id, ok: true, data: results } } as MessageEvent),
          );
        });
      }),
      terminate: vi.fn(),
    } as unknown as Worker;

    const bridge = new PhpParserBridge(worker);
    const start = performance.now();
    // 主线程发起 parseFiles 后立即返回 Promise，不阻塞
    const promise = bridge.parseFiles(data.regionFiles);
    // 主线程立即执行此断言（Worker 未响应前）
    const mainThreadElapsed = performance.now() - start;
    // postMessage 仅做 Promise 排程，应 < 20ms（宽松阈值兼容慢机/CI）
    expect(mainThreadElapsed).toBeLessThan(20);

    const results = await promise;
    expect(Object.keys(results)).toHaveLength(100);
    bridge.terminate();
  });

  it('Worker 超时回退主线程：10000 格地图仍能在 1s 内完成解析', async () => {
    const data = generateLargeMap(10_000);
    // mock worker 不响应，触发超时回退
    const worker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker;

    const bridge = new PhpParserBridge(worker);
    const start = performance.now();
    // timeoutMs=100，超时后回退主线程逐个解析
    const results = await bridge.parseFiles(data.regionFiles, { timeoutMs: 100 });
    const elapsed = performance.now() - start;
    expect(Object.keys(results)).toHaveLength(100);
    // 超时 100ms + 主线程解析 < 500ms，总计 < 1000ms
    expect(elapsed).toBeLessThan(1000);
    bridge.terminate();
  });

  it('Worker 失败回退主线程：parsePhp 返回主线程解析结果', async () => {
    // mock worker 立即响应 ok=false
    const listeners: Array<(event: MessageEvent) => void> = [];
    const worker = {
      addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
        if (type === 'message') listeners.push(handler as (event: MessageEvent) => void);
      }),
      removeEventListener: vi.fn(),
      postMessage: vi.fn((request: unknown) => {
        const req = request as { id: number };
        Promise.resolve().then(() => {
          listeners.forEach((l) =>
            l({ data: { id: req.id, ok: false, error: 'simulated worker failure' } } as MessageEvent),
          );
        });
      }),
      terminate: vi.fn(),
    } as unknown as Worker;

    const bridge = new PhpParserBridge(worker);
    const data = generateLargeMap(1_000);
    const largestRegion = data.regionFiles[0]!;
    const result = await bridge.parsePhp(largestRegion.content);
    // 回退主线程后应返回真实解析结果
    expect(result.ok).toBe(true);
    bridge.terminate();
  });

  it('round-trip：生成 → 解析 → 生成 一致性（10000 格）', () => {
    const data = generateLargeMap(10_000);
    // 1. 解析所有 region_*.php
    const parsed: Record<string, Record<Pls, Tile>> = {};
    for (const file of data.regionFiles) {
      const result = parsePhpArray(file.content);
      expect(result.ok).toBe(true);
      const pgroup = Number(file.path.match(/region_(\d+)\.php/)?.[1]) as Pgroup;
      parsed[pgroup] = result.value as unknown as Record<Pls, Tile>;
    }
    // 2. 重新生成
    const regeneratedFiles: FileEntry[] = [];
    for (const pgroupKey of Object.keys(parsed)) {
      const pgroup = Number(pgroupKey) as Pgroup;
      const tiles = parsed[pgroup];
      if (!tiles) continue;
      const php = generateRegionPhp(pgroup, tiles);
      regeneratedFiles.push({ path: `tiles/region_${pgroup}.php`, content: php });
    }
    // 3. 比较文件数量一致
    expect(regeneratedFiles).toHaveLength(data.regionFiles.length);
    // 4. 重新解析后 tiles 数量一致
    for (const file of regeneratedFiles) {
      const result = parsePhpArray(file.content);
      expect(result.ok).toBe(true);
      const tiles = result.value as unknown as Record<Pls, Tile>;
      const pgroup = Number(file.path.match(/region_(\d+)\.php/)?.[1]) as Pgroup;
      const originalTiles = data.project.tiles[pgroup];
      const originalCount = originalTiles ? Object.keys(originalTiles).length : 0;
      expect(Object.keys(tiles).length).toBe(originalCount);
    }
  });
});
