//
// ValidatePanel 组件测试（对齐 NEW_DESIGN.md §7.3 M6：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - 渲染：空状态 / 过滤后空 / issue 列表（含 rule + message + hint + location 锚点）
//   - 严重级别视觉区分：error 用 border-accent-error，warning 用 border-gray-700 border-dashed
//   - 过滤器按钮：all / error / warning 三档切换 + 激活态高亮
//   - 计数显示：全部 / 仅错误 / 仅警告 三档计数
//   - 跳转事件：点击 issue 触发 emit('jump', location)
//   - 边界：location.pgroup/pls 都为 null 时不触发跳转
//   - 最后运行模式与时间显示：Light / Full + HH:mm:ss

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import ValidatePanel from '@/components/panels/ValidatePanel.vue';
import { useValidateStore } from '@/stores/validateStore';
import { VALIDATE_RULES } from '@/shared';
import type { ValidateIssue, ValidateIssueLocation } from '@/shared';

// ─── 测试数据工厂 ───────────────────────────────────────────────

function makeIssue(overrides: Partial<ValidateIssue> = {}): ValidateIssue {
  return {
    rule: VALIDATE_RULES.PLS_RANGE,
    severity: 'error',
    message: '测试错误信息',
    location: { pgroup: 1, pls: 2 },
    hint: '测试修复建议',
    ...overrides,
  };
}

// ─── 测试用例 ─────────────────────────────────────────────────

