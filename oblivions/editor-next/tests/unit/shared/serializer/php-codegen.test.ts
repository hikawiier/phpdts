//
// php-codegen 单元测试（对齐 NEW_DESIGN.md §4.1：每条规则至少 1 正例 + 1 反例）
// 覆盖目标：≥95%

import { describe, it, expect } from 'vitest';
import {
  generateMapPhp,
  generateRegionPhp,
  generateConfigPhp,
  stripEditorFields,
  valueToPhp,
  generateProjectFiles,
} from '@/shared/serializer/php-codegen';
import { parsePhpArray } from '@/shared/serializer/php-array-parser';
import type { Tile, Region, Grid, MapProject, Pgroup, Pls } from '@/shared/types/map';

// ─── PHP 文件头：@module E 游戏逻辑 标签 ─────────────────────

describe('PHP 文件头', () => {
  it('generateMapPhp 含 IN_GAME 守卫 + @module E 游戏逻辑 标签', () => {
    const php = generateMapPhp({}, {});
    expect(php).toContain("<?php\nif (!defined('IN_GAME')) { exit('Access Denied'); }");
    expect(php).toContain('// @module E 游戏逻辑');
    expect(php).toContain('return [');
    expect(php).toMatch(/'regions' =>/);
    expect(php).toMatch(/'grids' =>/);
  });

  it('generateRegionPhp 含文件头 + @module E 标签', () => {
    const php = generateRegionPhp(1, {});
    expect(php).toContain("// @module E 游戏逻辑");
    expect(php).toContain('return [');
  });

  it('generateConfigPhp 含文件头 + 名称 + 描述', () => {
    const php = generateConfigPhp('scatter_pool', '散点池配置', []);
    expect(php).toContain('// @module E 游戏逻辑');
    expect(php).toContain('Oblivions 配置文件 — scatter_pool');
    expect(php).toContain('散点池配置');
    expect(php).toContain('return [];');
  });
});

// ─── valueToPhp：基础类型序列化 ───────────────────────────────

describe('valueToPhp - 基础类型', () => {
  it('null / undefined → null', () => {
    expect(valueToPhp(null, 0)).toBe('null');
    expect(valueToPhp(undefined, 0)).toBe('null');
  });

  it('boolean → true / false', () => {
    expect(valueToPhp(true, 0)).toBe('true');
    expect(valueToPhp(false, 0)).toBe('false');
  });

  it('number → 字符串形式', () => {
    expect(valueToPhp(42, 0)).toBe('42');
    expect(valueToPhp(-17, 0)).toBe('-17');
    expect(valueToPhp(3.14, 0)).toBe('3.14');
    expect(valueToPhp(0, 0)).toBe('0');
  });

  it('string → 单引号字符串', () => {
    expect(valueToPhp('hello', 0)).toBe("'hello'");
    expect(valueToPhp('', 0)).toBe("''");
  });

  it('字符串中的 \\ 与 \' 被转义', () => {
    expect(valueToPhp("it's", 0)).toBe("'it\\'s'");
    expect(valueToPhp('a\\b', 0)).toBe("'a\\\\b'");
    expect(valueToPhp("quote ' and backslash \\", 0)).toBe("'quote \\' and backslash \\\\'");
  });
});

// ─── valueToPhp：数组与对象 ──────────────────────────────────

