/**
 * @module O 内容工具箱
 *
 * 第 4 层：语义校验。
 *
 * 检查目标（执行案 §4.7）：
 *   - 字段值在业务语义上无效（如 enemy.toughness < 0）
 *   - 字段组合矛盾（如 item.destructible=true 但 item.passable=true）
 *   - ID 命名规范违反（如 item ID 含大写字母）
 *
 * P0 阶段：返回空数组，P1+ 阶段实现。
 * 数据源：graph-store 的节点 data 字段（需 O-2 schema fields 完整声明）。
 */

import type { Issue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';

/**
 * 第 4 层校验——语义校验。
 *
 * P0 阶段返回空数组。P1+ 阶段从 graph-store 节点 data 字段中
 * 检查业务语义约束（需 O-2 schema fields 完整声明）。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(_graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  // TODO(P1+): 实现字段值语义校验、字段组合矛盾校验、ID 命名规范校验
  //   - 遍历各 kind 节点，按 O-2 schema fields 声明检查
  //   - 引用 O-2 schema.validators 配置的校验函数
  return [];
}
