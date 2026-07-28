/**
 * @module O 内容工具箱
 *
 * 加权随机选择一个 entry（移植自 loot.engine.func.php:219-239）。
 *
 * 设计意图：
 * - F-4 战利品表引擎的组内互斥选择原语
 * - weight 全 0 时均匀随机选一个（避免除零），与 PHP 行为一致
 * - weight 缺失按 1.0 计，与 PHP `isset($e['weight']) ? (float)$e['weight'] : 1.0` 一致
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 mt_rand
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php:219-239 (obl_weighted_pick)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { pickIndex } from './rng-helpers';

/**
 * 加权选择 entry 的输入项。
 *
 * weight 字段可选——缺失按 1.0 计（与 PHP isset 兜底一致）。
 * 其他字段由调用方定义（如 item_id / count 等），本函数仅关心 weight。
 */
export interface WeightedEntry {
  /** 权重（默认 1.0） */
  weight?: number;
  [key: string]: unknown;
}

/**
 * 加权随机选择一个 entry。
 *
 * 算法：
 *   1. 累加所有 entry 的 weight（缺失按 1.0）
 *   2. 若 total_weight <= 0 → 均匀随机选一个（避免除零）
 *   3. 否则 r = rng.next() * total_weight，遍历累加 cum，r <= cum 时返回当前 entry
 *   4. 浮点累加误差兜底：返回最后一个 entry
 *
 * @param rng     Rng 实例
 * @param entries 非空 entries 列表
 * @returns 选中的 entry；空列表返回 undefined
 */
export function oblWeightedPick<T extends WeightedEntry>(
  rng: Rng,
  entries: readonly T[],
): T | undefined {
  if (entries.length === 0) return undefined;

  let totalWeight = 0;
  for (const e of entries) {
    totalWeight += typeof e.weight === 'number' ? e.weight : 1.0;
  }

  // 全 0 权重：均匀随机选一个（避免除零）
  if (totalWeight <= 0) {
    return entries[pickIndex(rng, entries.length)];
  }

  // 加权累加选择
  const r = rng.next() * totalWeight;
  let cum = 0;
  for (const e of entries) {
    const w = typeof e.weight === 'number' ? e.weight : 1.0;
    cum += w;
    if (r <= cum) return e;
  }
  // 浮点累加误差兜底：返回最后一个
  return entries[entries.length - 1];
}
