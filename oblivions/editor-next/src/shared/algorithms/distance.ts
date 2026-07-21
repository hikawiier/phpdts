//
// 距离工具函数（曼哈顿距离 + 8 方向邻居偏移）
// 用于生成器（O-5）的格坐标计算与连通性判定

import type { Pls } from '../types/map';

/**
 * 8 方向偏移（对齐 design案 §3.1.3 8 方向自动连通）
 * 顺序：左上、上、右上、左、右、左下、下、右下
 */
export const DIRECTIONS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * 4 方向偏移（上下左右，用于迷宫生成器等只需 4 邻居的场景）
 */
export const DIRECTIONS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/**
 * 曼哈顿距离
 */
export function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * 切比雪夫距离（8 方向格子距离）
 */
export function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

/**
 * 根据 (x, y) 坐标在 tiles 中查找 pls
 *
 * @param tiles 区域 tiles 字典
 * @param x
 * @param y
 * @returns 匹配的 pls；未找到返回 null
 */
export function findPlsByCoord<T extends { x: number; y: number }>(
  tiles: Record<Pls, T>,
  x: number,
  y: number,
): Pls | null {
  for (const plsStr of Object.keys(tiles)) {
    const pls = Number(plsStr);
    const t = tiles[pls];
    if (t && t.x === x && t.y === y) return pls;
  }
  return null;
}

/**
 * 计算指定 pls 在 cols × rows 网格中的 4 邻居 pls 列表（上下左右，仅含合法范围内的 pls）
 *
 * 用于生成器（O-5）的 neighbors 字段构建。
 * 对齐后端 neighbors 字段语义。
 */
export function compute4Neighbors(
  pls: Pls,
  cols: number,
  rows: number,
): Pls[] {
  const x = (pls - 1) % cols;
  const y = Math.floor((pls - 1) / cols);
  const neighbors: Pls[] = [];
  // 上
  if (y > 0) neighbors.push(pls - cols);
  // 下
  if (y < rows - 1) neighbors.push(pls + cols);
  // 左
  if (x > 0) neighbors.push(pls - 1);
  // 右
  if (x < cols - 1) neighbors.push(pls + 1);
  return neighbors;
}
