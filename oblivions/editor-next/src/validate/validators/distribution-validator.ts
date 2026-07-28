/**
 * @module O 内容工具箱
 *
 * 第 5 层：分布校验——distribution.poi / distribution.scatter / distribution.enemy
 * 三类分布的候选格与容量校验（P3 3 个 + P4 6 个 = 9 个 warning 规则）。
 *
 * 设计意图（执行案 §4.8.1 / §4.8.2）：
 *   - 复用 graph-store 的 world.tile / world.region 节点查询候选格
 *   - 候选格 = tile.tide ∈ selector.tides ∧ tile.passable=true
 *   - poi / enemy 候选格按 selector.excludeEntrance / excludeExit 扣除入口/出口格
 *   - scatter 候选格不扣除入口/出口/占用（运行时不查这些）
 *   - 按 region 分组统计可用 tile 数，对比 placement.count（per_region）
 *   - warning 级别——运行时按 E-9 / init.func.php / wild_refresh.func.php 既有
 *     "可用 tile 不足时自动调整"逻辑兜底，工具箱提示但不阻断构建
 *
 * 9 个规则：
 *   - distribution.poi.candidate_tile_insufficient（per region）：某 region 该 tide 无可用 tile
 *   - distribution.poi.per_region_capacity_conflict（per region）：per_region 数量超过该 region
 *     该 tide 的可用 tile 数（仅在 available > 0 时触发，available=0 由 candidate_tile_insufficient 接管）
 *   - distribution.poi.no_generatable_region（整体）：所有 region 该 tide 都无可用 tile
 *     （此规则触发时抑制 candidate_tile_insufficient，避免噪声）
 *   - distribution.scatter.candidate_tile_insufficient（per region）：scatter 的 tide 在某 region 无可用 tile
 *   - distribution.scatter.refresh_rate_overflow：refresh 相位 effective_rate（rate × tide 倍率）超过 1.0
 *   - distribution.scatter.capacity_conflict：某 tide × region 的 total rate × tile_count 期望值
 *     超过 wild_item_capacity_per_tile × tile_count
 *   - distribution.enemy.candidate_tile_insufficient（per region）：enemy 的 tide 在某 region
 *     无可用 tile（排除 entrance/exit/occupied 后为 0）
 *   - distribution.enemy.per_region_capacity_conflict（per region）：placement.count 超过
 *     该 region 该 tide 的可用 tile 数
 *   - distribution.enemy.comment_data_drift：enemy_pool.php 代码注释与实际 count 不一致
 *     （P4 投影器修复前的漂移检测；P4 修复后理论上不再触发）
 *
 * 候选格计算只处理统一模型形状（data 是对象，含 'subject.*' 字段）。
 * partitioned 模式（data 是数组/字典）是 O-4 适配器扩展前的过渡形态，
 * P3/P4 已完成适配器扩展，loader 投影出统一模型节点。
 *
 * 性能：当前规模 2 区域 × (47+39) tile = 86 格，单次校验 < 1ms，无需 RAF 分片。
 *
 * P4 扩展（执行案 §4.8.1 / §4.8.2）：
 *   - 新增 scatter / enemy 候选格计算与容量校验
 *   - scatter 候选格不应用 excludeEntrance/exit/occupied
 *   - enemy 候选格应用 excludeEntrance/exit（excludeOccupied P4 静态派生，不做实际扣除）
 *   - effective_rate = rate × obl_config.wild_item_refresh_rate_by_tide[tide]（仅 refresh 相位）
 *   - capacity_per_tile 从 obl_config.wild_item_capacity_per_tile 读取（默认 5）
 *   - 注释漂移检测从 rawFilesStore 读取 enemy_pool.php 原始内容
 */

