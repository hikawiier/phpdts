//
// validateStore：验证结果（对齐 NEW_DESIGN.md §2.3.9 + §3.5）
//
// 研判：
//   - 验证工具集的状态层
//   - 读取 projectStore.project 数据
//   - 读取 configStore.scatterPool / poiTable / poiPool 数据
//   - M8 生成器写入 projectStore 后调用 runFull() 形成闭环
//
// 设计意图（对齐 2.8 dry-run 契约 + §3.5）：
//   - 纯函数集 + 结果缓存：validate-rules.ts 是纯函数，store 负责调度与缓存
//   - 两级验证分级：
//     · Light（实时、debounce 300ms）：编辑时高频触发
//     · Full（按需）：用户点击按钮或生成器写入后触发
//   - 不修改 projectStore / configStore（dry-run 契约）
//   - 严重级别 error / warning 两档，无 info 级
//   - 视觉对齐 2.15：error 用唯一强调色（红 #ff5555），warning 用灰阶 + 虚线
//
// 接口契约（供 ValidateView / 生成器调用）：
//   - runLight()：实时触发（debounce 300ms 由 scheduleLightValidation 包装）
//   - runFull(options?)：按需触发（含 BFS + 可选配置交叉引用）
//   - scheduleLightValidation()：debounce 300ms 包装的 Light 触发器
//   - setIncludeConfig(bool)：开关配置交叉引用校验
//   - setLootTableIds(ids) / setItemTableIds(ids)：外部引用表注入

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { VALIDATE_LIGHT_DEBOUNCE_MS } from '@/shared';
import type { ValidateIssue, ValidateMode, ValidateOptions, ValidateSeverity } from '@/shared';
import { runLightValidation, runFullValidation, summarize } from '@/services/validate-rules';
import { useProjectStore } from './projectStore';
import { useConfigStore } from './configStore';

export type ValidateFilter = 'all' | 'error' | 'warning';

export const useValidateStore = defineStore('validate', () => {
  // ─── state ────────────────────────────────────────────
  const issues = ref<ValidateIssue[]>([]);
  const lastRunMode = ref<ValidateMode | null>(null);
  const lastRunAt = ref<number | null>(null);
  const filter = ref<ValidateFilter>('all');
  const isRunning = ref<boolean>(false);

  /**
   * 是否启用配置交叉引用校验（默认 true）
   *
   * 生成器调用时强制 false（生成器只生成空间结构，不涉及配置）
   */
  const includeConfig = ref<boolean>(true);

  /**
   * 外部引用表（编辑器本地无完整引用表，由调用方注入）
   *
   * 未提供（空数组）时跳过对应外部引用校验（warning 类）
   */
  const lootTableIds = ref<string[]>([]);
  const itemTableIds = ref<string[]>([]);

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

  // ─── 内部工具：从 projectStore + configStore 拼装验证数据 ─
  function buildOptions(): ValidateOptions {
    const config = useConfigStore();
    return {
      includeConfig: includeConfig.value,
      includeConnectivity: true, // Full 模式始终包含 BFS
      lootTableIds: lootTableIds.value,
      itemTableIds: itemTableIds.value,
      scatterPool: config.scatterPool,
      poiTable: config.poiTable,
      poiPool: config.poiPool,
    };
  }

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

  function setLootTableIds(ids: string[]): void {
    lootTableIds.value = [...ids];
  }

  function setItemTableIds(ids: string[]): void {
    itemTableIds.value = [...ids];
  }

  /**
   * 运行 Light 验证（同步、跳过 BFS 与配置交叉引用）
   *
   * 适合在 projectStore mutation 后立即调用
   * 编辑时实时触发应使用 scheduleLightValidation()（debounce 300ms）
   */
  function runLight(): ValidateIssue[] {
    const project = useProjectStore();
    const result = runLightValidation(project.project);
    setIssues(result, 'light');
    return result;
  }

  /**
   * 运行 Full 验证（同步、含连通性 BFS + 可选配置交叉引用）
   *
   * @param overrideOptions 覆盖默认选项（如生成器调用时强制 includeConfig=false）
   * @returns issues 数组
   */
  function runFull(overrideOptions?: ValidateOptions): ValidateIssue[] {
    const project = useProjectStore();
    const options = { ...buildOptions(), ...overrideOptions };
    const result = runFullValidation(project.project, options);
    setIssues(result, 'full');
    return result;
  }

  /**
   * 调度 Light 验证（debounce 300ms，对齐 §3.5.2）
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
  }

  return {
    // state
    issues,
    lastRunMode,
    lastRunAt,
    filter,
    isRunning,
    includeConfig,
    lootTableIds,
    itemTableIds,
    // getters
    errorCount,
    warningCount,
    filteredIssues,
    hasIssues,
    summary,
    // actions
    setIssues,
    setFilter,
    setRunning,
    setIncludeConfig,
    setLootTableIds,
    setItemTableIds,
    runLight,
    runFull,
    scheduleLightValidation,
    cancelScheduledLight,
    clear,
  };
});
