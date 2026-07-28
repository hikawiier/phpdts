//
// php-adapter 单元测试——O-4 §4.3 写路径
//
// 覆盖点：
//   - serializePhpResource：空 nodes → 空数组
//   - serializePhpResource：world.region → 单文件 map.php
//   - serializePhpResource：world.tile 按 pgroup 分组 → 多文件 region_*.php
//   - serializePhpResource：world.tile 输出剥离 _breaks 字段
//   - serializePhpResource：config.runtime → 单文件 obl_config.php
//   - serializePhpResource：未知 kind → 空数组
//   - serializeNodes：按 kindSchema.serializer 路由到 phpAdapter
//

import { describe, it, expect } from 'vitest';
import {
  serializePhpResource,
  type SerializedPhpFile,
} from '@/adapters/php-adapter';
import { serializeNodes } from '@/adapters/adapter-registry';
import { worldRegionSchema } from '@/schema/kinds/world-region';
import { worldTileSchema } from '@/schema/kinds/world-tile';
import { configRuntimeSchema } from '@/schema/kinds/config-runtime';
import type { ResourceNode } from '@/graph/types';
import type { WorldRegionData, WorldTileData } from '@/graph/assemblers/world-assembler';
import type { Tile, Region } from '@/shared/types/map';

// ─── 测试工具：构造 ResourceNode ─────────────────────────

function makeRegionNode(pgroup: number, region: Partial<Region>): ResourceNode<WorldRegionData> {
  return {
    kind: 'world.region',
    id: String(pgroup),
    data: {
      name: region.name ?? `区域 ${pgroup}`,
      desc: region.desc ?? '',
      entrance_pls: region.entrance_pls ?? null,
      exit_pls: region.exit_pls ?? null,
      next_region: region.next_region ?? null,
      prev_region: region.prev_region ?? null,
      exit_links: region.exit_links ?? [],
      cols: region.cols ?? 4,
      rows: region.rows ?? 3,
      pgroup,
    },
    source: [],
    revision: '',
  };
}

function makeTileNode(
  pgroup: number,
  pls: number,
  tile: Partial<Tile> = {},
): ResourceNode<WorldTileData> {
  return {
    kind: 'world.tile',
    id: `${pgroup}:${pls}`,
    data: {
      name: tile.name ?? `tile ${pls}`,
      desc: tile.desc ?? '',
      floor: tile.floor ?? 'standard',
      tide: tile.tide ?? 'shallow',
      height: tile.height ?? 0,
      passable: tile.passable ?? true,
      destructible: tile.destructible ?? false,
      neighbors: tile.neighbors ?? [],
      x: tile.x ?? 0,
      y: tile.y ?? 0,
      preset_safe: tile.preset_safe ?? false,
      _breaks: tile._breaks ?? [],
      pgroup,
      pls,
    },
    source: [],
    revision: '',
  };
}

function makeConfigNode(entries: Record<string, unknown>): ResourceNode<{ entries: Record<string, unknown> }> {
  return {
    kind: 'config.runtime',
    id: 'obl_config',
    data: { entries },
    source: [],
    revision: '',
  };
}

// ─── 测试：serializePhpResource ─────────────────────────

