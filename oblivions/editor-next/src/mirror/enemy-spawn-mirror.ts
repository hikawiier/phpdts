/**
 * @module O 内容工具箱
 *
 * 镜像器 5：敌人放置（J-1 生命周期）。
 *
 * 镜像目标（执行案 §4.2.6）：
 * - 后端函数：obl_init_enemies()（init.func.php:214-268）/
 *   obl_get_occupied_positions($pgroup)（init.func.php:367-375）/
 *   obl_pick_available_tile($available_pls, $occupied) /
 *   obl_create_enemy_record($enemy_type, $pgroup, $pls)（init.func.php:278-359）
 * - 后端随机源：rand($entry['count'][0], $entry['count'][1])（count 取值）+
 *   array_rand($candidates)（选格）
 *
 * 镜像器实现：
 * - 输入：Resource Graph 中的 distribution.enemy + enemy.template + world.tile + world.region 节点
 * - 输出：前端镜像的敌人放置结果（位置 + 类型 + 数量 + tide/region 分布）
 * - 算法：复用 obl-init-enemies（已移植 obl_init_enemies + obl_pick_available_tile）
 *
 * 与 world-init-mirror 的差异：
 * - world-init-mirror 综合 POI + scatter + enemy 三类放置，enemy 部分仅做总量校验
 * - enemy-spawn-mirror 专注敌人放置，提供更细粒度的 per-region / per-tide / per-type 分布
 *   与不变量校验，供 enemies scope 1:1 对比
 *
 * 关键不变量：
 * - 敌人放置数量 ≤ distribution.enemy.placement.count × region 数
 * - 排除不可通行格 / 入口 / 出口 / 已占用格
 * - 每格最多一个敌人
 * - count=[min,max] 时运行时 rand($lo, $hi) 取值
 * - 敌人类型必须引用有效 enemy.template（schema 第 3 层引用校验已保证，本镜像器做防御性检查）
 *
 * 对比方式：
 * - 使用 debug.enemy.spawn 命令触发后端敌人生成
 * - 通过 enemies scope 拉取后端敌人列表
 * - 数量对比 + 分布对比，容忍度 10%
 *
 * P6-3 阶段实现说明：
 * - 复用 P6-2 的 obl-init-enemies 算法（含 oblPickAvailableTile + resolveEnemyCount + bucketTilesByTide）
 * - occupiedPositions 初始为空集合（P6 镜像不模拟玩家初始位置与已生成 NPC，
 *   "动态占用"由后端权威快照提供）
 * - PRNG 使用 createRng(ENEMY_SPAWN_DEFAULT_SEED) 保证可复现
 *
 * @mirror-of oblivions/include/gamectl/init.func.php:214-268 (obl_init_enemies)
 * @mirror-of oblivions/include/gamectl/init.func.php:384-393 (obl_pick_available_tile)
 */

import type { useGraphStore } from '@/graph/graph-store';
import type { Mirror, MirrorRunOutput } from './index';
import type { StateScope } from './snapshot-fetcher';
import type { CompareOptions, InvariantViolation } from './snapshot-comparator';
import type { MirrorSnapshot } from './snapshot-fetcher';
import { createRng } from '@/shared/algorithms/seed-random';
import { oblInitEnemies, type PlacedEnemy } from './algorithms/obl-init-enemies';
import type { TileMap, TileInfo } from './algorithms/obl-generate-wild-items';
import type { EnemyPool, EnemyPoolEntry, RegionInfo } from './algorithms/types';

type GraphStore = ReturnType<typeof useGraphStore>;

export const ENEMY_SPAWN_MIRROR_ID = 'enemy-spawn';

export const ENEMY_SPAWN_REQUIRED_SCOPES: readonly StateScope[] = [
  'enemies',
  'game_map',
];

/**
 * enemy-spawn 镜像器对比配置（执行案 §4.2.6）。
 *
 * 数量容忍度 10%——因 PHP rand/array_rand 与 TS mulberry32 算法不同，单次结果必有差异，
 * P6 校验"统计分布一致"而非"单次结果一致"。
 */
export const ENEMY_SPAWN_COMPARE_OPTIONS: CompareOptions = {
  countTolerance: 0.10,
  distributionTolerance: 0.10,
};

/**
 * 镜像器默认 seed——固定正整数保证可复现（对齐设计案 §3.7.4）。
 *
 * 与 world-init-mirror 的 WORLD_INIT_DEFAULT_SEED 不同——本镜像器独立运行，
 * 使用自己的 seed 避免与 world-init-mirror 的 PRNG 序列耦合。
 */
export const ENEMY_SPAWN_DEFAULT_SEED = 20240605;

