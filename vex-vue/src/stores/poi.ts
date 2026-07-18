/**
 * @module L Vue 组件
 * @framework L-9 POI 交互模态框
 */

// ══════════════════════════════════════════════════
// POI 模态框 store / POI Modal Store
//
// L-9 POI 交互模态框的状态管理 + 命令派发。
//
// 职责：
//   - modalOpen / modalMode（'list' | 'interaction'）/ currentIaid 状态
//   - selectedToolId / selectedSkillId 选材状态（对齐后端 poi.search 单值 payload）
//   - lastSearchFeedback（最近一次 poi.search 的 CommandResult.message / feedback）
//   - searchLoading / pickupLoading
//   - openModal / closeModal / enterInteraction / exitInteraction
//   - setToolId / setSkillId / clearToolId / clearSkillId
//   - doSearch（委托 tileActionStore.handleSearch，写入 lastSearchFeedback）
//   - pickupItem / pickupAllItems（委托 tileActionStore.handlePickup / handlePickupAll）
//
// 派生计算属性：
//   - currentPoi / poiList / hasUnpickedLoot / currentPoiItems（从 tileActionStore.pois 派生）
//   - itm0Locked（从 inventoryStore.itm0Locked 派生，与 craft.ts 同模式）
//   - canSearch / canPickup（从 commandQueue.canExecute 派生）
//
// 事件监听：
//   - battle:started → closeModal（强制关闭，让位战斗场景）
//   - map:loaded → closeModal（玩家已移动到新格子，旧 POI 列表失效）
//
// 相关文档：oblivions/docs/搜索建筑物与掉落机制重构-模块L-POI交互界面.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { useInventoryStore } from '@/stores/inventory';
import { commandQueue } from '@/stores/command-queue';
import { dataManager } from '@/stores/data-manager';
import { debugBus } from '@/composables/useDebugBus';
import type { Poi, GroundItem, PoiInteraction } from '@/types/api';
import type { CommandResult } from '@/api/client';

export type PoiModalMode = 'list' | 'interaction';

export interface PoiSearchFeedback {
  message: string;
  isHtml: boolean;
}

