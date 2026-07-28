/**
 * @module O 内容工具箱
 * @framework O-3 Resource Graph
 *
 * Resource Graph 核心类型定义。所有可编辑内容归一化为带稳定 ID 的 ResourceNode<T>，
 * 关系作为一等数据（RelationshipEdge）。
 */

import type { SourceAnchor, NodeId } from './edge';
import type { ResourceKind } from '../schema/types';

/**
 * 资源节点——所有可编辑内容归一化为此结构。
 *
 * - kind + id 全局唯一，组合为 nodeId `${kind}:${id}`
 * - data 是资源负载，结构由 O-2 KindSchema 定义
 * - presentation 是可选的呈现条目（与 renders_as 边互补，便于 O-9 单点查询）
 * - source 是多源数组（同一资源可能跨多个 PHP/TS 文件）
 * - revision 用于 O-5 Change Set 基线对比与冲突检测
 */
export interface ResourceNode<T = unknown> {
  kind: ResourceKind;
  id: string;
  data: T;
  presentation?: PresentationEntry;
  source: SourceAnchor[];
  /** 内容 hash（SHA-256 前 16 字节十六进制），由 graph-store 在 upsert 时计算 */
  revision: string;
}

/**
 * 呈现条目——附属于资源节点的本地化数据。
 *
 * 在过渡期，presentation 同时存在于 ResourceNode.presentation 与独立的
 * presentation.* kind 节点中；P5 单源编译完成后统一为独立节点。
 */
export interface PresentationEntry {
  /** 呈现类型（如 item / poi / recipe / enemy / terrain） */
  kind: string;
  /** 中文名称 */
  name?: string;
  /** 中文描述 */
  desc?: string;
  /** 附加字段（如分类标签、地形词库） */
  extra?: Record<string, unknown>;
  /** 呈现来源锚点（vex-vue/src/data/*-locale.ts） */
  sourceAnchor?: SourceAnchor;
}

/**
 * 图状态序列化格式——用于工具会话恢复与跨设备同步（P5 之后考虑）。
 */
export interface GraphSnapshot {
  nodes: Array<{ kind: string; id: string; data: unknown; presentation?: PresentationEntry; source: SourceAnchor[]; revision: string }>;
  edges: Array<{ id: string; type: string; from: NodeId; to: NodeId; sourceAnchor?: SourceAnchor; metadata?: Record<string, unknown> }>;
  /** 快照生成时间戳（ms） */
  timestamp: number;
  /** 工作区根路径（用于跨设备恢复时校验） */
  workspaceRoot: string;
}

/**
 * 图状态变更事件——供 O-7 删除保护、O-10 校验调度订阅。
 */
export type GraphEvent =
  | { type: 'node-upserted'; nodeId: NodeId; kind: string }
  | { type: 'node-removed'; nodeId: NodeId; kind: string; cascadedEdges: string[] }
  | { type: 'edge-added'; edgeId: string }
  | { type: 'edge-removed'; edgeId: string }
  | { type: 'graph:batch-applied'; nodeIds: string[]; edgeIds: string[] };
