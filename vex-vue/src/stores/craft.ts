// ══════════════════════════════════════════════════
// 合成 store / Craft Store
//
// CraftModal 的状态管理 + 业务逻辑。
//
// 职责：
//   - craftModalOpen / backpackSlots / wbMaterialIds 状态
//   - availableWbMaterials / recipes / previewResult 数据
//   - openModal/closeModal/toggleBackpackSlot/toggleWbMaterial
//   - adjustBackpackCount（[-][+] 按钮）
//   - refreshPreview（防抖 200ms leading+trailing）
//   - doCraft（提交 obl_craft 命令）
//   - quickCraft（按配方自动选材）
//
// 事件：无监听（合成是用户主动触发的临时交互，不需要响应外部事件）
//
// 相关文档：oblivions/docs/vex-vue-合成界面设计案.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { commandQueue } from '@/stores/command-queue';
import { dataManager } from '@/stores/data-manager';
import { useInventoryStore } from '@/stores/inventory';
import { debugBus } from '@/composables/useDebugBus';
import { gameApiWithParams } from '@/api/client';
import { getRecipeName } from '@/data/recipe-locale';
import type {
  CraftPreviewResult,
  WorkbenchMaterial,
  CraftRecipe,
  CraftMaterial,
  PreviewLog,
  InventoryItem,
} from '@/types/api';

export interface CraftBackpackSlot {
  slot: number;
  count: number; // 该格投入数量（初始=itms 整格，可由玩家调整或 quickCraft 指定）
}

// ── 匹配辅助函数（供 quickCraft 与 CraftRecipeList 共用） ──

/**
 * 检查道具（背包或工作台）是否匹配 material（item_id > itmk > tag 优先级）
 *
 * 注意：此函数不做 tool_level 检查（背包道具无 tool_level 字段，
 * 工作台道具的 tool_level 检查由调用方按需添加）。
 */
export function itemMatchesMaterial(
  item: { item_id?: string; itmk?: string; tags?: string[] },
  mat: CraftMaterial,
): boolean {
  if (mat.item_id && item.item_id === mat.item_id) return true;
  if (mat.itmk && item.itmk === mat.itmk) return true;
  if (mat.tag && item.tags && item.tags.includes(mat.tag)) return true;
  return false;
}

/**
 * 检查工作台素材是否匹配 material（仅匹配 consume='none'）
 */
export function wbMatchesMaterial(wb: WorkbenchMaterial, mat: CraftMaterial): boolean {
  if (mat.consume !== 'none') return false;
  if ((wb.tool_level ?? 0) < (mat.min_level ?? 0)) return false;
  return itemMatchesMaterial(wb, mat);
}

/**
 * 解析 InventoryItem 的 durability 为数字（'∞' → Infinity，无效 → 0）
 */
function parseItms(dur: string | number | undefined): number {
  if (dur === undefined || dur === null || dur === '') return 0;
  if (dur === '∞') return Infinity;
  const n = Number(dur);
  return Number.isFinite(n) ? n : 0;
}

