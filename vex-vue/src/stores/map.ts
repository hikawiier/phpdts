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
import { ref } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { debugBus } from '@/composables/useDebugBus';
import { computeReachableMap } from '@/composables/useMapReachability';
import { perf } from '@/utils/perf';
import { useCharacterStore } from '@/stores/character';
import type { GameMap, Enemy } from '@/types/api';

export const useMapStore = defineStore('map', () => {
  // ── 状态（与现有 mapData 字段一致） ──
  const curLoc = ref<string | number | null>(null);
  const curRegion = ref<string | number | null>(null);
  const links = ref<GameMap['links'] | null>(null);
  const enemies = ref<Enemy[]>([]);

  // ── 加载状态 ──
  const loading = ref<boolean>(false);
  const error = ref<string>('');

  /**
   * 统一更新 mapData 属性（P10：集中修改权）
   *
   * enemies 变更时同步写入 CharacterHub（mergeEnemies），这样 mapStore.loadMap
   * 和 battleStore.refreshMapEnemies（内部调 updateMapData）两个写入点都会自动触发 merge。
   */
  function updateMapData(patch: Partial<MapPatch>): void {
    if (patch.curLoc !== undefined) curLoc.value = patch.curLoc;
    if (patch.curRegion !== undefined) curRegion.value = patch.curRegion;
    if (patch.links !== undefined) links.value = patch.links;
    if (patch.enemies !== undefined) {
      enemies.value = patch.enemies;
      useCharacterStore().mergeEnemies(patch.enemies);
    }
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
      const result = await gameMapPromise;
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
      updateMapData({
        curLoc: d.currentLocation !== undefined ? d.currentLocation : null,
        curRegion: d.currentRegion !== undefined ? d.currentRegion : null,
        links: d.links || null,
      });

      // 等待 enemy 请求完成（与 game_map 处理并行，此时通常已完成）
      try {
        const enemiesResult = await enemyPromise;
        perf.mark('← enemies 返回', 'store');
        updateMapData({
          enemies:
            enemiesResult.status === 'success' && enemiesResult.data
              ? ((enemiesResult.data as { enemies?: Enemy[] }).enemies || [])
              : [],
        });
      } catch {
        updateMapData({ enemies: [] });
      }

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
      error.value = e instanceof Error ? e.message : String(e);
      debugBus.emit('error', 'loadMap:error', { error: error.value });
    } finally {
      loading.value = false;
      perf.mark('loadMap 完成', 'store');
    }
  }

  /** 重置为初始状态（退出游戏/切换角色时） */
  function reset(): void {
    curLoc.value = null;
    curRegion.value = null;
    links.value = null;
    enemies.value = [];
    loading.value = false;
    error.value = '';
  }

  return {
    // 状态
    curLoc,
    curRegion,
    links,
    enemies,
    loading,
    error,
    // actions
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
