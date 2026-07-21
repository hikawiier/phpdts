//
// 视野 BFS（移植自后端 vision.func.php obl_calc_vision_range，@framework E-6 视野与感知系统）
// 算法语义保持一致：从 playerPos 出发 BFS 扩展 vision_range 步；
// 不可通行格可见但不再扩展（不能站在山上看到更远的地方）。
//
// 与后端差异：
//   - 后端读 obl_get_map_data + obl_get_config（DB + 文件）
//   - 前端读内存 tiles + visionRange 参数
//   - 纯函数，无副作用（对齐 2.8 dry-run 契约：模拟=预览，不写 DB）

import type { Pls, Tile } from '../types/map';

/**
 * 视野 BFS 计算结果：Map<Pls, distance>
 */
export type VisionRangeResult = Map<Pls, number>;

/**
 * 计算玩家视野范围内的所有格及其距离
 *
 * 不可通行格可见但不再扩展（不能站在山上看到更远的地方）
 *
 * @param tiles       区域 tiles 字典 { [pls]: Tile }
 * @param playerPls   玩家所在格 pls
 * @param visionRange 视野范围（BFS 跳数，对齐 obl_config.vision_range）
 * @returns 距离 Map（key=pls, value=distance），空 Map 表示当前格无效
 */
export function calcVisionRange(
  tiles: Record<Pls, Tile>,
  playerPls: Pls,
  visionRange: number,
): VisionRangeResult {
  const result: VisionRangeResult = new Map();
  const playerTile = tiles[playerPls];
  if (!playerTile) return result;

  const visited = new Set<Pls>([playerPls]);
  result.set(playerPls, 0);

  // 用数组模拟队列（小规模数据，shift 性能可接受；254 格上限）
  const queue: Array<[Pls, number]> = [[playerPls, 0]];

  while (queue.length > 0) {
    const [cur, dist] = queue.shift()!;
    if (dist >= visionRange) continue;

    const curTile = tiles[cur];
    if (!curTile) continue;
    const neighbors = curTile.neighbors ?? [];
    for (const nPls of neighbors) {
      const nKey = Number(nPls);
      if (visited.has(nKey)) continue;
      const nTile = tiles[nKey];
      // 邻居引用不存在的 pls 时被跳过（不加入 result，不扩展）
      if (!nTile) continue;
      visited.add(nKey);
      result.set(nKey, dist + 1);
      // 不可通行格可见但不再扩展（不能站在山上看到更远的地方）
      if (!nTile.passable) continue;
      queue.push([nKey, dist + 1]);
    }
  }

  return result;
}

/**
 * 计算敌人感知范围（无视 passable，对齐 obl_get_player_vision_range）
 *
 * 与视野范围的区别：
 *   - 视野范围（vision_range）：清除迷雾的范围，不可通行格阻挡扩展
 *   - 感知范围（memory_range / enemySenseRange）：感知敌人气息的范围，无视地形
 *
 * @param tiles
 * @param playerPls
 * @param senseRange  感知范围（BFS 跳数，对齐 obl_config.memory_range）
 */
export function calcEnemySenseRange(
  tiles: Record<Pls, Tile>,
  playerPls: Pls,
  senseRange: number,
): VisionRangeResult {
  const result: VisionRangeResult = new Map();
  const playerTile = tiles[playerPls];
  if (!playerTile) return result;

  const visited = new Set<Pls>([playerPls]);
  result.set(playerPls, 0);

  const queue: Array<[Pls, number]> = [[playerPls, 0]];

  while (queue.length > 0) {
    const [cur, dist] = queue.shift()!;
    if (dist >= senseRange) continue;

    const curTile = tiles[cur];
    if (!curTile) continue;
    const neighbors = curTile.neighbors ?? [];
    for (const nPls of neighbors) {
      const nKey = Number(nPls);
      if (visited.has(nKey)) continue;
      const nTile = tiles[nKey];
      // 邻居引用不存在的 pls 时被跳过（不加入 result，不扩展）
      if (!nTile) continue;
      visited.add(nKey);
      result.set(nKey, dist + 1);
      // 感知范围无视 passable：不检查 tiles[nKey].passable
      queue.push([nKey, dist + 1]);
    }
  }

  return result;
}
