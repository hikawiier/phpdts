//
// 生成器集成测试：生成 → projectStore 写入 → runFullValidation 闭环
// （M8 主题生成器）
//
// 覆盖点：
//   - 全项目模式：generate → loadProject 覆盖 → runFull 不产生 error
//   - 单区域模式：generateRegion → addGeneratedRegion 追加 → runFull 不产生 error
//   - 5 个生成器（sample / labyrinth / wetland / ruins / archipelago）全量集成验证
//   - 单区域模式连续追加：archipelago 多次追加区域
//   - 双模式最终结果可被 runFullValidation 接受（无 error 级 issue）
//
// 设计意图（对齐 §3.7.6 "生成 → 验证 → 修复"闭环）：
//   - 生成器只产出空间结构，不写 DB / 不触碰 configStore
//   - 写入 projectStore 后由调用方运行 Full 验证（includeConfig=false 保持生成器纯函数性）
//   - 任何生成器产出的项目应能通过 Light + Full 验证（无 error 级 issue）

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '@/stores/projectStore';
import { useValidateStore } from '@/stores/validateStore';
import { SampleGenerator } from '@/services/generators/sample-generator';
import { LabyrinthGenerator } from '@/services/generators/labyrinth-generator';
import { WetlandGenerator } from '@/services/generators/wetland-generator';
import { RuinsGenerator } from '@/services/generators/ruins-generator';
import { ArchipelagoGenerator } from '@/services/generators/archipelago-generator';
import { runFullValidation } from '@/services/validate-rules';
import type { Pgroup } from '@/shared';

