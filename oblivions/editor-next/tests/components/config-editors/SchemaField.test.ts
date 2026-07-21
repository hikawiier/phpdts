//
// SchemaField 组件测试（对齐 NEW_DESIGN.md §7.3 M5：组件覆盖率 ≥ 75%）
//
// 覆盖点：
//   - text / number / boolean / select 基础类型
//   - json 类型：JSON.parse 校验 + 错误展示
//   - count-range 类型：单值 / 范围切换
//   - string-list 类型：增删改
//   - kv-list 类型：键值对增删改
//   - entry-list 类型：递归子条目

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import SchemaField from '@/components/config-editors/SchemaField.vue';
import type { FieldSchema } from '@/shared';

describe('SchemaField', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function mountField(schema: FieldSchema, modelValue: unknown, options?: ReadonlyArray<{ value: string; label: string }>) {
    return mount(SchemaField, {
      props: { schema, modelValue, options },
    });
  }

  // ─── text 类型 ──────────────────────────────────────
  describe('text 类型', () => {
    it('渲染文本输入框', () => {
      const wrapper = mountField(
        { key: 'name', label: '名称', type: 'text' },
        'hello',
      );
      expect(wrapper.find('input[type="text"]').exists()).toBe(true);
      expect(wrapper.find('input[type="text"]').element.getAttribute('value') ?? (wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('hello');
    });

    it('update:modelValue emit', async () => {
      const wrapper = mountField(
        { key: 'name', label: '名称', type: 'text' },
        '',
      );
      const input = wrapper.find('input[type="text"]');
      await input.setValue('new value');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('new value');
    });

    it('显示 label 和 required 标记', () => {
      const wrapper = mountField(
        { key: 'name', label: '名称', type: 'text', required: true },
        '',
      );
      expect(wrapper.text()).toContain('名称');
      expect(wrapper.text()).toContain('*');
    });
  });

  // ─── number 类型 ────────────────────────────────────
  describe('number 类型', () => {
    it('渲染数字输入框', () => {
      const wrapper = mountField(
        { key: 'rate', label: '率', type: 'number', min: 0, max: 1, step: 0.01 },
        0.5,
      );
      expect(wrapper.find('input[type="number"]').exists()).toBe(true);
    });

    it('update:modelValue emit 数字', async () => {
      const wrapper = mountField(
        { key: 'rate', label: '率', type: 'number' },
        0,
      );
      await wrapper.find('input[type="number"]').setValue('0.5');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe(0.5);
    });
  });

  // ─── boolean 类型 ───────────────────────────────────
  describe('boolean 类型', () => {
    it('渲染复选框', () => {
      const wrapper = mountField(
        { key: 'flag', label: '标志', type: 'boolean' },
        false,
      );
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
    });

    it('update:modelValue emit boolean', async () => {
      const wrapper = mountField(
        { key: 'flag', label: '标志', type: 'boolean' },
        false,
      );
      await wrapper.find('input[type="checkbox"]').setValue(true);
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe(true);
    });
  });

  // ─── select 类型 ────────────────────────────────────
  describe('select 类型', () => {
    it('渲染下拉框', () => {
      const wrapper = mountField(
        {
          key: 'kind',
          label: '类型',
          type: 'select',
          options: [
            { value: 'good', label: '良性' },
            { value: 'bad', label: '恶性' },
          ],
        },
        'good',
      );
      expect(wrapper.find('select').exists()).toBe(true);
      expect(wrapper.findAll('option')).toHaveLength(2);
    });

    it('update:modelValue emit 选项值', async () => {
      const wrapper = mountField(
        {
          key: 'kind',
          label: '类型',
          type: 'select',
          options: [
            { value: 'good', label: '良性' },
            { value: 'bad', label: '恶性' },
          ],
        },
        'good',
      );
      await wrapper.find('select').setValue('bad');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('bad');
    });

    it('props.options 覆盖 schema.options', () => {
      const wrapper = mountField(
        { key: 'kind', label: '类型', type: 'select' },
        '',
        [{ value: 'a', label: 'A' }],
      );
      expect(wrapper.findAll('option')).toHaveLength(1);
    });
  });

  // ─── json 类型 ──────────────────────────────────────
  describe('json 类型', () => {
    it('渲染 textarea', () => {
      const wrapper = mountField(
        { key: 'params', label: '参数', type: 'json' },
        ['a', 'b'],
      );
      expect(wrapper.find('textarea').exists()).toBe(true);
      expect(wrapper.find('textarea').element.value).toContain('a');
    });

    it('输入合法 JSON 时 emit 解析结果', async () => {
      const wrapper = mountField(
        { key: 'params', label: '参数', type: 'json' },
        null,
      );
      const textarea = wrapper.find('textarea');
      await textarea.setValue('["x", "y"]');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual(['x', 'y']);
    });

    it('输入非法 JSON 时不 emit，显示错误', async () => {
      const wrapper = mountField(
        { key: 'params', label: '参数', type: 'json' },
        null,
      );
      await wrapper.find('textarea').setValue('{invalid json');
      // 不应 emit
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      // 显示错误文案
      expect(wrapper.text()).toContain('JSON 错误');
    });

    it('空文本时 emit undefined', async () => {
      const wrapper = mountField(
        { key: 'params', label: '参数', type: 'json' },
        ['x'],
      );
      await wrapper.find('textarea').setValue('');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBeUndefined();
    });
  });

  // ─── count-range 类型 ───────────────────────────────
  describe('count-range 类型', () => {
    it('单值模式渲染一个 number input', () => {
      const wrapper = mountField(
        { key: 'count', label: '数量', type: 'count-range', min: 0 },
        5,
      );
      expect(wrapper.findAll('input[type="number"]')).toHaveLength(1);
    });

    it('范围模式渲染两个 number input', () => {
      const wrapper = mountField(
        { key: 'count', label: '数量', type: 'count-range', min: 0 },
        [1, 3],
      );
      expect(wrapper.findAll('input[type="number"]')).toHaveLength(2);
    });

    it('单值模式输入触发 emit', async () => {
      const wrapper = mountField(
        { key: 'count', label: '数量', type: 'count-range', min: 0 },
        1,
      );
      await wrapper.find('input[type="number"]').setValue('5');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe(5);
    });

    it('勾选"范围"复选框切换为范围模式', async () => {
      const wrapper = mountField(
        { key: 'count', label: '数量', type: 'count-range', min: 0 },
        5,
      );
      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([5, 5]);
    });
  });

  // ─── string-list 类型 ───────────────────────────────
  describe('string-list 类型', () => {
    it('渲染多个文本输入框', () => {
      const wrapper = mountField(
        { key: 'mods', label: '修正来源', type: 'string-list' },
        ['a', 'b'],
      );
      expect(wrapper.findAll('input[type="text"]')).toHaveLength(2);
    });

    it('添加按钮触发 emit 新增空字符串', async () => {
      const wrapper = mountField(
        { key: 'mods', label: '修正来源', type: 'string-list' },
        ['a'],
      );
      const buttons = wrapper.findAll('button');
      const addButton = buttons.find((b) => b.text().includes('添加'));
      await addButton!.trigger('click');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual(['a', '']);
    });

    it('删除按钮触发 emit 移除项', async () => {
      const wrapper = mountField(
        { key: 'mods', label: '修正来源', type: 'string-list' },
        ['a', 'b'],
      );
      const buttons = wrapper.findAll('button');
      const removeButton = buttons.find((b) => b.text().includes('×'));
      await removeButton!.trigger('click');
      expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual(['b']);
    });
  });

  // ─── kv-list 类型 ───────────────────────────────────
  describe('kv-list 类型', () => {
    it('渲染键值对输入框', () => {
      const wrapper = mountField(
        { key: 'overrides', label: '覆盖', type: 'kv-list' },
        { lockpick: 'table_a' },
      );
      const inputs = wrapper.findAll('input[type="text"]');
      expect(inputs).toHaveLength(2); // key + value
    });

    it('添加按钮触发 emit 新增空键值对', async () => {
      const wrapper = mountField(
        { key: 'overrides', label: '覆盖', type: 'kv-list' },
        { a: 'b' },
      );
      const buttons = wrapper.findAll('button');
      const addButton = buttons.find((b) => b.text().includes('添加'));
      await addButton!.trigger('click');
      const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as Record<string, string>;
      expect(emitted['a']).toBe('b');
      expect(emitted['']).toBe('');
    });

    it('删除按钮触发 emit 移除键值对', async () => {
      const wrapper = mountField(
        { key: 'overrides', label: '覆盖', type: 'kv-list' },
        { a: 'b', c: 'd' },
      );
      const buttons = wrapper.findAll('button');
      const removeButton = buttons.find((b) => b.text().includes('×'));
      await removeButton!.trigger('click');
      const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as Record<string, string>;
      expect(Object.keys(emitted)).toHaveLength(1);
    });
  });

  // ─── entry-list 类型 ────────────────────────────────
  describe('entry-list 类型', () => {
    it('渲染子条目列表', () => {
      const wrapper = mountField(
        {
          key: 'event_pool',
          label: '事件池',
          type: 'entry-list',
          itemSchema: [
            { key: 'event_id', label: '事件 ID', type: 'text' },
            { key: 'weight', label: '权重', type: 'number' },
          ],
        },
        [{ event_id: 'evt1', weight: 30 }],
      );
      // 子条目应该渲染出 event_id 和 weight 两个输入框
      const inputs = wrapper.findAll('input');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    it('添加按钮触发 emit 默认条目', async () => {
      const wrapper = mountField(
        {
          key: 'event_pool',
          label: '事件池',
          type: 'entry-list',
          itemSchema: [
            { key: 'event_id', label: '事件 ID', type: 'text', default: '' },
            { key: 'weight', label: '权重', type: 'number', default: 0 },
          ],
        },
        [],
      );
      const buttons = wrapper.findAll('button');
      const addButton = buttons.find((b) => b.text().includes('添加'));
      await addButton!.trigger('click');
      const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as unknown[];
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({ event_id: '', weight: 0 });
    });

    it('删除按钮触发 emit 移除条目', async () => {
      const wrapper = mountField(
        {
          key: 'event_pool',
          label: '事件池',
          type: 'entry-list',
          itemSchema: [
            { key: 'event_id', label: '事件 ID', type: 'text' },
          ],
        },
        [{ event_id: 'a' }, { event_id: 'b' }],
      );
      const buttons = wrapper.findAll('button');
      const removeButton = buttons.find((b) => b.text().includes('×'));
      await removeButton!.trigger('click');
      const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as unknown[];
      expect(emitted).toHaveLength(1);
    });
  });

  // ─── description 显示 ───────────────────────────────
  describe('description', () => {
    it('显示帮助文案', () => {
      const wrapper = mountField(
        { key: 'x', label: 'X', type: 'text', description: '帮助文案内容' },
        '',
      );
      expect(wrapper.text()).toContain('帮助文案内容');
    });
  });
});
