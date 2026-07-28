// @module O 内容工具箱
//
// 群岛链生成器（M8 主题生成器）
//
// 主题意图：模拟多岛屿群岛链
//   - 每个区域是一个独立岛屿——中心陆地（standard floor / shallow tide）
//     被水域（water floor / deep tide）环绕，水域外缘分布少量不可通行的暗礁
//   - 多个岛屿通过 next_region / prev_region 串成群岛链
//   - 跨区域由 exit_links 映射出口到下一岛屿入口
//   - 最后岛屿 → 首岛屿形成环形（差异化点：环形 exit_links）
//
// 算法差异化（与其他 4 个生成器对比）：
//   - 唯一多区域生成器：单次 generate() 产出 >1 个 pgroup（差异化点）
//   - 距离场：基于到区域中心的欧氏距离 + 噪声扰动决定陆水分界
//   - land/reef/water 三态（差异化点）
//   - 环形 exit_links：最后岛屿链接回首岛屿（差异化点）
//   - 跨区域链接：next_region/prev_region 双向 + exit_links 多对多映射
//
// 单区域模式行为：重写为单岛屿算法 + 隐藏 regionCount + 命名"岛屿 #X"
//   - generateRegion 直接调用 _generateIsland 生成单岛屿区域
//   - 不创建区域链 / 不创建 exit_links（孤立新区域）
//   - 命名"岛屿 #X" 而非"群岛 #X"

import type {
  GeneratorParams,
  GeneratorParamField,
  GeneratorFullResult,
  GeneratorRegionResult,
  MapProject,
  Region,
  Tile,
  Pls,
  Pgroup,
} from '@/shared';
import { PGROUP_MAX, createRng, type Rng } from '@/shared';
import { BaseGenerator } from './base-generator';
import { roll } from '@/shared';
import { registerGenerator } from './registry';

interface NormalizedParams {
  regionCount: number;
  cols: number;
  rows: number;
  landRadius: number;
  reefRate: number;
  vegetationRate: number;
}

interface IslandResult {
  region: Region;
  tilesMap: Record<Pls, Tile>;
  entrancePls: Pls;
  exitPls: Pls;
}

type CellType = 'land_core' | 'land_edge' | 'water_shallow' | 'water_deep';

interface Cell {
  pls: Pls;
  x: number;
  y: number;
  type: CellType;
}

export class ArchipelagoGenerator extends BaseGenerator {
  constructor() {
    super(
      'archipelago',
      '群岛链',
      '多岛屿群岛链：每区域中心陆地被水域环绕，外缘分布暗礁。多岛屿通过区域链串成可航行的群岛。',
    );
  }

