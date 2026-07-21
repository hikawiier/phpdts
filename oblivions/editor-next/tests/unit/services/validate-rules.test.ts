//
// validate-rules 单元测试（对齐 NEW_DESIGN.md §7.3 M6：每条 RULE 至少 1 正例 + 1 反例）
//
// 覆盖点：
//   - 每个 RULE 常量：1 正例（合法数据无 issue）+ 1 反例（违反规则产生 issue）
//   - 边界：pls 范围 1-254 / pgroup 范围 1-255 / 同坐标占用冲突 / 邻居对称性去重
//   - 边界：连通性 BFS 跳过未设置 entrance_pls 的区域
//   - 边界：配置交叉引用校验需外部提供引用表，未提供时跳过此类规则
//   - runLightValidation / runFullValidation / runValidation 分发逻辑
//   - validateTile / validateRegion 单格 / 单区域实时校验
//   - summarize 统计

import { describe, it, expect } from 'vitest';
import {
  validateTilesBasic,
  validateRegionReferences,
  validateNeighbors,
  validateExitLinks,
  validateConnectivity,
  validateConfigReferences,
  runLightValidation,
  runFullValidation,
  runValidation,
  validateTile,
  validateRegion,
  summarize,
} from '@/services/validate-rules';
import { VALIDATE_RULES } from '@/shared';
import type {
  MapProject,
  Pgroup,
  Pls,
  Tile,
  Region,
  ScatterPool,
  PoiTable,
  PoiPool,
  ValidateIssue,
} from '@/shared';

// ─── 测试数据工厂 ───────────────────────────────────────────────

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
    _breaks: [],
    ...overrides,
  };
}

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    name: '',
    desc: '',
    entrance_pls: null,
    exit_pls: null,
    next_region: null,
    prev_region: null,
    exit_links: [],
    cols: 4,
    rows: 3,
    ...overrides,
  };
}

function makeEmptyProject(): MapProject {
  return { regions: {}, grids: {}, tiles: {} };
}

function makeProjectWithRegion(pgroup: Pgroup = 1): MapProject {
  return {
    regions: { [pgroup]: makeRegion({ cols: 4, rows: 3 }) },
    grids: { [pgroup]: { cols: 4, rows: 3 } },
    tiles: { [pgroup]: {} },
  };
}

/**
 * 在 project.tiles[pgroup] 中添加一个 tile，返回新 project（不修改原对象）
 */
function withTile(project: MapProject, pgroup: Pgroup, pls: Pls, tile: Tile): MapProject {
  return {
    ...project,
    tiles: {
      ...project.tiles,
      [pgroup]: { ...project.tiles[pgroup], [pls]: tile },
    },
  };
}

function findIssuesByRule(issues: readonly ValidateIssue[], rule: string): ValidateIssue[] {
  return issues.filter((i) => i.rule === rule);
}

// ─── 规则 1：validateTilesBasic ────────────────────────────────

