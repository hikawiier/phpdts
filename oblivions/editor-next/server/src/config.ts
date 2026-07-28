//
// O-1 Workspace Gateway 配置加载器
//
// 读取 oblivions/editor-next/editor.config.json，解析工作区路径并解析为绝对路径。
// 所有路径参数必须在 resolveWorkspacePath() 中校验，越界返回 403。
//
// @module O 内容工具箱
//

import fs from 'node:fs';
import path from 'node:path';

/**
 * 工作区配置（所有路径在 loadConfig() 后均为绝对路径）
 */
export interface Config {
  /** 工作区根路径（绝对路径，通常是 phpdts/） */
  workspaceRoot: string;
  /** oblivions/gamedata 绝对路径 */
  gamedataPath: string;
  /** vex-vue/src/data 绝对路径 */
  vexVueDataPath: string;
  /** 备份目录绝对路径 */
  backupPath: string;
  /** Gateway 监听端口（固定 5180） */
  port: number;
  /** Gateway 监听地址（固定 127.0.0.1，禁止外部访问） */
  host: string;
}

const DEFAULT_PORT = 5180;
const DEFAULT_HOST = '127.0.0.1';

interface RawConfig {
  workspaceRoot?: string;
  gamedataPath?: string;
  vexVueDataPath?: string;
  backupPath?: string;
}

/**
 * 编辑器配置文件位置（editor-next/editor.config.json）。
 * 使用 __dirname 推断，避免依赖 process.cwd()。
 */
function findEditorConfigFile(): { configPath: string; editorNextDir: string } | null {
  // server/src/ → ../.. = editor-next/
  // server/dist/ → ../.. = editor-next/
  const editorNextDir = path.resolve(__dirname, '..', '..');
  const configPath = path.resolve(editorNextDir, 'editor.config.json');
  if (fs.existsSync(configPath)) {
    return { configPath, editorNextDir };
  }
  return null;
}

/**
 * 加载配置。优先读取 editor.config.json；缺失时使用默认值。
 *
 * workspaceRoot 默认值：editor-next/ 的上两级（即 phpdts/）
 * gamedataPath 默认值：oblivions/gamedata（相对 workspaceRoot）
 * vexVueDataPath 默认值：vex-vue/src/data（相对 workspaceRoot）
 * backupPath 默认值：oblivions/editor-next/.backups（相对 workspaceRoot）
 */
export function loadConfig(): Config {
  const found = findEditorConfigFile();
  const editorNextDir = found?.editorNextDir ?? path.resolve(__dirname, '..', '..');

  let raw: RawConfig = {};
  if (found) {
    try {
      const text = fs.readFileSync(found.configPath, 'utf8');
      raw = JSON.parse(text) as RawConfig;
    } catch (err) {
      // 配置解析失败时使用默认值，不阻断启动
      console.error('[gateway] editor.config.json 解析失败，使用默认值:', err);
    }
  }

  // workspaceRoot：raw 中的相对路径以 editor-next/ 为基准；默认值是 editor-next/../.. = phpdts/
  const workspaceRoot = raw.workspaceRoot
    ? path.resolve(editorNextDir, raw.workspaceRoot)
    : path.resolve(editorNextDir, '..', '..');

  const gamedataPath = path.resolve(workspaceRoot, raw.gamedataPath ?? 'oblivions/gamedata');
  const vexVueDataPath = path.resolve(workspaceRoot, raw.vexVueDataPath ?? 'vex-vue/src/data');
  const backupPath = path.resolve(workspaceRoot, raw.backupPath ?? 'oblivions/editor-next/.backups');

  return {
    workspaceRoot,
    gamedataPath,
    vexVueDataPath,
    backupPath,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
  };
}

/**
 * 解析相对路径为 workspaceRoot 内的绝对路径，并校验越界。
 *
 * @returns 成功返回绝对路径；越界返回 null（路由应回 403）
 */
export function resolveWorkspacePath(workspaceRoot: string, relPath: string): string | null {
  if (path.isAbsolute(relPath)) {
    // 拒绝绝对路径输入，避免被构造攻击
    return null;
  }
  const absPath = path.resolve(workspaceRoot, relPath);
  const rel = path.relative(workspaceRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return absPath;
}

/**
 * 把绝对路径转换为相对 workspaceRoot 的相对路径（用于事件推送）
 */
export function toWorkspaceRelative(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
}
