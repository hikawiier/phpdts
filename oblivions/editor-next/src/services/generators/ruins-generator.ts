//
// 废墟城市生成器（对齐 NEW_DESIGN.md §3.7.6 + Dian.md O-4）
//
// 主题意图：模拟城市废墟——height 字段分层（低/中/高）映射街区结构：
//   - height=2（塔楼）：建筑核心，floor=magic，多数 passable=false（实体建筑）
//   - height=1（建筑废墟）：塔楼外环，floor=metal + destructible=true（可破坏）
//   - height=0（街道）：建筑外区域，floor=standard，passable=true（可通行）
//
// 算法核心：随机选择 N 个建筑簇中心，每格的 height tier 由到最近簇中心的距离决定
// 形成簇状建筑分布，模拟城市街区
//
// 算法差异化（与其他 4 个生成器对比）：
//   - 唯一用 height 分层（0/1/2）（差异化点）
//   - 唯一用 destructible=true 标记可破坏废墟（差异化点）
//   - 簇状距离场：基于"到最近簇中心距离"，非全局渐变
//   - floor 与 height 强耦合
//
// 单区域模式：复用 BaseGenerator 默认实现

import type {
  GeneratorParams,
  GeneratorParamField,
  GeneratorFullResult,
  Pls,
} from '@/shared';
import { BaseGenerator } from './base-generator';
import { roll } from '@/shared';
import { registerGenerator } from './registry';

interface NormalizedParams {
  cols: number;
  rows: number;
  clusterCount: number;
  towerRadius: number;
  buildingRadius: number;
  towerImpassableRate: number;
  buildingImpassableRate: number;
  destructibleRate: number;
}

interface Cluster {
  x: number;
  y: number;
}

export class RuinsGenerator extends BaseGenerator {
  constructor() {
    super(
      'ruins',
      '废墟城市',
      '城市废墟街区：随机簇中心生成 height 分层建筑（塔楼/废墟/街道），metal 建筑可破坏，街道可通行。',
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
        key: 'clusterCount',
        label: '建筑簇数量',
        type: 'number',
        min: 2,
        max: 8,
        default: 4,
        hint: '2-8 个建筑簇中心，越多建筑密度越高',
      },
      {
        key: 'towerRadius',
        label: '塔楼半径',
        type: 'range',
        min: 0.5,
        max: 1.5,
        step: 0.25,
        default: 1.0,
        hint: '塔楼核心（height=2）半径',
      },
      {
        key: 'buildingRadius',
        label: '建筑半径',
        type: 'range',
        min: 1.5,
        max: 3.0,
        step: 0.25,
        default: 2.0,
        hint: '建筑废墟（height=1）半径，超出塔楼到此距离内为废墟',
      },
      {
        key: 'towerImpassableRate',
        label: '塔楼不可通行率',
        type: 'range',
        min: 0.3,
        max: 1.0,
        step: 0.1,
        default: 0.8,
        hint: '塔楼格中 passable=false 占比（实体建筑不可进入）',
      },
      {
        key: 'buildingImpassableRate',
        label: '废墟不可通行率',
        type: 'range',
        min: 0,
        max: 0.5,
        step: 0.1,
        default: 0.2,
        hint: '建筑废墟格中 passable=false 占比（坍塌残骸）',
      },
      {
        key: 'destructibleRate',
        label: '可破坏率',
        type: 'range',
        min: 0.3,
        max: 1.0,
        step: 0.1,
        default: 0.7,
        hint: '建筑废墟格中 destructible=true 占比（可破坏废墟）',
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

    // 选择簇中心：随机分布，避免边缘（中心点至少离边缘 1 格）
    const clusters: Cluster[] = [];
    for (let i = 0; i < p.clusterCount; i++) {
      const cx = 1 + Math.floor(rng.next() * (cols - 2));
      const cy = 1 + Math.floor(rng.next() * (rows - 2));
      clusters.push({ x: cx, y: cy });
    }

    const pgroup = 1 as const;
    const total = cols * rows;
    const tiles: Record<Pls, ReturnType<typeof this.makeTile>> = {};

    // 入口左上 (0,0)，出口右下 (cols-1, rows-1)
    const entrancePls = 1 as Pls;
    const exitPls = total as Pls;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pls = (y * cols + x + 1) as Pls;

        // 计算到最近簇中心的距离
        let minDist = Infinity;
        for (const c of clusters) {
          const dx = x - c.x;
          const dy = y - c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }

        // 加入小幅噪声扰动边界
        const noise = (rng.next() - 0.5) * 0.5;
        const effectiveDist = minDist + noise;

        // 决定 height tier（差异化点：唯一用 height 分层）
        let height: number;
        let floor: 'standard' | 'metal' | 'magic';
        let passable: boolean;
        let destructible: boolean;
        if (effectiveDist <= p.towerRadius) {
          // 塔楼（height=2）
          height = 2;
          floor = 'magic';
          passable = !roll(rng, p.towerImpassableRate);
          destructible = false; // 塔楼不可破坏
        } else if (effectiveDist <= p.buildingRadius) {
          // 建筑废墟（height=1）
          height = 1;
          floor = 'metal';
          passable = !roll(rng, p.buildingImpassableRate);
          // 差异化点：唯一用 destructible=true 标记可破坏废墟
          destructible = roll(rng, p.destructibleRate);
        } else {
          // 街道（height=0）
          height = 0;
          floor = 'standard';
          passable = true;
          destructible = false;
        }

        tiles[pls] = this.makeTile(x, y, {
          floor,
          tide: 'shallow', // 城市废墟无水域
          height,
          passable,
          destructible,
        });
      }
    }

    // 计算 8 方向邻居
    this.computeAllNeighbors8(tiles, cols, rows);

    // 强制入口出口为街道（可通行），防止簇中心太靠近角落导致出入口被建筑挡死
    const forceStreet = (pls: Pls): void => {
      const t = tiles[pls]!;
      t.height = 0;
      t.floor = 'standard';
      t.passable = true;
      t.destructible = false;
    };
    forceStreet(entrancePls);
    forceStreet(exitPls);

    const region = this.makeMinimalRegion(
      pgroup,
      '废墟城市',
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
    const clusterCount = Math.max(2, Math.min(8, Math.floor(Number(merged['clusterCount']) ?? 4)));
    let towerRadius = Math.max(0.5, Math.min(1.5, Number(merged['towerRadius']) ?? 1.0));
    let buildingRadius = Math.max(1.5, Math.min(3.0, Number(merged['buildingRadius']) ?? 2.0));
    // 保证 buildingRadius > towerRadius（避免分层冲突）
    if (buildingRadius <= towerRadius) {
      buildingRadius = towerRadius + 0.5;
    }
    const towerImpassableRate = Math.max(0.3, Math.min(1.0, Number(merged['towerImpassableRate']) ?? 0.8));
    const buildingImpassableRate = Math.max(0, Math.min(0.5, Number(merged['buildingImpassableRate']) ?? 0));
    const destructibleRate = Math.max(0.3, Math.min(1.0, Number(merged['destructibleRate']) ?? 0.7));
    return {
      cols,
      rows,
      clusterCount,
      towerRadius,
      buildingRadius,
      towerImpassableRate,
      buildingImpassableRate,
      destructibleRate,
    };
  }
}

/**
 * 注册废墟城市生成器（main.ts 启动时调用）
 */
export function registerRuinsGenerator(): boolean {
  return registerGenerator(new RuinsGenerator());
}