import type { Issue } from '../issue-model';
import { makeIssue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';
import { findNodesByKind } from '@/graph/queries';
import { useRawFilesStore } from '@/stores/rawFilesStore';

// ─── 引用规则 ID 常量 ──────────────────────────────────────────

const RULE_DISTRIBUTION_POI_CANDIDATE_TILE_INSUFFICIENT =
  'distribution.poi.candidate_tile_insufficient';
const RULE_DISTRIBUTION_POI_PER_REGION_CAPACITY_CONFLICT =
  'distribution.poi.per_region_capacity_conflict';
const RULE_DISTRIBUTION_POI_NO_GENERATABLE_REGION =
  'distribution.poi.no_generatable_region';

// P4 新增 scatter 规则
const RULE_DISTRIBUTION_SCATTER_CANDIDATE_TILE_INSUFFICIENT =
  'distribution.scatter.candidate_tile_insufficient';
const RULE_DISTRIBUTION_SCATTER_REFRESH_RATE_OVERFLOW =
  'distribution.scatter.refresh_rate_overflow';
const RULE_DISTRIBUTION_SCATTER_CAPACITY_CONFLICT =
  'distribution.scatter.capacity_conflict';

// P4 新增 enemy 规则
const RULE_DISTRIBUTION_ENEMY_CANDIDATE_TILE_INSUFFICIENT =
  'distribution.enemy.candidate_tile_insufficient';
const RULE_DISTRIBUTION_ENEMY_PER_REGION_CAPACITY_CONFLICT =
  'distribution.enemy.per_region_capacity_conflict';
const RULE_DISTRIBUTION_ENEMY_COMMENT_DATA_DRIFT =
  'distribution.enemy.comment_data_drift';

// ─── 节点 data 形状（与 schema distribution-poi.ts / distribution-scatter.ts /
//                     distribution-enemy.ts / world-tile.ts / world-assembler.ts 对齐）───

/**
 * distribution.poi 统一模型 data 形状。
 *
 * schema 字段 key 是 'subject.poi_id' / 'selector.tides'（带点），适配器按 schema 字段 key
 * 直接存储，data 中以这些带点 key 为属性名。
 */
interface DistributionPoiData {
  /** 引用 poi.template.id */
  'subject.poi_id'?: string;
  /** 分布生效的潮汐区列表——枚举 shallow/deep/abyss，当前每条规则只有一个 tide */
  'selector.tides'?: string[];
  /** 分布生效的区域 ID 列表——留空=所有区域（当前运行时契约不支持 per-region 过滤） */
  'selector.regions'?: string[];
  /** true=排除区域入口格（对齐 J-1 / E-9 运行时默认） */
  'selector.excludeEntrance'?: boolean;
  /** true=排除区域出口格（对齐 J-1 / E-9 运行时默认） */
  'selector.excludeExit'?: boolean;
  /** per_region 数量——每个区域生成 N 个该 POI 实例 */
  'placement.count'?: number;
  [key: string]: unknown;
}

/** distribution.scatter 统一模型 data 形状（与 distribution-scatter.ts schema 对齐） */
interface DistributionScatterData {
  /** 引用 item.template.id */
  'subject.item_id'?: string;
  /** 分布生效的潮汐区列表 */
  'selector.tides'?: string[];
  /** 分布生效的区域 ID 列表——留空=所有区域 */
  'selector.regions'?: string[];
  /** scatter 不应用 entrance/exit/occupied 排除（运行时不查） */
  'selector.excludeEntrance'?: boolean;
  'selector.excludeExit'?: boolean;
  /** 相位——game_init / day_refresh */
  phase?: string;
  /** 基础生成率 0-1 */
  'placement.rate'?: number;
  /** 生成数量 int 或 [min,max] */
  'placement.count'?: number | [number, number];
  [key: string]: unknown;
}

/** distribution.enemy 统一模型 data 形状（与 distribution-enemy.ts schema 对齐） */
interface DistributionEnemyData {
  /** 引用 enemy.template.id（数字字符串） */
  'subject.enemy_type'?: number | string;
  /** 分布生效的潮汐区列表 */
  'selector.tides'?: string[];
  /** 分布生效的区域 ID 列表——留空=所有区域 */
  'selector.regions'?: string[];
  /** true=排除区域入口格（对齐 init.func.php:241-245 运行时默认） */
  'selector.excludeEntrance'?: boolean;
  /** true=排除区域出口格 */
  'selector.excludeExit'?: boolean;
  /** true=排除已占用格（P4 静态派生，不做实际扣除；P6 引入动态占用） */
  'selector.excludeOccupied'?: boolean;
  /** per_region 数量 int 或 [min,max] */
  'placement.count'?: number | [number, number];
  [key: string]: unknown;
}

/** world.tile 节点 data 形状（与 graph/assemblers/world-assembler.ts WorldTileData 对齐） */
interface WorldTileData {
  /** 所属区域 ID */
  pgroup: number;
  /** 区域内局部索引 */
  pls: number;
  /** 潮汐区——shallow / deep / abyss */
  tide: string;
  /** 是否可通行 */
  passable: boolean;
  [key: string]: unknown;
}

/** world.region 节点 data 形状（与 world-assembler.ts WorldRegionData 对齐） */
interface WorldRegionData {
  /** 区域 ID */
  pgroup: number;
  /** 入口格 pls（null=未设置） */
  entrance_pls: number | null;
  /** 出口格 pls（null=未设置） */
  exit_pls: number | null;
  [key: string]: unknown;
}

/** config.runtime 节点 data 形状（与 config-runtime.ts schema 对齐） */
interface ConfigRuntimeData {
  /** obl_config 全部键值对 */
  entries?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── 候选格索引构建 ────────────────────────────────────────────

/**
 * 候选格索引——按 (tide, pgroup) 分组存储 tile 的 pls 清单（仅 passable=true）。
 *
 * 存清单而非计数，便于精确扣除 entrance/exit：
 *   - excludeEntrance 时，从清单中移除 region.entrance_pls（如果存在）
 *   - excludeExit 时，从清单中移除 region.exit_pls（如果存在）
 *
 * region 入口/出口通过 world.region 的 entrance_pls / exit_pls 派生
 * （Tile 自身无 is_entrance/is_exit 字段）。
 */
interface CandidateTileIndex {
  /** (tide, pgroup) → passable tile 的 pls 集合 */
  tilesByTideAndRegion: Map<string, Map<number, Set<number>>>;
}

function buildCandidateTileIndex(
  tileNodes: ReadonlyArray<{ id: string; data: WorldTileData }>,
): CandidateTileIndex {
  const tilesByTideAndRegion = new Map<string, Map<number, Set<number>>>();

  for (const tile of tileNodes) {
    const data = tile.data;
    if (typeof data.pgroup !== 'number') continue;
    if (typeof data.tide !== 'string') continue;
    if (typeof data.pls !== 'number') continue;
    if (data.passable !== true) continue; // 仅可通行格计入候选

    let regionMap = tilesByTideAndRegion.get(data.tide);
    if (!regionMap) {
      regionMap = new Map();
      tilesByTideAndRegion.set(data.tide, regionMap);
    }
    let plsSet = regionMap.get(data.pgroup);
    if (!plsSet) {
      plsSet = new Set();
      regionMap.set(data.pgroup, plsSet);
    }
    plsSet.add(data.pls);
  }

  return { tilesByTideAndRegion };
}

/**
 * 查找指定 region 的 entrance_pls / exit_pls。
 */
function findRegionEntranceExit(
  regionNodes: ReadonlyArray<{ id: string; data: WorldRegionData }>,
  pgroup: number,
): { entrancePls: number | null; exitPls: number | null } {
  for (const region of regionNodes) {
    if (region.data.pgroup === pgroup) {
      return {
        entrancePls: region.data.entrance_pls ?? null,
        exitPls: region.data.exit_pls ?? null,
      };
    }
  }
  return { entrancePls: null, exitPls: null };
}

/**
 * 计算 distribution.poi / distribution.enemy 节点在某 region 的某 tide 下可用 tile 数。
 *
 * 扣除逻辑：
 *   - excludeEntrance=true 时，从 tile 集合中移除 region.entrance_pls（如果存在且属于该 tide 桶）
 *   - excludeExit=true 时，从 tile 集合中移除 region.exit_pls（如果存在且属于该 tide 桶）
 *
 * 因为索引存的是 Set<pls>，扣除是精确的——若 entrance/exit 格不属于该 tide 桶，
 * 不会出现在集合中，扣除无效。
 *
 * 注：P4 阶段 excludeOccupied 是静态派生（schema 中明确"假设所有 candidate tile 未被占用"），
 * 本函数不做 occupied 实际扣除；P6 镜像校验时引入动态占用。
 */
function countAvailableTiles(
  index: CandidateTileIndex,
  pgroup: number,
  tide: string,
  excludeEntrance: boolean,
  excludeExit: boolean,
  regionNodes: ReadonlyArray<{ id: string; data: WorldRegionData }>,
): number {
  const regionMap = index.tilesByTideAndRegion.get(tide);
  if (!regionMap) return 0;
  const plsSet = regionMap.get(pgroup);
  if (!plsSet || plsSet.size === 0) return 0;

  // 无需扣除时直接返回集合大小
  if (!excludeEntrance && !excludeExit) return plsSet.size;

  const { entrancePls, exitPls } = findRegionEntranceExit(regionNodes, pgroup);

  let available = plsSet.size;
  if (excludeEntrance && entrancePls !== null && plsSet.has(entrancePls)) {
    available -= 1;
  }
  if (excludeExit && exitPls !== null && plsSet.has(exitPls)) {
    available -= 1;
  }
  return Math.max(0, available);
}

// ─── obl_config 读取 ──────────────────────────────────────────

/**
 * 读取 obl_config 中的 wild_item_refresh_rate_by_tide 倍率表。
 *
 * refresh 相位的 effective_rate = rate × wild_item_refresh_rate_by_tide[tide]。
 * obl_config 未加载时退化为 1.0（不影响 initial 相位）。
 */
function getRefreshRateByTide(
  configNodes: ReadonlyArray<{ id: string; data: ConfigRuntimeData }>,
): Record<string, number> {
  const fallback: Record<string, number> = { shallow: 1, deep: 1, abyss: 1 };
  const node = configNodes.find((n) => n.id === 'obl_config');
  if (!node) return fallback;
  const entries = node.data.entries;
  if (!entries || typeof entries !== 'object') return fallback;
  const raw = (entries as Record<string, unknown>)['wild_item_refresh_rate_by_tide'];
  if (!raw || typeof raw !== 'object') return fallback;
  const result: Record<string, number> = { ...fallback };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number') result[k] = v;
  }
  return result;
}

/**
 * 读取 obl_config 中的 wild_item_capacity_per_tile（每格期望容量上界）。
 *
 * 默认值 5（与 oblivions/gamedata/obl_config.php 中的默认值对齐）。
 */
function getWildItemCapacityPerTile(
  configNodes: ReadonlyArray<{ id: string; data: ConfigRuntimeData }>,
): number {
  const node = configNodes.find((n) => n.id === 'obl_config');
  if (!node) return 5;
  const entries = node.data.entries;
  if (!entries || typeof entries !== 'object') return 5;
  const raw = (entries as Record<string, unknown>)['wild_item_capacity_per_tile'];
  if (typeof raw !== 'number') return 5;
  return raw;
}

// ─── P4: distribution.scatter 校验 ──────────────────────────────

/**
 * 校验 distribution.scatter 节点（3 个 warning 规则）。
 *
 * scatter 候选格计算（执行案 §4.8.2）：
 *   - tile.tide ∈ selector.tides ∧ tile.passable=true
 *   - 不应用 excludeEntrance / excludeExit / excludeOccupied（scatter 运行时不查这些）
 *
 * 三个规则：
 *   - candidate_tile_insufficient：某 region 该 tide 无可用 tile
 *   - refresh_rate_overflow：refresh 相位 effective_rate > 1.0
 *   - capacity_conflict：某 tide × region 的 total rate × tile_count >
 *     wild_item_capacity_per_tile × tile_count（简化为 total rate > capacity_per_tile）
 */
function validateScatter(
  index: CandidateTileIndex,
  allPgroups: number[],
  configNodes: ReadonlyArray<{ id: string; data: ConfigRuntimeData }>,
): Issue[] {
  const issues: Issue[] = [];

  const scatterNodes = findNodesByKind<DistributionScatterData>('distribution.scatter');
  if (scatterNodes.length === 0) return issues;

  const refreshRateByTide = getRefreshRateByTide(configNodes);
  const capacityPerTile = getWildItemCapacityPerTile(configNodes);

  // 按 (tide, pgroup) 累计 total rate，用于 capacity_conflict 校验
  const totalRateByTideAndRegion = new Map<string, number>();
  // 按 (tide, pgroup) 统计可用 tile 数（scatter 不扣除 entrance/exit）
  const tileCountByTideAndRegion = new Map<string, number>();

  for (const node of scatterNodes) {
    if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) continue;

    const data = node.data;
    const tides = data['selector.tides'] ?? [];
    if (tides.length === 0) continue;

    const phase = typeof data.phase === 'string' ? data.phase : 'game_init';
    const rate = typeof data['placement.rate'] === 'number' ? data['placement.rate'] : 0;

    // refresh_rate_overflow：refresh 相位 effective_rate > 1.0
    if (phase === 'day_refresh') {
      for (const tide of tides) {
        const multiplier = refreshRateByTide[tide] ?? 1;
        const effectiveRate = rate * multiplier;
        if (effectiveRate > 1.0) {
          issues.push(
            makeIssue({
              ruleId: RULE_DISTRIBUTION_SCATTER_REFRESH_RATE_OVERFLOW,
              severity: 'warning',
              message: `distribution.scatter:${node.id} 的 refresh 相位 effective_rate=${effectiveRate.toFixed(3)} 超过 1.0（rate=${rate} × tide倍率=${multiplier}），运行时会 clamp 到 1.0`,
              resourceRef: { kind: 'distribution.scatter', id: node.id },
              hint: `降低 placement.rate 到 ≤ ${(1.0 / multiplier).toFixed(3)}，或调整 obl_config.wild_item_refresh_rate_by_tide`,
              location: { pgroup: null, pls: null, field: 'placement.rate' },
            }),
          );
        }
      }
    }

    // 累计 total rate（用于 capacity_conflict）
    const regionFilter = data['selector.regions'] ?? [];
    const targetPgroups = regionFilter.length > 0
      ? allPgroups.filter((p) => regionFilter.includes(String(p)))
      : allPgroups;

    for (const tide of tides) {
      for (const pgroup of targetPgroups) {
        // scatter 候选格不扣除 entrance/exit——直接取索引中的 pls 集合大小
        const regionMap = index.tilesByTideAndRegion.get(tide);
        const plsSet = regionMap?.get(pgroup);
        const tileCount = plsSet?.size ?? 0;

        const key = `${tide}:${pgroup}`;
        totalRateByTideAndRegion.set(
          key,
          (totalRateByTideAndRegion.get(key) ?? 0) + rate,
        );
        if (!tileCountByTideAndRegion.has(key) || tileCountByTideAndRegion.get(key)! < tileCount) {
          tileCountByTideAndRegion.set(key, tileCount);
        }

        // candidate_tile_insufficient：scatter 该 region 该 tide 无可用 tile
        if (tileCount === 0) {
          issues.push(
            makeIssue({
              ruleId: RULE_DISTRIBUTION_SCATTER_CANDIDATE_TILE_INSUFFICIENT,
              severity: 'warning',
              message: `distribution.scatter:${node.id} 在 region ${pgroup} 的 tide=${tide} 无可用 tile（passable=true）`,
              resourceRef: { kind: 'distribution.scatter', id: node.id },
              hint: `调整 world.tile 的 tide/passable，或修改 selector.tides`,
              location: { pgroup, pls: null, field: `selector.tides[${tide}]` },
            }),
          );
        }
      }
    }
  }

  // capacity_conflict：某 tide × region 的 total rate > wild_item_capacity_per_tile
  // （期望值 = total_rate × tile_count，容量 = capacity_per_tile × tile_count，
  //   tile_count > 0 时简化为 total_rate > capacity_per_tile）
  for (const [key, totalRate] of totalRateByTideAndRegion) {
    const tileCount = tileCountByTideAndRegion.get(key) ?? 0;
    if (tileCount === 0) continue; // tile_count=0 由 candidate_tile_insufficient 接管
    if (totalRate > capacityPerTile) {
      const [tide, pgroupStr] = key.split(':');
      const pgroup = Number(pgroupStr);
      issues.push(
        makeIssue({
          ruleId: RULE_DISTRIBUTION_SCATTER_CAPACITY_CONFLICT,
          severity: 'warning',
          message: `tide=${tide} × region=${pgroup} 的 total rate=${totalRate.toFixed(3)} 超过 wild_item_capacity_per_tile=${capacityPerTile}（tile_count=${tileCount}）`,
          resourceRef: { kind: 'distribution.scatter', id: `${tide}:${pgroup}` },
          hint: `降低该 tide × region 下 scatter 规则的 placement.rate 总和到 ≤ ${capacityPerTile}`,
          location: { pgroup, pls: null, field: 'placement.rate' },
        }),
      );
    }
  }

  return issues;
}

