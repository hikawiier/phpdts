//
// 潮汐湿地生成器（对齐 NEW_DESIGN.md §3.7.6 + Dian.md O-4）
//
// 主题意图：模拟潮汐湿地
//   - tide 字段按空间渐变分布（shallow → deep → abyss）
//   - 深水区点缀 preset_safe=true 的安全岛作为玩家避难所
//   - floor 以 vegetation 为主（湿地植被），少量 standard（干地）
//   - abyss 区域部分格 passable=false 模拟不可通行的深沼泽
//
// 算法差异化（与其他 4 个生成器对比）：
//   - 渐变场：tide 不是二值分布而是基于坐标的连续渐变 + 噪声扰动
//   - 唯一同区域用 shallow/deep/abyss 三档 tide（差异化点）
//   - preset_safe 安全岛：唯一显式利用 preset_safe=true（差异化点）
//   - floor 与 tide 解耦
//
// 单区域模式：复用 BaseGenerator 默认实现

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

const GRADIENT_DIRECTIONS = ['diagonal', 'horizontal', 'vertical'] as const;
type GradientDirection = (typeof GRADIENT_DIRECTIONS)[number];

interface NormalizedParams {
  cols: number;
  rows: number;
  gradient: GradientDirection;
  noiseLevel: number;
  safeIslandRate: number;
  abyssImpassableRate: number;
  drylandRate: number;
}

export class WetlandGenerator extends BaseGenerator {
  constructor() {
    super(
      'wetland',
      '潮汐湿地',
      '潮汐渐变湿地：tide 字段按空间渐变分布（shallow→deep→abyss），深水区点缀安全岛，floor 以植被为主。',
    );
  }

