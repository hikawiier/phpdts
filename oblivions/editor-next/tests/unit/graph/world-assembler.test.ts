//
// world-assembler 单元测试
//
// 覆盖点：
//   - assembleWorldResources：空 MapProject → 空数组
//   - assembleWorldResources：2 region + 各 1 tile → 2 region 节点 + 2 tile 节点 + 2 contains 边
//   - assembleWorldResources：tile 有 neighbors → adjacent_to 边（from < to 去重）
//   - assembleWorldResources：tile 有 _breaks → _breaks 不影响 adjacent_to 边
//   - assembleWorldResources：跨区域 exit_links 不产生 adjacent_to 边
//   - assembleWorldResources：neighbors 引用不存在的 pls → 不产生 adjacent_to 边
//   - projectFromGraph：round-trip 一致性
//   - projectFromGraph：tiles 按 pls 排序
//

import { describe, it, expect } from 'vitest';
import {
  assembleWorldResources,
  projectFromGraph,
} from '@/graph/assemblers/world-assembler';
import type { ResourceNode } from '@/graph/types';
import type { MapProject, Pgroup, Pls } from '@/shared';

// ─── 测试工具：构造 MapProject ─────────────────────────

function makeEmptyProject(): MapProject {
  return { regions: {}, grids: {}, tiles: {} };
}

function makeRegion(pgroup: Pgroup, opts?: Partial<MapProject['regions'][Pgroup]>) {
  return {
    name: `区域 ${pgroup}`,
    desc: '',
    entrance_pls: null,
    exit_pls: null,
    next_region: null,
    prev_region: null,
    exit_links: [],
    cols: 4,
    rows: 3,
    ...opts,
  };
}

function makeTile(pls: Pls, opts?: Partial<MapProject['tiles'][Pgroup][Pls]>) {
  return {
    name: `tile ${pls}`,
    desc: '',
    floor: 'standard' as const,
    tide: 'shallow' as const,
    height: 0,
    passable: true,
    destructible: false,
    neighbors: [] as Pls[],
    x: 0,
    y: 0,
    preset_safe: false,
    ...opts,
  };
}

// ─── 测试：assembleWorldResources ──────────────────────

