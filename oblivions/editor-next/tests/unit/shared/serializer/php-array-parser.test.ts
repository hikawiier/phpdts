//
// php-array-parser 单元测试（对齐 NEW_DESIGN.md §4.1：每条规则至少 1 正例 + 1 反例）
// 覆盖目标：≥95%

import { describe, it, expect } from 'vitest';
import {
  parsePhpArray,
  migrateExitLinks,
  parseMapPhp,
  parseRegionPhp,
  extractPgroupFromFilename,
  assembleMapProject,
  isMapProjectShape,
  type PhpValue,
} from '@/shared/serializer/php-array-parser';

// ─── parsePhpArray：基础解析 ────────────────────────────────────

describe('parsePhpArray - 基础', () => {
  it('空数组返回 []', () => {
    const result = parsePhpArray('<?php return [];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });

  it('索引数组：纯数字', () => {
    const result = parsePhpArray('<?php return [1, 2, 3];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2, 3]);
  });

  it('索引数组：混合类型', () => {
    const result = parsePhpArray('<?php return [1, "hello", true, null, false];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 'hello', true, null, false]);
  });

  it('关联数组：字符串 key', () => {
    const result = parsePhpArray(`<?php return ['name' => 'A', 'age' => 18];`);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ name: 'A', age: 18 });
  });

  it('关联数组：数字字符串 key 保留为字符串（归一化层负责转 number）', () => {
    const result = parsePhpArray(`<?php return ['1' => 'a', '2' => 'b'];`);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ '1': 'a', '2': 'b' });
  });

  it('嵌套数组：关联数组内的索引数组', () => {
    const php = `<?php return ['neighbors' => [1, 2, 3]];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ neighbors: [1, 2, 3] });
  });

  it('嵌套数组：多层关联数组', () => {
    const php = `<?php return ['a' => ['b' => ['c' => 1]]];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ a: { b: { c: 1 } } });
  });

  it('尾随逗号允许', () => {
    const result = parsePhpArray('<?php return [1, 2, 3,];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2, 3]);
  });
});

// ─── parsePhpArray：值类型 ────────────────────────────────────

describe('parsePhpArray - 值类型', () => {
  it('true / false / null 大小写不敏感', () => {
    const result = parsePhpArray('<?php return [TRUE, FALSE, NULL, True, False, Null];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([true, false, null, true, false, null]);
  });

  it('整数与浮点数（含负数）', () => {
    const result = parsePhpArray('<?php return [42, -17, 3.14, -2.5, 0];');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([42, -17, 3.14, -2.5, 0]);
  });

  it('单引号字符串：\' 与 \\\\ 转义', () => {
    const result = parsePhpArray(`<?php return ['it\\'s a \\\\ test'];`);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["it's a \\ test"]);
  });

  it('双引号字符串：" 与 \\\\ 转义', () => {
    const result = parsePhpArray(`<?php return ["say \\"hi\\\\"  ];`);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(['say "hi\\']);
  });

  it('字符串中的括号不破坏匹配', () => {
    const php = `<?php return ['desc' => 'array [bracket] inside'];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect((result.value as { desc: string }).desc).toBe('array [bracket] inside');
  });
});

// ─── parsePhpArray：注释处理 ────────────────────────────────────

describe('parsePhpArray - 注释', () => {
  it('单行注释 // 被跳过', () => {
    const php = `<?php
      // 这是注释
      return [1, 2];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2]);
  });

  it('多行注释 /* */ 被跳过', () => {
    const php = `<?php
      /* 多行
         注释 */
      return [1, 2];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2]);
  });

  it('字符串中的 // 不被识别为注释', () => {
    const php = `<?php return ['url' => 'http://example.com'];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect((result.value as { url: string }).url).toBe('http://example.com');
  });

  it('字符串中的 /* 不被识别为注释', () => {
    const php = `<?php return ['regex' => 'a/*b'];`;
    const result = parsePhpArray(php);
    expect(result.ok).toBe(true);
    expect((result.value as { regex: string }).regex).toBe('a/*b');
  });
});

// ─── parsePhpArray：错误路径 ───────────────────────────────────

