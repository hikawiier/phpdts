/**
 * @module O 内容工具箱
 *
 * 应用耐久度衰减（移植自 loot.engine.func.php:290-312）。
 *
 * 设计意图：
 * - 模拟"被丢弃前已用过一段时间"——非 stackable 装备的初始耐久随机化
 * - 仅对 stack=false 的装备生效；stack=true 是数量模型，衰减无意义
 * - itms='∞' 表示无限耐久，保留；itms=0/负值/非数值保留（防御性）
 *
 * 与 PHP 的差异：
 * - PHP 版本通过引用修改 $items（function obl_apply_durability_decay(&$items)）
 * - TS 版本为纯函数：返回新的 items 数组，不修改输入
 * - PRNG 通过依赖注入（rng: Rng），不调用 rand()
 *
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php:290-312 (obl_apply_durability_decay)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { randInt } from './rng-helpers';
import type { ItemInstance, ItemTable } from './types';

/**
 * 应用耐久度衰减——返回新的物品实例列表。
 *
 * 衰减规则（基于 itms 双模型语义，由 item_table.php 的 stack 字段区分）：
 *   - stack=true（数量模型，材料/消耗品）：跳过（itms 是堆叠数量，非耐久）
 *   - stack=false（耐久模型，装备/工具）：
 *       - itms='∞'：保留 ∞（无限耐久，如指南针）
 *       - itms 为数值且 > 0：随机 [1, itms]（模拟"被丢弃前已用过一段时间"）
 *       - itms=0 或负值或非数值：保留原值（防御性，模板不应出现）
 *
 * @param items      物品实例列表
 * @param itemTable  物品模板表（item_table.php 投影）
 * @param rng        Rng 实例
 * @returns 新的物品实例列表（衰减应用到非 stackable 装备）
 */
export function oblApplyDurabilityDecay(
  items: readonly ItemInstance[],
  itemTable: ItemTable,
  rng: Rng,
): ItemInstance[] {
  if (items.length === 0) return [];

  return items.map((item) => {
    const itemId = item.itmid;
    const template = itemTable[itemId];
    if (!template) return item; // 模板缺失，保留原值

    // stack=true 是数量模型，跳过
    if (template.stack) return item;

    const itms = String(item.itms);
    // 无限耐久保留
    if (itms === '∞') return item;

    const max = parseInt(itms, 10);
    // 0/负值/非数值（NaN）保留
    if (!Number.isFinite(max) || max <= 0) return item;

    // 随机 [1, max]：模拟"被丢弃前已用过一段时间"
    const decayed = randInt(rng, 1, max);
    return { ...item, itms: String(decayed) };
  });
}