// ─── P4: distribution.enemy 校验 ──────────────────────────────

/**
 * 校验 distribution.enemy 节点（2 个 warning 规则 + 1 个注释漂移检测）。
 *
 * enemy 候选格计算（执行案 §4.8.2）：
 *   - tile.tide ∈ selector.tides ∧ tile.passable=true
 *   - 应用 excludeEntrance / excludeExit（对齐 init.func.php:241-245）
 *   - excludeOccupied P4 静态派生，不做实际扣除（schema 明确"假设所有 candidate tile 未被占用"）
 *
 * 三个规则：
 *   - candidate_tile_insufficient：排除 entrance/exit 后某 region 该 tide 无可用 tile
 *   - per_region_capacity_conflict：placement.count 超过该 region 该 tide 的可用 tile 数
 *   - comment_data_drift：enemy_pool.php 代码注释与实际 count 不一致（P4 修复前的检测）
 */
function validateEnemy(
  index: CandidateTileIndex,
  allPgroups: number[],
  regionNodes: ReadonlyArray<{ id: string; data: WorldRegionData }>,
): Issue[] {
  const issues: Issue[] = [];

  const enemyNodes = findNodesByKind<DistributionEnemyData>('distribution.enemy');
  if (enemyNodes.length === 0) return issues;

  for (const node of enemyNodes) {
    if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) continue;

    const data = node.data;
    const tides = data['selector.tides'] ?? [];
    if (tides.length === 0) continue;

    const excludeEntrance = data['selector.excludeEntrance'] !== false; // 默认 true
    const excludeExit = data['selector.excludeExit'] !== false; // 默认 true
    const countValue = data['placement.count'];
    // count 可能是 int 或 [min,max]——取上界作为最坏情况
    const perRegionCount = typeof countValue === 'number'
      ? countValue
      : Array.isArray(countValue) && countValue.length === 2
        ? countValue[1]
        : 0;

    const regionFilter = data['selector.regions'] ?? [];
    const targetPgroups = regionFilter.length > 0
      ? allPgroups.filter((p) => regionFilter.includes(String(p)))
      : allPgroups;

    for (const tide of tides) {
      // 统计每个 region 的可用 tile 数
      const perRegionAvailable: Array<{ pgroup: number; available: number }> = [];
      for (const pgroup of targetPgroups) {
        const available = countAvailableTiles(
          index,
          pgroup,
          tide,
          excludeEntrance,
          excludeExit,
          regionNodes,
        );
        perRegionAvailable.push({ pgroup, available });
      }

      for (const { pgroup, available } of perRegionAvailable) {
        if (available === 0) {
          issues.push(
            makeIssue({
              ruleId: RULE_DISTRIBUTION_ENEMY_CANDIDATE_TILE_INSUFFICIENT,
              severity: 'warning',
              message: `distribution.enemy:${node.id} 在 region ${pgroup} 的 tide=${tide} 无可用 tile（passable + excludeEntrance/Exit 后为 0）`,
              resourceRef: { kind: 'distribution.enemy', id: node.id },
              hint: `调整 world.tile 的 tide/passable，或修改 selector.tides，或关闭 excludeEntrance/Exit`,
              location: { pgroup, pls: null, field: `selector.tides[${tide}]` },
            }),
          );
        } else if (perRegionCount > available) {
          issues.push(
            makeIssue({
              ruleId: RULE_DISTRIBUTION_ENEMY_PER_REGION_CAPACITY_CONFLICT,
              severity: 'warning',
              message: `distribution.enemy:${node.id} 的 placement.count 上界=${perRegionCount} 超过 region ${pgroup} tide=${tide} 的可用 tile 数 ${available}`,
              resourceRef: { kind: 'distribution.enemy', id: node.id },
              hint: `降低 placement.count 到 ≤ ${available}，或增加该 region 该 tide 的 passable tile`,
              location: { pgroup, pls: null, field: 'placement.count' },
            }),
          );
        }
      }
    }
  }

  // 注释漂移检测（独立函数，需读取 rawFilesStore）
  issues.push(...checkEnemyCommentDrift(enemyNodes));

  return issues;
}

