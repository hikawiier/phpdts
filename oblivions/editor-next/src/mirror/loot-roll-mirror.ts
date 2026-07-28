/**
 * @module O 内容工具箱
 *
 * 镜像器 3：POI 搜索掷骰（F-4 战利品表引擎）。
 *
 * 镜像目标（执行案 §4.2.4）：
 * - 后端函数：obl_search_poi()（poi.search.func.php:70-294）/ obl_roll_loot_table() /
 *   obl_roll_group() / obl_weighted_pick() / obl_apply_durability_decay()（loot.engine.func.php）
 * - 后端随机源：mt_rand() / mt_getrandmax()（三档判定 + group chance + weighted pick）+
 *   rand($lo, $hi)（count 取值）+ rand(1, $max)（durability decay）
 *
 * 镜像器实现：
 * - 输入：Resource Graph 中的 loot.table + item.template 节点
 * - 输出：前端镜像的 loot 掷骰分布（每 item 出现频率）
 * - 算法：复用 obl-roll-loot-table（内含 obl-roll-group + obl-weighted-pick + obl-apply-durability-decay）
 *
 * 关键不变量：
 * - loot table entries 总数 ≤ OBL_LOOT_MAX_ENTRIES=100
 * - group chance 在 [0,1] 范围
 * - weighted pick weight 全 0 时均匀随机
 * - durability_decay 仅对非 stackable 装备生效
 * - 三档判定优先级：pity_timer > event > loot > empty（本镜像器只覆盖 loot 档）
 *
 * 对比方式：
 * - 跑 N=1000 次掷骰，统计每个 item 的出现频率
 * - 分布容忍度 5%
 *
 * P6-3 阶段实现说明：
 * - 复用 P6-2 的 obl-roll-loot-table 算法（内含 4 个子算法）
 * - 镜像器只覆盖 loot 档掷骰——pity_timer / event / empty 档由后端权威快照提供
 * - 每个 loot.table 节点跑 N 次掷骰，聚合 item 出现频率
 * - PRNG 使用固定 seed LOOT_ROLL_DEFAULT_SEED 保证可复现
 *
 * @mirror-of oblivions/include/game/loot/loot.engine.func.php:63-117 (obl_roll_loot_table)
 * @mirror-of oblivions/include/game/poi/poi.search.func.php:70-294 (obl_search_poi loot 档)
 */

import type { useGraphStore } from '@/graph/graph-store';
import type { Mirror, MirrorRunOutput } from './index';
import type { StateScope } from './snapshot-fetcher';
import type { CompareOptions, InvariantViolation } from './snapshot-comparator';
import type { MirrorSnapshot } from './snapshot-fetcher';
import { createRng } from '@/shared/algorithms/seed-random';
import {
  oblRollLootTable,
  OBL_LOOT_MAX_ENTRIES,
  type RollLootTableContext,
} from './algorithms/obl-roll-loot-table';
import type { ItemInstance, ItemTable, LootTable, LootTables } from './algorithms/types';

type GraphStore = ReturnType<typeof useGraphStore>;

export const LOOT_ROLL_MIRROR_ID = 'loot-roll';

export const LOOT_ROLL_REQUIRED_SCOPES: readonly StateScope[] = [
  'player_inventory',
  'debug_player_full',
];

/**
 * loot-roll 镜像器对比配置（执行案 §4.2.4）。
 *
 * 分布容忍度 5%——N=1000 次掷骰统计对比，比开局生成（10%）更严格，
 * 因为 loot 掷骰的输入完全可控（loot table + item table）。
 */
export const LOOT_ROLL_COMPARE_OPTIONS: CompareOptions = {
  countTolerance: 0.05,
  distributionTolerance: 0.05,
};

/**
 * 镜像器默认 seed——固定正整数保证可复现（对齐设计案 §3.7.4）。
 */
export const LOOT_ROLL_DEFAULT_SEED = 20240603;

/**
 * 每个 loot.table 跑多少次掷骰——执行案 §4.2.4 规定 N=1000。
 *
 * N=1000 在 5% 容忍度下足以稳定区分 weight=1 与 weight=2 的 entry
 * （二项分布 σ ≈ √(1000 × p × (1-p)) ≈ 15，5% 容忍度 ≈ 50 次）。
 */
