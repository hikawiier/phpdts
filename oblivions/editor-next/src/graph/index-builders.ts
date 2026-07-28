/**
 * @module O 内容工具箱
 *
 * 反向索引构建纯函数。给定节点和边集合，构建 inboundIndex / outboundIndex。
 *
 * 约定：
 * - 边添加时由 graph-store 自动维护索引，本模块仅在批量装配（如 loader 加载完成）后做一次性重建
 * - 索引 key 是 nodeId `${kind}:${id}`，value 是边 ID 集合
 */

import type { RelationshipEdge } from './edge';
import type { NodeId } from './edge';

export interface GraphIndexes {
  /** 反向索引：key 是被引用节点 ID，value 是引用它的边 ID 集合 */
  inbound: Map<NodeId, Set<string>>;
  /** 正向索引：key 是引用方节点 ID，value 是它发出的边 ID 集合 */
  outbound: Map<NodeId, Set<string>>;
}

/**
 * 从边集合重建双向索引——loader 加载完成后一次性调用，
 * 避免逐条 addEdge 时重复维护索引的开销。
 */
export function buildIndexes(edges: RelationshipEdge[]): GraphIndexes {
  const inbound = new Map<NodeId, Set<string>>();
  const outbound = new Map<NodeId, Set<string>>();

  for (const edge of edges) {
    let outSet = outbound.get(edge.from);
    if (!outSet) {
      outSet = new Set();
      outbound.set(edge.from, outSet);
    }
    outSet.add(edge.id);

    let inSet = inbound.get(edge.to);
    if (!inSet) {
      inSet = new Set();
      inbound.set(edge.to, inSet);
    }
    inSet.add(edge.id);
  }

  return { inbound, outbound };
}

/**
 * 增量更新索引——单条边添加时调用。
 */
export function addEdgeToIndexes(
  indexes: GraphIndexes,
  edge: RelationshipEdge,
): void {
  let outSet = indexes.outbound.get(edge.from);
  if (!outSet) {
    outSet = new Set();
    indexes.outbound.set(edge.from, outSet);
  }
  outSet.add(edge.id);

  let inSet = indexes.inbound.get(edge.to);
  if (!inSet) {
    inSet = new Set();
    indexes.inbound.set(edge.to, inSet);
  }
  inSet.add(edge.id);
}

/**
 * 增量更新索引——单条边移除时调用。
 */
export function removeEdgeFromIndexes(
  indexes: GraphIndexes,
  edge: RelationshipEdge,
): void {
  const outSet = indexes.outbound.get(edge.from);
  if (outSet) {
    outSet.delete(edge.id);
    if (outSet.size === 0) indexes.outbound.delete(edge.from);
  }

  const inSet = indexes.inbound.get(edge.to);
  if (inSet) {
    inSet.delete(edge.id);
    if (inSet.size === 0) indexes.inbound.delete(edge.to);
  }
}

/**
 * 节点删除时级联清理相关边——返回被清理的边 ID 列表。
 * 调用方需对每条边调用 removeEdgeFromIndexes 完成索引同步。
 */
export function findEdgesTouchingNode(
  indexes: GraphIndexes,
  nodeId: NodeId,
): string[] {
  const outSet = indexes.outbound.get(nodeId) ?? new Set<string>();
  const inSet = indexes.inbound.get(nodeId) ?? new Set<string>();
  return Array.from(new Set([...outSet, ...inSet]));
}
