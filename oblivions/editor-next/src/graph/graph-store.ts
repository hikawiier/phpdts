/**
 * @module O 内容工具箱
 * @framework O-3 Resource Graph
 *
 * 图状态 Pinia store。所有可编辑内容归一化为 ResourceNode，关系作为一等数据 RelationshipEdge。
 *
 * 核心数据结构：
 * - nodes: Map<nodeId, ResourceNode>，nodeId 格式 `${kind}:${id}`
 * - edges: RelationshipEdge[]
 * - inboundIndex / outboundIndex: 反向/正向索引
 * - revisions: Map<nodeId, revision>，资源 revision 字典
 *
 * 核心约定：
 * - 节点 upsert 时自动计算 revision（SHA-256 前 16 字节十六进制）
 * - 边添加时自动维护 inboundIndex / outboundIndex
 * - 节点删除时级联清理相关边，emit `graph:node-removed` 事件供 O-7 删除保护使用
 * - 图状态变更触发 O-10 轻量校验调度（debounce 300ms，由 validateStore 订阅）
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ResourceNode, GraphEvent } from './types';
import type { RelationshipEdge, NodeId } from './edge';
import { buildEdgeId } from './edge';
import type { RelationshipType } from './relationship-types';
import {
  buildIndexes,
  addEdgeToIndexes,
  removeEdgeFromIndexes,
  findEdgesTouchingNode,
  type GraphIndexes,
} from './index-builders';
import { listKinds, getKindSchema } from '@/schema/registry';

/**
 * 同步 djb2 hash——返回 32 字符十六进制 revision。
 *
 * 设计意图：P0-P4 阶段使用 djb2 同步 hash 保证 graph-store actions 全部同步，
 * 让 projectStore / configStore 的 actions 保持原 sync API 契约不变
 * （useToolActions 等调用方零修改）。P5 单源编译阶段升级为完整 SHA-256 时
 * 再决定是否引入异步路径（届时需在 store 层提供 sync wrapper 维持契约）。
 *
 * 同一 data 总是产生同一 revision；不同 data 极低概率碰撞（djb2 32-bit 空间），
 * 对编辑器场景足够——revision 用于变更检测而非密码学安全。
 */
function computeRevision(data: unknown): string {
  const text = JSON.stringify(data);
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(2).slice(0, 32);
}

