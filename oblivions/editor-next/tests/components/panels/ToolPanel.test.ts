//
// ToolPanel 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染 7 个工具按钮（不含 sim-*）
//   - 当前工具激活态高亮（border-gray-400 bg-gray-700）
//   - 点击切换 toolStore.current
//   - 快捷键提示显示（V/B/E/F/D/R/Q）

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ToolPanel from '@/components/panels/ToolPanel.vue';
import { useToolStore, EDITOR_TOOL_LIST } from '@/stores/toolStore';
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

describe('ToolPanel', () => {
  let tool: ReturnType<typeof useToolStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    tool = useToolStore();
  });

  function mountPanel() {
    return mount(ToolPanel, {
      global: {
        plugins: [i18n],
      },
    });
  }

  it('渲染 7 个工具按钮', () => {
    const wrapper = mountPanel();
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(EDITOR_TOOL_LIST.length);
    expect(EDITOR_TOOL_LIST.length).toBe(7);
  });

  it('默认 select 工具激活', () => {
    const wrapper = mountPanel();
    const activeButton = wrapper.find('button.border-gray-400');
    expect(activeButton.exists()).toBe(true);
    expect(activeButton.text()).toContain('选择');
  });

  it('点击 draw 按钮切换工具', async () => {
    const wrapper = mountPanel();
    // 第二个按钮是 draw（按 EDITOR_TOOL_LIST 顺序）
    const drawButton = wrapper.findAll('button')[1]!;
    await drawButton.trigger('click');
    expect(tool.current).toBe('draw');
  });

  it('切换工具后激活态跟随', async () => {
    const wrapper = mountPanel();
    tool.setTool('erase');
    await wrapper.vm.$nextTick();
    const activeButton = wrapper.find('button.border-gray-400');
    expect(activeButton.exists()).toBe(true);
    expect(activeButton.text()).toContain('擦除');
  });

  it('显示快捷键提示', () => {
    const wrapper = mountPanel();
    const text = wrapper.text();
    // 快捷键为大写字母
    expect(text).toContain('V'); // select
    expect(text).toContain('B'); // draw
    expect(text).toContain('E'); // erase
    expect(text).toContain('F'); // paint
    expect(text).toContain('D'); // break
    expect(text).toContain('R'); // restore
    expect(text).toContain('Q'); // batch-select
  });

  it('不包含 sim-player / sim-explore', () => {
    const wrapper = mountPanel();
    const text = wrapper.text();
    expect(text).not.toContain('sim-player');
    expect(text).not.toContain('sim-explore');
  });
});
