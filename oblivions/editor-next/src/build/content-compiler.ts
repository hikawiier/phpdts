/**
 * @module O 内容工具箱
 * @framework O-11 内容单源编译
 *
 * 内容单源编译器核心——九步管道（P5-3 八步 + P6 第 9 步镜像校验）。
 *
 * 设计意图（执行案 06-P5 §4.3.1 + §4.6 + 07-P6 §4.6）：
 * - 将 oblivions/content/ 作者资源（经 Resource Graph）编译为 oblivions/gamedata/*.php
 *   与 vex-vue/src/data/*-locale.ts 确定性生成物。
 * - 九步管道严格按顺序执行：基线捕获 → 内存编辑 → diff 展示 → 完整校验 →
 *   临时目录生成 → 语法校验 → 冲突检查 → 自动备份 + 原子替换 → 镜像校验（P6 新增）。
 * - 任一步失败不写入任何目标文件（O-5 核心契约）。
 * - 跨平台原子替换由 atomic-publisher.publishAtomic 实现（执行案 §4.6.5）。
 * - 第 9 步镜像校验在编译产物替换成功后触发；blocking=true 差异自动回滚到备份。
 *
 * 运行环境：
 * - 本模块为 server 端模块（与 atomic-publisher.ts 同级），直接 import fs / child_process。
 * - 浏览器端通过 Gateway /compile 路由（后续任务实现）间接调用。
 * - 步骤 4（完整校验）需要 GraphStore（Pinia），server 端无 Pinia，默认 skipValidation=true。
 *   浏览器端在调用 compile 前应运行 runAll 校验确保变更有效。
 * - 步骤 9（镜像校验）同样需要 graphStore + 后端 State API，server 端无 graphStore，
 *   通过 mirrorFn 依赖注入由浏览器端调用方注入实际函数（与 compileFn 模式一致）。
 *   server 端默认 skipMirror=true 或 mirrorFn=undefined → 第 9 步标记 skipped。
 *
 * 关键不变量：
 * - 步骤 5-8 失败时清理临时目录
 * - 步骤 8 失败时回滚已替换文件（从备份恢复）
 * - 步骤 9 失败（镜像 blocking=true）时从备份恢复已替换文件
 * - 九步管道任一步失败不写入任何目标文件
 * - 字节稳定：相同作者资源 + 相同 schema → 相同 PHP/TS 输出（由投影器保证）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { ResourceNode } from '../graph/types';
import type { FileRevision } from './file-revision';
import type { SerializedFile } from '../adapters/adapter-registry';
import { serializeNodes } from '../adapters/adapter-registry';
import { getKindSchema } from '../schema/registry';
import { publishAtomic, restoreFromBackup, type BuildDiagnostic as PublisherBuildDiagnostic } from './atomic-publisher';
import { COMPILATION_TARGET_FILES } from './build-constants';
// `import type` 编译时擦除，不引入 mirror/ 的运行时依赖。
// mirror-runner 在浏览器端运行（依赖 graphStore Pinia），server 端通过 mirrorFn 注入。
import type { MirrorComparisonResult } from '../mirror/snapshot-comparator';
import type { MirrorRunResult } from '../mirror/mirror-runner';

// ─── 公共类型 ──────────────────────────────────────────────────

/**
 * Resource Graph 的可序列化形态——server 端编译管道的输入。
 *
 * 设计意图：GraphStore 是 Pinia store（浏览器端），server 端无法直接使用。
 * 调用方（change-set.compileAndPublish 或 server 路由）从 graphStore 提取
 * nodes 数组构造 ResourceGraph 传入。edges 在编译管道中不需要——投影器只读节点。
 */
export interface ResourceGraph {
  nodes: ResourceNode[];
}

/**
 * 基线 revision 快照——编译启动时对所有目标文件捕获的三元组集合。
 *
 * 设计意图（执行案 §4.6.1）：三元组（mtime + size + contentHash）全匹配才
 * 视为未变更；任一字段不一致即视为外部修改，触发冲突拒绝写入。
 */
export interface BaselineRevision {
  files: Map<string, FileRevision>;
}

/**
 * 镜像校验依赖注入函数签名（P6 §4.6.1 第 9 步）。
 *
 * 设计意图：
 * - mirror-runner.runAll 需要 graphStore（Pinia）+ Gateway Client，只能在浏览器端运行
 * - content-compiler 是 server 端模块，无法直接调用 mirror-runner
 * - 通过 mirrorFn 依赖注入，浏览器端调用方注入实际函数：
 *     mirrorFn = async (graph) => runAll(graphStore, MIRRORS, opts)
 * - server 端编译不注入 mirrorFn → 第 9 步标记 skipped
 *
 * @param graph 编译管道输入的 Resource Graph（与 CompileOptions.graph 同一份数据）
 * @returns MirrorRunResult——含所有镜像器的对比结果 + 后端不可达标记
 */
export type MirrorFn = (graph: ResourceGraph) => Promise<MirrorRunResult>;

