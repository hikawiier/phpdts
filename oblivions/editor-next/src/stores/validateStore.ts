// @module O 内容工具箱
//
// validateStore：验证结果（O-10 分层校验调度 + P6 第 8 层镜像校验）
//
// 研判（执行案 §4.7.5 + §4.5）：
//   - 验证工具集的状态层 + O-10 调度入口
//   - 移除 lootTableIds / itemTableIds state，由 graph-store 替代
//   - runLight() 调用 input-validator + structure-validator
//   - runFull() 调用 input-validator + structure-validator + reference-validator
//   - 第 4-7 层仅在 O-5 Change Set 提交前调用（P5 完整实现）
//   - 第 8 层（镜像校验）异步执行——通过 runMirrorValidation() 或编译管道第 9 步注入
//
// 设计意图：
//   - 校验器返回 Issue[]（统一问题模型），store 适配为 ValidateIssue[] 供 UI 使用
//   - 不修改 graph-store（dry-run 契约）
//   - 严重级别 error / warning 两档，无 info 级
//   - includeConfig 控制是否运行第 3 层（reference-validator）
//   - P6 镜像校验独立追踪——mirrorResults 持有原始 MirrorComparisonResult[]，
//     mirrorIssues getter 转换为 ValidateIssue[]，mirrorBlockingCount 统计阻断发布数
//
// 接口契约：
//   - runLight()：实时触发（debounce 300ms 由 scheduleLightValidation 包装）
//   - runFull(overrideOptions?)：按需触发，含 reference-validator
//   - scheduleLightValidation()：debounce 300ms 包装的 Light 触发器
//   - setIncludeConfig(bool)：开关第 3 层引用校验
//   - runMirrorValidation()：异步触发第 8 层镜像校验（P6 新增）
//   - setMirrorResults(results)：编译管道第 9 步完成后注入镜像结果（P6 新增）

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { VALIDATE_LIGHT_DEBOUNCE_MS } from '@/shared';
import type { ValidateIssue, ValidateMode, ValidateSeverity } from '@/shared';
import { summarize } from '@/services/validate-rules';
import { useProjectStore } from './projectStore';
import { useGraphStore } from '@/graph/graph-store';
import {
  runLight as runLightLayers,
  runFull as runFullLayers,
} from '@/validate';
import type { Issue } from '@/validate';
import { convertMirrorResults } from '@/validate/validators/mirror-validator';
import { runAll as runAllMirrors, MIRRORS } from '@/mirror';
import type { MirrorComparisonResult, MirrorId } from '@/mirror';

export type ValidateFilter = 'all' | 'error' | 'warning';

/**
 * 单个镜像器的聚合状态——供 MirrorCheckSection 展示。
 *
 * status 语义：
 *   - pending：尚未运行过（无结果 + 未在运行中）
 *   - running：mirror-runner 正在执行
 *   - success：最近一次对比通过（blocking=false，含后端不可达 warning）
 *   - failed：最近一次对比失败（blocking=true，有阻断差异或不变量违反）
 */
export interface MirrorStatusEntry {
  id: MirrorId;
  status: 'pending' | 'running' | 'success' | 'failed';
  result: MirrorComparisonResult | null;
}

/**
 * 把统一 Issue 模型适配为现有 ValidateIssue（向后兼容 ValidatePanel / ValidateView）。
 *
 * 转换规则：
 *   - ruleId → rule（string，O-10 新规则 ID 直接用 string）
 *   - severity → severity（一致）
 *   - location → location（若 Issue 无 location，从 resourceRef 派生默认锚点）
 *   - message → message（一致）
 *   - hint → hint（一致）
 *   - blocking → blocking（P6 扩展：传递 blocking 字段，镜像不一致的 issue 阻断发布）
 *   - quickFix / sourceAnchor / affectedDownstream 不传递（P0 阶段 UI 未使用）
 */
function toLegacyIssue(issue: Issue): ValidateIssue {
  const location = issue.location ?? {
    pgroup: null,
    pls: null,
    field: `${issue.resourceRef.kind}:${issue.resourceRef.id}`,
  };
  return {
    rule: issue.ruleId,
    severity: issue.severity,
    location,
    message: issue.message,
    hint: issue.hint,
    blocking: issue.blocking,
  };
}

