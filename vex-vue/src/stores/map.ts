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

    commitProjection({
      currentTile: pgroup !== null && pls !== null ? { pgroup, pls } : null,
      links: patch.links !== undefined ? patch.links : previous.links,
      enemies: patch.enemies !== undefined ? patch.enemies : previous.enemies,
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
    // actions
    commitProjection,
    updateMapData,
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
