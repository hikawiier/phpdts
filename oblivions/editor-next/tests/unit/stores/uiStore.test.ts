//
// uiStore 单元测试示例（对齐 NEW_DESIGN.md §4.1：Pinia store 单元测试覆盖率 ≥ 85%）

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from '@/stores/uiStore';

describe('useUiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('默认 activeTab 为 edit', () => {
    const ui = useUiStore();
    expect(ui.activeTab).toBe('edit');
  });

  it('setActiveTab 切换 tab', () => {
    const ui = useUiStore();
    ui.setActiveTab('validate');
    expect(ui.activeTab).toBe('validate');
  });

  it('openModal / closeModal 操作 modals', () => {
    const ui = useUiStore();
    expect(ui.modals.import).toBe(false);
    ui.openModal('import');
    expect(ui.modals.import).toBe(true);
    ui.closeModal('import');
    expect(ui.modals.import).toBe(false);
  });

  it('closeAllModals 关闭全部', () => {
    const ui = useUiStore();
    ui.openModal('import');
    ui.openModal('export');
    ui.openModal('generator');
    ui.closeAllModals();
    expect(Object.values(ui.modals).every((value) => value === false)).toBe(true);
  });

  it('openConfirm / confirmAndRun 触发回调', () => {
    const ui = useUiStore();
    let called = false;
    ui.openConfirm('测试', () => {
      called = true;
    });
    expect(ui.confirmDialog.open).toBe(true);
    expect(ui.confirmDialog.message).toBe('测试');
    ui.confirmAndRun();
    expect(ui.confirmDialog.open).toBe(false);
    expect(called).toBe(true);
  });

  it('closeConfirm 清空状态但不触发回调', () => {
    const ui = useUiStore();
    let called = false;
    ui.openConfirm('测试', () => {
      called = true;
    });
    ui.closeConfirm();
    expect(ui.confirmDialog.open).toBe(false);
    expect(called).toBe(false);
  });

  it('showToast 添加并自动消失', () => {
    const ui = useUiStore();
    ui.showToast('hello', 'info');
    expect(ui.toasts).toHaveLength(1);
    expect(ui.toasts[0]?.message).toBe('hello');
    const id = ui.toasts[0]?.id;
    if (id !== undefined) ui.dismissToast(id);
    expect(ui.toasts).toHaveLength(0);
  });

  it('toggleTheme 在 light / dark 之间切换', () => {
    const ui = useUiStore();
    expect(ui.theme).toBe('dark');
    ui.toggleTheme();
    expect(ui.theme).toBe('light');
    ui.toggleTheme();
    expect(ui.theme).toBe('dark');
  });
});
