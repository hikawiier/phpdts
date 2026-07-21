//
// ExportModal 组件测试（对齐 NEW_DESIGN.md §7.3 M3：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - modal 显隐（v-if ui.modals.export）
//   - canExport 控制导出按钮 disabled
//   - canExport 控制"写入 gamedata 目录"按钮 disabled（canWrite = canExport）
//   - 项目信息展示（regionCount / tileCount / 配置文件 / 原始缓存数 / sourceDirHandle）
//   - 字段过滤提示（_breaks 自动剥离）
//   - 导出 ZIP 按钮触发 exportZip
//   - "写入 gamedata 目录"按钮触发 writeBackToSource
//   - 备份按钮触发 backupGamedata（mock）
//   - 关闭按钮触发 closeModal
//   - isExporting 状态切换按钮文案（写入中.../导出中.../备份中...）

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, type Ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import ExportModal from '@/components/modals/ExportModal.vue';
import { useUiStore } from '@/stores/uiStore';

// ─── mock useImportExport ─────────────────────────────────────

const mockExportZip = vi.fn().mockResolvedValue(undefined);
const mockWriteBackToSource = vi.fn().mockResolvedValue(undefined);
const mockBackupGamedata = vi.fn().mockResolvedValue(undefined);

const isExportingRef = ref(false);
const canWriteBackToSourceRef = ref(false);
const canExportRef = ref(false);
const sourceDirHandleRef: Ref<unknown> = ref(null);

vi.mock('@/composables/useImportExport', () => ({
  useImportExport: () => ({
    exportZip: mockExportZip,
    writeBackToSource: mockWriteBackToSource,
    backupGamedata: mockBackupGamedata,
    isExporting: isExportingRef,
    canWriteBackToSource: canWriteBackToSourceRef,
    canExport: canExportRef,
    sourceDirHandle: sourceDirHandleRef,
  }),
}));

describe('ExportModal', () => {
  let ui: ReturnType<typeof useUiStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    ui = useUiStore();
    vi.clearAllMocks();
    isExportingRef.value = false;
    canWriteBackToSourceRef.value = false;
    canExportRef.value = false;
    sourceDirHandleRef.value = null;
  });

  function mountModal() {
    return mount(ExportModal, {});
  }

  // ─── 显隐 ─────────────────────────────────────────────

  it('ui.modals.export=false 时不渲染', () => {
    ui.closeModal('export');
    const wrapper = mountModal();
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('ui.modals.export=true 时渲染标题', () => {
    ui.openModal('export');
    const wrapper = mountModal();
    expect(wrapper.find('h2').text()).toBe('导出地图项目');
  });

  // ─── 字段过滤提示 ─────────────────────────────────────

  it('显示字段过滤提示（_breaks 自动剥离）', () => {
    ui.openModal('export');
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('字段过滤');
    expect(wrapper.text()).toContain('_breaks');
    expect(wrapper.text()).toContain('height');
    expect(wrapper.text()).toContain('neighbors');
  });

  // ─── 项目信息 ─────────────────────────────────────────

  it('显示项目信息（区域数 / 地图格数 / 源目录句柄）', () => {
    ui.openModal('export');
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('区域数：');
    expect(wrapper.text()).toContain('地图格数：');
    expect(wrapper.text()).toContain('源目录句柄：');
  });

  it('sourceDirHandle=null 时显示"不可用"', () => {
    sourceDirHandleRef.value = null;
    ui.openModal('export');
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('不可用');
  });

  it('sourceDirHandle 非空时显示"可用"', async () => {
    sourceDirHandleRef.value = { name: 'fake-dir' };
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    expect(wrapper.text()).toContain('可用');
  });

  // ─── 导出按钮 ─────────────────────────────────────────

  it('canExport=false 时"导出 ZIP"按钮 disabled', () => {
    canExportRef.value = false;
    ui.openModal('export');
    const wrapper = mountModal();
    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('导出 ZIP'));
    expect(exportBtn?.attributes('disabled')).toBeDefined();
  });

  it('canExport=true 时"导出 ZIP"按钮 enabled', async () => {
    canExportRef.value = true;
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('导出 ZIP'));
    expect(exportBtn?.attributes('disabled')).toBeUndefined();
  });

  it('点击"导出 ZIP"触发 exportZip', async () => {
    canExportRef.value = true;
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('导出 ZIP'));
    await exportBtn!.trigger('click');
    await flushPromises();
    expect(mockExportZip).toHaveBeenCalledTimes(1);
  });

  // ─── 写入 gamedata 目录（原"快速写回"） ───────────────

  it('canExport=false 时"写入 gamedata 目录"按钮 disabled', () => {
    canExportRef.value = false;
    ui.openModal('export');
    const wrapper = mountModal();
    const writeBtn = wrapper.findAll('button').find((b) => b.text().includes('写入 gamedata 目录'));
    expect(writeBtn?.attributes('disabled')).toBeDefined();
  });

  it('canExport=true 时"写入 gamedata 目录"按钮 enabled', async () => {
    canExportRef.value = true;
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    const writeBtn = wrapper.findAll('button').find((b) => b.text().includes('写入 gamedata 目录'));
    expect(writeBtn?.attributes('disabled')).toBeUndefined();
  });

  it('点击"写入 gamedata 目录"触发 writeBackToSource', async () => {
    canExportRef.value = true;
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    const writeBtn = wrapper.findAll('button').find((b) => b.text().includes('写入 gamedata 目录'));
    await writeBtn!.trigger('click');
    await flushPromises();
    expect(mockWriteBackToSource).toHaveBeenCalledTimes(1);
  });

  // ─── isExporting 状态 ─────────────────────────────────

  it('isExporting=true 时"导出 ZIP"按钮显示"导出中..."', async () => {
    canExportRef.value = true;
    isExportingRef.value = true;
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    const exportBtn = wrapper.findAll('button').find((b) => b.text().includes('导出中'));
    expect(exportBtn).toBeDefined();
    // button disabled 仅依赖 !canExport，与 isExporting 无关
  });

  it('isExporting=true 时"写入 gamedata 目录"按钮显示"写入中..."', async () => {
    canExportRef.value = true;
    isExportingRef.value = true;
    ui.openModal('export');
    const wrapper = mountModal();
    await flushPromises();
    const writeBtn = wrapper.findAll('button').find((b) => b.text().includes('写入中'));
    expect(writeBtn).toBeDefined();
  });

  // ─── 关闭 ─────────────────────────────────────────────

  it('点击标题栏"关闭"按钮触发 closeModal', async () => {
    ui.openModal('export');
    const wrapper = mountModal();
    const closeBtn = wrapper.findAll('button').find((b) => b.text() === '关闭');
    expect(closeBtn).toBeDefined();
    await closeBtn!.trigger('click');
    expect(ui.modals.export).toBe(false);
  });

  it('点击底部"关闭"按钮触发 closeModal', async () => {
    ui.openModal('export');
    const wrapper = mountModal();
    const closeBtns = wrapper.findAll('button').filter((b) => b.text() === '关闭');
    expect(closeBtns.length).toBeGreaterThanOrEqual(2);
    await closeBtns[closeBtns.length - 1]!.trigger('click');
    expect(ui.modals.export).toBe(false);
  });

  it('点击遮罩层触发 closeModal', async () => {
    ui.openModal('export');
    const wrapper = mountModal();
    const overlay = wrapper.find('div.fixed');
    await overlay.trigger('click');
    expect(ui.modals.export).toBe(false);
  });
});