describe('validateTilesBasic', () => {
  it('正例：合法 pgroup / pls / tide / floor / 坐标唯一 → 无 issue', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, tide: 'shallow', floor: 'standard' }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, tide: 'deep', floor: 'water' }));
    project = withTile(project, 1, 3, makeTile({ x: 2, y: 0, tide: 'abyss', floor: 'magic' }));

    const issues = validateTilesBasic(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.PLS_RANGE)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.PGROUP_RANGE)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.TIDE_INVALID)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.FLOOR_INVALID)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.OCCUPY_CONFLICT)).toHaveLength(0);
  });

  it('反例 PLS_RANGE：pls=0 与 pls=255 越界', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 0, makeTile({ x: 0, y: 0 })); // 越界
    project = withTile(project, 1, 255, makeTile({ x: 1, y: 0 })); // 越界
    project = withTile(project, 1, 1, makeTile({ x: 2, y: 0 })); // 合法

    const issues = validateTilesBasic(project);
    const plsIssues = findIssuesByRule(issues, VALIDATE_RULES.PLS_RANGE);
    expect(plsIssues.length).toBeGreaterThanOrEqual(2);
    expect(plsIssues.some((i) => i.location.pls === null)).toBe(true);
  });

  it('反例 PGROUP_RANGE：pgroup=0 与 pgroup=256 越界', () => {
    const project: MapProject = {
      regions: {
        0: makeRegion(),
        1: makeRegion(),
        256: makeRegion(),
      },
      grids: { 0: { cols: 4, rows: 3 }, 1: { cols: 4, rows: 3 }, 256: { cols: 4, rows: 3 } },
      tiles: { 0: {}, 1: {}, 256: {} },
    };

    const issues = validateTilesBasic(project);
    const pgroupIssues = findIssuesByRule(issues, VALIDATE_RULES.PGROUP_RANGE);
    expect(pgroupIssues.length).toBe(2); // pgroup=0 与 pgroup=256
    expect(pgroupIssues.every((i) => i.location.pgroup === null)).toBe(true);
  });

  it('反例 TIDE_INVALID：tide="safe" 与 tide="unknown"', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, tide: 'safe' as never }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, tide: 'unknown' as never }));

    const issues = validateTilesBasic(project);
    const tideIssues = findIssuesByRule(issues, VALIDATE_RULES.TIDE_INVALID);
    expect(tideIssues).toHaveLength(2);
    expect(tideIssues.every((i) => i.hint !== undefined)).toBe(true);
  });

  it('反例 FLOOR_INVALID：floor="grass" 非法值', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, floor: 'grass' as never }));

    const issues = validateTilesBasic(project);
    const floorIssues = findIssuesByRule(issues, VALIDATE_RULES.FLOOR_INVALID);
    expect(floorIssues).toHaveLength(1);
  });

  it('反例 OCCUPY_CONFLICT：两个 pls 同坐标 (0,0)', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    project = withTile(project, 1, 2, makeTile({ x: 0, y: 0 })); // 同坐标冲突

    const issues = validateTilesBasic(project);
    const conflictIssues = findIssuesByRule(issues, VALIDATE_RULES.OCCUPY_CONFLICT);
    expect(conflictIssues).toHaveLength(1);
    expect(conflictIssues[0]!.message).toContain('pls=1');
    expect(conflictIssues[0]!.message).toContain('pls=2');
  });
});

// ─── 规则 2：validateRegionReferences ─────────────────────────