/**
 * enemy-spawn 镜像输出结构——传给 snapshot-comparator 作为 actual。
 *
 * - count：前端镜像的敌人放置总数
 * - distribution：tide × region 矩阵分布（key=`enemy:${tide}:${pgroup}`）
 * - placedEnemies：敌人放置明细（含 pgroup + pls + enemy_type）
 * - perRegionCount：每个 region 的敌人数量（key=pgroup，value=count）
 * - perTypeCount：每个 enemy_type 的敌人数量（key=enemy_type，value=count）
 * - totalRegions：参与放置的 region 数量
 * - totalEnemyTypes：参与的敌人类型数量
 */
export interface EnemySpawnMirrorOutput {
  /** 放置总数 */
  count: number;
  /** tide × region 矩阵分布（key=`enemy:${tide}:${pgroup}`） */
  distribution: Record<string, number>;
  /** 放置明细 */
  placedEnemies: PlacedEnemy[];
  /** 每 region 的敌人数量（key=pgroup，value=count） */
  perRegionCount: Record<number, number>;
  /** 每 enemy_type 的敌人数量（key=enemy_type，value=count） */
  perTypeCount: Record<number, number>;
  /** 参与放置的 region 数量 */
  totalRegions: number;
  /** 参与的敌人类型数量 */
  totalEnemyTypes: number;
}

// ─── Graph 节点 data 形状（与 schema/kinds/* 对齐） ────────────────

interface WorldRegionData {
  pgroup: number;
  entrance_pls: number | null;
  exit_pls: number | null;
  [key: string]: unknown;
}

interface WorldTileData {
  pgroup: number;
  pls: number;
  tide: string;
  passable: boolean;
  [key: string]: unknown;
}

/**
 * distribution.enemy 节点 data 形状（与 schema/kinds/distribution-enemy.ts 对齐）。
 *
 * schema 字段 key 是带点的扁平字符串（如 'subject.enemy_type'），适配器按 schema 字段 key
 * 直接存储，data 中以这些带点 key 为属性名（与 world-init-mirror 一致）。
 */
interface DistributionEnemyData {
  'subject.enemy_type'?: number | string;
  'selector.tides'?: string[];
  'selector.regions'?: string[];
  'selector.excludeEntrance'?: boolean;
  'selector.excludeExit'?: boolean;
  'selector.excludeOccupied'?: boolean;
  'placement.count'?: number | [number, number];
  [key: string]: unknown;
}

// ─── 数据装配辅助 ───────────────────────────────────────────────

/**
 * 按 pgroup 分桶 world.tile 节点为 TileMap（与 world-init-mirror 一致）。
 *
 * TileMap 的 key 是 pls（number），value 含 passable + tide。
 * pls 是区域内局部索引，因此按 pgroup 分桶避免跨区域 pls 冲突。
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
 * 装配 EnemyPool——distribution.enemy 节点 → EnemyPool（tide → entries[]）。
 *
 * 与 world-init-mirror 的 buildEnemyPool 一致，但本镜像器专注敌人放置，
 * 因此单独维护一份装配逻辑便于扩展（如未来支持 per-region 过滤）。
 */
function buildEnemyPool(
  enemyDistNodes: ReadonlyArray<{ id: string; data: DistributionEnemyData }>,
): EnemyPool {
  const pool: EnemyPool = {};
  for (const node of enemyDistNodes) {
    const d = node.data;
    const tides = d['selector.tides'] ?? [];
    const rawType = d['subject.enemy_type'];
    const enemyType = typeof rawType === 'number' ? rawType : Number(rawType ?? 0);
    const entry: EnemyPoolEntry = {
      enemy_type: enemyType,
      count: d['placement.count'],
    };
    for (const tide of tides) {
      if (!pool[tide]) pool[tide] = [];
      pool[tide].push(entry);
    }
  }
  return pool;
}

/**
 * 装配 region 元数据映射——world.region 节点 → Map<pgroup, RegionInfo>。
 *
 * 仅提取敌人放置所需字段（entrance_pls / exit_pls）。
 */
function buildRegionInfoMap(
  regionNodes: ReadonlyArray<{ id: string; data: WorldRegionData }>,
): Map<number, RegionInfo> {
  const map = new Map<number, RegionInfo>();
  for (const node of regionNodes) {
    const d = node.data;
    if (typeof d.pgroup !== 'number') continue;
    map.set(d.pgroup, {
      entrance_pls: d.entrance_pls,
      exit_pls: d.exit_pls,
    });
  }
  return map;
}

// ─── 不变量校验 ─────────────────────────────────────────────────

/**
 * 校验"敌人放置不重叠（每格最多一个）"。
 *
 * key=`${pgroup}:${pls}` 唯一标识一个格——不同 region 可能有相同 pls，
 * 因此必须用 pgroup + pls 联合作为 key。
 */