// ─── P4: enemy_pool.php 注释漂移检测 ──────────────────────────

/**
 * 检测 enemy_pool.php 中代码注释与实际 count 是否一致。
 *
 * 漂移模式（执行案 §4.7.3）：原文件有手写漂移注释，如：
 *   `['enemy_type' => 1, 'count' => [1, 1]],  // 废铁史莱姆 3-5 个`
 * 注释说 3-5 个但实际 count=[1,1]。
 *
 * 检测策略：
 *   - 从 rawFilesStore 读取 enemy_pool.php 原始内容（若未缓存则跳过）
 *   - 用正则匹配 `count => [a, b]  // xxx N-M 个` 模式
 *   - 若 a != N 或 b != M，触发漂移 warning
 *
 * P4 投影器修复后（从代码权威派生注释），此规则不再触发。
 * P4 修复前的实际数据中只有 1 处漂移（enemy_pool.php:22）。
 */
function checkEnemyCommentDrift(
  enemyNodes: ReadonlyArray<{ id: string; data: DistributionEnemyData }>,
): Issue[] {
  const issues: Issue[] = [];
  if (enemyNodes.length === 0) return issues;

  // rawFilesStore 仅缓存未被编辑器解析的文件，enemy_pool.php 是被解析的，
  // 通常不在缓存中。此处尝试读取，若未缓存则跳过（P4 修复后此规则本就不应触发）。
  let rawContent: string | undefined;
  try {
    const rawFilesStore = useRawFilesStore();
    rawContent = rawFilesStore.getRawFile('oblivions/gamedata/enemy_pool.php');
  } catch {
    // rawFilesStore 在非组件上下文（如测试）可能不可用，跳过
    return issues;
  }
  if (!rawContent) return issues;

  // 正则匹配：'count' => [a, b],  // 注释 N-M 个 或 N 个
  // 捕获组：a, b, N, M（M 可选，单值时 M=N）
  const pattern = /'count'\s*=>\s*\[(\d+),\s*(\d+)\][^\n]*?\/\/[^\n]*?(\d+)-(\d+)\s*个/g;
  const singlePattern = /'count'\s*=>\s*\[(\d+),\s*(\d+)\][^\n]*?\/\/[^\n]*?(\d+)\s*个/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawContent)) !== null) {
    const actualLo = Number(match[1]);
    const actualHi = Number(match[2]);
    const commentLo = Number(match[3]);
    const commentHi = Number(match[4]);
    if (actualLo !== commentLo || actualHi !== commentHi) {
      // 找到漂移条目，关联到对应 distribution.enemy 节点
      // 节点 id 格式 `${tide}:${enemy_type}`，但注释中无 tide 信息——
      // 通过 enemy_type 查找所有 tide 桶下的节点
      const lineStart = rawContent.slice(0, match.index).split('\n').length;
      issues.push(
        makeIssue({
          ruleId: RULE_DISTRIBUTION_ENEMY_COMMENT_DATA_DRIFT,
          severity: 'warning',
          message: `enemy_pool.php:${lineStart} 注释漂移：count=[${actualLo},${actualHi}] 但注释 ${commentLo}-${commentHi} 个`,
          resourceRef: { kind: 'distribution.enemy', id: '*' },
          hint: `P4 投影器会从代码权威派生注释，重新发布后此漂移自动修复`,
          location: { pgroup: null, pls: null, field: `enemy_pool.php:${lineStart}` },
        }),
      );
    }
  }

  // 单值注释模式（如 "// 1 个"）
  while ((match = singlePattern.exec(rawContent)) !== null) {
    const actualLo = Number(match[1]);
    const actualHi = Number(match[2]);
    const commentN = Number(match[3]);
    if (actualLo !== commentN || actualHi !== commentN) {
      const lineStart = rawContent.slice(0, match.index).split('\n').length;
      // 避免与区间模式重复报告（同一行已被 pattern 处理时跳过）
      const alreadyReported = issues.some(
        (i) => i.location?.field === `enemy_pool.php:${lineStart}`,
      );
      if (alreadyReported) continue;
      issues.push(
        makeIssue({
          ruleId: RULE_DISTRIBUTION_ENEMY_COMMENT_DATA_DRIFT,
          severity: 'warning',
          message: `enemy_pool.php:${lineStart} 注释漂移：count=[${actualLo},${actualHi}] 但注释 ${commentN} 个`,
          resourceRef: { kind: 'distribution.enemy', id: '*' },
          hint: `P4 投影器会从代码权威派生注释，重新发布后此漂移自动修复`,
          location: { pgroup: null, pls: null, field: `enemy_pool.php:${lineStart}` },
        }),
      );
    }
  }

  return issues;
}