describe('validateRegionReferences', () => {
  it('正例：next/prev 对称 + entrance/exit 指向存在的 pls → 无 error', () => {
    let project: MapProject = {
      regions: {
        1: makeRegion({ next_region: 2, prev_region: null }),
        2: makeRegion({ next_region: null, prev_region: 1 }),
      },
      grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
      tiles: { 1: {}, 2: {} },
    };
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0 }));
    project = withTile(project, 2, 1, makeTile({ x: 0, y: 0 }));
    project = withTile(project, 2, 2, makeTile({ x: 1, y: 0 }));
    // 设置 entrance/exit
    project.regions[1]!.entrance_pls = 1;
    project.regions[1]!.exit_pls = 2;
    project.regions[2]!.entrance_pls = 1;
    project.regions[2]!.exit_pls = 2;

    const issues = validateRegionReferences(project);
    // 没有 error 类 dangling / asymmetric
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NEXT_DANGLING)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_PREV_DANGLING)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NEXT_PREV_ASYMMETRIC)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_ENTRANCE_DANGLING)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_EXIT_DANGLING)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NO_ENTRANCE)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NO_EXIT)).toHaveLength(0);
  });

  it('反例 REGION_NEXT_DANGLING：next_region 指向不存在的 pgroup', () => {
    const project: MapProject = {
      regions: { 1: makeRegion({ next_region: 99 }) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: { 1: {} },
    };
    const issues = validateRegionReferences(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NEXT_DANGLING)).toHaveLength(1);
  });

  it('反例 REGION_PREV_DANGLING：prev_region 指向不存在的 pgroup', () => {
    const project: MapProject = {
      regions: { 1: makeRegion({ prev_region: 99 }) },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: { 1: {} },
    };
    const issues = validateRegionReferences(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_PREV_DANGLING)).toHaveLength(1);
  });

  it('反例 REGION_NEXT_PREV_ASYMMETRIC：A.next=B 但 B.prev != A', () => {
    const project: MapProject = {
      regions: {
        1: makeRegion({ next_region: 2, prev_region: null }),
        2: makeRegion({ next_region: null, prev_region: null }), // prev 未指向 1
      },
      grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
      tiles: { 1: {}, 2: {} },
    };
    const issues = validateRegionReferences(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NEXT_PREV_ASYMMETRIC)).toHaveLength(1);
  });

  it('反例 REGION_ENTRANCE_DANGLING：entrance_pls 指向不存在的 pls', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    project.regions[1]!.entrance_pls = 99;

    const issues = validateRegionReferences(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_ENTRANCE_DANGLING)).toHaveLength(1);
  });

  it('反例 REGION_EXIT_DANGLING：exit_pls 指向不存在的 pls', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    project.regions[1]!.exit_pls = 99;

    const issues = validateRegionReferences(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_EXIT_DANGLING)).toHaveLength(1);
  });

  it('反例 REGION_NO_ENTRANCE：未设置 entrance_pls → warning', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    // entrance_pls = null（默认）

    const issues = validateRegionReferences(project);
    const noEntrance = findIssuesByRule(issues, VALIDATE_RULES.REGION_NO_ENTRANCE);
    expect(noEntrance).toHaveLength(1);
    expect(noEntrance[0]!.severity).toBe('warning');
  });

  it('反例 REGION_NO_EXIT：未设置 exit_pls → warning', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    // exit_pls = null（默认）

    const issues = validateRegionReferences(project);
    const noExit = findIssuesByRule(issues, VALIDATE_RULES.REGION_NO_EXIT);
    expect(noExit).toHaveLength(1);
    expect(noExit[0]!.severity).toBe('warning');
  });
});

// ─── 规则 3：validateNeighbors ────────────────────────────────

describe('validateNeighbors', () => {
  it('正例：对称双向邻居 → 无 issue', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [2] }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, neighbors: [1] }));

    const issues = validateNeighbors(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.NEIGHBOR_DANGLING)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.NEIGHBOR_ASYMMETRIC)).toHaveLength(0);
  });

  it('反例 NEIGHBOR_DANGLING：A.neighbors 含 pls=2 但 pls=2 不存在', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [2] }));
    // 没有 pls=2

    const issues = validateNeighbors(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.NEIGHBOR_DANGLING)).toHaveLength(1);
  });

  it('反例 NEIGHBOR_ASYMMETRIC：A→B 但 B.neighbors 不含 A', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [2] }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, neighbors: [] })); // 不含 1

    const issues = validateNeighbors(project);
    const asymmetric = findIssuesByRule(issues, VALIDATE_RULES.NEIGHBOR_ASYMMETRIC);
    expect(asymmetric).toHaveLength(1); // 去重后只报一次
  });

  it('边界：邻居不对称去重——A→B 与 B→A 同一对只报一次', () => {
    let project = makeProjectWithRegion(1);
    // 双向都缺失对方，应只报一次（按 [min,max] 排序键去重）
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [2] }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, neighbors: [1] }));
    // 强制破坏对称：1.neighbors 含 2，2.neighbors 也含 1 → 实际是对称的
    // 改为不对称：1 含 2，2 不含 1
    project.tiles[1]![2]!.neighbors = [];

    const issues = validateNeighbors(project);
    const asymmetric = findIssuesByRule(issues, VALIDATE_RULES.NEIGHBOR_ASYMMETRIC);
    expect(asymmetric).toHaveLength(1);
  });
});