describe('parsePhpArray - 错误路径', () => {
  it('无 return 语句返回 ok=false', () => {
    const result = parsePhpArray('<?php echo "hi";');
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error?.message).toMatch(/return/);
  });

  it('return 后无 [ 返回 ok=false', () => {
    const result = parsePhpArray('<?php return 42;');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/\[/);
  });

  it('未闭合的 [ 返回 ok=false 含 line/column/expected', () => {
    const result = parsePhpArray("<?php return [1, 2,");
    expect(result.ok).toBe(false);
    expect(result.error?.line).toBeGreaterThan(0);
    expect(result.error?.column).toBeGreaterThan(0);
    expect(result.error?.expected).toBe(']');
  });

  it('字符串中含 ] 不被误判为闭合', () => {
    const result = parsePhpArray(`<?php return ['x' => 'end];'];`);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ x: 'end];' });
  });
});

// ─── migrateExitLinks：旧格式迁移 ──────────────────────────────

describe('migrateExitLinks - 旧 exit_links 格式迁移', () => {
  it('旧格式：裸 pgroup 数字数组 → 对象数组（from_pls/to_pls 为 null）', () => {
    const result = migrateExitLinks([1, 2, 3]);
    expect(result).toEqual([
      { from_pls: null, to_pgroup: 1, to_pls: null },
      { from_pls: null, to_pgroup: 2, to_pls: null },
      { from_pls: null, to_pgroup: 3, to_pls: null },
    ]);
  });

  it('旧格式：字符串数字 → 对象数组', () => {
    const result = migrateExitLinks(['1', '5']);
    expect(result).toEqual([
      { from_pls: null, to_pgroup: 1, to_pls: null },
      { from_pls: null, to_pgroup: 5, to_pls: null },
    ]);
  });

  it('新格式：对象数组原样保留（字段类型守护）', () => {
    const input = [
      { from_pls: 5, to_pgroup: 2, to_pls: 10 },
      { from_pls: null, to_pgroup: 3, to_pls: null },
    ];
    const result = migrateExitLinks(input);
    expect(result).toEqual(input);
  });

  it('新格式：字符串数字自动转 number', () => {
    const result = migrateExitLinks([
      { from_pls: '5', to_pgroup: '2', to_pls: '10' },
    ]);
    expect(result).toEqual([{ from_pls: 5, to_pgroup: 2, to_pls: 10 }]);
  });

  it('混合格式：数字 + 对象共同迁移', () => {
    const result = migrateExitLinks([1, { from_pls: 2, to_pgroup: 3, to_pls: 4 }]);
    expect(result).toEqual([
      { from_pls: null, to_pgroup: 1, to_pls: null },
      { from_pls: 2, to_pgroup: 3, to_pls: 4 },
    ]);
  });

  it('非数组输入返回空数组', () => {
    expect(migrateExitLinks(null)).toEqual([]);
    expect(migrateExitLinks(undefined)).toEqual([]);
    expect(migrateExitLinks({})).toEqual([]);
    expect(migrateExitLinks('not array')).toEqual([]);
  });

  it('未知格式元素返回 placeholder（保持索引一致）', () => {
    const result = migrateExitLinks([1, 'unknown', 3]);
    expect(result).toHaveLength(3);
    expect(result[0]?.to_pgroup).toBe(1);
    expect(result[1]?.to_pgroup).toBe(0); // placeholder
    expect(result[2]?.to_pgroup).toBe(3);
  });

  it('无效 to_pgroup 字段回退为 0', () => {
    const result = migrateExitLinks([{ from_pls: 1, to_pls: 2 }] as unknown as Parameters<typeof migrateExitLinks>[0]);
    expect(result[0]?.to_pgroup).toBe(0);
    expect(result[0]?.from_pls).toBe(1);
    expect(result[0]?.to_pls).toBe(2);
  });
});

// ─── parseMapPhp：map.php 解析 ────────────────────────────────