/**
 * 编译选项——compile() 入参。
 *
 * - baseline：基线 revision（来自 changeSet.captureBaseline 或独立捕获）
 * - graph：内存中的 Resource Graph（nodes 数组）
 * - skipValidation：跳过步骤 4（O-10 完整校验），server 端默认 true（无 GraphStore）
 * - skipLint：跳过步骤 6（php -l + vue-tsc + 锚点校验），仅用于开发模式
 * - skipMirror：跳过步骤 9（P6 镜像校验），仅用于开发模式
 * - mirrorFn：镜像校验依赖注入函数（P6 §4.6.1）。未提供时第 9 步标记 skipped
 * - workspaceRoot：工作区根路径（用于定位目标文件、备份目录、vex-vue/ 等）
 */
export interface CompileOptions {
  baseline: BaselineRevision;
  graph: ResourceGraph;
  skipValidation?: boolean;
  skipLint?: boolean;
  skipMirror?: boolean;
  mirrorFn?: MirrorFn;
  workspaceRoot: string;
}

/**
 * 编译结果——成功 / 失败均通过此结构返回，不抛异常。
 *
 * - success：九步管道是否全部成功
 * - affectedFiles：受影响的文件清单（投影内容与基线不同的文件）
 * - diagnostics：编译诊断（错误/警告/信息）
 * - backupPath：备份目录路径（成功时存在）
 * - pipelineState：九步管道状态（供 UI 可视化）
 * - mirrorResults：P6 镜像校验结果（第 9 步执行后填充，skipMirror 时不填充）
 * - mirrorBlockingCount：P6 镜像校验阻断发布的差异数量（blocking=true 的差异条数）
 * - mirrorRolledBack：P6 镜像校验失败后是否已自动回滚到备份
 */
export interface CompileResult {
  success: boolean;
  affectedFiles: string[];
  diagnostics: BuildDiagnostic[];
  backupPath?: string;
  pipelineState: PipelineStepState[];
  /** P6 镜像校验结果（第 9 步执行后填充） */
  mirrorResults?: MirrorComparisonResult[];
  /** P6 镜像校验阻断发布的差异数量（blocking=true 的差异条数） */
  mirrorBlockingCount?: number;
  /** P6 镜像校验失败后是否已自动回滚到备份 */
  mirrorRolledBack?: boolean;
}

/**
 * 单步管道状态——供 O-6 构建工作区编译管道可视化使用。
 */
export interface PipelineStepState {
  step: number; // 1-9
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  log: string[];
  diagnostics?: BuildDiagnostic[];
}

/**
 * 编译诊断——结构化错误/警告/信息。
 *
 * 与 validate/issue-model.ts 的 Issue 不同：BuildDiagnostic 是编译管道内部的
 * 诊断（lint 失败、冲突、回滚等），不携带 resourceRef / sourceAnchor。
 * compile-validator.ts 负责把 BuildDiagnostic 转换为 Issue[] 供 O-10 使用。
 */
export interface BuildDiagnostic {
  severity: 'error' | 'warning' | 'info';
  ruleId: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  source?: string;
}

// ─── 常量 ──────────────────────────────────────────────────────

/**
 * 编译产物目标文件清单（21 文件 = 12 PHP + 9 TS）。
 *
 * 对齐执行案 §4.6.1 基线捕获范围——所有这些文件在编译启动时捕获基线三元组，
 * 步骤 7 冲突检查时重新捕获并对比。
 *
 * poi_interactions.php 在 P5 阶段不编辑（原样保留），但仍进入基线捕获与冲突检查，
 * 避免外部修改污染编译产物目录。
 */
// 从 build-constants.ts re-export，避免浏览器端组件拉入 node:child_process 依赖
export { COMPILATION_TARGET_FILES } from './build-constants';

/**
 * 可投影的 kind 清单——这些 kind 有对应的投影器，会生成编译产物。
 *
 * poi_interactions.php 没有对应的 kind（P5 不编辑），不在本清单中。
 */
const PROJECTABLE_KINDS: readonly string[] = [
  // PHP 投影器 (11)
  'item.template',
  'recipe.template',
  'poi.template',
  'loot.table',
  'distribution.poi',
  'distribution.scatter',
  'enemy.template',
  'distribution.enemy',
  'config.runtime',
  'combat.skill',
  'skill.definition',
  // TS locale 投影器 (9)
  'presentation.item',
  'presentation.recipe',
  'presentation.poi',
  'presentation.enemy',
  'presentation.terrain',
  'presentation.itmk',
  'presentation.tag',
  'presentation.status',
  'presentation.ui',
];

const SHORT_HASH_LENGTH = 6;
const DEFAULT_MAX_BACKUPS = 10;

// ─── 九步管道步骤名 ────────────────────────────────────────────

const STEP_NAMES = [
  '基线捕获',
  '内存编辑',
  'diff 展示',
  '完整校验',
  '临时目录生成',
  '语法校验',
  '冲突检查',
  '自动备份 + 原子替换',
  '镜像校验',
] as const;

// ─── 核心编译函数 ──────────────────────────────────────────────

