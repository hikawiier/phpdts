/**
 * @module O 内容工具箱
 *
 * 野生道具按天刷新（移植自 wild_refresh.func.php:54-215）。
 *
 * 设计意图：
 * - E-9 静态世界生成系统的 day_changed 监听器——按潮汐倍率与 scatter_pool.refresh 相位刷新
 * - 容量上限保护：每格野生道具数 ≤ wild_item_capacity_per_tile（默认 5）
 * - per-tile 容量保护：last_refresh_day 字段确保同格同天最多刷新一次
 * - effective_rate = rate × tide_multiplier，clamp 到 [0,1]
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 mt_rand / rand
 * - 数据库 COUNT/INSERT/UPDATE 通过依赖注入的 currentCounts 和返回值表达
 * - tiles / scatterPool / itemTable / cfg 通过依赖注入（PHP 通过 include 读取）
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/game/wild_refresh.func.php:54-215 (obl_refresh_wild_items)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { chance as rollChance } from './rng-helpers';
import { instantiateItem } from './obl-roll-group';
import { resolveScatterCount } from './obl-generate-wild-items';
import type {
  ItemInstance,
  ItemTable,
  ScatterPool,
  WildItemRefreshConfig,
} from './types';
import type { TileMap } from './obl-generate-wild-items';

/**
 * 单格刷新状态（对齐 oblmapstates 字段子集）。
 *
 * - last_refresh_day：上次刷新的天数（用于"同格同天最多刷新一次"保护）
 * - fog：是否已发现（仅已发现的格参与刷新，对齐 PHP `fog=1 OR last_refresh_day>0`）
 */
export interface TileRefreshState {
  last_refresh_day: number;
  fog: number;
  [key: string]: unknown;
}

/**
 * 图格刷新状态集合（map-keyed：pls → state）。
 */
export type TileRefreshStateMap = Record<number, TileRefreshState>;

/**
 * 刷新结果项。
 *
 * - pls：格子 ID
 * - item：物品实例
 *
 * 调用方按需将结果 INSERT 进 oblmapitem，并将对应 tile 的 last_refresh_day 更新为 currentDay。
 */
export interface RefreshedWildItem {
  pls: number;
  item: ItemInstance;
}

/**
 * day_changed 事件 transition 结构（对齐 PHP $transition 参数）。
 */
export interface DayTransition {
  from: { day: number; phase: string };
  to: { day: number; phase: string };
  tick: number;
  [key: string]: unknown;
}

/**
 * 野生道具按天刷新——返回新生成的物品列表。
 *
 * 流程：
 *   1. 解析 transition.to.day 为当前天数；mode != 'daily' 直接返回
 *   2. 遍历"已发现过（fog=1 OR last_refresh_day>0）"且"本天未刷新（last_refresh_day < currentDay）"的格
 *   3. 每格按 tide 查 scatter_pool[tide].refresh 相位
 *   4. 容量检查：当前格野生道具数 < capacity 才参与刷新
 *   5. 逐条按 rate × tide_multiplier 判定，clamp 到 [0,1]
 *   6. 命中时按 count 生成 N 份，受容量上限保护
 *
 * 关键不变量：
 *   - mode != 'daily' 不刷新
 *   - currentDay <= 0 不刷新
 *   - 仅"已发现过"且"本天未刷新"的格参与
 *   - effective_rate = rate × tide_multiplier，clamp 到 [0,1]
 *   - 容量上限：每格野生道具数 ≤ capacity（默认 5）
 *
 * @param transition    day_changed 事件 transition 结构
 * @param tiles         [pls → tile] 数据（依赖注入）
 * @param tileStates    [pls → state] 图格刷新状态（依赖注入）
 * @param currentCounts [pgroup_pls → count] 当前每格野生道具数（依赖注入，PHP 通过 SQL COUNT）
 * @param scatterPool   scatter_pool.php 投影（依赖注入）
 * @param itemTable     item_table.php 投影（依赖注入）
 * @param cfg           obl_config.php 的 wild_item_* 字段子集（依赖注入）
 * @param rng           Rng 实例
 * @returns 新生成的物品列表（每项含 pls + item 实例）
 */
