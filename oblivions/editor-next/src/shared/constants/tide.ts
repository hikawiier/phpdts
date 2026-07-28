// @module O 内容工具箱
//
// 潮汐类型常量（3 档，不含 safe；对齐 DESIGN.md 1.3 与 validate.js TIDE_VALUES）
// safe 由独立 preset_safe 字段标记，不作为 tide 取值

import type { Tide } from '../types/map';

export const TIDE_TYPES: readonly Tide[] = ['shallow', 'deep', 'abyss'] as const;

/**
 * UI 下拉用选项
 */
export const TIDE_OPTIONS: readonly { value: Tide; label: string }[] = TIDE_TYPES.map(
  (v) => ({ value: v, label: v }),
);

/**
 * 类型守护：判断字符串是否为合法 Tide
 */
export function isTide(value: unknown): value is Tide {
  return typeof value === 'string' && (TIDE_TYPES as readonly string[]).includes(value);
}