function checkNoOverlapInvariant(
  placedEnemies: PlacedEnemy[],
): InvariantViolation | null {
  const seen = new Set<string>();
  for (const e of placedEnemies) {
    const key = `${e.pgroup}:${e.pls}`;
    if (seen.has(key)) {
      return {
        name: 'enemy_overlap',
        detail: `敌人在 pgroup=${e.pgroup} pls=${e.pls} 重叠放置（每格最多一个）`,
      };
    }
    seen.add(key);
  }
  return null;
}

/**
 * 校验"敌人放置数量 ≤ distribution.enemy.placement.count × region 数"。
 *
 * 上界估算：对每个 distribution.enemy 配置，max(count) × region 数。
 * - count 是单值时 max(count) = count
 * - count 是 [min,max] 时 max(count) = max
 *
 * 实际生成数量受候选格数限制（oblInitEnemies 内部 break），应远小于上界。
 */
function checkCountUpperBoundInvariant(
  placedEnemies: PlacedEnemy[],
  enemyDistNodes: ReadonlyArray<{ id: string; data: DistributionEnemyData }>,
  regionCount: number,
): InvariantViolation | null {
  if (regionCount === 0) return null;

  let upperBound = 0;
  for (const node of enemyDistNodes) {
    const d = node.data;
    const count = d['placement.count'];
    let maxCount: number;
    if (Array.isArray(count)) {
      const lo = typeof count[0] === 'number' ? count[0] : 1;
      const hi = typeof count[1] === 'number' ? count[1] : lo;
      maxCount = Math.max(lo, hi);
    } else if (typeof count === 'number') {
      maxCount = Math.floor(count);
    } else {
      maxCount = 1;
    }
    upperBound += maxCount * regionCount;
  }

  if (placedEnemies.length > upperBound) {
    return {
      name: 'enemy_count_exceeds_upper_bound',
      detail: `敌人放置数量 ${placedEnemies.length} 超过理论上界 ${upperBound}（max(count) × region 数）`,
    };
  }
  return null;
}

/**
 * 校验"敌人不放置在不可通行格 / 入口 / 出口"。
 *
 * 与 world-init-mirror 的 checkPlacementNotOnExcluded 中 enemy 部分逻辑一致，
 * 但本镜像器独立维护以支持更细粒度的错误报告。
 */
function checkPlacementNotOnExcluded(
  placedEnemies: PlacedEnemy[],
  tilesByRegion: Map<number, TileMap>,
  regionInfoMap: Map<number, RegionInfo>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // 构建 (pgroup, pls) → tile 索引
  const tileIndex = new Map<string, TileInfo>();
  for (const [pgroup, tiles] of tilesByRegion) {
    for (const plsStr of Object.keys(tiles)) {
      const pls = Number(plsStr);
      const tile = tiles[pls]!;
      tileIndex.set(`${pgroup}:${pls}`, tile);
    }
  }

  for (const e of placedEnemies) {
    const tile = tileIndex.get(`${e.pgroup}:${e.pls}`);
    if (!tile) continue;
    if (!tile.passable) {
      violations.push({
        name: 'enemy_on_impassable_tile',
        detail: `敌人放置在不可通行格 pgroup=${e.pgroup} pls=${e.pls}`,
      });
    }
    const regionInfo = regionInfoMap.get(e.pgroup);
    if (regionInfo) {
      if (regionInfo.entrance_pls !== null && regionInfo.entrance_pls === e.pls) {
        violations.push({
          name: 'enemy_on_entrance',
          detail: `敌人放置在入口格 pgroup=${e.pgroup} pls=${e.pls}`,
        });
      }
      if (regionInfo.exit_pls !== null && regionInfo.exit_pls === e.pls) {
        violations.push({
          name: 'enemy_on_exit',
          detail: `敌人放置在出口格 pgroup=${e.pgroup} pls=${e.pls}`,
        });
      }
    }
  }

  return violations;
}

/**
 * 校验"敌人类型必须引用有效 enemy.template"。
 *
 * schema 第 3 层引用校验已保证 distribution.enemy.subject.enemy_type 引用有效 enemy.template，
 * 本镜像器做防御性检查——若 enemy_type ≤ 0 或 NaN，记录不变量违反。
 */
function checkEnemyTypeValidInvariant(
  enemyDistNodes: ReadonlyArray<{ id: string; data: DistributionEnemyData }>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const node of enemyDistNodes) {
    const rawType = node.data['subject.enemy_type'];
    const enemyType = typeof rawType === 'number' ? rawType : Number(rawType ?? 0);
    if (!Number.isFinite(enemyType) || enemyType <= 0) {
      violations.push({
        name: 'enemy_type_invalid',
        detail: `distribution.enemy:${node.id} 的 subject.enemy_type 无效（值=${String(rawType)}），应为正整数引用 enemy.template.id`,
      });
    }
  }
  return violations;
}

