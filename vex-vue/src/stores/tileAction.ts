/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 地格交互 store / Tile Action Store
//
// 替代现有 vex/js/tile-action.js 的状态管理 + 业务逻辑。
//
// 职责：
//   - tileActions 状态（pois / ground_items）
//   - loadTileAction()：拉取当前格交互数据
//   - handleExplore()：探索命令
//   - handleSearch(iaid)：搜索 POI
//   - handlePickup(iid)：拾取单个道具
//   - handlePickupAll(items)：批量拾取
//   - handleSwitchRegion()：区域切换
//   - 模态框状态：modalOpen / modalType / modalIaid
//
// 事件监听（与现有 tile-action.js 一致）：
//   - map:loaded → loadTileAction（仅 hasLinks 时）
//   - game:action-completed → loadTileAction
//   - map:click-current → handleExplore
//
// 渲染策略（M4）：组件用 v-for + v-if 响应式渲染，无 innerHTML 依赖。
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { commandQueue } from '@/stores/command-queue';
import { dataManager } from '@/stores/data-manager';
import { debugBus } from '@/composables/useDebugBus';
import type { TileActions, Poi, GroundItem } from '@/types/api';
import { getPoiName } from '@/data/poi-locale';

export type ModalType = 'ground' | 'poi' | null;