export const useValidateStore = defineStore('validate', () => {
  // ─── state ────────────────────────────────────────────
  const issues = ref<ValidateIssue[]>([]);
  const lastRunMode = ref<ValidateMode | null>(null);
  const lastRunAt = ref<number | null>(null);
  const filter = ref<ValidateFilter>('all');
  const isRunning = ref<boolean>(false);

  /**
   * 是否启用第 3 层引用校验（默认 true）
   *
   * 生成器调用时强制 false（生成器只生成空间结构，不涉及配置引用）
   */
  const includeConfig = ref<boolean>(true);

  // ─── P6 镜像校验 state（独立于同步 issues） ───────────
  //
  // 设计意图（执行案 §4.5 + §4.7.1）：
  //   - 镜像校验是异步流程（需拉取后端 State API 快照），不能在 runLight/runFull 中同步完成
  //   - 镜像结果独立追踪——mirrorResults 持有原始 MirrorComparisonResult[]，
  //     与同步 issues 分离，便于 MirrorCheckSection 单独展示与清理
  //   - 调用方两条路径注入镜像结果：
  //     1) runMirrorValidation()——ValidateView 用户手动触发
  //     2) setMirrorResults(results)——编译管道第 9 步完成后由 BuildView 注入
  const mirrorResults = ref<MirrorComparisonResult[]>([]);
  const mirrorRunning = ref<boolean>(false);
  const lastMirrorRunAt = ref<number | null>(null);

  // Light 验证 debounce 计时器（模块级共享，避免每次创建 store 重新计时）
  let lightDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── getters ──────────────────────────────────────────
  const errorCount = computed(
    () => issues.value.filter((issue) => issue.severity === 'error').length,
  );
  const warningCount = computed(
    () => issues.value.filter((issue) => issue.severity === 'warning').length,
  );
  const filteredIssues = computed<ValidateIssue[]>(() => {
    if (filter.value === 'all') return issues.value;
    const severity: ValidateSeverity = filter.value === 'error' ? 'error' : 'warning';
    return issues.value.filter((issue) => issue.severity === severity);
  });
  const hasIssues = computed(() => issues.value.length > 0);
  const summary = computed(() => summarize(issues.value));

  // ─── P6 镜像校验 getters ──────────────────────────────
  /**
   * 镜像校验转换后的 ValidateIssue[]——供 MirrorCheckSection 展示。
   *
   * 调用 convertMirrorResults 把 MirrorComparisonResult[] 转换为 Issue[]，
   * 再经 toLegacyIssue 适配为 ValidateIssue[]（含 blocking 字段）。
   */
  const mirrorIssues = computed<ValidateIssue[]>(() =>
    convertMirrorResults(mirrorResults.value).map(toLegacyIssue),
  );

  /**
   * 镜像校验阻断发布的差异数量——blocking=true 的 issue 数。
   *
   * 用于 BuildView 发布门禁：mirrorBlockingCount > 0 时禁止发布。
   */
  const mirrorBlockingCount = computed(
    () => mirrorIssues.value.filter((i) => i.blocking).length,
  );

  /** 是否存在镜像阻断差异（发布门禁辅助 getter） */
  const hasMirrorBlocking = computed(() => mirrorBlockingCount.value > 0);

  /** 是否存在后端不可达的镜像结果（warning，不阻断） */
  const hasMirrorBackendUnavailable = computed(
    () => mirrorResults.value.some((r) => r.mirrorId === '__backend__'),
  );

  /**
   * 镜像器聚合状态列表——供 MirrorCheckSection 按镜像器展示状态。
   *
   * 遍历 MIRRORS 注册表，对每个镜像器查找最近的对比结果：
   *   - 无结果 + 运行中 → 'running'
   *   - 无结果 + 未运行 → 'pending'
   *   - 结果 blocking=true → 'failed'
   *   - 结果 blocking=false → 'success'（含后端不可达 warning）
   */
  const mirrorStatusList = computed<MirrorStatusEntry[]>(() =>
    MIRRORS.map((mirror) => {
      const result = mirrorResults.value.find((r) => r.mirrorId === mirror.id) ?? null;
      let status: MirrorStatusEntry['status'] = 'pending';
      if (result) {
        status = result.blocking ? 'failed' : 'success';
      } else if (mirrorRunning.value) {
        status = 'running';
      }
      return { id: mirror.id, status, result };
    }),
  );

  // ─── actions ──────────────────────────────────────────

  /**
   * 手动设置 issues（用于外部直接注入结果，比如测试或预计算缓存）
   */
  function setIssues(next: ValidateIssue[], mode: ValidateMode): void {
    issues.value = next;
    lastRunMode.value = mode;
    lastRunAt.value = Date.now();
  }

  function setFilter(next: ValidateFilter): void {
    filter.value = next;
  }

  function setRunning(value: boolean): void {
    isRunning.value = value;
  }

  function setIncludeConfig(value: boolean): void {
    includeConfig.value = value;
  }

  /**
   * 运行 Light 验证——第 1+2 层（input + structure）。
   *
   * 适合在 projectStore mutation 后立即调用。
   * 编辑时实时触发应使用 scheduleLightValidation()（debounce 300ms）。
   */
  function runLight(): ValidateIssue[] {
    // 触发 projectStore 响应式追踪（即使 graph-store 未装配也能跑现有规则）
    useProjectStore();
    const graph = useGraphStore();
    const issueList = runLightLayers(graph);
    const legacy = issueList.map(toLegacyIssue);
    setIssues(legacy, 'light');
    return legacy;
  }

  /**
   * 运行 Full 验证——第 1+2+3 层（input + structure + reference）。
   *
   * @param overrideOptions 覆盖默认选项（如生成器调用时强制 includeConfig=false）
   *   - includeConfig: 是否运行第 3 层 reference-validator（默认 true）
   * @returns issues 数组
   */
  function runFull(overrideOptions?: { includeConfig?: boolean }): ValidateIssue[] {
    const graph = useGraphStore();
    const includeRef = overrideOptions?.includeConfig ?? includeConfig.value;

    let issueList: Issue[];
    if (includeRef) {
      issueList = runFullLayers(graph);
    } else {
      // 跳过第 3 层，仅运行第 1+2 层
      issueList = runLightLayers(graph);
    }
    const legacy = issueList.map(toLegacyIssue);
    setIssues(legacy, 'full');
    return legacy;
  }

  /**
   * 调度 Light 验证（debounce 300ms）
   *
   * 编辑时高频 mutation 后调用，自动合并短时间内的多次触发
   * 防止输入抖动期间反复跑全量 Light 验证阻塞 UI
   */
  function scheduleLightValidation(): void {
    if (lightDebounceTimer !== null) {
      clearTimeout(lightDebounceTimer);
    }
    lightDebounceTimer = setTimeout(() => {
      lightDebounceTimer = null;
      runLight();
    }, VALIDATE_LIGHT_DEBOUNCE_MS);
  }

  /**
   * 取消未触发的 Light 验证调度
   */
  function cancelScheduledLight(): void {
    if (lightDebounceTimer !== null) {
      clearTimeout(lightDebounceTimer);
      lightDebounceTimer = null;
    }
  }

  function clear(): void {
    issues.value = [];
    lastRunMode.value = null;
    lastRunAt.value = null;
    isRunning.value = false;
    cancelScheduledLight();
    clearMirrorResults();
  }

  // ─── P6 镜像校验 actions ──────────────────────────────

  /**
   * 异步运行第 8 层镜像校验（执行案 §4.6 + §4.7.1）。
   *
   * 流程：
   *   1. 设置 mirrorRunning=true
   *   2. 调用 mirror-runner.runAll(graphStore, MIRRORS) 拉取后端快照 + 跑镜像器
   *   3. 把 MirrorComparisonResult[] 写入 mirrorResults
   *   4. mirrorIssues getter 自动派生 ValidateIssue[] 供 UI 展示
   *
   * 后端不可达处理：
   *   - mirror-runner 捕获 GatewayUnavailableError 后降级为单条"后端不可达"warning 结果
   *   - 不抛异常——调用方通过 hasMirrorBackendUnavailable 判断是否需要提示
   *
   * 与编译管道第 9 步的关系：
   *   - 本方法是 ValidateView 用户手动触发的入口
   *   - 编译管道第 9 步通过 mirrorFn 依赖注入调用 mirror-runner.runAll，
   *     完成后调用 setMirrorResults(results) 注入结果（不走本方法）
   *   - 两条路径最终都写入 mirrorResults state，UI 无感知差异
   */
  async function runMirrorValidation(): Promise<void> {
    if (mirrorRunning.value) return;
    mirrorRunning.value = true;
    try {
      const graphStore = useGraphStore();
      const runResult = await runAllMirrors(graphStore, MIRRORS);
      mirrorResults.value = runResult.results;
      lastMirrorRunAt.value = Date.now();
    } finally {
      mirrorRunning.value = false;
    }
  }

  /**
   * 注入镜像校验结果——供编译管道第 9 步完成后调用。
   *
   * 编译管道通过 mirrorFn 依赖注入在浏览器端运行 mirror-runner，
   * 完成后通过本方法把结果注入 validateStore，触发 MirrorCheckSection 更新。
   *
   * @param results mirror-runner 输出的 MirrorComparisonResult[]
   */
  function setMirrorResults(results: MirrorComparisonResult[]): void {
    mirrorResults.value = results;
    lastMirrorRunAt.value = Date.now();
  }

  /**
   * 设置镜像校验运行状态——供外部流程（如编译管道）显式标记运行中。
   */
  function setMirrorRunning(value: boolean): void {
    mirrorRunning.value = value;
  }

  /**
   * 清空镜像校验结果——工作区重载或切换时调用。
   */
  function clearMirrorResults(): void {
    mirrorResults.value = [];
    lastMirrorRunAt.value = null;
    mirrorRunning.value = false;
  }

  return {
    // state
    issues,
    lastRunMode,
    lastRunAt,
    filter,
    isRunning,
    includeConfig,
    // P6 镜像校验 state
    mirrorResults,
    mirrorRunning,
    lastMirrorRunAt,
    // getters
    errorCount,
    warningCount,
    filteredIssues,
    hasIssues,
    summary,
    // P6 镜像校验 getters
    mirrorIssues,
    mirrorBlockingCount,
    hasMirrorBlocking,
    hasMirrorBackendUnavailable,
    mirrorStatusList,
    // actions
    setIssues,
    setFilter,
    setRunning,
    setIncludeConfig,
    runLight,
    runFull,
    scheduleLightValidation,
    cancelScheduledLight,
    clear,
    // P6 镜像校验 actions
    runMirrorValidation,
    setMirrorResults,
    setMirrorRunning,
    clearMirrorResults,
  };
});
