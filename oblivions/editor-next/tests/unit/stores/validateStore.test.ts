//
// validateStore 单元测试（对齐 O-10 分层校验调度）
//
// 覆盖点：
//   - state：issues / lastRunMode / lastRunAt / filter / isRunning / includeConfig
//   - getters：errorCount / warningCount / filteredIssues / hasIssues / summary
//   - actions：setIssues / setFilter / setRunning / setIncludeConfig
//   - 调度：runLight / runFull / scheduleLightValidation（debounce 300ms） / cancelScheduledLight / clear
//   - 集成：runFull 读取 projectStore + configStore 数据，includeConfig=false 时跳过配置交叉引用
//   - 边界：空 project 不抛错 / filter 切换影响 filteredIssues / includeConfig 开关影响 runFull 行为
//   - 注意：lootTableIds / itemTableIds 已移除（O-10 由 graph-store 查询替代）

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useValidateStore } from '@/stores/validateStore';
import { useProjectStore } from '@/stores/projectStore';
import { useConfigStore } from '@/stores/configStore';
import { VALIDATE_LIGHT_DEBOUNCE_MS } from '@/shared';
import type { MapProject, Tile, Region, ScatterPool, PoiTable, PoiPool } from '@/shared';

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

function makeValidProject(): MapProject {
  // 全连通 + entrance/exit 设置 + 邻居对称
  return {
    regions: {
      1: makeRegion({ entrance_pls: 1, exit_pls: 2, cols: 4, rows: 3 }),
    },
    grids: { 1: { cols: 4, rows: 3 } },
    tiles: {
      1: {
        1: makeTile({ x: 0, y: 0, neighbors: [2] }),
        2: makeTile({ x: 1, y: 0, neighbors: [1] }),
      },
    },
  };
}

function makeBrokenProject(): MapProject {
  // pls=2 是孤岛，且 region 缺少 entrance_pls
  return {
    regions: { 1: makeRegion({ exit_pls: 1 }) }, // entrance_pls=null（触发 REGION_NO_ENTRANCE）
    grids: { 1: { cols: 4, rows: 3 } },
    tiles: {
      1: {
        1: makeTile({ x: 0, y: 0, neighbors: [] }),
        2: makeTile({ x: 5, y: 5, neighbors: [] }), // 孤岛
      },
    },
  };
}

function makeScatterPool(): ScatterPool {
  return {
    shallow: { initial: [{ item_id: 'scrap', count: 1, rate: 0.5 }], refresh: [] },
    deep: { initial: [], refresh: [] },
    abyss: { initial: [], refresh: [] },
  };
}

function makePoiTable(): PoiTable {
  return {
    supply_cache: { searchable: true, repeatable: false, loot_table_id: 'supply_loot' },
  };
}

function makePoiPool(): PoiPool {
  return {
    shallow: [{ poi_id: 'unknown_poi', per_region: 1 }], // 引用不存在的 POI → 触发 POI_POOL_REF
    deep: [],
    abyss: [],
  };
}

// ─── 测试用例 ─────────────────────────────────────────────────

