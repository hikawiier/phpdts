// ══════════════════════════════════════════════════
// UI 全局状态 store
//
// 管理抽屉/模态框开关 + 战斗按钮三态 + 抽屉标签。
// 替代现有 vex/js/app.js 的模块内 let 变量：
//   let invDrawerOpen = false;
//   let battleBtnState = 'normal';  // normal / battle / aim
//
// 战斗按钮三态通过 dataManager.listen 同步：
//   battle:started  → 'battle'
//   battle:ended    → 'normal'
//   battle:aim-mode → 'aim'
//   battle:aim-exit → 'battle'
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dataManager } from '@/stores/data-manager';

export type BattleBtnState = 'normal' | 'battle' | 'aim';
export type InvTab = 'inventory' | 'equipment';
export type MapInputMode = 'normal' | 'aim';

export const useUiStore = defineStore('ui', () => {
  // ── 抽屉开关 ──
  const playerDrawerOpen = ref<boolean>(false);
  const inventoryDrawerOpen = ref<boolean>(false);

  // ── 模态框 ──
  const modalOpen = ref<boolean>(false);
  const modalTitle = ref<string>('');
  const modalBodyHtml = ref<string>(''); // HTML 字符串（由调用方注入）

  // ── 战斗按钮三态 ──
  const battleBtnState = ref<BattleBtnState>('normal');
  const mapInputMode = ref<MapInputMode>('normal');

  // ── 右抽屉标签 ──
  const activeInvTab = ref<InvTab>('inventory');

  // ── Toast 位置类（由 useToastPosition composable 在 M5 设置） ──
  const toastPositionClass = ref<string>('');

  // ═══ 抽屉操作（互斥逻辑与现有 app.js 一致） ═══

  /** 打开左侧属性抽屉（互斥关闭右侧） */
  function openPlayerDrawer(): void {
    if (inventoryDrawerOpen.value) closeInventoryDrawer();
    playerDrawerOpen.value = true;
  }

  /** 关闭左侧属性抽屉 */
  function closePlayerDrawer(): void {
    playerDrawerOpen.value = false;
  }

  /** 切换左侧属性抽屉 */
  function togglePlayerDrawer(): void {
    if (playerDrawerOpen.value) {
      closePlayerDrawer();
    } else {
      openPlayerDrawer();
    }
  }

  /** 打开右侧道具抽屉（互斥关闭左侧） */
  function openInventoryDrawer(): void {
    if (playerDrawerOpen.value) closePlayerDrawer();
    inventoryDrawerOpen.value = true;
  }

  /** 关闭右侧道具抽屉 */
  function closeInventoryDrawer(): void {
    inventoryDrawerOpen.value = false;
  }

  /** 切换右侧道具抽屉 */
  function toggleInventoryDrawer(): void {
    if (inventoryDrawerOpen.value) {
      closeInventoryDrawer();
    } else {
      openInventoryDrawer();
    }
  }

  // ═══ 模态框操作 ═══

  /** 打开模态框 */
  function openModal(title: string, bodyHtml: string): void {
    modalTitle.value = title;
    modalBodyHtml.value = bodyHtml;
    modalOpen.value = true;
  }

  /** 关闭模态框 */
  function closeModal(): void {
    modalOpen.value = false;
  }

  // ═══ 右抽屉标签 ═══

  /** 设置当前激活的标签 */
  function setActiveInvTab(tab: InvTab): void {
    activeInvTab.value = tab;
  }

  // ═══ 战斗按钮三态（监听 dataManager 事件同步） ═══

  dataManager.listen('battle:started', () => {
    battleBtnState.value = 'battle';
  });
  dataManager.listen('battle:ended', () => {
    battleBtnState.value = 'normal';
    mapInputMode.value = 'normal';
  });
  dataManager.listen('battle:aim-mode', () => {
    battleBtnState.value = 'aim';
    mapInputMode.value = 'aim';
  });
  dataManager.listen('battle:aim-exit', () => {
    battleBtnState.value = 'battle';
    mapInputMode.value = 'normal';
  });

  return {
    // 状态
    playerDrawerOpen,
    inventoryDrawerOpen,
    modalOpen,
    modalTitle,
    modalBodyHtml,
    battleBtnState,
    mapInputMode,
    activeInvTab,
    toastPositionClass,
    // 抽屉操作
    openPlayerDrawer,
    closePlayerDrawer,
    togglePlayerDrawer,
    openInventoryDrawer,
    closeInventoryDrawer,
    toggleInventoryDrawer,
    // 模态框
    openModal,
    closeModal,
    // 标签
    setActiveInvTab,
  };
});
