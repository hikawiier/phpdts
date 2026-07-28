/**
 * @module O 内容工具箱
 * @framework O-12 运行时镜像校验
 *
 * 镜像运行器（执行案 §4.6 + §4.4）。
 *
 * 设计意图：
 * - 调度运行时镜像器 + 拉取后端权威快照 + 调用 snapshot-comparator 生成对比结果
 * - 编译管道第 9 步在编译产物替换成功后调用 runAll() 触发镜像校验
 * - 镜像校验失败（error + blocking=true）时，调用方（atomic-publisher）自动回滚到备份
 * - 后端不可达时降级为"后端不可达"warning，不阻断发布
 *
 * 调用流程（执行案 §4.6.1 第 9 步）：
 *   1. content-compiler 编译产物替换成功
 *   2. mirror-runner.runAll(graphStore, mirrors) 触发
 *   3. snapshot-fetcher.fetchAllMirrorSnapshots() 拉取后端权威快照
 *   4. 依次调用镜像器的 run(graphStore, snapshot) 计算前端镜像输出
 *   5. snapshot-comparator.compareSnapshot() 对比前端镜像与后端权威
 *   6. 返回 MirrorComparisonResult[]
 *   7. validateStore 调用 convertMirrorResults(results) 把结果转换为 Issue[]
 *   8. blocking=true 的 issue 阻断发布；调用方自动回滚
 *
 * P6-1 阶段（基础设施层）：
 * - 提供 runAll / runMirror 函数骨架与 MirrorRunner 类型契约
 * - 各镜像器的 run() 仍是占位实现（返回空 MirrorComparisonResult）
 * - P6-2/P6-3 阶段逐个实现镜像器的实际算法
 *
 * 循环依赖规避：
 * - mirror/index.ts 导入 mirror-runner 的 runAll/runMirror
 * - mirror-runner 不导入 mirror/index.ts 的 MIRRORS——调用方显式传入 mirrors 参数
 * - 默认 mirrors 参数为空数组，调用方必须从 mirror/index.ts 导入 MIRRORS 后传入
 */

import type { useGraphStore } from '@/graph/graph-store';
import type { ClientOptions } from '@/services/workspace/gateway-client';
import type { MirrorComparisonResult } from './snapshot-comparator';
import { compareSnapshot, buildBackendUnreachableResult } from './snapshot-comparator';
import {
  fetchAllMirrorSnapshots,
  fetchMirrorSnapshot,
  GatewayUnavailableError,
  isParameterizedStateScope,
  type MirrorSnapshot,
  type StateScope,
} from './snapshot-fetcher';
import type { Mirror } from './index';

/**
 * GraphStore 类型别名——避免在函数签名中写长 ReturnType 表达式。
 *
 * 与 services/validate-rules.ts / validate/quick-fixes.ts 一致。
 */
type GraphStore = ReturnType<typeof useGraphStore>;

// ─── 镜像运行器接口 ─────────────────────────────────────────────

/**
 * 镜像运行结果——含对比结果 + 可能的后端不可达标记。
 *
 * mirror-runner.runAll() 返回此结构，调用方通过 hasBackendUnavailable 判断是否
 * 需要在 UI 显式提示"后端不可达"。
 */
export interface MirrorRunResult {
  /** 所有镜像器的对比结果（含后端不可达的占位结果） */
  results: MirrorComparisonResult[];
  /** 是否有后端不可达情况——true 时 results 含 mirrorId='__backend__' 的占位结果 */
  hasBackendUnavailable: boolean;
}

// ─── 运行入口 ───────────────────────────────────────────────────

/**
 * 运行所有镜像器（执行案 §4.6.1 第 9 步）。
 *
 * 流程：
 *   1. 调用 snapshot-fetcher.fetchAllMirrorSnapshots() 拉取后端权威快照
 *   2. 依次调用各镜像器的 run(graphStore, snapshot) 计算前端镜像输出
 *   3. 调用 snapshot-comparator.compareSnapshot() 对比前端镜像与后端权威
 *   4. 返回 MirrorComparisonResult[]
 *
 * 后端不可达处理：
 * - snapshot-fetcher 抛 GatewayUnavailableError 时，整个镜像校验降级为 warning
 * - 返回单个 buildBackendUnreachableResult 占位结果
 * - 调用方（atomic-publisher）不阻断发布，仅在 UI 提示
 *
 * P6-1 阶段：镜像器的 run() 是占位实现，返回空 MirrorComparisonResult（无差异）。
 * P6-2/P6-3 阶段逐个实现镜像器的实际算法。
 *
 * @param graphStore graph-store 实例（镜像器读取 Resource Graph 节点）
 * @param mirrors 镜像器列表（由调用方从 mirror/index.ts 导入 MIRRORS 后传入）
 * @param opts 可选配置（透传给 snapshot-fetcher）
 * @returns MirrorRunResult——含所有镜像器的对比结果
 */
