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
  generatePhpFile,
  type PhpValue,
  type PhpCodegenOptions,
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

// ─── generatePhpFile：P5-2 新 API（按 schema projectionTargets 派生） ────────

describe('generatePhpFile - P5-2 新 API', () => {
  /** 基础 options——所有测试共享最小契约 */
  const baseOptions: PhpCodegenOptions = {
    module: 'F 物品系统',
  };

  it('生成 PHP 起始标签 + IN_GAME 守卫', () => {
    const php = generatePhpFile({}, baseOptions);
    expect(php.startsWith('<?php\n')).toBe(true);
    expect(php).toContain("if (!defined('IN_GAME')) { exit('Access Denied'); }");
  });

  it('生成 @module 块注释（来自 options.module）', () => {
    const php = generatePhpFile({}, { module: 'F 物品系统' });
    expect(php).toContain('/**');
    expect(php).toContain(' * @module F 物品系统');
    expect(php).toContain(' */');
  });

  it('主体以 return [...]; 形态输出', () => {
    const data: PhpValue = { rusty_pipe: { itmk: 'WP' } };
    const php = generatePhpFile(data, baseOptions);
    expect(php).toContain('return [');
    expect(php).toContain("'rusty_pipe' => [");
    expect(php).toMatch(/return \[.*\];\n$/s);
  });

  it('空数据输出 return [];', () => {
    const php = generatePhpFile({}, baseOptions);
    expect(php).toContain('return [];');
  });
});

// ─── generatePhpFile：AUTO-GENERATED 只读保护注释 ──────────────────

describe('generatePhpFile - AUTO-GENERATED 注释', () => {
  it('设置 autoGeneratedFrom 时生成 AUTO-GENERATED 注释', () => {
    const php = generatePhpFile(
      {},
      {
        module: 'F 物品系统',
        autoGeneratedFrom: 'oblivions/content/items/items.yaml',
      },
    );
    expect(php).toContain('// AUTO-GENERATED FROM oblivions/content/items/items.yaml');
    expect(php).toContain('// DO NOT EDIT MANUALLY - modify the source YAML and recompile');
  });

  it('未设置 autoGeneratedFrom 时不生成 AUTO-GENERATED 注释', () => {
    const php = generatePhpFile({}, { module: 'F 物品系统' });
    expect(php).not.toContain('AUTO-GENERATED');
    expect(php).not.toContain('DO NOT EDIT MANUALLY');
  });

  it('AUTO-GENERATED 注释在 PHP 起始标签之后、@module 块之前', () => {
    const php = generatePhpFile(
      {},
      {
        module: 'F 物品系统',
        autoGeneratedFrom: 'oblivions/content/items/items.yaml',
      },
    );
    const phpTagIdx = php.indexOf('<?php');
    const autoGenIdx = php.indexOf('// AUTO-GENERATED');
    const moduleIdx = php.indexOf('* @module');
    expect(phpTagIdx).toBeLessThan(autoGenIdx);
    expect(autoGenIdx).toBeLessThan(moduleIdx);
  });
});

// ─── generatePhpFile：sectionTitle 节标题块注释 ────────────────────

describe('generatePhpFile - sectionTitle 节标题', () => {
  it('设置 sectionTitle 时生成节标题块注释', () => {
    const php = generatePhpFile(
      {},
      {
        module: 'F 物品系统',
        sectionTitle: 'Oblivions 道具表',
      },
    );
    expect(php).toContain('// ================================================================');
    expect(php).toContain('// Oblivions 道具表');
  });

  it('未设置 sectionTitle 时不生成节标题块注释', () => {
    const php = generatePhpFile({}, { module: 'F 物品系统' });
    // 不应出现连续的 ===== 分隔线
    expect(php).not.toContain('// ================================================================');
  });
});

// ─── generatePhpFile：fieldOrder 字段顺序 ──────────────────────────

describe('generatePhpFile - fieldOrder 字段顺序', () => {
  it('entry 级字段按 fieldOrder 顺序输出', () => {
    // 故意用与 fieldOrder 相反的顺序提供数据
    const data: PhpValue = {
      item1: {
        tool_level: 1,
        use_effect: 'heal',
        tags: ['tag_usable'],
        stack: false,
        tier: 'common',
        desc: '',
        itmpara: '',
        itmsk: '',
        itms: '1',
        itme: 5,
        itmk: 'HH',
        itm: '道具',
      },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk', 'itme', 'itms', 'itmsk', 'itmpara', 'desc', 'tier', 'stack', 'tags', 'use_effect', 'tool_level'],
      alignmentStyle: 'compact',
    });
    // 提取 entry 内字段顺序
    const lines = php.split('\n').filter((l) => l.includes("=>"));
    const keys = lines.map((l) => {
      const m = l.match(/'(\w+)'\s*=>/);
      return m ? m[1] : null;
    }).filter(Boolean) as string[];
    // 顶层 key 'item1' 不在 fieldOrder 内（顶层 entry ID key 不应用 fieldOrder）
    // entry 级字段应按 fieldOrder 排序
    const entryFields = keys.slice(1); // 跳过 'item1'
    expect(entryFields).toEqual([
      'itm', 'itmk', 'itme', 'itms', 'itmsk', 'itmpara',
      'desc', 'tier', 'stack', 'tags', 'use_effect', 'tool_level',
    ]);
  });

  it('fieldOrder 未列出的字段按原顺序追加在末尾', () => {
    const data: PhpValue = {
      item1: {
        z_extra: 'extra value',
        itm: '道具',
        itmk: 'WP',
      },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk'],
      alignmentStyle: 'compact',
    });
    const lines = php.split('\n').filter((l) => l.includes("=>"));
    const keys = lines.map((l) => {
      const m = l.match(/'(\w+)'\s*=>/);
      return m ? m[1] : null;
    }).filter(Boolean) as string[];
    const entryFields = keys.slice(1); // 跳过 'item1'
    // itm / itmk 按 fieldOrder 顺序，z_extra 追加在末尾
    expect(entryFields).toEqual(['itm', 'itmk', 'z_extra']);
  });

  it('未设置 fieldOrder 时按对象 key 原顺序输出', () => {
    const data: PhpValue = {
      item1: { z: 1, a: 2, m: 3 },
    };
    const php = generatePhpFile(data, { module: 'F 物品系统' });
    const lines = php.split('\n').filter((l) => l.includes("=>"));
    const keys = lines.map((l) => {
      const m = l.match(/'(\w+)'\s*=>/);
      return m ? m[1] : null;
    }).filter(Boolean) as string[];
    const entryFields = keys.slice(1);
    expect(entryFields).toEqual(['z', 'a', 'm']);
  });

  it('顶层 entry ID key 不应用 fieldOrder', () => {
    const data: PhpValue = {
      z_item: { itm: 'z' },
      a_item: { itm: 'a' },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm'],
      alignmentStyle: 'compact',
    });
    // 顶层 key 顺序保持原顺序（z_item 在前，a_item 在后）
    expect(php.indexOf("'z_item' =>")).toBeLessThan(php.indexOf("'a_item' =>"));
  });
});

