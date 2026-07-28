// @module O 内容工具箱
//
// 迷宫生成器（M8 主题生成器）
//
// 主题意图：模拟墙廊密布的迷宫
//   - 递归回溯算法生成完美迷宫（从 entrance 到任意通路格恰有一条路径）
//   - 通路格 standard floor / shallow tide / passable=true
//   - 墙壁格 metal floor / abyss tide / passable=false
//   - extraOpenings 在完美迷宫上随机打通额外墙，制造多路径环线
//
// 算法差异化（与 sample/archipelago/wetland/ruins 对比）：
//   - 单区域 + 完美迷宫：递归回溯算法保证单解
//   - 二值地图：仅 passable / impassable 两类，无渐变
//   - cols/rows 强制奇数（迷宫算法要求，偶数自动减一）
//   - extraOpenings 制造环线（差异化点）
//   - 4 邻居连通：迷宫本质 4 连通（对角邻居总是墙）
//
// 单区域模式：复用 BaseGenerator 默认实现

import type {
  GeneratorParams,
  GeneratorParamField,
  GeneratorFullResult,
  Pls,
  Floor,
} from '@/shared';
import { BaseGenerator, DIRS_4_STEP2 } from './base-generator';
import { roll, pick } from '@/shared';
import { registerGenerator } from './registry';

const WALL_FLOOR_OPTIONS: ReadonlyArray<Floor> = ['metal', 'vegetation', 'magic'];

interface NormalizedParams {
  cols: number;
  rows: number;
  extraOpenings: number;
  wallFloor: Floor;
}

export class LabyrinthGenerator extends BaseGenerator {
  constructor() {
    super(
      'labyrinth',
      '迷宫',
      '递归回溯迷宫：单区域内 4 方向递归回溯生成完美迷宫，可选打通额外墙制造多路径环线。',
    );
  }

  getParamSchema(): GeneratorParamField[] {
    return [
      {
        key: 'cols',
        label: '网格列数',
        type: 'number',
        min: 7,
        max: 21,
        default: 13,
        hint: '7-21，自动调整为奇数（迷宫算法要求）',
      },
      {
        key: 'rows',
        label: '网格行数',
        type: 'number',
        min: 7,
        max: 21,
        default: 11,
        hint: '7-21，自动调整为奇数',
      },
      {
        key: 'extraOpenings',
        label: '额外开口率',
        type: 'range',
        min: 0,
        max: 0.3,
        step: 0.05,
        default: 0.1,
        hint: '0=完美迷宫（单解），0.3=多路径环线',
      },
      {
        key: 'wallFloor',
        label: '墙壁地板',
        type: 'select',
        options: WALL_FLOOR_OPTIONS.map((v) => ({ value: v, label: v })),
        default: 'metal',
        hint: '墙壁格的地板类型（通路固定为 standard）',
      },
      {
        key: 'seed',
        label: '随机种子',
        type: 'number',
        min: 0,
        default: 0,
        hint: '0 = 随机种子；正整数 = 可复现',
      },
    ];
  }

  generate(params: GeneratorParams, seed?: number): GeneratorFullResult {
    const p = this.normalizeParams(params);
    const rng = this.makeRng(params, seed);

    const { cols, rows } = p;
    this.assertGridSize(cols, rows);

    // 初始化网格：所有格都是墙
    // grid[y][x] = true 表示通路，false 表示墙
    const grid: boolean[][] = [];
    for (let y = 0; y < rows; y++) {
      grid.push(new Array(cols).fill(false));
    }

    // 递归回溯挖通路（迭代版避免栈溢出）
    // 起点 (1, 1)，保证是奇数坐标
    const stack: Array<readonly [number, number]> = [[1, 1]];
    grid[1]![1] = true;
    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1]!;
      const candidates: Array<readonly [number, number, number, number]> = [];
      for (const [dx, dy] of DIRS_4_STEP2) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || nx >= cols - 1) continue;
        if (ny < 1 || ny >= rows - 1) continue;
        if (grid[ny]![nx]) continue;
        candidates.push([nx, ny, dx, dy]);
      }
      if (candidates.length === 0) {
        stack.pop();
        continue;
      }
      const [nx, ny, dx, dy] = pick(rng, candidates)!;
      // 挖通中间的墙（距离 1）+ 目标格
      grid[cy + dy / 2]![cx + dx / 2] = true;
      grid[ny]![nx] = true;
      stack.push([nx, ny]);
    }

    // 额外开口：在完美迷宫上随机打通夹在通路之间的墙
    if (p.extraOpenings > 0) {
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          if (grid[y]![x]) continue;
          const lrPass = grid[y]![x - 1] && grid[y]![x + 1];
          const udPass = grid[y - 1]![x] && grid[y + 1]![x];
          if ((lrPass || udPass) && roll(rng, p.extraOpenings)) {
            grid[y]![x] = true;
          }
        }
      }
    }

    // 入口左上 (1, 1)，出口右下 (cols-2, rows-2)
    const entranceX = 1, entranceY = 1;
    const exitX = cols - 2, exitY = rows - 2;
    // 确保出入口是通路
    grid[entranceY]![entranceX] = true;
    grid[exitY]![exitX] = true;

    const pgroup = 1 as const;
    const tiles: Record<Pls, ReturnType<typeof this.makeTile>> = {};

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pls = (y * cols + x + 1) as Pls;
        const isPath = grid[y]![x]!;
        tiles[pls] = this.makeTile(x, y, {
          floor: isPath ? 'standard' : p.wallFloor,
          tide: isPath ? 'shallow' : 'abyss',
          passable: isPath,
        });
      }
    }

    // 计算 8 方向邻居（墙壁格仍会出现在 neighbors 中，但 passable=false 阻止 BFS）
    this.computeAllNeighbors8(tiles, cols, rows);

    const entrancePls = (entranceY * cols + entranceX + 1) as Pls;
    const exitPls = (exitY * cols + exitX + 1) as Pls;
    const region = this.makeMinimalRegion(
      pgroup,
      '迷宫区域',
      cols,
      rows,
      entrancePls,
      exitPls,
    );

    return this.makeSingleRegionResult(region, tiles, cols, rows, pgroup);
  }

  private normalizeParams(params: GeneratorParams): NormalizedParams {
    const defaults = this.getDefaultParams();
    const merged: GeneratorParams = { ...defaults, ...(params ?? {}) };
    let cols = Math.floor(Number(merged['cols']) ?? 13);
    let rows = Math.floor(Number(merged['rows']) ?? 11);
    // 强制奇数（迷宫算法要求）：偶数减一
    if (cols % 2 === 0) cols -= 1;
    if (rows % 2 === 0) rows -= 1;
    cols = Math.max(7, Math.min(21, cols));
    rows = Math.max(7, Math.min(21, rows));
    const extraOpenings = Math.max(0, Math.min(0.3, Number(merged['extraOpenings']) ?? 0));
    const wallFloor = typeof merged['wallFloor'] === 'string' &&
      WALL_FLOOR_OPTIONS.includes(merged['wallFloor'] as Floor)
      ? (merged['wallFloor'] as Floor)
      : 'metal';
    return { cols, rows, extraOpenings, wallFloor };
  }
}

/**
 * 注册迷宫生成器（main.ts 启动时调用）
 */
export function registerLabyrinthGenerator(): boolean {
  return registerGenerator(new LabyrinthGenerator());
}
