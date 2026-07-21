//
// simStore：模拟状态（对齐 NEW_DESIGN.md §3.3 + DESIGN.md 2.8 dry-run 契约）
//
// 研判：
//   - simStore 是 Simulate 模式的核心状态容器
//   - 通过 projectStore.tiles 读取连通图（依赖 M2）
//
// 设计契约（对齐 2.8 dry-run）：
//   - Simulate 模式：BFS 计算结果存本地内存，绝不写 DB
//   - 模式切换只切数据源不重置玩家位置（与玩家位置独立维度）
//
// BFS 计算入口：recomputeBfs(tiles)
//   - 触发条件：setPlayerPos / updateConfig（visionRange / movePower / enemySenseRange 变化）
//   - 计算结果：visionResult / reachabilityResult / enemySenseResult / fogOverride 自动点亮
//   - 性能：单区域 ≤ 254 格，同步计算 < 1ms；超过 1000 格走 RAF 分片（useOverlayRenderer 调度）

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Pgroup, Pls, PlayerPosition, Tile } from '@/shared';
import {
  calcVisionRange,
  calcEnemySenseRange,
  calcReachableTiles,
  findShortestPath,
} from '@/shared';

export interface SimConfig {
  visionRange: number;
  enemySenseRange: number;
  movePower: number;
  discoverLimit: number;
}

/**
 * 探索发现项（占位结构，M7 对接后端时填充真实 wildItems）
 */
export interface DiscoveredItem {
  iid: number;
  /** 0=未发现 / 1=正常 / 2=近视显示假名（对齐 explore-sim 三态） */
  discovered: 0 | 1 | 2;
}

/**
 * 默认配置（对齐 NEW_DESIGN.md §3.3.4：vision_range 1-5 默认 1，move_power 1-10 默认 3）
 */
export const DEFAULT_SIM_CONFIG: SimConfig = {
  visionRange: 1,
  enemySenseRange: 3,
  movePower: 3,
  discoverLimit: 2,
};

/**
 * 触发 RAF 分片计算的格子数阈值（对齐 NEW_DESIGN.md §3.3.1 性能约束）
 */
export const RAF_BATCH_THRESHOLD = 1000;