  getParamSchema(): GeneratorParamField[] {
    return [
      {
        key: 'regionCount',
        label: '岛屿数量',
        type: 'number',
        min: 2,
        max: 6,
        default: 3,
        hint: '2-6 个岛屿串成群岛链（pgroup 1..N）',
        hideInRegionMode: true, // 单区域模式下隐藏（单岛屿无需此参数）
      },
      {
        key: 'cols',
        label: '每岛列数',
        type: 'number',
        min: 6,
        max: 16,
        default: 10,
        hint: '6-16，每岛 cols × rows 须 ≤ 254',
      },
      {
        key: 'rows',
        label: '每岛行数',
        type: 'number',
        min: 6,
        max: 16,
        default: 8,
        hint: '6-16，每岛 cols × rows 须 ≤ 254',
      },
      {
        key: 'landRadius',
        label: '陆地半径',
        type: 'range',
        min: 0.2,
        max: 0.6,
        step: 0.05,
        default: 0.38,
        hint: '陆地占区域短边的比例（中心陆地大小）',
      },
      {
        key: 'reefRate',
        label: '暗礁率',
        type: 'range',
        min: 0,
        max: 0.3,
        step: 0.05,
        default: 0.12,
        hint: '水域中暗礁格占比（abyss tide + 不可通行）',
      },
      {
        key: 'vegetationRate',
        label: '植被率',
        type: 'range',
        min: 0,
        max: 0.3,
        step: 0.05,
        default: 0.1,
        hint: '陆地上植被格占比（floor=vegetation）',
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

  /**
   * 全项目模式：生成群岛链
   *
   * 多岛屿通过 next_region/prev_region 串成链；最后岛屿 exit_links 链回首岛屿（环形）
   */
  generate(params: GeneratorParams, seed?: number): GeneratorFullResult {
    const p = this.normalizeParams(params);
    const rng = this.makeRng(params, seed);

    const { regionCount, cols, rows } = p;
    this.assertGridSize(cols, rows);
    if (regionCount > PGROUP_MAX) {
      throw new Error(
        `Archipelago generator: regionCount (${regionCount}) 超出 pgroup 上限 ${PGROUP_MAX}`,
      );
    }

    const regions: MapProject['regions'] = {};
    const grids: MapProject['grids'] = {};
    const tiles: MapProject['tiles'] = {};

    // 每个岛屿独立种子（同种子但偏移以制造差异）
    const islandData: IslandResult[] = [];
    for (let i = 0; i < regionCount; i++) {
      const pgroup = (i + 1) as Pgroup;
      // 派生子种子：主种子 + 区域索引偏移（保证不同岛屿结果不同但可复现）
      const childSeed = (rng.seed + i * 2654435761) >>> 0;
      const islandRng = createRng(childSeed || undefined);
      const result = this.generateIsland(pgroup, cols, rows, p, islandRng);
      regions[pgroup] = result.region;
      grids[pgroup] = { cols, rows };
      tiles[pgroup] = result.tilesMap;
      islandData.push(result);
    }

    // 建立区域链：next_region / prev_region 双向
    for (let i = 0; i < regionCount; i++) {
      const pgroup = (i + 1) as Pgroup;
      const region = regions[pgroup]!;
      if (i < regionCount - 1) {
        region.next_region = (pgroup + 1) as Pgroup;
      }
      if (i > 0) {
        region.prev_region = (pgroup - 1) as Pgroup;
      }
    }

    // exit_links：每个岛屿的 exit_pls → 下一岛屿的 entrance_pls
    // 最后岛屿 → 首岛屿（环形群岛，差异化点）
    for (let i = 0; i < regionCount; i++) {
      const cur = islandData[i]!;
      const nextIdx = (i + 1) % regionCount;
      const next = islandData[nextIdx]!;
      const curRegion = regions[(i + 1) as Pgroup]!;
      const nextPgroup = (nextIdx + 1) as Pgroup;
      curRegion.exit_links = [
        { from_pls: cur.exitPls, to_pgroup: nextPgroup, to_pls: next.entrancePls },
      ];
    }

    return { regions, grids, tiles };
  }

  /**
   * 单区域模式：生成单个岛屿
   *
   * 重写默认实现：
   *   - 直接调用 generateIsland 生成单岛屿（不创建区域链 / 不创建 exit_links）
   *   - pgroup 由 existingPgroups 决定（max+1）
   *   - 命名"岛屿 #X" 而非"群岛 #X"
   *   - region.next_region/prev_region/exit_links 均为 null/[]（孤立新区域）
   */
  override generateRegion(
    params: GeneratorParams,
    seed: number | undefined,
    existingPgroups: Pls[] = [],
  ): GeneratorRegionResult {
    const p = this.normalizeParams(params);
    const rng = this.makeRng(params, seed);

    const newPgroup = this.computeNextPgroup(existingPgroups);
    if (newPgroup === null) {
      throw new Error(
        `Archipelago generateRegion: 新 pgroup 超出上限 ${PGROUP_MAX}`,
      );
    }

    const { cols, rows } = p;
    this.assertGridSize(cols, rows);

    const result = this.generateIsland(newPgroup, cols, rows, p, rng);
    // 覆盖命名：单岛屿用"岛屿 #X"而非"群岛 #X"
    result.region.name = `岛屿 #${newPgroup}`;
    // 单岛屿是孤立新区域，不建立 next_region/prev_region/exit_links
    // generateIsland 已将 next_region/prev_region 设为 null，exit_links 为 []

    return {
      region: result.region,
      tiles: result.tilesMap,
    };
  }

  /**
   * 生成单个岛屿
   *
   * 距离场算法：基于到区域中心的欧氏距离决定陆水分界
   * land_core / land_edge / water_shallow / water_deep 四态
   */
  private generateIsland(
    pgroup: Pgroup,
    cols: number,
    rows: number,
    p: NormalizedParams,
    rng: Rng,
  ): IslandResult {
    const centerX = (cols - 1) / 2;
    const centerY = (rows - 1) / 2;
    const shortEdge = Math.min(cols, rows);
    // 陆地半径（欧氏距离阈值）= 短边 × landRadius + 噪声扰动
    const landRadiusBase = shortEdge * p.landRadius;

    const tilesMap: Record<Pls, Tile> = {};
    const cellTypes: Cell[] = [];

    // 第一遍：决定每格类型
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const pls = (y * cols + x + 1) as Pls;
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // 加入小幅噪声扰动水陆边界（避免完美圆形）
        const noise = (rng.next() - 0.5) * 1.5;
        const effectiveRadius = landRadiusBase + noise;

        let type: CellType;
        if (dist <= effectiveRadius * 0.6) {
          type = 'land_core';
        } else if (dist <= effectiveRadius) {
          type = 'land_edge';
        } else if (dist <= effectiveRadius + 1.5) {
          type = 'water_shallow';
        } else {
          type = 'water_deep';
        }
        cellTypes.push({ pls, x, y, type });
      }
    }

    // 第二遍：根据类型生成 tile 数据
    for (const cell of cellTypes) {
      const { pls, x, y, type } = cell;
      let floor: 'standard' | 'vegetation' | 'water';
      let tide: 'shallow' | 'deep' | 'abyss';
      let passable: boolean;

      if (type === 'land_core' || type === 'land_edge') {
        // 陆地：少数植被，其余 standard
        floor = roll(rng, p.vegetationRate) ? 'vegetation' : 'standard';
        tide = 'shallow';
        passable = true;
      } else if (type === 'water_shallow') {
        // 近岸水域：可航行
        floor = 'water';
        tide = 'deep';
        passable = true;
      } else {
        // 深水：大部分可航行，少量暗礁不可通行（land/reef/water 三态差异化点）
        floor = 'water';
        if (roll(rng, p.reefRate)) {
          tide = 'abyss';
          passable = false; // 暗礁不可通行
        } else {
          tide = 'deep';
          passable = true;
        }
      }

      tilesMap[pls] = this.makeTile(x, y, { floor, tide, passable });
    }

    // 计算 8 方向邻居（双向）
    this.computeAllNeighbors8(tilesMap, cols, rows);

    // 入口：距离中心最近的陆地格
    // 出口：陆地格中 x+y 最大的（右下角方向，便于走向下一岛屿）
    const landCells = cellTypes.filter((c) => c.type === 'land_core' || c.type === 'land_edge');
    if (landCells.length === 0) {
      // 极端边界：若无陆地（landRadius 过小），强制中心格为陆地
      const centerPls = (Math.floor(centerY) * cols + Math.floor(centerX) + 1) as Pls;
      const centerTile = tilesMap[centerPls]!;
      centerTile.floor = 'standard';
      centerTile.tide = 'shallow';
      centerTile.passable = true;
      landCells.push({
        pls: centerPls,
        x: Math.floor(centerX),
        y: Math.floor(centerY),
        type: 'land_core',
      });
    }

    // 入口：距离中心最近的陆地格
    let entranceCell = landCells[0]!;
    let entranceDist = Infinity;
    for (const c of landCells) {
      const dx = c.x - centerX;
      const dy = c.y - centerY;
      const d = dx * dx + dy * dy;
      if (d < entranceDist) {
        entranceDist = d;
        entranceCell = c;
      }
    }

    // 出口：陆地格中 x+y 最大的（右下角方向）
    let exitCell = landCells[0]!;
    let exitScore = -Infinity;
    for (const c of landCells) {
      const score = c.x + c.y;
      if (score > exitScore) {
        exitScore = score;
        exitCell = c;
      }
    }

    // 强制入口出口可通行（避免被陆地噪声标为不可通行）
    tilesMap[entranceCell.pls]!.passable = true;
    tilesMap[exitCell.pls]!.passable = true;

    const region = this.makeMinimalRegion(
      pgroup,
      `群岛 #${pgroup}`,
      cols,
      rows,
      entranceCell.pls,
      exitCell.pls,
    );

    return {
      region,
      tilesMap,
      entrancePls: entranceCell.pls,
      exitPls: exitCell.pls,
    };
  }

  private normalizeParams(params: GeneratorParams): NormalizedParams {
    const defaults = this.getDefaultParams();
    const merged: GeneratorParams = { ...defaults, ...(params ?? {}) };
    const regionCount = Math.max(2, Math.min(6, Math.floor(Number(merged['regionCount']) ?? 3)));
    const cols = Math.max(6, Math.min(16, Math.floor(Number(merged['cols']) ?? 10)));
    const rows = Math.max(6, Math.min(16, Math.floor(Number(merged['rows']) ?? 8)));
    const landRadius = Math.max(0.2, Math.min(0.6, Number(merged['landRadius']) ?? 0.38));
    const reefRate = Math.max(0, Math.min(0.3, Number(merged['reefRate']) ?? 0));
    const vegetationRate = Math.max(0, Math.min(0.3, Number(merged['vegetationRate']) ?? 0));
    return { regionCount, cols, rows, landRadius, reefRate, vegetationRate };
  }
}

/**
 * 注册群岛生成器（main.ts 启动时调用）
 */
export function registerArchipelagoGenerator(): boolean {
  return registerGenerator(new ArchipelagoGenerator());
}
