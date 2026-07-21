//
// 地板类型常量（5 类，对齐 gamedata 配置与 validate.js FLOOR_VALUES）
// 配置驱动（对齐 2.6）：UI 下拉与 validate 规则都从这里取值，不硬编码

import type { Floor } from '../types/map';

export const FLOOR_TYPES: readonly Floor[] = [
  'standard',
  'water',
  'vegetation',
  'metal',
  'magic',
] as const;

/**
 * UI 下拉用选项
 */
export const FLOOR_OPTIONS: readonly { value: Floor; label: string }[] = FLOOR_TYPES.map(
  (v) => ({ value: v, label: v }),
);

/**
 * 类型守护：判断字符串是否为合法 Floor
 */
export function isFloor(value: unknown): value is Floor {
  return typeof value === 'string' && (FLOOR_TYPES as readonly string[]).includes(value);
}
