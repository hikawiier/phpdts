/**
 * @module O 内容工具箱
 * @framework O-10 分层校验
 *
 * 统一问题模型。所有 8 层校验器返回 Issue[]，由 validateStore 适配为
 * 现有 ValidateIssue[]（向后兼容 ValidatePanel / ValidateView）。
 *
 * 设计意图（执行案 §4.7.1）：
 *   - ruleId 稳定：跨版本保持不变，作为 i18n key 与单测锚点
 *   - severity 二档：error / warning，对齐 validate.ts 与 P6 §4.5.1 决策
 *   - blocking 字段保留给 P6 镜像校验扩展，P0 阶段不使用
 *   - resourceRef 指向受影响资源（kind + id），与 graph-store 节点命名空间一致
 *   - sourceAnchor 复用 graph/edge.ts 的 SourceAnchor（边与节点共享同一锚点类型）
 *   - affectedDownstream 用于影响分析（删除某资源时连锁影响）
 *   - quickFix 由 quick-fixes.ts 注册表管理，P0 阶段空注册表
 *
 * 最小修正（执行案 §4.7.1 之外）：
 *   - hint 字段：现有 ValidateIssue.hint 用于 UI 显示修复建议，迁移 20 个规则时
 *     需要保留 hint 文本，故 Issue 添加可选 hint 字段
 *   - location 字段：现有 ValidateIssue.location 是 { pgroup, pls, field }，
 *     ValidatePanel 直接读取以显示位置锚点；新规则（如 item_table.*）无 pgroup/pls
 *     概念，location 留空，由 resourceRef 替代
 */

import type { SourceAnchor } from '@/graph/edge';
import type { QuickFix } from './quick-fixes';

/**
 * 严重级别——二档设计，对齐 validate.ts 与 P6 §4.5.1 决策。
 */
export type Severity = 'error' | 'warning';

/**
 * 校验层编号（1-8）。
 *
 * 层级与执行案 §4.7 一致：
 *   1. input        — 输入校验（PHP 解析失败 / 文件缺失）
 *   2. structure    — 结构校验（迁移现有 20 个规则）
 *   3. reference    — 引用校验（25 个跨资源引用规则）
 *   4. semantic     — 语义校验（P1+ 实现）
 *   5. distribution  — 分布校验（P1+ 实现）
 *   6. presentation — 呈现校验（P1+ 实现，需 presentation.* schema 注册）
 *   7. compile      — 编译校验（P5 单源编译实现）
 *   8. mirror       — 运行时镜像校验（P6 实现）
 */
export type ValidationLayer = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * 受影响资源引用——与 graph-store 节点命名空间一致。
 */
export interface ResourceRef {
  kind: string;
  id: string;
}

/**
 * 统一问题（一条）。
 *
 * 校验器返回 Issue[]，validateStore 适配为 ValidateIssue[] 供 UI 使用。
 */
export interface Issue {
  /** 稳定规则 ID（跨版本不变，作为 i18n key 与单测锚点） */
  ruleId: string;
  /** 严重级别（二档，对齐 validate.ts 与 P6 §4.5.1） */
  severity: Severity;
  /** 阻断发布（P6 镜像校验扩展字段，P0 阶段不使用） */
  blocking?: boolean;
  /** 受影响资源（kind + id，与 graph-store 节点命名空间一致） */
  resourceRef: ResourceRef;
  /** 源码锚点（复用 graph/edge.ts 的 SourceAnchor） */
  sourceAnchor?: SourceAnchor;
  /** 人类可读原因 */
  message: string;
  /** 受影响下游资源（删除某资源时连锁影响） */
  affectedDownstream?: ResourceRef[];
  /** 可执行修复（由 quick-fixes.ts 注册表管理） */
  quickFix?: QuickFix;

  // —— 最小修正：向后兼容现有 ValidateIssue ——

  /** 修复建议（UI 显示，向后兼容 ValidateIssue.hint） */
  hint?: string;
  /** 跳转锚点（UI 跳转使用，向后兼容 ValidateIssue.location） */
  location?: {
    pgroup?: number | null;
    pls?: number | null;
    field?: string;
  };
}

/**
 * 构造 Issue 工厂（减少样板代码）。
 *
 * resourceRef 与 location 都接受可选传入：
 *   - 新规则只填 resourceRef（如 item_table.* 规则）
 *   - 迁移规则同时填 location（保持现有 UI 跳转行为）
 *
 * P6 扩展：新增 blocking 可选参数（执行案 §4.5.1）。
 * 镜像不一致的 issue 标记 blocking=true + severity='error'，阻断构建发布。
 * 现有 20 个规则不传 blocking，保持默认 false（向后兼容）。
 */
export function makeIssue(params: {
  ruleId: string;
  severity: Severity;
  message: string;
  resourceRef: ResourceRef;
  hint?: string;
  location?: Issue['location'];
  sourceAnchor?: SourceAnchor;
  affectedDownstream?: ResourceRef[];
  blocking?: boolean;
}): Issue {
  return {
    ruleId: params.ruleId,
    severity: params.severity,
    message: params.message,
    resourceRef: params.resourceRef,
    hint: params.hint,
    location: params.location,
    sourceAnchor: params.sourceAnchor,
    affectedDownstream: params.affectedDownstream,
    blocking: params.blocking,
  };
}
