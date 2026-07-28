// @module O 内容工具箱
//
// useOverlayRenderer：叠层调度统一入口（对齐 NEW_DESIGN.md §3.3.2 + §3.8 + DESIGN.md 2.13）
//
// 研判：
//   - 调度 O-1 的四叠层（fog/vision/reachability/tideHeatmap）
//   - POI 模板字段（searchable/mechanic）从 configStore.poiTable 查询以决定图标类型
//
// 设计契约（对齐 2.13 v-for 管理子树）：
//   - 叠层渲染全部通过 Vue 响应式 :class 驱动，禁止命令式 DOM 注入
//   - 叠层组件只读取 computed 数据源，由 Vue 自动重渲染
//   - 路径线通过 SVG <polyline> 响应式 :points 渲染（非命令式 appendChild）
//
// RAF 分片调度（对齐 §3.3.1：超过 1000 格时用 requestAnimationFrame 分片避免阻塞 UI）
//   - scheduleBfsRecompute(tiles) 包装 simStore.recomputeBfs 用 RAF 延迟一帧
//   - 多次连续调用合并为单次 RAF 回调（去抖）
//   - 单区域 ≤ 254 格时直接同步计算（无需 RAF）

import { computed } from 'vue';
import { useOverlayStore } from '@/stores/overlayStore';
import { useSimStore, RAF_BATCH_THRESHOLD } from '@/stores/simStore';
import { useProjectStore } from '@/stores/projectStore';
import type { Pls, Tile, Pgroup } from '@/shared';

/**
 * 叠层激活状态（响应式 computed，供 GridOverlay v-if 决定挂载哪些子叠层）
 */
export interface ActiveOverlays {
  fog: boolean;
  vision: boolean;
  reachability: boolean;
  tideHeatmap: boolean;
  wilditem: boolean;
  poi: boolean;
  enemy: boolean;
}

/**
 * 当前激活的叠层 key 列表（按渲染顺序：底层 → 顶层）
 *
 * 渲染顺序约定（避免视觉冲突）：
 *   1. tideHeatmap（最底层，背景色）
 *   2. fog（次底层，半透明遮罩）
 *   3. vision（中层，边框高亮）
 *   4. reachability（上层，边框 + 路径线）
 *   5. wilditem（顶层，候选格灰阶 + 排除原因纹理 + 生成率）
 *   6. poi（顶层，候选格灰阶 + 排除原因纹理 + 概率数字）
 *   7. enemy（顶层，候选格灰阶 + 排除原因纹理 + 放置数量）
 *
 * 分布叠层（wilditem / poi / enemy）置于顶层原因：分布规则候选格与
 * vision/reachability 视觉语义不同，灰阶 + 概率数字需要清晰可见；
 * 上层不遮挡玩家选中态（选中态由 GridCell 自身 z-index 保证）。
 * 三类分布叠层互斥——同一时刻只激活一个（由 DistributionOverlayPanel 切换）。
 */
const OVERLAY_RENDER_ORDER = [
  'tideHeatmap',
  'fog',
  'vision',
  'reachability',
  'wilditem',
  'poi',
  'enemy',
] as const;