export async function runAll(
  graphStore: GraphStore,
  mirrors: readonly Mirror[],
  opts: ClientOptions = {},
): Promise<MirrorRunResult> {
  let snapshots: MirrorSnapshot;
  try {
    snapshots = await fetchAllMirrorSnapshots(opts);
  } catch (err) {
    // 后端不可达——降级为 warning，不阻断发布
    if (err instanceof GatewayUnavailableError) {
      return {
        results: [buildBackendUnreachableResult('all', err.message)],
        hasBackendUnavailable: true,
      };
    }
    throw err;
  }

  const results: MirrorComparisonResult[] = [];
  for (const mirror of mirrors) {
    const result = await runMirror(mirror, graphStore, snapshots, opts);
    results.push(result);
  }

  return {
    results,
    hasBackendUnavailable: results.some((result) => result.mirrorId === '__backend__'),
  };
}

/**
 * 运行单个镜像器。
 *
 * 流程：
 *   1. 从 snapshots 中提取该镜像器所需的 scope 子集（若未拉取则单独拉取）
 *   2. 调用 mirror.run(graphStore, snapshot) 计算前端镜像输出 + 不变量违反列表
 *   3. 调用 compareSnapshot() 对比前端镜像与后端权威
 *
 * @param mirror 镜像器实例
 * @param graphStore graph-store 实例
 * @param snapshots 已拉取的快照集合（可能不含该镜像器所需的全部 scope）
 * @param opts 可选配置（透传给 snapshot-fetcher）
 * @returns MirrorComparisonResult——该镜像器的对比结果
 */
export async function runMirror(
  mirror: Mirror,
  graphStore: GraphStore,
  snapshots: MirrorSnapshot,
  opts: ClientOptions = {},
): Promise<MirrorComparisonResult> {
  // 提取该镜像器所需的 scope 子集
  const requiredScopes = mirror.requiredScopes;
  const mirrorSnapshot: MirrorSnapshot = { ...snapshots };

  // 检查已有快照是否覆盖所需 scope；缺失的单独拉取
  const missingScopes = requiredScopes.filter((scope) => !mirrorSnapshot[scope]);
  if (missingScopes.length > 0) {
    const parameterizedScopes = missingScopes.filter(isParameterizedStateScope);
    if (parameterizedScopes.length > 0) {
      return buildBackendUnreachableResult(
        mirror.id,
        `缺少参数化 State API 采样输入：${parameterizedScopes.join(', ')}`,
      );
    }
    try {
      const extra = await fetchMirrorSnapshot(mirror.id, opts);
      Object.assign(mirrorSnapshot, extra);
    } catch (err) {
      if (err instanceof GatewayUnavailableError) {
        return buildBackendUnreachableResult(mirror.id, err.message);
      }
      throw err;
    }
  }

  // 调用镜像器计算前端镜像输出 + 不变量违反列表
  // P6-1 阶段：mirror.run() 返回 { output: null, invariantViolations: [] }
  const { output, invariantViolations } = await mirror.run(graphStore, mirrorSnapshot);

  // 提取后端权威快照（合并所需的 scope 数据作为对比基准）
  const backendSnapshot = extractBackendSnapshot(mirrorSnapshot, requiredScopes);

  // 调用对比器
  return compareSnapshot(
    mirror.id,
    backendSnapshot,
    output,
    invariantViolations,
    mirror.compareOptions,
  );
}

// ─── 内部工具 ───────────────────────────────────────────────────

/**
 * 从快照集合中提取该镜像器所需的后端权威数据。
 *
 * 简化策略：把所有所需 scope 的 data 合并为一个对象，key 是 scope 名称。
 * 镜像器在 run() 中可以按需读取对应 scope 的数据。
 */
function extractBackendSnapshot(
  snapshot: MirrorSnapshot,
  requiredScopes: readonly StateScope[],
): unknown {
  const result: Record<string, unknown> = {};
  for (const scope of requiredScopes) {
    const entry = snapshot[scope];
    if (entry) {
      result[scope] = entry.data;
    }
  }
  return result;
}