describe('生成器集成测试（generate → projectStore → runFullValidation 闭环）', () => {
  let project: ReturnType<typeof useProjectStore>;
  let validate: ReturnType<typeof useValidateStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    project = useProjectStore();
    validate = useValidateStore();
  });

  /** 断言 validate.issues 中无 error 级条目 */
  function expectNoErrors(): void {
    const errors = validate.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  }

  // ─── 全项目模式集成 ─────────────────────────────────

  describe('全项目模式（loadProject 覆盖）', () => {
    it('SampleGenerator：generate → loadProject → runFull 无 error', () => {
      const gen = new SampleGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      project.loadProject({
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      });
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('LabyrinthGenerator：generate → loadProject → runFull 无 error', () => {
      const gen = new LabyrinthGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      project.loadProject({
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      });
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('WetlandGenerator：generate → loadProject → runFull 无 error', () => {
      const gen = new WetlandGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      project.loadProject({
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      });
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('RuinsGenerator：generate → loadProject → runFull 无 error', () => {
      const gen = new RuinsGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      project.loadProject({
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      });
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('ArchipelagoGenerator：generate → loadProject → runFull 无 error（多区域）', () => {
      const gen = new ArchipelagoGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      project.loadProject({
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      });
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });
  });

  // ─── 单区域模式集成 ─────────────────────────────────

  describe('单区域模式（addGeneratedRegion 追加）', () => {
    it('SampleGenerator：generateRegion → addGeneratedRegion → runFull 无 error', () => {
      const gen = new SampleGenerator();
      const result = gen.generateRegion(gen.getDefaultParams(), 42, []);
      const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
      expect(newPgroup).toBe(1);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('LabyrinthGenerator：generateRegion → addGeneratedRegion → runFull 无 error', () => {
      const gen = new LabyrinthGenerator();
      const result = gen.generateRegion(gen.getDefaultParams(), 42, []);
      const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
      expect(newPgroup).toBe(1);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('WetlandGenerator：generateRegion → addGeneratedRegion → runFull 无 error', () => {
      const gen = new WetlandGenerator();
      const result = gen.generateRegion(gen.getDefaultParams(), 42, []);
      const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
      expect(newPgroup).toBe(1);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('RuinsGenerator：generateRegion → addGeneratedRegion → runFull 无 error', () => {
      const gen = new RuinsGenerator();
      const result = gen.generateRegion(gen.getDefaultParams(), 42, []);
      const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
      expect(newPgroup).toBe(1);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('ArchipelagoGenerator：generateRegion（单岛屿）→ addGeneratedRegion → runFull 无 error', () => {
      const gen = new ArchipelagoGenerator();
      const result = gen.generateRegion(gen.getDefaultParams(), 42, []);
      const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
      expect(newPgroup).toBe(1);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });
  });

  // ─── 多次追加：pgroup 自动分配 ─────────────────────

  describe('多次追加区域：pgroup 自动分配', () => {
    it('连续追加 3 个 SampleGenerator 区域，pgroup=1/2/3', () => {
      const gen = new SampleGenerator();
      const pgroups: Pgroup[] = [];
      for (let i = 0; i < 3; i++) {
        const existingPgroups = Object.keys(project.project.regions)
          .map(Number)
          .sort((a, b) => a - b) as Pgroup[];
        const result = gen.generateRegion(gen.getDefaultParams(), 42 + i, existingPgroups);
        const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
        expect(newPgroup).not.toBeNull();
        pgroups.push(newPgroup as Pgroup);
      }
      expect(pgroups).toEqual([1, 2, 3]);
      expect(project.regionCount).toBe(3);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('混合追加：sample + labyrinth + wetland + ruins + archipelago（5 区域）', () => {
      const generators = [
        new SampleGenerator(),
        new LabyrinthGenerator(),
        new WetlandGenerator(),
        new RuinsGenerator(),
        new ArchipelagoGenerator(),
      ];
      const pgroups: Pgroup[] = [];
      for (let i = 0; i < generators.length; i++) {
        const gen = generators[i]!;
        const existingPgroups = Object.keys(project.project.regions)
          .map(Number)
          .sort((a, b) => a - b) as Pgroup[];
        const result = gen.generateRegion(gen.getDefaultParams(), 100 + i, existingPgroups);
        const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
        expect(newPgroup).not.toBeNull();
        pgroups.push(newPgroup as Pgroup);
      }
      expect(pgroups).toEqual([1, 2, 3, 4, 5]);
      expect(project.regionCount).toBe(5);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });
  });

  // ─── 全项目模式覆盖式：原有数据被清空 ──────────────

  describe('全项目模式覆盖式', () => {
    it('原有 5 区域，全项目生成后区域数等于生成器产出区域数', () => {
      // 先用 5 个生成器追加 5 个区域
      const generators = [
        new SampleGenerator(),
        new LabyrinthGenerator(),
        new WetlandGenerator(),
        new RuinsGenerator(),
        new ArchipelagoGenerator(),
      ];
      for (let i = 0; i < generators.length; i++) {
        const gen = generators[i]!;
        const existingPgroups = Object.keys(project.project.regions)
          .map(Number)
          .sort((a, b) => a - b) as Pgroup[];
        const result = gen.generateRegion(gen.getDefaultParams(), 100 + i, existingPgroups);
        project.addGeneratedRegion(result.region, result.tiles);
      }
      expect(project.regionCount).toBe(5);

      // 全项目模式：用 LabyrinthGenerator 覆盖（单区域）
      const labGen = new LabyrinthGenerator();
      const fullResult = labGen.generate(labGen.getDefaultParams(), 42);
      project.loadProject({
        regions: fullResult.regions,
        grids: fullResult.grids,
        tiles: fullResult.tiles,
      });
      // LabyrinthGenerator 是单区域生成器，应只剩 1 个 pgroup
      expect(project.regionCount).toBe(1);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });

    it('ArchipelagoGenerator 覆盖：3 岛屿群链 + 环形 exit_links 通过验证', () => {
      const archGen = new ArchipelagoGenerator();
      const fullResult = archGen.generate(archGen.getDefaultParams(), 42);
      project.loadProject({
        regions: fullResult.regions,
        grids: fullResult.grids,
        tiles: fullResult.tiles,
      });
      expect(project.regionCount).toBe(3);
      validate.runFull({ includeConfig: false });
      expectNoErrors();
    });
  });

  // ─── 验证集成：直接调用 runFullValidation ──────────

  describe('直接调用 runFullValidation 集成', () => {
    it('sample 全项目模式直接 runFullValidation 不产生 error', () => {
      const gen = new SampleGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      const mapProject = {
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      };
      const issues = runFullValidation(mapProject, { includeConfig: false });
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    });

    it('archipelago 全项目模式（多区域 + 环形 exit_links）直接 runFullValidation 不产生 error', () => {
      const gen = new ArchipelagoGenerator();
      const result = gen.generate(gen.getDefaultParams(), 42);
      const mapProject = {
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      };
      const issues = runFullValidation(mapProject, { includeConfig: false });
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    });
  });

  // ─── 种子化可复现性集成 ────────────────────────────

  describe('种子化可复现性', () => {
    it('相同正整数 seed 两次 generate 产出相同结构（SampleGenerator）', () => {
      const gen = new SampleGenerator();
      const a = gen.generate(gen.getDefaultParams(), 12345);
      const b = gen.generate(gen.getDefaultParams(), 12345);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('相同正整数 seed 两次 generate 产出相同结构（ArchipelagoGenerator）', () => {
      const gen = new ArchipelagoGenerator();
      const a = gen.generate(gen.getDefaultParams(), 999);
      const b = gen.generate(gen.getDefaultParams(), 999);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('seed=0 两次 generate 产出可能不同（随机种子）', () => {
      const gen = new SampleGenerator();
      const a = gen.generate(gen.getDefaultParams(), 0);
      const b = gen.generate(gen.getDefaultParams(), 0);
      // 极低概率相同（不强制不等，仅断言可调用）
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });
  });
});
