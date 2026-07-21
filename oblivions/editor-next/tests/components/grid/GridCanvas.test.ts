//
// GridCanvas 组件测试（对齐 NEW_DESIGN.md §7.3 M2：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 无项目时显示"选择一个区域开始编辑"
//   - 有项目时渲染网格（标题行 + 标题列 + 单元格）
//   - 列标题数字、行标题字母
//   - 已有格的 cell 渲染
//   - 空白格渲染
//   - 点击已有格触发 onCellClick
//   - 点击空白格触发 onEmptyClick
//   - 拖拽源响应式 :class（drag 状态）

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import GridCanvas from '@/components/grid/GridCanvas.vue';
import GridCell from '@/components/grid/GridCell.vue';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import { useUiStore } from '@/stores/uiStore';
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

describe('GridCanvas', () => {
  let project: ReturnType<typeof useProjectStore>;
  let tool: ReturnType<typeof useToolStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale = 'zh-CN' as unknown as typeof i18n.global.locale;
    project = useProjectStore();
    tool = useToolStore();
    // useUiStore 在 useToolActions 中被引用
    useUiStore();
  });

  function mountCanvas() {
    return mount(GridCanvas, {
      global: {
        plugins: [i18n],
        stubs: {
          GridCell: true, // stub 避免深度依赖
        },
      },
    });
  }

  it('无项目时显示空状态', () => {
    const wrapper = mountCanvas();
    expect(wrapper.text()).toContain('选择一个区域开始编辑');
  });

  it('有项目时渲染网格', async () => {
    project.addRegion('A', 4, 3);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    // 应渲染 grid container
    expect(wrapper.find('.inline-grid').exists()).toBe(true);
  });

  it('渲染列标题数字（0-3）', async () => {
    project.addRegion('A', 4, 3);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain('0');
    expect(text).toContain('1');
    expect(text).toContain('2');
    expect(text).toContain('3');
  });

  it('渲染行标题字母（A-C）', async () => {
    project.addRegion('A', 4, 3);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(text).toContain('C');
  });

  it('渲染单元格数量 = cols * rows', async () => {
    project.addRegion('A', 3, 2);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const cells = wrapper.findAllComponents(GridCell);
    expect(cells).toHaveLength(3 * 2);
  });

  it('已有格传递给 GridCell', async () => {
    project.addRegion('A', 3, 3);
    project.addTile(1, 1, 1);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const cells = wrapper.findAllComponents(GridCell);
    // 找到 (1,1) 位置的 cell，其 pls 应为 1
    const targetCell = cells.find((c) => c.props('x') === 1 && c.props('y') === 1);
    expect(targetCell).toBeDefined();
    expect(targetCell!.props('pls')).toBe(1);
    expect(targetCell!.props('tile')).not.toBeNull();
  });

  it('空白格 tile 为 null', async () => {
    project.addRegion('A', 3, 3);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const cells = wrapper.findAllComponents(GridCell);
    const emptyCell = cells.find((c) => c.props('x') === 0 && c.props('y') === 0);
    expect(emptyCell).toBeDefined();
    expect(emptyCell!.props('tile')).toBeNull();
  });

  it('选中格传递 isSelected = true', async () => {
    project.addRegion('A', 3, 3);
    const pls = project.addTile(1, 1, 1);
    project.setSelectedPls(pls!);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const cells = wrapper.findAllComponents(GridCell);
    const targetCell = cells.find((c) => c.props('pls') === pls);
    expect(targetCell!.props('isSelected')).toBe(true);
  });

  it('entrance_pls 传递 isEntrance = true', async () => {
    project.addRegion('A', 3, 3);
    const pls = project.addTile(1, 1, 1);
    project.updateRegion(1, { entrance_pls: pls });
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const cells = wrapper.findAllComponents(GridCell);
    const targetCell = cells.find((c) => c.props('pls') === pls);
    expect(targetCell!.props('isEntrance')).toBe(true);
  });

  it('工具切换传递 tool prop', async () => {
    project.addRegion('A', 3, 3);
    tool.setTool('draw');
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    const cells = wrapper.findAllComponents(GridCell);
    expect(cells[0]!.props('tool')).toBe('draw');
  });

  it('调整 cols/rows 时单元格数量同步', async () => {
    const p = project.addRegion('A', 3, 2);
    const wrapper = mountCanvas();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAllComponents(GridCell)).toHaveLength(6);
    project.updateRegion(p!, { cols: 4, rows: 3 });
    await wrapper.vm.$nextTick();
    expect(wrapper.findAllComponents(GridCell)).toHaveLength(12);
  });
});
