//
// WetlandGenerator 单元测试（M8 主题生成器）
//
// 覆盖点：
//   - 默认参数：16×12 渐变湿地，shallow/deep/abyss 三档 tide（差异化点）
//   - seed=0：随机种子
//   - seed=正整数：可复现
//   - generateRegion：existingPgroups=[] 返回单区域
//   - 自动验证：runFullValidation 不产生 error 级 issue
//   - 差异化点：preset_safe=true 安全岛 + 三档 tide 渐变 + noiseLevel 边界扰动

import { describe, it, expect } from 'vitest';
import { WetlandGenerator } from '@/services/generators/wetland-generator';
import { runFullValidation } from '@/services/validate-rules';
import type { Pls } from '@/shared';

describe('WetlandGenerator', () => {
  const gen = new WetlandGenerator();

  describe('元信息', () => {
    it('id/name/description 非空', () => {
      expect(gen.id).toBe('wetland');
      expect(gen.name).toBe('潮汐湿地');
      expect(gen.description).toContain('湿地');
    });

    it('getParamSchema 返回 8 个字段', () => {
      const keys = gen.getParamSchema().map((f) => f.key);
      expect(keys).toEqual([
        'cols',
        'rows',
        'gradient',
        'noiseLevel',
        'safeIslandRate',
        'abyssImpassableRate',
        'drylandRate',
        'seed',
      ]);
    });

    it('getDefaultParams 与 schema default 一致', () => {
      const params = gen.getDefaultParams();
      expect(params['cols']).toBe(16);
      expect(params['rows']).toBe(12);
      expect(params['gradient']).toBe('diagonal');
      expect(params['noiseLevel']).toBe(0.15);
      expect(params['safeIslandRate']).toBe(0.06);
      expect(params['abyssImpassableRate']).toBe(0.3);
      expect(params['drylandRate']).toBe(0.2);
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

    it('三档 tide 共存（差异化点：shallow/deep/abyss）', () => {
      const tiles = result.tiles[1]!;
      const tideSet = new Set<string>();
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        tideSet.add(t.tide);
      }
      expect(tideSet.has('shallow')).toBe(true);
      expect(tideSet.has('deep')).toBe(true);
      expect(tideSet.has('abyss')).toBe(true);
    });

    it('入口（左上角 shallow 端）可通行 + preset_safe=true', () => {
      const tiles = result.tiles[1]!;
      const entrance = tiles[1 as Pls]!;
      expect(entrance.passable).toBe(true);
      expect(entrance.preset_safe).toBe(true);
      expect(entrance.tide).toBe('shallow');
    });

    it('出口（右下角 abyss 端）可通行 + preset_safe=true', () => {
      const tiles = result.tiles[1]!;
      const exit = tiles[192 as Pls]!;
      expect(exit.passable).toBe(true);
      expect(exit.preset_safe).toBe(true);
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

  describe('gradient 方向', () => {
    it('horizontal: 左 shallow → 右 abyss', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), gradient: 'horizontal' },
        42,
      );
      const tiles = r.tiles[1]!;
      const left = tiles[1 as Pls]!; // (0,0) 左上
      const right = tiles[16 as Pls]!; // (15,0) 右上
      // left tide 应为 shallow（t<0.4）
      expect(['shallow', 'deep']).toContain(left.tide);
      // right tide 应为 abyss（t>0.75）
      expect(['abyss', 'deep']).toContain(right.tide);
    });

    it('vertical: 上 shallow → 下 abyss', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), gradient: 'vertical' },
        42,
      );
      const tiles = r.tiles[1]!;
      const top = tiles[1 as Pls]!; // (0,0)
      const bottom = tiles[192 as Pls]!; // (15,11) 右下
      expect(['shallow', 'deep']).toContain(top.tide);
      expect(['abyss', 'deep']).toContain(bottom.tide);
    });

    it('diagonal: 对角线渐变', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), gradient: 'diagonal' },
        42,
      );
      const tiles = r.tiles[1]!;
      const topLeft = tiles[1 as Pls]!;
      const bottomRight = tiles[192 as Pls]!;
      expect(['shallow', 'deep']).toContain(topLeft.tide);
      expect(['abyss', 'deep']).toContain(bottomRight.tide);
    });
  });

  describe('safeIslandRate 安全岛差异化点', () => {
    it('safeIslandRate=0 → 不产生 preset_safe=true（除入口出口外）', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), safeIslandRate: 0 },
        42,
      );
      const tiles = r.tiles[1]!;
      let safeCount = 0;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.preset_safe) safeCount++;
      }
      // 仅入口 + 出口 = 2
      expect(safeCount).toBe(2);
    });

    it('safeIslandRate=0.2 → 产生 preset_safe=true 安全岛', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), safeIslandRate: 0.2 },
        42,
      );
      const tiles = r.tiles[1]!;
      let safeCount = 0;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.preset_safe) safeCount++;
      }
      // 至少入口 + 出口 + 一些安全岛
      expect(safeCount).toBeGreaterThan(2);
    });
  });

  describe('abyssImpassableRate 深渊不可通行率', () => {
    it('abyssImpassableRate=0 → 所有 abyss 格可通行', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), abyssImpassableRate: 0 },
        42,
      );
      const tiles = r.tiles[1]!;
      for (const plsStr of Object.keys(tiles)) {
        const t = tiles[Number(plsStr) as Pls]!;
        if (t.tide === 'abyss' && !t.preset_safe) {
          expect(t.passable).toBe(true);
        }
      }
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
      const r1 = gen.generate(gen.getDefaultParams(), 777);
      const r2 = gen.generate(gen.getDefaultParams(), 777);
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
