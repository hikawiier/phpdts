/**
 * @module O 内容工具箱
 *
 * 敌人放置生成（移植自 init.func.php:214-268）。
 *
 * 设计意图：
 * - J-1 游戏生命周期状态机的初始化阶段——按 tide 桶遍历可通行格放置敌人
 * - 排除区域出入口（entrance_pls / exit_pls）+ 已占用格（玩家初始位置 + 已生成 NPC）
 * - 每格最多一个敌人（occupied 集合去重）
 * - count=[min,max] 时运行时 rand 取值
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 rand / array_rand
 * - 数据库查询通过依赖注入的 occupiedPositions 集合表达
 * - 敌人配置通过依赖注入（PHP 通过 include 读取）
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/gamectl/init.func.php:214-268 (obl_init_enemies)
 * @mirror-of oblivions/include/gamectl/init.func.php:384-393 (obl_pick_available_tile)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { randInt, pickIndex } from './rng-helpers';
import type { EnemyPool, RegionInfo } from './types';
import type { TileMap } from './obl-generate-wild-items';

/**
 * 敌人放置结果项。
 *
 * - pgroup：区域 ID
 * - pls：格子 ID
 * - enemy_type：敌人类型 ID（对应 enemies_config 的 key）
 *
 * 调用方按需调用 obl_create_enemy_record 物化敌人记录；本函数不直接访问数据库。
 */
export interface PlacedEnemy {
  pgroup: number;
  pls: number;
  enemy_type: number;
}

/**
 * 从可用格列表中随机选一个未被占用的（对齐 obl_pick_available_tile）。
 *
 * - 候选集合 = available_pls 中未出现在 occupied 中的格
 * - 候选为空返回 null
 * - 选中后**不**修改 occupied 集合（调用方负责标记，与 PHP 引用传递语义对齐）
 *
 * @param rng        Rng 实例
 * @param available  可用格 pls 列表
 * @param occupied   已占用格集合
 * @returns 选中的 pls；无可用格返回 null
 */
export function oblPickAvailableTile(
  rng: Rng,
  available: readonly number[],
  occupied: ReadonlySet<number>,
): number | null {
  const candidates: number[] = [];
  for (const pls of available) {
    if (!occupied.has(pls)) {
      candidates.push(pls);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[pickIndex(rng, candidates.length)] ?? null;
}

/**
 * 解析敌人池 entry 的 count（对齐 PHP rand($lo, $hi)）。
 *
 * - 单值：返回该值
 * - [min, max]：返回 [min, max] 闭区间内的随机整数（min > max 自动 swap）
 * - 缺失按 1 计
 *
 * @param rng   Rng 实例
 * @param count count 配置
 * @returns 生成的数量（≥0，由调用方决定是否兜底为 1）
 */
export function resolveEnemyCount(
  rng: Rng,
  count: number | [number, number] | undefined,
): number {
  if (count === undefined) return 1;
  if (Array.isArray(count)) {
    let lo = typeof count[0] === 'number' ? count[0] : 1;
    let hi = typeof count[1] === 'number' ? count[1] : lo;
    if (hi < lo) [lo, hi] = [hi, lo];
    return randInt(rng, lo, hi);
  }
  return Math.floor(count);
}

/**
 * 按 tide 分桶可通行格（对齐 obl_init_enemies 的 tide_tiles 分组逻辑）。
 *
 * - 仅 passable=true 的格参与
 * - tide 缺失按 'shallow' 计
 * - 仅 shallow/deep/abyss 三个 tide 桶（与 PHP $tide_tiles 初始化一致）
 *
 * @param tiles [pls → tile] 数据
 * @returns [tide → pls 列表] 映射
 */
export function bucketTilesByTide(
  tiles: TileMap,
): Record<string, number[]> {
  const tideTiles: Record<string, number[]> = {
    shallow: [],
    deep: [],
    abyss: [],
  };
  for (const plsStr of Object.keys(tiles)) {
    const pls = Number(plsStr);
    const tile = tiles[pls];
    if (!tile || !tile.passable) continue;
    const tide =
      typeof tile.tide === 'string' && tile.tide !== '' ? tile.tide : 'shallow';
    if (tideTiles[tide]) {
      tideTiles[tide].push(pls);
    }
  }
  return tideTiles;
}

/**
 * 敌人放置生成——返回放置结果列表。
 *
 * 流程：
 *   1. 按 tide 分桶可通行格（仅 shallow/deep/abyss）
 *   2. 排除区域出入口（entrance_pls / exit_pls）
 *   3. 排除已占用格（玩家初始位置 + 已生成 NPC，通过 occupiedPositions 依赖注入）
 *   4. 按 tide 桶遍历 enemy_pool，逐 entry 解析 count
 *   5. 每个 enemy 逐个从可用格中随机选一个未被占用的放置
 *   6. 选中后占用集合标记（避免重复放置）
 *
 * 关键不变量：
 *   - 仅 passable=true 的格参与
 *   - 排除 entrance_pls / exit_pls（null 不排除）
 *   - 每格最多一个敌人
 *   - count=[min,max] 时运行时取值
 *   - 候选格不足时停止该 entry 的放置（break）
 *
 * @param pgroup             区域 ID
 * @param region             区域元数据（含 entrance_pls / exit_pls）
 * @param tiles              [pls → tile] 数据（依赖注入）
 * @param enemyPool          enemy_pool.php 投影（依赖注入）
 * @param initialOccupied    初始已占用格集合（玩家初始位置，依赖注入）
 * @param rng                Rng 实例
 * @returns 放置结果列表（每项含 pgroup + pls + enemy_type）
 */
export function oblInitEnemies(
  pgroup: number,
  region: RegionInfo,
  tiles: TileMap,
  enemyPool: EnemyPool,
  initialOccupied: ReadonlySet<number>,
  rng: Rng,
): PlacedEnemy[] {
  // 1. 按 tide 分桶
  const tideTiles = bucketTilesByTide(tiles);

  // 2. 复制初始占用集合（玩家初始位置），后续放置时追加
  const occupied = new Set<number>(initialOccupied);

  // 3. 排除出入口
  if (region.entrance_pls !== null && region.entrance_pls !== undefined) {
    occupied.add(Number(region.entrance_pls));
  }
  if (region.exit_pls !== null && region.exit_pls !== undefined) {
    occupied.add(Number(region.exit_pls));
  }

  const result: PlacedEnemy[] = [];

  // 4. 按潮汐区生成敌人
  for (const tide of Object.keys(tideTiles)) {
    const availablePls = tideTiles[tide];
    if (!availablePls || availablePls.length === 0) continue;

    const poolEntries = enemyPool[tide];
    if (!Array.isArray(poolEntries)) continue;

    for (const entry of poolEntries) {
      const enemyType = typeof entry.enemy_type === 'number' ? entry.enemy_type : 0;
      const count = resolveEnemyCount(rng, entry.count);

      for (let i = 0; i < count; i++) {
        // 5. 从可用格中随机选一个未被占用的
        const pls = oblPickAvailableTile(rng, availablePls, occupied);
        if (pls === null) break; // 该潮汐区格不够

        result.push({ pgroup, pls, enemy_type: enemyType });
        // 6. 标记占用
        occupied.add(pls);
      }
    }
  }

  return result;
}
