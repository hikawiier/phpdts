//
// 连通图算法：
//   - O-0 编辑器侧操作：autoConnect / breakConnection / restoreConnection / disconnectAll / getBrokenNeighbors
//   - O-3 验证工具集：detectIslands（连通性 BFS 孤岛检测）
//
// 设计案 §3.1.3：8 方向自动连通；新增格自动连接相邻 8 方向的格（若存在）。
// _breaks 字段：编辑器专用，记录断开状态；导出时剥离（php-codegen 处理）。
// 邻居对称性维护：A.neighbors 含 B ⇔ B.neighbors 含 A。

import type { Pls, Tile } from '../types/map';

/**
 * 8 方向偏移（autoConnect / getBrokenNeighbors 使用）
 */
export const EIGHT_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
] as const;

/**
 * 连通性 BFS 计算结果
 */
export interface ConnectivityResult {
  visited: Set<Pls>; // 从 entrance 出发可达的 pls 集合
  unreachable: Pls[]; // 不可达的 pls 列表（孤岛）
}

/**
 * 从 entrancePls 出发 BFS，检测不可达格（孤岛）
 *
 * 与可达性 BFS 的区别：
 *   - 可达性 BFS 受 movePower 限制（步数上限）
 *   - 连通性 BFS 不受步数限制，遍历整张图找连通分量
 *
 * @param tiles        区域 tiles 字典
 * @param entrancePls  入口 pls（null 时返回空 visited + 全部 unreachable）
 */
export function detectIslands(
  tiles: Record<Pls, Tile>,
  entrancePls: Pls | null,
): ConnectivityResult {
  const tileKeys = Object.keys(tiles).map((k) => Number(k));
  const result: ConnectivityResult = {
    visited: new Set<Pls>(),
    unreachable: [],
  };

  if (entrancePls === null || !tiles[entrancePls]) {
    result.unreachable = tileKeys;
    return result;
  }

  const visited = new Set<Pls>([entrancePls]);
  const queue: Pls[] = [entrancePls];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curTile = tiles[cur];
    if (!curTile) continue;
    const neighbors = curTile.neighbors ?? [];
    for (const nPls of neighbors) {
      const n = Number(nPls);
      if (visited.has(n)) continue;
      if (!tiles[n]) continue;
      visited.add(n);
      queue.push(n);
    }
  }

  result.visited = visited;
  result.unreachable = tileKeys.filter((pls) => !visited.has(pls));
  return result;
}

// ════════════════════════════════════════════════════════════════════
// 编辑器连通图操作（O-0）
//
// 与 Vanilla JS oblivions/editor/src/logic/connectivity.js 语义对齐：
//   - autoConnect：放置/创建格后自动建立 8 方向连通，跳过 _breaks 标记
//   - disconnectAll：删除格时清理所有邻居引用与 _breaks 引用
//   - breakConnection：手动断开 A↔B 双向连接（写入 _breaks）
//   - restoreConnection：从 _breaks 移除并恢复双向 neighbors
//   - getBrokenNeighbors：获取与指定格坐标相邻但已断开的格列表
//
// 所有操作直接修改传入的 tiles 对象（mutation），与 Vue 3 响应式系统配合使用。
// 调用方负责触发响应式更新（Pinia store 内的 ref 赋值）。
// ════════════════════════════════════════════════════════════════════

/**
 * 根据 (x, y) 坐标查找区域内的地图格 pls
 *
 * 线性扫描足够（单区域 ≤ 254 格），无需坐标索引。
 */
export function findTileByCoord(
  tiles: Record<Pls, Tile>,
  x: number,
  y: number,
): Pls | null {
  for (const pls of Object.keys(tiles)) {
    const t = tiles[Number(pls)];
    if (t && t.x === x && t.y === y) return Number(pls);
  }
  return null;
}

/**
 * 放置/创建格后自动建立 8 方向连通
 *
 * 跳过 _breaks 中标记的断开连接（编辑器先 break 再 autoConnect 时保留断开状态）。
 * 邻居对称性：A.neighbors 含 B ⇔ B.neighbors 含 A。
 *
 * @param tiles 区域 tiles 字典（会被 mutation）
 * @param pls   新增/移动后的格 pls
 */