/**
 * 编译管道入口——九步严格按顺序执行。
 *
 * 任一步失败 → 后续步骤标记为 skipped，返回 success=false + 诊断列表。
 * 步骤 5-8 失败时清理临时目录；步骤 8 失败时回滚已替换文件。
 * 步骤 9（镜像校验）失败（blocking=true 差异）时从备份回滚已替换文件。
 *
 * 不抛异常——所有错误通过 CompileResult.diagnostics 返回。
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const skipValidation = options.skipValidation ?? true; // server 端默认跳过（无 GraphStore）
  const skipLint = options.skipLint ?? false;
  const skipMirror = options.skipMirror ?? !options.mirrorFn; // 无 mirrorFn 时自动跳过

  const pipelineState: PipelineStepState[] = STEP_NAMES.map((name, i) => ({
    step: i + 1,
    name,
    status: 'pending' as const,
    log: [],
  }));

  const diagnostics: BuildDiagnostic[] = [];
  let tempDir: string | null = null;
  let projectedFiles: Map<string, string> = new Map(); // filePath → content
  let affectedFiles: string[] = [];
  let backupPath: string | undefined;

  // ─── 步骤 1：基线捕获 ──────────────────────────────────────
  const step1 = pipelineState[0]!;
  step1.status = 'running';
  step1.startedAt = Date.now();
  try {
    const baseline = await captureBaseline(options.workspaceRoot);
    // 与调用方传入的 baseline 合并：调用方传入的优先（可能包含更多文件）
    for (const [filePath, rev] of baseline.files) {
      if (!options.baseline.files.has(filePath)) {
        options.baseline.files.set(filePath, rev);
      }
    }
    step1.log.push(`基线捕获完成：${baseline.files.size} 个文件`);
    step1.status = 'success';
  } catch (err) {
    step1.status = 'failed';
    step1.log.push(`基线捕获失败：${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({
      severity: 'error',
      ruleId: 'compilation.baseline_capture_failed',
      message: `基线捕获失败：${err instanceof Error ? err.message : String(err)}`,
      source: 'content-compiler',
    });
    step1.finishedAt = Date.now();
    markRemainingSkipped(pipelineState, 1);
    return { success: false, affectedFiles: [], diagnostics, pipelineState };
  }
  step1.finishedAt = Date.now();

  // ─── 步骤 2：内存编辑 ──────────────────────────────────────
  const step2 = pipelineState[1]!;
  step2.status = 'running';
  step2.startedAt = Date.now();
  try {
    projectedFiles = projectGraphToFiles(options.graph);
    step2.log.push(`投影生成 ${projectedFiles.size} 个文件`);
    step2.status = 'success';
  } catch (err) {
    step2.status = 'failed';
    step2.log.push(`投影失败：${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({
      severity: 'error',
      ruleId: 'compilation.projection_failed',
      message: `投影失败：${err instanceof Error ? err.message : String(err)}`,
      source: 'content-compiler',
    });
    step2.finishedAt = Date.now();
    markRemainingSkipped(pipelineState, 2);
    return { success: false, affectedFiles: [], diagnostics, pipelineState };
  }
  step2.finishedAt = Date.now();

  // ─── 步骤 3：diff 展示 ────────────────────────────────────
  const step3 = pipelineState[2]!;
  step3.status = 'running';
  step3.startedAt = Date.now();
  try {
    affectedFiles = computeAffectedFiles(projectedFiles, options.baseline, options.workspaceRoot);
    step3.log.push(`受影响文件：${affectedFiles.length} 个`);
    for (const f of affectedFiles) {
      step3.log.push(`  - ${f}`);
    }
    step3.status = 'success';
  } catch (err) {
    step3.status = 'failed';
    step3.log.push(`diff 计算失败：${err instanceof Error ? err.message : String(err)}`);
    step3.finishedAt = Date.now();
    markRemainingSkipped(pipelineState, 3);
    return { success: false, affectedFiles: [], diagnostics, pipelineState };
  }
  step3.finishedAt = Date.now();

  // 无受影响文件 → 跳过后续步骤
  if (affectedFiles.length === 0) {
    step3.log.push('无受影响文件，跳过后续步骤');
    markRemainingSkipped(pipelineState, 3);
    return { success: true, affectedFiles: [], diagnostics, pipelineState };
  }

  // ─── 步骤 4：完整校验 ──────────────────────────────────────
  const step4 = pipelineState[3]!;
  step4.startedAt = Date.now();
  if (skipValidation) {
    step4.status = 'skipped';
    step4.log.push('skipValidation=true，跳过完整校验');
  } else {
    step4.status = 'running';
    step4.log.push('完整校验需要在浏览器端运行（GraphStore 依赖）');
    step4.log.push('server 端编译管道默认跳过；浏览器端应预编译时运行 runAll');
    step4.status = 'skipped';
  }
  step4.finishedAt = Date.now();

  // ─── 步骤 5：临时目录生成 ──────────────────────────────────
  const step5 = pipelineState[4]!;
  step5.status = 'running';
  step5.startedAt = Date.now();
  try {
    tempDir = await createTempBuildDir(options.workspaceRoot);
    await writeProjectedFilesToTemp(tempDir, affectedFiles, projectedFiles);
    step5.log.push(`临时目录：${tempDir}`);
    step5.log.push(`写入 ${affectedFiles.length} 个受影响文件`);
    step5.status = 'success';
  } catch (err) {
    step5.status = 'failed';
    step5.log.push(`临时目录生成失败：${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({
      severity: 'error',
      ruleId: 'compilation.temp_dir_failed',
      message: `临时目录生成失败：${err instanceof Error ? err.message : String(err)}`,
      source: 'content-compiler',
    });
    if (tempDir) await cleanupTempDir(tempDir).catch(() => {});
    step5.finishedAt = Date.now();
    markRemainingSkipped(pipelineState, 5);
    return { success: false, affectedFiles, diagnostics, pipelineState };
  }
  step5.finishedAt = Date.now();

  // ─── 步骤 6：语法校验 ──────────────────────────────────────
  const step6 = pipelineState[5]!;
  step6.startedAt = Date.now();
  if (skipLint) {
    step6.status = 'skipped';
    step6.log.push('skipLint=true，跳过语法校验');
  } else {
    step6.status = 'running';
    try {
      const lintDiagnostics = await runSyntaxValidation(
        tempDir!,
        affectedFiles,
        projectedFiles,
        options.workspaceRoot,
      );
      step6.diagnostics = lintDiagnostics;
      step6.log.push(`语法校验完成：${lintDiagnostics.length} 个诊断`);
      diagnostics.push(...lintDiagnostics);

      const hasErrors = lintDiagnostics.some((d) => d.severity === 'error');
      if (hasErrors) {
        step6.status = 'failed';
        step6.log.push('存在 error 级诊断，阻断后续步骤');
        await cleanupTempDir(tempDir!).catch(() => {});
        step6.finishedAt = Date.now();
        markRemainingSkipped(pipelineState, 6);
        return { success: false, affectedFiles, diagnostics, pipelineState };
      }
      step6.status = 'success';
    } catch (err) {
      step6.status = 'failed';
      step6.log.push(`语法校验异常：${err instanceof Error ? err.message : String(err)}`);
      diagnostics.push({
        severity: 'error',
        ruleId: 'compilation.lint_threw',
        message: `语法校验异常：${err instanceof Error ? err.message : String(err)}`,
        source: 'content-compiler',
      });
      await cleanupTempDir(tempDir!).catch(() => {});
      step6.finishedAt = Date.now();
      markRemainingSkipped(pipelineState, 6);
      return { success: false, affectedFiles, diagnostics, pipelineState };
    }
  }
  step6.finishedAt = Date.now();

  // ─── 步骤 7：冲突检查 ──────────────────────────────────────
  const step7 = pipelineState[6]!;
  step7.status = 'running';
  step7.startedAt = Date.now();
  try {
    const conflictDiagnostics = await checkConflicts(options.baseline, options.workspaceRoot);
    step7.diagnostics = conflictDiagnostics;
    step7.log.push(`冲突检查完成：${conflictDiagnostics.length} 个冲突`);
    diagnostics.push(...conflictDiagnostics);

    if (conflictDiagnostics.length > 0) {
      step7.status = 'failed';
      step7.log.push('检测到外部修改冲突，拒绝写入');
      await cleanupTempDir(tempDir!).catch(() => {});
      step7.finishedAt = Date.now();
      markRemainingSkipped(pipelineState, 7);
      return { success: false, affectedFiles, diagnostics, pipelineState };
    }
    step7.status = 'success';
  } catch (err) {
    step7.status = 'failed';
    step7.log.push(`冲突检查异常：${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({
      severity: 'error',
      ruleId: 'compilation.conflict_check_threw',
      message: `冲突检查异常：${err instanceof Error ? err.message : String(err)}`,
      source: 'content-compiler',
    });
    await cleanupTempDir(tempDir!).catch(() => {});
    step7.finishedAt = Date.now();
    markRemainingSkipped(pipelineState, 7);
    return { success: false, affectedFiles, diagnostics, pipelineState };
  }
  step7.finishedAt = Date.now();

  // ─── 步骤 8：自动备份 + 原子替换 ──────────────────────────
  const step8 = pipelineState[7]!;
  step8.status = 'running';
  step8.startedAt = Date.now();
  try {
    const targetToTemp = new Map<string, string>();
    for (const filePath of affectedFiles) {
      const tempPath = path.join(tempDir!, filePath.replace(/[\\/]/g, '__'));
      targetToTemp.set(filePath, tempPath);
    }

    const publishResult = await publishAtomic({
      workspaceRoot: options.workspaceRoot,
      affectedFiles: targetToTemp,
      maxBackups: DEFAULT_MAX_BACKUPS,
    });

    if (publishResult.success) {
      backupPath = publishResult.backupPath;
      step8.log.push(`原子替换成功：${publishResult.publishedFiles.length} 个文件`);
      step8.log.push(`备份目录：${backupPath}`);
      step8.status = 'success';
    } else {
      step8.status = 'failed';
      step8.log.push(`原子替换失败：${publishResult.failedFiles.length} 个失败`);
      step8.log.push(`回滚文件：${publishResult.rolledBackFiles.length} 个`);
      for (const fail of publishResult.failedFiles) {
        step8.log.push(`  失败：${fail}`);
      }
      diagnostics.push(...publishResult.diagnostics);
      step8.diagnostics = publishResult.diagnostics;
      await cleanupTempDir(tempDir!).catch(() => {});
      step8.finishedAt = Date.now();
      return {
        success: false,
        affectedFiles,
        diagnostics,
        backupPath,
        pipelineState,
      };
    }
  } catch (err) {
    step8.status = 'failed';
    step8.log.push(`原子替换异常：${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({
      severity: 'error',
      ruleId: 'compilation.atomic_replace_failed',
      message: `原子替换异常：${err instanceof Error ? err.message : String(err)}`,
      source: 'content-compiler',
    });
    await cleanupTempDir(tempDir!).catch(() => {});
    step8.finishedAt = Date.now();
    return { success: false, affectedFiles, diagnostics, backupPath, pipelineState };
  }
  step8.finishedAt = Date.now();

  // 清理临时目录
  if (tempDir) await cleanupTempDir(tempDir).catch(() => {});

  // ─── 步骤 9：镜像校验（P6 新增，执行案 §4.6.1） ──────────
  //
  // 设计意图：
  // - 编译产物替换成功后（第 8 步完成），触发镜像校验
  // - 通过 mirrorFn 依赖注入调用 mirror-runner.runAll（浏览器端运行）
  // - severity='error' + blocking=true 的镜像差异 → 阻断发布，自动回滚到备份
  // - severity='warning' 的镜像差异（如后端不可达）→ 提示用户，不阻断
  // - skipMirror=true 或 mirrorFn=undefined → 标记 skipped（server 端默认）
  //
  // 失败回滚（执行案 §4.6.2）：
  // - 从备份目录恢复原编译产物（复用 atomic-publisher.restoreFromBackup）
  // - emit mirror.rollback 诊断（写入 step9.log + diagnostics）
  // - 返回 CompileResult.success=false + mirrorResults + mirrorRolledBack=true
  const step9 = pipelineState[8]!;
  step9.startedAt = Date.now();
  if (skipMirror) {
    step9.status = 'skipped';
    const reason = options.skipMirror
      ? 'skipMirror=true，跳过镜像校验'
      : 'mirrorFn 未注入，跳过镜像校验（server 端默认）';
    step9.log.push(reason);
    step9.finishedAt = Date.now();
    return {
      success: true,
      affectedFiles,
      diagnostics,
      backupPath,
      pipelineState,
    };
  }

  step9.status = 'running';
  let mirrorResults: MirrorComparisonResult[] = [];
  let mirrorBlockingCount = 0;
  let mirrorRolledBack = false;
  try {
    const mirrorRunResult = await options.mirrorFn!(options.graph);
    mirrorResults = mirrorRunResult.results;

    // 统计 blocking=true 差异数量
    mirrorBlockingCount = mirrorResults.filter((r) => r.blocking).length;

    if (mirrorBlockingCount > 0) {
      // 镜像校验失败——自动回滚到备份（执行案 §4.6.2）
      step9.status = 'failed';
      step9.log.push(`镜像校验失败：${mirrorBlockingCount} 个阻断发布差异`);
      for (const result of mirrorResults) {
        if (result.blocking) {
          step9.log.push(`  · [${result.mirrorId}] ${result.summary}`);
        }
      }

      // 从备份恢复原编译产物
      if (backupPath) {
        try {
          await restoreFromBackup(backupPath, options.workspaceRoot);
          mirrorRolledBack = true;
          step9.log.push(`已从备份回滚：${backupPath}`);
          diagnostics.push({
            severity: 'error',
            ruleId: 'mirror.rollback',
            message: `镜像校验失败（${mirrorBlockingCount} 个阻断差异），已自动回滚到备份：${backupPath}`,
            source: 'content-compiler',
          });
        } catch (rollbackErr) {
          step9.log.push(`回滚失败：${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
          diagnostics.push({
            severity: 'error',
            ruleId: 'mirror.rollback_failed',
            message: `镜像校验失败且回滚失败——请手工从 ${backupPath} 恢复：${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            source: 'content-compiler',
          });
        }
      } else {
        step9.log.push('无备份目录可回滚');
        diagnostics.push({
          severity: 'error',
          ruleId: 'mirror.rollback_failed',
          message: '镜像校验失败但无备份目录可回滚——编译产物已替换但镜像校验未通过',
          source: 'content-compiler',
        });
      }

      step9.finishedAt = Date.now();
      return {
        success: false,
        affectedFiles,
        diagnostics,
        backupPath,
        pipelineState,
        mirrorResults,
        mirrorBlockingCount,
        mirrorRolledBack,
      };
    }

    // 镜像校验通过（含后端不可达 warning）
    step9.status = 'success';
    if (mirrorRunResult.hasBackendUnavailable) {
      step9.log.push('部分后端快照不可用，对应镜像校验已跳过（warning）');
      diagnostics.push({
        severity: 'warning',
        ruleId: 'mirror.backend_unreachable',
        message: '部分后端快照不可用，对应镜像校验已跳过——不阻断发布',
        source: 'content-compiler',
      });
    } else {
      step9.log.push(`镜像校验通过：${mirrorResults.length} 个镜像器，0 个阻断差异`);
    }
  } catch (err) {
    step9.status = 'failed';
    step9.log.push(`镜像校验异常：${err instanceof Error ? err.message : String(err)}`);
    diagnostics.push({
      severity: 'error',
      ruleId: 'mirror.runner_threw',
      message: `镜像校验异常：${err instanceof Error ? err.message : String(err)}`,
      source: 'content-compiler',
    });
    step9.finishedAt = Date.now();
    return {
      success: false,
      affectedFiles,
      diagnostics,
      backupPath,
      pipelineState,
      mirrorResults,
      mirrorBlockingCount,
      mirrorRolledBack,
    };
  }
  step9.finishedAt = Date.now();

  return {
    success: true,
    affectedFiles,
    diagnostics,
    backupPath,
    pipelineState,
    mirrorResults,
    mirrorBlockingCount,
    mirrorRolledBack,
  };
}

// ─── 步骤实现 ──────────────────────────────────────────────────

/**
 * 捕获所有编译产物目标文件的基线 revision。
 *
 * 文件不存在时跳过（视为新文件，不进入基线）。
 */