export const usePoiStore = defineStore('poi', () => {
  // ── 状态 ──
  const modalOpen = ref<boolean>(false);
  const modalMode = ref<PoiModalMode>('list');
  /** 当前交互态的 POI 实例 iaid（列表态为 null） */
  const currentIaid = ref<string | number | null>(null);
  /** 玩家选中的工具 ID（item_id，对齐后端 poi.search 的 tool_id 单值 payload） */
  const selectedToolId = ref<string | null>(null);
  /** 玩家选中的技能 ID（act_id，对齐后端 poi.search 的 skill_id 单值 payload） */
  const selectedSkillId = ref<string | null>(null);
  /** 最近一次 poi.search 的反馈文案（CommandResult.message / feedback 渲染结果） */
  const lastSearchFeedback = ref<PoiSearchFeedback | null>(null);
  const searchLoading = ref<boolean>(false);
  const pickupLoading = ref<boolean>(false);
  /** F-6 poi.interact 命令执行中标志 */
  const interactLoading = ref<boolean>(false);

  // ── 派生计算属性 ──

  /** 当前格 POI 列表（直接派生 tileActionStore.pois） */
  const poiList = computed<Poi[]>(() => useTileActionStore().pois);

  /** 当前交互的 POI（按 currentIaid 匹配，交互态用） */
  const currentPoi = computed<Poi | null>(() => {
    if (currentIaid.value === null) return null;
    const list = poiList.value;
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].iaid) === String(currentIaid.value)) return list[i];
    }
    return null;
  });

  /** 任意 POI 有未拾取掉落（列表态视觉强调） */
  const hasUnpickedLoot = computed<boolean>(() => {
    const list = poiList.value;
    for (let i = 0; i < list.length; i++) {
      if ((list[i].items || []).length > 0) return true;
    }
    return false;
  });

  /** 当前交互 POI 的道具列表（交互态道具列表数据源） */
  const currentPoiItems = computed<GroundItem[]>(() => currentPoi.value?.items || []);

  /**
   * itm0 锁定状态（从 inventoryStore 派生，不维护独立状态）
   * 与 craft.ts 第 120 行 `const itm0Locked = computed(() => useInventoryStore().itm0Locked);` 同模式
   * R5 决策：不从 craftStore 提升到全局 store，复用 inventoryStore.itm0Locked computed 派生
   */
  const itm0Locked = computed<boolean>(() => useInventoryStore().itm0Locked);

  /** poi.search 是否可执行（受 K-3 多层门控拦截） */
  const canSearch = computed<boolean>(() => commandQueue.canExecute('poi.search'));

  /** item.pickup 是否可执行（受 K-3 多层门控拦截） */
  const canPickup = computed<boolean>(() => commandQueue.canExecute('item.pickup'));

  /** F-6 poi.interact 是否可执行（受 K-3 多层门控拦截） */
  const canInteract = computed<boolean>(() => commandQueue.canExecute('poi.interact'));

  /** 当前 POI 是否可搜索（结合 POI 自身 state/searchable/searched/repeatable 与 canSearch）
   *
   * 与后端 [poi.search.func.php] 状态机保持一致：
   * - exhausted：终态，不可搜
   * - cooldown：到期（cooldown_remaining_turn=0）可搜，后端会先推进到 idle 再执行搜索
   * - searched：items 已全部拾取时可搜，后端会先推进到 idle/cooldown 再执行搜索
   * - idle：可搜
   */
  const currentPoiSearchable = computed<boolean>(() => {
    const poi = currentPoi.value;
    if (!poi) return false;
    if (!poi.searchable) return false;
    const state = poi.state ?? 'idle';
    // exhausted 终态
    if (state === 'exhausted') return false;
    // cooldown 态：检查是否到期
    if (state === 'cooldown') {
      const remaining = Number(poi.cooldown_remaining_turn) || 0;
      return remaining === 0;
    }
    // searched 态：检查是否还有未拾取道具
    if (state === 'searched') {
      const items = poi.items ?? [];
      if (items.length > 0) return false;
    }
    // 已搜索且不可重复 → 不可再搜
    if (poi.searched && !poi.repeatable) return false;
    // 可重复但已达上限 → 不可再搜
    if (poi.repeatable) {
      const limit = Number(poi.repeat_limit) || 0;
      const count = Number(poi.search_count) || 0;
      if (limit > 0 && count >= limit) return false;
      // search_count_remaining=0 也视为耗尽
      const remaining = Number(poi.search_count_remaining);
      if (!Number.isNaN(remaining) && remaining === 0) return false;
    }
    return true;
  });

  /** F-6 当前 POI 可用的道具交互列表（从 tile_actions 投影的 interactions 派生） */
  const currentPoiInteractions = computed<PoiInteraction[]>(() => currentPoi.value?.interactions || []);

  // ═══ 模态框操作 ═══

  /** 打开模态框（列表态） */
  function openModal(): void {
    modalMode.value = 'list';
    currentIaid.value = null;
    selectedToolId.value = null;
    selectedSkillId.value = null;
    lastSearchFeedback.value = null;
    modalOpen.value = true;
  }

  /** 关闭模态框（清空全部交互态） */
  function closeModal(): void {
    modalOpen.value = false;
    modalMode.value = 'list';
    currentIaid.value = null;
    selectedToolId.value = null;
    selectedSkillId.value = null;
    lastSearchFeedback.value = null;
  }

  /** 列表态 → 交互态，初始化选材为空，记录 currentIaid */
  function enterInteraction(iaid: string | number): void {
    currentIaid.value = iaid;
    selectedToolId.value = null;
    selectedSkillId.value = null;
    lastSearchFeedback.value = null;
    modalMode.value = 'interaction';
  }

  /** 交互态 → 列表态，清空选材与反馈 */
  function exitInteraction(): void {
    currentIaid.value = null;
    selectedToolId.value = null;
    selectedSkillId.value = null;
    lastSearchFeedback.value = null;
    modalMode.value = 'list';
  }

  // ═══ 选材操作 ═══

  function setToolId(id: string): void {
    selectedToolId.value = id;
  }

  function setSkillId(id: string): void {
    selectedSkillId.value = id;
  }

  function clearToolId(): void {
    selectedToolId.value = null;
  }

  function clearSkillId(): void {
    selectedSkillId.value = null;
  }

  // ═══ 命令派发 ═══

  /**
   * 提交 poi.search 命令
   *
   * 委托 tileActionStore.handleSearch（已扩展签名，透传 tool_id / skill_id），
   * 避免命令逻辑双写。捕获 CommandResult 写入 lastSearchFeedback 供 PoiFeedbackPanel 渲染。
   *
   * 成功路径：handleSearch 内部失效 tile_actions + loadTileAction，currentPoi.items[] 响应式更新
   * 失败路径：handleSearch 内部广播 ui:toast，lastSearchFeedback 同步写入让玩家在模态框内看到原因
   */
  async function doSearch(): Promise<void> {
    if (currentIaid.value === null) return;
    if (!canSearch.value) return;

    const iaid = currentIaid.value;
    const toolId = selectedToolId.value;
    const skillId = selectedSkillId.value;

    debugBus.emit('action', 'poi:doSearch', { iaid, tool_id: toolId, skill_id: skillId });
    searchLoading.value = true;

    let result: CommandResult;
    try {
      const tileActionStore = useTileActionStore();
      result = await tileActionStore.handleSearch(iaid, toolId, skillId);
    } catch (e) {
      debugBus.emit('error', 'poi:doSearchError', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '搜索失败：' + (e instanceof Error ? e.message : String(e)),
      });
      return;
    } finally {
      searchLoading.value = false;
    }

    // 写入 lastSearchFeedback（成功/失败均写入，让 PoiFeedbackPanel 持续展示最近一次反馈）
    const message = result.message || result.error || '';
    if (message) {
      lastSearchFeedback.value = {
        message,
        isHtml: !!result.messageIsHtml,
      };
    }
  }

  /**
   * 拾取单件道具（委托 tileActionStore.handlePickup）
   *
   * 成功路径：handlePickup 内部失效 player_inventory + tile_actions + loadTileAction，
   * currentPoi.items[] 响应式移除已拾取道具
   */
  async function pickupItem(iid: string | number): Promise<void> {
    if (!canPickup.value) return;
    debugBus.emit('action', 'poi:pickupItem', { iid });
    pickupLoading.value = true;
    try {
      const tileActionStore = useTileActionStore();
      await tileActionStore.handlePickup(iid);
    } finally {
      pickupLoading.value = false;
    }
  }

  /**
   * 批量拾取当前 POI 的全部道具（委托 tileActionStore.handlePickupAll）
   *
   * handlePickupAll 内部逐件执行 item.pickup + 背包已满提前终止 + 完成后 closeModal
   * 注意：handlePickupAll 完成后会调用 tileActionStore.closeModal()，
   * 但 POI 模态框由 poiStore 管理，故此处调用后保持 poiStore 状态一致——
   * 由于 tileActionStore.modalOpen 与 poiStore.modalOpen 是两套独立状态，
   * 我们不调用 handlePickupAll（它会关闭 tileAction 模态框，影响 POI 模态框逻辑），
   * 改为逐件调用 handlePickup 复用 poiStore.pickupItem。
   */
  async function pickupAllItems(): Promise<void> {
    if (!canPickup.value) return;
    const items = currentPoiItems.value;
    if (items.length === 0) return;

    debugBus.emit('action', 'poi:pickupAll', { count: items.length });
    pickupLoading.value = true;
    try {
      const tileActionStore = useTileActionStore();
      // 复用 tileActionStore.handlePickupAll 的批量逻辑（含背包满提前终止），
      // 但其内部会调用 tileActionStore.closeModal()——对 POI 模态框无影响
      // （POI 模态框由 poiStore.modalOpen 独立管理）
      await tileActionStore.handlePickupAll(items);
    } finally {
      pickupLoading.value = false;
    }
  }

  /**
   * F-6 提交 poi.interact 命令
   *
   * 与 doSearch 同模式：commandQueue.execute + 失效 tile_actions/player_inventory/player_info。
   * 失败路径广播 ui:toast；成功路径广播 game:action-completed 让 tile_actions 重新拉取，
   * currentPoi.interactions[] 响应式更新（已解锁 POI 的 interactions 自然清空）。
   */
  async function handleInteract(slot: number, iaid: string | number): Promise<void> {
    if (!canInteract.value) return;

    debugBus.emit('action', 'poi:interact', { slot, iaid });
    interactLoading.value = true;
    try {
      const result = await commandQueue.execute({
        command: 'poi.interact',
        payload: { slot: Number(slot), iaid: Number(iaid) },
      });
      if (!result.success) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '交互失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.invalidate('player_info');
      dataManager.invalidate('tile_actions');
      dataManager.broadcast('game:action-completed');
    } catch (e) {
      debugBus.emit('error', 'poi:interactError', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '交互失败：' + (e instanceof Error ? e.message : String(e)),
      });
    } finally {
      interactLoading.value = false;
    }
  }

  // ═══ 事件监听 ═══

  let _listenersRegistered = false;

  /** 注册 dataManager 事件监听（只注册一次） */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    // 战斗开始 → 强制关闭 POI 模态框（让位战斗场景）
    dataManager.listen('battle:started', () => {
      if (modalOpen.value) {
        debugBus.emit('action', 'poi:forceCloseByBattle', {});
        closeModal();
      }
    });

    // 地图加载完成（玩家移动到新格子）→ 强制关闭 POI 模态框（旧 POI 列表失效）
    dataManager.listen('map:loaded', () => {
      if (modalOpen.value) {
        debugBus.emit('action', 'poi:forceCloseByMapLoaded', {});
        closeModal();
      }
    });
  }

  return {
    // 状态
    modalOpen,
    modalMode,
    currentIaid,
    selectedToolId,
    selectedSkillId,
    lastSearchFeedback,
    searchLoading,
    pickupLoading,
    interactLoading,
    // 计算属性
    poiList,
    currentPoi,
    hasUnpickedLoot,
    currentPoiItems,
    itm0Locked,
    canSearch,
    canPickup,
    canInteract,
    currentPoiSearchable,
    currentPoiInteractions,
    // 模态框操作
    openModal,
    closeModal,
    enterInteraction,
    exitInteraction,
    // 选材操作
    setToolId,
    setSkillId,
    clearToolId,
    clearSkillId,
    // 命令派发
    doSearch,
    pickupItem,
    pickupAllItems,
    handleInteract,
    // 事件监听
    registerListeners,
  };
});
