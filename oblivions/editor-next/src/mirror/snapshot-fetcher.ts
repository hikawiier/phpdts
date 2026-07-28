/**
 * @module O 内容工具箱
 *
 * 后端权威状态快照拉取器（执行案 §4.4.1）。
 *
 * 设计意图：
 * - 通过 Workspace Gateway 调用 State API，避免浏览器 CORS 限制
 * - 支持 ?debug=all 参数，拉取 debug_* scope（后端权威状态全集）
 * - 返回结构化 JSON 快照，供 snapshot-comparator 对比
 *
 * API 调用清单（执行案 §4.4.1）：
 *   | Scope                              | 用途                       | 镜像器                |
 *   |------------------------------------|----------------------------|-----------------------|
 *   | debug_poi_all (?debug=all)         | 全图 POI 完整字段           | world-init           |
 *   | game_map                           | 地图 + 迷雾 + 道具投影      | world-init / day-refresh |
 *   | enemies                            | 敌人列表                    | world-init / enemy-spawn |
 *   | player_inventory                   | 玩家背包                    | loot-roll             |
 *   | debug_player_full (?debug=all)     | 完整玩家数据                | 所有镜像器            |
 *   | debug_gamevars (?debug=all)        | 完整 gamevars + 派生时间    | day-refresh           |
 *   | debug_diag_log (?debug=all)        | 诊断日志（含 mirror.mismatch）| 所有镜像器            |
 *
 * 不可达处理（执行案 §8.2 风险二）：
 * - Gateway 不可达时抛 GatewayUnavailableError
 * - 调用方（mirror-runner）捕获后调用 buildBackendUnreachableResult() 生成 warning
 * - 不阻断发布——用户可能未启动游戏服务器
 */

import {
  gatewayGet,
  GatewayApiError,
  GatewayUnavailableError,
  type ClientOptions,
} from '@/services/workspace/gateway-client';

// ─── Scope 常量 ─────────────────────────────────────────────────

/**
 * 后端 State API 只读 scope 常量集（执行案 §4.4.1）。
 *
 * 对齐 oblivions/include/api/obl_state_handlers.php 的 19 个只读 scope。
 * 标注 (?debug=all) 的 scope 需要在请求时附 ?debug=all 参数。
 */
export const STATE_SCOPES = {
  // 公开 scope（无需 debug=all）
  GAME_MAP: 'game_map',
  ENEMIES: 'enemies',
  PLAYER_INVENTORY: 'player_inventory',
  CRAFT_PREVIEW: 'craft_preview',
  CRAFT_RECIPES: 'craft_recipes',
  // debug scope（需 ?debug=all）
  DEBUG_POI_ALL: 'debug_poi_all',
  DEBUG_PLAYER_FULL: 'debug_player_full',
  DEBUG_GAMEVARS: 'debug_gamevars',
  DEBUG_DIAG_LOG: 'debug_diag_log',
} as const;

export type StateScope = (typeof STATE_SCOPES)[keyof typeof STATE_SCOPES];

/**
 * 参数化 State API scope。
 *
 * 这些 scope 不能作为"无参后端快照"批量预取；镜像器必须提供确定性的采样输入。
 */
const PARAMETERIZED_STATE_SCOPES = new Set<StateScope>([
  STATE_SCOPES.CRAFT_PREVIEW,
]);

export function isParameterizedStateScope(scope: StateScope): boolean {
  return PARAMETERIZED_STATE_SCOPES.has(scope);
}

/**
 * 镜像器 ID → 该镜像器需要拉取的 scope 列表映射（执行案 §4.4.1）。
 *
 * mirror-runner 按镜像器 ID 查询本映射，并行拉取所需 scope。
 */
export const MIRROR_REQUIRED_SCOPES: Record<string, readonly StateScope[]> = {
  'world-init': [
    STATE_SCOPES.DEBUG_POI_ALL,
    STATE_SCOPES.GAME_MAP,
    STATE_SCOPES.ENEMIES,
  ],
  'day-refresh': [
    STATE_SCOPES.GAME_MAP,
    STATE_SCOPES.DEBUG_GAMEVARS,
  ],
  'loot-roll': [
    STATE_SCOPES.PLAYER_INVENTORY,
    STATE_SCOPES.DEBUG_PLAYER_FULL,
  ],
  'enemy-spawn': [
    STATE_SCOPES.ENEMIES,
    STATE_SCOPES.GAME_MAP,
  ],
} as const;

// ─── 类型定义 ───────────────────────────────────────────────────

/**
 * 单个 scope 的拉取结果。
 */
export interface ScopeSnapshot {
  /** scope 名称 */
  scope: StateScope;
  /** 拉取时间戳（Date.now()） */
  timestamp: number;
  /** 后端返回的 JSON 数据（结构因 scope 而异） */
  data: unknown;
}