describe('ValidatePanel', () => {
  let validate: ReturnType<typeof useValidateStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    validate = useValidateStore();
  });

  function mountPanel() {
    return mount(ValidatePanel);
  }

  // ─── 空状态 ───────────────────────────────────────────────

  it('空状态：issues 为空时显示"暂无验证问题"', () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('暂无验证问题');
  });

  it('过滤后空：issues 非空但全被过滤时显示"当前过滤器下无问题"', () => {
    validate.setIssues([makeIssue({ severity: 'error' })], 'light');
    validate.setFilter('warning'); // 只有 error，过滤后空
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('当前过滤器下无问题');
  });

  // ─── issue 列表渲染 ─────────────────────────────────────────

  it('渲染 issue 列表：包含 rule / message / hint', () => {
    validate.setIssues(
      [
        makeIssue({
          rule: VALIDATE_RULES.PLS_RANGE,
          severity: 'error',
          message: 'pls 超出范围',
          hint: '请检查 pls 值',
        }),
      ],
      'light',
    );
    const wrapper = mountPanel();
    const items = wrapper.findAll('li');
    expect(items).toHaveLength(1);
    const text = items[0]!.text();
    expect(text).toContain('pls_range');
    expect(text).toContain('pls 超出范围');
    expect(text).toContain('请检查 pls 值');
  });

  it('渲染多个 issue', () => {
    validate.setIssues(
      [
        makeIssue({ rule: VALIDATE_RULES.PLS_RANGE, severity: 'error', message: '错误1' }),
        makeIssue({ rule: VALIDATE_RULES.TIDE_INVALID, severity: 'error', message: '错误2' }),
        makeIssue({
          rule: VALIDATE_RULES.CONNECTIVITY_ISLAND,
          severity: 'warning',
          message: '警告1',
        }),
      ],
      'full',
    );
    const wrapper = mountPanel();
    expect(wrapper.findAll('li')).toHaveLength(3);
  });

  it('issue 无 hint 时不渲染 hint 行', () => {
    validate.setIssues([makeIssue({ hint: undefined })], 'light');
    const wrapper = mountPanel();
    // 💡 标识仅在 hint 存在时渲染
    expect(wrapper.text()).not.toContain('💡');
  });

  // ─── 严重级别视觉区分 ──────────────────────────────────────

  it('error issue 使用 border-accent-error 视觉', () => {
    validate.setIssues([makeIssue({ severity: 'error' })], 'light');
    const wrapper = mountPanel();
    const issueButton = wrapper.find('li button');
    expect(issueButton.exists()).toBe(true);
    expect(issueButton.classes()).toContain('border-accent-error/60');
    expect(issueButton.classes()).not.toContain('border-dashed');
  });

  it('warning issue 使用 border-gray-700 border-dashed 视觉', () => {
    validate.setIssues(
      [makeIssue({ severity: 'warning', rule: VALIDATE_RULES.CONNECTIVITY_ISLAND })],
      'light',
    );
    const wrapper = mountPanel();
    const issueButton = wrapper.find('li button');
    expect(issueButton.exists()).toBe(true);
    expect(issueButton.classes()).toContain('border-gray-700');
    expect(issueButton.classes()).toContain('border-dashed');
  });

  it('issue 数据属性 data-rule / data-severity / data-pgroup / data-pls 正确', () => {
    validate.setIssues(
      [
        makeIssue({
          rule: VALIDATE_RULES.PLS_RANGE,
          severity: 'error',
          location: { pgroup: 3, pls: 5 },
        }),
      ],
      'light',
    );
    const wrapper = mountPanel();
    const issueButton = wrapper.find('li button');
    expect(issueButton.attributes('data-rule')).toBe('pls_range');
    expect(issueButton.attributes('data-severity')).toBe('error');
    expect(issueButton.attributes('data-pgroup')).toBe('3');
    expect(issueButton.attributes('data-pls')).toBe('5');
  });

  it('location 含 field 时渲染 field', () => {
    validate.setIssues(
      [
        makeIssue({
          location: { pgroup: 1, pls: 2, field: 'exit_links[0].to_pgroup' },
        }),
      ],
      'light',
    );
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('exit_links[0].to_pgroup');
  });

  it('location.pgroup/pls 为 null 时不渲染坐标', () => {
    validate.setIssues(
      [makeIssue({ location: { pgroup: null, pls: null } })],
      'light',
    );
    const wrapper = mountPanel();
    const text = wrapper.find('li button').text();
    expect(text).not.toContain('pgroup=');
    expect(text).not.toContain('pls=');
  });

  // ─── 过滤器按钮 ─────────────────────────────────────────────

  it('渲染 3 个过滤器按钮（全部 / 仅错误 / 仅警告）', () => {
    const wrapper = mountPanel();
    const filterButtons = wrapper.findAll('.border-b button');
    expect(filterButtons).toHaveLength(3);
    expect(filterButtons[0]!.text()).toContain('全部');
    expect(filterButtons[1]!.text()).toContain('仅错误');
    expect(filterButtons[2]!.text()).toContain('仅警告');
  });

  it('默认激活"全部"过滤器', () => {
    const wrapper = mountPanel();
    const activeBtn = wrapper.findAll('.border-b button')[0]!;
    expect(activeBtn.classes()).toContain('border-gray-500');
    expect(activeBtn.classes()).toContain('bg-gray-700');
  });

  it('点击"仅错误"切换 filter', async () => {
    validate.setIssues(
      [
        makeIssue({ severity: 'error', message: '错误' }),
        makeIssue({ severity: 'warning', message: '警告', rule: VALIDATE_RULES.CONNECTIVITY_ISLAND }),
      ],
      'light',
    );
    const wrapper = mountPanel();
    const errorBtn = wrapper.findAll('.border-b button')[1]!;
    await errorBtn.trigger('click');
    expect(validate.filter).toBe('error');
    // 仅 error 的 issue 显示
    await wrapper.vm.$nextTick();
    const items = wrapper.findAll('li');
    expect(items).toHaveLength(1);
    expect(items[0]!.text()).toContain('错误');
  });

  it('点击"仅警告"切换 filter', async () => {
    validate.setIssues(
      [
        makeIssue({ severity: 'error', message: '错误' }),
        makeIssue({
          severity: 'warning',
          message: '警告',
          rule: VALIDATE_RULES.CONNECTIVITY_ISLAND,
        }),
      ],
      'light',
    );
    const wrapper = mountPanel();
    const warningBtn = wrapper.findAll('.border-b button')[2]!;
    await warningBtn.trigger('click');
    expect(validate.filter).toBe('warning');
    await wrapper.vm.$nextTick();
    const items = wrapper.findAll('li');
    expect(items).toHaveLength(1);
    expect(items[0]!.text()).toContain('警告');
  });

  it('点击"全部"恢复显示所有 issue', async () => {
    validate.setIssues(
      [
        makeIssue({ severity: 'error', message: '错误' }),
        makeIssue({
          severity: 'warning',
          message: '警告',
          rule: VALIDATE_RULES.CONNECTIVITY_ISLAND,
        }),
      ],
      'light',
    );
    validate.setFilter('error');
    const wrapper = mountPanel();
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('li')).toHaveLength(1);
    const allBtn = wrapper.findAll('.border-b button')[0]!;
    await allBtn.trigger('click');
    expect(validate.filter).toBe('all');
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('li')).toHaveLength(2);
  });

  // ─── 计数显示 ─────────────────────────────────────────────

  it('过滤器按钮显示对应计数', () => {
    validate.setIssues(
      [
        makeIssue({ severity: 'error' }),
        makeIssue({ severity: 'error', rule: VALIDATE_RULES.TIDE_INVALID }),
        makeIssue({
          severity: 'warning',
          rule: VALIDATE_RULES.CONNECTIVITY_ISLAND,
        }),
      ],
      'full',
    );
    const wrapper = mountPanel();
    const buttons = wrapper.findAll('.border-b button');
    // 全部 (3) / 仅错误 (2) / 仅警告 (1)
    expect(buttons[0]!.text()).toContain('(3)');
    expect(buttons[1]!.text()).toContain('(2)');
    expect(buttons[2]!.text()).toContain('(1)');
  });

  // ─── 跳转事件 ─────────────────────────────────────────────

  it('点击 issue 触发 jump 事件携带 location', async () => {
    const location: ValidateIssueLocation = { pgroup: 5, pls: 10 };
    validate.setIssues(
      [makeIssue({ location })],
      'light',
    );
    const wrapper = mountPanel();
    await wrapper.find('li button').trigger('click');
    const jumpEvents = wrapper.emitted('jump');
    expect(jumpEvents).toBeDefined();
    expect(jumpEvents![0]).toEqual([location]);
  });

  it('点击 issue 含 field 时 jump 携带 field', async () => {
    const location: ValidateIssueLocation = {
      pgroup: 5,
      pls: 10,
      field: 'exit_links[0].to_pgroup',
    };
    validate.setIssues([makeIssue({ location })], 'light');
    const wrapper = mountPanel();
    await wrapper.find('li button').trigger('click');
    expect(wrapper.emitted('jump')![0]).toEqual([location]);
  });

  it('location.pgroup/pls 都为 null 时不触发 jump', async () => {
    validate.setIssues(
      [makeIssue({ location: { pgroup: null, pls: null } })],
      'light',
    );
    const wrapper = mountPanel();
    await wrapper.find('li button').trigger('click');
    expect(wrapper.emitted('jump')).toBeUndefined();
  });

  // ─── 最后运行模式与时间显示 ─────────────────────────────────

  it('lastRunMode=light 时显示 "Light" 标识', () => {
    validate.setIssues([], 'light');
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('Light');
  });

  it('lastRunMode=full 时显示 "Full" 标识', () => {
    validate.setIssues([], 'full');
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('Full');
  });

  it('lastRunMode=null 时不显示模式标识', () => {
    const wrapper = mountPanel();
    // 不应包含 Light / Full 标识（仅作为运行模式标识，过滤器按钮文案除外）
    const headerText = wrapper.find('.border-b').text();
    // 全部/仅错误/仅警告 文案 + 时间标识（空）
    expect(headerText).not.toContain('Light');
    expect(headerText).not.toContain('Full');
  });

  it('lastRunAt 不为 null 时显示 HH:mm:ss 时间', () => {
    // 固定时间便于断言：2026-01-15 14:30:45（本地时区）
    const fixedTime = new Date(2026, 0, 15, 14, 30, 45).getTime();
    validate.setIssues([], 'light');
    // 手动覆盖 lastRunAt 验证时间格式化
    validate.lastRunAt = fixedTime;
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('14:30:45');
  });
});
