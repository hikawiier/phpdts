/**
 * @module O 内容工具箱
 * @framework O-3 Resource Graph
 *
 * 关系边类型定义。边添加时由 graph-store 自动维护 inboundIndex / outboundIndex。
 */

import type { RelationshipType } from './relationship-types';

/**
 * 源码锚点——记录资源在哪个文件的哪些行。
 *
 * ResourceNode.source 是多源数组（同一资源可能跨多个 PHP/TS 文件）；
 * RelationshipEdge.sourceAnchor 是单源（边来自某一处显式声明）。
 */
export interface SourceAnchor {
  /** 文件绝对路径或工作区相对路径（约定以 `oblivions/` 或 `vex-vue/` 为前缀） */
  filePath: string;
  /** 起始行（1-based，包含） */
  lineStart: number;
  /** 结束行（1-based，包含） */
  lineEnd: number;
  /** 文件格式——P5 阶段新增 'yaml' 标记作者资源来源 */
  format: 'php' | 'ts' | 'yaml';
}

/**
 * 资源节点 ID 格式：`${kind}:${id}`，例如 `item.template:compass`。
 *
 * 在 graph-store 内部统一以 nodeId 作为 Map key，便于 O-7 模板工作区按 kind 过滤。
 */
export type NodeId = string;

/**
 * 关系边——所有关系都是一等数据，工具箱的搜索、反向引用、删除保护、
 * 影响分析、地图叠层、构建顺序都从同一张边集合派生。
 */
export interface RelationshipEdge {
  /** 边 ID，格式 `${type}:${from}->${to}` 或带序号后缀保证唯一 */
  id: string;
  /** 边类型 */
  type: RelationshipType;
  /** 起点节点 ID */
  from: NodeId;
  /** 终点节点 ID */
  to: NodeId;
  /** 源码锚点（边来自哪处声明） */
  sourceAnchor?: SourceAnchor;
  /** 元数据（如 loot table 的 group_index、recipe 的 slot_index） */
  metadata?: Record<string, unknown>;
}

/**
 * 构造边 ID——同一 from/to/type 组合允许多条边（如同一 recipe 多个 consumes_item），
 * 通过序号区分。
 */
export function buildEdgeId(
  type: RelationshipType,
  from: NodeId,
  to: NodeId,
  sequence?: number,
): string {
  return sequence === undefined
    ? `${type}:${from}->${to}`
    : `${type}:${from}->${to}#${sequence}`;
}