  getParamSchema(): GeneratorParamField[] {
    return [
      {
        key: 'cols',
        label: '网格列数',
        type: 'number',
        min: 8,
        max: 22,
        default: 16,
        hint: '8-22，cols × rows 须 ≤ 254',
      },
      {
        key: 'rows',
        label: '网格行数',
        type: 'number',
        min: 6,
        max: 18,
        default: 12,
        hint: '6-18，cols × rows 须 ≤ 254',
      },
      {
        key: 'gradient',
        label: '渐变方向',
        type: 'select',
        options: GRADIENT_DIRECTIONS.map((v) => ({ value: v, label: v })),
        default: 'diagonal',
        hint: 'tide 渐变方向：diagonal=对角线 / horizontal=左→右 / vertical=上→下',
      },
      {
        key: 'noiseLevel',
        label: '边界噪声',
        type: 'range',
        min: 0,
        max: 0.3,
        step: 0.05,
        default: 0.15,
        hint: '渐变边界噪声扰动强度（0=清晰分层 / 0.3=参差边界）',
      },
      {
        key: 'safeIslandRate',
        label: '安全岛率',
        type: 'range',
        min: 0,
        max: 0.2,
        step: 0.02,
        default: 0.06,
        hint: '深水区中 preset_safe=true 的安全岛占比',
      },
      {
        key: 'abyssImpassableRate',
        label: '深渊不可通行率',
        type: 'range',
        min: 0,
        max: 0.6,
        step: 0.1,
        default: 0.3,
        hint: 'abyss tide 格中 passable=false 的占比（深沼泽不可通行）',
      },
      {
        key: 'drylandRate',
        label: '干地率',
        type: 'range',
        min: 0,
        max: 0.5,
        step: 0.05,
        default: 0.2,
        hint: 'shallow tide 格中 floor=standard 的干地占比（其余为 vegetation）',
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

    const pgroup = 1 as const;
    const total = cols * rows;
    const tiles: Record<Pls, ReturnType<typeof this.makeTile>> = {};

    // 入口在 shallow 端（左上），出口在 abyss 端（右下）
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pls = (y * cols + x + 1) as Pls;
        // 计算渐变值 t ∈ [0, 1]
        let t: number;
        switch (p.gradient) {
          case 'horizontal':
            t = cols > 1 ? x / (cols - 1) : 0;
            break;
          case 'vertical':
            t = rows > 1 ? y / (rows - 1) : 0;
            break;
          case 'diagonal':
          default: {
            const tx = cols > 1 ? x / (cols - 1) : 0;
            const ty = rows > 1 ? y / (rows - 1) : 0;
            t = (tx + ty) / 2;
            break;
          }
        }
        // 加噪声扰动
        t += (rng.next() - 0.5) * p.noiseLevel * 2;
        t = Math.max(0, Math.min(1, t));

        // 渐变分档（差异化点：唯一同区域用 shallow/deep/abyss 三档 tide）
        let tide: Tide;
        if (t < 0.4) {
          tide = 'shallow';
        } else if (t < 0.75) {
          tide = 'deep';
        } else {
          tide = 'abyss';
        }

        // floor 分布
        let floor: Floor;
        if (tide === 'shallow') {
          floor = roll(rng, p.drylandRate) ? 'standard' : 'vegetation';
        } else if (tide === 'deep') {
          // deep 区仍是湿地植被，少量水洼
          floor = roll(rng, 0.15) ? 'water' : 'vegetation';
        } else {
          // abyss 区是深水
          floor = 'water';
        }

        // passable 分布
        let passable: boolean;
        if (tide === 'shallow' || tide === 'deep') {
          passable = true;
        } else {
          // abyss 部分不可通行
          passable = !roll(rng, p.abyssImpassableRate);
        }

        // preset_safe：仅在 deep/abyss 区域随机点缀安全岛（差异化点）
        let preset_safe = false;
        if (tide !== 'shallow' && roll(rng, p.safeIslandRate)) {
          preset_safe = true;
          passable = true; // 安全岛强制可通行（避难所）
          floor = 'standard'; // 安全岛 floor 升级为干地
        }

        tiles[pls] = this.makeTile(x, y, { floor, tide, passable, preset_safe });
      }
    }

    // 计算 8 方向邻居
    this.computeAllNeighbors8(tiles, cols, rows);

    // 入口：左上角（shallow 端），出口：右下角（abyss 端）
    const entrancePls = 1 as Pls;
    const exitPls = total as Pls;
    // 强制入口出口可通行 + 标记为安全区
    const entranceTile = tiles[entrancePls]!;
    entranceTile.passable = true;
    entranceTile.preset_safe = true;
    entranceTile.tide = 'shallow';
    entranceTile.floor = 'standard';
    const exitTile = tiles[exitPls]!;
    exitTile.passable = true;
    exitTile.preset_safe = true;
    // 出口仍保留 abyss tide（主题感：玩家穿越深渊湿地后到达终点）

    const region = this.makeMinimalRegion(
      pgroup,
      '潮汐湿地',
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
    const cols = Math.max(8, Math.min(22, Math.floor(Number(merged['cols']) ?? 16)));
    const rows = Math.max(6, Math.min(18, Math.floor(Number(merged['rows']) ?? 12)));
    const gradient = typeof merged['gradient'] === 'string' &&
      (GRADIENT_DIRECTIONS as readonly string[]).includes(merged['gradient'])
      ? (merged['gradient'] as GradientDirection)
      : 'diagonal';
    const noiseLevel = Math.max(0, Math.min(0.3, Number(merged['noiseLevel']) ?? 0));
    const safeIslandRate = Math.max(0, Math.min(0.2, Number(merged['safeIslandRate']) ?? 0));
    const abyssImpassableRate = Math.max(0, Math.min(0.6, Number(merged['abyssImpassableRate']) ?? 0));
    const drylandRate = Math.max(0, Math.min(0.5, Number(merged['drylandRate']) ?? 0));
    return {
      cols,
      rows,
      gradient,
      noiseLevel,
      safeIslandRate,
      abyssImpassableRate,
      drylandRate,
    };
  }
}

/**
 * 注册潮汐湿地生成器（main.ts 启动时调用）
 */
export function registerWetlandGenerator(): boolean {
  return registerGenerator(new WetlandGenerator());
}
