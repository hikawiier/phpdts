/**
 * @module K 状态管理层
 * @framework K-6 不可变原子地图投影 + 修订追踪
 */

// ══════════════════════════════════════════════════
// 地图状态 store
//
// 替代现有 vex/js/data.js 的 mapData + updateMapData() + vex/js/map.js 的 loadMap()。
// 用 Pinia + ref 实现响应式，UI 可自动更新。
//
// 现有实现（data.js）：
//   export const mapData = { curLoc, curRegion, links, enemies: [] };
//   export function updateMapData(patch) {
//     const prevRegion = mapData.curRegion;
//     Object.assign(mapData, patch);
//     return { prevRegion };
//   }
//
// 现有实现（map.js loadMap）：
//   - 并行 fetch game_map + enemies
//   - updateMapData + 区域切换 CRT 闪烁
//   - renderMapGrid + centerOnPlayer（Vue 中由 MapGrid.vue watch 触发）
//   - 广播 map:loaded
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { debugBus } from '@/composables/useDebugBus';
import { computeReachableMap } from '@/composables/useMapReachability';
import { perf } from '@/utils/perf';
import { task3Debug } from '@/utils/task3-debug';
import { useCharacterStore } from '@/stores/character';
import type { GameMap, Enemy } from '@/types/api';
import type { TileRef } from '@/types/scene';

export interface MapProjection {
  readonly revision: number;
  readonly currentTile: TileRef | null;
  readonly links: GameMap['links'] | null;
  readonly enemies: Enemy[];
}

