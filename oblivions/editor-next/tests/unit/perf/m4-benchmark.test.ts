//
// M4 性能基准测试（对齐 NEW_DESIGN.md §7.3 M4 验收标准）
//
// 验收要求：
//   - 254 格地图 vision_range=1/3/5 BFS 计算 < 16ms
//   - calcVisionRange / calcReachableTiles / findShortestPath 三算法同步计算 < 5ms（254 格上限）
//   - simStore.recomputeBfs（视野+可达性+感知+雾覆盖+路径预览）整体 < 20ms
//
// 注：性能基准为相对值（受运行机器影响），用宽松阈值确保 CI 稳定。
//     本地开发机典型值：254 格 BFS < 1ms，整体 recomputeBfs < 3ms。
//     阈值留 3-5x 余量兼容慢机/CI。

import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  calcVisionRange,
  calcReachableTiles,
  calcEnemySenseRange,
  findShortestPath,
} from '@/shared';
import { PLS_MAX } from '@/shared';
import { useSimStore } from '@/stores/simStore';
import type { Pls, Tile, Pgroup } from '@/shared';

// ─── 测试用 254 格连通地图生成器 ─────────────────────────────────

/**
 * 生成全连通 254 格地图
 *
 * 布局：16x16 网格 = 256，取前 254 格（对齐 PLS_MAX=254）
 * 连通：4 邻接（上下左右），保证 BFS 可全图扩展
 * passable：全 true，让 BFS 不受阻挡（最坏情况是扩展到所有格）
 *
 * @param options.passablePattern 'all' | 'mixed' 控制通行性分布
 */
function generateFullMap254(
  options: { passablePattern?: 'all' | 'mixed' } = {},
): Record<Pls, Tile> {
  const { passablePattern = 'all' } = options;
  const tiles: Record<Pls, Tile> = {};
  const cols = 16;
  // 行数自适应：254 格 / 16 cols ≈ 16 行
  const rows = Math.ceil(254 / cols);

  // 先建立 pls → (x,y) 索引
  const coordToPls = new Map<string, Pls>();
  const plsToCoord: Array<{ x: number; y: number }> = [];
  let plsCounter = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      plsCounter++;
      if (plsCounter > PLS_MAX) break;
      const pls = plsCounter as Pls;
      coordToPls.set(`${x},${y}`, pls);
      plsToCoord.push({ x, y });
    }
    if (plsCounter > PLS_MAX) break;
  }

  // 建立 4 邻接
  for (let i = 0; i < plsToCoord.length; i++) {
    const pls = (i + 1) as Pls;
    const { x, y } = plsToCoord[i]!;
    const neighbors: Pls[] = [];
    // 上 (x, y-1)
    const up = coordToPls.get(`${x},${y - 1}`);
    if (up !== undefined) neighbors.push(up);
    // 下 (x, y+1)
    const down = coordToPls.get(`${x},${y + 1}`);
    if (down !== undefined) neighbors.push(down);
    // 左 (x-1, y)
    const left = coordToPls.get(`${x - 1},${y}`);
    if (left !== undefined) neighbors.push(left);
    // 右 (x+1, y)
    const right = coordToPls.get(`${x + 1},${y}`);
    if (right !== undefined) neighbors.push(right);

    // mixed 模式：约 1/5 格不可通行（不破坏整体连通，仅取偶数 pls % 5 !== 0）
    const passable =
      passablePattern === 'all'
        ? true
        : pls % 5 !== 0;

    tiles[pls] = {
      name: `tile_${pls}`,
      desc: '',
      floor: 'standard',
      tide: 'shallow',
      height: 0,
      passable,
      destructible: false,
      neighbors,
      x,
      y,
      preset_safe: false,
      _breaks: [],
    };
  }

  return tiles;
}

// ─── M4 性能基准 ─────────────────────────────────────────────────

