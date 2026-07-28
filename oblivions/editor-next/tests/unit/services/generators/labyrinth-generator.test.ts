//
// LabyrinthGenerator 单元测试（M8 主题生成器）
//
// 覆盖点：
//   - 默认参数：13×11 迷宫，cols/rows 强制奇数（差异化点）
//   - seed=0：随机种子（每次结果不同）
//   - seed=正整数：可复现
//   - generateRegion：existingPgroups=[] 返回单区域
//   - 自动验证：runFullValidation 不产生 error 级 issue
//   - 差异化点：递归回溯迷宫 + 4 邻居挖通路 + extraOpenings 制造环线

import { describe, it, expect } from 'vitest';
import { LabyrinthGenerator } from '@/services/generators/labyrinth-generator';
import { runFullValidation } from '@/services/validate-rules';
import type { Pls } from '@/shared';

describe('LabyrinthGenerator', () => {
  const gen = new LabyrinthGenerator();

  describe('元信息', () => {
    it('id/name/description 非空', () => {
      expect(gen.id).toBe('labyrinth');
      expect(gen.name).toBe('迷宫');
      expect(gen.description).toContain('迷宫');
    });

    it('getParamSchema 返回 5 个字段', () => {
      const keys = gen.getParamSchema().map((f) => f.key);
      expect(keys).toEqual(['cols', 'rows', 'extraOpenings', 'wallFloor', 'seed']);
    });

    it('getDefaultParams 与 schema default 一致', () => {
      const params = gen.getDefaultParams();
      expect(params['cols']).toBe(13);
      expect(params['rows']).toBe(11);
      expect(params['extraOpenings']).toBe(0.1);
      expect(params['wallFloor']).toBe('metal');
      expect(params['seed']).toBe(0);
    });
  });

  describe('默认参数 generate', () => {
    const result = gen.generate(gen.getDefaultParams(), 42);

    it('产出 1 个 pgroup', () => {
      expect(Object.keys(result.regions)).toHaveLength(1);
      expect(Object.keys(result.tiles)).toHaveLength(1);
    });

    it('cols/rows 强制奇数（差异化点）', () => {
      const region = result.regions[1]!;
      // 默认 13×11 已是奇数
      expect(region.cols % 2).toBe(1);
      expect(region.rows % 2).toBe(1);
      expect(region.cols).toBe(13);
      expect(region.rows).toBe(11);
    });

    it('总格数 = 13×11=143', () => {
      const tiles = result.tiles[1]!;
      expect(Object.keys(tiles)).toHaveLength(143);
    });

    it('通路格 standard floor / shallow tide / passable=true', () => {
      const tiles = result.tiles[1]!;
      // 入口（1,1）位置 = pls = 1*cols + 1 + 1 = 13+2 = 15
      const entrancePls = (1 * 13 + 1 + 1) as Pls;
      const entranceTile = tiles[entrancePls]!;
      expect(entranceTile.floor).toBe('standard');
      expect(entranceTile.tide).toBe('shallow');
      expect(entranceTile.passable).toBe(true);
    });

    it('墙壁格 metal floor / abyss tide / passable=false', () => {
      const tiles = result.tiles[1]!;
      // 角落 (0,0) = pls=1 是墙
      const cornerTile = tiles[1 as Pls]!;
      expect(cornerTile.floor).toBe('metal');
      expect(cornerTile.tide).toBe('abyss');
      expect(cornerTile.passable).toBe(false);
    });

    it('入口（1,1）与出口（cols-2,rows-2）皆为通路', () => {
      const cols = 13, rows = 11;
      const entrancePls = (1 * cols + 1 + 1) as Pls;
      const exitPls = ((rows - 2) * cols + (cols - 2) + 1) as Pls;
      const tiles = result.tiles[1]!;
      expect(tiles[entrancePls]!.passable).toBe(true);
      expect(tiles[exitPls]!.passable).toBe(true);
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

  describe('cols/rows 偶数自动减一', () => {
    it('cols=12 自动调整为 11', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), cols: 12 },
        42,
      );
      expect(r.regions[1]!.cols).toBe(11);
    });

    it('rows=10 自动调整为 9', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), rows: 10 },
        42,
      );
      expect(r.regions[1]!.rows).toBe(9);
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
      const r1 = gen.generate(gen.getDefaultParams(), 999);
      const r2 = gen.generate(gen.getDefaultParams(), 999);
      expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
    });
  });

  describe('extraOpenings 差异化点', () => {
    it('extraOpenings=0 → 完美迷宫（无额外开口）', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), extraOpenings: 0 },
        42,
      );
      // 不抛错即视为成功
      expect(Object.keys(r.tiles[1]!)).toHaveLength(13 * 11);
    });

    it('extraOpenings=0.3 → 多路径环线', () => {
      const r = gen.generate(
        { ...gen.getDefaultParams(), extraOpenings: 0.3 },
        42,
      );
      expect(Object.keys(r.tiles[1]!)).toHaveLength(13 * 11);
    });
  });

  describe('generateRegion 单区域模式', () => {
    it('existingPgroups=[] 返回单区域', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region).toBeDefined();
      expect(r.tiles).toBeDefined();
      expect(Object.keys(r.tiles).length).toBe(13 * 11);
    });

    it('区域链被清空', () => {
      const r = gen.generateRegion(gen.getDefaultParams(), 42, []);
      expect(r.region.next_region).toBeNull();
      expect(r.region.prev_region).toBeNull();
      expect(r.region.exit_links).toEqual([]);
    });
  });
});