export const LOOT_ROLL_N = 1000;

/**
 * 单个 loot.table 的掷骰分布结果。
 *
 * - tableId：loot.table 节点 ID
 * - totalRolls：总掷骰次数（= LOOT_ROLL_N）
 * - itemFrequencies：item_id → 出现次数
 * - entriesCount：该表 entries 总数（用于不变量校验）
 */
export interface LootTableRollResult {
  tableId: string;
  totalRolls: number;
  itemFrequencies: Record<string, number>;
  entriesCount: number;
}

/**
 * loot-roll 镜像输出结构——传给 snapshot-comparator 作为 actual。
 *
 * - count：所有 loot.table 跑完后的 item 总产出次数
 * - distribution：item_id → 出现次数（跨所有 loot.table 聚合）
 * - tableResults：每个 loot.table 的掷骰分布结果
 * - totalTables：参与的 loot.table 数量
 */
export interface LootRollMirrorOutput {
  /** item 总产出次数（所有 loot.table × N 次掷骰） */
  count: number;
  /** item_id → 出现次数（跨所有 loot.table 聚合） */
  distribution: Record<string, number>;
  /** 每个 loot.table 的掷骰分布结果 */
  tableResults: LootTableRollResult[];
  /** 参与的 loot.table 数量 */
  totalTables: number;
}

// ─── Graph 节点 data 形状（与 schema/kinds/* 对齐） ────────────────

/**
 * loot.table 节点 data 形状（与 schema/kinds/loot-table.ts 对齐）。
 *
 * 字段是扁平的（name / durability_decay / groups），groups 是数组。
 */
interface LootTableData {
  name?: string;
  durability_decay?: boolean;
  groups?: Array<{
    chance?: number;
    entries?: Array<{
      item_id: string;
      weight?: number;
      count?: number | [number, number];
    }>;
  }>;
  [key: string]: unknown;
}

// ─── 数据装配辅助 ───────────────────────────────────────────────

/**
 * 装配 LootTables——loot.table 节点 → LootTables（tableId → table）。
 *
 * 节点 data 的 groups 是数组（与 schema 字段 key 'groups' 一致，非带点 key）。
 */
function buildLootTables(
  lootTableNodes: ReadonlyArray<{ id: string; data: LootTableData }>,
): LootTables {
  const tables: LootTables = {};
  for (const node of lootTableNodes) {
    const d = node.data;
    const table: LootTable = {
      name: typeof d.name === 'string' ? d.name : '',
      durability_decay: d.durability_decay === true,
      groups: Array.isArray(d.groups)
        ? d.groups.map((g) => ({
            ...g,
            entries: Array.isArray(g.entries) ? g.entries : [],
          }))
        : [],
    };
    tables[node.id] = table;
  }
  return tables;
}

/**
 * 装配 ItemTable——item.template 节点 → ItemTable（item_id → template）。
 */
function buildItemTable(
  itemNodes: ReadonlyArray<{ id: string; data: unknown }>,
): ItemTable {
  const table: ItemTable = {};
  for (const node of itemNodes) {
    table[node.id] = node.data as ItemTable[string];
  }
  return table;
}

/**
 * 统计单个 loot.table 的 entries 总数（Σ count(group.entries)）。
 */
function countEntries(table: LootTable): number {
  let total = 0;
  for (const group of table.groups) {
    const entries = Array.isArray(group.entries) ? group.entries : [];
    total += entries.length;
  }
  return total;
}

// ─── 不变量校验 ─────────────────────────────────────────────────

/**
 * 校验"loot table entries 总数 ≤ OBL_LOOT_MAX_ENTRIES=100"。
 *
 * 超限时 oblRollLootTable 内部返回空数组——这是预期行为，不算违反。
 * 但应记录为不变量违反（配置层面的潜在问题）。
 */
function checkEntriesLimitInvariant(
  tableResults: LootTableRollResult[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const result of tableResults) {
    if (result.entriesCount > OBL_LOOT_MAX_ENTRIES) {
      violations.push({
        name: 'loot_entries_exceed_limit',
        detail: `loot.table:${result.tableId} 的 entries 总数 ${result.entriesCount} 超过上限 ${OBL_LOOT_MAX_ENTRIES}，运行时返回空数组`,
      });
    }
  }
  return violations;
}

