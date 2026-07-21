//
// uiStore：UI 状态（对齐 NEW_DESIGN.md §2.3.10）
// 管理 UI 通用状态（modals / toasts / theme）
// 暗色为默认（对齐 vex-vue）
// M1 阶段为空壳：仅 state + 简单 action，具体 UI 行为随各模块实现
//
// M8 扩展：新增 generatorModalState 支持 GeneratorModal 双模式
//   - mode: 'full' 全项目模式 / 'region' 单区域模式
//   - returnFocusEl: 模态关闭后焦点恢复目标（可访问性，对齐 §3.7.6）

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ModalKey = 'import' | 'export' | 'generator';

export interface ConfirmDialogState {
  open: boolean;
  message: string;
  onConfirm: (() => void) | null;
}

export interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly type: 'info' | 'error' | 'success';
}

/**
 * 生成器模态框双模式状态（对齐 §3.7.6 M8）
 *
 * - mode='full'    全项目模式：loadProject 覆盖式写入（弹 confirm 提示备份风险）
 * - mode='region'  单区域模式：addGeneratedRegion 追加新区域（无 confirm）
 * - returnFocusEl  模态关闭后焦点恢复目标（HTMLElement | null），对齐可访问性
 */
export interface GeneratorModalState {
  mode: 'full' | 'region';
  returnFocusEl: HTMLElement | null;
}

export const useUiStore = defineStore('ui', () => {
  // ─── state ────────────────────────────────────────────
  const activeTab = ref<'edit' | 'validate' | 'config' | 'generators'>(
    'edit',
  );
  const modals = ref<Record<ModalKey, boolean>>({
    import: false,
    export: false,
    generator: false,
  });
  const confirmDialog = ref<ConfirmDialogState>({
    open: false,
    message: '',
    onConfirm: null,
  });
  const toasts = ref<ToastItem[]>([]);
  const theme = ref<'light' | 'dark'>('dark');

  // ─── M8 生成器模态框双模式状态 ──────
  const generatorModalState = ref<GeneratorModalState>({
    mode: 'full',
    returnFocusEl: null,
  });

  // ─── C-2 模拟面板折叠状态（默认折叠，对齐 3.4 不展示什么优先） ──
  const simulatePanelOpen = ref(false);

  let nextToastId = 1;

  // ─── actions ──────────────────────────────────────────
  function setActiveTab(tab: typeof activeTab.value): void {
    activeTab.value = tab;
  }

  function setSimulatePanelOpen(open: boolean): void {
    simulatePanelOpen.value = open;
  }

  function toggleSimulatePanel(): void {
    simulatePanelOpen.value = !simulatePanelOpen.value;
  }

  function openModal(key: ModalKey): void {
    modals.value = { ...modals.value, [key]: true };
  }

  function closeModal(key: ModalKey): void {
    modals.value = { ...modals.value, [key]: false };
  }

  function closeAllModals(): void {
    modals.value = {
      import: false,
      export: false,
      generator: false,
    };
  }

  /**
   * 打开生成器模态框（双模式，对齐 §3.7.6 M8）
   *
   * @param mode         'full' 全项目覆盖 / 'region' 单区域追加
   * @param returnFocusEl 关闭后焦点恢复目标（可访问性），可选
   */
  function openGeneratorModal(
    mode: 'full' | 'region',
    returnFocusEl: HTMLElement | null = null,
  ): void {
    generatorModalState.value = { mode, returnFocusEl };
    openModal('generator');
  }

  /**
   * 关闭生成器模态框（不清空 generatorModalState，焦点恢复由 GeneratorModal 负责）
   */
  function closeGeneratorModal(): void {
    closeModal('generator');
  }

  function openConfirm(message: string, onConfirm: () => void): void {
    confirmDialog.value = { open: true, message, onConfirm };
  }

  function closeConfirm(): void {
    confirmDialog.value = { open: false, message: '', onConfirm: null };
  }

  function confirmAndRun(): void {
    const callback = confirmDialog.value.onConfirm;
    closeConfirm();
    if (callback) callback();
  }

  function showToast(message: string, type: ToastItem['type'] = 'info'): void {
    const id = nextToastId++;
    toasts.value = [...toasts.value, { id, message, type }];
    // 自动消失（5s）
    if (typeof window !== 'undefined') {
      window.setTimeout(() => dismissToast(id), 5000);
    }
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  return {
    // state
    activeTab,
    modals,
    confirmDialog,
    toasts,
    theme,
    generatorModalState,
    simulatePanelOpen,
    // actions
    setActiveTab,
    openModal,
    closeModal,
    closeAllModals,
    openConfirm,
    closeConfirm,
    confirmAndRun,
    showToast,
    dismissToast,
    toggleTheme,
    // M8 生成器模态框双模式
    openGeneratorModal,
    closeGeneratorModal,
    // C-2 模拟面板折叠
    setSimulatePanelOpen,
    toggleSimulatePanel,
  };
});
