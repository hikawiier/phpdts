//
// projectStore 单元测试（对齐 NEW_DESIGN.md §7.3 M2 验收标准 1：覆盖率 ≥ 85%）
//
// 覆盖点：
//   - state：project / currentPgroup / selectedPls / isDirty / projectName / usingIndexedDB / lastSaveError
//   - getters：hasProject / regionCount / regionList / currentRegion / currentGrid / currentTiles /
//             currentTile / tileCount
//   - 项目级 actions：loadProject / appendProject / clearProject / setCurrentPgroup / setSelectedPls /
//                    markDirty / markSaved / setProjectName
//   - 区域 CRUD：addRegion / deleteRegion / updateRegion / addExitLink / updateExitLink / removeExitLink
//   - 格 CRUD：addTile / deleteTile / updateTile / moveTile
//   - 连通图：breakTileConnection / restoreTileConnection
//   - 撤销/重做快照：snapshot / replaceProject
//   - 持久化：loadFromStorage（localStorage / IndexedDB 回退）
//   - 工具函数：nextPgroup / nextPls / findTileByCoord
//   - 边界：
//     - pls 范围 1-254 / pgroup 范围 1-255 / cols/rows 上限 254
//     - 同 (pgroup, x, y) 唯一性
//     - 8 方向自动连通
//     - tide='safe' 迁移
//     - exit_links 裸数字迁移
//     - 切换 pgroup 不清空 selectedPls 之外的引用

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '@/stores/projectStore';
import {
  PLS_MAX,
  PGROUP_MAX,
  COLS_ROWS_MAX,
  COLS_ROWS_MIN,
} from '@/shared';
import type { MapProject, Pgroup, Pls } from '@/shared';

