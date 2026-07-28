/**
 * @module O 内容工具箱
 *
 * 单组掷骰（移植自 loot.engine.func.php:139-205）。
 *
 * 设计意图：
 * - F-4 战利品表引擎的"组级 chance 判定 + 组内加权选择 + 数量解析"原语
 * - 区分 stackable 与非 stackable 实例化策略：
 *   - stackable：单实例 itms=count（受 stack_limit 上限，自动分批）
 *   - 非 stackable：N 个独立实例，各 itms=模板 itms
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 mt_rand / rand
 * - item_table 通过依赖注入（PHP 通过 include 读取）
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php:139-205 (obl_roll_group)
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php:256-271 (obl_instantiate_item)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { chance as rollChance, randInt } from './rng-helpers';
import { oblWeightedPick } from './obl-weighted-pick';
import type { ItemInstance, ItemTable, LootGroup } from './types';

/**
 * 运行时上下文（当前未使用，预留扩展）。
 *
 * 对齐 PHP $context 参数——目前 PHP 版本仅在 obl_roll_loot_table 中读取
 * loot_table_override，本组级函数不使用 context。保留参数为未来扩展预留。
 */
export interface RollGroupContext {
  [key: string]: unknown;
}

/**
 * 从模板实例化物品（对齐 obl_instantiate_item）。
 *
 * - itm 留空：新实例遵循约定，前端通过 itmid 查 locale 渲染名称
 * - itmpara 从模板拷贝（item_table.php 中 itmpara 为字符串/JSON；本函数对齐 PHP json_decode(,true) 语义：
 *   {...} 解码为对象、[...] 解码为数组；非 JSON / 非对象 / 非数组字符串兜底为空数组）
 * - itms 保留模板原值（含 '∞'）；衰减由 obl_apply_durability_decay 后处理
 *
 * @param template 物品模板
 * @param itemId   物品 ID
 * @returns 物品实例（itempara 七字段结构）
 */
export function instantiateItem(
  template: { itmk: string; itme: number; itms: string; itmsk: string; itmpara?: string | unknown[] | Record<string, unknown> },
  itemId: string,
): ItemInstance {
  const rawItmpara = template.itmpara;
  let itmpara: unknown[] | Record<string, unknown>;
  if (Array.isArray(rawItmpara)) {
    itmpara = rawItmpara;
  } else if (rawItmpara !== null && typeof rawItmpara === 'object') {
    itmpara = rawItmpara as Record<string, unknown>;
  } else if (typeof rawItmpara === 'string' && rawItmpara !== '') {
    try {
      const decoded = JSON.parse(rawItmpara);
      // 对齐 PHP is_array(json_decode(,true))：数组或普通对象均保留
      itmpara = (Array.isArray(decoded) || (decoded !== null && typeof decoded === 'object'))
        ? decoded
        : [];
    } catch {
      itmpara = [];
    }
  } else {
    itmpara = [];
  }

  return {
    itm: '',
    itmk: String(template.itmk),
    itme: Number(template.itme),
    itms: String(template.itms),
    itmsk: String(template.itmsk),
    itmpara,
    itmid: String(itemId),
  };
}

/**
 * 单组掷骰——返回物品实例列表。
 *
 * 流程：
 *   1. 组级 chance 判定（chance <= 0 → []；chance >= 1.0 → 必中；
 *      0 < chance < 1.0 → rng.next() < chance 才掷骰）
 *   2. 加权选择 entry（obl_weighted_pick）
 *   3. 解析 count（int 或 [min, max]，min > max 自动 swap，count <= 0 兜底为 1）
 *   4. 校验 item_id 存在 + 加载 item_table 模板
 *   5. 实例化：
 *      - stackable 物品：单实例 itms=count（超 stack_limit 自动分批）
 *      - 非 stackable 物品：N 个独立实例，各 itms=模板 itms
 *
 * 关键不变量：
 *   - chance > 1.0 视为 1.0（防御性，配置错误兜底）
 *   - count <= 0 兜底为 1
 *   - stack_limit < 1 兜底为 1
 *
 * @param group      组配置（chance + entries）
 * @param itemTable  物品模板表（依赖注入，PHP 通过 include 读取）
 * @param rng        Rng 实例
 * @param _context   运行时上下文（当前未使用，预留扩展）
 * @returns 物品实例列表；可能为空数组
 */
export function oblRollGroup(
  group: LootGroup,
  itemTable: ItemTable,
  rng: Rng,
  _context: RollGroupContext = {},
): ItemInstance[] {
  // 1. chance 判定
  const chanceValue = typeof group.chance === 'number' ? group.chance : 1.0;
  if (chanceValue <= 0) return [];
  // chance >= 1.0 视为必中（防御性，配置错误兜底）
  if (chanceValue < 1.0) {
    // mt_rand() / mt_getrandmax() > $chance → 跳过；等价于 rng.next() >= chance → 跳过
    if (!rollChance(rng, chanceValue)) return [];
  }

  // 2. 加权选择 entry
  const entries = Array.isArray(group.entries) ? group.entries : [];
  if (entries.length === 0) return [];
  const entry = oblWeightedPick(rng, entries);
  if (!entry) return [];

  // 3. 解析 count
  let n: number;
  const count = entry.count ?? 1;
  if (Array.isArray(count)) {
    let lo = typeof count[0] === 'number' ? count[0] : 1;
    let hi = typeof count[1] === 'number' ? count[1] : lo;
    if (hi < lo) {
      [lo, hi] = [hi, lo];
    }
    n = randInt(rng, lo, hi);
  } else {
    n = Math.floor(count);
  }
  n = Math.max(1, n);

  // 4. 校验 item_id
  const itemId = typeof entry.item_id === 'string' ? entry.item_id : '';
  if (itemId === '') return [];

  const template = itemTable[itemId];
  if (!template) return [];

  // 5. 实例化（区分 stackable 与非 stackable）
  const isStack = !!template.stack;
  const items: ItemInstance[] = [];

  if (isStack) {
    // 可堆叠：单实例 itms=count（受 stack_limit 上限，自动分批）
    let stackLimit = typeof template.stack_limit === 'number' ? template.stack_limit : 1;
    if (stackLimit < 1) stackLimit = 1;
    let remaining = n;
    while (remaining > 0) {
      const batch = Math.min(remaining, stackLimit);
      const instance = instantiateItem(template, itemId);
      instance.itms = String(batch);
      items.push(instance);
      remaining -= batch;
    }
  } else {
    // 不可堆叠：N 个独立实例，各 itms=模板 itms（'∞' 或数值字符串）
    for (let i = 0; i < n; i++) {
      items.push(instantiateItem(template, itemId));
    }
  }

  return items;
}
