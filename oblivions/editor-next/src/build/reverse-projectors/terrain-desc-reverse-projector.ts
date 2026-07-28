/**
 * @module O 内容工具箱
 *
 * terrain-desc.ts 逆向投影器——从 vex-vue/src/data/terrain-desc.ts 提取
 * presentation.terrain 数据，输出 oblivions/content/presentations/terrain-desc.yaml 作者资源结构。
 *
 * 设计意图（执行案 06-P5 §4.3.4）：
 * - terrain-desc.ts 与其他 locale 结构不同（嵌套词库 vs 扁平 name/desc），
 *   parseTsLocale 无法解析（返回空数组），需要独立解析路径
 * - 用正则定位 `export const TERRAIN_DESC: TerrainDescConfig = {` 起始位置，
 *   然后用 brace-matching 找闭合 `}`，提取对象字面量
 * - 复用 ts-shared.stripUndefinedFields 移除 undefined
 *
 * 边界：
 * - 文件不存在 TERRAIN_DESC 常量时返回 success=false + 诊断
 * - 数据结构：{ floor: Record<FloorType, FloorConfig>, tide: Record<TideType, string[]>,
 *   impassable_suffix: string[], templates: { default: string[], no_tide: string[] } }
 * - YAML 输出形态：rootKey='terrain_desc'，data 是完整 TerrainDescConfig 对象
 */

import { stringify, parse } from 'yaml';
import { stripUndefinedFields } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult, ReverseProjectDiagnostic, YamlAuthorResource } from './types';

const ROOT_KEY = 'terrain_desc';
const YAML_FILE_PATH = 'oblivions/content/presentations/terrain-desc.yaml';

/**
 * 从 terrain-desc.ts 内容提取 presentation.terrain 数据。
 *
 * @returns ReverseProjectResult——成功时 resource.data 是 TerrainDescConfig 对象
 */
export function reverseProjectTerrainDesc(options: ReverseProjectOptions): ReverseProjectResult {
  const diagnostics: ReverseProjectDiagnostic[] = [];

  // 定位 `export const TERRAIN_DESC: TerrainDescConfig = {` 起始位置
  // 注意：TERRAIN_DESC 类型不是 Record<string, ...>，parseTsLocale 无法处理
  const re = /export\s+const\s+TERRAIN_DESC\s*:\s*TerrainDescConfig\s*=\s*\{/;
  const match = re.exec(options.content);
  if (!match) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.terrain_desc_const_not_found',
      message: `未找到 TERRAIN_DESC 常量声明：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const openBraceIdx = options.content.indexOf('{', match.index + match[0].length - 1);
  if (openBraceIdx === -1) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.terrain_desc_brace_not_found',
      message: `TERRAIN_DESC 声明后未找到 { 起始位置：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const closeBraceIdx = findMatchingBrace(options.content, openBraceIdx);
  if (closeBraceIdx === -1) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.terrain_desc_brace_unclosed',
      message: `TERRAIN_DESC 对象字面量未闭合：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const objLiteral = options.content.substring(openBraceIdx, closeBraceIdx + 1);

  // 把 TS 对象字面量转为 JS 对象——通过 yaml 包中转：
  // 1. 把 TS 字面量转为 YAML 兼容形态（去掉 TS 特有语法）
  // 2. 用 yaml.parse 解析为 JS 对象
  // 这种方式比手写 tokenizer 简单，且 terrain-desc 结构相对固定
  const yamlStr = tsLiteralToYaml(objLiteral);
  let parsed: unknown;
  try {
    parsed = parse(yamlStr);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.terrain_desc_parse_failed',
      message: `TERRAIN_DESC 对象字面量解析失败：${err instanceof Error ? err.message : String(err)}`,
    });
    return { success: false, diagnostics };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.terrain_desc_not_object',
      message: `TERRAIN_DESC 解析结果不是对象：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const resource: YamlAuthorResource = {
    filePath: YAML_FILE_PATH,
    rootKey: ROOT_KEY,
    data: stripUndefinedFields(parsed),
  };
  return { success: true, resource, diagnostics };
}

/**
 * 找匹配的闭合大括号（跳过字符串、模板字符串、注释、嵌套大括号）
 *
 * 与 ts-locale-adapter.findMatchingBrace 行为一致，独立声明以保持逆向投影器自包含。
 */
function findMatchingBrace(content: string, openIdx: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i]!;
    const next = content[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\' && next !== undefined) {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && next !== undefined) {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\' && next !== undefined) {
        i++;
        continue;
      }
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 把 TS 对象字面量转为 YAML 兼容字符串，用于 yaml.parse 解析。
 *
 * 这是一种简化策略——terrain-desc.ts 的 TERRAIN_DESC 是纯数据字面量（无函数、
 * 无模板表达式、无 Spread），结构与 YAML 兼容。转换规则：
 * - 单引号字符串 → 双引号字符串（YAML 兼容，避免单引号转义差异）
 * - 花括号 → 无需转换（YAML flow mapping）
 * - 方括号 → 无需转换（YAML flow sequence）
 * - key 后的冒号 → 无需转换（YAML flow mapping 用冒号）
 *
 * 边界：假设 TERRAIN_DESC 不含函数调用、模板字面量、Spread 操作符。
 * 若未来 terrain-desc.ts 加入这些语法，需要扩展本函数。
 */
function tsLiteralToYaml(tsLiteral: string): string {
  // 简化策略：TS 单引号字符串 → YAML 双引号字符串
  // 其余语法（{ } [ ] : ,）与 YAML flow 形态兼容
  let yamlStr = tsLiteral;
  // 把单引号字符串转为双引号——需匹配 'xxx' 形态（含 \' 转义）
  // 用正则做简化转换：'([^'\\]|\\.)*' → "..."
  yamlStr = yamlStr.replace(/'((?:[^'\\]|\\.)*)'/g, (_match, inner: string) => {
    // 反转义单引号字符串内的 \' → '，\\ → \
    const unescaped = inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    // 转义双引号字符串内的 " → \"，\ → \\
    const escaped = unescaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  });
  return yamlStr;
}

// 注：stringify 仅用于潜在的未来扩展（如把 data 序列化为 YAML 字符串），
// 当前实现未使用——保留 import 避免 TypeScript 未使用警告
void stringify;
