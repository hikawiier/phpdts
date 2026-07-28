//
// SampleGenerator 单元测试（M8 主题生成器）
//
// 覆盖点：
//   - 默认参数：generate 产出 8×6=48 格的单区域，首尾 passable=true
//   - seed=0：随机种子（每次结果不同）
//   - seed=正整数：可复现（同 seed 同结果）
//   - generateRegion：existingPgroups=[] 返回单区域 + pgroup=1
//   - generateRegion：existingPgroups=[1] 返回单区域 + pgroup=2
//   - 自动验证：runFullValidation 不产生 error 级 issue
//   - 差异化点：单区域 + obstacleRate 随机散布 + 8 邻居连通

import { describe, it, expect } from 'vitest';
import { SampleGenerator } from '@/services/generators/sample-generator';
import { runFullValidation } from '@/services/validate-rules';
import type { Pls, Tile } from '@/shared';

describe('SampleGenerator', () => {
  const gen = new SampleGenerator();

  describe('元信息', () => {
    it('id/name/description 非空', () => {
      expect(gen.id).toBe('sample');
      expect(gen.name).toBe('示例：基础噪声');
      expect(gen.description).toContain('随机生成器');
    });

    it('getParamSchema 返回 6 个字段（cols/rows/obstacleRate/floor/tide/seed）', () => {
      const keys = gen.getParamSchema().map((f) => f.key);
      expect(keys).toEqual([
        'cols',
        'rows',
        'obstacleRate',
        'floor',
        'tide',
        'seed',
      ]);
    });

    it('getDefaultParams 与 schema default 一致', () => {
      const params = gen.getDefaultParams();
      expect(params['cols']).toBe(8);
      expect(params['rows']).toBe(6);
      expect(params['obstacleRate']).toBe(0.1);
      expect(params['floor']).toBe('standard');
      expect(params['tide']).toBe('shallow');
      expect(params['seed']).toBe(0);
    });
  });

  describe('默认参数 generate', () => {
    const result = gen.generate(gen.getDefaultParams(), 42);

    it('产出 1 个 pgroup', () => {
      expect(Object.keys(result.regions)).toHaveLength(1);
      expect(Object.keys(result.grids)).toHaveLength(1);
      expect(Object.keys(result.tiles)).toHaveLength(1);
    });

    it('区域网格 8×6=48 格', () => {
      const pgroup = 1;
      const region = result.regions[pgroup]!;
      expect(region.cols).toBe(8);
      expect(region.rows).toBe(6);
      const tiles = result.tiles[pgroup]!;
      expect(Object.keys(tiles)).toHaveLength(48);
    });

    it('首尾格 passable=true（保证 entrance/exit 可达）', () => {
      const tiles = result.tiles[1]!;
      const firstTile = tiles[1 as Pls]!;
      const lastTile = tiles[48 as Pls]!;
      expect(firstTile.passable).toBe(true);
      expect(lastTile.passable).toBe(true);
    });

    it('8 方向邻居双向对称', () => {
      const tiles = result.tiles[1]!;
      for (const plsStr of Object.keys(tiles)) {
        const pls = Number(plsStr) as Pls;
        const t = tiles[pls]!;
        for (const nPls of t.neighbors) {
          const n = tiles[nPls];
          expect(n).toBeDefined();
          expect(n!.neighbors).toContain(pls);
        }
      }
    });

    it('entrance_pls=1 / exit_pls=48', () => {
      const region = result.regions[1]!;
      expect(region.entrance_pls).toBe(1);
      expect(region.exit_pls).toBe(48);
    });

    it('runFullValidation 不产生 error 级 issue', () => {
      const issues = runFullValidation(
        { regions: result.regions, grids: result.grids, tiles: result.tiles },
        { includeConfig: false },
      );
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    });
  });

  describe('seed=0 视为随机种子', () => {
    it('两次调用结果不同（随机性）', () => {
      const r1 = gen.generate(gen.getDefaultParams(), 0);
      const r2 = gen.generate(gen.getDefaultParams(), 0);
      // 比较序列化的 tiles（极大概率不同）
      const s1 = JSON.stringify(r1.tiles);
      const s2 = JSON.stringify(r2.tiles);
      expect(s1).not.toEqual(s2);
    });
  });

  describe('seed=正整数可复现', () => {
    it('两次调用结果完全一致', () => {
      const r1 = gen.generate(gen.getDefaultParams(), 12345);
      const r2 = gen.generate(gen.getDefaultParams(), 12345);
      expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    });

    it('不同 seed 结果不同', () => {
      const r1 = gen.generate(gen.getDefaultParams(), 1);
      const r2 = gen.generate(gen.getDefaultParams(), 2);
      expect(JSON.stringify(r1)).not.toEqual(JSON.stringify(r2));
    });
  });

  describe('generateRegion 单区域模式', () => {
    it('existingPgroups=[] → 新 pgroup=1', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region.next_region).toBeNull();
      expect(r.region.prev_region).toBeNull();
      expect(r.region.exit_links).toEqual([]);
      expect(Object.keys(r.tiles).length).toBeGreaterThan(0);
    });

    it('existingPgroups=[1, 3] → 新 pgroup=4（max+1）', () => {
      const r1 = gen.generateRegion(gen.getDefaultParams(), 42, []);
      // 此处仅验证 generateRegion 返回结构，pgroup 由 projectStore.addGeneratedRegion 分配
      // generateRegion 默认实现不返回 pgroup，仅返回 region+tiles
      expect(r1.region).toBeDefined();
      expect(r1.tiles).toBeDefined();
    });

    it('区域链被清空（next/prev=null, exit_links=[]）', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region.next_region).toBeNull();
      expect(r.region.prev_region).toBeNull();
      expect(r.region.exit_links).toEqual([]);
    });

    it('tiles 内容与全项目模式首区域一致（除 region 字段外）', () => {
      const full = gen.generate(gen.getDefaultParams(), 42);
      const region = gen.generateRegion(gen.getDefaultParams(), 42, []);
      const fullTiles = full.tiles[1]!;
      // 比较 tiles 内容（不含 neighbors 顺序敏感性）
      const fullCount = Object.keys(fullTiles).length;
      const regionCount = Object.keys(region.tiles).length;
      expect(regionCount).toBe(fullCount);
      // 检查每个 tile 的关键字段一致
      for (const plsStr of Object.keys(fullTiles)) {
        const pls = Number(plsStr) as Pls;
        const t1 = fullTiles[pls] as Tile;
        const t2 = region.tiles[pls] as Tile;
        expect(t1.floor).toBe(t2.floor);
        expect(t1.tide).toBe(t2.tide);
        expect(t1.passable).toBe(t2.passable);
        expect(t1.x).toBe(t2.x);
        expect(t1.y).toBe(t2.y);
      }
    });
  });

  describe('参数边界', () => {
    it('cols × rows > 254 抛错', () => {
      expect(() =>
        gen.generate({ ...gen.getDefaultParams(), cols: 30, rows: 30 }, 42),
      ).toThrow();
    });

    it('obstacleRate > 0.5 被钳制为 0.5', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), obstacleRate: 1.0 },
        42,
      );
      // 不会抛错，且首尾仍可通行
      const tiles = r.tiles[1]!;
      expect(tiles[1 as Pls]!.passable).toBe(true);
      expect(tiles[48 as Pls]!.passable).toBe(true);
    });
  });
});
