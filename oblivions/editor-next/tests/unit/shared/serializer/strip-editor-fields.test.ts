//
// strip-editor-fields 单元测试（对齐 NEW_DESIGN.md §4.1）
// 覆盖目标：≥95%

import { describe, it, expect } from 'vitest';
import {
  stripEditorFields,
  stripEditorFieldsDeep,
  isEditorField,
} from '@/shared/serializer/strip-editor-fields';
import type { Tile, Pls } from '@/shared/types/map';

// ─── isEditorField ───────────────────────────────────────────

describe('isEditorField', () => {
  it('以 _ 开头返回 true', () => {
    expect(isEditorField('_breaks')).toBe(true);
    expect(isEditorField('_expanded')).toBe(true);
    expect(isEditorField('_dirty')).toBe(true);
    expect(isEditorField('_selected')).toBe(true);
    expect(isEditorField('_')).toBe(true);
  });

  it('不以 _ 开头返回 false', () => {
    expect(isEditorField('name')).toBe(false);
    expect(isEditorField('height')).toBe(false);
    expect(isEditorField('preset_safe')).toBe(false);
    expect(isEditorField('')).toBe(false);
  });
});

// ─── stripEditorFields（re-export from php-codegen） ─────────

describe('stripEditorFields - tile 级 _breaks 剥离', () => {
  function makeTile(overrides: Partial<Tile> = {}): Tile {
    return {
      name: '',
      desc: '',
      floor: 'standard',
      tide: 'shallow',
      height: 0,
      passable: true,
      destructible: false,
      neighbors: [],
      x: 0,
      y: 0,
      preset_safe: false,
      ...overrides,
    };
  }

  it('剥离 _breaks 字段，保留其他字段', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile({ _breaks: [2, 3] }),
      2: makeTile({ name: 't2' }),
    };
    const result = stripEditorFields(tiles);
    expect((result[1] as { _breaks?: number[] })._breaks).toBeUndefined();
    expect((result[2] as { _breaks?: number[] })._breaks).toBeUndefined();
    expect(result[1]?.name).toBe('');
    expect(result[2]?.name).toBe('t2');
  });

  it('空对象返回空对象', () => {
    const result = stripEditorFields({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ─── stripEditorFieldsDeep ───────────────────────────────────

describe('stripEditorFieldsDeep - 递归剥离所有 _ 开头字段', () => {
  it('剥离顶层 _ 开头字段', () => {
    const input = { name: 'A', _expanded: true, _dirty: false, value: 42 };
    const result = stripEditorFieldsDeep(input);
    expect(result).toEqual({ name: 'A', value: 42 });
  });

  it('递归剥离嵌套对象的 _ 开头字段', () => {
    const input = {
      outer: 'keep',
      _skip: 'gone',
      nested: {
        keep: 1,
        _skip: 'gone',
        deeper: { a: 1, _b: 2 },
      },
    };
    const result = stripEditorFieldsDeep(input);
    expect(result).toEqual({
      outer: 'keep',
      nested: { keep: 1, deeper: { a: 1 } },
    });
  });

  it('递归处理数组元素', () => {
    const input = {
      items: [
        { name: 'a', _selected: true },
        { name: 'b', _selected: false },
      ],
    };
    const result = stripEditorFieldsDeep(input);
    expect(result).toEqual({
      items: [{ name: 'a' }, { name: 'b' }],
    });
  });

  it('空数组返回空数组', () => {
    const result = stripEditorFieldsDeep([]);
    expect(result).toEqual([]);
  });

  it('空对象返回空对象', () => {
    const result = stripEditorFieldsDeep({});
    expect(result).toEqual({});
  });

  it('null / undefined 原样返回', () => {
    expect(stripEditorFieldsDeep(null)).toBeNull();
    expect(stripEditorFieldsDeep(undefined)).toBeUndefined();
  });

  it('原始类型原样返回', () => {
    expect(stripEditorFieldsDeep(42)).toBe(42);
    expect(stripEditorFieldsDeep('hello')).toBe('hello');
    expect(stripEditorFieldsDeep(true)).toBe(true);
  });

  it('混合嵌套结构（数组 + 对象 + 多层 _ 字段）', () => {
    const input = {
      _top: 'gone',
      keep: 'top',
      list: [
        { _a: 1, b: 2, nested: { _c: 3, d: 4 } },
        { e: 5 },
      ],
      obj: { _f: 6, g: 7 },
    };
    const result = stripEditorFieldsDeep(input);
    expect(result).toEqual({
      keep: 'top',
      list: [{ b: 2, nested: { d: 4 } }, { e: 5 }],
      obj: { g: 7 },
    });
  });

  it('配置文件场景：scatter_pool 嵌套结构', () => {
    const scatterPool = {
      _version: '1.0',
      pools: {
        1: {
          name: 'pool1',
          _expanded: true,
          items: [
            { id: 1, weight: 10, _dirty: true },
            { id: 2, weight: 5 },
          ],
        },
      },
    };
    const result = stripEditorFieldsDeep(scatterPool);
    expect(result).toEqual({
      pools: {
        1: {
          name: 'pool1',
          items: [{ id: 1, weight: 10 }, { id: 2, weight: 5 }],
        },
      },
    });
  });

  it('泛型保留：T 类型推断正确（编译时类型守护）', () => {
    interface MyType {
      name: string;
      _internal?: boolean;
    }
    const input: MyType = { name: 'A', _internal: true };
    const result: MyType = stripEditorFieldsDeep(input);
    expect(result.name).toBe('A');
    expect(result._internal).toBeUndefined();
  });
});
