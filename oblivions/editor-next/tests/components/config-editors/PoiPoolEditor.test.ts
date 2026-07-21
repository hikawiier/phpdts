//
// PoiPoolEditor 组件测试（对齐 NEW_DESIGN.md §7.3 M5：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 未加载时显示"请先加载 poi_pool.php"
//   - 加载后渲染三 tide Tab
//   - 点击 Tab 切换 tide
//   - 列表渲染每条 entry 的 SchemaField（poi_id select + per_region number）
//   - poi_table 未加载时显示提示
//   - poi_table 加载后 poi_id select 选项来自 config.poiIdOptions
//   - 新增按钮触发 config.addPoiPoolEntry
//   - 删除按钮触发 config.removePoiPoolEntry
//   - 字段更新触发 config.updatePoiPoolEntry
//   - 空列表显示提示文案

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import PoiPoolEditor from '@/components/config-editors/PoiPoolEditor.vue';
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

// ─── 测试数据 ─────────────────────────────────────────
function makePoiPoolPhp(): string {
  return `<?php
return [
    'shallow' => [
        ['poi_id' => 'supply_cache', 'per_region' => 2],
        ['poi_id' => 'landmark', 'per_region' => 1],
    ],
    'deep' => [],
    'abyss' => [],
];`;
}

function makePoiTablePhp(): string {
  return `<?php
return [
    'supply_cache' => [
        'name' => '补给储藏箱',
        'searchable' => true,
        'repeatable' => false,
    ],
    'landmark' => [
        'name' => '地标',
        'searchable' => false,
        'repeatable' => false,
    ],
];`;
}

describe('PoiPoolEditor', () => {
  let config: ReturnType<typeof useConfigStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    config = useConfigStore();
  });

  function mountEditor() {
    return mount(PoiPoolEditor, {
      global: {
        plugins: [i18n],
      },
    });
  }

  // ─── 未加载状态 ──────────────────────────────────────
  it('未加载时显示"请先加载 poi_pool.php"', () => {
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('请先加载 poi_pool.php');
  });

  // ─── 加载后状态 ──────────────────────────────────────
  it('加载后渲染三 tide Tab', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('浅滩');
    expect(wrapper.text()).toContain('深水');
    expect(wrapper.text()).toContain('深海');
  });

  it('加载后默认显示 shallow 列表（per_region 在 number input 中）', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    // shallow 有 2 条 entry，每条 entry 有 1 个 per_region number input
    const numberInputs = wrapper.findAll('input[type="number"]');
    expect(numberInputs.length).toBe(2);
    expect((numberInputs[0]!.element as HTMLInputElement).value).toBe('2');
    expect((numberInputs[1]!.element as HTMLInputElement).value).toBe('1');
  });

  // ─── poi_table 未加载提示 ───────────────────────────
  it('poi_table 未加载时显示提示', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('poi_table.php 未加载');
  });

  it('poi_table 加载后不显示未加载提示', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).not.toContain('poi_table.php 未加载');
  });

  // ─── Tab 切换 ────────────────────────────────────────
  it('点击 deep Tab 切换 tide（空列表显示提示）', async () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    const deepButton = wrapper.findAll('button').find((b) => b.text() === '深水');
    await deepButton!.trigger('click');
    // deep 列表为空，应显示"无"提示
    expect(wrapper.text()).toContain('无');
  });

  // ─── poi_id select 选项联动 ─────────────────────────
  it('poi_table 加载后 poi_id select 包含 poiTable 的 ID 选项', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    // shallow 有 2 条 entry，每条 entry 有 1 个 poi_id select
    const selects = wrapper.findAll('select');
    expect(selects.length).toBe(2);
    // 每个 select 应有 3 个 option：1 placeholder + 2 POI（supply_cache + landmark）
    const options0 = selects[0]!.findAll('option');
    expect(options0.length).toBe(3);
    // 验证 option 文本包含 POI 名称
    const optionTexts = options0.map((o) => o.text());
    expect(optionTexts.some((t) => t.includes('supply_cache'))).toBe(true);
    expect(optionTexts.some((t) => t.includes('landmark'))).toBe(true);
  });

  // ─── 新增按钮 ────────────────────────────────────────
  it('点击新增按钮触发 addPoiPoolEntry', async () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    const before = config.poiPool!.shallow.length;
    const addButton = wrapper.findAll('button').find((b) => b.text().includes('新增条目'));
    await addButton!.trigger('click');
    expect(config.poiPool!.shallow).toHaveLength(before + 1);
    expect(config.isDirty).toBe(true);
  });

  // ─── 删除按钮 ────────────────────────────────────────
  it('点击删除按钮触发 removePoiPoolEntry', async () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    const before = config.poiPool!.shallow.length;
    const deleteButton = wrapper.findAll('button').find((b) => b.attributes('title') === '删除');
    await deleteButton!.trigger('click');
    expect(config.poiPool!.shallow).toHaveLength(before - 1);
    expect(config.isDirty).toBe(true);
  });

  // ─── 字段更新 ────────────────────────────────────────
  it('修改 per_region 字段触发 updatePoiPoolEntry', async () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    const numberInputs = wrapper.findAll('input[type="number"]');
    expect(numberInputs.length).toBeGreaterThan(0);
    await numberInputs[0]!.setValue('99');
    expect(config.poiPool!.shallow[0]!.per_region).toBe(99);
    expect(config.isDirty).toBe(true);
  });

  it('修改 poi_id 字段触发 updatePoiPoolEntry', async () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const selects = wrapper.findAll('select');
    expect(selects.length).toBeGreaterThan(0);
    // 切换第一个 entry 的 poi_id 为 landmark
    await selects[0]!.setValue('landmark');
    expect(config.poiPool!.shallow[0]!.poi_id).toBe('landmark');
    expect(config.isDirty).toBe(true);
  });

  // ─── 空列表提示 ──────────────────────────────────────
  it('空列表时显示"无"提示', async () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    const deepButton = wrapper.findAll('button').find((b) => b.text() === '深水');
    await deepButton!.trigger('click');
    expect(wrapper.text()).toContain('无');
  });

  // ─── 条目序号显示 ────────────────────────────────────
  it('显示条目序号（#1, #2 ...）', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('#1');
    expect(wrapper.text()).toContain('#2');
  });

  // ─── 拖拽 handle 显示 ────────────────────────────────
  it('渲染拖拽 handle', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('⠿');
  });

  // ─── 提示文案 ────────────────────────────────────────
  it('显示 poi_id 来源提示文案', () => {
    config.loadFromPhpStrings({
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('poi_id');
    expect(wrapper.text()).toContain('poi_table');
  });
});
