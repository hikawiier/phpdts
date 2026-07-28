/**
 * @module O 内容工具箱
 *
 * 图状态 JSON 序列化/反序列化。用于工具会话恢复与跨设备同步（P5 之后考虑）。
 */

import type { ResourceNode, GraphSnapshot } from './types';
import type { RelationshipEdge, NodeId } from './edge';

/**
 * 序列化图状态为 GraphSnapshot。
 *
 * 注意：Map 不能直接 JSON.stringify，需先转为数组。
 */
export function serializeGraph(
  nodes: Map<NodeId, ResourceNode>,
  edges: RelationshipEdge[],
  workspaceRoot: string,
): GraphSnapshot {
  return {
    nodes: Array.from(nodes.values()).map((n) => ({
      kind: n.kind,
      id: n.id,
      data: n.data,
      presentation: n.presentation,
      source: n.source,
      revision: n.revision,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      type: e.type,
      from: e.from,
      to: e.to,
      sourceAnchor: e.sourceAnchor,
      metadata: e.metadata,
    })),
    timestamp: Date.now(),
    workspaceRoot,
  };
}

/**
 * 反序列化 GraphSnapshot 为图状态。
 *
 * 调用方负责校验 workspaceRoot 一致性。
 */
export function deserializeGraph(
  snapshot: GraphSnapshot,
): {
  nodes: Map<NodeId, ResourceNode>;
  edges: RelationshipEdge[];
} {
  const nodes = new Map<NodeId, ResourceNode>();
  for (const n of snapshot.nodes) {
    const nodeId = `${n.kind}:${n.id}` as NodeId;
    nodes.set(nodeId, {
      kind: n.kind as ResourceNode['kind'],
      id: n.id,
      data: n.data,
      presentation: n.presentation,
      source: n.source,
      revision: n.revision,
    });
  }

  const edges: RelationshipEdge[] = snapshot.edges.map((e) => ({
    id: e.id,
    type: e.type as RelationshipEdge['type'],
    from: e.from,
    to: e.to,
    sourceAnchor: e.sourceAnchor,
    metadata: e.metadata,
  }));

  return { nodes, edges };
}