describe('validateStore', () => {
  let validate: ReturnType<typeof useValidateStore>;
  let project: ReturnType<typeof useProjectStore>;
  let config: ReturnType<typeof useConfigStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    validate = useValidateStore();
    project = useProjectStore();
    config = useConfigStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 初始 state ───────────────────────────────────────────

  describe('初始 state', () => {
    it('issues 为空数组', () => {
      expect(validate.issues).toEqual([]);
    });

    it('lastRunMode / lastRunAt 为 null', () => {
      expect(validate.lastRunMode).toBeNull();
      expect(validate.lastRunAt).toBeNull();
    });

    it('filter 默认 all', () => {
      expect(validate.filter).toBe('all');
    });

    it('isRunning 默认 false', () => {
      expect(validate.isRunning).toBe(false);
    });

    it('includeConfig 默认 true', () => {
      expect(validate.includeConfig).toBe(true);
    });
  });

  // ─── getters ──────────────────────────────────────────────

  describe('getters', () => {
    it('errorCount / warningCount 统计正确', () => {
      validate.setIssues(
        [
          { rule: 'pls_range', severity: 'error', message: 'a', location: {} },
          { rule: 'tide_invalid', severity: 'error', message: 'b', location: {} },
          { rule: 'connectivity_island', severity: 'warning', message: 'c', location: {} },
        ],
        'light',
      );
      expect(validate.errorCount).toBe(2);
      expect(validate.warningCount).toBe(1);
    });

    it('filteredIssues：filter=all 返回全部', () => {
      validate.setIssues(
        [
          { rule: 'pls_range', severity: 'error', message: 'a', location: {} },
          { rule: 'connectivity_island', severity: 'warning', message: 'b', location: {} },
        ],
        'light',
      );
      validate.setFilter('all');
      expect(validate.filteredIssues).toHaveLength(2);
    });

    it('filteredIssues：filter=error 仅返回 error', () => {
      validate.setIssues(
        [
          { rule: 'pls_range', severity: 'error', message: 'a', location: {} },
          { rule: 'connectivity_island', severity: 'warning', message: 'b', location: {} },
        ],
        'light',
      );
      validate.setFilter('error');
      expect(validate.filteredIssues).toHaveLength(1);
      expect(validate.filteredIssues[0]!.severity).toBe('error');
    });

    it('filteredIssues：filter=warning 仅返回 warning', () => {
      validate.setIssues(
        [
          { rule: 'pls_range', severity: 'error', message: 'a', location: {} },
          { rule: 'connectivity_island', severity: 'warning', message: 'b', location: {} },
        ],
        'light',
      );
      validate.setFilter('warning');
      expect(validate.filteredIssues).toHaveLength(1);
      expect(validate.filteredIssues[0]!.severity).toBe('warning');
    });

    it('hasIssues：空时 false / 非空时 true', () => {
      expect(validate.hasIssues).toBe(false);
      validate.setIssues(
        [{ rule: 'pls_range', severity: 'error', message: 'a', location: {} }],
        'light',
      );
      expect(validate.hasIssues).toBe(true);
    });

    it('summary：返回 errors/warnings/byRule 统计', () => {
      validate.setIssues(
        [
          { rule: 'pls_range', severity: 'error', message: 'a', location: {} },
          { rule: 'pls_range', severity: 'error', message: 'b', location: {} },
          { rule: 'tide_invalid', severity: 'error', message: 'c', location: {} },
          { rule: 'connectivity_island', severity: 'warning', message: 'd', location: {} },
        ],
        'full',
      );
      const s = validate.summary;
      expect(s.errors).toBe(3);
      expect(s.warnings).toBe(1);
      expect(s.byRule['pls_range']).toBe(2);
      expect(s.byRule['tide_invalid']).toBe(1);
      expect(s.byRule['connectivity_island']).toBe(1);
    });
  });

  // ─── actions：set 类 ─────────────────────────────────────

  describe('set actions', () => {
    it('setIssues 同时更新 lastRunMode / lastRunAt', () => {
      const before = Date.now();
      validate.setIssues([], 'light');
      const after = Date.now();
      expect(validate.lastRunMode).toBe('light');
      expect(validate.lastRunAt).not.toBeNull();
      expect(validate.lastRunAt!).toBeGreaterThanOrEqual(before);
      expect(validate.lastRunAt!).toBeLessThanOrEqual(after);
    });

    it('setFilter 切换过滤器', () => {
      validate.setFilter('error');
      expect(validate.filter).toBe('error');
    });

    it('setRunning 切换运行状态', () => {
      validate.setRunning(true);
      expect(validate.isRunning).toBe(true);
    });

    it('setIncludeConfig 切换配置校验开关', () => {
      validate.setIncludeConfig(false);
      expect(validate.includeConfig).toBe(false);
    });
  });

  // ─── 调度：runLight / runFull ────────────────────────────

  describe('runLight', () => {
    it('从 projectStore 读取数据并跑 Light 验证', () => {
      project.loadProject(makeBrokenProject());
      const result = validate.runLight();
      // Broken project 应触发 REGION_NO_ENTRANCE warning（Light 含此规则）
      expect(result.length).toBeGreaterThan(0);
      expect(validate.lastRunMode).toBe('light');
      // 注意：通过 Pinia 读取的 issues 是响应式代理，与原数组不是 Object.is 同引用
      expect(validate.issues).toEqual(result);
    });

    it('空 project 不抛错且返回空数组', () => {
      const result = validate.runLight();
      expect(result).toEqual([]);
      expect(validate.lastRunMode).toBe('light');
    });

    it('Light 验证不包含 CONNECTIVITY_ISLAND（即使有孤岛）', () => {
      project.loadProject(makeBrokenProject());
      validate.runLight();
      const islandIssues = validate.issues.filter((i) => i.rule === 'connectivity_island');
      expect(islandIssues).toHaveLength(0);
    });
  });

  describe('runFull', () => {
    it('从 projectStore + configStore 读取数据并跑 Full 验证', () => {
      project.loadProject(makeBrokenProject());
      // entrance_pls=null → 跳过 BFS；手动设置以触发 BFS
      // P1-H 后 structure-validator 从 graph-store 读取，必须用 updateRegion 同步图，
      // 直接改 project.project.regions[...] 不会传播到 graph-store
      project.updateRegion(1, { entrance_pls: 1 });
      validate.runFull();
      expect(validate.lastRunMode).toBe('full');
      // Full 验证应触发 CONNECTIVITY_ISLAND warning（孤岛 pls=2）
      const islandIssues = validate.issues.filter((i) => i.rule === 'connectivity_island');
      expect(islandIssues.length).toBeGreaterThan(0);
    });

    it('includeConfig=true 且提供 config 数据时执行配置交叉引用校验', () => {
      project.loadProject(makeValidProject());
      config.loadAll({
        scatterPool: makeScatterPool(),
        poiTable: makePoiTable(),
        poiPool: makePoiPool(), // 引用 unknown_poi，触发 POI_POOL_REF
      });
      validate.runFull();
      const poolRefIssues = validate.issues.filter((i) => i.rule === 'poi_pool_ref');
      expect(poolRefIssues).toHaveLength(1);
    });

    it('includeConfig=false 跳过配置交叉引用（M8 生成器调用契约）', () => {
      project.loadProject(makeValidProject());
      config.loadAll({
        scatterPool: makeScatterPool(),
        poiTable: makePoiTable(),
        poiPool: makePoiPool(), // 即使有 unknown_poi 也不应触发
      });
      validate.runFull({ includeConfig: false });
      const poolRefIssues = validate.issues.filter((i) => i.rule === 'poi_pool_ref');
      expect(poolRefIssues).toHaveLength(0);
    });
  });

  // ─── 调度：scheduleLightValidation（debounce） ──────────

  describe('scheduleLightValidation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounce 300ms 后触发 runLight（对齐 VALIDATE_LIGHT_DEBOUNCE_MS）', () => {
      project.loadProject(makeBrokenProject());
      validate.scheduleLightValidation();
      // 立即检查：lastRunMode 仍是 null（debounce 未触发）
      expect(validate.lastRunMode).toBeNull();
      // 推进 299ms：仍未触发
      vi.advanceTimersByTime(VALIDATE_LIGHT_DEBOUNCE_MS - 1);
      expect(validate.lastRunMode).toBeNull();
      // 推进剩余 1ms：触发
      vi.advanceTimersByTime(1);
      expect(validate.lastRunMode).toBe('light');
    });

    it('多次连续调用合并为一次（debounce 合并）', () => {
      project.loadProject(makeBrokenProject());
      validate.scheduleLightValidation();
      vi.advanceTimersByTime(100);
      validate.scheduleLightValidation(); // 重置计时
      vi.advanceTimersByTime(VALIDATE_LIGHT_DEBOUNCE_MS - 1);
      // 第一次重置后只过了不到 300ms，应仍未触发
      expect(validate.lastRunMode).toBeNull();
      vi.advanceTimersByTime(1);
      expect(validate.lastRunMode).toBe('light');
    });

    it('cancelScheduledLight 取消未触发的 Light 验证', () => {
      project.loadProject(makeBrokenProject());
      validate.scheduleLightValidation();
      validate.cancelScheduledLight();
      vi.advanceTimersByTime(VALIDATE_LIGHT_DEBOUNCE_MS * 2);
      expect(validate.lastRunMode).toBeNull();
    });

    it('clear 同时取消未触发的 Light 验证', () => {
      project.loadProject(makeBrokenProject());
      validate.scheduleLightValidation();
      validate.clear();
      vi.advanceTimersByTime(VALIDATE_LIGHT_DEBOUNCE_MS * 2);
      expect(validate.lastRunMode).toBeNull();
    });
  });

  // ─── clear ───────────────────────────────────────────────

  describe('clear', () => {
    it('清空所有 state', () => {
      validate.setIssues(
        [{ rule: 'pls_range', severity: 'error', message: 'a', location: {} }],
        'light',
      );
      validate.setFilter('error');
      validate.setRunning(true);
      validate.clear();
      expect(validate.issues).toEqual([]);
      expect(validate.lastRunMode).toBeNull();
      expect(validate.lastRunAt).toBeNull();
      expect(validate.isRunning).toBe(false);
      // filter 不被 clear 重置（只重置 issues 与运行状态）
      expect(validate.filter).toBe('error');
    });
  });
});
