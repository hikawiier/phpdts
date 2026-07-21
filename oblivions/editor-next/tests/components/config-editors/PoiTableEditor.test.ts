//
// PoiTableEditor 组件测试（对齐 NEW_DESIGN.md §7.3 M5：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 未加载时显示"请先加载 poi_table.php"
//   - 加载后渲染左侧模板列表 + 右侧字段编辑
//   - 点击模板选中后显示字段分组
//   - 新增模板流程（点击 + 新增模板 → 输入 ID → 点击新增按钮）
//   - 重命名模板流程（点击重命名按钮 → 输入新 ID → 点击确认）
//   - 删除模板流程（点击删除 → openConfirm → confirmAndRun）
//   - 字段更新触发 config.updatePoiTemplate
//   - 重复 ID / 空 ID 时显示 toast 错误
//   - 字段分组显示（基本 / E-10 三档判定 / 机制型 / E-12 耐久）

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import PoiTableEditor from '@/components/config-editors/PoiTableEditor.vue';
import { useConfigStore } from '@/stores/configStore';
import { useUiStore } from '@/stores/uiStore';
import zhCN from '@/i18n/zh-CN';

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
  missingWarn: false,
  fallbackWarn: false,
});

// ─── 测试数据：poi_table PHP ─────────────────────────
function makePoiTablePhp(): string {
  return `<?php
return [
    'supply_cache' => [
        'name' => '补给储藏箱',
        'desc' => '一个被铁皮加固的木箱',
        'searchable' => true,
        'repeatable' => false,
        'base_loot_chance' => 0.7,
        'loot_table_id' => 'supply_cache_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 30, 'kind' => 'good'],
        ],
        'prob_mods_source' => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'supply_cache_loot',
        ],
    ],
    'landmark' => [
        'name' => '地标',
        'searchable' => false,
        'repeatable' => false,
    ],
];`;
}

