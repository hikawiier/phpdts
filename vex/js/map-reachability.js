// ══════════════════════════════════════════════════
// 地图可达性与寻路算法 / Map reachability & pathfinding
//
// 纯算法层，无 DOM 依赖，只依赖 mapData 数据结构。
// 包含：
//   - computeReachableMap：BFS 计算当前格 move_range 内所有可达格
//   - isReachable：查询某格是否可达（含入口格回退特殊处理）
//   - findPath：BFS 最短路径（与后端 obl_get_distance 一致）
//   - getDirectionArrow：根据坐标差计算方向箭头
// ══════════════════════════════════════════════════

import { mapData } from './data.js';

// 缓存：从当前格出发，所有可达格的 pls → distance 映射
let reachableMap = new Map();

/**
 * 从当前格 BFS 计算所有 move_range 内可达格的距离
 * 在 renderMapGrid() 中调用，结果缓存到 reachableMap
 */
export function computeReachableMap() {
    reachableMap = new Map();
    if (!mapData.links || mapData.curLoc === null || mapData.curRegion === null) return;

    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles) return;
    const curTile = tiles[mapData.curLoc];
    if (!curTile || !curTile.neighbors) return;

    const moveRange = mapData.links.move_range || 1;
    const fogData = mapData.links.fog;
    const regionFog = fogData && fogData[mapData.curRegion] ? fogData[mapData.curRegion] : {};

    // BFS
    const queue = [[mapData.curLoc, 0]];
    const visited = { [mapData.curLoc]: true };

    while (queue.length > 0) {
        const [curPls, dist] = queue.shift();
        if (dist >= moveRange) continue; // 超过移动距离，不再扩展

        const tile = tiles[curPls];
        if (!tile || !tile.neighbors) continue;

        for (const next of tile.neighbors) {
            if (visited[next]) continue;
            const nextTile = tiles[next];
            if (!nextTile) continue;

            // 不可通行格既不作为中转，也不作为目标
            if (!nextTile.passable) continue;

            visited[next] = true;
            reachableMap.set(next, dist + 1);
            queue.push([next, dist + 1]);
        }
    }

    // 过滤掉迷雾格作为目标（目标格必须非迷雾）
    for (const pls of reachableMap.keys()) {
        if (!regionFog[pls]) {
            reachableMap.delete(pls);
        }
    }
}

/**
 * 查询某格是否可达
 * 含入口格特殊处理：入口格可回退到前区域
 */
export function isReachable(areaId) {
    if (!mapData.links) return false;
    if (mapData.curLoc === null || mapData.curRegion === null) return false;

    // 入口格特殊处理：可回退到前区域
    const regions = mapData.links.regions;
    const curRegionInfo = regions[mapData.curRegion];
    if (curRegionInfo && areaId === curRegionInfo.entrance_pls && curRegionInfo.prev_region !== null) {
        return true;
    }

    return reachableMap.has(areaId);
}

/**
 * 计算从 fromPls 到 toPls 的最短路径
 * 纯 neighbors BFS，跳过不可通行中转格（与后端 obl_get_distance 一致）
 * @returns {number[]} pls 数组（含起点和终点），找不到返回 null
 */
export function findPath(fromPls, toPls) {
    if (!mapData.links || mapData.curRegion === null) return null;
    const tiles = mapData.links.tiles[mapData.curRegion];
    if (!tiles || !tiles[fromPls] || !tiles[toPls]) return null;

    if (fromPls === toPls) return [fromPls];

    const queue = [fromPls];
    const visited = { [fromPls]: true };
    const parent = {};

    while (queue.length > 0) {
        const cur = queue.shift();
        const tile = tiles[cur];
        if (!tile || !tile.neighbors) continue;

        for (const next of tile.neighbors) {
            if (visited[next]) continue;
            const nextTile = tiles[next];
            if (!nextTile) continue;

            // 中转格必须可通行（与后端 obl_get_distance 一致），目标格除外
            if (next !== toPls && !nextTile.passable) continue;

            visited[next] = true;
            parent[next] = cur;

            if (next === toPls) {
                // 回溯路径
                const path = [toPls];
                let p = toPls;
                while (parent[p] !== undefined) {
                    p = parent[p];
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
export function getDirectionArrow(fromTile, toTile) {
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