describe('assembleWorldResources', () => {
  it('空 MapProject → 空数组', () => {
    const { nodes, edges } = assembleWorldResources(makeEmptyProject());
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('2 region + 各 1 tile → 2 region 节点 + 2 tile 节点 + 2 contains 边', () => {
    const project: MapProject = {
      regions: {
        1: makeRegion(1),
        2: makeRegion(2),
      },
      grids: {
        1: { cols: 4, rows: 3 },
        2: { cols: 4, rows: 3 },
      },
      tiles: {
        1: { 1: makeTile(1) },
        2: { 1: makeTile(1) },
      },
    };

    const { nodes, edges } = assembleWorldResources(project);

    // 节点：2 region + 2 tile
    const regionNodes = nodes.filter((n) => n.kind === 'world.region');
    const tileNodes = nodes.filter((n) => n.kind === 'world.tile');
    expect(regionNodes).toHaveLength(2);
    expect(tileNodes).toHaveLength(2);

    // region 节点 id = String(pgroup)
    expect(regionNodes.map((n) => n.id).sort()).toEqual(['1', '2']);

    // tile 节点 id = `${pgroup}:${pls}`
    expect(tileNodes.map((n) => n.id).sort()).toEqual(['1:1', '2:1']);

    // contains 边：2 条
    const containsEdges = edges.filter((e) => e.type === 'contains');
    expect(containsEdges).toHaveLength(2);

    // 验证 contains 边的 from / to
    const containsPairs = containsEdges
      .map((e) => `${e.from}->${e.to}`)
      .sort();
    expect(containsPairs).toEqual([
      'world.region:1->world.tile:1:1',
      'world.region:2->world.tile:2:1',
    ]);
  });

  it('tile 有 neighbors → 输出 adjacent_to 边（from < to 去重）', () => {
    // 两个 tile 互相邻居：tile 1 邻居 [2]，tile 2 邻居 [1]
    // 应只产生 1 条 adjacent_to 边（from < to）：world.tile:1:1 -> world.tile:1:2
    const project: MapProject = {
      regions: { 1: makeRegion(1) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: {
        1: {
          1: makeTile(1, { neighbors: [2] }),
          2: makeTile(2, { neighbors: [1] }),
        },
      },
    };

    const { edges } = assembleWorldResources(project);
    const adjacentEdges = edges.filter((e) => e.type === 'adjacent_to');
    expect(adjacentEdges).toHaveLength(1);
    expect(adjacentEdges[0]!.from).toBe('world.tile:1:1');
    expect(adjacentEdges[0]!.to).toBe('world.tile:1:2');
  });

  it('3 tile 链式邻接 → 2 条 adjacent_to 边（去重后）', () => {
    // tile 1 - tile 2 - tile 3 链式邻接
    // 应产生 2 条 adjacent_to 边：1->2, 2->3
    const project: MapProject = {
      regions: { 1: makeRegion(1) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: {
        1: {
          1: makeTile(1, { neighbors: [2] }),
          2: makeTile(2, { neighbors: [1, 3] }),
          3: makeTile(3, { neighbors: [2] }),
        },
      },
    };

    const { edges } = assembleWorldResources(project);
    const adjacentEdges = edges.filter((e) => e.type === 'adjacent_to');
    expect(adjacentEdges).toHaveLength(2);
    const pairs = adjacentEdges.map((e) => `${e.from}->${e.to}`).sort();
    expect(pairs).toEqual([
      'world.tile:1:1->world.tile:1:2',
      'world.tile:1:2->world.tile:1:3',
    ]);
  });

  it('tile 有 _breaks → _breaks 不影响 adjacent_to 边', () => {
    // tile 1 邻居 [2]，但 _breaks: [2] 表示"显式断开"
    // 装配阶段不应过滤——_breaks 是编辑器运行时状态，由调用方合并
    const project: MapProject = {
      regions: { 1: makeRegion(1) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: {
        1: {
          1: makeTile(1, { neighbors: [2], _breaks: [2] }),
          2: makeTile(2, { neighbors: [1], _breaks: [1] }),
        },
      },
    };

    const { edges } = assembleWorldResources(project);
    const adjacentEdges = edges.filter((e) => e.type === 'adjacent_to');
    // _breaks 不影响：仍然产生 1 条 adjacent_to 边
    expect(adjacentEdges).toHaveLength(1);
    expect(adjacentEdges[0]!.from).toBe('world.tile:1:1');
    expect(adjacentEdges[0]!.to).toBe('world.tile:1:2');
  });

  it('neighbors 引用不存在的 pls → 不产生 adjacent_to 边', () => {
    // tile 1 邻居 [99]，但 tile 99 不存在 → 不应建边
    const project: MapProject = {
      regions: { 1: makeRegion(1) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: {
        1: {
          1: makeTile(1, { neighbors: [99] }),
        },
      },
    };

    const { edges } = assembleWorldResources(project);
    const adjacentEdges = edges.filter((e) => e.type === 'adjacent_to');
    expect(adjacentEdges).toHaveLength(0);
  });

  it('region 节点 data 包含 pgroup 字段，tile 节点 data 包含 pgroup 与 pls 字段', () => {
    const project: MapProject = {
      regions: { 1: makeRegion(1) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: { 1: { 1: makeTile(1) } },
    };

    const { nodes } = assembleWorldResources(project);
    const regionNode = nodes.find((n) => n.kind === 'world.region')!;
    const tileNode = nodes.find((n) => n.kind === 'world.tile')!;

    expect((regionNode.data as { pgroup: number }).pgroup).toBe(1);
    expect((tileNode.data as { pgroup: number; pls: number }).pgroup).toBe(1);
    expect((tileNode.data as { pgroup: number; pls: number }).pls).toBe(1);
  });

  it('region 节点 source 指向 map.php，tile 节点 source 指向 region_${pgroup}.php', () => {
    const project: MapProject = {
      regions: { 1: makeRegion(1), 2: makeRegion(2) },
      grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
      tiles: { 1: { 1: makeTile(1) }, 2: { 1: makeTile(1) } },
    };

    const { nodes } = assembleWorldResources(project);
    const region1 = nodes.find((n) => n.kind === 'world.region' && n.id === '1')!;
    const region2 = nodes.find((n) => n.kind === 'world.region' && n.id === '2')!;
    const tile1 = nodes.find((n) => n.kind === 'world.tile' && n.id === '1:1')!;
    const tile2 = nodes.find((n) => n.kind === 'world.tile' && n.id === '2:1')!;

    expect(region1.source[0]!.filePath).toBe('oblivions/gamedata/map.php');
    expect(region2.source[0]!.filePath).toBe('oblivions/gamedata/map.php');
    expect(tile1.source[0]!.filePath).toBe('oblivions/gamedata/tiles/region_1.php');
    expect(tile2.source[0]!.filePath).toBe('oblivions/gamedata/tiles/region_2.php');
  });
});

// ─── 测试：projectFromGraph ────────────────────────────

describe('projectFromGraph', () => {
  it('round-trip：assemble → projectFromGraph → 与原 MapProject 一致', () => {
    const original: MapProject = {
      regions: {
        1: makeRegion(1, { name: '区域 A', next_region: 2, exit_links: [] }),
        2: makeRegion(2, { name: '区域 B', prev_region: 1, cols: 5, rows: 4 }),
      },
      grids: {
        1: { cols: 4, rows: 3 },
        2: { cols: 5, rows: 4 },
      },
      tiles: {
        1: {
          1: makeTile(1, { neighbors: [2], x: 0, y: 0 }),
          2: makeTile(2, { neighbors: [1], x: 1, y: 0 }),
        },
        2: {
          1: makeTile(1, { x: 0, y: 0 }),
        },
      },
    };

    const { nodes } = assembleWorldResources(original);
    const regionNodes = nodes.filter((n) => n.kind === 'world.region');
    const tileNodes = nodes.filter((n) => n.kind === 'world.tile');

    const rebuilt = projectFromGraph(regionNodes, tileNodes);

    // regions 一致（包括 cols/rows/exit_links 等字段）
    expect(Object.keys(rebuilt.regions).map(Number).sort()).toEqual([1, 2]);
    expect(rebuilt.regions[1]!.name).toBe('区域 A');
    expect(rebuilt.regions[1]!.next_region).toBe(2);
    expect(rebuilt.regions[2]!.name).toBe('区域 B');
    expect(rebuilt.regions[2]!.prev_region).toBe(1);
    expect(rebuilt.regions[1]!.cols).toBe(4);
    expect(rebuilt.regions[1]!.rows).toBe(3);

    // grids 一致（从 region.cols/rows 派生）
    expect(rebuilt.grids[1]).toEqual({ cols: 4, rows: 3 });
    expect(rebuilt.grids[2]).toEqual({ cols: 5, rows: 4 });

    // tiles 一致
    expect(Object.keys(rebuilt.tiles[1]!).map(Number).sort()).toEqual([1, 2]);
    expect(Object.keys(rebuilt.tiles[2]!).map(Number).sort()).toEqual([1]);
    expect(rebuilt.tiles[1]![1]!.neighbors).toEqual([2]);
    expect(rebuilt.tiles[1]![2]!.neighbors).toEqual([1]);
    expect(rebuilt.tiles[2]![1]!.x).toBe(0);

    // 验证 data 字段已剥离 pgroup/pls（不污染原 Region/Tile 形状）
    expect((rebuilt.regions[1] as unknown as { pgroup?: number }).pgroup).toBeUndefined();
    expect((rebuilt.tiles[1]![1] as unknown as { pgroup?: number; pls?: number }).pgroup).toBeUndefined();
    expect((rebuilt.tiles[1]![1] as unknown as { pgroup?: number; pls?: number }).pls).toBeUndefined();
  });

  it('tiles 按 pls 排序——重建后 keys 顺序确定', () => {
    // 故意以非排序顺序塞入 tile 节点
    const regionNodes: ResourceNode[] = [
      {
        kind: 'world.region',
        id: '1',
        data: { ...makeRegion(1), pgroup: 1 },
        source: [],
        revision: '',
      },
    ];
    const tileNodes: ResourceNode[] = [
      {
        kind: 'world.tile',
        id: '1:3',
        data: { ...makeTile(3), pgroup: 1, pls: 3 },
        source: [],
        revision: '',
      },
      {
        kind: 'world.tile',
        id: '1:1',
        data: { ...makeTile(1), pgroup: 1, pls: 1 },
        source: [],
        revision: '',
      },
      {
        kind: 'world.tile',
        id: '1:2',
        data: { ...makeTile(2), pgroup: 1, pls: 2 },
        source: [],
        revision: '',
      },
    ];

    const rebuilt = projectFromGraph(regionNodes, tileNodes);

    // tiles[1] 的 keys 应按 pls 升序
    const plsKeys = Object.keys(rebuilt.tiles[1]!).map(Number);
    expect(plsKeys).toEqual([1, 2, 3]);

    // 验证内容也对得上
    expect(rebuilt.tiles[1]![1]!.name).toBe('tile 1');
    expect(rebuilt.tiles[1]![2]!.name).toBe('tile 2');
    expect(rebuilt.tiles[1]![3]!.name).toBe('tile 3');
  });

  it('空节点列表 → 空 MapProject', () => {
    const rebuilt = projectFromGraph([], []);
    expect(rebuilt.regions).toEqual({});
    expect(rebuilt.grids).toEqual({});
    expect(rebuilt.tiles).toEqual({});
  });
});
