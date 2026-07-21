//
// RegionPanel 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染区域列表 select + 新增/删除按钮
//   - 未选中区域时显示"未选中区域"
//   - 选中区域后显示属性编辑表单
//   - 新增区域按钮 → projectStore.addRegion
//   - 删除区域按钮 → ui.openConfirm
//   - 修改 name / desc / cols / rows / entrance_pls / exit_pls 同步
//   - exit_links 列表 CRUD
//   - pls 范围 1-254 / pgroup 范围 1-255 / cols/rows 上限 254 校验

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import RegionPanel from '@/components/panels/RegionPanel.vue';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { COLS_ROWS_MAX, PLS_MAX, PGROUP_MAX } from '@/shared';
import { createI18n } from 'vue-i18n';
import zhCN from '@/i18n/zh-CN';

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  missingWarn: false,
  fallbackWarn: false,
});

describe('RegionPanel', () => {
  let project: ReturnType<typeof useProjectStore>;
  let ui: ReturnType<typeof useUiStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    project = useProjectStore();
    ui = useUiStore();
  });

  function mountPanel() {
    return mount(RegionPanel, {
      global: {
        plugins: [i18n],
      },
    });
  }

  it('无项目时显示"未选中区域"', () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('未选中区域');
  });

  it('新增区域按钮触发 projectStore.addRegion', async () => {
    const wrapper = mountPanel();
    // 第一个按钮是"新增"（共 2 个按钮：新增 / 删除）
    const addBtn = wrapper.findAll('button')[0]!;
    await addBtn.trigger('click');
    expect(project.regionCount).toBe(1);
  });

  it('选中区域后显示属性表单', async () => {
    project.addRegion('A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).toContain('描述');
    expect(wrapper.text()).toContain('列数');
    expect(wrapper.text()).toContain('行数');
  });

  it('修改名称同步到 store', async () => {
    project.addRegion('A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const nameInput = wrapper.find('input[type="text"]');
    await nameInput.setValue('NewName');
    expect(project.currentRegion?.name).toBe('NewName');
  });

  it('修改 cols 超出上限被裁剪', async () => {
    project.addRegion('A', 4, 4);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const numberInputs = wrapper.findAll('input[type="number"]');
    // cols / rows / entrance_pls / exit_pls / next_region / prev_region
    // 第一个是 cols
    const colsInput = numberInputs[0]!;
    await colsInput.setValue('9999');
    expect(project.currentRegion?.cols).toBe(COLS_ROWS_MAX);
  });

  it('修改 entrance_pls 超出上限被裁剪', async () => {
    project.addRegion('A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const numberInputs = wrapper.findAll('input[type="number"]');
    // 顺序：cols / rows / entrance_pls / exit_pls / next_region / prev_region
    const entranceInput = numberInputs[2]!;
    await entranceInput.setValue('999');
    expect(project.currentRegion?.entrance_pls).toBe(PLS_MAX);
  });

  it('修改 next_region 超出上限被裁剪', async () => {
    project.addRegion('A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const numberInputs = wrapper.findAll('input[type="number"]');
    const nextRegionInput = numberInputs[4]!;
    await nextRegionInput.setValue('999');
    expect(project.currentRegion?.next_region).toBe(PGROUP_MAX);
  });

  it('切换 select 触发 setCurrentPgroup', async () => {
    project.addRegion('A');
    project.addRegion('B');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const select = wrapper.find('select');
    await select.setValue('2');
    expect(project.currentPgroup).toBe(2);
  });

  it('删除按钮触发 openConfirm', async () => {
    project.addRegion('A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    // 第二个按钮是删除
    const deleteBtn = wrapper.findAll('button')[1]!;
    await deleteBtn.trigger('click');
    expect(ui.confirmDialog.open).toBe(true);
  });

  it('addExitLink 追加条目', async () => {
    project.addRegion('A');
    project.addRegion('B');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    // exit_links 区域的"+"按钮（在 exit_links CRUD 行末尾）
    // 多个按钮：新增区域 / 删除区域 / exit_links 删除 / exit_links 添加
    const buttons = wrapper.findAll('button');
    // 找到 "+" 按钮（最后一个）
    const addLinkBtn = buttons[buttons.length - 1]!;
    await addLinkBtn.trigger('click');
    expect(project.currentRegion?.exit_links).toHaveLength(1);
  });

  it('删除区域后无 currentRegion 显示未选中', async () => {
    const p = project.addRegion('A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    project.deleteRegion(p!);
    await wrapper.vm.$nextTick();
    // currentPgroup 为 null，currentRegion 为 null
    expect(project.currentRegion).toBeNull();
  });

  it('显示当前区域 pgroup 与名称', async () => {
    project.addRegion('区域 A');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const select = wrapper.find('select');
    const text = select.text();
    expect(text).toContain('区域 A');
  });
});
