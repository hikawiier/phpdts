// ══════════════════════════════════════════════════
// 地图可达性与寻路算法 / Map reachability & pathfinding
//
// 纯算法层，无 DOM 依赖，只依赖 mapStore 数据结构。
// 替代现有 vex/js/map-reachability.js。
//
// 包含：
//   - computeReachableMap：BFS 计算当前格 move_range 内所有可达格
//   - isReachable：查询某格是否可达（含入口格回退特殊处理）
//   - findPath：BFS 最短路径（与后端 obl_get_distance 一致）
//   - getDirectionArrow：根据坐标差计算方向箭头
//
// 注意：reachableMap 是模块级缓存（与现有实现一致），
//       在 renderMapGrid() 中调用 computeReachableMap() 刷新。
// ══════════════════════════════════════════════════

import { useMapStore } from '@/stores/map';
import { isFalsy } from '@/utils/format';
import type { TileInfo } from '@/types/api';
import { isTileRevealed, type FogProjection } from '@/utils/map-visibility';

/** 缓存：从当前格出发，所有可达格的 pls（字符串）→ distance 映射 */
let reachableMap = new Map<string, number>();

/**
 * 从当前格 BFS 计算所有 move_range 内可达格的距离
 * 在 renderMapGrid() 中调用，结果缓存到 reachableMap
 */
export function computeReachableMap(): void {
  reachableMap = new Map();
  const mapStore = useMapStore();
  if (!mapStore.links || mapStore.curLoc === null || mapStore.curRegion === null) return;

  const tiles = mapStore.links.tiles[String(mapStore.curRegion)];
  if (!tiles) return;
  const curTile = tiles[String(mapStore.curLoc)] as (TileInfo & { neighbors?: (string | number)[]; x?: number; y?: number }) | undefined;
  if (!curTile || !curTile.neighbors) return;

  const moveRange = (mapStore.links as { move_range?: number }).move_range || 1;
  const fogData = mapStore.links.fog as FogProjection;

  // BFS
  const queue: Array<[string, number]> = [[String(mapStore.curLoc), 0]];
  const visited: Record<string, boolean> = { [String(mapStore.curLoc)]: true };

  while (queue.length > 0) {
    const [curPls, dist] = queue.shift()!;
    if (dist >= moveRange) continue; // 超过移动距离，不再扩展

    const tile = tiles[curPls] as (TileInfo & { neighbors?: (string | number)[] }) | undefined;
    if (!tile || !tile.neighbors) continue;

    for (const next of tile.neighbors) {
      const nextKey = String(next);
      if (visited[nextKey]) continue;
      const nextTile = tiles[nextKey] as (TileInfo & { passable?: unknown }) | undefined;
      if (!nextTile) continue;

      // 不可通行格既不作为中转，也不作为目标
      if (isFalsy(nextTile.passable)) continue;

      visited[nextKey] = true;
      reachableMap.set(nextKey, dist + 1);
      queue.push([nextKey, dist + 1]);
    }
  }

  // 过滤掉迷雾格作为目标（目标格必须非迷雾）
  for (const pls of reachableMap.keys()) {
    if (!isTileRevealed(fogData, mapStore.curRegion, pls)) {
      reachableMap.delete(pls);
    }
  }
}

/**
 * 查询某格是否可达
 * 含入口格特殊处理：入口格可回退到前区域
 */
export function isReachable(areaId: string | number): boolean {
  const mapStore = useMapStore();
  if (!mapStore.links) return false;
  if (mapStore.curLoc === null || mapStore.curRegion === null) return false;

  // 入口格特殊处理：可回退到前区域（统一用 String 比较，避免 number/string 不匹配）
  const regions = mapStore.links.regions as Record<string, { entrance_pls?: string | number; prev_region?: string | number | null }>;
  const curRegionInfo = regions[String(mapStore.curRegion)];
  if (curRegionInfo && curRegionInfo.entrance_pls !== undefined && String(areaId) === String(curRegionInfo.entrance_pls) && curRegionInfo.prev_region !== null) {
    return true;
  }

  return reachableMap.has(String(areaId));
}

/**
 * 计算从 fromPls 到 toPls 的最短路径
 * 纯 neighbors BFS，跳过不可通行中转格（与后端 obl_get_distance 一致）
 * @returns pls 数组（含起点和终点），找不到返回 null
 */
export function findPath(fromPls: string | number, toPls: string | number): Array<string | number> | null {
  const mapStore = useMapStore();
  if (!mapStore.links || mapStore.curRegion === null) return null;
  const tiles = mapStore.links.tiles[String(mapStore.curRegion)];
  if (!tiles || !tiles[String(fromPls)] || !tiles[String(toPls)]) return null;

  if (fromPls === toPls || String(fromPls) === String(toPls)) return [fromPls];

  const queue: Array<string | number> = [fromPls];
  const visited: Record<string, boolean> = { [String(fromPls)]: true };
  const parent: Record<string, string | number> = {};

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const tile = tiles[String(cur)] as (TileInfo & { neighbors?: (string | number)[] }) | undefined;
    if (!tile || !tile.neighbors) continue;

    for (const next of tile.neighbors) {
      if (visited[String(next)]) continue;
      const nextTile = tiles[String(next)] as (TileInfo & { passable?: unknown }) | undefined;
      if (!nextTile) continue;

      // 中转格必须可通行（与后端 obl_get_distance 一致），目标格除外
      if (String(next) !== String(toPls) && isFalsy(nextTile.passable)) continue;

      visited[String(next)] = true;
      parent[String(next)] = cur;

      if (String(next) === String(toPls)) {
        // 回溯路径
        const path: Array<string | number> = [next];
        let p: string | number = next;
        while (parent[String(p)] !== undefined) {
          p = parent[String(p)];
          path.unshift(p);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * 根据两个格子的坐标差计算方向箭头
 */
export function getDirectionArrow(
  fromTile: { x: number; y: number },
  toTile: { x: number; y: number },
): string {
  const dx = toTile.x - fromTile.x;
  const dy = toTile.y - fromTile.y;
  if (dx === 0 && dy < 0) return '↑';
  if (dx === 0 && dy > 0) return '↓';
  if (dx < 0 && dy === 0) return '←';
  if (dx > 0 && dy === 0) return '→';
  if (dx > 0 && dy < 0) return '↗';
  if (dx > 0 && dy > 0) return '↘';
  if (dx < 0 && dy < 0) return '↖';
  if (dx < 0 && dy > 0) return '↙';
  return '';
}