// ─── 规则 4：validateExitLinks ────────────────────────────────

describe('validateExitLinks', () => {
  it('正例：to_pgroup / from_pls / to_pls 全部存在 → 无 issue', () => {
    let project: MapProject = {
      regions: {
        1: makeRegion({ exit_links: [{ from_pls: 1, to_pgroup: 2, to_pls: 1 }] }),
        2: makeRegion(),
      },
      grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
      tiles: { 1: {}, 2: {} },
    };
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 }));
    project = withTile(project, 2, 1, makeTile({ x: 0, y: 0 }));

    const issues = validateExitLinks(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.EXIT_LINK_TO_PGROUP_DANGLING)).toHaveLength(0);
    expect(findIssuesByRule(issues, VALIDATE_RULES.EXIT_LINK_TO_PLS_DANGLING)).toHaveLength(0);
  });

  it('反例 EXIT_LINK_TO_PGROUP_DANGLING：to_pgroup 不存在', () => {
    const project: MapProject = {
      regions: {
        1: makeRegion({ exit_links: [{ from_pls: null, to_pgroup: 99, to_pls: null }] }),
      },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: { 1: {} },
    };
    const issues = validateExitLinks(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.EXIT_LINK_TO_PGROUP_DANGLING)).toHaveLength(1);
  });

  it('反例 EXIT_LINK_TO_PLS_DANGLING：from_pls 在源区域不存在', () => {
    let project: MapProject = {
      regions: {
        1: makeRegion({ exit_links: [{ from_pls: 99, to_pgroup: 2, to_pls: null }] }),
        2: makeRegion(),
      },
      grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
      tiles: { 1: {}, 2: {} },
    };
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0 })); // 只有 pls=1，没有 pls=99

    const issues = validateExitLinks(project);
    const plsIssues = findIssuesByRule(issues, VALIDATE_RULES.EXIT_LINK_TO_PLS_DANGLING);
    expect(plsIssues).toHaveLength(1);
    expect(plsIssues[0]!.message).toContain('from_pls=99');
  });

  it('反例 EXIT_LINK_TO_PLS_DANGLING：to_pls 在目标区域不存在', () => {
    let project: MapProject = {
      regions: {
        1: makeRegion({ exit_links: [{ from_pls: null, to_pgroup: 2, to_pls: 99 }] }),
        2: makeRegion(),
      },
      grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
      tiles: { 1: {}, 2: {} },
    };
    project = withTile(project, 2, 1, makeTile({ x: 0, y: 0 })); // 目标区域只有 pls=1

    const issues = validateExitLinks(project);
    const plsIssues = findIssuesByRule(issues, VALIDATE_RULES.EXIT_LINK_TO_PLS_DANGLING);
    expect(plsIssues).toHaveLength(1);
    expect(plsIssues[0]!.message).toContain('to_pls=99');
  });
});

// ─── 规则 5：validateConnectivity ─────────────────────────────

describe('validateConnectivity', () => {
  it('正例：全连通地图 → 无 issue', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [2] }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, neighbors: [1, 3] }));
    project = withTile(project, 1, 3, makeTile({ x: 2, y: 0, neighbors: [2] }));
    project.regions[1]!.entrance_pls = 1;

    const issues = validateConnectivity(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(0);
  });

  it('反例 CONNECTIVITY_ISLAND：pls=3 与 pls=1/pls=2 不连通 → warning', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [2] }));
    project = withTile(project, 1, 2, makeTile({ x: 1, y: 0, neighbors: [1] }));
    // pls=3 孤立，没有邻居
    project = withTile(project, 1, 3, makeTile({ x: 5, y: 5, neighbors: [] }));
    project.regions[1]!.entrance_pls = 1;

    const issues = validateConnectivity(project);
    const islandIssues = findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND);
    expect(islandIssues).toHaveLength(1);
    expect(islandIssues[0]!.severity).toBe('warning');
    expect(islandIssues[0]!.message).toContain('1 个不可达格');
  });

  it('边界：未设置 entrance_pls 的区域跳过连通性 BFS', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));
    // entrance_pls = null（默认）

    const issues = validateConnectivity(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(0);
  });

  it('边界：entrance_pls 指向不存在的格时跳过 BFS', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));
    project.regions[1]!.entrance_pls = 99; // 不存在

    const issues = validateConnectivity(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(0);
  });

  it('边界：空区域（无 tiles）跳过 BFS', () => {
    const project = makeProjectWithRegion(1); // tiles[1] = {}
    project.regions[1]!.entrance_pls = 1; // 即使设置了也跳过

    const issues = validateConnectivity(project);
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(0);
  });
});

