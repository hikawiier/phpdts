/**
 * @module O 内容工具箱
 *
 * 第 2 层：结构校验——迁移现有 17 个规则（纯结构）。
 *
 * 检查目标（执行案 §4.7.3）：
 *   - pls / pgroup 范围、tide / floor 取值、占用冲突（5 条）
 *   - 区域 next/prev/entrance/exit 引用完整性（7 条）
 *   - neighbors 悬空 + 对称性（2 条）
 *   - exit_links 跨区域引用（2 条）
 *   - 连通性孤岛 BFS（1 条）
 *
 * 设计意图：
 *   - 对齐 legacy runLightValidation：跳过 BFS 与配置交叉引用
 *   - 配置交叉引用（poi_pool_ref / loot_table_id / scatter item_id）
 *     迁移到 reference-validator（第 3 层），保持 Light = 1+2 不含 cross-ref 契约
 *   - BFS（validateConnectivity）保留在 structure-validator，但函数内部
 *     仅在 entrance_pls != null 时执行，对齐 legacy 行为
 *   - P1-H 已完成迁移：直接从 graph-store 读取 world.region / world.tile 节点，
 *     不再依赖 projectStore（projectStore 已退化为 graph-store 的响应式入口）
 *   - 返回 Issue[]（统一问题模型），由 validateStore 适配为 ValidateIssue[] 供 UI 使用
 */

import type { Issue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';
import { runStructureValidationFromGraph } from '@/services/validate-rules';
import type { ValidateIssue } from '@/shared';

/**
 * 把现有 ValidateIssue 转换为统一 Issue 模型。
 *
 * resourceRef 推断规则：
 *   - location.pgroup != null → { kind: 'world.region', id: String(pgroup) }
 *   - 否则 → { kind: 'config', id: '' }（配置类问题，无空间锚点）
 */
function toIssue(v: ValidateIssue): Issue {
  const resourceRef =
    v.location.pgroup != null
      ? { kind: 'world.region', id: String(v.location.pgroup) }
      : { kind: 'config', id: '' };
  return {
    ruleId: v.rule,
    severity: v.severity,
    message: v.message,
    resourceRef,
    hint: v.hint,
    location: v.location,
  };
}

/**
 * 第 2 层校验——结构校验。
 *
 * 迁移现有 17 个规则（来自 services/validate-rules.ts），返回 Issue[]。
 *
 * P1-H 迁移说明：
 *   - 直接调用 runStructureValidationFromGraph(graphStore)，从 graph-store 读取
 *     world.region / world.tile 节点后重建 MapProject 形状，复用 5 个纯函数规则集
 *   - 不再依赖 projectStore（P1-E 后 projectStore.project 已是 graph-store 的派生 computed）
 *   - 配置交叉引用（validateConfigReferences）已迁移到 reference-validator（第 3 层）
 *
 * @param graph 图状态（结构校验直接从 graph 读取 world 节点）
 * @param _changeSet Change Set（P0 阶段未使用，P5 编译校验使用）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  const legacyIssues: ValidateIssue[] = runStructureValidationFromGraph(graph);
  return legacyIssues.map(toIssue);
}
