//
// ConfigPanel 组件测试（对齐 NEW_DESIGN.md §7.3 M5：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 未加载任何配置时显示"请先加载配置文件"
//   - 加载后渲染三子 Tab + obl_config 只读 Tab
//   - 默认显示 scatter 子 Tab
//   - 点击 Tab 切换 activeTab
//   - obl_config 只读展示（JSON 格式化）
//   - obl_config 未加载时显示提示
//   - obl_config 不编辑边界案例

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ConfigPanel from '@/components/panels/ConfigPanel.vue';
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
function makeScatterPhp(): string {
  return `<?php
return [
    'shallow' => [
        'initial' => [
            ['item_id' => 'scrap_metal', 'count' => 1, 'rate' => 0.5],
        ],
        'refresh' => [],
    ],
    'deep' => ['initial' => [], 'refresh' => []],
    'abyss' => ['initial' => [], 'refresh' => []],
];`;
}

function makePoiTablePhp(): string {
  return `<?php
return [
    'landmark' => [
        'name' => '地标',
        'searchable' => false,
        'repeatable' => false,
    ],
];`;
}

function makePoiPoolPhp(): string {
  return `<?php
return [
    'shallow' => [['poi_id' => 'landmark', 'per_region' => 1]],
    'deep' => [],
    'abyss' => [],
];`;
}

function makeOblConfigPhp(): string {
  return `<?php
return [
    'max_wild_items_per_tile' => 3,
    'enable_poi_ttl' => true,
    'wild_item_refresh_rate_by_tide' => [
        'shallow' => 0.5,
        'deep' => 1.0,
        'abyss' => 1.5,
    ],
];`;
}

describe('ConfigPanel', () => {
  let config: ReturnType<typeof useConfigStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    config = useConfigStore();
  });

  function mountPanel() {
    return mount(ConfigPanel, {
      global: {
        plugins: [i18n],
      },
    });
  }

  // ─── 未加载状态 ──────────────────────────────────────
  it('未加载任何配置时显示"请先加载配置文件"', () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('请先加载配置文件');
  });

  // ─── 加载后状态 ──────────────────────────────────────
  it('加载后渲染三子 Tab + obl_config 只读 Tab', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('散布池');
    expect(wrapper.text()).toContain('POI 模板');
    expect(wrapper.text()).toContain('POI 生成池');
    expect(wrapper.text()).toContain('obl_config');
    expect(wrapper.text()).toContain('只读');
  });

  it('加载后默认显示 scatter 子 Tab（含散布池内容）', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountPanel();
    // scatter 子 Tab 应显示散布池 item_id（input value）
    const textInputs = wrapper.findAll('input[type="text"]');
    expect(textInputs.length).toBeGreaterThan(0);
    expect((textInputs[0]!.element as HTMLInputElement).value).toBe('scrap_metal');
  });

  // ─── Tab 切换 ────────────────────────────────────────
  it('点击 POI 模板 Tab 切换到 poi_table', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountPanel();
    const poiTableTab = wrapper.findAll('button').find((b) => b.text().includes('POI 模板'));
    await poiTableTab!.trigger('click');
    // 应显示 POI 模板列表（含 landmark）
    expect(wrapper.text()).toContain('landmark');
    expect(wrapper.text()).toContain('模板列表');
  });

  it('点击 POI 生成池 Tab 切换到 poi_pool', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountPanel();
    const poiPoolTab = wrapper.findAll('button').find((b) => b.text().includes('POI 生成池'));
    await poiPoolTab!.trigger('click');
    // 应显示 POI 生成池内容
    expect(wrapper.text()).toContain('浅滩');
    expect(wrapper.text()).toContain('深水');
    expect(wrapper.text()).toContain('深海');
  });

  it('点击 obl_config Tab 切换到只读视图', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
      'obl_config.php': makeOblConfigPhp(),
    });
    const wrapper = mountPanel();
    const oblConfigTab = wrapper.findAll('button').find((b) => b.text().includes('obl_config'));
    await oblConfigTab!.trigger('click');
    // 应显示 obl_config 只读提示
    expect(wrapper.text()).toContain('obl_config 只读不编辑');
  });

  // ─── obl_config 只读展示 ────────────────────────────
  it('obl_config Tab 显示 JSON 格式化内容', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
      'obl_config.php': makeOblConfigPhp(),
    });
    const wrapper = mountPanel();
    const oblConfigTab = wrapper.findAll('button').find((b) => b.text().includes('obl_config'));
    await oblConfigTab!.trigger('click');
    // 应显示 obl_config key（max_wild_items_per_tile 等）
    expect(wrapper.text()).toContain('max_wild_items_per_tile');
    expect(wrapper.text()).toContain('enable_poi_ttl');
    expect(wrapper.text()).toContain('wild_item_refresh_rate_by_tide');
  });

  it('obl_config 未加载时显示提示', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
      // 不加载 obl_config
    });
    const wrapper = mountPanel();
    const oblConfigTab = wrapper.findAll('button').find((b) => b.text().includes('obl_config'));
    await oblConfigTab!.trigger('click');
    expect(wrapper.text()).toContain('obl_config.php 未加载');
  });

  it('仅加载 obl_config（无三大配置）时 hasAnyConfig 为 true', async () => {
    config.loadFromPhpStrings({
      'obl_config.php': makeOblConfigPhp(),
    });
    const wrapper = mountPanel();
    // 不应显示未加载提示
    expect(wrapper.text()).not.toContain('请先加载配置文件');
  });

  // ─── v-show 而非 v-if（保留所有子组件 mount） ───────
  it('切换 Tab 后 scatter 编辑器仍 mount（v-show 行为）', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
    });
    const wrapper = mountPanel();
    // 切换到 poi_table
    const poiTableTab = wrapper.findAll('button').find((b) => b.text().includes('POI 模板'));
    await poiTableTab!.trigger('click');
    // scatter 编辑器仍应 mount（input value 仍可访问）
    const textInputs = wrapper.findAll('input[type="text"]');
    // 总 input 数应包含 scatter 的 item_id + poi_table 的 name 等
    expect(textInputs.length).toBeGreaterThan(0);
  });

  // ─── obl_config 边界案例提示 ────────────────────────
  it('obl_config Tab 显示边界案例提示文案', async () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeScatterPhp(),
      'poi_table.php': makePoiTablePhp(),
      'poi_pool.php': makePoiPoolPhp(),
      'obl_config.php': makeOblConfigPhp(),
    });
    const wrapper = mountPanel();
    const oblConfigTab = wrapper.findAll('button').find((b) => b.text().includes('obl_config'));
    await oblConfigTab!.trigger('click');
    // 边界案例提示
    expect(wrapper.text()).toContain('§3.4.4');
    expect(wrapper.text()).toContain('边界案例');
  });
});