describe('parseMapPhp - map.php 解析', () => {
  it('解析完整 map.php 并归一化 pgroup 为 number key', () => {
    const php = `<?php
      return [
        'regions' => [
          1 => ['name' => 'A', 'cols' => 8, 'rows' => 6, 'exit_links' => [2]],
          2 => ['name' => 'B', 'cols' => 4, 'rows' => 4, 'exit_links' => [1]],
        ],
        'grids' => [
          1 => ['cols' => 8, 'rows' => 6],
          2 => ['cols' => 4, 'rows' => 4],
        ],
      ];`;
    const result = parseMapPhp(php);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.regions)).toEqual(['1', '2']);
    expect(result!.regions[1]?.name).toBe('A');
    expect(result!.regions[1]?.cols).toBe(8);
    expect(result!.regions[2]?.exit_links).toEqual([
      { from_pls: null, to_pgroup: 1, to_pls: null },
    ]);
    expect(result!.grids[1]).toEqual({ cols: 8, rows: 6 });
    expect(result!.tiles).toEqual({});
  });

  it('解析失败返回 null', () => {
    expect(parseMapPhp('<?php echo "no return";')).toBeNull();
    expect(parseMapPhp('<?php return 42;')).toBeNull();
    expect(parseMapPhp('<?php return [];')).not.toBeNull(); // 空对象也算成功
  });

  it('字段缺失使用默认值', () => {
    const php = `<?php return ['regions' => [1 => []], 'grids' => [1 => []]];`;
    const result = parseMapPhp(php);
    expect(result!.regions[1]?.name).toBe('');
    expect(result!.regions[1]?.cols).toBe(0);
    expect(result!.regions[1]?.exit_pls).toBeNull();
    expect(result!.regions[1]?.exit_links).toEqual([]);
  });

  it('exit_links 旧格式自动迁移', () => {
    const php = `<?php return [
      'regions' => [1 => ['exit_links' => [2, 3]]],
      'grids' => [1 => ['cols' => 1, 'rows' => 1]],
    ];`;
    const result = parseMapPhp(php);
    expect(result!.regions[1]?.exit_links).toEqual([
      { from_pls: null, to_pgroup: 2, to_pls: null },
      { from_pls: null, to_pgroup: 3, to_pls: null },
    ]);
  });
});

// ─── parseRegionPhp：region_*.php 解析 ────────────────────────

describe('parseRegionPhp - region_*.php 解析', () => {
  it('解析 region 文件并归一化 pls 为 number key', () => {
    const php = `<?php return [
      1 => ['name' => 'tile1', 'x' => 0, 'y' => 0, 'neighbors' => [2], '_breaks' => [3]],
      2 => ['name' => 'tile2', 'x' => 1, 'y' => 0, 'neighbors' => [1]],
    ];`;
    const result = parseRegionPhp(php, 1);
    expect(result).not.toBeNull();
    expect(result!.pgroup).toBe(1);
    expect(Object.keys(result!.tiles)).toEqual(['1', '2']);
    expect(result!.tiles[1]?.name).toBe('tile1');
    expect(result!.tiles[1]?._breaks).toEqual([3]); // 导入时保留
    expect(result!.tiles[1]?.neighbors).toEqual([2]);
  });

  it('字段缺失使用默认值（floor/tide/passable 等）', () => {
    const php = `<?php return [1 => ['x' => 0, 'y' => 0]];`;
    const result = parseRegionPhp(php, 1);
    expect(result!.tiles[1]?.floor).toBe('standard');
    expect(result!.tiles[1]?.tide).toBe('shallow');
    expect(result!.tiles[1]?.passable).toBe(true);
    expect(result!.tiles[1]?.destructible).toBe(false);
    expect(result!.tiles[1]?.preset_safe).toBe(false);
    expect(result!.tiles[1]?.height).toBe(0);
  });

  it('解析失败返回 null', () => {
    expect(parseRegionPhp('<?php echo "x";', 1)).toBeNull();
  });

  it('非数字 key 被忽略（仅接受数字 pls）', () => {
    const php = `<?php return [
      1 => ['x' => 0, 'y' => 0],
      'invalid' => ['x' => 0, 'y' => 0],
    ];`;
    const result = parseRegionPhp(php, 1);
    expect(Object.keys(result!.tiles)).toEqual(['1']);
  });

  it('neighbors 非数字元素被过滤', () => {
    const php = `<?php return [1 => ['neighbors' => [1, 'x', 2, null, 3]]];`;
    const result = parseRegionPhp(php, 1);
    expect(result!.tiles[1]?.neighbors).toEqual([1, 2, 3]);
  });
});

// ─── extractPgroupFromFilename ─────────────────────────────────

describe('extractPgroupFromFilename', () => {
  it('region_1.php → 1', () => {
    expect(extractPgroupFromFilename('region_1.php')).toBe(1);
  });

  it('tiles/region_42.php → 42', () => {
    expect(extractPgroupFromFilename('tiles/region_42.php')).toBe(42);
  });

  it('region_255.php → 255（最大 pgroup）', () => {
    expect(extractPgroupFromFilename('region_255.php')).toBe(255);
  });

  it('无数字返回 null', () => {
    expect(extractPgroupFromFilename('map.php')).toBeNull();
    expect(extractPgroupFromFilename('region_.php')).toBeNull();
  });

  it('非 region_ 前缀返回 null', () => {
    expect(extractPgroupFromFilename('area_1.php')).toBeNull();
  });
});