// ─── 规则 6：validateConfigReferences ─────────────────────────

describe('validateConfigReferences', () => {
  function makeScatterPool(): ScatterPool {
    return {
      shallow: { initial: [{ item_id: 'scrap', count: 1, rate: 0.5 }], refresh: [] },
      deep: { initial: [], refresh: [] },
      abyss: { initial: [], refresh: [] },
    };
  }

  function makePoiTable(): PoiTable {
    return {
      supply_cache: {
        searchable: true,
        repeatable: false,
        loot_table_id: 'supply_loot',
      },
    };
  }

  function makePoiPool(): PoiPool {
    return {
      shallow: [{ poi_id: 'supply_cache', per_region: 1 }],
      deep: [],
      abyss: [],
    };
  }

  it('正例：poi_pool → poi_table 引用存在 → 无 issue', () => {
    const issues = validateConfigReferences({
      poiTable: makePoiTable(),
      poiPool: makePoiPool(),
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_POOL_REF)).toHaveLength(0);
  });

  it('反例 POI_POOL_REF：poi_id 在 poi_table 中不存在 → error', () => {
    const issues = validateConfigReferences({
      poiTable: makePoiTable(),
      poiPool: {
        shallow: [{ poi_id: 'unknown_poi', per_region: 1 }],
        deep: [],
        abyss: [],
      },
    });
    const refIssues = findIssuesByRule(issues, VALIDATE_RULES.POI_POOL_REF);
    expect(refIssues).toHaveLength(1);
    expect(refIssues[0]!.severity).toBe('error');
    expect(refIssues[0]!.message).toContain('unknown_poi');
  });

  it('正例：loot_table_id 在 lootTableIds 中 → 无 issue', () => {
    const issues = validateConfigReferences({
      poiTable: makePoiTable(),
      lootTableIds: ['supply_loot'],
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_LOOT_TABLE_REF)).toHaveLength(0);
  });

  it('反例 POI_LOOT_TABLE_REF：loot_table_id 不在 lootTableIds 中 → warning', () => {
    const issues = validateConfigReferences({
      poiTable: makePoiTable(),
      lootTableIds: ['other_loot'], // 不含 supply_loot
    });
    const lootIssues = findIssuesByRule(issues, VALIDATE_RULES.POI_LOOT_TABLE_REF);
    expect(lootIssues).toHaveLength(1);
    expect(lootIssues[0]!.severity).toBe('warning');
  });

  it('边界：未提供 lootTableIds（空数组）时跳过 POI_LOOT_TABLE_REF 校验', () => {
    const issues = validateConfigReferences({
      poiTable: makePoiTable(),
      lootTableIds: [], // 空
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_LOOT_TABLE_REF)).toHaveLength(0);
  });

  it('正例：scatter item_id 在 itemTableIds 中 → 无 issue', () => {
    const issues = validateConfigReferences({
      scatterPool: makeScatterPool(),
      itemTableIds: ['scrap'],
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.SCATTER_ITEM_REF)).toHaveLength(0);
  });

  it('反例 SCATTER_ITEM_REF：item_id 不在 itemTableIds 中 → warning', () => {
    const issues = validateConfigReferences({
      scatterPool: makeScatterPool(),
      itemTableIds: ['other_item'], // 不含 scrap
    });
    const itemIssues = findIssuesByRule(issues, VALIDATE_RULES.SCATTER_ITEM_REF);
    expect(itemIssues).toHaveLength(1);
    expect(itemIssues[0]!.severity).toBe('warning');
  });

  it('边界：未提供 itemTableIds（空数组）时跳过 SCATTER_ITEM_REF 校验', () => {
    const issues = validateConfigReferences({
      scatterPool: makeScatterPool(),
      itemTableIds: [],
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.SCATTER_ITEM_REF)).toHaveLength(0);
  });

  it('边界：scatterPool / poiTable / poiPool 任一为 null 时跳过对应规则', () => {
    const issues = validateConfigReferences({
      scatterPool: null,
      poiTable: null,
      poiPool: null,
      itemTableIds: ['x'],
      lootTableIds: ['y'],
    });
    expect(issues).toHaveLength(0); // 全部跳过
  });

  it('边界：空 poi_id 跳过（未填写）', () => {
    const issues = validateConfigReferences({
      poiTable: makePoiTable(),
      poiPool: {
        shallow: [{ poi_id: '', per_region: 1 }], // 空 poi_id
        deep: [],
        abyss: [],
      },
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_POOL_REF)).toHaveLength(0);
  });
});

