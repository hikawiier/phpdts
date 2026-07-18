/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 背包 + 装备 store / Inventory Store
//
// 替代现有 vex/js/inventory.js 的状态管理 + 业务逻辑。
//
// 职责：
//   - inventoryData 状态（slots / num / limit）
//   - equipmentData 状态（来自 player_info.equipment）
//   - loadInventory()：拉取背包数据 + 装备数据
//   - handleDiscard(slot)：丢弃道具
//
// 事件监听（与现有 inventory.js 一致）：
//   - map:loaded → loadInventory
//   - game:action-completed → loadInventory
//
// 注意：装备数据来自 player_info（非 player_inventory），与现有 inventory.js
//       loadEquipmentData() 一致。M4 阶段直接复用 playerStore.playerInfo.equipment。
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { commandQueue } from '@/stores/command-queue';
import { dataManager } from '@/stores/data-manager';
import { debugBus } from '@/composables/useDebugBus';
import { usePlayerStore } from '@/stores/player';
import type { PlayerInventory, InventoryItem, EquipmentSlot } from '@/types/api';

/** 装备槽位定义（key 对齐后端 player.func.php equip_para_keys；label 为中文显示名） */
export const EQUIPMENT_SLOTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'wep',  label: '主武器' },
  { key: 'wep2', label: '副武器' },
  { key: 'db',   label: '护甲' },
  { key: 'dh',   label: '头部防具' },
  { key: 'da',   label: '手部防具' },
  { key: 'df',   label: '足部防具' },
  { key: 'ac',   label: '饰品' },
];

