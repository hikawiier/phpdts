//
// ScatterPoolEditor 组件测试（对齐 NEW_DESIGN.md §7.3 M5：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 未加载时显示"请先加载 scatter_pool.php"
//   - 加载后渲染三 tide Tab + initial/refresh 双相位 Tab
//   - 点击 Tab 切换 currentTide / currentPhase
//   - 列表渲染每条 entry 的 SchemaField（item_id / count / rate）
//   - 新增按钮触发 config.addScatterEntry
//   - 删除按钮触发 config.removeScatterEntry
//   - 字段更新触发 config.updateScatterEntry
//   - 空列表显示提示文案
//   - rate 提示文案显示

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ScatterPoolEditor from '@/components/config-editors/ScatterPoolEditor.vue';
import { useConfigStore } from '@/stores/configStore';
import zhCN from '@/i18n/zh-CN';

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  missingWarn: false,
  fallbackWarn: false,
});

// ─── 测试数据：scatter_pool PHP ─────────────────────────
function makeScatterPhp(): string {
  return `<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }
return [
    'shallow' => [
        'initial' => [
            ['item_id' => 'scrap_metal', 'count' => [1,3], 'rate' => 0.60],
            ['item_id' => 'rusty_gear',  'count' => 1,     'rate' => 0.30],
        ],
        'refresh' => [
            ['item_id' => 'scrap_metal', 'count' => 1, 'rate' => 0.25],
        ],
    ],
    'deep' => [
        'initial' => [],
        'refresh' => [],
    ],
    'abyss' => [
        'initial' => [],
        'refresh' => [],
    ],
];`;
}

describe('ScatterPoolEditor', () => {
  let config: ReturnType<typeof useConfigStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    config = useConfigStore();
  });

  function mountEditor() {
    return mount(ScatterPoolEditor, {
      global: {
        plugins: [i18n],
      },
    });
  }

  // ─── 未加载状态 ──────────────────────────────────────
  it('未加载时显示"请先加载 scatter_pool.php"', () => {
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('请先加载 scatter_pool.php');
  });

  // ─── 加载后状态 ──────────────────────────────────────
  it('加载后渲染三 tide Tab + initial/refresh Tab', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('浅滩');
    expect(wrapper.text()).toContain('深水');
    expect(wrapper.text()).toContain('深海');
    expect(wrapper.text()).toContain('初始');
    expect(wrapper.text()).toContain('刷新');
  });

  it('加载后默认显示 shallow/initial 列表（item_id 在 input value 中）', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    // item_id 字段是 text input，值在 .element.value
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThanOrEqual(2);
    expect((textInputs[0]!.element as HTMLInputElement).value).toBe('scrap_metal');
    expect((textInputs[1]!.element as HTMLInputElement).value).toBe('rusty_gear');
  });

  // ─── Tab 切换 ────────────────────────────────────────
  it('点击 deep Tab 切换 tide（空列表显示提示）', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const tideButtons = wrapper.findAll('button');
    const deepButton = tideButtons.find((b) => b.text() === '深水');
    await deepButton!.trigger('click');
    // deep.initial 为空，应显示"无"提示
    expect(wrapper.text()).toContain('无');
  });

  it('点击 refresh Tab 切换 phase（refresh 相位仅 1 条）', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const phaseButtons = wrapper.findAll('button');
    const refreshButton = phaseButtons.find((b) => b.text() === '刷新');
    await refreshButton!.trigger('click');
    // refresh 相位只有 1 条 scrap_metal（在 input value 中）
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBe(1);
    expect((textInputs[0]!.element as HTMLInputElement).value).toBe('scrap_metal');
  });

  // ─── 新增按钮 ────────────────────────────────────────
  it('点击新增按钮触发 addScatterEntry', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const before = config.scatterPool!.shallow.initial.length;
    const addButton = wrapper.findAll('button').find((b) => b.text().includes('新增条目'));
    await addButton!.trigger('click');
    expect(config.scatterPool!.shallow.initial).toHaveLength(before + 1);
    expect(config.isDirty).toBe(true);
  });

  // ─── 删除按钮 ────────────────────────────────────────
  it('点击删除按钮触发 removeScatterEntry', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const before = config.scatterPool!.shallow.initial.length;
    const deleteButton = wrapper.findAll('button').find((b) => b.attributes('title') === '删除');
    await deleteButton!.trigger('click');
    expect(config.scatterPool!.shallow.initial).toHaveLength(before - 1);
    expect(config.isDirty).toBe(true);
  });

  // ─── 字段更新 ────────────────────────────────────────
  it('修改 item_id 字段触发 updateScatterEntry', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThan(0);
    await textInputs[0]!.setValue('new_item_id');
    expect(config.scatterPool!.shallow.initial[0]!.item_id).toBe('new_item_id');
    expect(config.isDirty).toBe(true);
  });

  it('修改 rate 字段触发 updateScatterEntry', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    // number input 顺序：
    //   entry1 count=[1,3] 范围模式 → countMin, countMax, rate
    //   entry2 count=1 单值模式 → countMin, rate
    // 即 [0]=countMin1, [1]=countMax1, [2]=rate1, [3]=countMin2, [4]=rate2
    const numberInputs = wrapper.findAll('input[type="number"]');
    expect(numberInputs.length).toBe(5);
    const rate1Input = numberInputs[2]!;
    await rate1Input.setValue('0.99');
    expect(config.scatterPool!.shallow.initial[0]!.rate).toBeCloseTo(0.99);
  });

  // ─── 空列表提示 ──────────────────────────────────────
  it('空列表时显示"无"提示', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const deepButton = wrapper.findAll('button').find((b) => b.text() === '深水');
    await deepButton!.trigger('click');
    expect(wrapper.text()).toContain('无');
  });

  // ─── 提示文案 ────────────────────────────────────────
  it('显示 rate 基础率提示文案', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('rate');
    expect(wrapper.text()).toContain('基础率');
  });

  // ─── 条目序号显示 ────────────────────────────────────
  it('显示条目序号（#1, #2 ...）', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('#1');
    expect(wrapper.text()).toContain('#2');
  });

  // ─── 拖拽 handle 显示 ────────────────────────────────
  it('渲染拖拽 handle', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('⠿');
  });

  // ─── count-range 范围模式 ───────────────────────────
  it('count=[1,3] 渲染范围模式（2 个 number input）', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
    });
    const wrapper = mountEditor();
    const numberInputs = wrapper.findAll('input[type="number"]');
    // entry1 范围模式: countMin + countMax + rate = 3
    // entry2 单值模式: countMin + rate = 2
    // 共 5 个 number input
    expect(numberInputs.length).toBe(5);
    // 第一个 entry 的 countMin = 1, countMax = 3
    expect((numberInputs[0]!.element as HTMLInputElement).value).toBe('1');
    expect((numberInputs[1]!.element as HTMLInputElement).value).toBe('3');
  });
});