async function captureBaseline(workspaceRoot: string): Promise<BaselineRevision> {
  const files = new Map<string, FileRevision>();
  for (const filePath of COMPILATION_TARGET_FILES) {
    const absPath = path.resolve(workspaceRoot, filePath);
    try {
      const rev = await readFileRevisionNode(absPath);
      files.set(filePath, rev);
    } catch {
      // 文件不存在或读取失败：跳过（视为新文件）
    }
  }
  return { files };
}

/**
 * 从 Resource Graph 投影生成所有编译产物文件。
 *
 * 通过 adapter-registry.serializeNodes 调度各投影器——与现有 BuildView 发布路径一致。
 * 跳过无投影器的 kind（返回空 SerializedFile[]）。
 */
function projectGraphToFiles(graph: ResourceGraph): Map<string, string> {
  const result = new Map<string, string>();

  // 按 kind 分组节点
  const nodesByKind = new Map<string, ResourceNode[]>();
  for (const node of graph.nodes) {
    if (!PROJECTABLE_KINDS.includes(node.kind)) continue;
    const arr = nodesByKind.get(node.kind);
    if (arr) {
      arr.push(node);
    } else {
      nodesByKind.set(node.kind, [node]);
    }
  }

  // 对每个 kind 调用 serializeNodes
  for (const kind of PROJECTABLE_KINDS) {
    const kindSchema = getKindSchema(kind);
    if (!kindSchema) continue;
    const nodes = nodesByKind.get(kind) ?? [];
    const serialized: SerializedFile[] = serializeNodes(nodes, kindSchema);
    for (const file of serialized) {
      result.set(file.filePath, file.content);
    }
  }

  return result;
}