/**
 * 校验"group chance 在 [0,1] 范围"。
 *
 * chance > 1.0 时 oblRollGroup 内部视为 1.0（必中）——防御性兜底。
 * chance < 0 时 oblRollGroup 内部返回空数组——配置错误。
 */
function checkGroupChanceInvariant(
  lootTableNodes: ReadonlyArray<{ id: string; data: LootTableData }>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const node of lootTableNodes) {
    const groups = Array.isArray(node.data.groups) ? node.data.groups : [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const chance = typeof group.chance === 'number' ? group.chance : 1.0;
      if (chance < 0 || chance > 1.0) {
        violations.push({
          name: 'loot_group_chance_out_of_range',
          detail: `loot.table:${node.id} groups[${i}] 的 chance=${chance} 超出 [0,1] 范围，运行时将 clamp`,
        });
      }
    }
  }
  return violations;
}

// ─── run 入口 ───────────────────────────────────────────────────

/**
 * 运行 loot-roll 镜像器——计算前端镜像的 loot 掷骰分布。
 *
 * 流程：
 *   1. 从 graph-store 读取 loot.table + item.template 节点
 *   2. 装配 LootTables / ItemTable
 *   3. 对每个 loot.table 跑 N=LOOT_ROLL_N 次掷骰，统计 item 出现频率
 *   4. 聚合所有 loot.table 的分布
 *   5. 自检关键不变量（entries 上限 / group chance 范围）
 *
 * @param graphStore graph-store 实例（读取 Resource Graph 节点）
 * @param _snapshot 后端权威快照（runner 提取 backendSnapshot 给 comparator，本镜像器不直接读取）
 * @returns 镜像输出 + 不变量违反列表
 */
export async function run(
  graphStore: GraphStore,
  _snapshot: MirrorSnapshot,
): Promise<MirrorRunOutput> {
  // 1. 读取 graph 节点
  const lootTableNodes = graphStore.findNodesByKind('loot.table') as ReadonlyArray<{
    id: string;
    data: LootTableData;
  }>;
  const itemNodes = graphStore.findNodesByKind('item.template');

  // 2. 装配算法输入
  const lootTables = buildLootTables(lootTableNodes);
  const itemTable = buildItemTable(itemNodes);

  // 3. 逐 loot.table 跑 N 次掷骰
  const rng = createRng(LOOT_ROLL_DEFAULT_SEED);
  const tableResults: LootTableRollResult[] = [];
  const aggregateDistribution: Record<string, number> = {};
  let totalCount = 0;

  for (const node of lootTableNodes) {
    const tableId = node.id;
    const table = lootTables[tableId];
    if (!table) continue;

    const entriesCount = countEntries(table);
    const itemFrequencies: Record<string, number> = {};
    const context: RollLootTableContext = {};

    for (let i = 0; i < LOOT_ROLL_N; i++) {
      const items: ItemInstance[] = oblRollLootTable(tableId, lootTables, itemTable, rng, context);
      for (const item of items) {
        const id = item.itmid;
        itemFrequencies[id] = (itemFrequencies[id] ?? 0) + 1;
        aggregateDistribution[id] = (aggregateDistribution[id] ?? 0) + 1;
        totalCount++;
      }
    }

    tableResults.push({
      tableId,
      totalRolls: LOOT_ROLL_N,
      itemFrequencies,
      entriesCount,
    });
  }

  // 4. 不变量校验
  const invariantViolations: InvariantViolation[] = [];
  invariantViolations.push(...checkEntriesLimitInvariant(tableResults));
  invariantViolations.push(...checkGroupChanceInvariant(lootTableNodes));

  // 5. 构造输出
  const output: LootRollMirrorOutput = {
    count: totalCount,
    distribution: aggregateDistribution,
    tableResults,
    totalTables: lootTableNodes.length,
  };

  return {
    output,
    invariantViolations,
  };
}

/**
 * loot-roll 镜像器实例。
 */
export const lootRollMirror: Mirror = {
  id: LOOT_ROLL_MIRROR_ID,
  requiredScopes: LOOT_ROLL_REQUIRED_SCOPES,
  compareOptions: LOOT_ROLL_COMPARE_OPTIONS,
  run,
};