// ─── 主入口 ────────────────────────────────────────────────────

/**
 * 第 5 层校验——分布校验（9 个 warning 规则：3 poi + 3 scatter + 3 enemy）。
 *
 * @param _graph 图状态（通过 findNodesByKind 直接查询，不依赖 graph 参数）
 * @param _changeSet Change Set（第 5 层未使用）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(_graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  const issues: Issue[] = [];

  // ── distribution.poi 校验（P3 已实现，保留） ─────────────
  issues.push(...validatePoi());

  // ── distribution.scatter 校验（P4 新增） ─────────────────
  // scatter / enemy 校验都依赖 world.tile / world.region / config.runtime 节点
  const tileNodes = findNodesByKind<WorldTileData>('world.tile');
  const regionNodes = findNodesByKind<WorldRegionData>('world.region');
  const configNodes = findNodesByKind<ConfigRuntimeData>('config.runtime');

  if (tileNodes.length === 0 || regionNodes.length === 0) return issues;

  const index = buildCandidateTileIndex(tileNodes);
  const allPgroups = regionNodes
    .map((r) => r.data.pgroup)
    .filter((p): p is number => typeof p === 'number');

  issues.push(...validateScatter(index, allPgroups, configNodes));
  issues.push(...validateEnemy(index, allPgroups, regionNodes));

  return issues;
}

// ─── P3: distribution.poi 校验（提取为独立函数，保留原逻辑） ────

/**
 * 校验 distribution.poi 节点（3 个 warning 规则）。
 *
 * 提取为独立函数，保持 P3 已验证的逻辑不变。
 */
