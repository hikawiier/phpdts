/**
 * @module O 内容工具箱
 *
 * TS locale 逆向投影器共享工具——所有 9 个 TS locale 逆向投影器复用的解析逻辑。
 *
 * 设计意图：
 * - 解析层复用 ts-locale-adapter.parseTsLocale，不重新实现
 * - 通过最小 kindSchema 让 parseTsLocale 工作（仅需 kind 字段）
 * - stripUndefinedFields 递归移除 undefined（与正向投影器对齐）
 *
 * 边界：
 * - terrain-desc.ts 结构不同（嵌套词库 vs 扁平 name/desc），
 *   由 terrain-desc-reverse-projector 单独处理，不走本共享工具
 * - 解析失败时返回空 diagnostics + success=false，不抛异常
 */

import { parseTsLocale } from '../../adapters/ts-locale-adapter';
import type { KindSchema } from '../../schema/types';
import type {
  ReverseProjectOptions,
  ReverseProjectResult,
  ReverseProjectDiagnostic,
  YamlAuthorResource,
} from './types';

/**
 * 解析 TS locale 文件内容并归一化为 map-keyed 字典形态。
 *
 * 用于 presentation.item / recipe / poi / enemy / itmk / tag / status / ui
 * 等"标准形态" TS locale 文件——Record<string, XxxEntry> 形态。
 *
 * @param options.filePath 编译产物路径
 * @param options.content TS 文件内容
 * @param kind presentation kind（如 'presentation.item'）
 * @param rootKey YAML 顶层 key（如 'items'）
 * @param yamlFilePath 作者资源 YAML 路径
 * @returns ReverseProjectResult——成功时 resource.data 是 Record<id, entry>
 */
export function reverseProjectStandardTsLocale(
  options: ReverseProjectOptions,
  kind: string,
  rootKey: string,
  yamlFilePath: string,
): ReverseProjectResult {
  const diagnostics: ReverseProjectDiagnostic[] = [];

  // 构造最小 kindSchema——parseTsLocale 仅使用 kind 字段
  const minimalSchema = { kind } as KindSchema;

  const nodes = parseTsLocale(options.filePath, options.content, minimalSchema);
  if (nodes.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.ts_parse_failed',
      message: `TS locale 解析失败或文件无 Record<string, ...> 声明：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const dict: Record<string, unknown> = {};
  for (const node of nodes) {
    dict[node.id] = stripUndefinedFields(node.data);
  }

  const resource: YamlAuthorResource = {
    filePath: yamlFilePath,
    rootKey,
    data: dict,
  };
  return { success: true, resource, diagnostics };
}

/**
 * 递归移除 undefined 字段——与正向投影器 stripUndefinedFields 行为一致。
 */
export function stripUndefinedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedFields);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      result[k] = stripUndefinedFields(v);
    }
    return result;
  }
  return value;
}
