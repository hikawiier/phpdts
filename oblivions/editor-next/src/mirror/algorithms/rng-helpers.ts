/**
 * @module O 内容工具箱
 *
 * PRNG 适配辅助函数（执行案 §4.3.2）。
 *
 * 设计意图：
 * - PHP 后端混用 mt_rand() / mt_getrandmax() / rand($lo, $hi) / array_rand()，
 *   TS 移植函数需要等价语义的辅助函数
 * - 所有辅助函数通过依赖注入 Rng 实例（mulberry32），不直接调用 Math.random
 * - 不尝试复现 PHP mt_rand 序列——P6 采用状态快照对比法（执行案 §4.1.2）
 *
 * 与 seed-random.ts 的关系：
 * - seed-random.ts 已提供 randInt / pick / roll 等通用辅助函数
 * - 本文件提供 PHP 语义对齐的专用辅助函数（pickIndex / chance），并重新导出
 *   randInt / pick 以便移植函数从单一入口引用
 *
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php（mt_rand / rand / array_rand 语义）
 */

import type { Rng } from '../../shared/algorithms/seed-random';

/**
 * 返回 [lo, hi] 闭区间内的随机整数，等价于 PHP rand($lo, $hi)。
 *
 * PHP rand 是闭区间，包含两端点。mulberry32 的 rng.next() 返回 [0, 1) 浮点，
 * 通过 Math.floor(rng.next() * (hi - lo + 1)) + lo 实现等价语义。
 *
 * 与 seed-random.ts 的 randInt 一致——本函数为 PHP 移植函数提供语义对齐入口。
 *
 * @param rng Rng 实例
 * @param lo  下界（含）
 * @param hi  上界（含）
 * @returns [lo, hi] 闭区间整数
 */
export function randInt(rng: Rng, lo: number, hi: number): number {
  if (hi < lo) [lo, hi] = [hi, lo];
  return lo + Math.floor(rng.next() * (hi - lo + 1));
}

/**
 * 从数组中按均匀分布随机选一个元素，等价于 PHP array_rand 但返回元素本身。
 *
 * PHP array_rand 返回键名（索引），本函数返回元素以简化调用方代码。
 * 若需索引请使用 pickIndex。
 *
 * @param rng   Rng 实例
 * @param items 非空数组
 * @returns 选中的元素；空数组返回 undefined
 */
export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng.next() * items.length)];
}

/**
 * 从长度为 length 的数组中按均匀分布随机选一个索引，等价于 PHP array_rand 返回键名。
 *
 * @param rng    Rng 实例
 * @param length 数组长度（必须 > 0）
 * @returns [0, length) 范围内的索引
 */
export function pickIndex(rng: Rng, length: number): number {
  if (length <= 0) {
    throw new Error('[rng-helpers] pickIndex: length must be positive');
  }
  return Math.floor(rng.next() * length);
}

/**
 * 概率判定，等价于 PHP `mt_rand() / mt_getrandmax() < $probability`。
 *
 * @param rng         Rng 实例
 * @param probability 概率（0-1）
 * @returns true 表示命中
 */
export function chance(rng: Rng, probability: number): boolean {
  return rng.next() < probability;
}