export function autoConnect(
  tiles: Record<Pls, Tile>,
  pls: Pls,
): void {
  const tile = tiles[pls];
  if (!tile) return;
  if (!tile._breaks) tile._breaks = [];

  for (const [dx, dy] of EIGHT_DIRECTIONS) {
    const nx = tile.x + dx;
    const ny = tile.y + dy;
    const neighborPls = findTileByCoord(tiles, nx, ny);
    if (neighborPls === null) continue;
    if (neighborPls === pls) continue; // 自身

    const neighbor = tiles[neighborPls];
    if (!neighbor) continue;
    if (!neighbor._breaks) neighbor._breaks = [];

    // 检查是否在断开列表中（双向）
    if (tile._breaks.includes(neighborPls)) continue;
    if (neighbor._breaks.includes(pls)) continue;

    // 双向添加 neighbors（去重）
    if (!tile.neighbors.includes(neighborPls)) {
      tile.neighbors = [...tile.neighbors, neighborPls];
    }
    if (!neighbor.neighbors.includes(pls)) {
      neighbor.neighbors = [...neighbor.neighbors, pls];
    }
  }
}

/**
 * 删除格时清理所有邻居引用与 _breaks 引用
 *
 * 对称清理：从所有邻居的 neighbors / _breaks 中移除自己。
 * 同时遍历自身 neighbors 与 _breaks，确保 _breaks 中标记但不在 neighbors 中的对方也被清理。
 * 不删除被清理格本身的 neighbors / _breaks（调用方负责 delete tiles[pls]）。
 */
export function disconnectAll(
  tiles: Record<Pls, Tile>,
  pls: Pls,
): void {
  const tile = tiles[pls];
  if (!tile) return;

  // 合并 neighbors 与 _breaks 中所有引用的对方 pls（去重）
  const referenced = new Set<Pls>([...tile.neighbors, ...(tile._breaks ?? [])]);
  for (const nPls of referenced) {
    const neighbor = tiles[nPls];
    if (!neighbor) continue;
    neighbor.neighbors = neighbor.neighbors.filter((n) => n !== pls);
    neighbor._breaks = (neighbor._breaks ?? []).filter((b) => b !== pls);
  }
}

/**
 * 手动断开两个格之间的连通（两步点击的 break 工具调用）
 *
 * 双向写入 _breaks 并从 neighbors 中互移。
 * 幂等：重复断开同一对无副作用。
 */
export function breakConnection(
  tiles: Record<Pls, Tile>,
  pls1: Pls,
  pls2: Pls,
): void {
  const t1 = tiles[pls1];
  const t2 = tiles[pls2];
  if (!t1 || !t2) return;
  if (pls1 === pls2) return;

  if (!t1._breaks) t1._breaks = [];
  if (!t2._breaks) t2._breaks = [];

  if (!t1._breaks.includes(pls2)) t1._breaks = [...t1._breaks, pls2];
  if (!t2._breaks.includes(pls1)) t2._breaks = [...t2._breaks, pls1];

  t1.neighbors = t1.neighbors.filter((n) => n !== pls2);
  t2.neighbors = t2.neighbors.filter((n) => n !== pls1);
}

/**
 * 恢复两个格之间的连通（两步点击的 restore 工具调用）
 *
 * 从 _breaks 中互移并恢复双向 neighbors。
 * 幂等：重复恢复同一对无副作用。
 */
export function restoreConnection(
  tiles: Record<Pls, Tile>,
  pls1: Pls,
  pls2: Pls,
): void {
  const t1 = tiles[pls1];
  const t2 = tiles[pls2];
  if (!t1 || !t2) return;
  if (pls1 === pls2) return;

  t1._breaks = (t1._breaks ?? []).filter((b) => b !== pls2);
  t2._breaks = (t2._breaks ?? []).filter((b) => b !== pls1);

  if (!t1.neighbors.includes(pls2)) t1.neighbors = [...t1.neighbors, pls2];
  if (!t2.neighbors.includes(pls1)) t2.neighbors = [...t2.neighbors, pls1];
}

/**
 * 获取与指定格坐标相邻但已断开的格列表（用于恢复连通工具的高亮提示）
 *
 * "已断开"指双向都不连通：tile.neighbors 不含 nPls 且 neighbor.neighbors 不含 pls。
 * 单向 neighbors（不变式被破坏的中间态）视为已连通，避免误报。
 */
export function getBrokenNeighbors(
  tiles: Record<Pls, Tile>,
  pls: Pls,
): Pls[] {
  const tile = tiles[pls];
  if (!tile) return [];

  const broken: Pls[] = [];
  for (const [dx, dy] of EIGHT_DIRECTIONS) {
    const nx = tile.x + dx;
    const ny = tile.y + dy;
    const nPls = findTileByCoord(tiles, nx, ny);
    if (nPls === null) continue;
    if (nPls === pls) continue;
    const neighbor = tiles[nPls];
    // 双向都不连通才算 broken
    const tileHasN = tile.neighbors.includes(nPls);
    const nHasTile = neighbor ? neighbor.neighbors.includes(pls) : false;
    if (!tileHasN && !nHasTile) {
      broken.push(nPls);
    }
  }
  return broken;
}
