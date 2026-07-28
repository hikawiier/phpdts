// @module O 内容工具箱
//
// 可达性 BFS（移植自后端 move.func.php obl_get_distance，@framework E-3 基于图的移动系统）
// 算法语义保持一致：BFS 只走 passable=true 的格，返回最短距离或 -1。
//
// 与后端差异：
//   - 后端读 obl_get_map_data（DB + 文件）
//   - 前端读内存 tiles
//   - 纯函数，无副作用

import type { Pls, Tile } from '../types/map';

/**
 * 可达性 BFS 计算结果：Map<Pls, distance>
 */
export type ReachabilityResult = Map<Pls, number>;

/**
 * 计算同区域内两格之间的最短路径距离（BFS）
 *
 * @param tiles 区域 tiles 字典
 * @param from   起始 pls
 * @param to     目标 pls
 * @returns 最短路径长度（边数），不可达返回 -1
 */
export function getDistance(
  tiles: Record<Pls, Tile>,
  from: Pls,
  to: Pls,
): number {
  const fromKey = Number(from);
  const toKey = Number(to);
  if (fromKey === toKey) return 0;
  if (!tiles[fromKey] || !tiles[toKey]) return -1;

  const visited = new Set<Pls>([fromKey]);
  const queue: Array<[Pls, number]> = [[fromKey, 0]];

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!;
    const curTile = tiles[current];
    if (!curTile) continue;
    const neighbors = curTile.neighbors ?? [];
    for (const neighbor of neighbors) {
      const n = Number(neighbor);
      if (n === toKey) return dist + 1;
      if (visited.has(n)) continue;
      const nTile = tiles[n];
      if (!nTile || !nTile.passable) continue;
      visited.add(n);
      queue.push([n, dist + 1]);
    }
  }
  return -1;
}

/**
 * 计算从起始格出发 movePower 步内可达的所有格及其距离
 *
 * 用于可达性热图叠层（OverlayReachability.vue）。
 * 与 getDistance 的区别：返回所有可达格，而非单点距离。
 *
 * @param tiles
 * @param from
 * @param movePower  移动力（BFS 跳数，对齐 obl_get_move_power）
 * @returns 距离 Map（key=pls, value=distance），空 Map 表示起始格无效
 */
export function calcReachableTiles(
  tiles: Record<Pls, Tile>,
  from: Pls,
  movePower: number,
): ReachabilityResult {
  const result: ReachabilityResult = new Map();
  const fromKey = Number(from);
  if (!tiles[fromKey]) return result;

  const visited = new Set<Pls>([fromKey]);
  result.set(fromKey, 0);

  const queue: Array<[Pls, number]> = [[fromKey, 0]];

  while (queue.length > 0) {
    const [cur, dist] = queue.shift()!;
    if (dist >= movePower) continue;

    const curTile = tiles[cur];
    if (!curTile) continue;
    const neighbors = curTile.neighbors ?? [];
    for (const nPls of neighbors) {
      const nKey = Number(nPls);
      if (visited.has(nKey)) continue;
      // 与 obl_get_distance 一致：只走 passable=true
      const nTile = tiles[nKey];
      if (!nTile || !nTile.passable) continue;
      visited.add(nKey);
      result.set(nKey, dist + 1);
      queue.push([nKey, dist + 1]);
    }
  }

  return result;
}