// ─── 入口：runLightValidation / runFullValidation / runValidation ─

describe('runLightValidation', () => {
  it('跳过 BFS 与配置交叉引用（只跑 Light 规则集）', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));
    project = withTile(project, 1, 2, makeTile({ x: 5, y: 5, neighbors: [] })); // 孤岛
    project.regions[1]!.entrance_pls = 1;

    const issues = runLightValidation(project);
    // Light 不含 CONNECTIVITY_ISLAND
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(0);
    // Light 不含 POI_POOL_REF / POI_LOOT_TABLE_REF / SCATTER_ITEM_REF
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_POOL_REF)).toHaveLength(0);
    // 但 REGION_NO_EXIT 等仍会报（因为 entrance/exit 未设置）
    expect(findIssuesByRule(issues, VALIDATE_RULES.REGION_NO_EXIT)).toHaveLength(1);
  });

  it('空 project 不抛错且返回 issues 数组', () => {
    const issues = runLightValidation(makeEmptyProject());
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBe(0);
  });
});

describe('runFullValidation', () => {
  it('默认启用 BFS 与配置交叉引用', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));
    project = withTile(project, 1, 2, makeTile({ x: 5, y: 5, neighbors: [] })); // 孤岛
    project.regions[1]!.entrance_pls = 1;
    project.regions[1]!.exit_pls = 1;

    const issues = runFullValidation(project, {
      // 不提供 config → 跳过配置交叉引用
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(1);
  });

  it('includeConnectivity=false 跳过 BFS', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));
    project = withTile(project, 1, 2, makeTile({ x: 5, y: 5, neighbors: [] }));
    project.regions[1]!.entrance_pls = 1;
    project.regions[1]!.exit_pls = 1;

    const issues = runFullValidation(project, { includeConnectivity: false });
    expect(findIssuesByRule(issues, VALIDATE_RULES.CONNECTIVITY_ISLAND)).toHaveLength(0);
  });

  it('includeConfig=false 跳过配置交叉引用（M8 生成器调用契约）', () => {
    const project = makeProjectWithRegion(1);

    const issues = runFullValidation(project, {
      includeConfig: false,
      poiTable: { unknown: { searchable: false, repeatable: false } },
      poiPool: { shallow: [{ poi_id: 'unknown', per_region: 1 }], deep: [], abyss: [] },
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_POOL_REF)).toHaveLength(0);
  });

  it('提供 config 数据时执行配置交叉引用校验', () => {
    const project = makeProjectWithRegion(1);
    const issues = runFullValidation(project, {
      includeConfig: true,
      poiTable: { cache: { searchable: true, repeatable: false } },
      poiPool: {
        shallow: [{ poi_id: 'missing', per_region: 1 }],
        deep: [],
        abyss: [],
      },
    });
    expect(findIssuesByRule(issues, VALIDATE_RULES.POI_POOL_REF)).toHaveLength(1);
  });
});