// ─── generatePhpFile：alignmentStyle 字段对齐 ──────────────────────

describe('generatePhpFile - alignmentStyle 对齐风格', () => {
  it("alignmentStyle='space-padded' 时 entry 级 key 用空格补齐", () => {
    const data: PhpValue = {
      item1: {
        itm: '道具',
        itmk: 'WP',
        itme: 5,
      },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk', 'itme'],
      alignmentStyle: 'space-padded',
    });
    // 'itm'  （5字符含引号）补齐到 'itmk' 长度（6字符含引号）
    // 形态："  'itm'  =>" （补 1 空格）
    expect(php).toMatch(/'itm'   =>/); // 'itm' + 3空格 =>  =  'itm'   =>
    expect(php).toMatch(/'itmk'  =>/); // 'itmk' + 2空格
    expect(php).toMatch(/'itme'  =>/);
  });

  it("alignmentStyle='compact' 时 entry 级 key 不补齐", () => {
    const data: PhpValue = {
      item1: {
        itm: '道具',
        itmk: 'WP',
      },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk'],
      alignmentStyle: 'compact',
    });
    expect(php).toMatch(/'itm' =>/);
    expect(php).toMatch(/'itmk' =>/);
  });

  it("未设置 alignmentStyle 时默认 compact（不补齐）", () => {
    const data: PhpValue = {
      item1: { itm: '道具', itmk: 'WP' },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk'],
    });
    expect(php).toMatch(/'itm' =>/);
    expect(php).toMatch(/'itmk' =>/);
  });

  it('嵌套层级不应用对齐（避免对齐扩散）', () => {
    const data: PhpValue = {
      item1: {
        tags: ['tag_a', 'tag_b'],
        itm: '道具',
      },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'tags'],
      alignmentStyle: 'space-padded',
    });
    // entry 级 'itm' 应补齐到 'tags' 长度
    // 'itm'(5) padEnd→6 + '  => '(2空格) = 3 空格
    expect(php).toMatch(/'itm'   =>/);
    // 嵌套数组元素不补齐
    expect(php).toMatch(/'tag_a',/);
  });
});

// ─── generatePhpFile：字节稳定性 ────────────────────────────────────

describe('generatePhpFile - 字节稳定性', () => {
  it('相同输入 + 相同 options 产生相同输出', () => {
    const data: PhpValue = {
      item1: { itm: '道具', itmk: 'WP', itme: 5 },
      item2: { itm: '绷带', itmk: 'HH', itme: 20 },
    };
    const options: PhpCodegenOptions = {
      module: 'F 物品系统',
      sectionTitle: 'Oblivions 道具表',
      autoGeneratedFrom: 'oblivions/content/items/items.yaml',
      fieldOrder: ['itm', 'itmk', 'itme'],
      alignmentStyle: 'space-padded',
    };
    const out1 = generatePhpFile(data, options);
    const out2 = generatePhpFile(data, options);
    expect(out1).toBe(out2);
  });

  it('对象 key 插入顺序不同但 fieldOrder 相同时输出一致', () => {
    // 故意用不同 key 顺序构造两个对象
    const data1: PhpValue = {
      item1: { itm: '道具', itmk: 'WP', itme: 5 },
    };
    const data2: PhpValue = {
      item1: { itme: 5, itmk: 'WP', itm: '道具' },
    };
    const options: PhpCodegenOptions = {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk', 'itme'],
      alignmentStyle: 'compact',
    };
    const out1 = generatePhpFile(data1, options);
    const out2 = generatePhpFile(data2, options);
    expect(out1).toBe(out2);
  });

  it('生成的 PHP 可被 parsePhpArray 解析回来', () => {
    const data: PhpValue = {
      item1: { itm: '道具', itmk: 'WP', itme: 5, tags: ['tag_a'] },
    };
    const php = generatePhpFile(data, {
      module: 'F 物品系统',
      fieldOrder: ['itm', 'itmk', 'itme', 'tags'],
      alignmentStyle: 'space-padded',
    });
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    const value = result.value as { item1: { itm: string; itmk: string; itme: number; tags: string[] } };
    expect(value.item1.itm).toBe('道具');
    expect(value.item1.itmk).toBe('WP');
    expect(value.item1.itme).toBe(5);
    expect(value.item1.tags).toEqual(['tag_a']);
  });
});
