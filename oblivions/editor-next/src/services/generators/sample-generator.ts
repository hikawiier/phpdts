//
// 示例生成器（对齐 NEW_DESIGN.md §3.7.6 + Dian.md O-4）
//
// 主题意图：最简单的随机生成器，用于演示 Generator 接口用法
//   - 单区域 pgroup=1 全填充 standard floor + shallow tide
//   - 按 obstacleRate 随机散布不可通行格
//   - 首尾格强制 passable=true 保证 entrance/exit 可达
//
// 算法差异化（与其他 4 个生成器对比）：
//   - 参考实现：最简单的随机噪声
//   - 单区域 + 4 邻居连通（其他生成器用 8 邻居）
//
// 单区域模式：复用 BaseGenerator 默认实现（取首区域 + remap pgroup + 清空区域链）

import type {
  GeneratorParams,
  GeneratorParamField,
  GeneratorFullResult,
  Pls,
  Floor,
  Tide,
} from '@/shared';
import { BaseGenerator } from './base-generator';
import { roll } from '@/shared';
import { registerGenerator } from './registry';

const FLOOR_OPTIONS: ReadonlyArray<Floor> = ['standard', 'water', 'vegetation', 'metal', 'magic'];
const TIDE_OPTIONS: ReadonlyArray<Tide> = ['shallow', 'deep', 'abyss'];

/**
 * 示例生成器
 *
 * 参考 implementation —— 子代理实现具体主题生成器时可参考本文件的实现模式：
 *   1. 继承 BaseGenerator
 *   2. 在 getParamSchema() 中声明参数（驱动 UI 自动渲染）
 *   3. 在 generate(params, seed) 中实现生成逻辑（纯函数）
 *   4. 在 main.ts 中调用 registerGenerator(new XxxGenerator())
 */
export class SampleGenerator extends BaseGenerator {
  constructor() {
    super(
      'sample',
      '示例：基础噪声',
      '最简单的随机生成器：单区域全填充 standard floor，按障碍率随机散布不可通行格。用于演示生成器接口。',
    );
  }

  getParamSchema(): GeneratorParamField[] {
    return [
      {
        key: 'cols',
        label: '网格列数',
        type: 'number',
        min: 4,
        max: 30,
        default: 8,
        hint: '4-30，cols × rows 须 ≤ 254',
      },
      {
        key: 'rows',
        label: '网格行数',
        type: 'number',
        min: 4,
        max: 30,
        default: 6,
        hint: '4-30，cols × rows 须 ≤ 254',
      },
      {
        key: 'obstacleRate',
        label: '障碍率',
        type: 'range',
        min: 0,
        max: 0.5,
        step: 0.05,
        default: 0.1,
        hint: '0-0.5，每格被标记为不可通行的概率',
      },
      {
        key: 'floor',
        label: '地板类型',
        type: 'select',
        options: FLOOR_OPTIONS.map((v) => ({ value: v, label: v })),
        default: 'standard',
      },
      {
        key: 'tide',
        label: '潮汐',
        type: 'select',
        options: TIDE_OPTIONS.map((v) => ({ value: v, label: v })),
        default: 'shallow',
      },
      {
        key: 'seed',
        label: '随机种子',
        type: 'number',
        min: 0,
        default: 0,
        hint: '0 = 使用随机种子；正整数 = 可复现结果',
      },
    ];
  }

  generate(params: GeneratorParams, seed?: number): GeneratorFullResult {
    const p = this.normalizeParams(params);
    const rng = this.makeRng(params, seed);

    const cols = p.cols;
    const rows = p.rows;
    this.assertGridSize(cols, rows);

    const pgroup = 1 as const;
    const total = cols * rows;
    const tiles: Record<Pls, ReturnType<typeof this.makeTile>> = {};

    for (let pls = 1; pls <= total; pls++) {
      const x = (pls - 1) % cols;
      const y = Math.floor((pls - 1) / cols);
      const isEntrance = pls === 1;
      const isExit = pls === total;
      const passable = isEntrance || isExit ? true : !roll(rng, p.obstacleRate);
      tiles[pls as Pls] = this.makeTile(x, y, {
        floor: p.floor as Floor,
        tide: p.tide as Tide,
        passable,
      });
    }

    // 8 方向邻居（复用 BaseGenerator 工具方法）
    this.computeAllNeighbors8(tiles, cols, rows);

    const region = this.makeMinimalRegion(
      pgroup,
      `示例区域 #${pgroup}`,
      cols,
      rows,
      1 as Pls,                    // entrance_pls
      total as Pls,                // exit_pls
    );

    return this.makeSingleRegionResult(region, tiles, cols, rows, pgroup);
  }

  private normalizeParams(params: GeneratorParams): {
    cols: number;
    rows: number;
    obstacleRate: number;
    floor: string;
    tide: string;
  } {
    const defaults = this.getDefaultParams();
    const merged: GeneratorParams = { ...defaults, ...(params ?? {}) };
    const cols = Math.max(4, Math.min(30, Math.floor(Number(merged['cols']) ?? 8)));
    const rows = Math.max(4, Math.min(30, Math.floor(Number(merged['rows']) ?? 6)));
    const obstacleRate = Math.max(0, Math.min(0.5, Number(merged['obstacleRate']) ?? 0));
    const floor = typeof merged['floor'] === 'string' && FLOOR_OPTIONS.includes(merged['floor'] as Floor)
      ? merged['floor']
      : 'standard';
    const tide = typeof merged['tide'] === 'string' && TIDE_OPTIONS.includes(merged['tide'] as Tide)
      ? merged['tide']
      : 'shallow';
    return { cols, rows, obstacleRate, floor, tide };
  }
}

/**
 * 注册示例生成器（main.ts 启动时调用）
 */
export function registerSampleGenerator(): boolean {
  return registerGenerator(new SampleGenerator());
}