describe('runValidation', () => {
  it('mode=light 等价 runLightValidation', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));

    const light1 = runLightValidation(project);
    const light2 = runValidation(project, 'light');
    expect(light2).toEqual(light1);
  });

  it('mode=full 等价 runFullValidation', () => {
    let project = makeProjectWithRegion(1);
    project = withTile(project, 1, 1, makeTile({ x: 0, y: 0, neighbors: [] }));
    project.regions[1]!.entrance_pls = 1;
    project.regions[1]!.exit_pls = 1;

    const full1 = runFullValidation(project);
    const full2 = runValidation(project, 'full');
    expect(full2).toEqual(full1);
  });
});

// ─── 单格 / 单区域实时校验 ────────────────────────────────────

describe('validateTile', () => {
  it('正例：合法 tile 无 issue', () => {
    const issues = validateTile(1, 1, makeTile({ tide: 'shallow', floor: 'standard' }));
    expect(issues).toHaveLength(0);
  });

  it('反例：tide 非法', () => {
    const issues = validateTile(1, 1, makeTile({ tide: 'safe' as never }));
    expect(findIssuesByRule(issues, VALIDATE_RULES.TIDE_INVALID)).toHaveLength(1);
  });

  it('反例：floor 非法', () => {
    const issues = validateTile(1, 1, makeTile({ floor: 'grass' as never }));
    expect(findIssuesByRule(issues, VALIDATE_RULES.FLOOR_INVALID)).toHaveLength(1);
  });

  it('反例：pls 越界', () => {
    const issues = validateTile(1, 0, makeTile()); // pls=0 越界
    expect(findIssuesByRule(issues, VALIDATE_RULES.PLS_RANGE)).toHaveLength(1);
  });

  it('边界：tile=null 返回空数组', () => {
    const issues = validateTile(1, 1, null);
    expect(issues).toHaveLength(0);
  });
});

describe('validateRegion', () => {
  it('正例：合法 pgroup 无 issue', () => {
    const issues = validateRegion(1, makeRegion());
    expect(issues).toHaveLength(0);
  });

  it('反例：pgroup 越界', () => {
    const issues = validateRegion(0, makeRegion());
    expect(findIssuesByRule(issues, VALIDATE_RULES.PGROUP_RANGE)).toHaveLength(1);
  });

  it('边界：region=null 返回空数组', () => {
    const issues = validateRegion(1, null);
    expect(issues).toHaveLength(0);
  });
});

// ─── summarize ────────────────────────────────────────────────

describe('summarize', () => {
  it('空 issues 数组返回零统计', () => {
    const summary = summarize([]);
    expect(summary.errors).toBe(0);
    expect(summary.warnings).toBe(0);
    expect(summary.byRule).toEqual({});
  });

  it('正确分类 error / warning + byRule 计数', () => {
    const issues: ValidateIssue[] = [
      { rule: 'pls_range', severity: 'error', message: 'a', location: {} },
      { rule: 'pls_range', severity: 'error', message: 'b', location: {} },
      { rule: 'tide_invalid', severity: 'error', message: 'c', location: {} },
      { rule: 'connectivity_island', severity: 'warning', message: 'd', location: {} },
    ];
    const summary = summarize(issues);
    expect(summary.errors).toBe(3);
    expect(summary.warnings).toBe(1);
    expect(summary.byRule['pls_range']).toBe(2);
    expect(summary.byRule['tide_invalid']).toBe(1);
    expect(summary.byRule['connectivity_island']).toBe(1);
  });
});
