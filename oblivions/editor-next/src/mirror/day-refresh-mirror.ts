/**
 * @module O 内容工具箱
 *
 * 镜像器 2：day_changed scatter refresh。
 *
 * 镜像目标（执行案 §4.2.3）：
 * - 后端函数：obl_refresh_wild_items(array $transition)（wild_refresh.func.php:54-215）
 * - 后端随机源：mt_rand() / mt_getrandmax()（rate 判定）
 * - 关键耦合点：obl_config.wild_item_refresh_rate_by_tide（shallow=0.5 / deep=1.0 / abyss=1.5）
 *
 * 镜像器实现：
 * - 输入：Resource Graph 中的 distribution.scatter（refresh 相位）+ world.tile +
 *   obl_config.wild_item_refresh_rate_by_tide
 * - 输出：前端镜像的 scatter refresh 结果（每格新增的 item 数量）
 * - 算法：复用 obl-refresh-wild-items + mulberry32
 *
 * 关键不变量：
 * - refresh 只在 wild_item_refresh_mode='daily' 时触发
 * - refresh 只刷新"已发现过（fog=1 OR last_refresh_day>0）"且"本日尚未刷新（last_refresh_day < current_day）"的格
 * - refresh 受 wild_item_capacity_per_tile=5 容量上限约束
 * - effective_rate = rate × wild_item_refresh_rate_by_tide[tide]，运行时 clamp 到 [0,1]
 *
 * 对比方式：
 * - 使用 debug.trigger_day_changed 命令触发后端 day refresh
 * - 通过 game_map scope 拉取后端 refresh 后的 scatter 全集
 * - 数量对比 + 分布对比，容忍度 10%
 *
 * P6-3 阶段实现说明：
 * - 复用 P6-2 的 obl-refresh-wild-items 算法
 * - 镜像器假设所有 passable tile 均已发现（fog=1）——P6 镜像不模拟玩家探索路径，
 *   "已发现"状态由后端权威快照提供，镜像器只校验"已发现"格的 refresh 行为
 * - currentCounts 初始为 0（假设开局后第一次 day_changed，无遗留野生道具）
 * - PRNG 使用固定 seed DAY_REFRESH_DEFAULT_SEED 保证可复现
 *
 * @mirror-of oblivions/include/game/wild_refresh.func.php:54-215 (obl_refresh_wild_items)
 */

import type { useGraphStore } from '@/graph/graph-store';
import type { Mirror, MirrorRunOutput } from './index';
import type { StateScope } from './snapshot-fetcher';
import type { CompareOptions, InvariantViolation } from './snapshot-comparator';
import type { MirrorSnapshot } from './snapshot-fetcher';
import { createRng } from '@/shared/algorithms/seed-random';
import {
  oblRefreshWildItems,
  type DayTransition,
  type RefreshedWildItem,
  type TileRefreshState,
  type TileRefreshStateMap,
} from './algorithms/obl-refresh-wild-items';
import type { TileMap } from './algorithms/obl-generate-wild-items';
import type {
  ItemTable,
  ScatterPool,
  ScatterEntry,
  WildItemRefreshConfig,
} from './algorithms/types';

type GraphStore = ReturnType<typeof useGraphStore>;

export const DAY_REFRESH_MIRROR_ID = 'day-refresh';

export const DAY_REFRESH_REQUIRED_SCOPES: readonly StateScope[] = [
  'game_map',
  'debug_gamevars',
];

/**
 * day-refresh 镜像器对比配置（执行案 §4.2.3）。
 *
 * 数量容忍度 10%——因 PHP mt_rand 与 TS mulberry32 算法不同，单次结果必有差异，
 * P6 校验"统计分布一致"而非"单次结果一致"。
 */
export const DAY_REFRESH_COMPARE_OPTIONS: CompareOptions = {
  countTolerance: 0.10,
  distributionTolerance: 0.10,
};

/**
 * 镜像器默认 seed——固定正整数保证可复现（对齐设计案 §3.7.4）。
 */
export const DAY_REFRESH_DEFAULT_SEED = 20240602;

/**
 * 镜像器默认模拟的"当前天数"——day_changed 触发后的目标天数。
 *
 * 取 2（非 1）避免 currentDay <= 0 的边界跳过逻辑。
 */
export const DAY_REFRESH_DEFAULT_CURRENT_DAY = 2;

