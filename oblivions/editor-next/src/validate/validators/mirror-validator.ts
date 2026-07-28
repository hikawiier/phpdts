/**
 * @module O 内容工具箱
 * @framework O-12 运行时镜像校验
 *
 * 第 8 层：运行时镜像校验（P6 实现，执行案 §4.5.2 + §5.2）。
 *
 * 设计意图：
 * - 编译产物在运行时的实际行为与编辑器模型一致
 * - severity 二档不变，扩展 blocking 字段标记阻断发布
 * - 镜像校验失败时阻断 Change Set 提交
 *
 * 12 个 rule ID（执行案 §4.5.2）：
 *   - mirror.world_init.count_mismatch (error + blocking)
 *   - mirror.world_init.distribution_mismatch (error + blocking)
 *   - mirror.world_init.invariant_violation (error + blocking)
 *   - mirror.day_refresh.count_mismatch (error + blocking)
 *   - mirror.day_refresh.distribution_mismatch (error + blocking)
 *   - mirror.loot_roll.distribution_mismatch (error + blocking)
 *   - mirror.loot_roll.invariant_violation (error + blocking)
 *   - mirror.enemy_spawn.count_mismatch (error + blocking)
 *   - mirror.enemy_spawn.distribution_mismatch (error + blocking)
 *   - mirror.backend_unreachable (warning，不阻断)
 *   - mirror.invariant_violation (error + blocking，通用)
 *
 * 分工约定：
 * - 本 validate(graph, changeSet?) 函数是 O-10 调度入口——返回空数组，
 *   因为镜像校验需要异步拉取后端 State API 快照，不能在同步 validate 函数中完成
 * - convertMirrorResults() 函数把 mirror-runner 的 MirrorComparisonResult[]
 *   转换为 O-10 Issue[]——供 validateStore 在 mirror-runner 完成后调用，
 *   把镜像差异合并到 O-10 校验报告
 * - mirror-runner.ts 负责调度运行时镜像器 + 拉取后端快照 + 调用 snapshot-comparator
 *
 * 数据源：
 * - graph-store：读取 Resource Graph 中的资源节点（world.region / world.tile /
 *   distribution.* / *.template 等镜像器输入）
 * - 后端 State API：通过 snapshot-fetcher 拉取 debug_poi_all / game_map / enemies
 *   / player_inventory / debug_player_full /
 *   debug_gamevars / debug_diag_log 等 scope
 */