function validatePoi(): Issue[] {
  const issues: Issue[] = [];

  const distributionNodes = findNodesByKind<DistributionPoiData>('distribution.poi');
  if (distributionNodes.length === 0) return issues;

  const tileNodes = findNodesByKind<WorldTileData>('world.tile');
  const regionNodes = findNodesByKind<WorldRegionData>('world.region');
  if (tileNodes.length === 0 || regionNodes.length === 0) return issues;

  const index = buildCandidateTileIndex(tileNodes);
  const allPgroups = regionNodes
    .map((r) => r.data.pgroup)
    .filter((p): p is number => typeof p === 'number');

  for (const node of distributionNodes) {
    // 仅处理统一模型形状（data 是对象）
    if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) continue;

    const data = node.data as DistributionPoiData;
    const tides = data['selector.tides'] ?? [];
    if (tides.length === 0) continue; // 无 tide 选择，跳过（结构校验已覆盖）

    const excludeEntrance = data['selector.excludeEntrance'] !== false; // 默认 true
    const excludeExit = data['selector.excludeExit'] !== false; // 默认 true
    const perRegionCount = typeof data['placement.count'] === 'number' ? data['placement.count'] : 0;

    // selector.regions 留空=所有区域（当前运行时契约）
    const regionFilter = data['selector.regions'] ?? [];
    const targetPgroups = regionFilter.length > 0
      ? allPgroups.filter((p) => regionFilter.includes(String(p)))
      : allPgroups;

    for (const tide of tides) {
      // 统计每个 region 的可用 tile 数
      const perRegionAvailable: Array<{ pgroup: number; available: number }> = [];
      for (const pgroup of targetPgroups) {
        const available = countAvailableTiles(
          index,
          pgroup,
          tide,
          excludeEntrance,
          excludeExit,
          regionNodes,
        );
        perRegionAvailable.push({ pgroup, available });
      }

      const allZero =
        perRegionAvailable.length > 0 && perRegionAvailable.every((r) => r.available === 0);

      if (allZero) {
        // 所有 region 该 tide 都无可用 tile → emit no_generatable_region（抑制 per-region 告警）
        issues.push(
          makeIssue({
            ruleId: RULE_DISTRIBUTION_POI_NO_GENERATABLE_REGION,
            severity: 'warning',
            message: `distribution.poi:${node.id} 的 tide=${tide} 在所有 region 都无可用 tile（passable + excludeEntrance/Exit 后为 0）`,
            resourceRef: { kind: 'distribution.poi', id: node.id },
            hint: `调整 world.tile 的 tide/passable，或修改 selector.tides，或关闭 excludeEntrance/Exit`,
            location: { pgroup: null, pls: null, field: `selector.tides[${tide}]` },
          }),
        );
        continue;
      }

      // 部分 region 为 0 → emit candidate_tile_insufficient（per region）
      // available > 0 但 count > available → emit per_region_capacity_conflict（per region）
      for (const { pgroup, available } of perRegionAvailable) {
        if (available === 0) {
          issues.push(
            makeIssue({
              ruleId: RULE_DISTRIBUTION_POI_CANDIDATE_TILE_INSUFFICIENT,
              severity: 'warning',
              message: `distribution.poi:${node.id} 在 region ${pgroup} 的 tide=${tide} 无可用 tile`,
              resourceRef: { kind: 'distribution.poi', id: node.id },
              hint: `调整 world.tile 的 tide/passable，或修改 selector.tides`,
              location: { pgroup, pls: null, field: `selector.tides[${tide}]` },
            }),
          );
        } else if (perRegionCount > available) {
          issues.push(
            makeIssue({
              ruleId: RULE_DISTRIBUTION_POI_PER_REGION_CAPACITY_CONFLICT,
              severity: 'warning',
              message: `distribution.poi:${node.id} 的 per_region=${perRegionCount} 超过 region ${pgroup} tide=${tide} 的可用 tile 数 ${available}`,
              resourceRef: { kind: 'distribution.poi', id: node.id },
              hint: `降低 placement.count 到 ≤ ${available}，或增加该 region 该 tide 的 passable tile`,
              location: { pgroup, pls: null, field: 'placement.count' },
            }),
          );
        }
      }
    }
  }

  return issues;
}
