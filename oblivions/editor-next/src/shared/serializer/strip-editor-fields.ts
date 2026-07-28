// @module O 内容工具箱
//
// 编辑器专用字段剥离工具
//
// 设计意图（对齐 NEW_DESIGN.md §3.2.2 + FUNCTIONAL_LIST.md §框架 1 边界案例）：
//   _breaks 字段是编辑器专用，记录用户主动断开的连接（与 neighbors 区分），
//   导出 PHP 文件时必须剥离，避免污染后端游戏逻辑。
//
// 此文件提供两个层次：
//   1. re-export php-codegen.ts 的 stripEditorFields（按 tile 级别剥离 _breaks）
//   2. 递归剥离工具 stripEditorFieldsDeep：遍历任意嵌套对象/数组，剥离所有以 _ 开头的编辑器专用字段
//
// 递归剥离用于配置文件（scatter_pool / poi_table / poi_pool）的导出场景，
// 这些配置文件的嵌套结构中可能存在编辑器辅助字段（如 _expanded / _dirty 等）

export { stripEditorFields } from './php-codegen';

/**
 * 编辑器专用字段前缀
 *
 * 约定：以 _ 开头的字段均为编辑器专用，导出时剥离
 * 已知字段：
 *   - _breaks：tile 级别记录断开连接
 *   - _expanded / _dirty / _selected：UI 状态字段
 */
const EDITOR_FIELD_PREFIX = '_';

/**
 * 递归剥离编辑器专用字段（所有以 _ 开头的字段）
 *
 * 与 stripEditorFields（仅剥离 _breaks）的区别：
 *   - stripEditorFields：仅处理 tile 级别的 _breaks，保留 tile 其余字段
 *   - stripEditorFieldsDeep：递归遍历任意嵌套结构，剥离所有 _ 开头字段
 *
 * 适用场景：导出配置文件（scatter_pool / poi_table / poi_pool）时清理编辑器辅助字段
 */
export function stripEditorFieldsDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => stripEditorFieldsDeep(item)) as unknown as T;
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    // 跳过以 _ 开头的编辑器专用字段
    if (key.startsWith(EDITOR_FIELD_PREFIX)) continue;
    result[key] = stripEditorFieldsDeep(val);
  }
  return result as unknown as T;
}

/**
 * 判断字段名是否为编辑器专用字段（以 _ 开头）
 */
export function isEditorField(key: string): boolean {
  return key.startsWith(EDITOR_FIELD_PREFIX);
}