// ─── assembleMapProject ────────────────────────────────────────

describe('assembleMapProject', () => {
  it('合并 map + regionResults 为完整 MapProject', () => {
    const map = {
      regions: { 1: { name: 'A', cols: 1, rows: 1 } },
      grids: { 1: { cols: 1, rows: 1 } },
      tiles: {} as Record<number, Record<number, unknown>>,
    } as unknown as Parameters<typeof assembleMapProject>[0];
    const regionResults = [
      { pgroup: 1, tiles: { 1: { name: 't1', x: 0, y: 0 } } },
    ] as unknown as Parameters<typeof assembleMapProject>[1];
    const result = assembleMapProject(map, regionResults);
    expect(result.tiles[1]).toBeDefined();
    expect(result.tiles[1]![1]?.name).toBe('t1');
  });

  it('缺失 tiles 的 region 自动填充空对象', () => {
    const map = {
      regions: { 1: { name: 'A' }, 2: { name: 'B' } },
      grids: { 1: { cols: 1, rows: 1 }, 2: { cols: 1, rows: 1 } },
      tiles: {} as Record<number, Record<number, unknown>>,
    } as unknown as Parameters<typeof assembleMapProject>[0];
    const regionResults = [{ pgroup: 1, tiles: {} }] as unknown as Parameters<typeof assembleMapProject>[1];
    const result = assembleMapProject(map, regionResults);
    expect(result.tiles[1]).toEqual({});
    expect(result.tiles[2]).toEqual({}); // 缺失 region 填充
  });
});

// ─── isMapProjectShape ─────────────────────────────────────────

describe('isMapProjectShape', () => {
  it('含 regions + grids 视为 MapProject 形状', () => {
    expect(isMapProjectShape({ regions: {}, grids: {} })).toBe(true);
    expect(isMapProjectShape({ regions: {}, grids: {}, tiles: {} })).toBe(true);
  });

  it('缺 regions / grids 返回 false', () => {
    expect(isMapProjectShape({})).toBe(false);
    expect(isMapProjectShape({ regions: {} })).toBe(false);
    expect(isMapProjectShape({ grids: {} })).toBe(false);
  });

  it('非对象返回 false', () => {
    expect(isMapProjectShape(null)).toBe(false);
    expect(isMapProjectShape(undefined)).toBe(false);
    expect(isMapProjectShape(42)).toBe(false);
    expect(isMapProjectShape('str')).toBe(false);
    expect(isMapProjectShape([1, 2])).toBe(false);
  });
});

// ─── 综合场景：注释 + 嵌套 + 迁移 ─────────────────────────────

describe('parsePhpArray - 综合场景', () => {
  it('完整 gamedata 风格 map.php 解析（含注释 + 嵌套 + 旧 exit_links）', () => {
    const php = `<?php
      if (!defined('IN_GAME')) { exit('Access Denied'); }
      // @module E 游戏逻辑
      return [
        // 区域元数据
        'regions' => [
          1 => [
            'name' => '起始区域',
            'desc' => '玩家出生地',
            'cols' => 8,
            'rows' => 6,
            'exit_links' => [2, 3], /* 旧格式 */
          ],
        ],
        'grids' => [
          1 => ['cols' => 8, 'rows' => 6],
        ],
      ];`;
    const result = parseMapPhp(php);
    expect(result).not.toBeNull();
    expect(result!.regions[1]?.name).toBe('起始区域');
    expect(result!.regions[1]?.desc).toBe('玩家出生地');
    expect(result!.regions[1]?.exit_links).toHaveLength(2);
    expect(result!.regions[1]?.exit_links[0]).toEqual({
      from_pls: null,
      to_pgroup: 2,
      to_pls: null,
    });
  });

  it('大数组解析不阻塞（5000 个元素）', () => {
    const items = Array.from({ length: 5000 }, (_, i) => i);
    const php = `<?php return [${items.join(', ')}];`;
    const start = Date.now();
    const result = parsePhpArray(php);
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(true);
    expect((result.value as number[]).length).toBe(5000);
    // 性能保护：5000 个数字解析应 < 500ms
    expect(elapsed).toBeLessThan(500);
  });

  it('PhpValue 类型可用（编译时类型守护）', () => {
    const result = parsePhpArray('<?php return [1, "x", true, null];');
    if (result.ok && result.value) {
      const value = result.value as PhpValue;
      expect(Array.isArray(value)).toBe(true);
    }
  });
});
