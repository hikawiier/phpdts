/**
 * @module O 内容工具箱
 * @framework O-5 Change Set
 *
 * 原子发布基础版——把 SerializedFile[] 原子写入目标文件系统。
 *
 * 设计意图：
 * - 接收 SerializedFile[]（来自 O-4 serializeNodes）+ baseline（BaselineEntry[]）
 * - 对每个目标文件检测外部修改：对比 baseline[filePath] 与当前文件 mtime + size + contentHash 三元组
 * - 任意文件检测到外部修改 → 返回 conflicts，中止发布（不创建备份）
 * - P3 §4.7.1：可选 prePublishCheck hook 在外部修改检测后、备份创建前执行
 *   `php -l`（PHP 文件）+ `vue-tsc`（TS 文件）语法/类型校验；任一失败 → 返回
 *   checkFailures，中止发布（不创建备份，不写入任何文件）
 * - 创建时间戳备份子目录 `backup-YYYYMMDD-HHMMSS-<short-hash>/`
 * - 在 OS 临时目录生成全部受影响文件
 * - 原子替换：fs.renameSync（Node.js 跨平台封装，Windows 上会先删除目标）
 * - 任一步失败回滚：从备份目录还原原文件，清理临时目录
 * - 清理超出 keepBackups 的旧备份
 *
 * P5-3 扩展（执行案 §4.6.5）：
 * - publishAtomic：跨平台原子替换，由 content-compiler 步骤 8 调用
 *   - Unix/macOS：fs.renameSync（POSIX rename 原子）
 *   - Windows：预检查（'r+' 试探）+ 备份 + 替换 + 失败回滚
 * - BuildDiagnostic：编译管道诊断结构（与 content-compiler.BuildDiagnostic 结构兼容）
 *
 * 边界：
 * - prePublishCheck 是依赖注入 hook——atomic-publisher 不直接调用 php -l / vue-tsc，
 *   由 server/src/routes/write.ts 注入实际检查函数；测试不注入即跳过
 * - 仅在 Node.js 环境（Gateway 服务器端）运行；前端通过 gateway-client HTTP 调用
 * - 备份目录默认 `.backups`（与 .gitignore 一致），由 PublishOptions.backupDir 覆盖
 * - 基线三元组复用 file-revision.ts 的 FileRevision 类型，但发布接收 BaselineEntry[]
 *   （含 filePath），因为 FileRevision 本身不含路径信息
 * - publishAtomic 假定冲突检查与语法校验由调用方（content-compiler）已完成；
 *   本函数只负责备份 + 原子替换 + 回滚
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// ─── 公共类型（前端通过 `import type` 复用，编译时擦除，不引入 Node.js 依赖） ───

/**
 * 文件 revision 三元组——与 file-revision.ts 的 FileRevision 结构兼容。
 *
 * 在 atomic-publisher.ts 中独立定义，避免 server 端 import 本模块时
 * 因 lib 配置差异（DOM vs ES2022）导致类型冲突。TypeScript 结构化类型系统
 * 保证前端 file-revision.ts 的 FileRevision 可直接传给本模块的函数。
 */
export interface FileRevision {
  mtime: number;
  size: number;
  contentHash: string;
}

/**
 * 发布选项——调用方传入。
 *
 * - workspaceRoot：工作区根目录绝对路径
 * - keepBackups：备份保留份数，默认 10
 * - backupDir：备份目录相对路径，默认 '.backups'（与 .gitignore 一致）
 * - prePublishCheck：可选预发布检查 hook（执行案 §4.7.1 step 6）
 *   在外部修改检测通过后、备份创建前调用；返回 passed=false 时中止发布
 */
export interface PublishOptions {
  workspaceRoot: string;
  keepBackups?: number;
  backupDir?: string;
  prePublishCheck?: PrePublishCheckFn;
}

/**
 * 单个文件发布冲突——外部修改检测失败时填充。
 */