/**
 * 计算受影响文件——投影内容与基线内容不同的文件。
 *
 * 无基线记录的文件视为新文件，计入受影响清单。
 */
function computeAffectedFiles(
  projectedFiles: Map<string, string>,
  baseline: BaselineRevision,
  workspaceRoot: string,
): string[] {
  const affected: string[] = [];
  for (const [filePath, content] of projectedFiles) {
    const baselineRev = baseline.files.get(filePath);
    if (!baselineRev) {
      // 无基线记录 = 新文件，计入受影响
      affected.push(filePath);
      continue;
    }
    // 对比内容 hash
    const projectedHash = hashContentNode(content);
    if (projectedHash !== baselineRev.contentHash) {
      affected.push(filePath);
    }
  }
  // 读取工作区当前文件内容，对比投影内容（捕获外部修改导致的"无变化"）
  // 注：基线 hash 与当前文件 hash 不一致时，步骤 7 冲突检查会拦截
  void workspaceRoot;
  return affected.sort();
}

/**
 * 创建临时构建目录——在 OS 临时目录下创建 oblivions-build-<timestamp>-<shortHash>。
 *
 * 临时目录与工作区在同一盘符（Windows 跨盘符 rename 非原子）；若 OS 临时目录
 * 跨盘符，降级为工作区下的 .oblivions-tmp-build/ 子目录（执行案 §4.6.5）。
 */