describe('projectStore', () => {
  let project: ReturnType<typeof useProjectStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    // 清空 localStorage
    localStorage.clear();
    project = useProjectStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeEmptyProject(): MapProject {
    return { regions: {}, grids: {}, tiles: {} };
  }

  function makeSampleProject(): MapProject {
    return {
      regions: {
        1: {
          name: '区域 A',
          desc: '',
          entrance_pls: null,
          exit_pls: null,
          next_region: null,
          prev_region: null,
          exit_links: [],
          cols: 4,
          rows: 3,
        },
      },
      grids: { 1: { cols: 4, rows: 3 } },
      tiles: {
        1: {
          1: {
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
          },
        },
      },
    };
  }

  describe('初始状态', () => {
    it('project 为空对象', () => {
      expect(project.project).toEqual(makeEmptyProject());
    });

    it('currentPgroup / selectedPls 为 null', () => {
      expect(project.currentPgroup).toBeNull();
      expect(project.selectedPls).toBeNull();
    });

    it('isDirty 为 false', () => {
      expect(project.isDirty).toBe(false);
    });

    it('projectName 默认值', () => {
      expect(project.projectName).toBe('未命名项目');
    });

    it('hasProject 为 false', () => {
      expect(project.hasProject).toBe(false);
    });

    it('regionCount 为 0', () => {
      expect(project.regionCount).toBe(0);
    });

    it('regionList 为空数组', () => {
      expect(project.regionList).toEqual([]);
    });

    it('currentRegion / currentGrid / currentTile 为 null', () => {
      expect(project.currentRegion).toBeNull();
      expect(project.currentGrid).toBeNull();
      expect(project.currentTile).toBeNull();
    });

    it('currentTiles 为空对象', () => {
      expect(project.currentTiles).toEqual({});
    });

    it('tileCount 为 0', () => {
      expect(project.tileCount).toBe(0);
    });
  });

  describe('addRegion', () => {
    it('新增区域返回 pgroup，默认 cols/rows=8/6', () => {
      const pgroup = project.addRegion();
      expect(pgroup).toBe(1);
      expect(project.regionCount).toBe(1);
      const region = project.project.regions[1];
      expect(region).toBeDefined();
      expect(region!.cols).toBe(8);
      expect(region!.rows).toBe(6);
      expect(region!.name).toBe('新区域 1');
    });

    it('新增区域自动切换 currentPgroup', () => {
      const pgroup = project.addRegion('A');
      expect(project.currentPgroup).toBe(pgroup);
    });

    it('cols/rows 超出范围被裁剪', () => {
      const pgroup = project.addRegion('A', 9999, 0);
      expect(project.project.regions[pgroup!]!.cols).toBe(COLS_ROWS_MAX);
      expect(project.project.regions[pgroup!]!.rows).toBe(COLS_ROWS_MIN);
    });

    it('isDirty 被置 true', () => {
      project.addRegion();
      expect(project.isDirty).toBe(true);
    });

    it('连续新增 pgroup 递增', () => {
      const p1 = project.addRegion();
      const p2 = project.addRegion();
      const p3 = project.addRegion();
      expect(p1).toBe(1);
      expect(p2).toBe(2);
      expect(p3).toBe(3);
    });
  });

  describe('deleteRegion', () => {
    it('删除当前区域后 currentPgroup 切到第一个剩余区域', () => {
      const p1 = project.addRegion('A');
      const p2 = project.addRegion('B');
      project.setCurrentPgroup(p2!);
      project.deleteRegion(p2!);
      expect(project.currentPgroup).toBe(p1);
    });

    it('删除唯一区域后 currentPgroup 为 null', () => {
      const p1 = project.addRegion('A');
      project.deleteRegion(p1!);
      expect(project.currentPgroup).toBeNull();
    });

    it('清理其他区域对该区域的引用', () => {
      const p1 = project.addRegion('A');
      const p2 = project.addRegion('B');
      project.updateRegion(p1!, { next_region: p2 });
      project.updateRegion(p2!, { prev_region: p1 });
      project.addExitLink(p1!, { from_pls: null, to_pgroup: p2!, to_pls: null });
      project.deleteRegion(p2!);
      const region = project.project.regions[p1!];
      expect(region!.next_region).toBeNull();
      expect(region!.exit_links).toHaveLength(0);
    });
  });

  describe('updateRegion', () => {
    it('部分字段更新', () => {
      const p = project.addRegion('A');
      project.updateRegion(p!, { name: 'B', desc: 'desc' });
      expect(project.project.regions[p!]!.name).toBe('B');
      expect(project.project.regions[p!]!.desc).toBe('desc');
    });

    it('更新 cols 同步 grids.cols', () => {
      const p = project.addRegion('A', 4, 4);
      project.updateRegion(p!, { cols: 10 });
      expect(project.project.regions[p!]!.cols).toBe(10);
      expect(project.project.grids[p!]!.cols).toBe(10);
    });

    it('next_region 双向同步：自动设置 target.prev_region', () => {
      const p1 = project.addRegion('A');
      const p2 = project.addRegion('B');
      project.updateRegion(p1!, { next_region: p2 });
      expect(project.project.regions[p2!]!.prev_region).toBe(p1);
    });

    it('next_region 双向同步：清理原 target 的旧 prev_region 反指', () => {
      const p1 = project.addRegion('A');
      const p2 = project.addRegion('B');
      const p3 = project.addRegion('C');
      // p1 → p2（p2.prev = p1）
      project.updateRegion(p1!, { next_region: p2 });
      // p3 → p2（p2.prev = p3，p1.next 应被清理）
      project.updateRegion(p3!, { next_region: p2 });
      expect(project.project.regions[p1!]!.next_region).toBeNull();
      expect(project.project.regions[p2!]!.prev_region).toBe(p3);
    });
  });

  describe('exit_links CRUD', () => {
    let p1: Pgroup;
    let p2: Pgroup;

    beforeEach(() => {
      p1 = project.addRegion('A')!;
      p2 = project.addRegion('B')!;
    });

    it('addExitLink 追加', () => {
      project.addExitLink(p1, { from_pls: null, to_pgroup: p2, to_pls: null });
      expect(project.project.regions[p1]!.exit_links).toHaveLength(1);
      expect(project.project.regions[p1]!.exit_links[0]!.to_pgroup).toBe(p2);
    });

    it('updateExitLink 部分更新', () => {
      project.addExitLink(p1, { from_pls: null, to_pgroup: p2, to_pls: null });
      project.updateExitLink(p1, 0, { from_pls: 1, to_pls: 2 });
      expect(project.project.regions[p1]!.exit_links[0]!.from_pls).toBe(1);
      expect(project.project.regions[p1]!.exit_links[0]!.to_pls).toBe(2);
    });

    it('removeExitLink 按索引移除', () => {
      project.addExitLink(p1, { from_pls: null, to_pgroup: p2, to_pls: null });
      project.addExitLink(p1, { from_pls: 1, to_pgroup: p2, to_pls: 2 });
      project.removeExitLink(p1, 0);
      expect(project.project.regions[p1]!.exit_links).toHaveLength(1);
      expect(project.project.regions[p1]!.exit_links[0]!.from_pls).toBe(1);
    });
  });

  describe('addTile', () => {
    it('新增格返回 pls=1，应用画笔预设', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0, { floor: 'water', tide: 'deep' });
      expect(pls).toBe(1);
      const tile = project.project.tiles[p]![1]!;
      expect(tile.floor).toBe('water');
      expect(tile.tide).toBe('deep');
      expect(tile.x).toBe(0);
      expect(tile.y).toBe(0);
    });

    it('同 (pgroup, x, y) 唯一性：重复返回 null', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      const pls2 = project.addTile(p, 0, 0);
      expect(pls1).toBe(1);
      expect(pls2).toBeNull();
    });

    it('8 方向自动连通：相邻格自动建立 neighbors', () => {
      const p = project.addRegion('A')!;
      project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // 对角相邻
      const t1 = project.project.tiles[p]![1]!;
      const t2 = project.project.tiles[p]![2]!;
      expect(t1.neighbors).toContain(2);
      expect(t2.neighbors).toContain(1);
    });

    it('8 方向自动连通：不相邻格不建立连接', () => {
      const p = project.addRegion('A')!;
      project.addTile(p, 0, 0);
      project.addTile(p, 5, 5); // 远距离
      const t1 = project.project.tiles[p]![1]!;
      expect(t1.neighbors).toHaveLength(0);
    });
  });

  describe('deleteTile', () => {
    it('删除格后 tiles 字典移除', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      project.deleteTile(p, pls!);
      // P1-E：tiles[pgroup] 在无 tile 时为 undefined（projectFromGraph 不创建空字典）
      expect(project.project.tiles[p]?.[pls!]).toBeUndefined();
    });

    it('删除格后清理邻居引用（对称）', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      project.deleteTile(p, pls1!);
      const t2 = project.project.tiles[p]![2]!;
      expect(t2.neighbors).not.toContain(pls1);
    });

    it('删除 entrance_pls 时清理 region 引用', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      project.updateRegion(p, { entrance_pls: pls });
      project.deleteTile(p, pls!);
      expect(project.project.regions[p]!.entrance_pls).toBeNull();
    });

    it('删除 selectedPls 时清空选中态', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      project.setSelectedPls(pls);
      project.deleteTile(p, pls!);
      expect(project.selectedPls).toBeNull();
    });
  });

  describe('updateTile', () => {
    it('部分字段更新', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      project.updateTile(p, pls!, { name: 'Tile1', height: 5 });
      const tile = project.project.tiles[p]![pls!]!;
      expect(tile.name).toBe('Tile1');
      expect(tile.height).toBe(5);
    });

    it('x/y 变化时重建连通（disconnectAll + autoConnect）', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      expect(project.project.tiles[p]![pls1!]!.neighbors).toContain(2);
      // 移动 pls1 远离 pls2
      project.updateTile(p, pls1!, { x: 5, y: 5 });
      expect(project.project.tiles[p]![pls1!]!.neighbors).not.toContain(2);
    });

    it('x/y 不变时不重建连通', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      const beforeNeighbors = [...project.project.tiles[p]![pls1!]!.neighbors];
      project.updateTile(p, pls1!, { name: 'Tile1' });
      expect(project.project.tiles[p]![pls1!]!.neighbors).toEqual(beforeNeighbors);
    });
  });

  describe('moveTile', () => {
    it('移动到空白坐标成功', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      const ok = project.moveTile(p, pls!, 3, 3);
      expect(ok).toBe(true);
      expect(project.project.tiles[p]![pls!]!.x).toBe(3);
      expect(project.project.tiles[p]![pls!]!.y).toBe(3);
    });

    it('移动到已被其他格占用坐标失败', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      const ok = project.moveTile(p, pls1!, 1, 1);
      expect(ok).toBe(false);
      expect(project.project.tiles[p]![pls1!]!.x).toBe(0); // 未变
    });

    it('移动到自身当前坐标返回 true（幂等）', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      const ok = project.moveTile(p, pls!, 0, 0);
      expect(ok).toBe(true);
    });

    it('移动后重建连通', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      // 移动 pls1 到 (3, 3) 与 pls2 (1,1) 不相邻（差值 (2,2) 超出 8 方向）
      project.moveTile(p, pls1!, 3, 3);
      expect(project.project.tiles[p]![pls1!]!.neighbors).not.toContain(2);
      // 再移动到 (2, 2) 与 pls2 (1,1) 对角相邻
      project.moveTile(p, pls1!, 2, 2);
      expect(project.project.tiles[p]![pls1!]!.neighbors).toContain(2);
    });
  });

  describe('breakTileConnection / restoreTileConnection', () => {
    it('break 断开双向 neighbors 并写入 _breaks', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      project.breakTileConnection(p, pls1!, 2);
      const t1 = project.project.tiles[p]![pls1!]!;
      const t2 = project.project.tiles[p]![2]!;
      expect(t1.neighbors).not.toContain(2);
      expect(t2.neighbors).not.toContain(pls1);
      expect(t1._breaks).toContain(2);
      expect(t2._breaks).toContain(pls1);
    });

    it('restore 恢复双向 neighbors 并清除 _breaks', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      project.breakTileConnection(p, pls1!, 2);
      project.restoreTileConnection(p, pls1!, 2);
      const t1 = project.project.tiles[p]![pls1!]!;
      const t2 = project.project.tiles[p]![2]!;
      expect(t1.neighbors).toContain(2);
      expect(t2.neighbors).toContain(pls1);
      expect(t1._breaks).not.toContain(2);
      expect(t2._breaks).not.toContain(pls1);
    });

    it('break 后即使再 addTile 同坐标也不会重建连接（_breaks 跳过）', () => {
      const p = project.addRegion('A')!;
      const pls1 = project.addTile(p, 0, 0);
      project.addTile(p, 1, 1); // pls2
      project.breakTileConnection(p, pls1!, 2);
      // 模拟移动 pls2 后再移回，触发 autoConnect 但跳过 _breaks
      project.moveTile(p, 2, 5, 5);
      project.moveTile(p, 2, 1, 1);
      expect(project.project.tiles[p]![pls1!]!.neighbors).not.toContain(2);
    });
  });

  describe('snapshot / replaceProject', () => {
    it('snapshot 返回深拷贝（修改不影响原）', () => {
      project.addRegion('A');
      const snap = project.snapshot();
      snap.regions[1]!.name = 'modified';
      expect(project.project.regions[1]!.name).toBe('A');
    });

    it('replaceProject 替换并校验 currentPgroup 仍在快照中', () => {
      const p1 = project.addRegion('A');
      project.addRegion('B');
      project.setCurrentPgroup(p1!);
      const snap = project.snapshot();
      // 删除区域 B 后 replace
      delete snap.regions[2];
      delete snap.grids[2];
      delete snap.tiles[2];
      project.replaceProject(snap);
      expect(project.project.regions[1]).toBeDefined();
      expect(project.project.regions[2]).toBeUndefined();
      expect(project.currentPgroup).toBe(p1);
    });

    it('replaceProject 当 currentPgroup 不在快照中时回退到第一个', () => {
      const p1 = project.addRegion('A');
      project.addRegion('B');
      project.setCurrentPgroup(2);
      const snap = project.snapshot();
      // 仅保留 p1
      delete snap.regions[2];
      delete snap.grids[2];
      delete snap.tiles[2];
      project.replaceProject(snap);
      expect(project.currentPgroup).toBe(p1);
      expect(project.selectedPls).toBeNull();
    });

    it('replaceProject 当 selectedPls 不在快照中时清空', () => {
      const p = project.addRegion('A')!;
      const pls = project.addTile(p, 0, 0);
      project.setSelectedPls(pls);
      const snap = project.snapshot();
      // 删除该 tile
      delete snap.tiles[p]![pls!];
      project.replaceProject(snap);
      expect(project.selectedPls).toBeNull();
    });
  });

  describe('loadProject', () => {
    it('加载项目自动迁移 exit_links 裸数字格式', () => {
      const data: MapProject = {
        regions: {
          1: {
            name: 'A',
            desc: '',
            entrance_pls: null,
            exit_pls: null,
            next_region: null,
            prev_region: null,
            exit_links: [2, 3] as unknown as MapProject['regions'][1]['exit_links'],
            cols: 4,
            rows: 3,
          },
        },
        grids: { 1: { cols: 4, rows: 3 } },
        tiles: { 1: {} },
      };
      project.loadProject(data);
      const region = project.project.regions[1]!;
      expect(region.exit_links).toEqual([
        { from_pls: null, to_pgroup: 2, to_pls: null },
        { from_pls: null, to_pgroup: 3, to_pls: null },
      ]);
    });

    it('加载项目自动迁移 tide="safe" → shallow + preset_safe=true', () => {
      const data: MapProject = {
        regions: { 1: makeEmptyRegion() },
        grids: { 1: { cols: 4, rows: 3 } },
        tiles: {
          1: {
            1: {
              name: '',
              desc: '',
              floor: 'standard',
              tide: 'safe' as never,
              height: 0,
              passable: true,
              destructible: false,
              neighbors: [],
              x: 0,
              y: 0,
              preset_safe: false,
            },
          },
        },
      };
      project.loadProject(data);
      const tile = project.project.tiles[1]![1]!;
      expect(tile.tide).toBe('shallow');
      expect(tile.preset_safe).toBe(true);
    });

    it('加载项目自动补全 tiles 缺失字段（height/destructible/preset_safe/neighbors/_breaks）', () => {
      const data: MapProject = {
        regions: { 1: makeEmptyRegion() },
        grids: { 1: { cols: 4, rows: 3 } },
        tiles: {
          1: {
            1: {
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
            },
          },
        },
      };
      // 删除部分字段
      delete (data.tiles[1]![1]! as unknown as Record<string, unknown>).destructible;
      delete (data.tiles[1]![1]! as unknown as Record<string, unknown>).preset_safe;
      delete (data.tiles[1]![1]! as unknown as Record<string, unknown>).neighbors;
      delete (data.tiles[1]![1]! as unknown as Record<string, unknown>)._breaks;
      project.loadProject(data);
      const tile = project.project.tiles[1]![1]!;
      expect(tile.destructible).toBe(false);
      expect(tile.preset_safe).toBe(false);
      expect(tile.neighbors).toEqual([]);
      expect(tile._breaks).toEqual([]);
    });

    it('加载项目自动选中第一个 pgroup', () => {
      const data = makeSampleProject();
      project.loadProject(data);
      expect(project.currentPgroup).toBe(1);
    });

    it('加载空项目时 currentPgroup 为 null', () => {
      project.loadProject({ regions: {}, grids: {}, tiles: {} });
      expect(project.currentPgroup).toBeNull();
    });

    it('加载时同步 region.cols / rows ← grids.cols / rows', () => {
      const data: MapProject = {
        regions: {
          1: {
            name: 'A',
            desc: '',
            entrance_pls: null,
            exit_pls: null,
            next_region: null,
            prev_region: null,
            exit_links: [],
            cols: 0,
            rows: 0,
          },
        },
        grids: { 1: { cols: 8, rows: 6 } },
        tiles: { 1: {} },
      };
      project.loadProject(data);
      expect(project.project.regions[1]!.cols).toBe(8);
      expect(project.project.regions[1]!.rows).toBe(6);
    });
  });

  describe('appendProject', () => {
    it('追加项目重新分配 pgroup 为当前 max+1', () => {
      project.addRegion('A'); // pgroup=1
      const next: MapProject = {
        regions: {
          1: makeEmptyRegion(),
          2: makeEmptyRegion(),
        },
        grids: {
          1: { cols: 4, rows: 3 },
          2: { cols: 4, rows: 3 },
        },
        tiles: { 1: {}, 2: {} },
      };
      const newPgroups = project.appendProject(next);
      expect(newPgroups).toEqual([2, 3]);
      expect(project.project.regions[2]).toBeDefined();
      expect(project.project.regions[3]).toBeDefined();
    });

    it('追加项目重新映射 next_region / prev_region / exit_links.to_pgroup', () => {
      project.addRegion('A'); // pgroup=1
      const next: MapProject = {
        regions: {
          1: { ...makeEmptyRegion(), next_region: 2 },
          2: { ...makeEmptyRegion(), prev_region: 1, exit_links: [{ from_pls: null, to_pgroup: 1, to_pls: null }] },
        },
        grids: { 1: { cols: 4, rows: 3 }, 2: { cols: 4, rows: 3 } },
        tiles: { 1: {}, 2: {} },
      };
      const newPgroups = project.appendProject(next);
      // 1 → 2, 2 → 3
      expect(project.project.regions[newPgroups[0]!]!.next_region).toBe(newPgroups[1]);
      expect(project.project.regions[newPgroups[1]!]!.prev_region).toBe(newPgroups[0]);
      expect(project.project.regions[newPgroups[1]!]!.exit_links[0]!.to_pgroup).toBe(newPgroups[0]);
    });
  });

  describe('clearProject', () => {
    it('清空项目数据', () => {
      project.addRegion('A');
      project.clearProject();
      expect(project.project).toEqual(makeEmptyProject());
      expect(project.currentPgroup).toBeNull();
      expect(project.selectedPls).toBeNull();
      expect(project.isDirty).toBe(false);
    });

    it('清空 localStorage', () => {
      // P1-E：存储 key 改为 _meta 后缀（仅元数据）
      localStorage.setItem('oblivions_editor_project_meta', 'test');
      project.clearProject();
      expect(localStorage.getItem('oblivions_editor_project_meta')).toBeNull();
    });
  });

  describe('setCurrentPgroup / setSelectedPls', () => {
    it('setCurrentPgroup 切换并清空 selectedPls', () => {
      const p1 = project.addRegion('A');
      project.addTile(p1!, 0, 0);
      project.setSelectedPls(1);
      const p2 = project.addRegion('B');
      project.setCurrentPgroup(p1!);
      project.setSelectedPls(1);
      project.setCurrentPgroup(p2!);
      expect(project.selectedPls).toBeNull();
    });

    it('setCurrentPgroup 不存在的 pgroup 不切换', () => {
      const p1 = project.addRegion('A');
      project.setCurrentPgroup(999);
      expect(project.currentPgroup).toBe(p1);
    });

    it('setSelectedPls 设置选中', () => {
      project.setSelectedPls(5);
      expect(project.selectedPls).toBe(5);
    });
  });

  describe('markDirty / markSaved / setProjectName', () => {
    it('markDirty 置 isDirty=true', () => {
      project.markDirty();
      expect(project.isDirty).toBe(true);
    });

    it('markSaved 置 isDirty=false', () => {
      project.markDirty();
      project.markSaved();
      expect(project.isDirty).toBe(false);
    });

    it('setProjectName 更新项目名', () => {
      project.setProjectName('Custom');
      expect(project.projectName).toBe('Custom');
    });
  });

  describe('工具函数', () => {
    it('nextPgroup 空项目返回 PGROUP_MIN', () => {
      expect(project.nextPgroup()).toBe(1);
    });

    it('nextPgroup 已有区域返回 max+1', () => {
      project.addRegion('A');
      project.addRegion('B');
      expect(project.nextPgroup()).toBe(3);
    });

    it('nextPls 空区域返回 PLS_MIN', () => {
      const p = project.addRegion('A')!;
      expect(project.nextPls(p)).toBe(1);
    });

    it('findTileByCoord 按 (x, y) 查找', () => {
      const p = project.addRegion('A')!;
      project.addTile(p, 3, 4);
      const found = project.findTileByCoord(p, 3, 4);
      expect(found).toBe(1);
      expect(project.findTileByCoord(p, 0, 0)).toBeNull();
    });
  });

  describe('loadFromStorage', () => {
    it('localStorage 有合法元数据时加载成功', async () => {
      // P1-E：存储 key 改为 _meta，仅持久化元数据（不含完整 MapProject）
      // graph-store 的 world 节点从 loader.ts 重新装配，loadFromStorage 仅恢复元数据
      const data = {
        name: 'Test',
        createdAt: 1000,
        updatedAt: 2000,
        currentPgroup: 1,
        selectedPls: null,
      };
      localStorage.setItem('oblivions_editor_project_meta', JSON.stringify(data));
      const ok = await project.loadFromStorage();
      expect(ok).toBe(true);
      expect(project.projectName).toBe('Test');
      // currentPgroup 在 graph 无对应 region 时回退到第一个 region（此处无 region，保持 null）
      expect(project.usingIndexedDB).toBe(false);
    });

    it('localStorage 无数据时返回 false', async () => {
      localStorage.clear();
      const ok = await project.loadFromStorage();
      expect(ok).toBe(false);
    });

    it('localStorage 数据损坏时返回 false', async () => {
      localStorage.setItem('oblivions_editor_project_meta', '{not valid json');
      const ok = await project.loadFromStorage();
      expect(ok).toBe(false);
    });

    it('name 字段缺失时视为无效', async () => {
      localStorage.setItem(
        'oblivions_editor_project_meta',
        JSON.stringify({ createdAt: 0, updatedAt: 0 }),
      );
      const ok = await project.loadFromStorage();
      expect(ok).toBe(false);
    });
  });

  describe('边界：pls / pgroup 范围', () => {
    it(`nextPls 达 ${PLS_MAX} 上限后返回 null`, () => {
      // P1-E：project.project 是只读 computed，通过 loadProject 写入 graph-store
      const p = project.addRegion('A')!;
      const boundaryProject: MapProject = {
        regions: {
          [p]: {
            name: 'A',
            desc: '',
            entrance_pls: null,
            exit_pls: null,
            next_region: null,
            prev_region: null,
            exit_links: [],
            cols: 8,
            rows: 6,
          },
        },
        grids: { [p]: { cols: 8, rows: 6 } },
        tiles: {
          [p]: {
            [PLS_MAX as Pls]: {
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
            },
          },
        },
      };
      project.loadProject(boundaryProject);
      expect(project.nextPls(p)).toBeNull();
    });

    it(`nextPgroup 达 ${PGROUP_MAX} 上限后返回 null`, () => {
      // P1-E：通过 loadProject 写入 pgroup=PGROUP_MAX 的区域到 graph-store
      const boundaryProject: MapProject = {
        regions: {
          [PGROUP_MAX as Pgroup]: {
            name: 'max',
            desc: '',
            entrance_pls: null,
            exit_pls: null,
            next_region: null,
            prev_region: null,
            exit_links: [],
            cols: 1,
            rows: 1,
          },
        },
        grids: { [PGROUP_MAX as Pgroup]: { cols: 1, rows: 1 } },
        tiles: { [PGROUP_MAX as Pgroup]: {} },
      };
      project.loadProject(boundaryProject);
      expect(project.nextPgroup()).toBeNull();
    });
  });

  // ─── 辅助 ───────────────────────────────────────────
  function makeEmptyRegion() {
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
    };
  }
});
