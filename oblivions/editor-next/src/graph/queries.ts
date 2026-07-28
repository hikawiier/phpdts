/**
 * @module O 内容工具箱
 *
 * 图查询辅助函数。所有查询基于 graph-store，不重复维护索引。
 */

import type { ResourceNode } from './types';
import type { NodeId, RelationshipEdge } from './edge';
import type { RelationshipType } from './relationship-types';
import { useGraphStore } from './graph-store';

/**
 * 按 kind + id 查找节点。
 */
export function findNode<T = unknown>(kind: string, id: string): ResourceNode<T> | undefined {
  const store = useGraphStore();
  return store.nodes.get(`${kind}:${id}`) as ResourceNode<T> | undefined;
}

/**
 * 按 kind 列出所有节点。
 */
export function findNodesByKind<T = unknown>(kind: string): ResourceNode<T>[] {
  const store = useGraphStore();
  const result: ResourceNode<T>[] = [];
  for (const node of store.nodes.values()) {
    if (node.kind === kind) {
      result.push(node as ResourceNode<T>);
    }
  }
  return result;
}

/**
 * 列出所有节点的 kind。
 */
export function listKinds(): string[] {
  const store = useGraphStore();
  return Array.from(store.nodeCountByKind.keys()).sort();
}

/**
 * 反向引用查询——所有引用指定节点 的边及其来源节点。
 */
export function findRefsTo(kind: string, id: string) {
  const store = useGraphStore();
  const nodeId: NodeId = `${kind}:${id}`;
  return store.getInbound(nodeId);
}

/**
 * 正向引用查询——指定节点 发出的所有边及其目标节点。
 */
export function findRefsFrom(kind: string, id: string) {
  const store = useGraphStore();
  const nodeId: NodeId = `${kind}:${id}`;
  return store.getOutbound(nodeId);
}

/**
 * 找到指定资源的呈现映射——通过 renders_as 边查找对应的 presentation 节点。
 *
 * P0 阶段同时支持 ResourceNode.presentation 内嵌字段（过渡期）与
 * 独立 presentation.* kind 节点（P5 单源编译完成后）。
 */
export function findRenderableOf(kind: string, id: string): ResourceNode<unknown>[] {
  const store = useGraphStore();
  const nodeId: NodeId = `${kind}:${id}`;
  const outbound = store.findOutboundByEdgeType(nodeId, 'renders_as');
  const result: ResourceNode<unknown>[] = [];
  for (const edge of outbound) {
    const target = store.nodes.get(edge.to);
    if (target) result.push(target);
  }
  return result;
}

/**
 * 同 findRenderableOf，但仅返回 presentation kind 节点。
 */
export function findPresentationsOf<T = unknown>(kind: string, id: string): ResourceNode<T>[] {
  const all = findRenderableOf(kind, id);
  return all.filter((n) => n.kind.startsWith('presentation.')) as ResourceNode<T>[];
}

/**
 * 检查图中是否存在悬挂引用——引用了不存在的节点。
 *
 * 用于 O-10 reference-validator 的 hasDanglingRefs() 检查。
 */
export function hasDanglingRefs(): boolean {
  const store = useGraphStore();
  for (const edge of store.edges) {
    if (!store.nodes.has(edge.from) || !store.nodes.has(edge.to)) {
      return true;
    }
  }
  return false;
}

/**
 * 列出所有悬挂引用——返回所有引用了不存在节点的边。
 */
export function listDanglingRefs() {
  const store = useGraphStore();
  const dangling: Array<{ edge: RelationshipEdge; missing: 'from' | 'to' | 'both' }> = [];
  for (const edge of store.edges) {
    const fromExists = store.nodes.has(edge.from);
    const toExists = store.nodes.has(edge.to);
    if (!fromExists && !toExists) {
      dangling.push({ edge, missing: 'both' });
    } else if (!fromExists) {
      dangling.push({ edge, missing: 'from' });
    } else if (!toExists) {
      dangling.push({ edge, missing: 'to' });
    }
  }
  return dangling;
}

/**
 * 按 kind + id 列出所有反向引用节点（去重）。
 */
export function findInboundNodes(kind: string, id: string): ResourceNode[] {
  const store = useGraphStore();
  const nodeId: NodeId = `${kind}:${id}`;
  const inbound = store.getInbound(nodeId);
  const result: ResourceNode[] = [];
  const seen = new Set<string>();
  for (const edge of inbound) {
    if (seen.has(edge.from)) continue;
    seen.add(edge.from);
    const node = store.nodes.get(edge.from);
    if (node) result.push(node);
  }
  return result;
}

/**
 * 按 kind + id 列出所有正向引用节点（去重）。
 */
export function findOutboundNodes(kind: string, id: string): ResourceNode[] {
  const store = useGraphStore();
  const nodeId: NodeId = `${kind}:${id}`;
  const outbound = store.getOutbound(nodeId);
  const result: ResourceNode[] = [];
  const seen = new Set<string>();
  for (const edge of outbound) {
    if (seen.has(edge.to)) continue;
    seen.add(edge.to);
    const node = store.nodes.get(edge.to);
    if (node) result.push(node);
  }
  return result;
}

/**
 * 按 kind + id + 边类型列出所有反向引用节点。
 */
export function findInboundNodesByEdgeType(
  kind: string,
  id: string,
  edgeType: RelationshipType,
): ResourceNode[] {
  const store = useGraphStore();
  const nodeId: NodeId = `${kind}:${id}`;
  const inbound = store.findInboundByEdgeType(nodeId, edgeType);
  const result: ResourceNode[] = [];
  const seen = new Set<string>();
  for (const edge of inbound) {
    if (seen.has(edge.from)) continue;
    seen.add(edge.from);
    const node = store.nodes.get(edge.from);
    if (node) result.push(node);
  }
  return result;
}

/**
 * 通过 contains 边查询子节点（默认 edgeType='contains'）。
 *
 * 用法：`findChildren('world.region', '1')` 返回 region 1 包含的所有 world.tile 节点。
 */
export function findChildren(parentKind: string, parentId: string, edgeType?: string): ResourceNode[] {
  const store = useGraphStore();
  const nodeId: NodeId = `${parentKind}:${parentId}`;
  return store.findChildren(nodeId, (edgeType ?? 'contains') as RelationshipType);
}

/**
 * 专为 world.tile 提供的邻接查询——合并 inbound + outbound 的 adjacent_to 边去重。
 *
 * 用法：`findAdjacent('world.tile', '1:5')` 返回 tile 1:5 的所有邻接 tile 节点。
 * 返回结果不含 _breaks 状态——调用方需自行合并 _breaks 信息。
 */
export function findAdjacent(tileKind: string, tileId: string): ResourceNode[] {
  const store = useGraphStore();
  const nodeId: NodeId = `${tileKind}:${tileId}`;
  return store.findAdjacent(nodeId);
}
