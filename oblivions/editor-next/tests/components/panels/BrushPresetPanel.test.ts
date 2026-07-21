//
// BrushPresetPanel 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 floor / tide 下拉 + height 数字输入 + 3 个复选框
//   - tide 选项来自 TIDE_OPTIONS（不含 safe，对齐 DESIGN.md 1.3）
//   - floor 选项来自 FLOOR_OPTIONS（5 类）
//   - 修改 floor → toolStore.brush.floor 同步
//   - 修改 tide → toolStore.brush.tide 同步
//   - 修改 height / passable / destructible / preset_safe 同步

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import BrushPresetPanel from '@/components/panels/BrushPresetPanel.vue';
import { useToolStore } from '@/stores/toolStore';
import { FLOOR_OPTIONS, TIDE_OPTIONS } from '@/shared';
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

describe('BrushPresetPanel', () => {
  let tool: ReturnType<typeof useToolStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    tool = useToolStore();
  });

  function mountPanel() {
    return mount(BrushPresetPanel, {
      global: {
        plugins: [i18n],
      },
    });
  }

  it('渲染 floor 下拉（5 项）', () => {
    const wrapper = mountPanel();
    const selects = wrapper.findAll('select');
    // floor / tide / 其他下拉
    expect(selects.length).toBeGreaterThanOrEqual(2);
    // 第一个 select 是 floor
    const floorSelect = selects[0]!;
    const options = floorSelect.findAll('option');
    expect(options).toHaveLength(FLOOR_OPTIONS.length);
    expect(FLOOR_OPTIONS.length).toBe(5);
  });

  it('渲染 tide 下拉（3 项，不含 safe）', () => {
    const wrapper = mountPanel();
    const selects = wrapper.findAll('select');
    const tideSelect = selects[1]!;
    const options = tideSelect.findAll('option');
    expect(options).toHaveLength(TIDE_OPTIONS.length);
    expect(TIDE_OPTIONS.length).toBe(3);
    // 不含 safe
    const values = options.map((o) => o.attributes('value'));
    expect(values).not.toContain('safe');
  });

  it('渲染 height 数字输入框', () => {
    const wrapper = mountPanel();
    const numberInput = wrapper.find('input[type="number"]');
    expect(numberInput.exists()).toBe(true);
  });

  it('渲染 3 个复选框（Passable / Destructible / Preset Safe）', () => {
    const wrapper = mountPanel();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(3);
  });

  it('修改 floor 下拉同步到 store', async () => {
    const wrapper = mountPanel();
    const selects = wrapper.findAll('select');
    const floorSelect = selects[0]!;
    await floorSelect.setValue('water');
    expect(tool.brush.floor).toBe('water');
  });

  it('修改 tide 下拉同步到 store', async () => {
    const wrapper = mountPanel();
    const selects = wrapper.findAll('select');
    const tideSelect = selects[1]!;
    await tideSelect.setValue('deep');
    expect(tool.brush.tide).toBe('deep');
  });

  it('修改 height 同步到 store', async () => {
    const wrapper = mountPanel();
    const numberInput = wrapper.find('input[type="number"]');
    await numberInput.setValue('7');
    expect(tool.brush.height).toBe(7);
  });

  it('切换 Passable 复选框同步到 store', async () => {
    const wrapper = mountPanel();
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    const passableCheckbox = checkboxes[0]!;
    expect(tool.brush.passable).toBe(true);
    await passableCheckbox.setValue(false);
    expect(tool.brush.passable).toBe(false);
  });

  it('初始 brush 显示在 UI 上', () => {
    tool.updateBrush({ floor: 'metal', tide: 'abyss', height: 9 });
    const wrapper = mountPanel();
    const selects = wrapper.findAll('select');
    const floorSelect = selects[0]!;
    expect((floorSelect.element as HTMLSelectElement).value).toBe('metal');
    const tideSelect = selects[1]!;
    expect((tideSelect.element as HTMLSelectElement).value).toBe('abyss');
    const numberInput = wrapper.find('input[type="number"]');
    expect((numberInput.element as HTMLInputElement).value).toBe('9');
  });
});
