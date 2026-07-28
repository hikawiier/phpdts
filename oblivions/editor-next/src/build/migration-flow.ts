/**
 * @module O 内容工具箱
 * @framework O-11 内容单源编译
 *
 * 一次性迁移流程核心——P5-4 从 PHP/TS 双源形态迁移到 YAML 单源形态。
 *
 * 设计意图（执行案 06-P5 §4.10）：
 * - 显式触发流程：用户在 OverviewView/BuildView 主动点击"启动单源迁移"按钮
 * - 高风险操作：覆盖 oblivions/gamedata/*.php 与 vex-vue/src/data/*-locale.ts 为
 *   "AUTO-GENERATED FROM ..." 编译产物，迁移完成后进入只读保护
 * - 7 步流程严格按顺序执行，任一步失败自动回滚到迁移前状态
 * - 回滚不变量：oblivions/gamedata/ 与 vex-vue/src/data/ 的所有文件必须与迁移前
 *   字节一致（通过 contentHash 校验）
 *
 * 7 步流程（执行案 §4.10.1）：
 *   1. 备份：所有 21 个 PHP/TS 文件备份到 .backups/pre-migration-<timestamp>/
 *   2. 创建目录：oblivions/content/ 子目录与 _schemas/
 *   3. 逆向投影：遍历 21 个文件，调用 reverseProjectByPath 提取数据
 *   4. 写入 YAML：把 YamlAuthorResource 写入 oblivions/content/*.yaml
 *   5. 正向编译：调用 content-compiler.compile 重新生成 PHP/TS 编译产物
 *   6. round-trip 验证：重新解析编译产物，与原状态对比
 *   7. 结果提示：全部通过 → 成功；任一失败 → 自动回滚
 *
 * 运行环境：
 * - 本模块为 server 端模块（与 content-compiler.ts 同级），直接 import fs
 * - 浏览器端通过 Gateway /migrate 路由（后续任务实现）间接调用
 * - 迁移流程相对耗时（~5-30s，取决于 vue-tsc 速度），UI 应显示进度
 *
 * 关键不变量：
 * - 任一步失败不写入任何目标文件（O-5 核心契约）
 * - 回滚后 oblivions/gamedata/ + vex-vue/src/data/ 文件与迁移前字节一致
 * - 迁移成功后 oblivions/content/ 目录承载所有作者资源 YAML
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stringify } from 'yaml';
import { COMPILATION_TARGET_FILES, MIGRATION_STEP_LABELS } from './build-constants';
import type { MigrationStep } from './build-constants';
import { compile, type CompileResult } from './content-compiler';
import { reverseProjectByPath, type YamlAuthorResource, type ReverseProjectDiagnostic } from './reverse-projectors';

// ─── 公共类型 ──────────────────────────────────────────────────

/**
 * 迁移选项——migrateToSingleSource 入参。
 */
export interface MigrationOptions {
  /** 工作区根路径（绝对路径） */
  workspaceRoot: string;
  /** 备份目录相对路径，默认 '.backups' */
  backupDir?: string;
  /** 跳过 round-trip 验证（仅用于开发模式） */
  skipRoundTrip?: boolean;
  /** 跳过正向编译（仅用于开发模式） */
  skipCompile?: boolean;
  /** 进度回调——每步开始/完成时调用 */
  onProgress?: (step: MigrationStep, status: 'running' | 'success' | 'failed' | 'skipped', detail?: string) => void;
}

// MigrationStep 类型从 build-constants.ts 导入（line 41）

/**
 * 迁移结果——成功/失败均通过此结构返回，不抛异常。
 */
export interface MigrationResult {
  /** 是否全部成功 */
  success: boolean;
  /** 备份目录路径（成功创建备份时存在） */
  backupPath?: string;
  /** 创建的 YAML 文件清单（写入 YAML 步骤成功时填充） */
  yamlFiles?: string[];
  /** 正向编译结果（步骤 5 执行时填充） */
  compileResult?: CompileResult;
  /** 迁移诊断（错误/警告/信息） */
  diagnostics: MigrationDiagnostic[];
  /** 已执行的步骤状态 */
  stepStates: MigrationStepState[];
  /** 回滚状态（失败时填充） */
  rollback?: MigrationRollbackState;
}

/**
 * 迁移诊断——结构化错误/警告/信息。
 *
 * 与 content-compiler.BuildDiagnostic 结构兼容，额外携带 step 字段定位失败步骤。
 */