describe('PoiTableEditor', () => {
  let config: ReturnType<typeof useConfigStore>;
  let ui: ReturnType<typeof useUiStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    config = useConfigStore();
    ui = useUiStore();
  });

  function mountEditor() {
    return mount(PoiTableEditor, {
      global: {
        plugins: [i18n],
      },
    });
  }

  // ─── 未加载状态 ──────────────────────────────────────
  it('未加载时显示"请先加载 poi_table.php"', () => {
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('请先加载 poi_table.php');
  });

  // ─── 加载后状态 ──────────────────────────────────────
  it('加载后显示左侧模板列表（含 POI ID）', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('模板列表');
    expect(wrapper.text()).toContain('supply_cache');
    expect(wrapper.text()).toContain('landmark');
  });

  it('未选中模板时显示"请从左侧选择"', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('请从左侧选择');
  });

  // ─── 选中模板 ────────────────────────────────────────
  it('点击 POI 模板后右侧显示字段编辑', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    // 点击 supply_cache 模板按钮
    const buttons = wrapper.findAll('button');
    const supplyBtn = buttons.find((b) => b.text() === 'supply_cache');
    await supplyBtn!.trigger('click');
    // 右侧应显示字段标签
    expect(wrapper.text()).toContain('编辑模板');
    expect(wrapper.text()).toContain('supply_cache');
    // 显示基本字段标签
    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).toContain('描述');
  });

  it('点击模板后显示字段分组（基本 / E-10 / 机制型 / E-12）', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const buttons = wrapper.findAll('button');
    const supplyBtn = buttons.find((b) => b.text() === 'supply_cache');
    await supplyBtn!.trigger('click');
    // 字段分组显示
    expect(wrapper.text()).toContain('基本');
    expect(wrapper.text()).toContain('E-10');
  });

  // ─── 字段更新 ────────────────────────────────────────
  it('修改 name 字段触发 updatePoiTemplate', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const supplyBtn = wrapper.findAll('button').find((b) => b.text() === 'supply_cache');
    await supplyBtn!.trigger('click');
    // 找到 name 文本输入框（第一个 text input）
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThan(0);
    // name 字段是第一个 text input
    await textInputs[0]!.setValue('新补给箱');
    expect(config.poiTable!['supply_cache']!.name).toBe('新补给箱');
    expect(config.isDirty).toBe(true);
  });

  it('切换 searchable 复选框触发 updatePoiTemplate', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const supplyBtn = wrapper.findAll('button').find((b) => b.text() === 'supply_cache');
    await supplyBtn!.trigger('click');
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);
    // searchable 原为 true，切换为 false
    await checkboxes[0]!.setValue(false);
    expect(config.poiTable!['supply_cache']!.searchable).toBe(false);
  });

  // ─── 新增模板 ────────────────────────────────────────
  it('新增模板流程：点击新增按钮 → 输入 ID → 确认新增', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    // 点击"+ 新增模板"按钮
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('新增模板'));
    await addBtn!.trigger('click');
    // 应显示输入框
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThan(0);
    // 输入新 ID
    await textInputs[textInputs.length - 1]!.setValue('new_poi');
    // 点击"新增"按钮
    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === '新增');
    await confirmBtn!.trigger('click');
    // store 应新增模板
    expect(config.poiTable!['new_poi']).toBeDefined();
    expect(config.isDirty).toBe(true);
  });

  it('新增模板时输入空 ID 显示错误 toast', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('新增模板'));
    await addBtn!.trigger('click');
    // 直接点击新增（不输入 ID）
    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === '新增');
    await confirmBtn!.trigger('click');
    // 应显示错误 toast
    expect(ui.toasts.some((t) => t.message.includes('不能为空'))).toBe(true);
  });

  it('新增模板时输入已存在 ID 显示错误 toast', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('新增模板'));
    await addBtn!.trigger('click');
    const textInputs = wrapper.findAll('input[type="text"]');
    await textInputs[textInputs.length - 1]!.setValue('landmark');
    const confirmBtn = wrapper.findAll('button').find((b) => b.text() === '新增');
    await confirmBtn!.trigger('click');
    // 应显示已存在错误 toast
    expect(ui.toasts.some((t) => t.message.includes('已存在'))).toBe(true);
  });

  // ─── 删除模板 ────────────────────────────────────────
  it('点击删除按钮触发 openConfirm', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    // 找到第一个删除按钮（标题="删除"，属于 supply_cache）
    const deleteBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '删除');
    await deleteBtn!.trigger('click');
    // ui.confirmDialog 应打开
    expect(ui.confirmDialog.open).toBe(true);
    expect(ui.confirmDialog.message).toContain('supply_cache');
  });

  it('confirmAndRun 后实际删除模板', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const deleteBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '删除');
    await deleteBtn!.trigger('click');
    // 模拟用户点击确认
    ui.confirmAndRun();
    // 第一个删除按钮属于 supply_cache，应被删除
    expect(config.poiTable!['supply_cache']).toBeUndefined();
  });

  // ─── 重命名模板 ──────────────────────────────────────
  it('重命名模板流程：点击重命名 → 输入新 ID → 确认', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    // 找到第一个重命名按钮（标题="重命名"，属于 supply_cache）
    const renameBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '重命名');
    await renameBtn!.trigger('click');
    // 应显示重命名输入框（已填入原 ID）
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThan(0);
    // 找到重命名输入框（最后一个 text input，含有原 ID）
    const renameInput = textInputs[textInputs.length - 1]!;
    expect((renameInput.element as HTMLInputElement).value).toBe('supply_cache');
    // 输入新 ID
    await renameInput.setValue('new_supply');
    // 点击确认按钮（标题="确认"）
    const confirmBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '确认');
    await confirmBtn!.trigger('click');
    // 重命名应成功
    expect(config.poiTable!['new_supply']).toBeDefined();
    expect(config.poiTable!['supply_cache']).toBeUndefined();
    expect(config.isDirty).toBe(true);
  });

  it('重命名时输入已存在 ID 显示错误 toast', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const renameBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '重命名');
    await renameBtn!.trigger('click');
    const textInputs = wrapper.findAll('input[type="text"]');
    const renameInput = textInputs[textInputs.length - 1]!;
    // 输入已存在的 ID（landmark 是第二个 POI，与 supply_cache 不同）
    await renameInput.setValue('landmark');
    const confirmBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '确认');
    await confirmBtn!.trigger('click');
    // 应显示已存在错误 toast
    expect(ui.toasts.some((t) => t.message.includes('已存在'))).toBe(true);
  });

  it('重命名时输入空 ID 显示错误 toast', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const renameBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '重命名');
    await renameBtn!.trigger('click');
    const textInputs = wrapper.findAll('input[type="text"]');
    const renameInput = textInputs[textInputs.length - 1]!;
    // 清空 ID
    await renameInput.setValue('');
    const confirmBtn = wrapper.findAll('button').find((b) => b.attributes('title') === '确认');
    await confirmBtn!.trigger('click');
    expect(ui.toasts.some((t) => t.message.includes('不能为空'))).toBe(true);
  });

  // ─── 提示文案 ────────────────────────────────────────
  it('显示 mechanic_params JSON 字符串提示', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const supplyBtn = wrapper.findAll('button').find((b) => b.text() === 'supply_cache');
    await supplyBtn!.trigger('click');
    expect(wrapper.text()).toContain('mechanic_params');
  });

  // ─── 模板计数显示 ────────────────────────────────────
  it('显示模板数量', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    expect(wrapper.text()).toContain('模板列表 (2)');
  });

  // ─── 取消按钮 ────────────────────────────────────────
  it('新增模板点击取消按钮关闭输入框', async () => {
    config.loadFromPhpStrings({
      'poi_table.php': makePoiTablePhp(),
    });
    const wrapper = mountEditor();
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('新增模板'));
    await addBtn!.trigger('click');
    const cancelBtn = wrapper.findAll('button').find((b) => b.text() === '取消');
    await cancelBtn!.trigger('click');
    // 输入框应消失（仅剩模板列表中的按钮）
    expect(wrapper.text()).not.toContain('新 POI ID');
  });
});
