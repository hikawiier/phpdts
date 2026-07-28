//
// GeneratorModal 组件测试（M8 主题生成器）
//
// 覆盖点：
//   - modal 显隐（v-if ui.modals.generator）
//   - 双模式标题切换：mode='full' 显示"全项目"；mode='region' 显示"追加区域"
//   - schema 驱动表单渲染：按 generator.getParamSchema() 出现对应控件
//   - hideInRegionMode 字段在 'region' 模式下不渲染
//   - 关闭后焦点恢复到 returnFocusEl
//   - 全项目模式 + hasProject 时弹 window.confirm
//   - 单区域模式不弹 confirm
//   - 生成成功后调用 validate.runFull({ includeConfig: false })
//   - 全项目模式调用 project.loadProject 覆盖
//   - 单区域模式调用 project.addGeneratedRegion 追加
//   - 关闭按钮 / 取消按钮 / 遮罩点击触发 closeGeneratorModal
//
// 注意：watch(open) 在初始值上不触发，因此测试需先 mount 再调用 openGeneratorModal，
// 让 open 从 false→true 触发 watch，自动选中第一个生成器并加载 schema。

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import GeneratorModal from '@/components/modals/GeneratorModal.vue';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useValidateStore } from '@/stores/validateStore';
import {
  registerGenerator,
  clearRegistry,
} from '@/services/generators/registry';
import { SampleGenerator } from '@/services/generators/sample-generator';

// ─── mock window.confirm ───────────────────────────────────────
const confirmSpy = vi.spyOn(window, 'confirm');