export const useCraftStore = defineStore('craft', () => {
  // ── 状态 ──
  const craftModalOpen = ref(false);
  const backpackSlots = ref<CraftBackpackSlot[]>([]);
  const wbMaterialIds = ref<string[]>([]);
  const availableWbMaterials = ref<WorkbenchMaterial[]>([]);
  const previewResult = ref<CraftPreviewResult | null>(null);
  const recipes = ref<CraftRecipe[]>([]);

  // ── 成功 banner（合成成功时在模态框顶部显示，2.5s 自动消失） ──
  const successRecipeName = ref<string | null>(null);
  function clearSuccessBanner(): void {
    successRecipeName.value = null;
  }

  // ── loading 状态 ──
  const loading = ref(false); // openModal 时加载 wb + recipes
  const previewLoading = ref(false); // refreshPreview 防抖期间

  // ── 防抖内部状态 ──
  let _debounceTimer: number | null = null;
  let _lastInvokeTime = 0;
  let _pendingScheduled = false;
  let _refreshRequestId = 0;

  // ── 计算属性 ──
  const isCraftable = computed(() => previewResult.value?.craftable ?? false);
  const matchCount = computed(() => previewResult.value?.match_count ?? 0);
  const previewLog = computed<PreviewLog | null>(
    () => previewResult.value?.preview_log ?? null,
  );
  const hasSelection = computed(
    () => backpackSlots.value.length > 0 || wbMaterialIds.value.length > 0,
  );

  /** itm0 锁定状态（从 inventoryStore 派生，不维护独立状态） */
  const itm0Locked = computed(() => useInventoryStore().itm0Locked);

  // ═══ 数据加载 ═══

  /**
   * 打开合成模态框
   *
   * 并行加载工作台素材 + 配方列表（任一失败不阻塞其他）。
   * inventory 数据复用 inventoryStore（已在打开前加载）。
   */
  async function openModal(): Promise<void> {
    loading.value = true;
    debugBus.emit('action', 'craft:openModal', {});

    // 并行加载，任一失败不阻塞
    const [wbResult, recipesResult] = await Promise.allSettled([
      dataManager.fetch('craft_workbench_materials'),
      dataManager.fetch('craft_recipes'),
    ]);

    if (wbResult.status === 'fulfilled' && wbResult.value.status === 'success') {
      const data = wbResult.value.data as { workbench_materials?: WorkbenchMaterial[] } | undefined;
      availableWbMaterials.value = data?.workbench_materials ?? [];
    } else {
      availableWbMaterials.value = [];
      debugBus.emit('error', 'craft:loadWbFailed', { result: wbResult });
    }

    if (recipesResult.status === 'fulfilled' && recipesResult.value.status === 'success') {
      const data = recipesResult.value.data as { recipes?: CraftRecipe[] } | undefined;
      recipes.value = data?.recipes ?? [];
    } else {
      recipes.value = [];
      debugBus.emit('error', 'craft:loadRecipesFailed', { result: recipesResult });
    }

    // 重置选材状态
    wbMaterialIds.value = [];
    backpackSlots.value = [];
    previewResult.value = null;

    loading.value = false;
    craftModalOpen.value = true;

    // 触发初始 craft.empty_pool 反馈（素材池为空时本地构造，不调 API）
    refreshPreview();
  }

  /** 关闭模态框，重置选材状态（保留 availableWbMaterials / recipes 缓存） */
  function closeModal(): void {
    // 清除防抖定时器，防止卸载后触发
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
      _pendingScheduled = false;
    }
    backpackSlots.value = [];
    wbMaterialIds.value = [];
    previewResult.value = null;
    craftModalOpen.value = false;
  }

  /** 清空素材池（保留模态框打开状态，供 [清空] 按钮调用） */
  function clearSelection(): void {
    backpackSlots.value = [];
    wbMaterialIds.value = [];
    previewResult.value = null;
    refreshPreview();
  }

  // ═══ 选材操作 ═══

  /** 切换背包槽位选中状态（选中=整格投入，再次点击=取消） */
  function toggleBackpackSlot(slot: number): void {
    const idx = backpackSlots.value.findIndex(s => s.slot === slot);
    if (idx >= 0) {
      backpackSlots.value.splice(idx, 1);
    } else {
      const inv = useInventoryStore().slots.find(i => i.slot === slot);
      if (!inv || inv.empty) return;
      const stack = inv.stack ?? false;
      const dur = parseItms(inv.durability);
      // 数量模型：整格投入；耐久模型：固定 1（整槽消耗）
      const count = stack ? (Number.isFinite(dur) ? dur : 1) : 1;
      backpackSlots.value.push({ slot, count });
    }
    refreshPreview();
  }

  /** 切换工作台素材选中状态 */
  function toggleWbMaterial(id: string): void {
    const idx = wbMaterialIds.value.indexOf(id);
    if (idx >= 0) {
      wbMaterialIds.value.splice(idx, 1);
    } else {
      wbMaterialIds.value.push(id);
    }
    refreshPreview();
  }

  /**
   * 调整背包素材投入数量（[-][+] 按钮调用）
   * 仅数量模型（stack=true）可调整；耐久模型固定 1
   */
  function adjustBackpackCount(slot: number, delta: number): void {
    const bs = backpackSlots.value.find(s => s.slot === slot);
    if (!bs) return;
    const inv = useInventoryStore().slots.find(i => i.slot === slot);
    if (!inv || inv.empty) return;
    if (inv.stack !== true) return; // 耐久模型不允许调整

    const max = parseItms(inv.durability);
    const upper = Number.isFinite(max) ? max : bs.count; // 无限不限制上限
    const newCount = Math.max(1, Math.min(bs.count + delta, upper));
    if (newCount === bs.count) return;
    bs.count = newCount;
    refreshPreview();
  }

  // ═══ 预判（防抖 leading+trailing 200ms） ═══

  /**
   * 触发预判刷新（防抖 200ms，leading+trailing）
   *
   * 素材池为空时本地构造 empty_pool 反馈，避免无谓 API 请求。
   */
  function refreshPreview(): void {
    // 素材池为空：本地构造 empty_pool
    if (backpackSlots.value.length === 0 && wbMaterialIds.value.length === 0) {
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
        _pendingScheduled = false;
      }
      previewResult.value = {
        match_count: 0,
        craftable: false,
        recipe_id: null,
        preview_log: { id: 'craft.empty_pool', params: {} },
      };
      return;
    }

    const now = Date.now();
    const elapsed = now - _lastInvokeTime;

    // Leading：距上次调用 ≥ 200ms，立即触发
    if (elapsed >= 200) {
      _lastInvokeTime = now;
      void _doRefreshPreview();
      return;
    }

    // Trailing：调度最后一次调用
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
    }
    _pendingScheduled = true;
    _debounceTimer = window.setTimeout(
      () => {
        _debounceTimer = null;
        if (_pendingScheduled) {
          _pendingScheduled = false;
          _lastInvokeTime = Date.now();
          void _doRefreshPreview();
        }
      },
      200 - elapsed,
    );
  }

  /** 实际执行 craft_preview API 调用 */
  async function _doRefreshPreview(): Promise<void> {
    const myRequestId = ++_refreshRequestId;
    previewLoading.value = true;

    const slotsStr = backpackSlots.value
      .map(s => `${s.slot}:${s.count}`)
      .join(',');
    const wbStr = wbMaterialIds.value.join(',');
    const params: Record<string, string> = {};
    if (slotsStr) params.slots = slotsStr;
    if (wbStr) params.workbench_materials = wbStr;

    try {
      const resp = await gameApiWithParams('craft_preview', params);
      // 丢弃过期响应（防止快速连续操作时旧响应覆盖新状态）
      if (myRequestId !== _refreshRequestId) return;

      if (resp.status === 'success' && resp.data) {
        previewResult.value = resp.data as CraftPreviewResult;
      } else {
        // 保留旧 previewResult，让 ④ 显示原有反馈
        debugBus.emit('error', 'craft:previewApiError', { resp });
      }
    } catch (e) {
      if (myRequestId !== _refreshRequestId) return;
      debugBus.emit('error', 'craft:previewError', {
        error: e instanceof Error ? e.message : String(e),
      });
      // 保留旧 previewResult
    } finally {
      if (myRequestId === _refreshRequestId) {
        previewLoading.value = false;
      }
    }
  }

  // ═══ 合成命令 ═══

  /**
   * 提交 obl_craft 命令
   *
   * 成功路径（业务结果通过日志反馈）：
   *   - invalidate player_inventory + 广播 + 等待背包刷新
   *   - itm0Locked=true（产物卡 itm0）→ closeModal，交背包界面处理
   *   - itm0Locked=false（产物入背包）→ 清空素材池保持打开，支持连续合成
   *
   * itm0 锁定由 execute() 内部 _checkLocks 第 3 层拦截（obl_craft itm0Allowed=false）。
   *
   * result.success 不反映业务失败（后端命令处理无 return，HTTP 响应恒为 {}）。
   */
  async function doCraft(): Promise<void> {
    const slotsStr = backpackSlots.value
      .map(s => `${s.slot}:${s.count}`)
      .join(',');
    const wbStr = wbMaterialIds.value.join(',');

    debugBus.emit('action', 'craft:doCraft', { slots: slotsStr, wb: wbStr });

    let result;
    try {
      result = await commandQueue.execute({
        command: 'obl_craft',
        slots: slotsStr,
        workbench_materials: wbStr,
      });
    } catch (e) {
      debugBus.emit('error', 'craft:doCraftError', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '合成失败：' + (e instanceof Error ? e.message : String(e)),
      });
      return;
    }

    if (!result.success) {
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: result.message || result.error || '合成失败',
      });
      return;
    }

    // 统一成功路径：失效 + 广播 + 等待背包刷新
    dataManager.invalidate('player_inventory');
    dataManager.broadcast('game:action-completed');

    const inventoryStore = useInventoryStore();
    await inventoryStore.loadInventory(); // 显式等待背包刷新

    if (inventoryStore.itm0Locked) {
      // 产物卡 itm0（背包满）→ 关闭，全局 toast 提示
      const craftedRecipeId = previewResult.value?.recipe_id;
      const recipeName = craftedRecipeId ? getRecipeName(craftedRecipeId) : '';
      dataManager.broadcast('ui:toast', {
        type: 'success',
        msg: recipeName ? `合成成功：${recipeName}` : '合成成功',
      });
      closeModal();
    } else {
      // 产物入背包 → 清空素材池，模态框顶部 banner 提示（支持连续合成）
      const craftedRecipeId = previewResult.value?.recipe_id;
      const recipeName = craftedRecipeId ? getRecipeName(craftedRecipeId) : '';
      successRecipeName.value = recipeName || '合成成功';
      backpackSlots.value = [];
      wbMaterialIds.value = [];
      previewResult.value = {
        match_count: 0,
        craftable: false,
        recipe_id: null,
        preview_log: { id: 'craft.success', params: { recipe_name: recipeName } },
      };
    }
  }

  // ═══ 快速合成 / 填充素材 ═══

  /**
   * 按配方自动填充素材池（不提交合成）
   *
   * 用于"部分关联"配方点击：填入已关联素材，让玩家手动调整缺失部分。
   * 不足时 toast + 保留已填充状态 + refreshPreview。
   *
   * @returns true=全部匹配；false=素材不足（已填充部分状态）
   */
  async function fillRecipeMaterials(recipeId: string): Promise<boolean> {
    const recipe = recipes.value.find(r => r.recipe_id === recipeId);
    if (!recipe) return false;

    const inventoryStore = useInventoryStore();
    const slots = inventoryStore.slots;
    const usedSlots = new Set<number>();
    const newBackpackSlots: CraftBackpackSlot[] = [];
    const newWbIds: string[] = [];
    let insufficient = false;

    for (const mat of recipe.materials) {
      const need = mat.count ?? 1;

      // consume='none'：从工作台匹配
      if (mat.consume === 'none') {
        const wb = availableWbMaterials.value.find(w => wbMatchesMaterial(w, mat));
        if (wb) {
          if (!newWbIds.includes(wb.id)) newWbIds.push(wb.id);
        } else {
          insufficient = true;
          // 不 break：继续填充后续背包素材，让玩家看到部分填充状态
        }
        continue;
      }

      // consume='all'/'durability'：从背包匹配
      let remaining = need;

      if (remaining > 0 && mat.item_id) {
        remaining -= _scanInventoryForMaterial(
          slots,
          mat,
          'item_id',
          usedSlots,
          newBackpackSlots,
          remaining,
        );
      }
      if (remaining > 0 && mat.itmk) {
        remaining -= _scanInventoryForMaterial(
          slots,
          mat,
          'itmk',
          usedSlots,
          newBackpackSlots,
          remaining,
        );
      }
      if (remaining > 0 && mat.tag) {
        remaining -= _scanInventoryForMaterial(
          slots,
          mat,
          'tag',
          usedSlots,
          newBackpackSlots,
          remaining,
        );
      }

      if (remaining > 0) {
        insufficient = true;
        // 不 break：继续填充后续 material，让玩家看到部分填充状态
      }
    }

    // 应用填充状态（无论充足与否，让玩家看到当前部分填充）
    backpackSlots.value = newBackpackSlots;
    wbMaterialIds.value = newWbIds;

    if (insufficient) {
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '素材不足，已填入可用素材',
      });
      refreshPreview();
      return false;
    }

    refreshPreview();
    return true;
  }

  /**
   * 快速合成：按配方自动选材并提交
   *
   * 全部匹配 → fillRecipeMaterials + doCraft
   * 素材不足 → fillRecipeMaterials（填充部分 + toast + 不提交）
   */
  async function quickCraft(recipeId: string): Promise<void> {
    const success = await fillRecipeMaterials(recipeId);
    if (success) {
      await doCraft();
    }
  }

  /**
   * 扫描背包槽位匹配指定 material 字段（item_id/itmk/tag）
   * 匹配成功的槽位加入 usedSlots + newBackpackSlots
   * @returns 实际匹配的数量
   */
  function _scanInventoryForMaterial(
    slots: InventoryItem[],
    mat: CraftMaterial,
    matchKey: 'item_id' | 'itmk' | 'tag',
    usedSlots: Set<number>,
    newBackpackSlots: CraftBackpackSlot[],
    maxNeed: number,
  ): number {
    let matched = 0;
    for (const inv of slots) {
      if (matched >= maxNeed) break;
      if (inv.empty) continue;
      if (usedSlots.has(inv.slot)) continue;

      let isMatch = false;
      if (matchKey === 'item_id') {
        isMatch = !!mat.item_id && inv.item_id === mat.item_id;
      } else if (matchKey === 'itmk') {
        isMatch = !!mat.itmk && inv.itmk === mat.itmk;
      } else {
        isMatch = !!mat.tag && !!inv.tags && inv.tags.includes(mat.tag);
      }
      if (!isMatch) continue;

      const stack = inv.stack ?? false;
      const dur = parseItms(inv.durability);
      // 数量模型：可投入 ≤ durability；耐久模型：整槽消耗 1
      const available = stack ? (Number.isFinite(dur) ? dur : maxNeed) : 1;
      const take = Math.min(maxNeed - matched, available);
      if (take <= 0) continue;

      newBackpackSlots.push({ slot: inv.slot, count: take });
      usedSlots.add(inv.slot);
      matched += take;
    }
    return matched;
  }

  return {
    // 状态
    craftModalOpen,
    backpackSlots,
    wbMaterialIds,
    availableWbMaterials,
    previewResult,
    recipes,
    loading,
    previewLoading,
    successRecipeName,
    clearSuccessBanner,
    // 计算属性
    isCraftable,
    matchCount,
    previewLog,
    hasSelection,
    itm0Locked,
    // 数据加载
    openModal,
    closeModal,
    clearSelection,
    // 选材操作
    toggleBackpackSlot,
    toggleWbMaterial,
    adjustBackpackCount,
    // 预判
    refreshPreview,
    // 合成命令
    doCraft,
    quickCraft,
    fillRecipeMaterials,
  };
});
