/**
 * @module O 内容工具箱
 *
 * 第 6 层：呈现校验。
 *
 * 检查目标（执行案 §4.7）：
 *   - presentation.* 与对应资源模板的 orphan / missing 双向校验
 *   - 此层在 P0 阶段已部分由 reference-validator 实现（presentation.*.orphan / .missing 规则）
 *   - P1+ 阶段补充更细粒度的呈现校验（如必填字段缺失、字段长度超限）
 *
 * P0 阶段：返回空数组。presentation.* orphan/missing 规则在 reference-validator 实现。
 * 数据源：graph-store 的 presentation.* 节点 + renders_as 边。
 */

import type { Issue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';

/**
 * 第 6 层校验——呈现校验。
 *
 * P0 阶段返回空数组。presentation.* orphan/missing 规则已在 reference-validator
 * （第 3 层）实现，因为它们依赖 renders_as 边与 schema refFields 声明。
 *
 * P1+ 阶段补充细粒度呈现校验（字段缺失、长度超限等）。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(_graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  // TODO(P1+): 实现呈现字段缺失 / 长度超限 / 必填字段校验
  //   - 遍历 presentation.* 节点，检查 name/desc 等字段是否完整
  //   - 检查字段长度（如 name <= 32 字符）
  return [];
}