export const useInventoryStore = defineStore('inventory', () => {
  // ── 状态 ──
  const inventoryData = ref<PlayerInventory | null>(null);
  const loading = ref<boolean>(false);

  // ── 计算属性 ──
  const slots = computed<InventoryItem[]>(() => inventoryData.value?.slots || []);
  const num = computed<number>(() => Number(inventoryData.value?.num) || 0);
  const limit = computed<number>(() => Number(inventoryData.value?.limit) || 20);

  /**
   * 装备数据（来自 playerStore.playerInfo.equipment）
   * 与现有 inventory.js loadEquipmentData() 一致：装备数据从 player_info 读取
   */
  const equipment = computed<Record<string, EquipmentSlot | null>>(() => {
    const playerStore = usePlayerStore();
    return playerStore.playerInfo?.equipment || {};
  });

  /** itm0 手持道具（null 表示空手） */
  const itm0 = computed<InventoryItem | null>(() => inventoryData.value?.itm0 ?? null);

  /**
   * itm0 锁定状态（全局门控）
   * true = 玩家手持道具，后端仅允许堆叠合并/丢弃
   * CraftModal 等其他组件只读引用此状态
   */
  const itm0Locked = computed<boolean>(() => !!itm0.value);

  // ═══ 数据加载 ═══

  /**
   * 拉取背包数据
   *
   * 迁移自现有 vex/js/inventory.js loadInventory()：
   *   - 经 dataManager.fetch（去重 + 白名单缓存）
   *   - 装备数据复用 playerStore（player_info.equipment）
   */
  async function loadInventory(): Promise<void> {
    loading.value = true;
    debugBus.emit('api', 'loadInventory:start', { action: 'player_inventory' });
    try {
      const result = await dataManager.fetch('player_inventory', true);
      if (result.status === 'success' && result.data) {
        inventoryData.value = result.data as PlayerInventory;
      } else {
        inventoryData.value = null;
      }
    } catch (e) {
      debugBus.emit('error', 'loadInventory:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      inventoryData.value = null;
    } finally {
      loading.value = false;
    }
  }

  // ═══ 命令处理 ═══

  /**
   * 丢弃道具
   *
   * 迁移自现有 vex/js/inventory.js handleDiscard()：
   *   - commandQueue.execute(item.discard)
   *   - 成功后失效 player_inventory + 广播
   *   - 失败时广播 ui:toast
   */
  async function handleDiscard(slot: number): Promise<void> {
    debugBus.emit('action', 'discard:trigger', { slot });
    try {
      const result = await commandQueue.execute({
        command: 'item.discard',
        payload: { slot: Number(slot) },
      });
      if (result.success) {
        dataManager.invalidate('player_inventory');
        dataManager.broadcast('game:action-completed');
      } else {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '丢弃失败',
          isHtml: !!result.messageIsHtml,
        });
      }
    } catch (e) {
      debugBus.emit('error', 'discard:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', { type: 'error', msg: '丢弃失败：' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  /**
   * 使用道具（item.use 命令）
   *
   * 后端流程：状态过滤 → 应用 use_effect → 数量模型扣 itms-1 / 耐久模型不消耗 → emit use_item.success
   *
   * @param slot 背包槽位号（1~maxslots）
   */
  async function handleUseItem(slot: number): Promise<void> {
    debugBus.emit('action', 'useItem:trigger', { slot });
    try {
      const result = await commandQueue.execute({
        command: 'item.use',
        payload: { slot: Number(slot) },
      });
      if (!result.success) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '使用失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.broadcast('game:action-completed');
    } catch (e) {
      debugBus.emit('error', 'useItem:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '使用失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  /**
   * 装备道具（item.equip 命令）
   *
   * 后端流程：tag_equippable 校验 → 耐久校验 → 自动槽位判定 →
   * 装备交换（旧装备放入背包空位）→ 重建装备技能 → emit equip.success
   *
   * @param slot      背包槽位号（1~maxslots，不接受 itm0=0）
   * @param equipSlot 可选，显式指定装备槽位（'wep'/'wep2'/...）；不传时由后端按 itmk 自动映射
   */
  async function handleEquip(slot: number, equipSlot?: string): Promise<void> {
    debugBus.emit('action', 'equip:trigger', { slot, equipSlot });
    try {
      const result = await commandQueue.execute({
        command: 'item.equip',
        payload: { slot: Number(slot), ...(equipSlot ? { equip_slot: equipSlot } : {}) },
      });
      if (!result.success) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '装备失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.invalidate('player_info');
      dataManager.broadcast('game:action-completed');
    } catch (e) {
      debugBus.emit('error', 'equip:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '装备失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  /**
   * 卸下装备（item.unequip 命令）
   *
   * 后端流程：槽位非空校验 → 背包空位校验 → 装备还原为道具实例放入背包 →
   * 清空装备字段 → 重建装备技能 → emit unequip.success
   *
   * @param equipSlot 装备槽位名（'wep'/'wep2'/'db'/'dh'/'da'/'df'/'ac'）
   */
  async function handleUnequip(equipSlot: string): Promise<void> {
    debugBus.emit('action', 'unequip:trigger', { equipSlot });
    try {
      const result = await commandQueue.execute({
        command: 'item.unequip',
        payload: { equip_slot: equipSlot },
      });
      if (!result.success) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '卸下失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.invalidate('player_info');
      dataManager.broadcast('game:action-completed');
    } catch (e) {
      debugBus.emit('error', 'unequip:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '卸下失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  /**
   * 交换主副武器（item.swap_weapon 命令）
   *
   * 后端流程：wep/wep2 均空校验 → 交换 7 个装备字段 → 重建装备技能 → emit swap_weapon.success
   * 副武器不提供属性加成，交换后 effective_att 自动反映新主武器加成。
   */
  async function handleSwapWeapon(): Promise<void> {
    debugBus.emit('action', 'swap_weapon:trigger', {});
    try {
      const result = await commandQueue.execute({
        command: 'item.swap_weapon',
        payload: {},
      });
      if (!result.success) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '交换失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.invalidate('player_info');
      dataManager.broadcast('game:action-completed');
    } catch (e) {
      debugBus.emit('error', 'swap_weapon:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '交换失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  /**
   * 堆叠合并（inventory.organize 命令）
   *
   * 后端流程：将 itm0 中的道具尝试与背包内同类堆叠，腾出空槽
   * 成功后 itm0 清空，itm0Locked 自动变 false（computed 响应式）
   */
  async function handleOrganize(): Promise<void> {
    debugBus.emit('action', 'organize:trigger', {});
    try {
      const result = await commandQueue.execute({
        command: 'inventory.organize',
        payload: {},
      });
      if (!result.success) {
        dataManager.invalidate('player_inventory');
        await loadInventory();
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '堆叠合并失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.broadcast('game:action-completed');
      await loadInventory();
      if (itm0.value) {
        // 道具仍拿在手中——背包已满，无法合并也无法放入空槽
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: '背包已经塞不下了……',
        });
      }
      // 成功路径（itm0 清空）不广播 toast：后端已 emit item.to_bag 日志事件，
      // 背包视觉变化（数量+1 / 新槽位）由 game:action-completed → loadInventory 自然呈现
    } catch (e) {
      debugBus.emit('error', 'organize:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '堆叠合并失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  /**
   * 丢弃手持道具（item.discard slot=0 命令）
   *
   * 后端通过 item.discard 复用 obl_discard_item(slot=0) 分支。成功后 itm0 清空，itm0Locked 自动变 false。
   */
  async function handleDiscardItm0(): Promise<void> {
    debugBus.emit('action', 'discardItm0:trigger', {});
    try {
      const result = await commandQueue.execute({
        command: 'item.discard',
        payload: { slot: 0 },
      });
      if (!result.success) {
        dataManager.broadcast('ui:toast', {
          type: 'error',
          msg: result.message || result.error || '丢弃失败',
          isHtml: !!result.messageIsHtml,
        });
        return;
      }
      dataManager.invalidate('player_inventory');
      dataManager.broadcast('game:action-completed');
    } catch (e) {
      debugBus.emit('error', 'discardItm0:error', {
        error: e instanceof Error ? e.message : String(e),
      });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '丢弃失败：' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  // ═══ 事件监听（与现有 inventory.js 一致） ═══

  let _listenersRegistered = false;

  /** 注册 dataManager 事件监听（只注册一次） */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    dataManager.listen('map:loaded', () => {
      loadInventory();
    });
    dataManager.listen('game:action-completed', () => {
      loadInventory();
    });
  }

  return {
    // 状态
    inventoryData,
    loading,
    // 计算属性
    slots,
    num,
    limit,
    equipment,
    itm0,
    itm0Locked,
    // 数据加载
    loadInventory,
    // 命令处理
    handleDiscard,
    handleUseItem,
    handleEquip,
    handleUnequip,
    handleSwapWeapon,
    handleOrganize,
    handleDiscardItm0,
    // 事件监听
    registerListeners,
  };
});
