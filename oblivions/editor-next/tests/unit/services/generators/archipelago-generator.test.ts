//
// ArchipelagoGenerator 单元测试（M8 主题生成器）
//
// 覆盖点：
//   - 默认参数：3 岛屿群链（差异化点：唯一多区域生成器）
//   - next_region/prev_region 双向链 + 环形 exit_links（差异化点）
//   - seed=0：随机种子
//   - seed=正整数：可复现
//   - generateRegion：重写为单岛屿算法 + 命名"岛屿 #X"（差异化点）
//   - 自动验证：runFullValidation 不产生 error 级 issue
//   - hideInRegionMode：regionCount 字段在单区域模式隐藏

import { describe, it, expect } from 'vitest';
import { ArchipelagoGenerator } from '@/services/generators/archipelago-generator';
import { runFullValidation } from '@/services/validate-rules';
import type { Pls, Pgroup } from '@/shared';

describe('ArchipelagoGenerator', () => {
  const gen = new ArchipelagoGenerator();

  describe('元信息', () => {
    it('id/name/description 非空', () => {
      expect(gen.id).toBe('archipelago');
      expect(gen.name).toBe('群岛链');
      expect(gen.description).toContain('岛屿');
    });

    it('getParamSchema 返回 7 个字段', () => {
      const keys = gen.getParamSchema().map((f) => f.key);
      expect(keys).toEqual([
        'regionCount',
        'cols',
        'rows',
        'landRadius',
        'reefRate',
        'vegetationRate',
        'seed',
      ]);
    });

    it('regionCount 字段 hideInRegionMode=true（差异化点）', () => {
      const field = gen.getParamSchema().find((f) => f.key === 'regionCount');
      expect(field?.hideInRegionMode).toBe(true);
    });

    it('getDefaultParams 与 schema default 一致', () => {
      const params = gen.getDefaultParams();
      expect(params['regionCount']).toBe(3);
      expect(params['cols']).toBe(10);
      expect(params['rows']).toBe(8);
      expect(params['landRadius']).toBe(0.38);
      expect(params['reefRate']).toBe(0.12);
      expect(params['vegetationRate']).toBe(0.1);
      expect(params['seed']).toBe(0);
    });
  });

  describe('默认参数 generate（多区域差异化点）', () => {
    const result = gen.generate(gen.getDefaultParams(), 42);

    it('产出 3 个 pgroup（差异化点：唯一多区域）', () => {
      expect(Object.keys(result.regions)).toHaveLength(3);
      expect(Object.keys(result.grids)).toHaveLength(3);
      expect(Object.keys(result.tiles)).toHaveLength(3);
    });

    it('每岛屿 10×8=80 格', () => {
      for (const pgroup of [1, 2, 3] as Pgroup[]) {
        const region = result.regions[pgroup]!;
        expect(region.cols).toBe(10);
        expect(region.rows).toBe(8);
        expect(Object.keys(result.tiles[pgroup]!)).toHaveLength(80);
      }
    });

    it('next_region/prev_region 双向链', () => {
      const r1 = result.regions[1 as Pgroup]!;
      const r2 = result.regions[2 as Pgroup]!;
      const r3 = result.regions[3 as Pgroup]!;
      expect(r1.next_region).toBe(2);
      expect(r2.prev_region).toBe(1);
      expect(r2.next_region).toBe(3);
      expect(r3.prev_region).toBe(2);
      expect(r1.prev_region).toBeNull();
      expect(r3.next_region).toBeNull();
    });

    it('环形 exit_links：每岛屿有 1 条 exit_link', () => {
      for (const pgroup of [1, 2, 3] as Pgroup[]) {
        const region = result.regions[pgroup]!;
        expect(region.exit_links).toHaveLength(1);
      }
    });

    it('最后岛屿 exit_links 链回首岛屿（环形差异化点）', () => {
      const lastRegion = result.regions[3 as Pgroup]!;
      const link = lastRegion.exit_links[0]!;
      expect(link.to_pgroup).toBe(1);
    });

    it('每岛屿 entrance_pls 与 exit_pls 不同（陆地范围内）', () => {
      for (const pgroup of [1, 2, 3] as Pgroup[]) {
        const region = result.regions[pgroup]!;
        expect(region.entrance_pls).not.toBeNull();
        expect(region.exit_pls).not.toBeNull();
        expect(region.entrance_pls).not.toBe(region.exit_pls);
      }
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

  describe('regionCount 边界', () => {
    it('regionCount=2 → 2 个岛屿', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), regionCount: 2 },
        42,
      );
      expect(Object.keys(r.regions)).toHaveLength(2);
      // 2 个岛屿也形成环形（首尾相接）
      const r1 = r.regions[1 as Pgroup]!;
      const r2 = r.regions[2 as Pgroup]!;
      expect(r1.next_region).toBe(2);
      expect(r2.next_region).toBeNull();
      expect(r2.exit_links[0]!.to_pgroup).toBe(1); // 环形
    });

    it('regionCount=6 → 6 个岛屿', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), regionCount: 6 },
        42,
      );
      expect(Object.keys(r.regions)).toHaveLength(6);
    });

    it('regionCount=1 被钳制为 2（min=2）', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), regionCount: 1 },
        42,
      );
      expect(Object.keys(r.regions)).toHaveLength(2);
    });
  });

  describe('land/reef/water 三态差异化点', () => {
    it('默认参数 generate 包含 standard（陆地）与 water（水域）floor', () => {
      const r = gen.generate(gen.getDefaultParams(), 42);
      const floorSet = new Set<string>();
      for (const pgroupStr of Object.keys(r.tiles)) {
        const tiles = r.tiles[Number(pgroupStr) as Pgroup]!;
        for (const plsStr of Object.keys(tiles)) {
          floorSet.add(tiles[Number(plsStr) as Pls]!.floor);
        }
      }
      expect(floorSet.has('standard') || floorSet.has('vegetation')).toBe(true); // 陆地
      expect(floorSet.has('water')).toBe(true); // 水域
    });

    it('reefRate=0.3 → 产生 abyss tide 不可通行暗礁', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), reefRate: 0.3 },
        42,
      );
      let hasReef = false;
      for (const pgroupStr of Object.keys(r.tiles)) {
        const tiles = r.tiles[Number(pgroupStr) as Pgroup]!;
        for (const plsStr of Object.keys(tiles)) {
          const t = tiles[Number(plsStr) as Pls]!;
          if (t.tide === 'abyss' && !t.passable) {
            hasReef = true;
            break;
          }
        }
      }
      // 不强制有暗礁（取决于随机），但参数生效即可
      expect(hasReef).toBe(true);
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
      const r1 = gen.generate(gen.getDefaultParams(), 555);
      const r2 = gen.generate(gen.getDefaultParams(), 555);
      expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    });
  });

  describe('generateRegion 单区域模式（重写为单岛屿算法）', () => {
    it('existingPgroups=[] 返回单岛屿区域', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region).toBeDefined();
      expect(r.tiles).toBeDefined();
      expect(Object.keys(r.tiles).length).toBe(10 * 8);
    });

    it('命名"岛屿 #X" 而非"群岛 #X"（差异化点）', () => {
      // generateRegion 不直接返回 pgroup，但 region.name 应为"岛屿 #X" 模板
      // 由于 pgroup 由 existingPgroups 推断（max+1），name 用推断的 pgroup
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      // existingPgroups=[] → newPgroup=1 → name="岛屿 #1"
      expect(r.region.name).toBe('岛屿 #1');
    });

    it('existingPgroups=[5] → name="岛屿 #6"', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, [5 as Pls]);
      expect(r.region.name).toBe('岛屿 #6');
    });

    it('单岛屿是孤立新区域，不建立区域链', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region.next_region).toBeNull();
      expect(r.region.prev_region).toBeNull();
      expect(r.region.exit_links).toEqual([]);
    });
  });
});
