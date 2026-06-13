// ══════════════════════════════════════════════════
// 自动连通算法 / Auto-connectivity (8-directional)
// ══════════════════════════════════════════════════

import state from '../state.js';

// 8方向偏移
const DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

/**
 * 根据 (x, y) 坐标查找区域内的地图格
 */
function findTileByCoord(tiles, x, y) {
  for (const pls in tiles) {
    const t = tiles[pls];
    if (t.x === x && t.y === y) return parseInt(pls);
  }
  return null;
}

/**
 * 放置/创建地图格后，自动建立8方向连通
 * 跳过 _breaks 中标记的断开连接
 */
export function autoConnect(pgroup, pls) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles || !tiles[pls]) return;

  const tile = tiles[pls];
  if (!tile._breaks) tile._breaks = [];

  for (const [dx, dy] of DIRS) {
    const nx = tile.x + dx;
    const ny = tile.y + dy;
    const neighborPls = findTileByCoord(tiles, nx, ny);
    if (neighborPls === null) continue;

    const neighbor = tiles[neighborPls];
    if (!neighbor._breaks) neighbor._breaks = [];

    // 检查是否在断开列表中
    if (tile._breaks.includes(neighborPls)) continue;
    if (neighbor._breaks.includes(pls)) continue;

    // 双向添加 neighbors
    if (!tile.neighbors.includes(neighborPls)) {
      tile.neighbors.push(neighborPls);
    }
    if (!neighbor.neighbors.includes(pls)) {
      neighbor.neighbors.push(pls);
    }
  }
}

/**
 * 删除地图格时，清理所有邻居引用
 */
export function disconnectAll(pgroup, pls) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles || !tiles[pls]) return;

  const tile = tiles[pls];

  // 从所有邻居中移除自己
  for (const nPls of tile.neighbors) {
    const neighbor = tiles[nPls];
    if (!neighbor) continue;
    neighbor.neighbors = neighbor.neighbors.filter(n => n !== pls);
    // 清理 _breaks 引用
    neighbor._breaks = (neighbor._breaks || []).filter(b => b !== pls);
  }
}

/**
 * 手动断开两个格之间的连通
 */
export function breakConnection(pgroup, pls1, pls2) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles) return;

  const t1 = tiles[pls1];
  const t2 = tiles[pls2];
  if (!t1 || !t2) return;

  if (!t1._breaks) t1._breaks = [];
  if (!t2._breaks) t2._breaks = [];

  // 双向加入断开列表
  if (!t1._breaks.includes(pls2)) t1._breaks.push(pls2);
  if (!t2._breaks.includes(pls1)) t2._breaks.push(pls1);

  // 从 neighbors 中移除
  t1.neighbors = t1.neighbors.filter(n => n !== pls2);
  t2.neighbors = t2.neighbors.filter(n => n !== pls1);
}

/**
 * 恢复两个格之间的连通
 */
export function restoreConnection(pgroup, pls1, pls2) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles) return;

  const t1 = tiles[pls1];
  const t2 = tiles[pls2];
  if (!t1 || !t2) return;

  // 从 _breaks 中移除
  t1._breaks = (t1._breaks || []).filter(b => b !== pls2);
  t2._breaks = (t2._breaks || []).filter(b => b !== pls1);

  // 双向添加 neighbors
  if (!t1.neighbors.includes(pls2)) t1.neighbors.push(pls2);
  if (!t2.neighbors.includes(pls1)) t2.neighbors.push(pls1);
}

/**
 * 获取与指定格坐标相邻但未连通的格列表（用于恢复连通工具）
 */
export function getBrokenNeighbors(pgroup, pls) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles || !tiles[pls]) return [];

  const tile = tiles[pls];
  const broken = [];

  for (const [dx, dy] of DIRS) {
    const nx = tile.x + dx;
    const ny = tile.y + dy;
    const nPls = findTileByCoord(tiles, nx, ny);
    if (nPls === null) continue;
    if (!tile.neighbors.includes(nPls)) {
      broken.push(nPls);
    }
  }
  return broken;
}