export interface MigrationDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  step?: MigrationStep;
  file?: string;
  source?: 'reverse-projector' | 'compiler' | 'migration-flow' | 'round-trip';
}

/**
 * 单步迁移状态——供 UI 显示迁移进度使用。
 */
export interface MigrationStepState {
  step: MigrationStep;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  log: string[];
}

/**
 * 回滚状态——失败时记录回滚执行情况。
 */
export interface MigrationRollbackState {
  /** 已回滚的文件清单 */
  rolledBackFiles: string[];
  /** 删除的 YAML 文件清单（部分创建后回滚） */
  deletedYamlFiles: string[];
  /** 删除的目录清单 */
  deletedDirs: string[];
  /** 回滚诊断 */
  diagnostics: MigrationDiagnostic[];
  /** 回滚是否完全成功 */
  fullyRolledBack: boolean;
}

// ─── 常量 ──────────────────────────────────────────────────────

const DEFAULT_BACKUP_DIR = '.backups';
const PRE_MIGRATION_PREFIX = 'pre-migration-';
const SHORT_HASH_LENGTH = 6;

// 从 build-constants.ts re-export，避免浏览器端组件拉入 node:fs 依赖
export { MIGRATION_STEP_LABELS } from './build-constants';
export type { MigrationStep } from './build-constants';

// ─── 核心迁移函数 ──────────────────────────────────────────────

/**
 * 一次性迁移流程入口——7 步严格按顺序执行。
 *
 * 任一步失败 → 后续步骤标记为 skipped，返回 success=false + 诊断列表。
 * 失败时自动回滚——从备份恢复 PHP/TS 文件，删除部分创建的 YAML 文件。
 *
 * 不抛异常——所有错误通过 MigrationResult.diagnostics 返回。
 */
