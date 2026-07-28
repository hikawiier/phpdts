// @module O 内容工具箱
//
// 灰阶色阶 + 强调色 token（对齐 DESIGN.md 2.15 灰阶基底 + 唯一强调色）
// 唯一强调色仅用于 error 红（#ff5555）+ 路径绿（#88ff88），且不同时出现
// Tide 三档用灰阶亮度区分，不引入彩色信号色

/**
 * Tide 三档灰阶亮度（对齐设计案 §3.3.2 OverlayTideHeatmap）
 */
export const TIDE_GRAYSCALE = {
  shallow: '#cccccc', // 最浅
  deep: '#888888', // 中
  abyss: '#444444', // 最深
} as const;

/**
 * 唯一强调色 token（仅 error 红 + 路径绿，且不同时出现）
 */
export const ACCENT_COLORS = {
  error: '#ff5555', // error 级问题（ValidatePanel）
  path: '#88ff88', // 路径线（OverlayReachability）
} as const;

/**
 * 灰阶基底色阶（9 阶，对齐 vex-vue Tailwind theme）
 */
export const GRAYSCALE = {
  white: '#ffffff',
  gray100: '#f5f5f5',
  gray200: '#e5e5e5',
  gray300: '#cccccc',
  gray400: '#aaaaaa',
  gray500: '#888888',
  gray600: '#666666',
  gray700: '#444444',
  gray800: '#222222',
  black: '#000000',
} as const;
