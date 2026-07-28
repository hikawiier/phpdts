/**
 * @module O 内容工具箱
 *
 * 开局野生散落道具生成（移植自 generate.func.php:142-211）。
 *
 * 设计意图：
 * - E-9 静态世界生成系统的开局相位——按 tide 桶遍历可通行格，独立判定是否生成道具
 * - 每个可通行格独立按 rate 概率判定；命中时按 count 生成 N 份
 * - 与 obl_refresh_wild_items 的差异：本函数使用 initial 相位，且无 tide 倍率
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 mt_rand / rand
 * - 数据库 INSERT 通过返回值表达（PHP 直接 INSERT），调用方按需物化
 * - tiles 通过依赖注入（PHP 通过 include 读取）
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/game/generate.func.php:142-211 (obl_generate_wild_items)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { chance as rollChance, randInt } from './rng-helpers';
import { instantiateItem } from './obl-roll-group';
import type { ItemInstance, ItemTable, ScatterPool } from './types';

/**
 * Tile 数据（仅含本函数所需字段）。
 *
 * - passable：是否可通行（仅可通行格参与生成）
 * - tide：潮汐区标识（shallow/deep/abyss），决定 scatter_pool 桶
 */
export interface TileInfo {
  passable?: boolean;
  tide?: string;
  [key: string]: unknown;
}

/**
 * Tiles 集合（map-keyed load：pls → tile）。
 */
export type TileMap = Record<number, TileInfo>;

/**
 * 野生道具生成结果项。
 *
 * - pls：格子 ID
 * - item：物品实例（itempara 七字段结构）
 *
 * 调用方按需将结果 INSERT 进 oblmapitem；本函数不直接访问数据库。
 */
export interface GeneratedWildItem {
  pls: number;
  item: ItemInstance;
}

/**
 * 解析 count 配置（单值或 [min, max] 区间）。
 *
 * - 单值：返回该值
 * - [min, max]：返回 [min, max] 闭区间内的随机整数（min > max 自动 swap）
 * - 缺失按 1 计
 *
 * @param rng   Rng 实例
 * @param count count 配置
 * @returns 生成的数量（≥1）
 */
export function resolveScatterCount(
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
 * 开局野生散落道具生成——返回生成的物品实例列表。
 *
 * 流程：
 *   1. 按 tide 分桶，仅保留可通行格
 *   2. 逐 tide 桶、逐道具配置生成（使用 scatter_pool[tide].initial 相位）
 *   3. 每个格独立按 rate 概率判定；命中时按 count 生成 N 份
 *   4. rate <= 0 跳过；item_id 空 / 模板缺失跳过
 *
 * 关键不变量：
 *   - 仅 passable=true 的格参与生成
 *   - tide 缺失按 'shallow' 计（与 PHP 一致）
 *   - rate <= 0 跳过该配置
 *   - count=[min,max] 时 min > max 自动 swap
 *
 * @param pgroup      区域 ID（仅用于日志，不参与掷骰）
 * @param tiles       [pls → tile] 数据（依赖注入）
 * @param scatterPool scatter_pool.php 投影（依赖注入）
 * @param itemTable   item_table.php 投影（依赖注入）
 * @param rng         Rng 实例
 * @returns 生成的物品列表（每项含 pls + item 实例）
 */
export function oblGenerateWildItems(
  _pgroup: number,
  tiles: TileMap,
  scatterPool: ScatterPool,
  itemTable: ItemTable,
  rng: Rng,
): GeneratedWildItem[] {
  // 1. 按 tide 分桶，仅保留可通行格
  const byTide: Record<string, number[]> = {};
  for (const pls of Object.keys(tiles)) {
    const tile = tiles[Number(pls)];
    if (!tile || !tile.passable) continue;
    const tide = typeof tile.tide === 'string' && tile.tide !== '' ? tile.tide : 'shallow';
    if (!byTide[tide]) byTide[tide] = [];
    byTide[tide]!.push(Number(pls));
  }

  const result: GeneratedWildItem[] = [];

  // 2. 逐 tide 桶、逐道具配置生成（使用 initial 相位，区域初始化专用）
  for (const tide of Object.keys(byTide)) {
    const tideEntry = scatterPool[tide];
    if (!tideEntry || !Array.isArray(tideEntry.initial)) continue;

    const gridList = byTide[tide];
    if (!gridList) continue;

    for (const cfg of tideEntry.initial) {
      const itemId = typeof cfg.item_id === 'string' ? cfg.item_id : '';
      if (itemId === '' || !itemTable[itemId]) continue;

      const rate = typeof cfg.rate === 'number' ? cfg.rate : 0;
      if (rate <= 0) continue;

      // 每个格独立判定
      for (const pls of gridList) {
        // rate 概率生成；count>1 时生成多份
        if (!rollChance(rng, rate)) continue;

        const n = Math.max(1, resolveScatterCount(rng, cfg.count));
        const template = itemTable[itemId];
        for (let i = 0; i < n; i++) {
          result.push({ pls, item: instantiateItem(template, itemId) });
        }
      }
    }
  }

  return result;
}
