/**
 * @module O 内容工具箱
 *
 * 顶层战利品表掷骰（移植自 loot.engine.func.php:63-117）。
 *
 * 设计意图：
 * - F-4 战利品表引擎的顶层入口——表查询 + groups 遍历 + durability_decay 后处理
 * - 通过 loot_table_override 路由实现工具/技能对掉落表的改良
 * - entries 总数 ≤ OBL_LOOT_MAX_ENTRIES=100 防御性上限，超限返回空数组
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 mt_rand
 * - lootTables / itemTable 通过依赖注入（PHP 通过 include 读取）
 * - 错误日志通过返回值表达（PHP 通过 $obl_error_log->emit），调用方按需上报诊断
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php:63-117 (obl_roll_loot_table)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { oblRollGroup } from './obl-roll-group';
import { oblApplyDurabilityDecay } from './obl-apply-durability-decay';
import type { ItemInstance, ItemTable, LootTables } from './types';

/**
 * 战利品表掷骰的运行时上下文。
 *
 * - loot_table_override：工具/技能路由覆盖的表 ID（优先于 tableId）
 * - player_skills：玩家技能（预留，未来 E-10 使用）
 * - search_count：POI 搜索次数（预留，衰减判定）
 *
 * 对齐 PHP $context 参数；loot_table_override 为唯一当前实际使用的字段。
 */
export interface RollLootTableContext {
  /** 工具/技能路由覆盖的表 ID（优先于 tableId） */
  loot_table_override?: string;
  /** 玩家技能列表（预留扩展） */
  player_skills?: string[];
  /** POI 搜索次数（预留扩展） */
  search_count?: number;
  [key: string]: unknown;
}

/**
 * 单张战利品表 entries 总数上限（对齐 PHP OBL_LOOT_MAX_ENTRIES 常量）。
 *
 * 校验时机：oblRollLootTable 加载表时统计 Σ count(group.entries)，
 * 超限则返回空数组（PHP 同时 emit loot.entries_exceed_limit 错误日志）。
 */
export const OBL_LOOT_MAX_ENTRIES = 100;

/**
 * 顶层战利品表掷骰——返回物品实例列表。
 *
 * 流程：
 *   1. context.loot_table_override 优先（工具/技能路由覆盖）
 *   2. 在 lootTables 中查表，不存在返回 []
 *   3. entries 总数校验（≤ OBL_LOOT_MAX_ENTRIES），超限返回 []
 *   4. 遍历 groups，逐组调用 oblRollGroup 累积物品实例
 *   5. 若 table.durability_decay=true → 调用 oblApplyDurabilityDecay
 *   6. 返回 items
 *
 * 关键不变量：
 *   - loot_table_override 为非空字符串时优先于 tableId
 *   - entries 总数 > 100 时返回 []（防御性）
 *   - durability_decay 仅对非 stackable 装备生效（由 oblApplyDurabilityDecay 保证）
 *
 * @param tableId    战利品表 ID（lootTables 的 key）
 * @param lootTables 战利品表集合（依赖注入，PHP 通过 include 读取）
 * @param itemTable  物品模板表（依赖注入，传递给 oblRollGroup / oblApplyDurabilityDecay）
 * @param rng        Rng 实例
 * @param context    运行时上下文（含 loot_table_override）
 * @returns 物品实例列表；可能为空数组
 */
export function oblRollLootTable(
  tableId: string,
  lootTables: LootTables,
  itemTable: ItemTable,
  rng: Rng,
  context: RollLootTableContext = {},
): ItemInstance[] {
  // 1. 上下文覆盖优先（工具/技能路由）
  let effectiveTableId = tableId;
  const override = context.loot_table_override;
  if (typeof override === 'string' && override !== '') {
    effectiveTableId = override;
  }

  // 2. 加载配置（依赖注入）
  const table = lootTables[effectiveTableId];
  if (!table) return [];

  // 3. entries 上限校验
  const groups = Array.isArray(table.groups) ? table.groups : [];
  let totalEntries = 0;
  for (const group of groups) {
    const entries = Array.isArray(group.entries) ? group.entries : [];
    totalEntries += entries.length;
  }
  if (totalEntries > OBL_LOOT_MAX_ENTRIES) return [];

  // 4. 遍历 groups 累积物品实例
  const items: ItemInstance[] = [];
  for (const group of groups) {
    const groupItems = oblRollGroup(group, itemTable, rng);
    for (const item of groupItems) {
      items.push(item);
    }
  }

  // 5. 统一应用耐久衰减
  if (table.durability_decay) {
    return oblApplyDurabilityDecay(items, itemTable, rng);
  }

  return items;
}
