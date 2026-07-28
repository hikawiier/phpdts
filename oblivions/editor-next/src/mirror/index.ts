/**
 * @module O 内容工具箱
 * @framework O-12 运行时镜像校验
 *
 * 镜像器注册表与统一入口（执行案 §4.2.1）。
 *
 * 设计意图：
 * - 4 个镜像器（world-init / day-refresh / loot-roll / enemy-spawn）
 *   统一通过 MIRRORS 数组注册
 * - mirror-runner.runAll(graphStore, MIRRORS) 调度所有镜像器
 * - 每个 Mirror 实现 requiredScopes / compareOptions / run 三段契约
 *
 * 循环依赖规避：
 * - mirror/index.ts 导入各镜像器（world-init-mirror 等）的实例
 * - mirror-runner.ts 导入 mirror/index.ts 的 Mirror 类型（type-only）
 * - 各镜像器导入 mirror/index.ts 的 Mirror / MirrorRunOutput 类型（type-only）
 * - 运行时调用方（validateStore / atomic-publisher）从 mirror/index.ts 导入 MIRRORS
 *   后传入 mirror-runner.runAll()
 */

import type { useGraphStore } from '@/graph/graph-store';
import type { StateScope, MirrorSnapshot } from './snapshot-fetcher';
import type { CompareOptions, InvariantViolation } from './snapshot-comparator';
import { worldInitMirror } from './world-init-mirror';
import { dayRefreshMirror } from './day-refresh-mirror';
import { lootRollMirror } from './loot-roll-mirror';
import { enemySpawnMirror } from './enemy-spawn-mirror';

/**
 * GraphStore 类型别名——避免在函数签名中写长 ReturnType 表达式。
 *
 * 与 services/validate-rules.ts / validate/quick-fixes.ts 一致。
 */
type GraphStore = ReturnType<typeof useGraphStore>;

// ─── 镜像器 ID 类型 ─────────────────────────────────────────────

/**
 * 镜像器 ID 字面量联合类型（4 个内置镜像器）。
 *
 * 对齐执行案 §4.2.1 的运行时镜像器：
 *   - world-init：开局生成（POI + scatter + enemy 放置）
 *   - day-refresh：day_changed scatter refresh
 *   - loot-roll：POI 搜索掷骰（F-4 引擎）
 *   - enemy-spawn：敌人放置（J-1 生命周期）
 */
export type MirrorId =
  | 'world-init'
  | 'day-refresh'
  | 'loot-roll'
  | 'enemy-spawn';

// ─── 镜像器接口 ─────────────────────────────────────────────────

/**
 * 镜像器运行输出——传给 snapshot-comparator.compareSnapshot()。
 *
 * - output：前端镜像计算的预期输出（结构因镜像器而异）
 * - invariantViolations：镜像器自检的不变量违反列表（与差异校验正交）
 */
export interface MirrorRunOutput {
  /** 前端镜像输出（结构因镜像器而异，传给 comparator 作为 actual） */
  output: unknown;
  /** 不变量违反列表（镜像器自检，与差异校验正交） */
  invariantViolations: InvariantViolation[];
}

/**
 * 镜像器接口契约。
 *
 * 三段契约：
 *   - id：镜像器 ID（如 'world-init'），对应 mirror-validator 的 rule ID 前缀
 *   - requiredScopes：该镜像器所需的后端 State API scope 列表（snapshot-fetcher 拉取）
 *   - compareOptions：对比配置（容忍度 / exactMatch），传给 snapshot-comparator
 *   - run(graphStore, snapshot)：异步计算前端镜像输出 + 不变量违反列表
 */
export interface Mirror {
  /** 镜像器 ID（如 'world-init'） */
  id: MirrorId;
  /** 所需的后端 State API scope 列表 */
  requiredScopes: readonly StateScope[];
  /** 对比配置（容忍度 / exactMatch） */
  compareOptions: CompareOptions;
  /**
   * 异步运行镜像器——计算前端镜像输出 + 不变量违反列表。
   *
   * @param graphStore graph-store 实例（读取 Resource Graph 节点作为镜像输入）
   * @param snapshot 后端权威快照（含 requiredScopes 指定的 scope 数据）
   * @returns 镜像输出 + 不变量违反列表
   */
  run: (graphStore: GraphStore, snapshot: MirrorSnapshot) => Promise<MirrorRunOutput>;
}

// ─── 镜像器注册表 ───────────────────────────────────────────────

/**
 * 4 个内置运行时镜像器注册表（执行案 §4.2.1）。
 *
 * 顺序按执行案 §4.2.1 目录结构排列：
 *   1. world-init-mirror：开局生成（POI + scatter + enemy 放置）
 *   2. day-refresh-mirror：day_changed scatter refresh
 *   3. loot-roll-mirror：POI 搜索掷骰（F-4 引擎）
 *   4. enemy-spawn-mirror：敌人放置（J-1 生命周期）
 *
 * 配方匹配不注册为运行时镜像器：配方是工具箱直接编辑的作者资源，
 * 正确性由 O-10 静态 schema / reference / semantic 校验覆盖。
 *
 * 调用方（validateStore / atomic-publisher）通过 mirror-runner.runAll(graphStore, MIRRORS)
 * 调度所有镜像器。
 */
export const MIRRORS: readonly Mirror[] = [
  worldInitMirror,
  dayRefreshMirror,
  lootRollMirror,
  enemySpawnMirror,
];

/**
 * 镜像器 ID → Mirror 实例映射（便于按 ID 查找）。
 */
export const MIRROR_BY_ID: Record<MirrorId, Mirror> = Object.fromEntries(
  MIRRORS.map((m) => [m.id, m]),
) as Record<MirrorId, Mirror>;

/**
 * 按 ID 查找镜像器。
 *
 * @param id 镜像器 ID
 * @returns Mirror 实例
 * @throws Error 若 ID 不在内置镜像器中
 */
export function getMirrorById(id: MirrorId): Mirror {
  const mirror = MIRROR_BY_ID[id];
  if (!mirror) {
    throw new Error(`[O-12] Unknown mirror id: ${id}`);
  }
  return mirror;
}

// ─── 重导出 ─────────────────────────────────────────────────────

export type {
  MirrorSnapshot,
  ScopeSnapshot,
  StateScope,
} from './snapshot-fetcher';
export {
  STATE_SCOPES,
  MIRROR_REQUIRED_SCOPES,
  fetchScope,
  fetchMirrorSnapshot,
  fetchAllMirrorSnapshots,
  GatewayUnavailableError,
} from './snapshot-fetcher';

export type {
  MirrorComparisonResult,
  MirrorDifference,
  MirrorDifferenceDimension,
  InvariantViolation,
  CompareOptions,
} from './snapshot-comparator';
export {
  compareSnapshot,
  buildBackendUnreachableResult,
} from './snapshot-comparator';

export type { MirrorRunResult } from './mirror-runner';
export { runAll, runMirror } from './mirror-runner';

// 各镜像器实例与常量重导出
export { worldInitMirror, WORLD_INIT_MIRROR_ID } from './world-init-mirror';
export { dayRefreshMirror, DAY_REFRESH_MIRROR_ID } from './day-refresh-mirror';
export { lootRollMirror, LOOT_ROLL_MIRROR_ID } from './loot-roll-mirror';
export { enemySpawnMirror, ENEMY_SPAWN_MIRROR_ID } from './enemy-spawn-mirror';
