/**
 * @module M 组合式函数
 * @framework M-6 覆盖层优先级堆栈
 */

// ══════════════════════════════════════════════════
// Toast 位置管理 / Toast position manager
//
// 替代现有 vex/js/toast-position.js 的 isAnyOverlayOpen + updateToastPosition。
//
// 规则（与原前端一致）：
//   - 无 2 级页面 / 左抽屉开 → 右上角（默认，''）
//   - 右抽屉开 → 左上角（'pos-left'，避免被抽屉遮挡）
//   - 模态框开 → 中上（'pos-center'，避免被模态框遮挡）
//   优先级：模态框 > 右抽屉 > 左抽屉/默认
//
// 实现：
//   - isAnyOverlayOpen()：基于 uiStore + tileActionStore 状态计算
//     （POI/ground 模态框由 tileActionStore.modalOpen 管理，需一并检查）
//   - toastPositionClass computed：响应式，自动随状态变化
//   - 同步写入 uiStore.toastPositionClass（供 ToastContainer.vue 使用）
// ══════════════════════════════════════════════════

import { computed, type ComputedRef } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useTileActionStore } from '@/stores/tileAction';
import { useCraftStore } from '@/stores/craft';

/**
 * 检测是否有 2 级页面（模态框/抽屉）打开
 *
 * 2 级页面打开时日志区被遮罩遮挡，需要 Toast 即时反馈。
 * 替代原 toast-position.js 的 DOM class 检测，改为基于响应式状态。
 *
 * 检查范围：
 *   - uiStore.modalOpen（通用模态框）
 *   - uiStore.inventoryDrawerOpen（右抽屉）
 *   - uiStore.playerDrawerOpen（左抽屉）
 *   - tileActionStore.modalOpen（POI/ground 模态框，由 TileActionBar.vue 内部渲染）
 *   - craftStore.craftModalOpen（合成模态框）
 *
 * 注意：此函数依赖 Pinia store，必须在 useUiStore() 可用的上下文中调用。
 */
export function isAnyOverlayOpen(): boolean {
  const uiStore = useUiStore();
  if (
    uiStore.modalOpen ||
    uiStore.inventoryDrawerOpen ||
    uiStore.playerDrawerOpen
  ) {
    return true;
  }
  const tileActionStore = useTileActionStore();
  if (tileActionStore.modalOpen) return true;
  const craftStore = useCraftStore();
  return craftStore.craftModalOpen;
}

/**
 * Toast 位置管理 composable
 *
 * 返回响应式的 toastPositionClass computed，并同步写入 uiStore.toastPositionClass。
 * ToastContainer.vue 可直接读取 uiStore.toastPositionClass（保持 M4 的接口不变）。
 *
 * @returns { isAnyOverlayOpen, toastPositionClass }
 */
export function useToastPosition(): {
  isAnyOverlayOpen: ComputedRef<boolean>;
  toastPositionClass: ComputedRef<string>;
} {
  const uiStore = useUiStore();
  const tileActionStore = useTileActionStore();
  const craftStore = useCraftStore();

  // ── 是否有 2 级页面打开（响应式） ──
  const isOverlayOpen = computed<boolean>(() => {
    return (
      uiStore.modalOpen ||
      uiStore.inventoryDrawerOpen ||
      uiStore.playerDrawerOpen ||
      tileActionStore.modalOpen ||
      craftStore.craftModalOpen
    );
  });

  // ── Toast 位置类（响应式） ──
  // 优先级：模态框 > 右抽屉 > 左抽屉/默认
  const toastPositionClass = computed<string>(() => {
    // 任何模态框（通用 / POI / ground / 合成）打开时：中上
    if (uiStore.modalOpen || tileActionStore.modalOpen || craftStore.craftModalOpen) {
      return 'pos-center';
    }
    if (uiStore.inventoryDrawerOpen) {
      // 右抽屉开：左上角
      return 'pos-left';
    }
    // 左抽屉开 或 无 2 级页面：保持默认（右上角）
    return '';
  });

  return {
    isAnyOverlayOpen: isOverlayOpen,
    toastPositionClass,
  };
}