export function useOverlayRenderer() {
  const overlay = useOverlayStore();
  const sim = useSimStore();
  const project = useProjectStore();

  // ─── 叠层激活状态（响应式） ─────────────────────────────
  const activeOverlays = computed<ActiveOverlays>(() => {
    const flags = overlay.flags;
    return {
      fog: flags.fog,
      vision: flags.vision,
      reachability: flags.reachability,
      tideHeatmap: flags.tideHeatmap,
      wilditem: flags.wilditem,
      poi: flags.poi,
      enemy: flags.enemy,
    };
  });

  /**
   * 当前激活的叠层 key 列表（按渲染顺序）
   */
  const activeOverlayList = computed<readonly (keyof ActiveOverlays)[]>(() => {
    const list: (keyof ActiveOverlays)[] = [];
    for (const key of OVERLAY_RENDER_ORDER) {
      if (activeOverlays.value[key]) {
        list.push(key);
      }
    }
    return list;
  });

  // ─── 数据源 computed（响应式） ──

  /**
   * 视野范围 BFS 结果
   */
  const visionDistance = computed(() => sim.visionResult);

  /**
   * 敌人感知范围 BFS 结果（无视 passable，独立于视野）
   */
  const enemySenseDistance = computed(() => sim.enemySenseResult);

  /**
   * 可达性 BFS 结果
   */
  const reachabilityDistance = computed(() => sim.reachabilityResult);

  /**
   * 路径预览（hover 任意格触发，绿色连线渲染）
   */
  const pathPreview = computed(() => sim.pathPreview);

  /**
   * 当前 pgroup 的 tiles（供叠层组件按 pls 查询 tile 属性）
   */
  const currentTiles = computed<Record<Pls, Tile>>(() => project.currentTiles);

  /**
   * 当前 pgroup（用于判断玩家位置是否在当前区域）
   */
  const currentPgroup = computed<Pgroup | null>(() => project.currentPgroup);

  /**
   * 玩家位置（用于判断 BFS 是否对当前区域有效）
   */
  const playerPos = computed(() => sim.playerPos);

  /**
   * 玩家位置是否在当前区域（决定是否渲染 vision/reachability/fog 叠层）
   */
  const isPlayerInCurrentRegion = computed(() => {
    const { pgroup } = sim.playerPos;
    return pgroup !== null && pgroup === project.currentPgroup;
  });

  /**
   * 迷雾数据源（fogOverride[pgroup][pls] = 0|1）
   *
   * 返回结构：Map<Pls, 0|1>，便于 OverlayFog 组件按 pls 查询
   */
  const fogData = computed<Map<Pls, 0 | 1>>(() => {
    const pgroup = project.currentPgroup;
    if (pgroup === null) return new Map();
    const layer = sim.fogOverride[pgroup];
    if (!layer) return new Map();
    const map = new Map<Pls, 0 | 1>();
    for (const pls of Object.keys(layer)) {
      const v = layer[Number(pls)];
      if (v !== undefined) map.set(Number(pls), v);
    }
    return map;
  });

  // ─── 工具方法 ─────────────────────────────────────────

  /**
   * 判断指定叠层是否激活
   */
  function isOverlayActive(key: keyof ActiveOverlays): boolean {
    return activeOverlays.value[key];
  }

  /**
   * RAF 分片调度 BFS 重算（对齐 §3.3.1：超过 1000 格时用 RAF 分片）
   *
   * 多次连续调用合并为单次 RAF 回调（去抖）。
   * 单区域 ≤ 254 格时调用方可直接走 simStore.recomputeBfs 同步计算。
   *
   * @returns true 表示已调度 RAF；false 表示环境不支持 RAF（如 SSR / 测试环境）
   */
  let pendingRafId: number | null = null;
  let pendingTiles: Record<Pls, Tile> | null = null;

  function scheduleBfsRecompute(tiles: Record<Pls, Tile>): boolean {
    pendingTiles = tiles;
    if (pendingRafId !== null) return true; // 已有待执行的 RAF
    if (typeof requestAnimationFrame === 'undefined') {
      // 测试 / SSR 环境无 RAF：直接同步计算
      sim.recomputeBfs(tiles);
      pendingTiles = null;
      return false;
    }
    pendingRafId = requestAnimationFrame(() => {
      pendingRafId = null;
      if (pendingTiles !== null) {
        const tilesToCompute = pendingTiles;
        pendingTiles = null;
        sim.recomputeBfs(tilesToCompute);
      }
    });
    return true;
  }

  /**
   * 取消待执行的 RAF 调度（组件卸载时调用避免泄漏）
   */
  function cancelPendingRaf(): void {
    if (pendingRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(pendingRafId);
    }
    pendingRafId = null;
    pendingTiles = null;
  }

  /**
   * 根据 tile 数量决定走同步还是 RAF 调度
   *
   * @param tiles 当前区域 tiles
   */
  function recompute(tiles: Record<Pls, Tile>): void {
    const tileCount = Object.keys(tiles).length;
    if (tileCount >= RAF_BATCH_THRESHOLD) {
      scheduleBfsRecompute(tiles);
    } else {
      sim.recomputeBfs(tiles);
    }
  }

  return {
    // 响应式状态
    activeOverlays,
    activeOverlayList,
    visionDistance,
    enemySenseDistance,
    reachabilityDistance,
    pathPreview,
    currentTiles,
    currentPgroup,
    playerPos,
    isPlayerInCurrentRegion,
    fogData,
    // 工具方法
    isOverlayActive,
    scheduleBfsRecompute,
    cancelPendingRaf,
    recompute,
  };
}

/**
 * 类型导出：供组件 / 测试引用
 */
export type OverlayRendererReturn = ReturnType<typeof useOverlayRenderer>;

/**
 * 渲染顺序常量导出（供测试断言）
 */
export { OVERLAY_RENDER_ORDER };