describe('GeneratorModal', () => {
  let ui: ReturnType<typeof useUiStore>;
  let project: ReturnType<typeof useProjectStore>;
  let validate: ReturnType<typeof useValidateStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    ui = useUiStore();
    project = useProjectStore();
    validate = useValidateStore();
    clearRegistry();
    registerGenerator(new SampleGenerator());
    confirmSpy.mockReset();
    confirmSpy.mockReturnValue(true);
  });

  function mountModal() {
    return mount(GeneratorModal, {});
  }

  /**
   * 挂载模态后打开（确保 watch open 从 false→true 触发，
   * 否则先 open 再 mount 时 watch 不会在初始值上触发）
   */
  async function mountAndOpen(mode: 'full' | 'region', returnFocusEl: HTMLElement | null = null) {
    const wrapper = mount(GeneratorModal, {});
    ui.openGeneratorModal(mode, returnFocusEl);
    await flushPromises();
    return wrapper;
  }

  /** 在 DOM 中创建触发按钮作为 returnFocusEl */
  function createTriggerButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    return btn;
  }

  /** 找到底部按钮（按文本匹配） */
  function findButton(wrapper: ReturnType<typeof mountModal>, text: string) {
    return wrapper.findAll('button').find((b) => b.text().includes(text));
  }

  // ─── 显隐 ─────────────────────────────────────────────

  it('ui.modals.generator=false 时不渲染', () => {
    ui.closeModal('generator');
    const wrapper = mountModal();
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('ui.modals.generator=true 时渲染标题（默认 full 模式）', async () => {
    const wrapper = await mountAndOpen('full');
    expect(wrapper.find('h2').text()).toBe('随机生成地图（全项目）');
  });

  it('mode=region 时标题切换为"随机生成区域（追加）"', async () => {
    const wrapper = await mountAndOpen('region');
    expect(wrapper.find('h2').text()).toBe('随机生成区域（追加）');
  });

  it('full 模式底部按钮文案"生成并覆盖项目"', async () => {
    const wrapper = await mountAndOpen('full');
    expect(wrapper.text()).toContain('生成并覆盖项目');
  });

  it('region 模式底部按钮文案"生成并追加区域"', async () => {
    const wrapper = await mountAndOpen('region');
    expect(wrapper.text()).toContain('生成并追加区域');
  });

  // ─── schema 驱动表单 ─────────────────────────────────

  it('打开后自动选第一个生成器并显示其描述', async () => {
    const wrapper = await mountAndOpen('full');
    expect(wrapper.text()).toContain('最简单的随机生成器');
  });

  it('按 schema 渲染参数字段标签（cols/rows/obstacleRate/seed 等）', async () => {
    const wrapper = await mountAndOpen('full');
    expect(wrapper.text()).toContain('网格列数');
    expect(wrapper.text()).toContain('网格行数');
    expect(wrapper.text()).toContain('障碍率');
    expect(wrapper.text()).toContain('地板类型');
    expect(wrapper.text()).toContain('潮汐');
    expect(wrapper.text()).toContain('随机种子');
  });

  it('full 模式渲染 number/range/select 全部类型控件', async () => {
    const wrapper = await mountAndOpen('full');
    // number + range 都渲染为 <input type="number">（BaseInput）
    const numberInputs = wrapper.findAll('input[type="number"]');
    expect(numberInputs.length).toBeGreaterThanOrEqual(4); // cols/rows/obstacleRate/seed
    // select 渲染为 <select>（BaseSelect）—— floor + tide 共 2 个
    const selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  // ─── hideInRegionMode 过滤 ────────────────────────────

  it('SampleGenerator 无 hideInRegionMode 字段，full 与 region 模式字段数相同', async () => {
    // SampleGenerator schema 中无 hideInRegionMode=true 字段，两模式应渲染等量字段
    const fullWrapper = await mountAndOpen('full');
    const fullLabels = fullWrapper.findAll('label').length;

    ui.closeGeneratorModal();
    const regionWrapper = await mountAndOpen('region');
    const regionLabels = regionWrapper.findAll('label').length;

    expect(regionLabels).toBe(fullLabels);
  });

  // ─── 关闭按钮 / 焦点恢复 ──────────────────────────────

  it('点击标题栏 × 关闭按钮触发 closeGeneratorModal', async () => {
    const wrapper = await mountAndOpen('full');
    const closeBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'close');
    expect(closeBtn).toBeDefined();
    await closeBtn!.trigger('click');
    expect(ui.modals.generator).toBe(false);
  });

  it('点击"取消"按钮触发 closeGeneratorModal', async () => {
    const wrapper = await mountAndOpen('full');
    const cancelBtn = findButton(wrapper, '取消');
    expect(cancelBtn).toBeDefined();
    await cancelBtn!.trigger('click');
    expect(ui.modals.generator).toBe(false);
  });

  it('点击遮罩层触发 closeGeneratorModal', async () => {
    const wrapper = await mountAndOpen('full');
    const overlay = wrapper.find('div.fixed');
    await overlay.trigger('click');
    expect(ui.modals.generator).toBe(false);
  });

  it('关闭后焦点恢复到 returnFocusEl', async () => {
    const triggerBtn = createTriggerButton();
    const wrapper = await mountAndOpen('full', triggerBtn);
    const cancelBtn = findButton(wrapper, '取消');
    await cancelBtn!.trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });

  it('returnFocusEl=null 时不抛错', async () => {
    const wrapper = await mountAndOpen('full', null);
    const cancelBtn = findButton(wrapper, '取消');
    await expect(cancelBtn!.trigger('click')).resolves.toBeUndefined();
    expect(ui.modals.generator).toBe(false);
  });

  // ─── 全项目模式 confirm 守卫 ──────────────────────────

  it('full 模式 + hasProject 时点击生成弹 window.confirm', async () => {
    // 先用生成器塞入一个项目，使 hasProject=true
    const gen = new SampleGenerator();
    const result = gen.generate(gen.getDefaultParams(), 42);
    project.loadProject({
      regions: result.regions,
      grids: result.grids,
      tiles: result.tiles,
    });
    expect(project.hasProject).toBe(true);

    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]?.[0]).toContain('覆盖');
  });

  it('full 模式 + hasProject + confirm=false 时不调用 loadProject', async () => {
    confirmSpy.mockReturnValueOnce(false);
    const gen = new SampleGenerator();
    const result = gen.generate(gen.getDefaultParams(), 42);
    project.loadProject({
      regions: result.regions,
      grids: result.grids,
      tiles: result.tiles,
    });
    const spyLoad = vi.spyOn(project, 'loadProject');

    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();

    expect(spyLoad).not.toHaveBeenCalled();
    // modal 仍打开
    expect(ui.modals.generator).toBe(true);
  });

  it('full 模式 + 无项目时不弹 confirm（直接生成）', async () => {
    expect(project.hasProject).toBe(false);
    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // ─── region 模式无 confirm ────────────────────────────

  it('region 模式 + hasProject 时不弹 confirm', async () => {
    const gen = new SampleGenerator();
    const result = gen.generate(gen.getDefaultParams(), 42);
    project.loadProject({
      regions: result.regions,
      grids: result.grids,
      tiles: result.tiles,
    });
    const wrapper = await mountAndOpen('region');
    const confirmBtn = findButton(wrapper, '生成并追加区域');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // ─── 生成后写入 + 验证闭环 ────────────────────────────

  it('full 模式生成调用 project.loadProject 覆盖项目', async () => {
    const spyLoad = vi.spyOn(project, 'loadProject');
    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(spyLoad).toHaveBeenCalledTimes(1);
    // 写入后 hasProject=true
    expect(project.hasProject).toBe(true);
  });

  it('full 模式生成后调用 validate.runFull({ includeConfig: false })', async () => {
    const spyRunFull = vi.spyOn(validate, 'runFull');
    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(spyRunFull).toHaveBeenCalledTimes(1);
    const arg = spyRunFull.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(arg?.includeConfig).toBe(false);
  });

  it('full 模式生成成功后关闭 modal', async () => {
    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(ui.modals.generator).toBe(false);
  });

  it('region 模式生成调用 project.addGeneratedRegion 追加区域', async () => {
    const spyAdd = vi.spyOn(project, 'addGeneratedRegion');
    const wrapper = await mountAndOpen('region');
    const confirmBtn = findButton(wrapper, '生成并追加区域');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(spyAdd).toHaveBeenCalledTimes(1);
    expect(project.regionCount).toBe(1);
  });

  it('region 模式生成后调用 validate.runFull({ includeConfig: false })', async () => {
    const spyRunFull = vi.spyOn(validate, 'runFull');
    const wrapper = await mountAndOpen('region');
    const confirmBtn = findButton(wrapper, '生成并追加区域');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(spyRunFull).toHaveBeenCalledTimes(1);
    const arg = spyRunFull.mock.calls[0]?.[0];
    expect(arg?.includeConfig).toBe(false);
  });

  it('region 模式连续生成两次追加 2 个区域（pgroup 1 + 2）', async () => {
    let wrapper = await mountAndOpen('region');
    let confirmBtn = findButton(wrapper, '生成并追加区域');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(project.regionCount).toBe(1);

    // 再次打开（modal 已关闭）
    wrapper = await mountAndOpen('region');
    confirmBtn = findButton(wrapper, '生成并追加区域');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(project.regionCount).toBe(2);
    expect(Object.keys(project.project.regions).map(Number).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  // ─── 错误处理 ─────────────────────────────────────────

  it('生成抛错时显示错误信息且 modal 保持打开', async () => {
    // 通过 mock generator.generate 抛错
    const gen = new SampleGenerator();
    vi.spyOn(gen, 'generate').mockImplementation(() => {
      throw new Error('mock 生成失败');
    });
    clearRegistry();
    registerGenerator(gen);

    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    await confirmBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('生成失败：mock 生成失败');
    expect(ui.modals.generator).toBe(true);
  });

  it('未选生成器时点击生成按钮 disabled', async () => {
    // listGenerators 为空场景：手动 clearRegistry 后再打开
    clearRegistry();
    const wrapper = await mountAndOpen('full');
    const confirmBtn = findButton(wrapper, '生成并覆盖项目');
    // currentGenerator 为空时按钮 disabled
    expect(confirmBtn?.attributes('disabled')).toBeDefined();
  });
});