describe('M4 性能基准（对齐 NEW_DESIGN.md §7.3）', () => {
  const fullMap = generateFullMap254({ passablePattern: 'all' });
  const fullMapMixed = generateFullMap254({ passablePattern: 'mixed' });
  const playerPls = 128 as Pls; // 地图中心附近

  // ─── 单算法基准 ───────────────────────────────────────────────

  it('254 格全连通地图 vision_range=1 < 16ms', () => {
    const start = performance.now();
    const result = calcVisionRange(fullMap, playerPls, 1);
    const elapsed = performance.now() - start;
    // 玩家自身 + 4 邻接 = 5 格
    expect(result.size).toBeGreaterThanOrEqual(1);
    expect(elapsed).toBeLessThan(16);
  });

  it('254 格全连通地图 vision_range=3 < 16ms', () => {
    const start = performance.now();
    const result = calcVisionRange(fullMap, playerPls, 3);
    const elapsed = performance.now() - start;
    expect(result.size).toBeGreaterThan(5); // 比 vision_range=1 多
    expect(elapsed).toBeLessThan(16);
  });

  it('254 格全连通地图 vision_range=5 < 16ms', () => {
    const start = performance.now();
    const result = calcVisionRange(fullMap, playerPls, 5);
    const elapsed = performance.now() - start;
    expect(result.size).toBeGreaterThan(10); // 比 vision_range=3 多
    expect(elapsed).toBeLessThan(16);
  });

  it('254 格混合 passable 地图 vision_range=5 < 16ms（含阻挡场景）', () => {
    const start = performance.now();
    const result = calcVisionRange(fullMapMixed, playerPls, 5);
    const elapsed = performance.now() - start;
    expect(result.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(16);
  });

  it('calcReachableTiles movePower=3 < 5ms（254 格）', () => {
    const start = performance.now();
    const result = calcReachableTiles(fullMap, playerPls, 3);
    const elapsed = performance.now() - start;
    expect(result.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });

  it('calcReachableTiles movePower=10 < 5ms（254 格，最远扩展）', () => {
    const start = performance.now();
    const result = calcReachableTiles(fullMap, playerPls, 10);
    const elapsed = performance.now() - start;
    expect(result.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });

  it('calcEnemySenseRange senseRange=5 < 5ms（254 格，无视 passable）', () => {
    const start = performance.now();
    const result = calcEnemySenseRange(fullMapMixed, playerPls, 5);
    const elapsed = performance.now() - start;
    expect(result.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });

  it('findShortestPath 距离 5 < 5ms（254 格）', () => {
    // 取距离玩家约 5 步的格（128 → 133）
    const targetPls = 133 as Pls;
    const start = performance.now();
    const result = findShortestPath(fullMap, playerPls, targetPls);
    const elapsed = performance.now() - start;
    expect(result.distance).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });

  it('findShortestPath 跨地图最远距离 < 5ms（254 格，BFS 全图扫描）', () => {
    // 128 → 1（左上角），路径最长
    const targetPls = 1 as Pls;
    const start = performance.now();
    const result = findShortestPath(fullMap, playerPls, targetPls);
    const elapsed = performance.now() - start;
    expect(result.distance).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });

  // ─── 三算法合并基准 ─────────────────────────────────────────

  it('三算法（vision+reachability+sense）顺序计算 < 16ms（254 格）', () => {
    const start = performance.now();
    calcVisionRange(fullMap, playerPls, 5);
    calcReachableTiles(fullMap, playerPls, 10);
    calcEnemySenseRange(fullMap, playerPls, 5);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(16);
  });

  // ─── simStore.recomputeBfs 整体基准 ─────────────────────────

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('simStore.recomputeBfs 整体 < 20ms（254 格，含 vision+reachability+sense+雾覆盖）', () => {
    const sim = useSimStore();
    sim.setPlayerPos(1 as Pgroup, playerPls);
    const start = performance.now();
    sim.recomputeBfs(fullMap);
    const elapsed = performance.now() - start;
    expect(sim.visionResult.size).toBeGreaterThan(0);
    expect(sim.reachabilityResult.size).toBeGreaterThan(0);
    expect(sim.enemySenseResult.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(20);
  });

  it('simStore.recomputeBfs 含路径预览 < 25ms（254 格，最远距离）', () => {
    const sim = useSimStore();
    sim.setPlayerPos(1 as Pgroup, playerPls);
    sim.setHoverTarget(fullMap, 1 as Pls); // 最远距离
    const start = performance.now();
    sim.recomputeBfs(fullMap);
    const elapsed = performance.now() - start;
    expect(sim.pathPreview.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(25);
  });

  it('多次连续 recomputeBfs 累计 < 80ms（5 次重算，模拟用户调整滑块）', () => {
    const sim = useSimStore();
    sim.setPlayerPos(1 as Pgroup, playerPls);
    const start = performance.now();
    for (let i = 1; i <= 5; i++) {
      sim.updateConfig({ visionRange: i });
      sim.recomputeBfs(fullMap);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(80);
  });

  it('254 格地图反复 simulateExplore < 100ms（5 次探索）', () => {
    const sim = useSimStore();
    sim.setPlayerPos(1 as Pgroup, playerPls);
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      sim.simulateExplore(fullMap);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  // ─── 极端场景基准 ───────────────────────────────────────────

  it('无玩家位置时 recomputeBfs < 1ms（快速返回空）', () => {
    const sim = useSimStore();
    // 不调用 setPlayerPos
    const start = performance.now();
    sim.recomputeBfs(fullMap);
    const elapsed = performance.now() - start;
    expect(sim.visionResult.size).toBe(0);
    expect(elapsed).toBeLessThan(1);
  });

  it('玩家位置无效时 recomputeBfs < 1ms（快速返回空）', () => {
    const sim = useSimStore();
    sim.setPlayerPos(1 as Pgroup, 9999 as Pls); // 不存在的 pls
    const start = performance.now();
    sim.recomputeBfs(fullMap);
    const elapsed = performance.now() - start;
    expect(sim.visionResult.size).toBe(0);
    expect(elapsed).toBeLessThan(1);
  });

  it('vision_range=0 时只返回玩家格本身 < 16ms（边界场景）', () => {
    const start = performance.now();
    const result = calcVisionRange(fullMap, playerPls, 0);
    const elapsed = performance.now() - start;
    expect(result.size).toBe(1);
    expect(result.get(playerPls)).toBe(0);
    expect(elapsed).toBeLessThan(16);
  });
});