/**
 * day-refresh 镜像输出结构——传给 snapshot-comparator 作为 actual。
 *
 * - count：refresh 生成的新增野生道具总数
 * - distribution：tide × region 矩阵分布（key=`refresh:${tide}:${pgroup}`）
 * - refreshedItems：refresh 明细（含 pls + item_id）
 * - mode：实际生效的 refresh_mode（用于不变量校验）
 * - capacityPerTile：实际生效的容量上限
 * - tideRate：实际生效的 tide 倍率表
 */
export interface DayRefreshMirrorOutput {
  /** refresh 生成的新增野生道具总数 */
  count: number;
  /** tide × region 矩阵分布（key=`refresh:${tide}:${pgroup}`） */
  distribution: Record<string, number>;
  /** refresh 明细 */
  refreshedItems: RefreshedWildItem[];
  /** 实际生效的 refresh_mode */
  mode: string;
  /** 实际生效的容量上限 */
  capacityPerTile: number;
  /** 实际生效的 tide 倍率表 */
  tideRate: Record<string, number>;
}

// ─── Graph 节点 data 形状（与 schema/kinds/* 对齐） ────────────────

interface WorldTileData {
  pgroup: number;
  pls: number;
  tide: string;
  passable: boolean;
  [key: string]: unknown;
}

interface DistributionScatterData {
  'subject.item_id'?: string;
  'selector.tides'?: string[];
  phase?: string;
  'placement.rate'?: number;
  'placement.count'?: number | [number, number];
  [key: string]: unknown;
}