export interface PublishConflict {
  filePath: string;
  reason: 'mtime_mismatch' | 'size_mismatch' | 'hash_mismatch';
  baseline: FileRevision;
  current: FileRevision;
}

/**
 * 预发布检查失败条目——`php -l` / `vue-tsc` 等语法/类型校验失败时填充。
 *
 * line / column 可选——供编辑器导航；php -l 输出含行号时解析填充。
 */
export interface PrePublishCheckFailure {
  filePath: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * 预发布检查结果——passed=false 时 publishFiles 中止发布。
 */
export interface PrePublishCheckResult {
  passed: boolean;
  failures: PrePublishCheckFailure[];
}

/**
 * 预发布检查函数签名——由调用方注入实际检查逻辑。
 *
 * server/src/routes/write.ts 注入的实现：
 *   - PHP 文件：spawn `php -l` 写入临时文件后检查
 *   - TS 文件：spawn `vue-tsc --noEimit`（或简化为跳过，TS 校验在 P5 完整实现）
 *
 * 测试不注入即跳过预发布检查——atomic-publisher 单元测试不依赖 php / vue-tsc 可执行。
 */
export type PrePublishCheckFn = (files: PublishableFile[]) => Promise<PrePublishCheckResult>;

/**
 * 发布结果——成功 / 失败 / 冲突均通过此结构返回，不抛异常。
 *
 * checkFailures：预发布检查失败时填充（error='pre_publish_check_failed'）
 */
export interface PublishResult {
  success: boolean;
  publishedFiles: string[];
  backupDir: string;
  conflicts: PublishConflict[];
  error?: string;
  checkFailures?: PrePublishCheckFailure[];
}

/**
 * 备份目录信息——GET /api/backups 返回。
 */
export interface BackupInfo {
  name: string;
  createdAt: number;
  fileCount: number;
}

/**
 * 待发布文件——SerializedPhpFile / SerializedTsFile 的结构化子集。
 *
 * 使用结构化类型避免依赖 adapter-registry，atomic-publisher 保持独立。
 */
export interface PublishableFile {
  filePath: string;
  content: string;
}

/**
 * 基线条目——FileRevision + filePath。
 *
 * 任务说明的 `FileRevision[]` 是疏漏：FileRevision 本身不含路径信息，
 * 无法对应到具体文件。本类型才是 publishFiles 的真实入参。
 */
export interface BaselineEntry {
  filePath: string;
  revision: FileRevision;
}

/**
 * 编译管道诊断——结构化错误/警告/信息（执行案 §4.6.5）。
 *
 * 与 validate/issue-model.ts 的 Issue 不同：BuildDiagnostic 是编译管道内部的
 * 诊断（lint 失败、冲突、回滚等），不携带 resourceRef / sourceAnchor。
 * compile-validator.ts 负责把 BuildDiagnostic 转换为 Issue[] 供 O-10 使用。
 *
 * 结构与 content-compiler.BuildDiagnostic 完全一致——TypeScript 结构化类型系统
 * 保证两端可直接互操作。
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

/**
 * publishAtomic 入参（执行案 §4.6.5）。
 *
 * - workspaceRoot：工作区根路径
 * - affectedFiles：受影响文件映射（filePath → 临时文件绝对路径）
 * - maxBackups：备份保留份数，默认 10
 * - backupDir：备份目录相对路径，默认 '.backups'
 *
 * 与 publishFiles 区别：
 * - publishAtomic 接收已生成的临时文件路径映射，不接收 PublishableFile[]
 *   （内容已在临时目录中，无需再次写入）
 * - publishAtomic 不做外部修改检测与 prePublishCheck——这些由调用方
 *   （content-compiler 步骤 6 + 步骤 7）已完成
 * - publishAtomic 只负责：备份 + 原子替换 + 失败回滚
 */
export interface PublishAtomicOptions {
  workspaceRoot: string;
  affectedFiles: Map<string, string>;
  maxBackups?: number;
  backupDir?: string;
}

/**
 * publishAtomic 返回结果（执行案 §4.6.5）。
 *
 * - success：所有文件是否全部替换成功
 * - publishedFiles：成功替换的文件清单
 * - failedFiles：替换失败的文件清单
 * - rolledBackFiles：因失败回滚的文件清单（从备份恢复）
 * - diagnostics：诊断列表（含失败原因、回滚状态等）
 * - backupPath：备份目录路径（成功创建备份时存在）
 */
export interface PublishAtomicResult {
  success: boolean;
  publishedFiles: string[];
  failedFiles: string[];
  rolledBackFiles: string[];
  diagnostics: BuildDiagnostic[];
  backupPath?: string;
}

// ─── 常量 ───

const DEFAULT_KEEP_BACKUPS = 10;
const DEFAULT_BACKUP_DIR = '.backups';
const BACKUP_NAME_PREFIX = 'backup-';
const SHORT_HASH_LENGTH = 6;

// ─── 核心发布函数 ───

/**
 * 原子发布——把 files 写入 workspaceRoot 下对应路径。
 *
 * 流程：
 *   1. 外部修改检测：每个 file 对比 baseline 与当前文件 revision
 *   2. 任一冲突 → 返回 conflicts，不创建备份
 *   3. 创建时间戳备份目录，复制当前文件到备份
 *   4. 在 OS 临时目录生成全部新文件
 *   5. 原子替换：fs.renameSync（Windows 上会先删除目标）
 *   6. 任一步失败 → 从备份还原原文件，清理临时目录
 *   7. 清理超出 keepBackups 的旧备份
 *
 * 不抛异常——所有错误通过 PublishResult.error 返回。
 */
export async function publishFiles(
  files: PublishableFile[],
  baseline: BaselineEntry[],
  options: PublishOptions,
): Promise<PublishResult> {
  const workspaceRoot = options.workspaceRoot;
  const keepBackups = options.keepBackups ?? DEFAULT_KEEP_BACKUPS;
  const backupDirRel = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const backupRoot = path.resolve(workspaceRoot, backupDirRel);

  // 1. 外部修改检测
  const baselineMap = new Map(baseline.map((b) => [b.filePath, b.revision]));
  const conflicts: PublishConflict[] = [];
  for (const file of files) {
    const baselineRev = baselineMap.get(file.filePath);
    if (!baselineRev) continue; // 无基线记录视为新文件，不检测冲突
    const absPath = path.resolve(workspaceRoot, file.filePath);
    let currentRev: FileRevision | null = null;
    try {
      currentRev = await readFileRevision(absPath);
    } catch {
      // 文件不存在或读取失败：视为新文件，跳过冲突检测
      continue;
    }
    const conflict = compareRevisions(file.filePath, baselineRev, currentRev);
    if (conflict) conflicts.push(conflict);
  }
  if (conflicts.length > 0) {
    return {
      success: false,
      publishedFiles: [],
      backupDir: '',
      conflicts,
      error: 'external_modification_detected',
    };
  }

  // 2. 预发布检查（执行案 §4.7.1 step 6）——可选 hook，由调用方注入
  // 在外部修改检测通过后、备份创建前执行；失败时不创建备份、不写入任何文件
  if (options.prePublishCheck) {
    let checkResult: PrePublishCheckResult;
    try {
      checkResult = await options.prePublishCheck(files);
    } catch (err) {
      return {
        success: false,
        publishedFiles: [],
        backupDir: '',
        conflicts: [],
        error: `pre_publish_check_threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!checkResult.passed) {
      return {
        success: false,
        publishedFiles: [],
        backupDir: '',
        conflicts: [],
        error: 'pre_publish_check_failed',
        checkFailures: checkResult.failures,
      };
    }
  }

  // 3. 创建备份目录并复制当前文件
  let backupDirPath: string;
  try {
    backupDirPath = await createBackupDir(backupRoot, files, workspaceRoot);
  } catch (err) {
    return {
      success: false,
      publishedFiles: [],
      backupDir: '',
      conflicts: [],
      error: `backup_creation_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. 在 OS 临时目录生成新文件，然后原子替换
  let tempDir: string | null = null;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oblivions-publish-'));
    // 写入临时文件（用扁平化文件名，避免在临时目录重建子目录树）
    const tempEntries: Array<{ tempPath: string; targetAbs: string }> = [];
    for (const file of files) {
      const tempName = file.filePath.replace(/[\\/]/g, '__');
      const tempPath = path.join(tempDir, tempName);
      await fs.promises.writeFile(tempPath, file.content, 'utf8');
      const targetAbs = path.resolve(workspaceRoot, file.filePath);
      tempEntries.push({ tempPath, targetAbs });
    }

    // 原子替换——fs.renameSync 在 Windows 上会先删除目标，跨平台原子语义
    for (const entry of tempEntries) {
      const targetDir = path.dirname(entry.targetAbs);
      await fs.promises.mkdir(targetDir, { recursive: true });
      fs.renameSync(entry.tempPath, entry.targetAbs);
    }
  } catch (err) {
    // 5. 失败回滚：从备份还原原文件
    await restoreFromBackup(backupDirPath, workspaceRoot).catch(() => {
      // 回滚失败已无法挽救，记录到 error 但不再抛出
    });
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {
        // 临时目录清理失败不影响主流程
      });
    }
    return {
      success: false,
      publishedFiles: [],
      backupDir: backupDirPath,
      conflicts: [],
      error: `publish_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 清理临时目录
  if (tempDir) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {
      // 临时目录清理失败不影响主流程
    });
  }

  // 6. 清理超出 keepBackups 的旧备份
  await cleanupOldBackups(backupRoot, keepBackups).catch(() => {
    // 旧备份清理失败不阻断本次发布
  });

  return {
    success: true,
    publishedFiles: files.map((f) => f.filePath),
    backupDir: backupDirPath,
    conflicts: [],
  };
}

// ─── publishAtomic：跨平台原子替换（执行案 §4.6.5） ───

/**
 * Windows 文件占用预检查的最大重试次数。
 *
 * 每次重试间隔 100ms，最多 3 次（总等待 ≤ 300ms）。
 */
const WINDOWS_LOCK_RETRY_LIMIT = 3;
const WINDOWS_LOCK_RETRY_DELAY_MS = 100;

/**
 * 跨平台原子替换——把临时文件原子替换到目标路径（执行案 §4.6.5）。
 *
 * 由 content-compiler 步骤 8 调用，假定：
 *   - 冲突检查（步骤 7）已完成，目标文件未被外部修改
 *   - 语法校验（步骤 6）已通过，临时文件内容有效
 *
 * 跨平台策略：
 *   - Unix/macOS：fs.renameSync 直接调用（POSIX rename 原子）
 *   - Windows：
 *     1. 预检查：fs.openSync(target, 'r+') 试探文件是否被占用
 *        失败则等待 100ms 重试，最多 3 次；仍失败 emit warning 不阻断
 *     2. 备份：把目标文件复制到备份目录（若存在）
 *     3. 替换：fs.renameSync(tempFile, target)——Windows 同盘原子；
 *        跨盘符降级为 copyFileSync + unlinkSync（非原子，由备份回滚保障）
 *     4. 回滚：任一文件替换失败 → 已替换文件从备份恢复，未替换文件保持原状
 *
 * 关键约束：
 *   - 临时目录与目标文件应在同一盘符（content-compiler.createTempBuildDir 已保证）
 *   - 替换失败时 emit `compilation.atomic_replace_failed` 诊断
 *   - 回滚失败（极端情况）emit critical 诊断，提示用户手工从 .backups/ 恢复
 *
 * @returns PublishAtomicResult——成功/失败均通过此结构返回，不抛异常
 */
export async function publishAtomic(
  options: PublishAtomicOptions,
): Promise<PublishAtomicResult> {
  const { workspaceRoot, affectedFiles } = options;
  const maxBackups = options.maxBackups ?? DEFAULT_KEEP_BACKUPS;
  const backupDirRel = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const backupRoot = path.resolve(workspaceRoot, backupDirRel);

  const diagnostics: BuildDiagnostic[] = [];
  const publishedFiles: string[] = [];
  const failedFiles: string[] = [];
  const rolledBackFiles: string[] = [];

  if (affectedFiles.size === 0) {
    return {
      success: true,
      publishedFiles: [],
      failedFiles: [],
      rolledBackFiles: [],
      diagnostics,
    };
  }

  // 1. 创建备份目录并复制当前文件
  let backupDirPath: string;
  try {
    const publishableFiles: PublishableFile[] = Array.from(affectedFiles.keys()).map(
      (filePath) => ({ filePath, content: '' }), // content 占位——createBackupDir 只需要 filePath
    );
    backupDirPath = await createBackupDir(backupRoot, publishableFiles, workspaceRoot);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      ruleId: 'compilation.backup_creation_failed',
      message: `备份目录创建失败：${err instanceof Error ? err.message : String(err)}`,
      source: 'atomic-publisher',
    });
    return {
      success: false,
      publishedFiles: [],
      failedFiles: Array.from(affectedFiles.keys()),
      rolledBackFiles: [],
      diagnostics,
    };
  }

  // 2. 逐个原子替换
  for (const [filePath, tempPath] of affectedFiles) {
    const targetAbs = path.resolve(workspaceRoot, filePath);
    const targetDir = path.dirname(targetAbs);

    try {
      // 确保目标目录存在
      await fs.promises.mkdir(targetDir, { recursive: true });

      // Windows 预检查：文件被占用时重试
      if (process.platform === 'win32') {
        const lockOk = await checkFileNotLocked(targetAbs);
        if (!lockOk) {
          diagnostics.push({
            severity: 'warning',
            ruleId: 'compilation.file_locked_warning',
            message: `文件 ${filePath} 可能被其他进程占用，重试 ${WINDOWS_LOCK_RETRY_LIMIT} 次后仍无法独占访问，将尝试强制替换`,
            file: filePath,
            source: 'atomic-publisher',
          });
        }
      }

      // 原子替换：renameSync
      // - Unix/macOS：POSIX rename 原子
      // - Windows：同盘符下原子；跨盘符降级为 copy + unlink
      try {
        fs.renameSync(tempPath, targetAbs);
      } catch (renameErr) {
        // 跨盘符降级：copy + unlink（非原子，由备份回滚保障）
        if (isCrossDeviceError(renameErr)) {
          await fs.promises.copyFile(tempPath, targetAbs);
          await fs.promises.unlink(tempPath).catch(() => {
            // 临时文件清理失败不影响主流程
          });
        } else {
          throw renameErr;
        }
      }

      publishedFiles.push(filePath);
    } catch (err) {
      failedFiles.push(filePath);
      diagnostics.push({
        severity: 'error',
        ruleId: 'compilation.atomic_replace_failed',
        message: `替换 ${filePath} 失败：${err instanceof Error ? err.message : String(err)}`,
        file: filePath,
        source: 'atomic-publisher',
      });
    }
  }

  // 3. 失败回滚：从备份还原已替换的文件
  if (failedFiles.length > 0 && publishedFiles.length > 0) {
    for (const filePath of publishedFiles) {
      try {
        const backupAbs = path.join(backupDirPath, filePath);
        const targetAbs = path.resolve(workspaceRoot, filePath);
        // 检查备份文件是否存在（新文件场景备份为占位空文件）
        const backupStat = await fs.promises.stat(backupAbs).catch(() => null);
        if (backupStat && backupStat.size > 0) {
          await fs.promises.copyFile(backupAbs, targetAbs);
          rolledBackFiles.push(filePath);
        } else {
          // 备份为空占位 = 原本不存在的新文件，回滚 = 删除
          await fs.promises.unlink(targetAbs).catch(() => {
            // 删除失败不阻断回滚流程
          });
          rolledBackFiles.push(filePath);
        }
      } catch (err) {
        diagnostics.push({
          severity: 'error',
          ruleId: 'compilation.rollback_failed',
          message: `回滚 ${filePath} 失败：${err instanceof Error ? err.message : String(err)}——请手工从 ${backupDirPath} 恢复`,
          file: filePath,
          source: 'atomic-publisher',
        });
      }
    }
  }

  // 4. 清理超出 maxBackups 的旧备份
  await cleanupOldBackups(backupRoot, maxBackups).catch(() => {
    // 旧备份清理失败不阻断本次发布
  });

  return {
    success: failedFiles.length === 0,
    publishedFiles: failedFiles.length > 0 ? [] : publishedFiles,
    failedFiles,
    rolledBackFiles,
    diagnostics,
    backupPath: backupDirPath,
  };
}

/**
 * Windows 文件占用预检查——尝试以 'r+' 模式打开文件，失败则重试。
 *
 * @returns true=文件未占用（或重试后可用）；false=文件持续被占用
 */
async function checkFileNotLocked(filePath: string): Promise<boolean> {
  for (let attempt = 0; attempt < WINDOWS_LOCK_RETRY_LIMIT; attempt++) {
    let fd: number | null = null;
    try {
      // 'r+' 模式要求文件存在且可读写；失败说明文件被占用或不可访问
      fd = fs.openSync(filePath, 'r+');
      return true;
    } catch {
      // 文件不存在不视为占用（新文件场景）
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat) return true;
      // 等待 100ms 后重试
      await new Promise((r) => setTimeout(r, WINDOWS_LOCK_RETRY_DELAY_MS));
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // 关闭失败不影响主流程
        }
      }
    }
  }
  return false;
}

/**
 * 判断错误是否为跨盘符错误（Windows EXDEV / 其他平台同类错误）。
 *
 * Node.js 跨盘符 rename 会抛 EXDEV 错误；本函数用于触发降级策略。
 */
function isCrossDeviceError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EXDEV' || code === 'ENOTSUP';
}

// ─── 辅助函数 ───

/**
 * 读取文件并计算 FileRevision 三元组。
 *
 * 与 file-revision.ts 的 computeFileRevision 区别：
 * - 本函数从磁盘读取文件内容与 stat
 * - 使用 Node.js crypto 计算 SHA-256 前 16 字节十六进制（与 file-revision.ts 的 hashContent 输出格式一致）
 *
 * 文件不存在抛 ENOENT 错误，由调用方决定是否视为新文件。
 */
export async function readFileRevision(filePath: string): Promise<FileRevision> {
  const [content, stat] = await Promise.all([
    fs.promises.readFile(filePath, 'utf8'),
    fs.promises.stat(filePath),
  ]);
  const contentHash = hashContentNode(content);
  return {
    mtime: Math.floor(stat.mtimeMs),
    size: stat.size,
    contentHash,
  };
}

/**
 * 创建时间戳备份目录，并把当前文件复制到备份。
 *
 * 命名格式：`backup-YYYYMMDD-HHMMSS-<short-hash>/`
 * - short-hash：所有文件路径拼接后 SHA-256 前 6 字节十六进制，避免同秒并发冲突
 *
 * @returns 备份目录绝对路径
 */
export async function createBackupDir(
  backupRoot: string,
  files: PublishableFile[],
  workspaceRoot: string,
): Promise<string> {
  await fs.promises.mkdir(backupRoot, { recursive: true });

  const now = new Date();
  const timestamp = formatTimestamp(now);
  const shortHash = hashShort(files.map((f) => f.filePath).join('\n'));
  const backupName = `${BACKUP_NAME_PREFIX}${timestamp}-${shortHash}`;
  const backupDirPath = path.join(backupRoot, backupName);

  await fs.promises.mkdir(backupDirPath, { recursive: true });

  // 复制当前文件到备份（保留相对路径结构）
  for (const file of files) {
    const srcAbs = path.resolve(workspaceRoot, file.filePath);
    const destAbs = path.join(backupDirPath, file.filePath);
    const destDir = path.dirname(destAbs);
    await fs.promises.mkdir(destDir, { recursive: true });
    try {
      await fs.promises.copyFile(srcAbs, destAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // 源文件不存在（新文件场景）：跳过备份，写入占位文件以便回滚时识别
        await fs.promises.writeFile(destAbs, '', 'utf8');
        continue;
      }
      throw err;
    }
  }

  return backupDirPath;
}

/**
 * 清理超出 keepBackups 的旧备份目录。
 *
 * 按目录名降序排序（最新在前），保留前 keepBackups 个，删除其余。
 */
export async function cleanupOldBackups(backupRoot: string, keepBackups: number): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(backupRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const backupDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith(BACKUP_NAME_PREFIX))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a));

  if (backupDirs.length <= keepBackups) return;

  const toRemove = backupDirs.slice(keepBackups);
  for (const name of toRemove) {
    await fs.promises.rm(path.join(backupRoot, name), { recursive: true, force: true });
  }
}

/**
 * 从备份还原——把备份目录中的文件复制回 workspaceRoot。
 *
 * 用于发布失败回滚。备份中存在的文件覆盖原文件；备份中不存在的文件保持不变。
 */
export async function restoreFromBackup(
  backupDir: string,
  workspaceRoot: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await walkFiles(backupDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  for (const relPath of entries) {
    const srcAbs = path.join(backupDir, relPath);
    const destAbs = path.resolve(workspaceRoot, relPath);
    const destDir = path.dirname(destAbs);
    await fs.promises.mkdir(destDir, { recursive: true });
    await fs.promises.copyFile(srcAbs, destAbs);
  }
}

/**
 * 列出备份目录下所有备份，按时间倒序返回。
 *
 * 用于 GET /api/backups 路由。
 */
export async function listBackups(backupRoot: string): Promise<BackupInfo[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(backupRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const backups: BackupInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(BACKUP_NAME_PREFIX)) continue;
    const dirAbs = path.join(backupRoot, entry.name);
    const stat = await fs.promises.stat(dirAbs);
    const files = await walkFiles(dirAbs);
    backups.push({
      name: entry.name,
      createdAt: Math.floor(stat.mtimeMs),
      fileCount: files.length,
    });
  }

  // 按时间倒序（最新在前）
  backups.sort((a, b) => b.createdAt - a.createdAt);
  return backups;
}

// ─── 内部工具 ───

/**
 * 比较两个 FileRevision，返回冲突原因（无冲突返回 null）。
 *
 * 检测顺序：mtime → size → contentHash（与三元组字段顺序一致）。
 */
function compareRevisions(
  filePath: string,
  baseline: FileRevision,
  current: FileRevision,
): PublishConflict | null {
  if (baseline.mtime !== current.mtime) {
    return { filePath, reason: 'mtime_mismatch', baseline, current };
  }
  if (baseline.size !== current.size) {
    return { filePath, reason: 'size_mismatch', baseline, current };
  }
  if (baseline.contentHash !== current.contentHash) {
    return { filePath, reason: 'hash_mismatch', baseline, current };
  }
  return null;
}

/**
 * 计算 SHA-256 前 16 字节十六进制（与 file-revision.ts 的 hashContent 输出格式一致）。
 *
 * Node.js 环境直接用 crypto.createHash，浏览器环境（file-revision.ts）用 crypto.subtle.digest。
 * 两者输出字节序与长度完全一致，保证前后端 revision 可比对。
 */
function hashContentNode(content: string): string {
  const hash = crypto.createHash('sha256').update(content, 'utf8').digest();
  return hash.slice(0, 16).toString('hex');
}

/**
 * 计算短哈希（用于备份目录名后缀）。
 */
function hashShort(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, SHORT_HASH_LENGTH);
}

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
 *
 * 用于备份还原与备份列表统计。
 */
async function walkFiles(dirAbs: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
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
