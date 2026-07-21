//
// ImportModal 组件测试（对齐 NEW_DESIGN.md §7.3 M3：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - modal 显隐（v-if ui.modals.import）
//   - 5 个 Tab 切换（directory / restore / drop / webkitdirectory / paste）
//   - 目录选择按钮触发 importFromDirectory（按钮文案"选择 gamedata 目录"）
//   - 手动粘贴按钮触发 importFromPaste（空文本 disabled）
//   - 拖拽 dragover / dragleave / drop 事件
//   - 进度条展示（parsing / done / error 三态）
//   - 关闭按钮触发 ui.closeModal + resetProgress

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, type Ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import ImportModal from '@/components/modals/ImportModal.vue';
import { useUiStore } from '@/stores/uiStore';

// ─── mock useImportExport ─────────────────────────────────────
// 使用共享可变 ref，让测试可以动态修改 isImporting / importProgress 的值

const mockImportFromDirectory = vi.fn().mockResolvedValue(undefined);
const mockImportFromPaste = vi.fn().mockResolvedValue(undefined);
const mockImportFromDrop = vi.fn().mockResolvedValue(undefined);
const mockListBackups = vi.fn().mockResolvedValue(null);
const mockRestoreFromBackup = vi.fn().mockResolvedValue(undefined);
const mockResetProgress = vi.fn();
const mockDispose = vi.fn();

interface ProgressState {
  stage: 'idle' | 'parsing' | 'assembling' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
  error?: { message: string; line?: number; column?: number; expected?: string };
}

const importProgressRef: Ref<ProgressState> = ref({
  stage: 'idle',
  current: 0,
  total: 0,
  message: '',
});
const isImportingRef = ref(false);

vi.mock('@/composables/useImportExport', () => ({
  useImportExport: () => ({
    importFromDirectory: mockImportFromDirectory,
    importFromPaste: mockImportFromPaste,
    importFromDrop: mockImportFromDrop,
    listBackups: mockListBackups,
    restoreFromBackup: mockRestoreFromBackup,
    importProgress: importProgressRef,
    isImporting: isImportingRef,
    resetProgress: mockResetProgress,
    dispose: mockDispose,
  }),
}));

function resetProgressState(): void {
  importProgressRef.value = { stage: 'idle', current: 0, total: 0, message: '' };
  isImportingRef.value = false;
}

