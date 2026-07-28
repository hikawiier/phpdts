/**
 * @module O 内容工具箱
 *
 * 第 1 层：输入校验。
 *
 * 检查目标（执行案 §4.7）：
 *   - PHP 文件解析失败（语法错误 / 不支持的语法）
 *   - 文件缺失（loot_tables.php / item_table.php 等核心文件未导入）
 *   - 文件格式错误（非 PHP / 非 TS locale）
 *
 * P0 阶段：返回空数组，P1+ 阶段实现。
 * 数据源：workspace/loader 的解析错误事件 + graph-store 的 sourceAnchor。
 */

import type { Issue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';

/**
 * 第 1 层校验——输入校验。
 *
 * P0 阶段返回空数组。P1+ 阶段从 workspace/loader 的解析错误事件中
 * 收集 issue，resourceRef 指向文件路径。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(_graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  // TODO(P1): 实现 PHP 解析失败 / 文件缺失 / 文件格式错误校验
  //   - 从 workspace/loader 的解析错误事件中收集 issue
  //   - resourceRef = { kind: 'file', id: filePath }
  //   - severity = 'error'（解析失败阻断后续层）
  return [];
}