describe('valueToPhp - 数组与对象', () => {
  it('空数组 → []', () => {
    expect(valueToPhp([], 0)).toBe('[]');
  });

  it('空对象 → []', () => {
    expect(valueToPhp({}, 0)).toBe('[]');
  });

  it('索引数组：4 空格缩进，逗号分隔', () => {
    const result = valueToPhp([1, 2, 3], 0);
    expect(result).toBe(`[\n    1,\n    2,\n    3\n]`);
  });

  it('关联数组：key => value 形式', () => {
    const result = valueToPhp({ name: 'A', age: 18 }, 0);
    expect(result).toBe(`[\n    'name' => 'A',\n    'age' => 18\n]`);
  });

  it('数字字符串 key 输出为数字（无引号，pgroup/pls 类型转换）', () => {
    const result = valueToPhp({ '1': 'a', '2': 'b' }, 0);
    expect(result).toBe(`[\n    1 => 'a',\n    2 => 'b'\n]`);
  });

  it('嵌套对象缩进正确', () => {
    const result = valueToPhp({ a: { b: 1 } }, 0);
    expect(result).toBe(`[\n    'a' => [\n        'b' => 1\n    ]\n]`);
  });

  it('嵌套数组缩进正确', () => {
    const result = valueToPhp({ neighbors: [1, 2] }, 0);
    expect(result).toBe(`[\n    'neighbors' => [\n        1,\n        2\n    ]\n]`);
  });

  it('多层嵌套缩进保持 4 空格递增', () => {
    const result = valueToPhp([{ a: [1] }], 0);
    expect(result).toContain('    [');
    expect(result).toContain('        \'a\' => [');
    expect(result).toContain('            1');
  });
});

// ─── stripEditorFields：_breaks 字段剥离 ─────────────────────