export const useTileActionStore = defineStore('tileAction', () => {
  // ── 状态 ──
  const tileActions = ref<TileActions | null>(null);
  const loading = ref<boolean>(false);

  // ── 模态框状态 ──
  const modalOpen = ref<boolean>(false);
  const modalType = ref<ModalType>(null);
  /** POI 模态框的 iaid（ground 模态框为 null） */
  const modalIaid = ref<string | number | null>(null);

  // ── 计算属性 ──
  const pois = computed<Poi[]>(() => tileActions.value?.pois || []);
  const groundItems = computed<GroundItem[]>(() => tileActions.value?.ground_items || []);

  /** 当前打开的 POI（modalType==='poi' 时） */
  const modalPoi = computed<Poi | null>(() => {
    if (modalType.value !== 'poi' || modalIaid.value === null) return null;
    const list = pois.value;
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].iaid) === String(modalIaid.value)) return list[i];
    }
    return null;
  });

  /** 模态框标题 */
  const modalTitle = computed<string>(() => {
    if (modalType.value === 'ground') return '脚边道具';
    if (modalType.value === 'poi' && modalPoi.value) {
      return getPoiName(modalPoi.value.poi_id, modalPoi.value.name);
    }
    return '';
  });

  /** 模态框内道具列表 */
  const modalItems = computed<GroundItem[]>(() => {
    if (modalType.value === 'ground') return groundItems.value;
    if (modalType.value === 'poi' && modalPoi.value) return modalPoi.value.items || [];
    return [];
  });

  // ═══ 数据加载 ═══

  /**
   * 拉取当前格交互数据
   *
   * 迁移自现有 vex/js/tile-action.js loadTileAction()：
   *   - 经 dataManager.fetch（去重 + 白名单缓存）
   *   - 失败时清空 tileActions
   */
  async function loadTileAction(): Promise<void> {
    const mapStore = useMapStore();
    if (!mapStore.links) {
      tileActions.value = null;
      return;
    }

    loading.value = true;
    try {
      const result = await dataManager.fetch('tile_actions', true);
      if (result.status === 'success' && result.data) {
        tileActions.value = result.data as TileActions;
      } else {
        tileActions.value = null;
      }
    } catch (e) {
      debugBus.emit('error', 'loadTileAction:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      tileActions.value = null;
    } finally {
      loading.value = false;
    }
  }

  // ═══ 命令处理 ═══

  /**
   * 探索周围
   *
   * 迁移自现有 tile-action.js handleExplore()：
   *   - commandQueue.execute(map.explore)
   *   - 成功后失效 tile_actions/player_inventory/game_map + loadMap + 广播
   */
  async function handleExplore(): Promise<void> {
    debugBus.emit('action', 'explore:trigger', {});
    try {
      const result = await commandQueue.execute({ command: 'map.explore', payload: {} });
      if (result.success) {
        dataManager.invalidate('tile_actions');
        dataManager.invalidate('player_inventory');
        dataManager.invalidate('game_map');
        const mapStore = useMapStore();
        await mapStore.loadMap();
        dataManager.broadcast('game:action-completed');
      } else {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '探索失败',
          isHtml: !!result.messageIsHtml,
        });
      }
    } catch (e) {
      debugBus.emit('error', 'explore:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', { type: 'error', msg: '探索失败：' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  async function handleWait(): Promise<void> {
    try {
      const result = await commandQueue.execute({ command: 'world.wait', payload: {} });
      if (result.success) {
        dataManager.broadcast('game:action-completed');
        await loadTileAction();
      } else {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '等待失败',
          isHtml: !!result.messageIsHtml,
        });
      }
    } catch (e) {
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '等待失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  /**
   * 搜索 POI
   *
   * 迁移自现有 tile-action.js handleSearch()：
   *   - commandQueue.execute(poi.search)
   *   - 成功后失效 tile_actions/player_inventory + 广播 + 重新打开该 POI 模态框
   */
  async function handleSearch(iaid: string | number): Promise<void> {
    debugBus.emit('action', 'search:trigger', { iaid });
    try {
      const result = await commandQueue.execute({
        command: 'poi.search',
        payload: { iaid: Number(iaid) },
      });
      if (result.success) {
        dataManager.invalidate('tile_actions');
        dataManager.invalidate('player_inventory');
        dataManager.broadcast('game:action-completed');
        // 重新拉取数据后模态框内容自动更新（modalIaid 保持不变）
        await loadTileAction();
      } else {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '搜索失败',
          isHtml: !!result.messageIsHtml,
        });
      }
    } catch (e) {
      debugBus.emit('error', 'search:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', { type: 'error', msg: '搜索失败：' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  /**
   * 拾取单个道具
   *
   * 迁移自现有 tile-action.js handlePickup()：
   *   - commandQueue.execute(item.pickup)
   *   - 成功后失效 tile_actions/player_inventory + 广播 + 重新拉取刷新模态框
   */
  async function handlePickup(iid: string | number): Promise<void> {
    debugBus.emit('action', 'pickup:trigger', { iid });
    try {
      const result = await commandQueue.execute({
        command: 'item.pickup',
        payload: { iid: Number(iid) },
      });
      if (result.success) {
        dataManager.invalidate('player_inventory');
        dataManager.invalidate('tile_actions');
        dataManager.broadcast('game:action-completed');
        await loadTileAction();
      } else {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '拾取失败',
          isHtml: !!result.messageIsHtml,
        });
      }
    } catch (e) {
      debugBus.emit('error', 'pickup:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', { type: 'error', msg: '拾取失败：' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  /**
   * 批量拾取
   *
   * 迁移自现有 tile-action.js handlePickupAll()：
   *   - 逐个执行 item.pickup
   *   - 背包已满时提前终止
   *   - 完成后失效缓存 + 广播 + 关闭模态框
   */
  async function handlePickupAll(items: GroundItem[]): Promise<void> {
    try {
      let failCount = 0;
      let bagFull = false;
      for (let i = 0; i < items.length; i++) {
        const result = await commandQueue.execute({
          command: 'item.pickup',
          payload: { iid: Number(items[i].iid) },
        });
        if (!result.success) {
          failCount++;
          const message = result.message || result.error || '';
          if (message.indexOf('满') !== -1 || result.error === 'BAG_FULL' || result.error === 'ITM0_PENDING') {
            dataManager.broadcast('ui:toast', {
              type: 'error',
              msg: message || '背包已满，无法继续拾取',
              isHtml: !!result.messageIsHtml,
              mergeId: 'pickup.bag_full',
            });
            bagFull = true;
            break;
          }
        }
      }
      if (failCount > 0 && !bagFull && failCount < items.length) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: '部分道具拾取失败（' + failCount + '件）',
        });
      }
    } catch (e) {
      console.error('[TileAction] handlePickupAll error:', e);
      dataManager.broadcast('ui:toast', { type: 'error', msg: '拾取失败：' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      dataManager.invalidate('player_inventory');
      dataManager.invalidate('tile_actions');
      dataManager.broadcast('game:action-completed');
      await loadTileAction();
      closeModal();
    }
  }

  /**
   * 区域切换
   *
   * 迁移自现有 tile-action.js handleSwitchRegion()：
   *   - 判断当前格是否为出口/入口
   *   - commandQueue.execute(map.move)
   *   - 成功后失效缓存 + loadMap + 广播
   */
  async function handleSwitchRegion(): Promise<void> {
    const mapStore = useMapStore();
    if (!mapStore.links || mapStore.curRegion === null) return;

    const regionInfo = (mapStore.links.regions as Record<string, {
      exit_pls?: string | number;
      entrance_pls?: string | number;
      prev_region?: string | number | null;
    }>)[String(mapStore.curRegion)];
    if (!regionInfo) return;

    const isOnExit = String(mapStore.curLoc) === String(regionInfo.exit_pls);
    const isOnEntrance =
      String(mapStore.curLoc) === String(regionInfo.entrance_pls) &&
      regionInfo.prev_region !== null && regionInfo.prev_region !== undefined;
    if (!isOnExit && !isOnEntrance) return;

    const targetPls = isOnExit ? regionInfo.exit_pls : regionInfo.entrance_pls;
    if (targetPls === undefined) return;

    debugBus.emit('action', 'switchRegion:trigger', { targetPls });
    try {
      const result = await commandQueue.execute({
        command: 'map.move',
        payload: { to: Number(targetPls) },
      });
      if (result.success) {
        dataManager.invalidate('game_map');
        dataManager.invalidate('tile_actions');
        dataManager.invalidate('player_inventory');
        await mapStore.loadMap();
        dataManager.broadcast('game:action-completed');
      } else {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '切换区域失败',
          isHtml: !!result.messageIsHtml,
        });
      }
    } catch (e) {
      debugBus.emit('error', 'switchRegion:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', { type: 'error', msg: '切换区域失败：' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  // ═══ 模态框操作 ═══

  /** 打开脚边道具模态框 */
  function openGroundModal(): void {
    if (groundItems.value.length === 0) return;
    modalType.value = 'ground';
    modalIaid.value = null;
    modalOpen.value = true;
  }

  /** 打开 POI 模态框 */
  function openPoiModal(iaid: string | number): void {
    modalType.value = 'poi';
    modalIaid.value = iaid;
    modalOpen.value = true;
  }

  /** 关闭模态框 */
  function closeModal(): void {
    modalOpen.value = false;
    modalType.value = null;
    modalIaid.value = null;
  }

  // ═══ 事件监听（与现有 tile-action.js 一致） ═══

  let _listenersRegistered = false;

  /** 注册 dataManager 事件监听（只注册一次） */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    // 地图加载完成 → 刷新动作条
    dataManager.listen('map:loaded', (data) => {
      const d = data as { hasLinks?: boolean } | undefined;
      if (d && d.hasLinks) loadTileAction();
    });

    // 操作完成 → 刷新动作条
    dataManager.listen('game:action-completed', () => {
      loadTileAction();
    });

    // 点击当前格 → 探索（由 map.js 广播）
    dataManager.listen('map:click-current', () => {
      handleExplore();
    });
  }

  return {
    // 状态
    tileActions,
    loading,
    modalOpen,
    modalType,
    modalIaid,
    // 计算属性
    pois,
    groundItems,
    modalPoi,
    modalTitle,
    modalItems,
    // 数据加载
    loadTileAction,
    // 命令处理
    handleExplore,
    handleWait,
    handleSearch,
    handlePickup,
    handlePickupAll,
    handleSwitchRegion,
    // 模态框
    openGroundModal,
    openPoiModal,
    closeModal,
    // 事件监听
    registerListeners,
  };
});