async function createTempBuildDir(workspaceRoot: string): Promise<string> {
  const timestamp = Date.now();
  const shortHash = crypto
    .createHash('sha256')
    .update(`${timestamp}-${Math.random()}`)
    .digest('hex')
    .slice(0, SHORT_HASH_LENGTH);
  const dirName = `oblivions-build-${timestamp}-${shortHash}`;

  // 检查 OS 临时目录与工作区是否在同一盘符
  const osTmpDir = os.tmpdir();
  const sameDrive = isSameDrive(osTmpDir, workspaceRoot);
  const tempRoot = sameDrive ? osTmpDir : path.join(workspaceRoot, '.oblivions-tmp-build');

  const tempDir = path.join(tempRoot, dirName);
  await fs.promises.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * 把受影响文件写入临时目录（扁平化文件名，避免重建子目录树）。
 *
 * 文件名格式：把路径分隔符替换为 `__`（如 `oblivions/gamedata/item_table.php` →
 * `oblivions__gamedata__item_table.php`）。publishAtomic 读取时反向映射。
 */
async function writeProjectedFilesToTemp(
  tempDir: string,
  affectedFiles: string[],
  projectedFiles: Map<string, string>,
): Promise<void> {
  for (const filePath of affectedFiles) {
    const content = projectedFiles.get(filePath);
    if (content === undefined) continue;
    const tempName = filePath.replace(/[\\/]/g, '__');
    const tempPath = path.join(tempDir, tempName);
    await fs.promises.writeFile(tempPath, content, 'utf8');
  }
}

/**
 * 语法校验管道——PHP lint + vue-tsc + 设计锚点校验。
 *
 * - PHP lint：对临时目录中的每个 PHP 文件执行 `php -l`
 * - vue-tsc：在 vex-vue/ 目录下执行 `vue-tsc --noEmit`
 * - 锚点校验：执行 `php oblivions/tools/validate_design_anchors.php`（严格模式）
 *
 * 任一文件失败不阻塞其他文件的 lint（结构化诊断收集所有失败）。
 * error 级诊断阻断后续步骤，warning/info 不阻断。
 */
async function runSyntaxValidation(
  tempDir: string,
  affectedFiles: string[],
  projectedFiles: Map<string, string>,
  workspaceRoot: string,
): Promise<BuildDiagnostic[]> {
  const diagnostics: BuildDiagnostic[] = [];

  // PHP lint：对临时目录中的每个 PHP 文件执行 php -l
  const phpFiles = affectedFiles.filter((f) => f.endsWith('.php'));
  for (const filePath of phpFiles) {
    const content = projectedFiles.get(filePath);
    if (content === undefined) continue;
    const lintDiag = lintPhpContent(filePath, content);
    if (lintDiag) diagnostics.push(lintDiag);
  }

  // vue-tsc：在 vex-vue/ 目录下执行 vue-tsc --noEmit
  const tsFiles = affectedFiles.filter((f) => f.endsWith('.ts'));
  if (tsFiles.length > 0) {
    const vueTscDiags = runVueTsc(workspaceRoot);
    diagnostics.push(...vueTscDiags);
  }

  // 设计锚点校验
  const anchorDiag = runAnchorValidation(workspaceRoot);
  if (anchorDiag) diagnostics.push(anchorDiag);

  void tempDir;
  return diagnostics;
}

/**
 * 冲突检查——重新捕获所有目标文件 revision，与基线三元组对比。
 *
 * 任一文件三元组不匹配 → 冲突诊断（拒绝写入）。
 * 文件不存在（新文件场景）不视为冲突。
 */
async function checkConflicts(
  baseline: BaselineRevision,
  workspaceRoot: string,
): Promise<BuildDiagnostic[]> {
  const diagnostics: BuildDiagnostic[] = [];
  for (const [filePath, baselineRev] of baseline.files) {
    const absPath = path.resolve(workspaceRoot, filePath);
    let currentRev: FileRevision | null = null;
    try {
      currentRev = await readFileRevisionNode(absPath);
    } catch {
      // 文件不存在：不视为冲突（可能是新文件场景或已被删除）
      continue;
    }
    if (
      baselineRev.mtime !== currentRev.mtime ||
      baselineRev.size !== currentRev.size ||
      baselineRev.contentHash !== currentRev.contentHash
    ) {
      diagnostics.push({
        severity: 'error',
        ruleId: 'compilation.external_modification_conflict',
        message: `文件 ${filePath} 自基线后被外部修改（mtime/size/hash 不一致）`,
        file: filePath,
        source: 'conflict-check',
      });
    }
  }
  return diagnostics;
}

// ─── 子进程调用工具 ────────────────────────────────────────────

/**
 * 探测 php 可执行文件名。Windows 通常为 php.exe，Linux/Mac 为 php。
 */
function detectPhpBinary(): string {
  return process.platform === 'win32' ? 'php.exe' : 'php';
}

/**
 * 对 PHP 内容执行 `php -l` 语法校验。
 *
 * 把内容写入临时文件后调用 php -l，解析输出为 BuildDiagnostic。
 * 成功返回 null（无诊断）；失败返回 error 级诊断。
 */
function lintPhpContent(filePath: string, content: string): BuildDiagnostic | null {
  const tempFile = path.join(
    os.tmpdir(),
    `oblivions-compile-lint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.php`,
  );
  try {
    fs.writeFileSync(tempFile, content, 'utf8');
    const result = spawnSync(detectPhpBinary(), ['-l', tempFile], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const output = (stdout + stderr).trim();
    const code = result.status ?? -1;
    if (code !== 0) {
      const lineMatch = /(?:on line |:(\d+))/.exec(output);
      const line = lineMatch?.[1] ? Number(lineMatch[1]) : undefined;
      return {
        severity: 'error',
        ruleId: 'compilation.php_syntax_error',
        message: output,
        file: filePath,
        line: line !== undefined && Number.isFinite(line) ? line : undefined,
        source: 'php-lint',
      };
    }
    return null;
  } catch (err) {
    return {
      severity: 'error',
      ruleId: 'compilation.php_syntax_error',
      message: `php -l 调用失败：${err instanceof Error ? err.message : String(err)}`,
      file: filePath,
      source: 'php-lint',
    };
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // 临时文件清理失败不影响主流程
    }
  }
}

/**
 * 在 vex-vue/ 目录下执行 `vue-tsc --noEmit`。
 *
 * vue-tsc 是整体校验（无法单文件），输出可定位到具体文件。
 * 失败时解析输出，生成结构化 BuildDiagnostic。
 */
function runVueTsc(workspaceRoot: string): BuildDiagnostic[] {
  const vexVueDir = path.resolve(workspaceRoot, 'vex-vue');
  if (!fs.existsSync(vexVueDir)) {
    return [{
      severity: 'warning',
      ruleId: 'compilation.ts_type_error',
      message: `vex-vue 目录不存在：${vexVueDir}，跳过 vue-tsc 校验`,
      source: 'vue-tsc',
    }];
  }
  try {
    // 使用 npx vue-tsc 避免依赖全局安装
    const result = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vue-tsc', '--noEmit'],
      {
        cwd: vexVueDir,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const output = (stdout + stderr).trim();
    const code = result.status ?? -1;
    if (code !== 0 && output.length > 0) {
      // 解析 vue-tsc 输出，按行生成诊断
      const diagnostics: BuildDiagnostic[] = [];
      const lines = output.split('\n');
      for (const line of lines) {
        const match = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(.+)$/.exec(line);
        if (match) {
          const [, file, lineStr, colStr, severity, message] = match;
          diagnostics.push({
            severity: severity as 'error' | 'warning',
            ruleId: 'compilation.ts_type_error',
            message: message!,
            file: file,
            line: Number(lineStr),
            column: Number(colStr),
            source: 'vue-tsc',
          });
        }
      }
      // 若未解析出结构化诊断，整体作为一个 error
      if (diagnostics.length === 0) {
        diagnostics.push({
          severity: 'error',
          ruleId: 'compilation.ts_type_error',
          message: output,
          source: 'vue-tsc',
        });
      }
      return diagnostics;
    }
    return [];
  } catch (err) {
    return [{
      severity: 'warning',
      ruleId: 'compilation.ts_type_error',
      message: `vue-tsc 调用失败：${err instanceof Error ? err.message : String(err)}`,
      source: 'vue-tsc',
    }];
  }
}

/**
 * 执行设计锚点校验——`php oblivions/tools/validate_design_anchors.php`（严格模式）。
 *
 * 失败时返回 error 级诊断。
 */
function runAnchorValidation(workspaceRoot: string): BuildDiagnostic | null {
  const scriptPath = path.resolve(workspaceRoot, 'oblivions/tools/validate_design_anchors.php');
  if (!fs.existsSync(scriptPath)) {
    return {
      severity: 'warning',
      ruleId: 'compilation.anchor_validation_failed',
      message: `锚点校验脚本不存在：${scriptPath}，跳过校验`,
      source: 'anchor-validator',
    };
  }
  try {
    const result = spawnSync(detectPhpBinary(), [scriptPath], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const output = (stdout + stderr).trim();
    const code = result.status ?? -1;
    if (code !== 0) {
      return {
        severity: 'error',
        ruleId: 'compilation.anchor_validation_failed',
        message: output || `锚点校验失败（退出码 ${code}）`,
        source: 'anchor-validator',
      };
    }
    return null;
  } catch (err) {
    return {
      severity: 'error',
      ruleId: 'compilation.anchor_validation_failed',
      message: `锚点校验调用失败：${err instanceof Error ? err.message : String(err)}`,
      source: 'anchor-validator',
    };
  }
}

// ─── 内部工具 ──────────────────────────────────────────────────

/**
 * 读取文件并计算 FileRevision 三元组（Node.js 环境）。
 *
 * 与 atomic-publisher.readFileRevision 行为一致，复用同一 hash 算法。
 */
async function readFileRevisionNode(filePath: string): Promise<FileRevision> {
  const [content, stat] = await Promise.all([
    fs.promises.readFile(filePath, 'utf8'),
    fs.promises.stat(filePath),
  ]);
  return {
    mtime: Math.floor(stat.mtimeMs),
    size: stat.size,
    contentHash: hashContentNode(content),
  };
}

/**
 * 计算 SHA-256 前 16 字节十六进制（与 atomic-publisher.hashContentNode 一致）。
 */
function hashContentNode(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest().slice(0, 16).toString('hex');
}

/**
 * 检查两个路径是否在同一盘符（Windows）或同一根（Unix）。
 */
function isSameDrive(p1: string, p2: string): boolean {
  const root1 = path.parse(path.resolve(p1)).root;
  const root2 = path.parse(path.resolve(p2)).root;
  return root1.toLowerCase() === root2.toLowerCase();
}

/**
 * 清理临时目录。
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
}

/**
 * 把从 startStep 之后的步骤标记为 skipped。
 */
function markRemainingSkipped(pipelineState: PipelineStepState[], startStep: number): void {
  for (let i = startStep; i < pipelineState.length; i++) {
    if (pipelineState[i]!.status === 'pending') {
      pipelineState[i]!.status = 'skipped';
    }
  }
}

// ─── Re-export ────────────────────────────────────────────────

export type { BuildDiagnostic as BuildDiagnosticFromPublisher } from './atomic-publisher';
void (null as unknown as PublisherBuildDiagnostic); // 确保 import 类型被使用