export function oblRefreshWildItems(
  transition: DayTransition,
  tiles: TileMap,
  tileStates: TileRefreshStateMap,
  currentCounts: Record<string, number>,
  scatterPool: ScatterPool,
  itemTable: ItemTable,
  cfg: WildItemRefreshConfig,
  rng: Rng,
): RefreshedWildItem[] {
  const currentDay =
    transition?.to && typeof transition.to.day === 'number'
      ? transition.to.day
      : 0;
  if (currentDay <= 0) return [];

  // 刷新模式校验：仅 'daily' 模式启用按天刷新
  const mode =
    typeof cfg.wild_item_refresh_mode === 'string'
      ? cfg.wild_item_refresh_mode
      : 'daily';
  if (mode !== 'daily') return [];

  const capacity =
    typeof cfg.wild_item_capacity_per_tile === 'number'
      ? cfg.wild_item_capacity_per_tile
      : 5;
  const tideRate =
    cfg.wild_item_refresh_rate_by_tide &&
    typeof cfg.wild_item_refresh_rate_by_tide === 'object'
      ? cfg.wild_item_refresh_rate_by_tide
      : {};

  const result: RefreshedWildItem[] = [];

  // 2. 遍历"已发现过"且"本天未刷新"的格
  for (const plsStr of Object.keys(tileStates)) {
    const pls = Number(plsStr);
    const state = tileStates[pls];
    if (!state) continue;

    // fog=1 OR last_refresh_day>0 才参与
    const discovered = state.fog === 1 || state.last_refresh_day > 0;
    if (!discovered) continue;

    // 本天未刷新
    if (state.last_refresh_day >= currentDay) continue;

    // 容量检查
    const cntKey = String(pls);
    const cnt = typeof currentCounts[cntKey] === 'number' ? currentCounts[cntKey] : 0;
    if (cnt >= capacity) continue;

    // 读取 tile 的 tide
    const tile = tiles[pls];
    if (!tile) continue;
    const tide =
      typeof tile.tide === 'string' && tile.tide !== '' ? tile.tide : 'shallow';

    // refresh 相位缺失跳过
    const tideEntry = scatterPool[tide];
    if (!tideEntry || !Array.isArray(tideEntry.refresh)) continue;

    // 潮汐倍率（越危险越丰沛）
    const mult = typeof tideRate[tide] === 'number' ? tideRate[tide] : 1.0;

    // 逐条按 rate * mult 概率判定
    for (const cfgEntry of tideEntry.refresh) {
      const itemId = typeof cfgEntry.item_id === 'string' ? cfgEntry.item_id : '';
      if (itemId === '' || !itemTable[itemId]) continue;

      const rate = typeof cfgEntry.rate === 'number' ? cfgEntry.rate : 0;
      if (rate <= 0) continue;

      // effective_rate = rate × mult，clamp 到 [0,1]
      let effRate = rate * mult;
      if (effRate > 1.0) effRate = 1.0;

      // 容量上限内才生成
      const currentCnt =
        typeof currentCounts[cntKey] === 'number' ? currentCounts[cntKey] : 0;
      if (currentCnt >= capacity) break;

      // rate 概率生成
      if (!rollChance(rng, effRate)) continue;

      const n = Math.max(1, resolveScatterCount(rng, cfgEntry.count));
      const template = itemTable[itemId];
      for (let i = 0; i < n; i++) {
        // 容量保护
        const updatedCnt =
          typeof currentCounts[cntKey] === 'number' ? currentCounts[cntKey] : 0;
        if (updatedCnt >= capacity) break;

        result.push({ pls, item: instantiateItem(template, itemId) });
        // 内存中同步容量计数
        currentCounts[cntKey] = updatedCnt + 1;
      }
    }
  }

  return result;
}
