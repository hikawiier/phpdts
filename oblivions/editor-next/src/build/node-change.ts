/**
 * @module O 内容工具箱
 *
 * 节点级变更记录——ChangeSet 累积编辑动作的最小单元。
 *
 * 设计意图：
 * - 同一 nodeId 的连续编辑应在 ChangeSet 中合并为单条记录，避免发布时产生冗余 diff。
 * - 合并规则覆盖 5 种典型序列：add→update / update→update / update→remove /
 *   add→remove（取消）/ remove→add（视为 update 还原）。
 * - add→remove 直接相消，返回 NODE_CHANGE_CANCELED 哨兵，调用方据此从 pendingChanges 移除该条目。
 */

/**
 * 节点变更类型。
 */
export type NodeChangeType = 'add' | 'update' | 'remove';

/**
 * 节点变更记录。
 *
 * - nodeId：`${kind}:${id}`，与 Resource Graph 节点 ID 对齐
 * - oldData：变更前的节点数据（add 时为 undefined）
 * - newData：变更后的节点数据（remove 时为 undefined）
 * - timestamp：变更发生时间（ms epoch），用于排序与冲突诊断
 */
export interface NodeChange {
  type: NodeChangeType;
  nodeId: string;
  oldData?: unknown;
  newData?: unknown;
  timestamp: number;
}

/**
 * 合并取消哨兵——当 add + remove 序列相消时返回。
 *
 * 使用 Symbol 保证与任何 NodeChange 对象都不会混淆。
 */
export const NODE_CHANGE_CANCELED: unique symbol = Symbol('node-change-canceled');
export type NODE_CHANGE_CANCELED = typeof NODE_CHANGE_CANCELED;

/**
 * 合并结果——可能是合并后的 NodeChange，也可能是取消哨兵。
 */
export type NodeChangeMergeResult = NodeChange | typeof NODE_CHANGE_CANCELED;

/**
 * 创建 NodeChange 工厂函数。
 *
 * timestamp 默认取当前时间，便于调用方在批量编辑时统一打点。
 */
export function createNodeChange(
  type: NodeChangeType,
  nodeId: string,
  oldData?: unknown,
  newData?: unknown,
  timestamp: number = Date.now(),
): NodeChange {
  return { type, nodeId, oldData, newData, timestamp };
}

/**
 * 判定两条 NodeChange 是否等价——同 nodeId + 同 type 视为相同（用于去重）。
 *
 * 不比较 oldData / newData / timestamp，因为同一节点同一动作的重复触发
 * 在 ChangeSet 视角下应合并而非并列。
 */
export function isNodeChangeEqual(a: NodeChange, b: NodeChange): boolean {
  return a.nodeId === b.nodeId && a.type === b.type;
}

/**
 * 合并连续变更。
 *
 * 5 种显式规则：
 * - add + update → add（newData 用 incoming.newData，oldData 保持 undefined）
 * - update + update → update（oldData 用 existing.oldData，newData 用 incoming.newData）
 * - update + remove → remove（无 newData；oldData 沿用 existing.oldData 以便回滚诊断）
 * - add + remove → 取消（返回 NODE_CHANGE_CANCELED）
 * - remove + add → update（视为还原；oldData 用 existing.oldData，newData 用 incoming.newData）
 *
 * 未列举的组合（add+add / remove+remove / remove+update / update+add）：
 * - 默认采用「incoming 主导」策略——保留 incoming.type，但尽量保留 existing.oldData
 *   以维持可追溯性。这些组合在正常编辑流中不应出现，仅为防御性兜底。
 */
export function mergeNodeChange(
  existing: NodeChange,
  incoming: NodeChange,
): NodeChangeMergeResult {
  const seq = `${existing.type}+${incoming.type}`;

  switch (seq) {
    case 'add+update':
      return {
        type: 'add',
        nodeId: incoming.nodeId,
        newData: incoming.newData,
        timestamp: incoming.timestamp,
      };

    case 'update+update':
      return {
        type: 'update',
        nodeId: incoming.nodeId,
        oldData: existing.oldData,
        newData: incoming.newData,
        timestamp: incoming.timestamp,
      };

    case 'update+remove':
      return {
        type: 'remove',
        nodeId: incoming.nodeId,
        oldData: existing.oldData,
        timestamp: incoming.timestamp,
      };

    case 'add+remove':
      return NODE_CHANGE_CANCELED;

    case 'remove+add':
      return {
        type: 'update',
        nodeId: incoming.nodeId,
        oldData: existing.oldData,
        newData: incoming.newData,
        timestamp: incoming.timestamp,
      };

    default:
      // 防御性兜底：未列举组合按 incoming 主导合并，保留 existing.oldData 用于追溯
      return {
        type: incoming.type,
        nodeId: incoming.nodeId,
        oldData: existing.oldData ?? incoming.oldData,
        newData: incoming.newData,
        timestamp: incoming.timestamp,
      };
  }
}
