//
// RuinsGenerator 单元测试（对齐 NEW_DESIGN.md §3.7.6 + Dian.md O-5）
//
// 覆盖点：
//   - 默认参数：16×12 废墟城市，height 分层 0/1/2（差异化点）
//   - destructible=true 标记可破坏废墟（差异化点）
//   - seed=0：随机种子
//   - seed=正整数：可复现
//   - generateRegion：existingPgroups=[] 返回单区域
//   - 自动验证：runFullValidation 不产生 error 级 issue

import { describe, it, expect } from 'vitest';
import { RuinsGenerator } from '@/services/generators/ruins-generator';
import { runFullValidation } from '@/services/validate-rules';
import type { Pls } from '@/shared';

describe('RuinsGenerator', () => {
  const gen = new RuinsGenerator();

  describe('元信息', () => {
    it('id/name/description 非空', () => {
      expect(gen.id).toBe('ruins');
      expect(gen.name).toBe('废墟城市');
      expect(gen.description).toContain('废墟');
    });

    it('getParamSchema 返回 9 个字段', () => {
      const keys = gen.getParamSchema().map((f) => f.key);
      expect(keys).toEqual([
        'cols',
        'rows',
        'clusterCount',
        'towerRadius',
        'buildingRadius',
        'towerImpassableRate',
        'buildingImpassableRate',
        'destructibleRate',
        'seed',
      ]);
    });

    it('getDefaultParams 与 schema default 一致', () => {
      const params = gen.getDefaultParams();
      expect(params['cols']).toBe(16);
      expect(params['rows']).toBe(12);
      expect(params['clusterCount']).toBe(4);
      expect(params['towerRadius']).toBe(1.0);
      expect(params['buildingRadius']).toBe(2.0);
      expect(params['towerImpassableRate']).toBe(0.8);
      expect(params['buildingImpassableRate']).toBe(0.2);
      expect(params['destructibleRate']).toBe(0.7);
      expect(params['seed']).toBe(0);
    });
  });

  describe('默认参数 generate', () => {
    const result = gen.generate(gen.getDefaultParams(), 42);

    it('产出 1 个 pgroup', () => {
      expect(Object.keys(result.regions)).toHaveLength(1);
      expect(Object.keys(result.tiles)).toHaveLength(1);
    });

    it('16×12=192 格', () => {
      const region = result.regions[1]!;
      expect(region.cols).toBe(16);
      expect(region.rows).toBe(12);
      expect(Object.keys(result.tiles[1]!)).toHaveLength(192);
    });

    it('height 分层 0/1/2 共存（差异化点）', () => {
      const tiles = result.tiles[1]!;
      const heightSet = new Set<number>();
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        heightSet.add(t.height);
      }
      expect(heightSet.has(0)).toBe(true);
      expect(heightSet.has(1)).toBe(true);
      expect(heightSet.has(2)).toBe(true);
    });

    it('height=2 塔楼 floor=magic', () => {
      const tiles = result.tiles[1]!;
      let hasTower = false;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.height === 2) {
          hasTower = true;
          expect(t.floor).toBe('magic');
          expect(t.destructible).toBe(false);
        }
      }
      expect(hasTower).toBe(true);
    });

    it('height=1 废墟 floor=metal', () => {
      const tiles = result.tiles[1]!;
      let hasRuin = false;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.height === 1) {
          hasRuin = true;
          expect(t.floor).toBe('metal');
        }
      }
      expect(hasRuin).toBe(true);
    });

    it('height=0 街道 floor=standard + passable=true', () => {
      const tiles = result.tiles[1]!;
      let hasStreet = false;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.height === 0) {
          hasStreet = true;
          expect(t.floor).toBe('standard');
          expect(t.passable).toBe(true);
          expect(t.destructible).toBe(false);
        }
      }
      expect(hasStreet).toBe(true);
    });

    it('入口/出口被强制为街道（height=0）', () => {
      const tiles = result.tiles[1]!;
      const entrance = tiles[1 as Pls]!;
      const exit = tiles[192 as Pls]!;
      expect(entrance.height).toBe(0);
      expect(entrance.floor).toBe('standard');
      expect(entrance.passable).toBe(true);
      expect(exit.height).toBe(0);
      expect(exit.floor).toBe('standard');
      expect(exit.passable).toBe(true);
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

  describe('destructible=true 差异化点', () => {
    it('destructibleRate=1.0 → 所有 height=1 废墟 destructible=true', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), destructibleRate: 1.0 },
        42,
      );
      const tiles = r.tiles[1]!;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.height === 1) {
          expect(t.destructible).toBe(true);
        }
      }
    });

    it('destructibleRate=0.3 → height=1 废墟 destructible 比例约 0.7 区间', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), destructibleRate: 0.3 },
        42,
      );
      const tiles = r.tiles[1]!;
      let ruinCount = 0;
      let destrCount = 0;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.height === 1) {
          ruinCount++;
          if (t.destructible) destrCount++;
        }
      }
      expect(ruinCount).toBeGreaterThan(0);
      // 比例应在 0.3 附近（允许波动）
      expect(destrCount / ruinCount).toBeLessThan(0.7);
    });
  });

  describe('clusterCount 簇数量', () => {
    it('clusterCount=2 → 至少有塔楼（height=2）', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), clusterCount: 2 },
        42,
      );
      const tiles = r.tiles[1]!;
      let towerCount = 0;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.height === 2) towerCount++;
      }
      expect(towerCount).toBeGreaterThan(0);
    });
  });

  describe('seed=0 视为随机种子', () => {
    it('两次调用结果不同', () => {
      const r1 = gen.generate(gen.getDefaultParams(), 0);
      const r2 = gen.generate(gen.getDefaultParams(), 0);
      expect(JSON.stringify(r1.tiles)).not.toEqual(JSON.stringify(r2.tiles));
    });
  });

  describe('seed=正整数可复现', () => {
    it('同 seed 同结果', () => {
      const r1 = gen.generate(gen.getDefaultParams(), 888);
      const r2 = gen.generate(gen.getDefaultParams(), 888);
      expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    });
  });

  describe('generateRegion 单区域模式', () => {
    it('existingPgroups=[] 返回单区域', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region).toBeDefined();
      expect(r.tiles).toBeDefined();
      expect(Object.keys(r.tiles).length).toBe(16 * 12);
    });

    it('区域链被清空', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region.next_region).toBeNull();
      expect(r.region.prev_region).toBeNull();
      expect(r.region.exit_links).toEqual([]);
    });
  });
});