/**
 * 镜像器所需全部 scope 的快照集合。
 *
 * key 是 scope 名称，value 是 ScopeSnapshot。
 */
export type MirrorSnapshot = Record<string, ScopeSnapshot>;

// ─── 拉取入口 ───────────────────────────────────────────────────

/**
 * 拉取单个 scope 的后端权威快照。
 *
 * 通过 Workspace Gateway 调用 State API（Gateway /state 路由代理到游戏服务器）。
 * Gateway 不可达时抛 GatewayUnavailableError——调用方（mirror-runner）应捕获并
 * 生成"后端不可达"对比结果（buildBackendUnreachableResult）。
 *
 * @param scope State API scope 名称（如 'debug_poi_all' / 'game_map'）
 * @param opts 可选配置：
 *   - debug=true：附 ?debug=all 参数（拉取 debug_* scope 必须）
 *   - 其他 ClientOptions（base URL 等）
 * @returns ScopeSnapshot——含 timestamp 与原始 JSON 数据
 * @throws GatewayUnavailableError Gateway 不可达
 */
export async function fetchScope(
  scope: StateScope,
  opts: { debug?: boolean } & ClientOptions = {},
): Promise<ScopeSnapshot> {
  const debug = opts.debug ?? scope.startsWith('debug_');
  const query: Record<string, unknown> = { scope };
  if (debug) query.debug = 'all';

  let data: unknown;
  try {
    data = await gatewayGet<unknown>('/state', query, opts);
  } catch (err) {
    if (err instanceof GatewayApiError) {
      throw new GatewayUnavailableError(err.message, err);
    }
    throw err;
  }
  return {
    scope,
    timestamp: Date.now(),
    data,
  };
}

/**
 * 拉取镜像器所需的全部 scope 快照（并行拉取）。
 *
 * mirror-runner 在调度镜像器前调用本函数，并行拉取该镜像器所需的所有 scope。
 * 任一 scope 失败时整个拉取失败——调用方应捕获并降级为"后端不可达"。
 *
 * @param mirrorId 镜像器 ID（如 'world-init'）
 * @param opts 可选配置（透传给 fetchScope）
 * @returns MirrorSnapshot——key 是 scope 名称，value 是 ScopeSnapshot
 * @throws GatewayUnavailableError Gateway 不可达
 */
export async function fetchMirrorSnapshot(
  mirrorId: string,
  opts: { debug?: boolean } & ClientOptions = {},
): Promise<MirrorSnapshot> {
  const scopes = MIRROR_REQUIRED_SCOPES[mirrorId] ?? [];
  const results = await Promise.all(
    scopes.map((scope) => fetchScope(scope, opts)),
  );
  const snapshot: MirrorSnapshot = {};
  for (const result of results) {
    snapshot[result.scope] = result;
  }
  return snapshot;
}

/**
 * 拉取所有镜像器所需的全部 scope 快照（去重后并行拉取）。
 *
 * mirror-runner 在 runAll() 流程中调用本函数，一次性拉取所有镜像器所需 scope，
 * 避免重复请求。批量拉取采用 best-effort：单个 scope 失败不阻断其它 scope，
 * 缺失 scope 会在 runMirror() 阶段按镜像器粒度重试并降级为 warning。
 * 参数化 scope 不参与批量预取，避免无采样输入时产生无意义的 400。
 *
 * @param opts 可选配置（透传给 fetchScope）
 * @returns MirrorSnapshot——所有镜像器所需 scope 的快照集合
 * @throws GatewayUnavailableError 所有 scope 均不可用
 */
export async function fetchAllMirrorSnapshots(
  opts: { debug?: boolean } & ClientOptions = {},
): Promise<MirrorSnapshot> {
  // 收集所有镜像器所需的 scope（去重）
  const allScopes = new Set<StateScope>();
  for (const scopes of Object.values(MIRROR_REQUIRED_SCOPES)) {
    for (const scope of scopes) {
      if (!isParameterizedStateScope(scope)) {
        allScopes.add(scope);
      }
    }
  }

  const results = await Promise.allSettled(
    Array.from(allScopes).map((scope) => fetchScope(scope, opts)),
  );
  const snapshot: MirrorSnapshot = {};
  let firstFailure: unknown = null;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      snapshot[result.value.scope] = result.value;
    } else if (firstFailure === null) {
      firstFailure = result.reason;
    }
  }

  if (Object.keys(snapshot).length === 0 && firstFailure !== null) {
    if (firstFailure instanceof GatewayUnavailableError) {
      throw firstFailure;
    }
    throw new GatewayUnavailableError(
      firstFailure instanceof Error ? firstFailure.message : String(firstFailure),
      firstFailure,
    );
  }
  return snapshot;
}

// ─── 错误类型重导出 ─────────────────────────────────────────────

export { GatewayUnavailableError };
