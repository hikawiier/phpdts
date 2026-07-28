// @module O 内容工具箱
//
// 数值范围常量（对齐 DESIGN.md 1.1 + 后端 tinyint 上限）
// pls 范围 1-254，pgroup 范围 1-255，cols/rows 上限 254

export const PLS_MIN = 1;
export const PLS_MAX = 254;

export const PGROUP_MIN = 1;
export const PGROUP_MAX = 255;

export const COLS_ROWS_MAX = 254;
export const COLS_ROWS_MIN = 1;

/**
 * 历史栈上限（historyStore undo/redo 栈深度，对齐设计案 §3.1.6）
 */
export const HISTORY_STACK_MAX = 100;

/**
 * 自动保存 debounce 时长（对齐设计案 §3.1.8 localStorage 自动保存 debounce 500ms）
 */
export const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Light 验证 debounce 时长（对齐设计案 §3.5.2 实时验证 debounce 300ms）
 */
export const VALIDATE_LIGHT_DEBOUNCE_MS = 300;
