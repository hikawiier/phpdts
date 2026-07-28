//
// O-5 PHP 语法检查共享服务
//
// 提供 `php -l` 调用封装，供：
//   - /api/lint-php 路由（交互式单文件 lint）
//   - /api/write 路由的 prePublishCheck hook（发布前批量 lint）
// 共用。避免在两个路由中重复实现 spawnSync 逻辑。
//
// @module O 内容工具箱
//

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  PrePublishCheckResult,
  PrePublishCheckFailure,
  PublishableFile,
} from '../../../src/build/atomic-publisher';

/**
 * 探测 php 可执行文件名。Windows 通常为 php.exe，Linux/Mac 为 php。
 */
function detectPhpBinary(): string {
  return process.platform === 'win32' ? 'php.exe' : 'php';
}

/**
 * 调用 `php -l <file>`，返回 stdout+stderr 合并输出与退出码。
 *
 * 与 lint-php.ts 原有的 runPhpLint 行为一致——成功时退出码 0，
 * 输出 "No syntax errors detected"；失败时输出含行号的错误信息。
 */
export function runPhpLint(targetFile: string): { code: number; output: string } {
  const result = spawnSync(detectPhpBinary(), ['-l', targetFile], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = (stdout + stderr).trim();
  return { code: result.status ?? -1, output };
}

/**
 * PHP 错误行号正则——匹配 `PHP Parse error: ... in <file> on line N` 或
 * `PHP Fatal error: ... in <file>:N`。供 PrePublishCheckFailure.line 填充。
 */
const PHP_ERROR_LINE_PATTERN = /(?:on line |:(\d+))/;

/**
 * 把 `php -l` 输出解析为 PrePublishCheckFailure。
 *
 * php -l 失败输出形如：
 *   `PHP Parse error: syntax error, unexpected token "..." in <file> on line 42`
 * 或（新版 PHP）：
 *   `PHP Parse error: syntax error, unexpected token "..." in <file>:42`
 *
 * 解析行号供编辑器导航；解析失败时 line 留空。
 */
function parsePhpLintFailure(filePath: string, output: string): PrePublishCheckFailure {
  const match = PHP_ERROR_LINE_PATTERN.exec(output);
  const line = match?.[1] ? Number(match[1]) : undefined;
  return {
    filePath,
    message: output,
    line: line !== undefined && Number.isFinite(line) ? line : undefined,
  };
}

/**
 * 预发布检查——对 PublishableFile[] 中的 PHP 文件批量执行 `php -l`。
 *
 * 设计意图（执行案 §4.7.1 step 6）：
 * - 把每个 .php 文件写入 OS 临时目录，调用 `php -l` 检查语法
 * - 任一文件失败 → passed=false，failures 含所有失败条目
 * - TS 文件不在本函数检查——vue-tsc 需要完整项目上下文，P3 阶段不实现
 *   （执行案 §4.7.1 step 6 的 vue-tsc 在 P5 完整管道中实现）
 * - 临时文件检查后立即删除，不污染工作区
 *
 * @param files 待发布的已序列化文件
 * @returns 检查结果——passed=true 时 failures 为空数组
 */
export async function runPrePublishPhpLint(
  files: PublishableFile[],
): Promise<PrePublishCheckResult> {
  const failures: PrePublishCheckFailure[] = [];
  const phpFiles = files.filter((f) => f.filePath.endsWith('.php'));

  for (const file of phpFiles) {
    // 写入 OS 临时目录——文件名用扁平化形式避免子目录创建
    const tempName = `oblivions-precheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.php`;
    const tempPath = path.join(os.tmpdir(), tempName);
    try {
      fs.writeFileSync(tempPath, file.content, 'utf8');
      const { code, output } = runPhpLint(tempPath);
      if (code !== 0) {
        failures.push(parsePhpLintFailure(file.filePath, output));
      }
    } catch (err) {
      // php 不可执行或临时文件写入失败——视为该文件检查失败
      failures.push({
        filePath: file.filePath,
        message: `pre-publish check threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 临时文件清理失败不影响主流程
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
