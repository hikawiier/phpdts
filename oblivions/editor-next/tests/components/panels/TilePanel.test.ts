//
// TilePanel 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 未选中格时显示"未选中格"
//   - 选中格后显示属性编辑表单
//   - 修改 name / desc / floor / tide / height / x / y 同步
//   - passable / destructible / preset_safe 复选框
//   - neighbors 只读展示
//   - _breaks 只读展示（红色强调）

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import TilePanel from '@/components/panels/TilePanel.vue';
import { useProjectStore } from '@/stores/projectStore';
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

describe('TilePanel', () => {
  let project: ReturnType<typeof useProjectStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    project = useProjectStore();
    project.addRegion('A');
  });

  function mountPanel() {
    return mount(TilePanel, {
      global: {
        plugins: [i18n],
      },
    });
  }

  it('未选中格时显示"未选中格"', () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('未选中格');
  });

  it('选中格后显示属性表单', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).toContain('描述');
    expect(wrapper.text()).toContain('Floor');
    expect(wrapper.text()).toContain('Tide');
    expect(wrapper.text()).toContain('Height');
  });

  it('显示 pls 编号', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain(`#${pls}`);
  });

  it('修改名称同步到 store', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const textInputs = wrapper.findAll('input[type="text"]');
    const nameInput = textInputs[0]!;
    await nameInput.setValue('TileName');
    expect(project.currentTile?.name).toBe('TileName');
  });

  it('修改 height 同步到 store', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const numberInputs = wrapper.findAll('input[type="number"]');
    // 顺序：height / x / y
    const heightInput = numberInputs[0]!;
    await heightInput.setValue('5');
    expect(project.currentTile?.height).toBe(5);
  });

  it('切换 Passable 复选框同步到 store', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    const passableCheckbox = checkboxes[0]!;
    expect(project.currentTile?.passable).toBe(true);
    await passableCheckbox.setValue(false);
    expect(project.currentTile?.passable).toBe(false);
  });

  it('修改 floor 下拉同步到 store', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const selects = wrapper.findAll('select');
    const floorSelect = selects[0]!;
    await floorSelect.setValue('water');
    expect(project.currentTile?.floor).toBe('water');
  });

  it('修改 tide 下拉同步到 store', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const selects = wrapper.findAll('select');
    const tideSelect = selects[1]!;
    await tideSelect.setValue('deep');
    expect(project.currentTile?.tide).toBe('deep');
  });

  it('neighbors 只读展示', async () => {
    const pls1 = project.addTile(1, 0, 0);
    project.addTile(1, 1, 1); // pls2，与 pls1 对角相邻
    project.setSelectedPls(pls1!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('neighbors');
    expect(wrapper.text()).toContain('#2');
  });

  it('无 neighbors 时显示"无"', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('无');
  });

  it('_breaks 非空时显示（红色强调）', async () => {
    const pls1 = project.addTile(1, 0, 0);
    project.addTile(1, 1, 1); // pls2
    project.breakTileConnection(1, pls1!, 2);
    project.setSelectedPls(pls1!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('_breaks');
    expect(wrapper.text()).toContain('#2');
  });

  it('修改 x 同步到 store', async () => {
    const pls = project.addTile(1, 0, 0);
    project.setSelectedPls(pls!);
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    const numberInputs = wrapper.findAll('input[type="number"]');
    // 顺序：height / x / y
    const xInput = numberInputs[1]!;
    await xInput.setValue('3');
    expect(project.currentTile?.x).toBe(3);
  });
});