export const useGraphStore = defineStore('graph', () => {
  // —— 状态 ——

  const nodes = ref(new Map<NodeId, ResourceNode>());
  const edges = ref<RelationshipEdge[]>([]);
  const indexes = ref<GraphIndexes>({ inbound: new Map(), outbound: new Map() });
  const revisions = ref(new Map<NodeId, string>());

  /** 事件订阅器——简单的 emit/on 模型，避免引入 mitt 等库 */
  const listeners = ref<Array<(e: GraphEvent) => void>>([]);

  // —— Getters ——

  /** 资源总数 */
  const nodeCount = computed(() => nodes.value.size);

  /** 边总数 */
  const edgeCount = computed(() => edges.value.length);

  /** 按 kind 分组统计 */
  const nodeCountByKind = computed(() => {
    const counts = new Map<string, number>();
    for (const node of nodes.value.values()) {
      counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    }
    return counts;
  });

  /**
   * 按 kind 列出所有节点——派生 projectStore / configStore 等消费方主入口。
   *
   * 返回当前 graph 中匹配 kind 的所有 ResourceNode 数组（按 nodeId 升序，保证确定性）。
   */
  function findNodesByKind(kind: string): ResourceNode[] {
    const result: ResourceNode[] = [];
    for (const node of nodes.value.values()) {
      if (node.kind === kind) result.push(node);
    }
    result.sort((a, b) => {
      const aId = `${a.kind}:${a.id}`;
      const bId = `${b.kind}:${b.id}`;
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
    return result;
  }

  // —— Actions ——

  /**
   * 订阅图事件。返回取消订阅函数。
   */
  function subscribe(listener: (e: GraphEvent) => void): () => void {
    listeners.value.push(listener);
    return () => {
      const idx = listeners.value.indexOf(listener);
      if (idx >= 0) listeners.value.splice(idx, 1);
    };
  }

  function emit(event: GraphEvent): void {
    for (const listener of listeners.value) {
      try {
        listener(event);
      } catch (err) {
        // 订阅器异常不阻断图状态变更
        console.error('[graph-store] subscriber error:', err);
      }
    }
  }

  /**
   * 新增或更新节点。同一 nodeId 重复 upsert 视为更新。
   * 自动计算 revision 并维护索引。
   *
   * 同步实现（P0-P4）：保证 projectStore / configStore 的 sync API 契约不变。
   */
  function upsertNode<T>(node: ResourceNode<T>): void {
    const nodeId: NodeId = `${node.kind}:${node.id}`;
    const revision = computeRevision(node.data);
    const normalized: ResourceNode = {
      ...node,
      revision,
    } as ResourceNode;
    nodes.value.set(nodeId, normalized);
    revisions.value.set(nodeId, revision);
    emit({ type: 'node-upserted', nodeId, kind: node.kind });
  }

  /**
   * 批量 upsert——loader 加载完成后一次性写入，避免逐个 upsert 的事件风暴。
   * 不触发单独的 node-upserted 事件，调用方应在外部触发 workspace:loaded。
   *
   * 同步实现（P0-P4）：保证 loader / projectStore 的 sync 调用链。
   */
  function upsertNodes<T>(batch: ResourceNode<T>[]): void {
    for (const node of batch) {
      const nodeId: NodeId = `${node.kind}:${node.id}`;
      const revision = computeRevision(node.data);
      nodes.value.set(nodeId, { ...node, revision } as ResourceNode);
      revisions.value.set(nodeId, revision);
    }
  }

  /**
   * 删除节点。级联清理相关边，emit `node-removed` 事件。
   */
  function removeNode(nodeId: NodeId): RelationshipEdge[] {
    const node = nodes.value.get(nodeId);
    if (!node) return [];

    // 找到所有触及该节点的边
    const touchingEdgeIds = new Set(findEdgesTouchingNode(indexes.value, nodeId));
    const removedEdges: RelationshipEdge[] = [];

    edges.value = edges.value.filter((edge) => {
      if (touchingEdgeIds.has(edge.id)) {
        removeEdgeFromIndexes(indexes.value, edge);
        removedEdges.push(edge);
        return false;
      }
      return true;
    });

    nodes.value.delete(nodeId);
    revisions.value.delete(nodeId);
    emit({
      type: 'node-removed',
      nodeId,
      kind: node.kind,
      cascadedEdges: removedEdges.map((e) => e.id),
    });
    return removedEdges;
  }

  /**
   * 添加边。同一 from/to/type 组合允许多条边（如同一 recipe 多个 consumes_item）。
   * 若不传 sequence，则自动计算序号保证边 ID 唯一。
   */
  function addEdge(
    type: RelationshipType,
    from: NodeId,
    to: NodeId,
    options?: {
      sourceAnchor?: RelationshipEdge['sourceAnchor'];
      metadata?: Record<string, unknown>;
      sequence?: number;
    },
  ): string {
    const sequence = options?.sequence ?? nextSequence(type, from, to);
    const edgeId = buildEdgeId(type, from, to, sequence);
    const edge: RelationshipEdge = {
      id: edgeId,
      type,
      from,
      to,
      sourceAnchor: options?.sourceAnchor,
      metadata: options?.metadata,
    };
    edges.value.push(edge);
    addEdgeToIndexes(indexes.value, edge);
    emit({ type: 'edge-added', edgeId });
    return edgeId;
  }

  /**
   * 移除边（按 edgeId）。
   */
  function removeEdge(edgeId: string): void {
    const idx = edges.value.findIndex((e) => e.id === edgeId);
    if (idx < 0) return;
    const edge = edges.value[idx];
    edges.value.splice(idx, 1);
    if (edge) {
      removeEdgeFromIndexes(indexes.value, edge);
    }
    emit({ type: 'edge-removed', edgeId });
  }

  /**
   * 计算下一个序号——同一 from/to/type 组合下避免序号冲突。
   */
  function nextSequence(type: RelationshipType, from: NodeId, to: NodeId): number {
    let max = -1;
    for (const edge of edges.value) {
      if (edge.type === type && edge.from === from && edge.to === to) {
        // 解析 edge.id 末尾的 #N
        const match = edge.id.match(/#(\d+)$/);
        const seq = match?.[1] ? parseInt(match[1], 10) : 0;
        if (seq > max) max = seq;
      }
    }
    return max + 1;
  }

  /**
   * 反向引用查询——返回所有引用指定节点 的边。
   */
  function getInbound(nodeId: NodeId): RelationshipEdge[] {
    const edgeIds = indexes.value.inbound.get(nodeId);
    if (!edgeIds) return [];
    return edges.value.filter((e) => edgeIds.has(e.id));
  }

  /**
   * 正向引用查询——返回指定节点 发出的所有边。
   */
  function getOutbound(nodeId: NodeId): RelationshipEdge[] {
    const edgeIds = indexes.value.outbound.get(nodeId);
    if (!edgeIds) return [];
    return edges.value.filter((e) => edgeIds.has(e.id));
  }

  /**
   * 按边类型筛选反向引用。
   */
  function findInboundByEdgeType(nodeId: NodeId, edgeType: RelationshipType): RelationshipEdge[] {
    return getInbound(nodeId).filter((e) => e.type === edgeType);
  }

  /**
   * 按边类型筛选正向引用。
   */
  function findOutboundByEdgeType(nodeId: NodeId, edgeType: RelationshipType): RelationshipEdge[] {
    return getOutbound(nodeId).filter((e) => e.type === edgeType);
  }

  /**
   * 装载完成后的索引重建——批量加载场景使用。
   */
  function rebuildIndexes(): void {
    indexes.value = buildIndexes(edges.value);
  }

  /**
   * 通过 contains 边查询子节点（默认 edgeType='contains'）。
   *
   * 用于 world.region → world.tile 父子关系查询，也可用于其他 contains 边场景。
   */
  function findChildren(
    parentNodeId: NodeId,
    edgeType: RelationshipType = 'contains',
  ): ResourceNode[] {
    const outbound = getOutbound(parentNodeId).filter((e) => e.type === edgeType);
    const result: ResourceNode[] = [];
    const seen = new Set<string>();
    for (const edge of outbound) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      const node = nodes.value.get(edge.to);
      if (node) result.push(node);
    }
    return result;
  }

  /**
   * 专为 world.tile 提供的邻接查询——合并 inbound + outbound 的 adjacent_to 边去重。
   *
   * 返回的是当前 graph 中的邻接关系，不含 _breaks 状态——调用方需自行合并 _breaks 信息。
   */
  function findAdjacent(tileNodeId: NodeId): ResourceNode[] {
    const inbound = findInboundByEdgeType(tileNodeId, 'adjacent_to');
    const outbound = findOutboundByEdgeType(tileNodeId, 'adjacent_to');
    const result: ResourceNode[] = [];
    const seen = new Set<string>();
    for (const edge of [...inbound, ...outbound]) {
      const otherId = edge.from === tileNodeId ? edge.to : edge.from;
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      const node = nodes.value.get(otherId);
      if (node) result.push(node);
    }
    return result;
  }

  /**
   * 批量 upsert 节点与边——生成器写入场景使用。
   *
   * 一次性更新 nodes 与 edges（维护索引），最后 emit 单次 `graph:batch-applied` 事件，
   * 避免逐个 upsert / addEdge 触发的事件风暴。
   *
   * 同步实现（P0-P4）：保证 projectStore.applyProjectToGraph 等批量写入路径同步。
   */
  function applyNodeBatch(
    upserts: ResourceNode[],
    edgeUpserts: RelationshipEdge[] = [],
  ): void {
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];

    // 批量 upsert nodes（计算 revision）
    for (const node of upserts) {
      const nodeId: NodeId = `${node.kind}:${node.id}`;
      const revision = computeRevision(node.data);
      nodes.value.set(nodeId, { ...node, revision } as ResourceNode);
      revisions.value.set(nodeId, revision);
      nodeIds.push(nodeId);
    }

    // 批量 add edges（维护索引）
    for (const edge of edgeUpserts) {
      edges.value.push(edge);
      addEdgeToIndexes(indexes.value, edge);
      edgeIds.push(edge.id);
    }

    emit({ type: 'graph:batch-applied', nodeIds, edgeIds });
  }

  /**
   * 判断指定文件路径是否被任一已注册 kind 的 sourceFiles 覆盖。
   *
   * 用于 useImportExport.isParsedFile 判断某文件是否属于 graph 装配范围。
   * P1 阶段采用简单 glob 匹配：把 `${id}` 模板视为 `[^/]+` 通配。
   */
  function isPathCoveredByGraph(filePath: string): boolean {
    for (const kind of listKinds()) {
      const schema = getKindSchema(kind);
      if (!schema) continue;
      for (const spec of schema.sourceFiles) {
        if (pathMatchesTemplate(spec.path, filePath)) return true;
      }
    }
    return false;
  }

  /**
   * 路径模板匹配——把 `${...}` 替换为 `[^/]+` 通配后转为正则匹配。
   */
  function pathMatchesTemplate(template: string, filePath: string): boolean {
    const parts = template.split(/\$\{[^}]+\}/);
    const regexStr =
      '^' + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$';
    return new RegExp(regexStr).test(filePath);
  }

  /**
   * 清空图状态——测试与工作区重载使用。
   */
  function clear(): void {
    nodes.value.clear();
    edges.value.length = 0;
    indexes.value.inbound.clear();
    indexes.value.outbound.clear();
    revisions.value.clear();
  }

  return {
    // state
    nodes,
    edges,
    indexes,
    revisions,
    // getters
    nodeCount,
    edgeCount,
    nodeCountByKind,
    // actions: queries (按 kind 查询)
    findNodesByKind,
    // actions: subscription
    subscribe,
    // actions: nodes
    upsertNode,
    upsertNodes,
    removeNode,
    // actions: edges
    addEdge,
    removeEdge,
    // actions: queries
    getInbound,
    getOutbound,
    findInboundByEdgeType,
    findOutboundByEdgeType,
    findChildren,
    findAdjacent,
    // actions: bulk
    applyNodeBatch,
    isPathCoveredByGraph,
    rebuildIndexes,
    clear,
  };
});