interface ConfigRuntimeData {
  entries?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── 数据装配辅助 ───────────────────────────────────────────────

/**
 * 按 pgroup 分桶 world.tile 节点为 TileMap（与 world-init-mirror 一致）。
 */
function buildTilesByRegion(
  tileNodes: ReadonlyArray<{ id: string; data: WorldTileData }>,
): Map<number, TileMap> {
  const byRegion = new Map<number, TileMap>();
  for (const node of tileNodes) {
    const d = node.data;
    if (typeof d.pgroup !== 'number') continue;
    if (typeof d.pls !== 'number') continue;
    if (typeof d.tide !== 'string') continue;
    if (typeof d.passable !== 'boolean') continue;
    let regionMap = byRegion.get(d.pgroup);
    if (!regionMap) {
      regionMap = {};
      byRegion.set(d.pgroup, regionMap);
    }
    regionMap[d.pls] = { passable: d.passable, tide: d.tide };
  }
  return byRegion;
}

/**
 * 装配 ScatterPool（仅 refresh 相位）——distribution.scatter 节点 → ScatterPool。
 *
 * 与 world-init-mirror 的 buildScatterPool 一致，但本镜像器只关心 refresh 相位。
 */
function buildScatterPool(
  scatterNodes: ReadonlyArray<{ id: string; data: DistributionScatterData }>,
): ScatterPool {
  const pool: ScatterPool = {};
  for (const node of scatterNodes) {
    const d = node.data;
    const tides = d['selector.tides'] ?? [];
    const phaseKey = d.phase === 'day_refresh' ? 'refresh' : 'initial';
    const entry: ScatterEntry = {
      item_id: d['subject.item_id'] ?? '',
      count: d['placement.count'],
      rate: d['placement.rate'],
    };
    for (const tide of tides) {
      if (!pool[tide]) pool[tide] = {};
      const tideEntry = pool[tide]!;
      if (!tideEntry[phaseKey]) tideEntry[phaseKey] = [];
      tideEntry[phaseKey]!.push(entry);
    }
  }
  return pool;
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
 * 从 config.runtime:obl_config 节点提取 wild_item_refresh 配置。
 *
 * 返回 WildItemRefreshConfig，缺失字段由 obl-refresh-wild-items 内部默认值兜底：
 *   - mode 缺失按 'daily' 计
 *   - capacity 缺失按 5 计
 *   - tideRate 缺失按 {} 计（各 tide 倍率默认 1.0）
 */
function extractRefreshConfig(
  configNodes: ReadonlyArray<{ id: string; data: ConfigRuntimeData }>,
): WildItemRefreshConfig {
  for (const node of configNodes) {
    if (node.id !== 'obl_config') continue;
    const entries = node.data.entries;
    if (!entries) continue;
    const cfg: WildItemRefreshConfig = {};
    const mode = entries.wild_item_refresh_mode;
    if (typeof mode === 'string') cfg.wild_item_refresh_mode = mode;
    const cap = entries.wild_item_capacity_per_tile;
    if (typeof cap === 'number') cfg.wild_item_capacity_per_tile = cap;
    const rate = entries.wild_item_refresh_rate_by_tide;
    if (rate && typeof rate === 'object' && !Array.isArray(rate)) {
      cfg.wild_item_refresh_rate_by_tide = rate as Record<string, number>;
    }
    return cfg;
  }
  return {};
}

/**
 * 装配 TileRefreshStateMap——假设所有 passable tile 均已发现（fog=1）。
 *
 * P6 镜像不模拟玩家探索路径——"已发现"状态由后端权威快照提供，镜像器只校验
 * "已发现"格的 refresh 行为。此处统一标记为已发现，使所有 passable tile 参与 refresh。
 *
 * - last_refresh_day=0：表示本日尚未刷新（currentDay > 0 时刷新会触发）
 * - fog=1：表示已发现
 */
function buildTileStates(
  tilesByRegion: Map<number, TileMap>,
): Map<number, TileRefreshStateMap> {
  const byRegion = new Map<number, TileRefreshStateMap>();
  for (const [pgroup, tiles] of tilesByRegion) {
    const stateMap: TileRefreshStateMap = {};
    for (const plsStr of Object.keys(tiles)) {
      const pls = Number(plsStr);
      const tile = tiles[pls];
      if (!tile || !tile.passable) continue;
      const state: TileRefreshState = {
        last_refresh_day: 0,
        fog: 1,
      };
      stateMap[pls] = state;
    }
    byRegion.set(pgroup, stateMap);
  }
  return byRegion;
}

// ─── 不变量校验 ─────────────────────────────────────────────────

/**
 * 校验"refresh 只在 wild_item_refresh_mode='daily' 时触发"。
 *
 * mode != 'daily' 时，oblRefreshWildItems 返回空数组——这是预期行为，不算违反。
 * 但如果调用方期望 refresh 发生（mode='daily'）却得到空结果，可能是配置错误。
 * 此处仅记录实际 mode 到 output，由 comparator 与后端对比。
 */

/**
 * 校验"refresh 受 wild_item_capacity_per_tile 容量上限约束"。
 *
 * 检查 refresh 结果中每格新增数量不超过 capacity_per_tile。
 * 注意：oblRefreshWildItems 内部已有容量保护，本校验是防御性二次检查。
 */
function checkCapacityInvariant(
  refreshedItems: RefreshedWildItem[],
  capacityPerTile: number,
): InvariantViolation | null {
  // 按 pls 统计新增数量（跨 region 合并，因 pls 在 region 内唯一）
  // 注：不同 region 可能有相同 pls，因此用 `${pgroup}:${pls}` 作为 key
  // 但 RefreshedWildItem 只有 pls 字段——这里按 pls 统计，保守上界检查
  const countByPls = new Map<number, number>();
  for (const item of refreshedItems) {
    const cnt = countByPls.get(item.pls) ?? 0;
    countByPls.set(item.pls, cnt + 1);
  }
  for (const [pls, cnt] of countByPls) {
    if (cnt > capacityPerTile) {
      return {
        name: 'refresh_exceeds_capacity',
        detail: `pls=${pls} 的 refresh 新增数量 ${cnt} 超过容量上限 ${capacityPerTile}`,
      };
    }
  }
  return null;
}

/**
 * 校验"effective_rate = rate × tide_multiplier，clamp 到 [0,1]"。
 *
 * 检查 scatter 配置中的 effective_rate 是否有超 1.0 的情况——
 * 超出时 oblRefreshWildItems 内部会 clamp 到 1.0，但应记录为不变量违反
 * （配置层面的潜在问题，由 O-10 distribution.scatter.refresh_rate_overflow 提示）。
 */
function checkEffectiveRateInvariant(
  scatterNodes: ReadonlyArray<{ id: string; data: DistributionScatterData }>,
  tideRate: Record<string, number>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const node of scatterNodes) {
    const d = node.data;
    if (d.phase !== 'day_refresh') continue;
    const rate = typeof d['placement.rate'] === 'number' ? d['placement.rate'] : 0;
    if (rate <= 0) continue;
    const tides = d['selector.tides'] ?? [];
    for (const tide of tides) {
      const mult = typeof tideRate[tide] === 'number' ? tideRate[tide] : 1.0;
      const effRate = rate * mult;
      if (effRate > 1.0) {
        violations.push({
          name: 'refresh_effective_rate_overflow',
          detail: `distribution.scatter:${node.id} 的 effective_rate=${effRate.toFixed(3)} 超过 1.0（rate=${rate} × tide倍率=${mult}），运行时将 clamp 到 1.0`,
        });
      }
    }
  }
  return violations;
}

// ─── run 入口 ───────────────────────────────────────────────────

/**
 * 运行 day-refresh 镜像器——计算前端镜像的 scatter refresh 结果。
 *
 * 流程：
 *   1. 从 graph-store 读取 distribution.scatter + world.tile + config.runtime 节点
 *   2. 装配 ScatterPool / ItemTable / TileRefreshStateMap / WildItemRefreshConfig
 *   3. 构造 DayTransition（currentDay=DAY_REFRESH_DEFAULT_CURRENT_DAY）
 *   4. 逐 region 调用 oblRefreshWildItems 累积 refresh 结果
 *   5. 自检关键不变量（容量上限 / effective_rate clamp）
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
  const tileNodes = graphStore.findNodesByKind('world.tile') as ReadonlyArray<{
    id: string;
    data: WorldTileData;
  }>;
  const scatterDistNodes = graphStore.findNodesByKind('distribution.scatter') as ReadonlyArray<{
    id: string;
    data: DistributionScatterData;
  }>;
  const itemNodes = graphStore.findNodesByKind('item.template');
  const configNodes = graphStore.findNodesByKind('config.runtime') as ReadonlyArray<{
    id: string;
    data: ConfigRuntimeData;
  }>;

  // 2. 装配算法输入
  const tilesByRegion = buildTilesByRegion(tileNodes);
  const scatterPool = buildScatterPool(scatterDistNodes);
  const itemTable = buildItemTable(itemNodes);
  const cfg = extractRefreshConfig(configNodes);
  const tileStatesByRegion = buildTileStates(tilesByRegion);

  const mode = typeof cfg.wild_item_refresh_mode === 'string' ? cfg.wild_item_refresh_mode : 'daily';
  const capacityPerTile = typeof cfg.wild_item_capacity_per_tile === 'number'
    ? cfg.wild_item_capacity_per_tile
    : 5;
  const tideRate = cfg.wild_item_refresh_rate_by_tide ?? {};

  // 3. 构造 DayTransition
  const transition: DayTransition = {
    from: { day: DAY_REFRESH_DEFAULT_CURRENT_DAY - 1, phase: 'night' },
    to: { day: DAY_REFRESH_DEFAULT_CURRENT_DAY, phase: 'day' },
    tick: DAY_REFRESH_DEFAULT_CURRENT_DAY * 100,
  };

  // 4. 逐 region 生成
  const rng = createRng(DAY_REFRESH_DEFAULT_SEED);
  const allRefreshedItems: RefreshedWildItem[] = [];
  const distribution: Record<string, number> = {};

  for (const [pgroup, tiles] of tilesByRegion) {
    const tileStates = tileStatesByRegion.get(pgroup) ?? {};
    // currentCounts 初始为 0（假设开局后第一次 day_changed）
    const currentCounts: Record<string, number> = {};

    const refreshed = oblRefreshWildItems(
      transition,
      tiles,
      tileStates,
      currentCounts,
      scatterPool,
      itemTable,
      cfg,
      rng,
    );

    allRefreshedItems.push(...refreshed);
    for (const item of refreshed) {
      const tide = tiles[item.pls]?.tide ?? 'shallow';
      const key = `refresh:${tide}:${pgroup}`;
      distribution[key] = (distribution[key] ?? 0) + 1;
    }
  }

  // 5. 不变量校验
  const invariantViolations: InvariantViolation[] = [];

  // 5a. 容量上限
  const capViolation = checkCapacityInvariant(allRefreshedItems, capacityPerTile);
  if (capViolation) invariantViolations.push(capViolation);

  // 5b. effective_rate clamp
  invariantViolations.push(...checkEffectiveRateInvariant(scatterDistNodes, tideRate));

  // 6. 构造输出
  const output: DayRefreshMirrorOutput = {
    count: allRefreshedItems.length,
    distribution,
    refreshedItems: allRefreshedItems,
    mode,
    capacityPerTile,
    tideRate,
  };

  return {
    output,
    invariantViolations,
  };
}

/**
 * day-refresh 镜像器实例。
 */
export const dayRefreshMirror: Mirror = {
  id: DAY_REFRESH_MIRROR_ID,
  requiredScopes: DAY_REFRESH_REQUIRED_SCOPES,
  compareOptions: DAY_REFRESH_COMPARE_OPTIONS,
  run,
};