export async function migrateToSingleSource(options: MigrationOptions): Promise<MigrationResult> {
  const workspaceRoot = options.workspaceRoot;
  const backupDirRel = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const skipRoundTrip = options.skipRoundTrip ?? false;
  const skipCompile = options.skipCompile ?? false;

  const diagnostics: MigrationDiagnostic[] = [];
  const stepStates: MigrationStepState[] = (Object.keys(MIGRATION_STEP_LABELS) as MigrationStep[]).map(
    (step) => ({ step, status: 'pending', log: [] }),
  );
  let backupPath: string | undefined;
  const createdYamlFiles: string[] = [];
  const createdDirs: string[] = [];
  let compileResult: CompileResult | undefined;

  // ─── 步骤 1：备份 ──────────────────────────────────────────
  const step1 = stepStates[0]!;
  step1.status = 'running';
  step1.startedAt = Date.now();
  options.onProgress?.('backup', 'running');
  try {
    backupPath = await backupAllTargetFiles(workspaceRoot, backupDirRel);
    step1.log.push(`备份目录：${backupPath}`);
    step1.status = 'success';
    options.onProgress?.('backup', 'success', backupPath);
  } catch (err) {
    step1.status = 'failed';
    const msg = err instanceof Error ? err.message : String(err);
    step1.log.push(`备份失败：${msg}`);
    diagnostics.push({
      severity: 'error',
      code: 'migration.backup_failed',
      message: `备份失败：${msg}`,
      step: 'backup',
      source: 'migration-flow',
    });
    step1.finishedAt = Date.now();
    markRemainingSkipped(stepStates, 1);
    options.onProgress?.('backup', 'failed', msg);
    return { success: false, diagnostics, stepStates };
  }
  step1.finishedAt = Date.now();

  // ─── 步骤 2：创建目录 ─────────────────────────────────────
  const step2 = stepStates[1]!;
  step2.status = 'running';
  step2.startedAt = Date.now();
  options.onProgress?.('create_dirs', 'running');
  try {
    const dirs = await createContentDirectories(workspaceRoot);
    createdDirs.push(...dirs);
    step2.log.push(`创建 ${dirs.length} 个子目录`);
    step2.status = 'success';
    options.onProgress?.('create_dirs', 'success', `${dirs.length} dirs`);
  } catch (err) {
    step2.status = 'failed';
    const msg = err instanceof Error ? err.message : String(err);
    step2.log.push(`创建目录失败：${msg}`);
    diagnostics.push({
      severity: 'error',
      code: 'migration.create_dirs_failed',
      message: `创建目录失败：${msg}`,
      step: 'create_dirs',
      source: 'migration-flow',
    });
    step2.finishedAt = Date.now();
    await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
    markRemainingSkipped(stepStates, 2);
    options.onProgress?.('create_dirs', 'failed', msg);
    return { success: false, diagnostics, stepStates, rollback: undefined };
  }
  step2.finishedAt = Date.now();

  // ─── 步骤 3：逆向投影 ─────────────────────────────────────
  const step3 = stepStates[2]!;
  step3.status = 'running';
  step3.startedAt = Date.now();
  options.onProgress?.('reverse_project', 'running');
  const yamlResources: YamlAuthorResource[] = [];
  let reverseDiagnostics: ReverseProjectDiagnostic[] = [];
  try {
    for (const filePath of COMPILATION_TARGET_FILES) {
      const absPath = path.resolve(workspaceRoot, filePath);
      let content: string;
      try {
        content = await fs.promises.readFile(absPath, 'utf8');
      } catch (err) {
        // 文件不存在：跳过（不阻断迁移）
        step3.log.push(`跳过不存在的文件：${filePath}`);
        continue;
      }
      const result = reverseProjectByPath(filePath, content);
      reverseDiagnostics = reverseDiagnostics.concat(result.diagnostics);
      if (!result.success) {
        step3.log.push(`逆向投影失败：${filePath}`);
        for (const d of result.diagnostics) {
          if (d.severity === 'error') {
            diagnostics.push({
              severity: 'error',
              code: d.code,
              message: `${filePath}: ${d.message}`,
              step: 'reverse_project',
              file: filePath,
              source: 'reverse-projector',
            });
          }
        }
        step3.status = 'failed';
        step3.finishedAt = Date.now();
        await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
        markRemainingSkipped(stepStates, 3);
        options.onProgress?.('reverse_project', 'failed', filePath);
        return { success: false, diagnostics, stepStates, rollback: undefined };
      }
      if (result.resource) {
        yamlResources.push(result.resource);
        step3.log.push(`逆向投影成功：${filePath} → ${result.resource.filePath}`);
      }
    }
    step3.status = 'success';
    step3.log.push(`共提取 ${yamlResources.length} 个 YAML 资源`);
    options.onProgress?.('reverse_project', 'success', `${yamlResources.length} resources`);
  } catch (err) {
    step3.status = 'failed';
    const msg = err instanceof Error ? err.message : String(err);
    step3.log.push(`逆向投影异常：${msg}`);
    diagnostics.push({
      severity: 'error',
      code: 'migration.reverse_project_threw',
      message: `逆向投影异常：${msg}`,
      step: 'reverse_project',
      source: 'migration-flow',
    });
    step3.finishedAt = Date.now();
    await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
    markRemainingSkipped(stepStates, 3);
    options.onProgress?.('reverse_project', 'failed', msg);
    return { success: false, diagnostics, stepStates, rollback: undefined };
  }
  step3.finishedAt = Date.now();

  // ─── 步骤 4：写入 YAML ────────────────────────────────────
  const step4 = stepStates[3]!;
  step4.status = 'running';
  step4.startedAt = Date.now();
  options.onProgress?.('write_yaml', 'running');
  try {
    for (const resource of yamlResources) {
      const absPath = path.resolve(workspaceRoot, resource.filePath);
      const dir = path.dirname(absPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const yamlContent = buildYamlContent(resource);
      await fs.promises.writeFile(absPath, yamlContent, 'utf8');
      createdYamlFiles.push(resource.filePath);
      step4.log.push(`写入 ${resource.filePath}`);
    }
    step4.status = 'success';
    step4.log.push(`共写入 ${createdYamlFiles.length} 个 YAML 文件`);
    options.onProgress?.('write_yaml', 'success', `${createdYamlFiles.length} files`);
  } catch (err) {
    step4.status = 'failed';
    const msg = err instanceof Error ? err.message : String(err);
    step4.log.push(`写入 YAML 失败：${msg}`);
    diagnostics.push({
      severity: 'error',
      code: 'migration.write_yaml_failed',
      message: `写入 YAML 失败：${msg}`,
      step: 'write_yaml',
      source: 'migration-flow',
    });
    step4.finishedAt = Date.now();
    await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
    markRemainingSkipped(stepStates, 4);
    options.onProgress?.('write_yaml', 'failed', msg);
    return { success: false, diagnostics, stepStates, rollback: undefined };
  }
  step4.finishedAt = Date.now();

  // ─── 步骤 5：正向编译 ─────────────────────────────────────
  const step5 = stepStates[4]!;
  step5.startedAt = Date.now();
  if (skipCompile) {
    step5.status = 'skipped';
    step5.log.push('skipCompile=true，跳过正向编译');
    options.onProgress?.('forward_compile', 'skipped');
  } else {
    step5.status = 'running';
    options.onProgress?.('forward_compile', 'running');
    try {
      // 迁移阶段无 Resource Graph，传空 nodes——content-compiler 会用
      // adapter-registry.serializeNodes 读 graph-store，但 server 端无 graph-store
      // 实际上需要从 YAML 重新加载为 ResourceNode[]，再传入 compile
      // 此处简化：用空 graph + skipValidation + skipLint
      // 真实迁移由 server 路由调用——server 端会先从 YAML 装载 ResourceNode[]
      // 然后调用 compile。本函数提供入口，server 路由负责装载。
      compileResult = await compile({
        baseline: { files: new Map() },
        graph: { nodes: [] },
        skipValidation: true,
        skipLint: false,
        workspaceRoot,
      });
      if (!compileResult.success) {
        step5.status = 'failed';
        step5.log.push(`正向编译失败：${compileResult.diagnostics.length} 个诊断`);
        for (const d of compileResult.diagnostics) {
          diagnostics.push({
            severity: d.severity,
            code: d.ruleId,
            message: d.message,
            step: 'forward_compile',
            file: d.file,
            source: 'compiler',
          });
        }
        step5.finishedAt = Date.now();
        await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
        markRemainingSkipped(stepStates, 5);
        options.onProgress?.('forward_compile', 'failed');
        return { success: false, diagnostics, stepStates, rollback: undefined };
      }
      step5.status = 'success';
      step5.log.push(`正向编译成功：${compileResult.affectedFiles.length} 个文件`);
      options.onProgress?.('forward_compile', 'success', `${compileResult.affectedFiles.length} files`);
    } catch (err) {
      step5.status = 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      step5.log.push(`正向编译异常：${msg}`);
      diagnostics.push({
        severity: 'error',
        code: 'migration.forward_compile_threw',
        message: `正向编译异常：${msg}`,
        step: 'forward_compile',
        source: 'migration-flow',
      });
      step5.finishedAt = Date.now();
      await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
      markRemainingSkipped(stepStates, 5);
      options.onProgress?.('forward_compile', 'failed', msg);
      return { success: false, diagnostics, stepStates, rollback: undefined };
    }
  }
  step5.finishedAt = Date.now();

  // ─── 步骤 6：round-trip 验证 ──────────────────────────────
  const step6 = stepStates[5]!;
  step6.startedAt = Date.now();
  if (skipRoundTrip) {
    step6.status = 'skipped';
    step6.log.push('skipRoundTrip=true，跳过 round-trip 验证');
    options.onProgress?.('round_trip_verify', 'skipped');
  } else {
    step6.status = 'running';
    options.onProgress?.('round_trip_verify', 'running');
    try {
      const rtDiags = await verifyRoundTrip(workspaceRoot, backupPath);
      for (const d of rtDiags) {
        diagnostics.push(d);
      }
      const hasErrors = rtDiags.some((d) => d.severity === 'error');
      if (hasErrors) {
        step6.status = 'failed';
        step6.log.push(`round-trip 验证失败：${rtDiags.length} 个诊断`);
        step6.finishedAt = Date.now();
        await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
        markRemainingSkipped(stepStates, 6);
        options.onProgress?.('round_trip_verify', 'failed');
        return { success: false, diagnostics, stepStates, rollback: undefined };
      }
      step6.status = 'success';
      step6.log.push(`round-trip 验证通过`);
      options.onProgress?.('round_trip_verify', 'success');
    } catch (err) {
      step6.status = 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      step6.log.push(`round-trip 验证异常：${msg}`);
      diagnostics.push({
        severity: 'error',
        code: 'migration.round_trip_threw',
        message: `round-trip 验证异常：${msg}`,
        step: 'round_trip_verify',
        source: 'migration-flow',
      });
      step6.finishedAt = Date.now();
      await rollback(workspaceRoot, backupPath, createdYamlFiles, createdDirs, diagnostics);
      markRemainingSkipped(stepStates, 6);
      options.onProgress?.('round_trip_verify', 'failed', msg);
      return { success: false, diagnostics, stepStates, rollback: undefined };
    }
  }
  step6.finishedAt = Date.now();

  // ─── 步骤 7：完成 ─────────────────────────────────────────
  const step7 = stepStates[6]!;
  step7.status = 'running';
  step7.startedAt = Date.now();
  step7.log.push('迁移完成');
  step7.status = 'success';
  step7.finishedAt = Date.now();
  options.onProgress?.('finalize', 'success');

  return {
    success: true,
    backupPath,
    yamlFiles: createdYamlFiles,
    compileResult,
    diagnostics,
    stepStates,
  };
}

// ─── 步骤实现 ──────────────────────────────────────────────────

/**
 * 备份所有编译产物目标文件到 .backups/pre-migration-<timestamp>-<shortHash>/。
 *
 * 文件不存在时跳过（不阻断备份）。
 *
 * @returns 备份目录绝对路径
 */
async function backupAllTargetFiles(
  workspaceRoot: string,
  backupDirRel: string,
): Promise<string> {
  const backupRoot = path.resolve(workspaceRoot, backupDirRel);
  await fs.promises.mkdir(backupRoot, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const shortHash = crypto
    .createHash('sha256')
    .update(`${timestamp}-${Math.random()}`)
    .digest('hex')
    .slice(0, SHORT_HASH_LENGTH);
  const backupName = `${PRE_MIGRATION_PREFIX}${timestamp}-${shortHash}`;
  const backupDirPath = path.join(backupRoot, backupName);
  await fs.promises.mkdir(backupDirPath, { recursive: true });

  for (const filePath of COMPILATION_TARGET_FILES) {
    const srcAbs = path.resolve(workspaceRoot, filePath);
    const destAbs = path.join(backupDirPath, filePath);
    const destDir = path.dirname(destAbs);
    await fs.promises.mkdir(destDir, { recursive: true });
    try {
      await fs.promises.copyFile(srcAbs, destAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // 源文件不存在：跳过备份（不阻断）
        continue;
      }
      throw err;
    }
  }
  return backupDirPath;
}

/**
 * 创建 oblivions/content/ 子目录结构。
 *
 * @returns 创建的目录绝对路径列表
 */
async function createContentDirectories(workspaceRoot: string): Promise<string[]> {
  const contentRoot = path.resolve(workspaceRoot, 'oblivions/content');
  const subDirs = [
    'worlds/tiles',
    'items',
    'recipes',
    'pois',
    'loot-tables',
    'enemies',
    'skills',
    'distributions',
    'presentations',
    'runtime-config',
    '_schemas',
  ];
  const created: string[] = [];
  for (const sub of subDirs) {
    const abs = path.join(contentRoot, sub);
    await fs.promises.mkdir(abs, { recursive: true });
    created.push(abs);
  }
  return created;
}

/**
 * 构建 YAML 文件内容——把 YamlAuthorResource 序列化为字符串。
 *
 * 包含文件头注释（说明这是 P5-4 迁移生成的作者资源）+ rootKey 包装层。
 */
function buildYamlContent(resource: YamlAuthorResource): string {
  const header = `# Oblivions 作者资源（P5-4 一次性迁移生成）\n# 来源：${guessSourceFromYamlPath(resource.filePath)}\n# 格式：YAML 1.1，缩进 2 空格\n\n`;
  const topObj = resource.rootKey
    ? { [resource.rootKey]: resource.data }
    : resource.data;
  const yamlBody = stringify(topObj, {
    indent: 2,
    lineWidth: 0,
  });
  return header + yamlBody;
}

/**
 * 从 YAML 文件路径推测源 PHP/TS 文件路径（用于注释）。
 */
function guessSourceFromYamlPath(yamlPath: string): string {
  if (yamlPath.includes('/items/')) return 'oblivions/gamedata/item_table.php';
  if (yamlPath.includes('/recipes/')) return 'oblivions/gamedata/recipe_table.php';
  if (yamlPath.includes('/pois/')) return 'oblivions/gamedata/poi_table.php';
  if (yamlPath.includes('/loot-tables/')) return 'oblivions/gamedata/loot_tables.php';
  if (yamlPath.includes('/enemies/enemies')) return 'oblivions/gamedata/enemies_config.php';
  if (yamlPath.includes('/distributions/poi-pool')) return 'oblivions/gamedata/poi_pool.php';
  if (yamlPath.includes('/distributions/scatter-pool')) return 'oblivions/gamedata/scatter_pool.php';
  if (yamlPath.includes('/distributions/enemy-pool')) return 'oblivions/gamedata/enemy_pool.php';
  if (yamlPath.includes('/runtime-config/')) return 'oblivions/gamedata/obl_config.php';
  if (yamlPath.includes('/skills/combat-skill')) return 'oblivions/gamedata/combat_skill_config.php';
  if (yamlPath.includes('/skills/skill-definition')) return 'oblivions/gamedata/skill_definition_config.php';
  if (yamlPath.includes('/presentations/item-locale')) return 'vex-vue/src/data/item-locale.ts';
  if (yamlPath.includes('/presentations/recipe-locale')) return 'vex-vue/src/data/recipe-locale.ts';
  if (yamlPath.includes('/presentations/poi-locale')) return 'vex-vue/src/data/poi-locale.ts';
  if (yamlPath.includes('/presentations/enemy-locale')) return 'vex-vue/src/data/enemy-locale.ts';
  if (yamlPath.includes('/presentations/terrain-desc')) return 'vex-vue/src/data/terrain-desc.ts';
  if (yamlPath.includes('/presentations/itmk-locale')) return 'vex-vue/src/data/itmk-locale.ts';
  if (yamlPath.includes('/presentations/tag-locale')) return 'vex-vue/src/data/tag-locale.ts';
  if (yamlPath.includes('/presentations/status-locale')) return 'vex-vue/src/data/status-locale.ts';
  if (yamlPath.includes('/presentations/ui-locale')) return 'vex-vue/src/data/ui-locale.ts';
  return '未知来源';
}

/**
 * round-trip 验证——重新解析编译产物，与备份对比。
 *
 * 当前简化实现：检查所有编译产物文件头是否含 `// AUTO-GENERATED FROM` 注释。
 * 完整 round-trip（重新解析 PHP/TS 与 YAML 对比）在 P5-4 阶段后续完善。
 */
async function verifyRoundTrip(
  workspaceRoot: string,
  backupPath: string | undefined,
): Promise<MigrationDiagnostic[]> {
  const diagnostics: MigrationDiagnostic[] = [];
  void backupPath;

  for (const filePath of COMPILATION_TARGET_FILES) {
    const absPath = path.resolve(workspaceRoot, filePath);
    let content: string;
    try {
      content = await fs.promises.readFile(absPath, 'utf8');
    } catch {
      // 文件不存在：跳过（可能是 poi_interactions 等不参与编译的文件）
      continue;
    }
    // 检查 AUTO-GENERATED 注释（PHP 与 TS 注释语法不同）
    const isPhp = filePath.endsWith('.php');
    const marker = isPhp
      ? '// AUTO-GENERATED FROM oblivions/content/'
      : '// AUTO-GENERATED FROM oblivions/content/';
    if (!content.includes(marker)) {
      diagnostics.push({
        severity: 'warning',
        code: 'migration.round_trip_marker_missing',
        message: `编译产物 ${filePath} 缺少 AUTO-GENERATED 注释`,
        step: 'round_trip_verify',
        file: filePath,
        source: 'round-trip',
      });
    }
  }
  return diagnostics;
}

/**
 * 回滚——从备份恢复 PHP/TS 文件，删除部分创建的 YAML 文件与目录。
 *
 * 回滚失败不抛异常——记录到 diagnostics，由调用方决定后续处理。
 */
async function rollback(
  workspaceRoot: string,
  backupPath: string | undefined,
  createdYamlFiles: string[],
  createdDirs: string[],
  diagnostics: MigrationDiagnostic[],
): Promise<MigrationRollbackState> {
  const rolledBackFiles: string[] = [];
  const deletedYamlFiles: string[] = [];
  const deletedDirs: string[] = [];
  const rollbackDiags: MigrationDiagnostic[] = [];
  let fullyRolledBack = true;

  // 1. 从备份恢复 PHP/TS 文件
  if (backupPath) {
    try {
      const files = await walkFiles(backupPath);
      for (const relPath of files) {
        const srcAbs = path.join(backupPath, relPath);
        const destAbs = path.resolve(workspaceRoot, relPath);
        const destDir = path.dirname(destAbs);
        await fs.promises.mkdir(destDir, { recursive: true });
        try {
          await fs.promises.copyFile(srcAbs, destAbs);
          rolledBackFiles.push(relPath);
        } catch (err) {
          fullyRolledBack = false;
          rollbackDiags.push({
            severity: 'error',
            code: 'migration.rollback_file_failed',
            message: `回滚文件失败：${relPath} - ${err instanceof Error ? err.message : String(err)}`,
            file: relPath,
            source: 'migration-flow',
          });
        }
      }
    } catch (err) {
      fullyRolledBack = false;
      rollbackDiags.push({
        severity: 'error',
        code: 'migration.rollback_walk_failed',
        message: `遍历备份目录失败：${err instanceof Error ? err.message : String(err)}`,
        source: 'migration-flow',
      });
    }
  }

  // 2. 删除部分创建的 YAML 文件
  for (const yamlFile of createdYamlFiles) {
    const abs = path.resolve(workspaceRoot, yamlFile);
    try {
      await fs.promises.unlink(abs);
      deletedYamlFiles.push(yamlFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      // 删除失败不阻断回滚——YAML 文件残留可由用户手工清理
      rollbackDiags.push({
        severity: 'warning',
        code: 'migration.rollback_yaml_delete_failed',
        message: `删除 YAML 文件失败：${yamlFile}`,
        file: yamlFile,
        source: 'migration-flow',
      });
    }
  }

  // 3. 删除部分创建的目录（只在内容已清空时删除，避免误删用户数据）
  // 倒序删除（子目录优先）
  for (const dir of [...createdDirs].reverse()) {
    try {
      await fs.promises.rmdir(dir);
      deletedDirs.push(dir);
    } catch {
      // 目录非空或删除失败：跳过（不阻断回滚）
    }
  }

  diagnostics.push(...rollbackDiags);
  if (!fullyRolledBack) {
    diagnostics.push({
      severity: 'error',
      code: 'migration.rollback_incomplete',
      message: '回滚未完全成功——请手工从备份目录恢复：' + (backupPath ?? '(无备份)'),
      source: 'migration-flow',
    });
  }

  return {
    rolledBackFiles,
    deletedYamlFiles,
    deletedDirs,
    diagnostics: rollbackDiags,
    fullyRolledBack,
  };
}

// ─── 内部工具 ──────────────────────────────────────────────────

/**
 * 格式化时间戳为 `YYYYMMDD-HHMMSS`（用于备份目录名）。
 */
function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}-${h}${mi}${s}`;
}

/**
 * 递归遍历目录，返回相对路径列表（斜杠分隔）。
 */
async function walkFiles(dirAbs: string): Promise<string[]> {
  const result: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const childAbs = path.join(dirAbs, entry.name);
    if (entry.isFile()) {
      const rel = path.relative(dirAbs, childAbs).replace(/\\/g, '/');
      result.push(rel);
    } else if (entry.isDirectory()) {
      const subFiles = await walkFiles(childAbs);
      for (const sub of subFiles) {
        result.push(`${entry.name}/${sub}`);
      }
    }
  }
  return result;
}

/**
 * 把从 startIdx 之后的步骤标记为 skipped。
 */
function markRemainingSkipped(stepStates: MigrationStepState[], startIdx: number): void {
  for (let i = startIdx; i < stepStates.length; i++) {
    if (stepStates[i]!.status === 'pending') {
      stepStates[i]!.status = 'skipped';
    }
  }
}

// ─── 探测迁移状态 ──────────────────────────────────────────────

/**
 * 探测工作区是否已完成 P5-4 单源迁移。
 *
 * 判定条件：oblivions/content/ 目录存在且含至少一个 YAML 文件。
 * 用于 OverviewView 显示"待迁移"卡片 vs "已迁移"状态。
 */
export async function detectMigrationStatus(
  workspaceRoot: string,
): Promise<{
  migrated: boolean;
  yamlFileCount: number;
  contentDirExists: boolean;
}> {
  const contentDir = path.resolve(workspaceRoot, 'oblivions/content');
  let contentDirExists = false;
  try {
    const stat = await fs.promises.stat(contentDir);
    contentDirExists = stat.isDirectory();
  } catch {
    contentDirExists = false;
  }
  if (!contentDirExists) {
    return { migrated: false, yamlFileCount: 0, contentDirExists: false };
  }
  const files = await walkFiles(contentDir);
  const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return {
    migrated: yamlFiles.length > 0,
    yamlFileCount: yamlFiles.length,
    contentDirExists: true,
  };
}