function normalizeLocation(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export const useMapStore = defineStore('map', () => {
  // A single ref is the observable map boundary. Compatibility fields below
  // are derived from it, so consumers cannot observe a half-applied refresh.
  const projection = shallowRef<MapProjection>({
    revision: 0,
    currentTile: null,
    links: null,
    enemies: [],
  });
  const projectionRevision = computed(() => projection.value.revision);
  const currentTile = computed(() => projection.value.currentTile);
  const curLoc = computed(() => projection.value.currentTile?.pls ?? null);
  const curRegion = computed(() => projection.value.currentTile?.pgroup ?? null);
  const links = computed(() => projection.value.links);
  const enemies = computed(() => projection.value.enemies);

  // ── 视觉中心冻结（K-12 移动导演逐格演出支持） ──
  // 导航逐格播放期间冻结视野中心，防止 visionBounds 跟随 curLoc 即时重居中
  // 导致玩家格始终位于网格中心 → from/anchor 场景坐标相同 → playWorldMove 跳过动画。
  // 冻结后网格固定在起点，玩家实体在固定网格内逐格移动，动画驱动链正常工作。
  // 导航结束（抵达/中断/跳过）后清除冻结，网格重新跟随 curLoc 居中。
  const visualCenter = ref<number | null>(null);

  // ── K-12-E：跳跃目标扩展（jump tier 视野网格扩展） ──
  // efficient 倾向下多格跳跃（jump tier）的目标格常在 5x5 视野网格外。
  // 设置 jumpTargetPls 后，visionBounds 扩展为包含起点和目标的包围盒，
  // 让目标格进入渲染范围，resolveTile 才能找到目标 cell → 动画正常播放。
  // 动画完成后由 recenterVisionGridAfterStep 清除，网格恢复 5x5。
  const jumpTargetPls = ref<number | null>(null);

  // ── 加载状态 ──
  const loading = ref<boolean>(false);
  const error = ref<string>('');
  let loadGeneration = 0;

  function commitProjection(next: Omit<MapProjection, 'revision'>): MapProjection {
    const committed: MapProjection = {
      revision: projection.value.revision + 1,
      currentTile: next.currentTile,
      links: next.links,
      enemies: next.enemies,
    };
    projection.value = committed;
    useCharacterStore().replaceMapEnemies(committed.enemies);
    return committed;
  }

  /**
   * 统一更新 mapData 属性（P10：集中修改权）
   *
   * enemies 变更时同步写入 CharacterHub，并原子替换 map enemy roster。
   * mapStore.loadMap 和 battleStore.refreshMapEnemies 共用这一提交边界。
   */
  function updateMapData(patch: Partial<MapPatch>): void {
    const previous = projection.value;
    const pgroup = patch.curRegion !== undefined
      ? normalizeLocation(patch.curRegion)
      : previous.currentTile?.pgroup ?? null;
    const pls = patch.curLoc !== undefined
      ? normalizeLocation(patch.curLoc)
      : previous.currentTile?.pls ?? null;
    const hadCurLocChange = patch.curLoc !== undefined;
    const prevPls = previous.currentTile?.pls ?? null;
    commitProjection({
      currentTile: pgroup !== null && pls !== null ? { pgroup, pls } : null,
      links: patch.links !== undefined ? patch.links : previous.links,
      enemies: patch.enemies !== undefined ? patch.enemies : previous.enemies,
    });
    if (hadCurLocChange) {
      task3Debug.log('map-store.updateMapData.curLoc', {
        prevPls,
        newPls: pls,
        prevPgroup: previous.currentTile?.pgroup ?? null,
        newPgroup: pgroup,
        projectionRevisionAfter: projection.value.revision,
        visualCenter: visualCenter.value,
      });
    }
  }

  /** 冻结视觉中心到指定 pls（移动导演逐格播放期间调用） */
  function setVisualCenter(pls: number | null): void {
    const prev = visualCenter.value;
    visualCenter.value = pls;
    task3Debug.log('map-store.setVisualCenter', {
      prevVisualCenter: prev,
      newVisualCenter: pls,
      curLoc: curLoc.value,
    });
  }

  /** 清除视觉中心冻结，恢复跟随 curLoc */
  function clearVisualCenter(): void {
    const prev = visualCenter.value;
    visualCenter.value = null;
    // K-12-E：同时清除跳跃目标扩展，避免遗留状态影响下次导航
    const prevJumpTarget = jumpTargetPls.value;
    jumpTargetPls.value = null;
    task3Debug.log('map-store.clearVisualCenter', {
      prevVisualCenter: prev,
      curLoc: curLoc.value,
      prevJumpTarget,
    });
  }

  /** K-12-E：设置跳跃目标，触发 visionBounds 扩展包含目标格 */
  function setJumpTarget(pls: number | null): void {
    const prev = jumpTargetPls.value;
    jumpTargetPls.value = pls;
    task3Debug.log('map-store.setJumpTarget', {
      prevJumpTarget: prev,
      newJumpTarget: pls,
      visualCenter: visualCenter.value,
    });
  }

  /**
   * 加载地图数据
   *
   * 迁移自现有 vex/js/map.js loadMap()：
   *   - 并行 fetch game_map + enemies（经 dataManager 去重 + 缓存）
   *   - updateMapData 更新状态
   *   - 广播 map:loaded（各面板监听后自行刷新）
   *
   * 注意：renderMapGrid + centerOnPlayer 不在此处调用，
   *       由 MapGrid.vue watch mapStore 数据变化自动触发。
   */
  async function loadMap(): Promise<void> {
    const generation = ++loadGeneration;
    loading.value = true;
    error.value = '';

    perf.mark('loadMap 开始', 'store');
    debugBus.emit('api', 'loadMap:start', { action: 'game_map' });
    const t0 = Date.now();

    // P15: 并行发起 game_map 和 enemies 请求，减少串行等待
    perf.mark('→ fetch game_map + enemies (并行)', 'store');
    const gameMapPromise = dataManager.fetch('game_map', true);
    const enemyPromise = dataManager.fetch('enemies', true);

    try {
      const [gameMapOutcome, enemiesOutcome] = await Promise.allSettled([
        gameMapPromise,
        enemyPromise,
      ]);
      if (generation !== loadGeneration) return;

      if (gameMapOutcome.status === 'rejected') throw gameMapOutcome.reason;
      const result = gameMapOutcome.value;
      perf.mark('← game_map 返回', 'store');
      const elapsed = Date.now() - t0;

      debugBus.emit('api', 'loadMap:response', {
        elapsed_ms: elapsed,
        status: result.status,
        hasLinks: !!(result.data && (result.data as GameMap).links),
      });

      if (result.status !== 'success') {
        error.value = '数据加载失败';
        return;
      }

      const d = result.data as GameMap;
      let nextEnemies: Enemy[] = projection.value.enemies;
      if (enemiesOutcome.status === 'fulfilled') {
        const enemiesResult = enemiesOutcome.value;
        perf.mark('← enemies 返回', 'store');
        if (enemiesResult.status === 'success' && enemiesResult.data) {
          nextEnemies = ((enemiesResult.data as { enemies?: Enemy[] }).enemies || []);
        }
      }

      const pgroup = normalizeLocation(d.currentRegion);
      const pls = normalizeLocation(d.currentLocation);
      commitProjection({
        currentTile: pgroup !== null && pls !== null ? { pgroup, pls } : null,
        links: d.links || null,
        enemies: nextEnemies,
      });

      // 同步已探索图格集合（设计案 §4.4 + §9.4，Q5-2 修复）：
      // 从后端 links.explored[pgroup] 重建权威 Set，避免会话内增量与刷新后全量两套真值。
      // 惰性导入 explore-store 避免循环依赖。
      syncExploredTilesFromLinks(d.links, pgroup);

      // 刷新可达性缓存（BFS 从当前格出发，move_range 内）
      // 在广播 map:loaded 之前完成，确保 cells computed 读取的是最新可达性
      perf.mark('→ computeReachableMap', 'store');
      computeReachableMap();
      perf.mark('← computeReachableMap 完成', 'store');

      // 广播 map:loaded（inventory/tile-action/log/battle-aim 监听）
      perf.mark('→ broadcast map:loaded', 'broadcast');
      dataManager.broadcast('map:loaded', {
        curLoc: curLoc.value,
        curRegion: curRegion.value,
        hasLinks: !!links.value,
      });
      perf.mark('← broadcast map:loaded 完成', 'broadcast');
    } catch (e) {
      if (generation === loadGeneration) {
        error.value = e instanceof Error ? e.message : String(e);
        debugBus.emit('error', 'loadMap:error', { error: error.value });
      }
    } finally {
      if (generation === loadGeneration) {
        loading.value = false;
        perf.mark('loadMap 完成', 'store');
      }
    }
  }

  /** 重置为初始状态（退出游戏/切换角色时） */
  function reset(): void {
    loadGeneration += 1;
    commitProjection({ currentTile: null, links: null, enemies: [] });
    loading.value = false;
    error.value = '';
  }

  /**
   * 从 links.explored[pgroup] 同步已探索图格到 exploreStore（Q5-2 修复）。
   *
   * 惰性导入 explore-store 避免与 explore-store 顶部的 useMapStore() 形成循环依赖：
   * explore-store 在 setup 顶层调用 useMapStore()（强引用 mapStore），
   * mapStore 若在 setup 顶层调用 useExploreStore() 会形成循环；
   * 函数体内惰性调用在 Pinia store 已注册后安全。
   */
  function syncExploredTilesFromLinks(
    links: unknown,
    pgroup: number | null,
  ): void {
    if (!links || typeof links !== 'object' || pgroup === null) return;
    const exploredMap = (links as { explored?: Record<string, Record<string, number>> }).explored;
    if (!exploredMap) return;
    // 惰性导入：避免顶层循环依赖
    void import('./explore-store').then(({ useExploreStore }) => {
      useExploreStore().syncExploredFromLinks({ explored: exploredMap }, pgroup);
    });
  }

  return {
    // 状态
    projection,
    projectionRevision,
    currentTile,
    curLoc,
    curRegion,
    links,
    enemies,
    loading,
    error,
    visualCenter,
    jumpTargetPls,
    // actions
    commitProjection,
    updateMapData,
    setVisualCenter,
    clearVisualCenter,
    setJumpTarget,
    loadMap,
    reset,
  };
});

/** updateMapData 的 patch 类型 */
export interface MapPatch {
  curLoc: string | number | null;
  curRegion: string | number | null;
  links: GameMap['links'] | null;
  enemies: Enemy[];
}
