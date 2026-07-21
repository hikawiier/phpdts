//
// 生成器基类（对齐 NEW_DESIGN.md §3.7.1 + Dian.md O-4）
//
// 设计意图（对齐 2.6 配置驱动 + 3.3 约束是意图的近似）：
//   - Generator 接口契约：id / name / description 元信息 + 参数 schema + 全项目生成 + 单区域生成
//   - generate(params, seed) 是纯函数：相同 seed + params 必产生相同结果（可复现性）
//   - generateRegion 默认实现：取首区域 + remap pgroup + 清空区域链
//   - 多区域生成器（archipelago）应重写 generateRegion 为单岛屿算法
//   - Generator 与后端 generate.func.php 职责分离：编辑器生成空间结构，后端生成实例
//
// 种子化伪随机（对齐 §3.7.4）：
//   - seed=0 视为"使用随机种子"，正整数视为可复现种子
//   - 避免用户输入 0 被当作固定种子
//
// 边界约束（对齐 §3.7.7）：
//   - 首尾格强制 passable=true，保证 entrance / exit 可达
//   - cols × rows 上限 254（对齐 pls 范围），超出抛错由工具栏捕获显示

import type {
  Generator,
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
import { PGROUP_MAX, PLS_MAX } from '@/shared';
import { createRng, type Rng, DIRECTIONS_8 } from '@/shared';

/**
 * 4 方向偏移（迷宫递归回溯算法专用，每次跳 2 格）
 * 与 DIRECTIONS_4（每次跳 1 格）不同——迷宫算法需要在通路间跳过墙
 */
export const DIRS_4_STEP2: ReadonlyArray<readonly [number, number]> = [
  [0, -2],  // 上
  [0, 2],   // 下
  [-2, 0],  // 左
  [2, 0],   // 右
];

/**
 * 生成器基类
 *
 * 子类应继承并实现：
 *   1. getParamSchema() 返回参数 schema 数组（驱动 UI 自动渲染）
 *   2. generate(params, seed) 全项目模式（纯函数）
 *
 * generateRegion 默认实现适用于单区域生成器；多区域生成器应重写为单区域算法。
 */
export abstract class BaseGenerator implements Generator {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  constructor(id: string, name: string, description: string) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  abstract getParamSchema(): GeneratorParamField[];

  getDefaultParams(): GeneratorParams {
    const params: GeneratorParams = {};
    for (const field of this.getParamSchema()) {
      params[field.key] = field.default;
    }
    return params;
  }

  abstract generate(params: GeneratorParams, seed?: number): GeneratorFullResult;

  /**
   * 单区域模式默认实现（对齐 §3.7.4）
   *
   * 默认实现：调用子类的 generate(params, seed) 取第一个区域 + 对应 tiles，
   *          并将 pgroup 重新映射为 max(existingPgroups)+1（或 1）。
   *
   * 多区域生成器（如 archipelago）应重写此方法以生成单岛屿区域。
   *
   * @param params 用户填写的参数
   * @param seed 随机种子（undefined / 0 视为随机种子）
   * @param existingPgroups 当前项目已有的 pgroup 数组（决定新 pgroup）
   * @returns 单个区域数据
   */
  generateRegion(
    params: GeneratorParams,
    seed: number | undefined,
    existingPgroups: Pls[] = [],
  ): GeneratorRegionResult {
    const newPgroup = this.computeNextPgroup(existingPgroups);
    if (newPgroup === null) {
      throw new Error(
        `Generator "${this.id}" generateRegion: pgroup 上限 ${PGROUP_MAX} 已达，无法分配新 pgroup`,
      );
    }

    const project = this.generate(params, seed);
    const firstPgroup = Object.keys(project.regions)
      .map(Number)
      .sort((a, b) => a - b)[0] as Pgroup | undefined;
    if (firstPgroup === undefined) {
      throw new Error(`Generator "${this.id}" generate() returned empty regions`);
    }

    const originalRegion = project.regions[firstPgroup]!;
    const originalTiles = project.tiles[firstPgroup] ?? {};

    // 复制并清空区域链（孤立新区域，由调用方决定是否手动建立链接）
    const region: Region = {
      ...originalRegion,
      next_region: null,
      prev_region: null,
      exit_links: [],
    };

    // 复制 tiles，保留所有字段（pgroup 不在 Tile 类型中，无需 remap）
    const tiles: Record<Pls, Tile> = {};
    for (const plsKey of Object.keys(originalTiles)) {
      const pls = Number(plsKey) as Pls;
      tiles[pls] = { ...originalTiles[pls]! };
    }

    return { region, tiles };
  }

  /**
   * 工具方法：计算下一个可用 pgroup
   * @returns 新 pgroup，已达上限返回 null
   */
  protected computeNextPgroup(existingPgroups: Pls[]): Pgroup | null {
    const next =
      existingPgroups.length === 0 ? 1 : Math.max(...existingPgroups) + 1;
    return next > PGROUP_MAX ? null : (next as Pgroup);
  }

  /**
   * 工具方法：解析种子
   * - params.seed 优先（若为正整数则视为可复现种子）
   * - 否则使用 seed 参数
   * - 均无效则返回 undefined（createRng 内部用 Math.random 生成新种子）
   */
  protected resolveSeed(params: GeneratorParams, seed?: number): number | undefined {
    const fromParams = params['seed'];
    if (typeof fromParams === 'number' && fromParams > 0) {
      return fromParams;
    }
    if (typeof seed === 'number' && seed > 0) {
      return seed;
    }
    return undefined;
  }

  /**
   * 工具方法：构造 Rng（对齐 §3.7.4 seed=0 视为随机种子）
   */
  protected makeRng(params: GeneratorParams, seed?: number): Rng {
    return createRng(this.resolveSeed(params, seed));
  }

  /**
   * 工具方法：校验 cols × rows 上限
   * @throws Error 当 cols × rows > 254
   */
  protected assertGridSize(cols: number, rows: number): void {
    const total = cols * rows;
    if (total > PLS_MAX) {
      throw new Error(
        `Generator "${this.id}": cols × rows (${cols} × ${rows} = ${total}) 超出 pls 上限 ${PLS_MAX}`,
      );
    }
  }

  /**
   * 工具方法：计算 8 方向邻居（对齐 connectivity.ts autoConnect 算法）
   * 双向写入 neighbors 数组
   */
  protected computeAllNeighbors8(
    tilesMap: Record<Pls, Tile>,
    cols: number,
    rows: number,
  ): void {
    for (const plsKey of Object.keys(tilesMap)) {
      const pls = Number(plsKey) as Pls;
      const tile = tilesMap[pls];
      if (!tile) continue;
      const { x, y } = tile;
      for (const [dx, dy] of DIRECTIONS_8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const nPls = ny * cols + nx + 1;
        const nTile = tilesMap[nPls];
        if (!nTile) continue;
        if (!tile.neighbors.includes(nPls)) {
          tile.neighbors.push(nPls);
        }
        if (!nTile.neighbors.includes(pls)) {
          nTile.neighbors.push(pls);
        }
      }
    }
  }

  /**
   * 工具方法：构造一个最小 Region（无 entrance/exit，next/prev/links 清空）
   */
  protected makeMinimalRegion(
    _pgroup: Pgroup,
    name: string,
    cols: number,
    rows: number,
    entrancePls: Pls | null = null,
    exitPls: Pls | null = null,
  ): Region {
    return {
      name,
      desc: '',
      entrance_pls: entrancePls,
      exit_pls: exitPls,
      next_region: null,
      prev_region: null,
      exit_links: [],
      cols,
      rows,
    };
  }

  /**
   * 工具方法：构造一个默认 Tile
   */
  protected makeTile(
    x: number,
    y: number,
    overrides: Partial<Tile> = {},
  ): Tile {
    return {
      name: '',
      desc: '',
      floor: 'standard',
      tide: 'shallow',
      height: 0,
      passable: true,
      destructible: false,
      neighbors: [],
      x,
      y,
      preset_safe: false,
      _breaks: [],
      ...overrides,
    };
  }

  /**
   * 工具方法：构造一个 GeneratorFullResult（全项目模式）
   * 单区域生成器：pgroup=1
   */
  protected makeSingleRegionResult(
    region: Region,
    tiles: Record<Pls, Tile>,
    cols: number,
    rows: number,
    pgroup: Pgroup = 1,
  ): GeneratorFullResult {
    const regions: MapProject['regions'] = { [pgroup]: region };
    const grids: MapProject['grids'] = { [pgroup]: { cols, rows } };
    const tilesByPgroup: MapProject['tiles'] = { [pgroup]: tiles };
    return { regions, grids, tiles: tilesByPgroup };
  }
}