export const useSimStore = defineStore('sim', () => {
  // ─── state ────────────────────────────────────────────
  const playerPos = ref<PlayerPosition>({ pgroup: null, pls: null });
  const config = ref<SimConfig>({ ...DEFAULT_SIM_CONFIG });
  /** Simulate 模式下的迷雾覆盖（fogOverride[pgroup][pls] = 0|1） */
  const fogOverride = ref<Record<Pgroup, Record<Pls, 0 | 1>>>({});
  const visionResult = ref<Map<Pls, number>>(new Map());
  const reachabilityResult = ref<Map<Pls, number>>(new Map());
  const enemySenseResult = ref<Map<Pls, number>>(new Map());
  const pathPreview = ref<Pls[]>([]);
  const discoveredItems = ref<Record<Pls, DiscoveredItem[]>>({});
  /** hover 目标格 pls（用于路径预览；null 表示无 hover） */
  const hoverTargetPls = ref<Pls | null>(null);

  // ─── actions ──────────────────────────────────────────

  /**
   * 设置玩家位置（sim-player 工具调用）
   *
   * 玩家位置变化触发 BFS 重算（由调用方调用 recomputeBfs）。
   * 不直接调用 recomputeBfs 是为了允许调用方批量更新（如 setPlayerPos + updateConfig 后一次重算）。
   */
  function setPlayerPos(pgroup: Pgroup | null, pls: Pls | null): void {
    playerPos.value = { pgroup, pls };
  }

  /**
   * 更新配置（vision_range / move_power / enemy_sense_range / discover_limit 滑块）
   */
  function updateConfig(patch: Partial<SimConfig>): void {
    config.value = { ...config.value, ...patch };
  }

  /**
   * 重算 BFS（对齐 §3.3.1：vision + reachability + enemySense 一次计算）
   *
   * 调用时机：setPlayerPos 后 / updateConfig 后 / sim-explore 触发
   * 性能：单区域 ≤ 254 格，同步 < 1ms
   *
   * @param tiles 当前区域的 tiles 字典
   */
  function recomputeBfs(tiles: Record<Pls, Tile>): void {
    // 清空旧结果
    visionResult.value = new Map();
    reachabilityResult.value = new Map();
    enemySenseResult.value = new Map();

    const { pgroup, pls } = playerPos.value;
    if (pgroup === null || pls === null) {
      pathPreview.value = [];
      return;
    }
    const playerTile = tiles[pls];
    if (!playerTile) {
      pathPreview.value = [];
      return;
    }

    // 计算视野范围（不可通行格可见但不再扩展）
    visionResult.value = calcVisionRange(tiles, pls, config.value.visionRange);
    // 计算可达性（只走 passable=true）
    reachabilityResult.value = calcReachableTiles(tiles, pls, config.value.movePower);
    // 计算敌人感知范围（无视 passable，独立于视野）
    enemySenseResult.value = calcEnemySenseRange(tiles, pls, config.value.enemySenseRange);

    // 自动点亮视野内格的迷雾（Simulate 模式独有，对齐 dry-run：模拟=预览不写 DB）
    applyVisionFog(pgroup, visionResult.value);

    // 若已有 hover 目标，重算路径预览
    if (hoverTargetPls.value !== null && hoverTargetPls.value !== pls) {
      const result = findShortestPath(tiles, pls, hoverTargetPls.value);
      pathPreview.value = result.path;
    } else {
      pathPreview.value = [];
    }
  }

  /**
   * 设置 hover 目标格（用于路径预览，对齐 §3.3.4 路径预览）
   *
   * @param tiles  当前区域 tiles 字典
   * @param pls    目标格 pls，null = 移出 hover 清空路径预览
   */
  function setHoverTarget(tiles: Record<Pls, Tile> | null, pls: Pls | null): void {
    hoverTargetPls.value = pls;
    if (pls === null) {
      pathPreview.value = [];
      return;
    }
    const { pls: playerPls } = playerPos.value;
    if (playerPls === null || pls === playerPls) {
      pathPreview.value = [];
      return;
    }
    if (!tiles) {
      pathPreview.value = [];
      return;
    }
    const result = findShortestPath(tiles, playerPls, pls);
    pathPreview.value = result.path;
  }

  /**
   * 清空路径预览（hover 移出时调用）
   */
  function clearPathPreview(): void {
    hoverTargetPls.value = null;
    pathPreview.value = [];
  }

  /**
   * 模拟探索发现（sim-explore 工具调用，对齐 §3.3.4 模拟探索）
   *
   * 视野范围内 + 距离判定 discovered 三态（0=未发现、1=正常、2=近视显示假名）
   * - distance=0（玩家所在格）：discovered=1（正常）
   * - distance ≤ discoverLimit：discovered=1（正常）
   * - distance > discoverLimit 但在视野内：discovered=2（近视显示假名）
   *
   * @param tiles         当前区域 tiles 字典
   * @param itemsAtPls    每个格子的道具列表（M7 对接后端 wildItems 时填充）
   */
  function simulateExplore(
    tiles: Record<Pls, Tile>,
    itemsAtPls?: Record<Pls, Array<{ iid: number }>>,
  ): void {
    const { pls } = playerPos.value;
    if (pls === null) return;
    // 重算 BFS 确保 visionResult 最新
    recomputeBfs(tiles);

    const newDiscovered: Record<Pls, DiscoveredItem[]> = {};
    const vision = visionResult.value;
    const limit = config.value.discoverLimit;

    for (const [plsKey, dist] of vision.entries()) {
      const items = itemsAtPls?.[plsKey] ?? [];
      if (items.length === 0) continue;
      const discovered: DiscoveredItem[] = items.map((item) => ({
        iid: item.iid,
        discovered: dist <= limit ? 1 : 2,
      }));
      newDiscovered[plsKey] = discovered;
    }
    discoveredItems.value = newDiscovered;
  }

  /**
   * 清空 BFS 结果（playerPos 清空时调用）
   */
  function clearBfsResults(): void {
    visionResult.value = new Map();
    reachabilityResult.value = new Map();
    enemySenseResult.value = new Map();
    pathPreview.value = [];
    hoverTargetPls.value = null;
  }

  /**
   * 重置整个 Simulate 状态（玩家位置 + BFS + 迷雾 + 发现项）
   */
  function resetSim(): void {
    playerPos.value = { pgroup: null, pls: null };
    fogOverride.value = {};
    discoveredItems.value = {};
    clearBfsResults();
  }

  // ─── 内部工具 ─────────────────────────────────────────

  /**
   * 应用视野范围内的迷雾点亮（fogOverride[pgroup][pls]=1）
   *
   * 对齐 dry-run 契约：仅修改本地内存，不写 DB。
   */
  function applyVisionFog(pgroup: Pgroup, visible: Map<Pls, number>): void {
    if (!fogOverride.value[pgroup]) {
      fogOverride.value[pgroup] = {};
    }
    const layer = fogOverride.value[pgroup]!;
    for (const pls of visible.keys()) {
      layer[pls] = 1;
    }
  }

  return {
    // state
    playerPos,
    config,
    fogOverride,
    visionResult,
    reachabilityResult,
    enemySenseResult,
    pathPreview,
    discoveredItems,
    hoverTargetPls,
    // actions
    setPlayerPos,
    updateConfig,
    recomputeBfs,
    setHoverTarget,
    clearPathPreview,
    simulateExplore,
    clearBfsResults,
    resetSim,
  };
});