describe('serializePhpResource', () => {
  it('空 nodes → 空数组', () => {
    expect(serializePhpResource([], worldRegionSchema)).toEqual([]);
    expect(serializePhpResource([], worldTileSchema)).toEqual([]);
    expect(serializePhpResource([], configRuntimeSchema)).toEqual([]);
  });

  it('world.region 节点 → 单文件 map.php', () => {
    const nodes = [
      makeRegionNode(1, { name: '区域 A', cols: 4, rows: 3 }),
      makeRegionNode(2, { name: '区域 B', cols: 5, rows: 4, next_region: 1 }),
    ];

    const files = serializePhpResource(nodes, worldRegionSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/map.php');

    const content = files[0]!.content;
    // 文件头
    expect(content).toContain("<?php\nif (!defined('IN_GAME')) { exit('Access Denied'); }");
    expect(content).toContain('// @module E 游戏逻辑');
    // regions + grids 顶层结构
    expect(content).toMatch(/'regions' =>/);
    expect(content).toMatch(/'grids' =>/);
    // 区域名出现
    expect(content).toContain("'区域 A'");
    expect(content).toContain("'区域 B'");
  });

  it('world.tile 节点按 pgroup 分组 → 多文件 region_*.php', () => {
    const nodes = [
      makeTileNode(1, 2),
      makeTileNode(1, 1),
      makeTileNode(2, 1),
    ];

    const files = serializePhpResource(nodes, worldTileSchema);
    expect(files).toHaveLength(2);

    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toEqual([
      'oblivions/gamedata/tiles/region_1.php',
      'oblivions/gamedata/tiles/region_2.php',
    ]);
  });

  it('world.tile 输出剥离 _breaks 字段', () => {
    const nodes = [
      makeTileNode(1, 1, { _breaks: [2] }),
      makeTileNode(1, 2, { _breaks: [1] }),
    ];

    const files = serializePhpResource(nodes, worldTileSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/tiles/region_1.php');

    // _breaks 不应出现在生成内容中
    const content = files[0]!.content;
    expect(content).not.toContain('_breaks');
  });

  it('world.tile 文件内 tiles 按 pls 升序', () => {
    // 故意以非排序顺序塞入节点
    const nodes = [
      makeTileNode(1, 3, { name: 'tile 3' }),
      makeTileNode(1, 1, { name: 'tile 1' }),
      makeTileNode(1, 2, { name: 'tile 2' }),
    ];

    const files = serializePhpResource(nodes, worldTileSchema);
    const content = files[0]!.content;

    // 验证 pls 出现顺序：1 在 2 之前，2 在 3 之前
    const idx1 = content.indexOf("'tile 1'");
    const idx2 = content.indexOf("'tile 2'");
    const idx3 = content.indexOf("'tile 3'");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it('config.runtime 节点 → 单文件 obl_config.php', () => {
    const node = makeConfigNode({
      day_length_ticks: 240,
      log_max_entries: 100,
      vision_range: 5,
    });

    const files = serializePhpResource([node], configRuntimeSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/obl_config.php');

    const content = files[0]!.content;
    // P5-2：sectionTitle 由 schema 派生为 'Oblivions 运行时配置'
    expect(content).toContain('Oblivions 运行时配置');
    expect(content).toMatch(/'day_length_ticks' =>/);
    expect(content).toMatch(/'log_max_entries' =>/);
    expect(content).toMatch(/'vision_range' =>/);
    expect(content).toContain('240');
    expect(content).toContain('100');
  });

  it('config.runtime 节点缺失 entries 字段 → 仍生成空配置文件', () => {
    // data.entries 缺失时回退到空对象
    const node: ResourceNode<unknown> = {
      kind: 'config.runtime',
      id: 'obl_config',
      data: {},
      source: [],
      revision: '',
    };

    const files = serializePhpResource([node], configRuntimeSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/obl_config.php');
    expect(files[0]!.content).toContain('return [];');
  });

  it('未知 kind → 空数组', () => {
    const fakeSchema = {
      ...worldRegionSchema,
      kind: 'unknown.kind' as const,
    };
    const nodes = [makeRegionNode(1, {})];
    expect(serializePhpResource(nodes, fakeSchema)).toEqual([]);
  });

  it('world.region 节点缺失 cols/rows → 跳过该节点但其他节点仍写入', () => {
    // 构造 cols/rows 缺失的节点（模拟装配阶段异常）
    const badNode: ResourceNode<Partial<WorldRegionData>> = {
      kind: 'world.region',
      id: '99',
      data: { name: '残缺区域', pgroup: 99 },
      source: [],
      revision: '',
    };
    const goodNode = makeRegionNode(1, { name: '正常区域' });

    const files = serializePhpResource([badNode as ResourceNode, goodNode], worldRegionSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/map.php');
    expect(files[0]!.content).toContain("'正常区域'");
  });
});

// ─── 测试：serializeNodes 路由 ─────────────────────────

describe('serializeNodes 路由', () => {
  it('按 kindSchema.serializer 路由 world.region 到 phpAdapter', () => {
    const nodes = [makeRegionNode(1, { name: '区域 A' })];
    const files = serializeNodes(nodes, worldRegionSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/map.php');
  });

  it('按 kindSchema.serializer 路由 world.tile 到 phpAdapter', () => {
    const nodes = [makeTileNode(1, 1)];
    const files = serializeNodes(nodes, worldTileSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/tiles/region_1.php');
  });

  it('按 kindSchema.serializer 路由 config.runtime 到 phpAdapter', () => {
    const nodes = [makeConfigNode({ day_length_ticks: 240 })];
    const files = serializeNodes(nodes, configRuntimeSchema);
    expect(files).toHaveLength(1);
    expect(files[0]!.filePath).toBe('oblivions/gamedata/obl_config.php');
  });

  it('未声明 serializer 时回退到 parser 注册表（兼容旧 schema）', () => {
    // 构造无 serializer 字段的 schema（模拟 P0 旧 schema）
    const legacySchema = {
      ...worldRegionSchema,
      serializer: undefined,
    };
    const nodes = [makeRegionNode(1, { name: '区域 A' })];
    const files = serializeNodes(nodes, legacySchema);
    // parser='php-array'，phpAdapter 已注册，应能正常序列化
    expect(files).toHaveLength(1);
    expect((files[0] as SerializedPhpFile).filePath).toBe('oblivions/gamedata/map.php');
  });
});