describe('ImportModal', () => {
  let ui: ReturnType<typeof useUiStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    ui = useUiStore();
    vi.clearAllMocks();
    resetProgressState();
  });

  function mountModal() {
    return mount(ImportModal, {});
  }

  // ─── 显隐 ─────────────────────────────────────────────

  it('ui.modals.import=false 时不渲染', () => {
    ui.closeModal('import');
    const wrapper = mountModal();
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('ui.modals.import=true 时渲染标题', () => {
    ui.openModal('import');
    const wrapper = mountModal();
    expect(wrapper.find('h2').text()).toBe('导入地图项目');
  });

  // ─── Tab 切换 ─────────────────────────────────────────
  // Tab 按钮顺序：[关闭, 目录选择, 文件夹上传, 手动粘贴, 拖拽导入, ...]
  // 用文本匹配定位 tab 按钮更稳健

  function findTab(wrapper: ReturnType<typeof mountModal>, text: string) {
    return wrapper.findAll('button').find((b) => b.text().includes(text));
  }

  it('默认 Tab 为 directory', () => {
    ui.openModal('import');
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('选择 gamedata 目录');
    expect(wrapper.text()).toContain('map.php');
    expect(wrapper.text()).toContain('combat_skills');
  });

  it('点击 webkitdirectory Tab 切换', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const tab = findTab(wrapper, '文件夹上传');
    expect(tab).toBeDefined();
    await tab!.trigger('click');
    // 切换后内容区应显示 webkitdirectory 相关说明
    expect(wrapper.text()).toContain('浏览器不支持 File System Access API 时的回退路径');
  });

  it('点击 paste Tab 切换', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const tab = findTab(wrapper, '手动粘贴');
    expect(tab).toBeDefined();
    await tab!.trigger('click');
    expect(wrapper.find('textarea').exists()).toBe(true);
  });

  it('点击 drop Tab 切换', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const tab = findTab(wrapper, '拖拽导入');
    expect(tab).toBeDefined();
    await tab!.trigger('click');
    expect(wrapper.text()).toContain('将 gamedata 目录或 .php 文件拖到此处');
  });

  // ─── 目录选择 ─────────────────────────────────────────

  it('点击"选择 gamedata 目录"触发 importFromDirectory', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const selectDirBtn = wrapper.findAll('button').find((b) => b.text().includes('选择 gamedata 目录'));
    expect(selectDirBtn).toBeDefined();
    await selectDirBtn!.trigger('click');
    await flushPromises();
    expect(mockImportFromDirectory).toHaveBeenCalledTimes(1);
  });

  it('isImporting=true 时"选择 gamedata 目录"按钮显示"解析中..."', async () => {
    ui.openModal('import');
    isImportingRef.value = true;
    const wrapper = mountModal();
    await flushPromises();
    const selectDirBtn = wrapper.findAll('button').find((b) => b.text().includes('解析中'));
    expect(selectDirBtn).toBeDefined();
    expect(selectDirBtn?.attributes('disabled')).toBeDefined();
  });

  // ─── 手动粘贴 ─────────────────────────────────────────

  it('paste Tab 文本为空时"解析并导入"按钮 disabled', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    await findTab(wrapper, '手动粘贴')!.trigger('click');
    const parseBtn = wrapper.findAll('button').find((b) => b.text().includes('解析并导入'));
    expect(parseBtn).toBeDefined();
    expect(parseBtn?.attributes('disabled')).toBeDefined();
  });

  it('paste Tab 输入文本后点击触发 importFromPaste', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    await findTab(wrapper, '手动粘贴')!.trigger('click');
    const textarea = wrapper.find('textarea');
    expect(textarea.exists()).toBe(true);
    await textarea.setValue('return [1];');
    const parseBtn = wrapper.findAll('button').find((b) => b.text().includes('解析并导入'));
    expect(parseBtn?.attributes('disabled')).toBeUndefined();
    await parseBtn!.trigger('click');
    await flushPromises();
    expect(mockImportFromPaste).toHaveBeenCalledWith('return [1];', undefined);
  });

  // ─── 拖拽 ─────────────────────────────────────────────

  it('drop Tab dragover 触发 isDragOver', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    await findTab(wrapper, '拖拽导入')!.trigger('click');
    const dropZone = wrapper.find('[class*="border-dashed"]');
    expect(dropZone.exists()).toBe(true);
    await dropZone.trigger('dragover');
    expect(dropZone.classes()).toContain('border-neutral-100');
  });

  it('drop Tab dragleave 取消激活态', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    await findTab(wrapper, '拖拽导入')!.trigger('click');
    const dropZone = wrapper.find('[class*="border-dashed"]');
    await dropZone.trigger('dragover');
    await dropZone.trigger('dragleave');
    expect(dropZone.classes()).not.toContain('border-neutral-100');
  });

  it('drop Tab drop 事件触发 importFromDrop', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    await findTab(wrapper, '拖拽导入')!.trigger('click');
    const dropZone = wrapper.find('[class*="border-dashed"]');
    const dt = { items: [], files: [] } as unknown as DataTransfer;
    await dropZone.trigger('drop', { dataTransfer: dt });
    await flushPromises();
    expect(mockImportFromDrop).toHaveBeenCalledWith(dt);
  });

  it('drop 事件无 dataTransfer 时不触发 importFromDrop', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    await findTab(wrapper, '拖拽导入')!.trigger('click');
    const dropZone = wrapper.find('[class*="border-dashed"]');
    await dropZone.trigger('drop', {});
    await flushPromises();
    expect(mockImportFromDrop).not.toHaveBeenCalled();
  });

  // ─── 进度条 ───────────────────────────────────────────
  // v-if 条件：isImporting || isDone || hasError

  it('parsing 阶段显示进度条', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    // parsing 阶段需要 isImporting=true 才会显示进度条（v-if 条件）
    isImportingRef.value = true;
    importProgressRef.value = {
      stage: 'parsing',
      current: 3,
      total: 10,
      message: '解析区域 3...',
    };
    await flushPromises();
    expect(wrapper.text()).toContain('解析区域 3');
    expect(wrapper.text()).toContain('30%');
  });

  it('done 阶段显示进度条（isDone=true 自动满足 v-if）', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    importProgressRef.value = {
      stage: 'done',
      current: 10,
      total: 10,
      message: '导入完成',
    };
    await flushPromises();
    expect(wrapper.text()).toContain('导入完成');
    expect(wrapper.text()).toContain('100%');
  });

  it('error 阶段显示错误信息', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    importProgressRef.value = {
      stage: 'error',
      current: 0,
      total: 0,
      message: '解析失败',
      error: { message: 'unexpected token at line 5', line: 5, column: 10, expected: '``]``' },
    };
    await flushPromises();
    expect(wrapper.text()).toContain('解析失败');
    expect(wrapper.text()).toContain('unexpected token at line 5');
    expect(wrapper.text()).toContain('行 5');
    expect(wrapper.text()).toContain('列 10');
  });

  it('idle 阶段不显示进度条', () => {
    ui.openModal('import');
    const wrapper = mountModal();
    // idle 状态下进度条容器 v-if 为 false
    expect(wrapper.text()).not.toContain('导入完成');
  });

  // ─── 关闭 ─────────────────────────────────────────────

  it('点击标题栏"关闭"按钮触发 closeModal + resetProgress', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const closeBtn = wrapper.findAll('button').find((b) => b.text() === '关闭');
    expect(closeBtn).toBeDefined();
    await closeBtn!.trigger('click');
    expect(ui.modals.import).toBe(false);
    expect(mockResetProgress).toHaveBeenCalledTimes(1);
  });

  it('点击底部"关闭"按钮触发 closeModal', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const closeBtns = wrapper.findAll('button').filter((b) => b.text() === '关闭');
    expect(closeBtns.length).toBeGreaterThanOrEqual(2);
    await closeBtns[closeBtns.length - 1]!.trigger('click');
    expect(ui.modals.import).toBe(false);
  });

  it('点击遮罩层触发 closeModal', async () => {
    ui.openModal('import');
    const wrapper = mountModal();
    const overlay = wrapper.find('div.fixed');
    await overlay.trigger('click');
    expect(ui.modals.import).toBe(false);
  });

  // ─── 组件卸载 ─────────────────────────────────────────

  it('组件卸载时调用 dispose', () => {
    ui.openModal('import');
    const wrapper = mountModal();
    wrapper.unmount();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