// ─── run 入口 ───────────────────────────────────────────────────

/**
 * 运行 enemy-spawn 镜像器——计算前端镜像的敌人放置结果。
 *
 * 流程：
 *   1. 从 graph-store 读取 world.region / world.tile / distribution.enemy 节点
 *   2. 按 pgroup 分桶 world.tile 节点
 *   3. 装配 EnemyPool + region 元数据映射
 *   4. 逐 region 调用 oblInitEnemies 累积放置结果
 *   5. 自检关键不变量（不重叠 / 数量上界 / 不在排除格 / 类型有效）
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
  const regionNodes = graphStore.findNodesByKind('world.region') as ReadonlyArray<{
    id: string;
    data: WorldRegionData;
  }>;
  const tileNodes = graphStore.findNodesByKind('world.tile') as ReadonlyArray<{
    id: string;
    data: WorldTileData;
  }>;
  const enemyDistNodes = graphStore.findNodesByKind('distribution.enemy') as ReadonlyArray<{
    id: string;
    data: DistributionEnemyData;
  }>;

  // 2. 装配算法输入
  const tilesByRegion = buildTilesByRegion(tileNodes);
  const enemyPool = buildEnemyPool(enemyDistNodes);
  const regionInfoMap = buildRegionInfoMap(regionNodes);

  // 3. 逐 region 生成
  const rng = createRng(ENEMY_SPAWN_DEFAULT_SEED);
  const allPlacedEnemies: PlacedEnemy[] = [];
  const distribution: Record<string, number> = {};
  const perRegionCount: Record<number, number> = {};
  const perTypeCount: Record<number, number> = {};

  for (const regionNode of regionNodes) {
    const regionData = regionNode.data;
    const pgroup = regionData.pgroup;
    if (typeof pgroup !== 'number') continue;
    const tiles = tilesByRegion.get(pgroup) ?? {};
    const regionInfo = regionInfoMap.get(pgroup) ?? {
      entrance_pls: regionData.entrance_pls,
      exit_pls: regionData.exit_pls,
    };

    // P6 镜像不模拟玩家初始位置——initialOccupied 为空集
    // "动态占用"由后端权威快照提供，本镜像器只校验"放置规则一致性"
    const initialOccupied = new Set<number>();
    const enemies = oblInitEnemies(pgroup, regionInfo, tiles, enemyPool, initialOccupied, rng);
    allPlacedEnemies.push(...enemies);

    for (const e of enemies) {
      const tide = tiles[e.pls]?.tide ?? 'shallow';
      const key = `enemy:${tide}:${pgroup}`;
      distribution[key] = (distribution[key] ?? 0) + 1;
      perRegionCount[pgroup] = (perRegionCount[pgroup] ?? 0) + 1;
      perTypeCount[e.enemy_type] = (perTypeCount[e.enemy_type] ?? 0) + 1;
    }
  }

  // 4. 不变量校验
  const invariantViolations: InvariantViolation[] = [];

  // 4a. 敌人不重叠
  const overlapViolation = checkNoOverlapInvariant(allPlacedEnemies);
  if (overlapViolation) invariantViolations.push(overlapViolation);

  // 4b. 数量上界
  const countViolation = checkCountUpperBoundInvariant(
    allPlacedEnemies,
    enemyDistNodes,
    regionNodes.length,
  );
  if (countViolation) invariantViolations.push(countViolation);

  // 4c. 不放置在排除格
  invariantViolations.push(
    ...checkPlacementNotOnExcluded(allPlacedEnemies, tilesByRegion, regionInfoMap),
  );

  // 4d. 敌人类型有效
  invariantViolations.push(...checkEnemyTypeValidInvariant(enemyDistNodes));

  // 5. 构造输出
  const output: EnemySpawnMirrorOutput = {
    count: allPlacedEnemies.length,
    distribution,
    placedEnemies: allPlacedEnemies,
    perRegionCount,
    perTypeCount,
    totalRegions: regionNodes.length,
    totalEnemyTypes: Object.keys(perTypeCount).length,
  };

  return {
    output,
    invariantViolations,
  };
}

/**
 * enemy-spawn 镜像器实例。
 */
export const enemySpawnMirror: Mirror = {
  id: ENEMY_SPAWN_MIRROR_ID,
  requiredScopes: ENEMY_SPAWN_REQUIRED_SCOPES,
  compareOptions: ENEMY_SPAWN_COMPARE_OPTIONS,
  run,
};