describe('stripEditorFields - _breaks 剥离', () => {
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

  it('剥离 tile 中的 _breaks，保留其他字段', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile({ name: 't1', _breaks: [2, 3], neighbors: [2] }),
    };
    const result = stripEditorFields(tiles);
    expect(result[1]?.name).toBe('t1');
    expect(result[1]?.neighbors).toEqual([2]);
    expect((result[1] as { _breaks?: number[] })._breaks).toBeUndefined();
  });

  it('保留 height / destructible / preset_safe 等后端字段', () => {
    const tiles: Record<Pls, Tile> = {
      1: makeTile({ height: 5, destructible: true, preset_safe: true }),
    };
    const result = stripEditorFields(tiles);
    expect(result[1]?.height).toBe(5);
    expect(result[1]?.destructible).toBe(true);
    expect(result[1]?.preset_safe).toBe(true);
  });

  it('无 _breaks 字段的 tile 不受影响', () => {
    const tiles: Record<Pls, Tile> = { 1: makeTile({ name: 'no breaks' }) };
    const result = stripEditorFields(tiles);
    expect(result[1]?.name).toBe('no breaks');
  });

  it('空 tiles 输入返回空对象', () => {
    const result = stripEditorFields({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ─── generateRegionPhp：自动剥离 _breaks ─────────────────────

describe('generateRegionPhp - 自动剥离 _breaks', () => {
  it('生成的 PHP 代码不含 _breaks 字段', () => {
    const tiles: Record<Pls, Tile> = {
      1: {
        name: 't1',
        desc: '',
        floor: 'standard',
        tide: 'shallow',
        height: 0,
        passable: true,
        destructible: false,
        neighbors: [2],
        x: 0,
        y: 0,
        preset_safe: false,
        _breaks: [3, 4],
      },
    };
    const php = generateRegionPhp(1, tiles);
    expect(php).not.toContain('_breaks');
    expect(php).toContain("'name' => 't1'");
    expect(php).toContain("'neighbors' => [");
    expect(php).toContain('4'); // height/destructible 等数字字段保留
  });

  it('空 tiles 输出空数组', () => {
    const php = generateRegionPhp(1, {});
    expect(php).toContain('return [];');
    expect(php).toContain('空区域');
  });
});

// ─── generateMapPhp：完整生成 ─────────────────────────────────

describe('generateMapPhp - 完整生成', () => {
  it('生成的 PHP 可被 parsePhpArray 解析回来', () => {
    const regions: Record<Pgroup, Region> = {
      1: {
        name: 'A',
        desc: '',
        entrance_pls: 1,
        exit_pls: null,
        next_region: 2,
        prev_region: null,
        exit_links: [{ from_pls: null, to_pgroup: 2, to_pls: null }],
        cols: 8,
        rows: 6,
      },
    };
    const grids: Record<Pgroup, Grid> = { 1: { cols: 8, rows: 6 } };
    const php = generateMapPhp(regions, grids);
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    const value = result.value as { regions: Record<string, unknown> };
    expect(value.regions['1']).toBeDefined();
  });

  it('包含数据结构注释说明', () => {
    const php = generateMapPhp({}, {});
    expect(php).toContain('Oblivions 地图数据');
    expect(php).toContain('regions[pgroup]');
    expect(php).toContain('grids[pgroup]');
  });
});

// ─── generateProjectFiles：批量生成 ──────────────────────────

describe('generateProjectFiles - 批量生成', () => {
  it('生成 map.php + tiles/region_*.php 文件映射', () => {
    const project: MapProject = {
      regions: {
        1: {
          name: 'A', desc: '', entrance_pls: null, exit_pls: null,
          next_region: null, prev_region: null, exit_links: [],
          cols: 1, rows: 1,
        },
        2: {
          name: 'B', desc: '', entrance_pls: null, exit_pls: null,
          next_region: null, prev_region: null, exit_links: [],
          cols: 1, rows: 1,
        },
      },
      grids: {
        1: { cols: 1, rows: 1 },
        2: { cols: 1, rows: 1 },
      },
      tiles: {
        1: {
          1: {
            name: 't1', desc: '', floor: 'standard', tide: 'shallow',
            height: 0, passable: true, destructible: false,
            neighbors: [], x: 0, y: 0, preset_safe: false,
          },
        },
        2: {},
      },
    };
    const files = generateProjectFiles(project);
    expect(files['map.php']).toBeDefined();
    expect(files['tiles/region_1.php']).toBeDefined();
    expect(files['tiles/region_2.php']).toBeDefined();
    expect(files['tiles/region_1.php']).toContain("'name' => 't1'");
  });

  it('生成的所有 PHP 文件都含 @module E 标签', () => {
    const project: MapProject = {
      regions: { 1: { name: 'A', desc: '', entrance_pls: null, exit_pls: null, next_region: null, prev_region: null, exit_links: [], cols: 1, rows: 1 } },
      grids: { 1: { cols: 1, rows: 1 } },
      tiles: { 1: {} },
    };
    const files = generateProjectFiles(project);
    for (const content of Object.values(files)) {
      expect(content).toContain('// @module E 游戏逻辑');
    }
  });
});

// ─── round-trip：解析 → 生成 → 解析 一致性 ──────────────────

describe('round-trip：parse → codegen → parse 一致性', () => {
  it('Tile 序列化后再解析字段一致（_breaks 被剥离）', () => {
    const original: Record<Pls, Tile> = {
      1: {
        name: 'tile',
        desc: 'desc',
        floor: 'water',
        tide: 'deep',
        height: 5,
        passable: false,
        destructible: true,
        neighbors: [2, 3],
        x: 4,
        y: 5,
        preset_safe: true,
        _breaks: [3], // 应在导出时剥离
      },
    };
    const php = generateRegionPhp(1, original);
    // 解析回来
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    const value = result.value as Record<string, Record<string, unknown>>;
    const tile = value['1'];
    expect(tile?.name).toBe('tile');
    expect(tile?.floor).toBe('water');
    expect(tile?.tide).toBe('deep');
    expect(tile?.height).toBe(5);
    expect(tile?.passable).toBe(false);
    expect(tile?.destructible).toBe(true);
    expect(tile?.preset_safe).toBe(true);
    expect(tile?.neighbors).toEqual([2, 3]);
    expect(tile?._breaks).toBeUndefined(); // _breaks 被剥离
  });

  it('Region exit_links 新格式序列化后再解析保持对象数组', () => {
    const regions: Record<Pgroup, Region> = {
      1: {
        name: 'A', desc: '', entrance_pls: null, exit_pls: null,
        next_region: null, prev_region: null,
        exit_links: [
          { from_pls: 5, to_pgroup: 2, to_pls: 10 },
          { from_pls: null, to_pgroup: 3, to_pls: null },
        ],
        cols: 1, rows: 1,
      },
    };
    const grids: Record<Pgroup, Grid> = { 1: { cols: 1, rows: 1 } };
    const php = generateMapPhp(regions, grids);
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    const value = result.value as { regions: Record<string, { exit_links: unknown[] }> };
    const exitLinks = value.regions['1']?.exit_links;
    expect(exitLinks).toHaveLength(2);
    expect(exitLinks?.[0]).toEqual({ from_pls: 5, to_pgroup: 2, to_pls: 10 });
  });
});
