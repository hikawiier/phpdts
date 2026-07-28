/**
 * @module O 内容工具箱
 *
 * 模板工作区编辑动作封装——graph-store 节点 upsert/remove + 受影响文件标记。
 *
 * 设计意图（P2 §4.5）：
 *   - 工作区编辑不直接写文件，仅修改 graph-store 中的节点；
 *     实际文件写入由 O-5 Change Set 原子发布管道在 P5 实现。
 *   - 每次编辑同时登记"受影响文件"，供 BuildView 显示 diff 预览。
 *   - 节点 → 文件路径的映射通过 schema.sourceFiles 查询（首个 spec.path）。
 *   - 删除时通过 graph-store.removeNode 级联清理边，emit node-removed 事件
 *     供 O-9 呈现工作区与 O-10 校验调度订阅。
 *
 * P2 阶段简化点：
 *   - 不与 ChangeSet 实例集成（ChangeSet 在 P5 才完整接入）；
 *     通过模块级 affectedFiles Set 直接登记，BuildView 通过 useTemplateActions 读取。
 *   - 删除保护的两级流程（影响范围 + 替换/级联/取消）由 DeleteProtectionModal 组件实现，
 *     本 composable 仅提供 removeNodeWithCascade 用于"级联删除"路径。
 */

import { ref } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { getKindSchema } from '@/schema/registry';
import type { ResourceNode } from '@/graph/types';
import type { NodeId, RelationshipEdge } from '@/graph/edge';

/**
 * 受影响文件集合——模块级单例，BuildView 直接读取。
 *
 * 设计取舍：P2 阶段不引入完整 ChangeSet 单例（P5 接入），
 * 用模块级 Set 兜底；接口形态与 ChangeSet.markFileAffected 一致，
 * P5 切换时只需替换实现。
 */
const affectedFiles = ref<Set<string>>(new Set());

/**
 * 读取当前受影响文件清单（按字母序，便于展示稳定）。
 */
export function getAffectedFiles(): string[] {
  return Array.from(affectedFiles.value).sort();
}

/**
 * 清空受影响文件清单——发布成功后调用。
 */
export function clearAffectedFiles(): void {
  affectedFiles.value.clear();
}

/**
 * 模板工作区编辑动作 composable。
 *
 * 用法：
 *   const actions = useTemplateActions();
 *   actions.upsertNode(node);
 *   actions.removeNode(nodeId);
 *   actions.markFileAffected('oblivions/gamedata/item_table.php');
 */
export function useTemplateActions() {
  const graph = useGraphStore();

  /**
   * 通过 schema.sourceFiles[0].path 查询节点对应的源文件路径。
   * 一个 kind 对应一个主源文件（多源场景在 P5 由 ChangeSet resolver 处理）。
   */
  function getPrimarySourceFile(kind: string): string | null {
    const schema = getKindSchema(kind);
    if (!schema || schema.sourceFiles.length === 0) return null;
    return schema.sourceFiles[0]!.path;
  }

  /**
   * 新增或更新节点。
   *
   * - 写入 graph-store（自动计算 revision）
   * - 标记该 kind 对应的源文件为受影响
   * - 触发 O-10 light 校验调度（debounce 300ms，由 validateStore 订阅 graph 事件）
   */
  function upsertNode<T>(node: ResourceNode<T>): void {
    graph.upsertNode(node);
    const file = getPrimarySourceFile(node.kind);
    if (file) affectedFiles.value.add(file);
  }

  /**
   * 删除节点——graph-store 自动级联清理触及的边。
   *
   * 返回被级联清理的边清单，供调用方展示影响范围或写入诊断日志。
   */
  function removeNode(nodeId: NodeId): RelationshipEdge[] {
    const node = graph.nodes.get(nodeId);
    const removed = graph.removeNode(nodeId);
    if (node) {
      const file = getPrimarySourceFile(node.kind);
      if (file) affectedFiles.value.add(file);
    }
    return removed;
  }

  /**
   * 显式标记文件为受影响——供特殊场景调用（如手工修改后端文件）。
   */
  function markFileAffected(filePath: string): void {
    affectedFiles.value.add(filePath);
  }

  /**
   * 判断节点是否可删除——通过 schema.copyStrategy === 'none' 标记只读资源。
   */
  function isNodeReadOnly(kind: string): boolean {
    const schema = getKindSchema(kind);
    return schema?.copyStrategy === 'none' || schema?.readOnly === true;
  }

  return {
    upsertNode,
    removeNode,
    markFileAffected,
    getPrimarySourceFile,
    isNodeReadOnly,
    affectedFiles,
  };
}