import type { Issue } from '../issue-model';
import { makeIssue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';
import { VALIDATE_RULES } from '@/shared/constants/validate-rules';
import type { MirrorComparisonResult, MirrorDifference, InvariantViolation } from '@/mirror/snapshot-comparator';

// ─── 规则 ID 常量（对齐 VALIDATE_RULES 注册表） ─────────────────

const RULE_MIRROR_WORLD_INIT_COUNT_MISMATCH = VALIDATE_RULES.MIRROR_WORLD_INIT_COUNT_MISMATCH;
const RULE_MIRROR_WORLD_INIT_DISTRIBUTION_MISMATCH = VALIDATE_RULES.MIRROR_WORLD_INIT_DISTRIBUTION_MISMATCH;
const RULE_MIRROR_WORLD_INIT_INVARIANT_VIOLATION = VALIDATE_RULES.MIRROR_WORLD_INIT_INVARIANT_VIOLATION;
const RULE_MIRROR_DAY_REFRESH_COUNT_MISMATCH = VALIDATE_RULES.MIRROR_DAY_REFRESH_COUNT_MISMATCH;
const RULE_MIRROR_DAY_REFRESH_DISTRIBUTION_MISMATCH = VALIDATE_RULES.MIRROR_DAY_REFRESH_DISTRIBUTION_MISMATCH;
const RULE_MIRROR_LOOT_ROLL_DISTRIBUTION_MISMATCH = VALIDATE_RULES.MIRROR_LOOT_ROLL_DISTRIBUTION_MISMATCH;
const RULE_MIRROR_LOOT_ROLL_INVARIANT_VIOLATION = VALIDATE_RULES.MIRROR_LOOT_ROLL_INVARIANT_VIOLATION;
const RULE_MIRROR_ENEMY_SPAWN_COUNT_MISMATCH = VALIDATE_RULES.MIRROR_ENEMY_SPAWN_COUNT_MISMATCH;
const RULE_MIRROR_ENEMY_SPAWN_DISTRIBUTION_MISMATCH = VALIDATE_RULES.MIRROR_ENEMY_SPAWN_DISTRIBUTION_MISMATCH;
const RULE_MIRROR_BACKEND_UNREACHABLE = VALIDATE_RULES.MIRROR_BACKEND_UNREACHABLE;
const RULE_MIRROR_INVARIANT_VIOLATION = VALIDATE_RULES.MIRROR_INVARIANT_VIOLATION;

// ─── 镜像器 ID → rule ID 映射 ─────────────────────────────────

/**
 * 镜像器 ID → 该镜像器"差异维度"对应的 rule ID 映射。
 *
 * 镜像器输出的 MirrorDifference.dimension 决定映射到哪个 rule ID：
 *   - count → ${mirrorId}.count_mismatch
 *   - distribution → ${mirrorId}.distribution_mismatch
 *   - reference / capacity → ${mirrorId}.invariant_violation 或通用 mirror.invariant_violation
 *
 * 配方匹配不属于运行时镜像校验：配方数据由 O-10 静态 schema / reference /
 * semantic 校验覆盖，不再通过后端 craft_preview 做全局镜像。
 */
const MIRROR_ID_TO_COUNT_RULE: Record<string, string> = {
  'world-init': RULE_MIRROR_WORLD_INIT_COUNT_MISMATCH,
  'day-refresh': RULE_MIRROR_DAY_REFRESH_COUNT_MISMATCH,
  'enemy-spawn': RULE_MIRROR_ENEMY_SPAWN_COUNT_MISMATCH,
};

const MIRROR_ID_TO_DISTRIBUTION_RULE: Record<string, string> = {
  'world-init': RULE_MIRROR_WORLD_INIT_DISTRIBUTION_MISMATCH,
  'day-refresh': RULE_MIRROR_DAY_REFRESH_DISTRIBUTION_MISMATCH,
  'loot-roll': RULE_MIRROR_LOOT_ROLL_DISTRIBUTION_MISMATCH,
  'enemy-spawn': RULE_MIRROR_ENEMY_SPAWN_DISTRIBUTION_MISMATCH,
};

const MIRROR_ID_TO_INVARIANT_RULE: Record<string, string> = {
  'world-init': RULE_MIRROR_WORLD_INIT_INVARIANT_VIOLATION,
  'loot-roll': RULE_MIRROR_LOOT_ROLL_INVARIANT_VIOLATION,
};

// ─── 第 8 层校验入口 ──────────────────────────────────────────

/**
 * 第 8 层校验——运行时镜像校验入口（同步占位）。
 *
 * 镜像校验需要异步拉取后端 State API 快照（snapshot-fetcher）并跑 N 次模拟对比，
 * 不能在同步 validate(graph, changeSet?) 函数中完成。本函数返回空数组——
 * 实际的镜像差异通过 convertMirrorResults() 异步合并到 O-10 报告。
 *
 * 调用流程（执行案 §4.6）：
 *   1. content-compiler 第 9 步编译产物替换成功后，触发 mirror-runner.runAll()
 *   2. mirror-runner 调用 snapshot-fetcher 拉取后端权威快照
 *   3. mirror-runner 调用各镜像器 + snapshot-comparator 生成 MirrorComparisonResult[]
 *   4. validateStore 调用 convertMirrorResults(results) 把结果转换为 Issue[]
 *   5. 镜像 Issue[] 合并到 O-10 报告，blocking=true 的 issue 阻断发布
 *
 * @param _graph graph-store 实例（保留参数供未来同步预校验扩展使用）
 * @param _changeSet Change Set（保留参数供未来扩展使用）
 * @returns Issue[]——同步入口返回空数组，实际镜像差异通过 convertMirrorResults 异步合并
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(_graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  // 镜像校验是异步流程，同步入口返回空数组。
  // 实际差异通过 convertMirrorResults(MirrorComparisonResult[]) → Issue[] 异步合并。
  // 见 mirror-runner.ts 与 validateStore 的协同。
  return [];
}

// ─── 镜像差异转换 ───────────────────────────────────────────────

/**
 * 把 mirror-runner 的 MirrorComparisonResult[] 转换为 O-10 Issue[]（执行案 §4.5.2）。
 *
 * 设计意图：
 * - mirror-runner 异步执行运行时镜像器，输出 MirrorComparisonResult[]
 * - O-10 校验面板统一使用 Issue 结构（含 resourceRef / blocking 等）
 * - 本函数负责桥接：MirrorComparisonResult.differences → Issue[]
 *
 * 转换规则：
 *   - 后端不可达 (mirrorId === '__backend__') → mirror.backend_unreachable (warning)
 *   - 其他镜像器的 count 维度差异 → ${mirrorId}.count_mismatch (error + blocking)
 *   - 其他镜像器的 distribution 维度差异 → ${mirrorId}.distribution_mismatch (error + blocking)
 *   - 其他镜像器的 reference/capacity 维度差异 → ${mirrorId}.invariant_violation
 *     （若该镜像器无独立 invariant 规则，回退到通用 mirror.invariant_violation）
 *   - InvariantViolation[] → 对应镜像器的 invariant_violation 规则
 *   - 所有 error 级镜像差异标记 blocking=true（执行案 §4.5.1 决策）
 *
 * @param results mirror-runner 输出的对比结果列表
 * @returns Issue[]——可直接合并到 O-10 校验报告
 */
export function convertMirrorResults(results: readonly MirrorComparisonResult[]): Issue[] {
  const issues: Issue[] = [];

  for (const result of results) {
    // 后端不可达——emit warning，不阻断发布
    if (result.mirrorId === '__backend__') {
      issues.push(
        makeIssue({
          ruleId: RULE_MIRROR_BACKEND_UNREACHABLE,
          severity: 'warning',
          message: `部分后端快照不可用，对应镜像校验已跳过：${result.summary}`,
          resourceRef: { kind: 'backend', id: 'state-api' },
          hint: '确认游戏服务器已启动、?debug=all 已启用，且镜像所需 State API scope 可用',
          blocking: false,
        }),
      );
      continue;
    }

    // 按 dimension 映射到对应 rule ID
    for (const diff of result.differences) {
      const ruleId = resolveRuleIdByDimension(result.mirrorId, diff.dimension);
      issues.push(
        makeIssue({
          ruleId,
          severity: 'error',
          message: formatDifferenceMessage(result.mirrorId, diff),
          resourceRef: { kind: 'mirror', id: result.mirrorId },
          hint: `容忍度 ${(diff.tolerance * 100).toFixed(1)}%——超出容忍度表示镜像器与后端算法存在行为差异`,
          blocking: true,
        }),
      );
    }

    // 不变量违反——emit error + blocking
    for (const violation of result.invariantViolations) {
      const ruleId = MIRROR_ID_TO_INVARIANT_RULE[result.mirrorId] ?? RULE_MIRROR_INVARIANT_VIOLATION;
      issues.push(
        makeIssue({
          ruleId,
          severity: 'error',
          message: formatInvariantMessage(result.mirrorId, violation),
          resourceRef: { kind: 'mirror', id: result.mirrorId },
          hint: '不变量违反通常意味着镜像器或后端算法存在边界案例 bug',
          blocking: true,
        }),
      );
    }
  }

  return issues;
}

// ─── 内部工具 ───────────────────────────────────────────────────

/**
 * 根据镜像器 ID 与差异维度解析对应的 rule ID。
 *
 * 维度 → rule ID 映射规则：
 *   - count → ${mirrorId}.count_mismatch（若该镜像器无 count_mismatch 规则，回退到 invariant_violation）
 *   - distribution → ${mirrorId}.distribution_mismatch（同上回退）
 *   - reference / capacity → ${mirrorId}.invariant_violation（若无独立 invariant 规则，回退到通用 mirror.invariant_violation）
 */
function resolveRuleIdByDimension(mirrorId: string, dimension: MirrorDifference['dimension']): string {
  if (dimension === 'count') {
    return MIRROR_ID_TO_COUNT_RULE[mirrorId] ?? RULE_MIRROR_INVARIANT_VIOLATION;
  }
  if (dimension === 'distribution') {
    return MIRROR_ID_TO_DISTRIBUTION_RULE[mirrorId] ?? RULE_MIRROR_INVARIANT_VIOLATION;
  }
  // reference / capacity → invariant_violation
  return MIRROR_ID_TO_INVARIANT_RULE[mirrorId] ?? RULE_MIRROR_INVARIANT_VIOLATION;
}

/**
 * 格式化差异消息（人类可读）。
 */
function formatDifferenceMessage(mirrorId: string, diff: MirrorDifference): string {
  const tolerancePercent = (diff.tolerance * 100).toFixed(1);
  const withinToleranceLabel = diff.isWithinTolerance ? '在容忍度内' : '超出容忍度';
  return `镜像器 ${mirrorId} ${diff.dimension} 差异（${withinToleranceLabel}）：期望=${JSON.stringify(diff.expected)} 实际=${JSON.stringify(diff.actual)} 容忍度=${tolerancePercent}%`;
}

/**
 * 格式化不变量违反消息（人类可读）。
 */
function formatInvariantMessage(mirrorId: string, violation: InvariantViolation): string {
  return `镜像器 ${mirrorId} 不变量违反：${violation.name}——${violation.detail}`;
}
