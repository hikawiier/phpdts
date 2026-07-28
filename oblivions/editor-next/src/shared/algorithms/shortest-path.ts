// @module O 内容工具箱
//
// 最短路径 BFS（带前驱回溯）
//
// 用于路径预览（hover 任意格 → 显示从 playerPos 到该格的最短路径）
// 地图规模小（≤254 格/区域），无需 A*；BFS 记录前驱节点回溯即可。
//
// 与 reachability.ts 的区别：
//   - reachability.ts 只算距离，不记录路径
//   - shortest-path.ts 记录前驱节点，可回溯完整路径
//
// 移动规则对齐 move.func.php obl_get_distance：只走 passable=true 的格。
// 设计案 §3.3.2：路径线渲染为 SVG（绿色 #88ff88，唯一强调色场景）。

import type { Pls, Tile } from '../types/map';

/**
 * 最短路径计算结果
 */
export interface ShortestPathResult {
  distance: number; // -1 表示不可达
  path: Pls[]; // 含起点和终点；不可达时为空数组
}

/**
 * 计算从 from 到 to 的最短路径（BFS + 前驱回溯）
 *
 * @param tiles 区域 tiles 字典
 * @param from   起始 pls
 * @param to     目标 pls
 */
export function findShortestPath(
  tiles: Record<Pls, Tile>,
  from: Pls,
  to: Pls,
): ShortestPathResult {
  const fromKey = Number(from);
  const toKey = Number(to);
  if (fromKey === toKey) return { distance: 0, path: [fromKey] };
  if (!tiles[fromKey] || !tiles[toKey]) return { distance: -1, path: [] };

  // 前驱节点表：Map<Pls, Pls | null>
  const predecessor = new Map<Pls, Pls | null>();
  predecessor.set(fromKey, null);

  const visited = new Set<Pls>([fromKey]);
  const queue: Array<[Pls, number]> = [[fromKey, 0]];

  while (queue.length > 0) {
    const [cur, dist] = queue.shift()!;
    const curTile = tiles[cur];
    if (!curTile) continue;
    const neighbors = curTile.neighbors ?? [];
    for (const nPls of neighbors) {
      const n = Number(nPls);
      if (visited.has(n)) continue;
      // 与 obl_get_distance 一致：只走 passable=true
      const nTile = tiles[n];
      if (!nTile || !nTile.passable) continue;
      visited.add(n);
      predecessor.set(n, cur);
      if (n === toKey) {
        // 命中目标 → 回溯路径
        return {
          distance: dist + 1,
          path: reconstructPath(predecessor, fromKey, toKey),
        };
      }
      queue.push([n, dist + 1]);
    }
  }

  return { distance: -1, path: [] };
}

/**
 * 从前驱表回溯完整路径
 *
 * @param predecessor Map<Pls, prevPls | null>
 * @param from
 * @param to
 * @returns 路径 pls 列表（含起点和终点）
 */
function reconstructPath(
  predecessor: Map<Pls, Pls | null>,
  from: Pls,
  to: Pls,
): Pls[] {
  const path: Pls[] = [];
  let cur: Pls | null = to;
  // 安全上限防止循环引用导致死循环
  let safety = 0;
  while (cur !== null && safety < 1000) {
    path.unshift(cur);
    if (cur === from) break;
    cur = predecessor.get(cur) ?? null;
    safety++;
  }
  return path;
}
