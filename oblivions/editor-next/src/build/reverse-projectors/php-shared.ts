/**
 * @module O 内容工具箱
 *
 * PHP 逆向投影器共享工具——所有 PHP 逆向投影器复用的解析与归一化逻辑。
 *
 * 设计意图：
 * - 解析层复用 php-array-parser.parsePhpArrayExt，不重新实现
 * - stripUndefinedFields 递归移除 undefined（与正向投影器对齐，保证 round-trip）
 * - map-keyed / single / partitioned 三种 load 模式由调用方决定 rootKey 与 data 包装
 *
 * 边界：
 * - 解析失败时返回空 diagnostics + success=false，不抛异常
 * - PHP 文件头注释、空行等不进入数据结构（与正向投影器输出对齐）
 */

import { parsePhpArrayExt, type PhpValue } from '../../shared/serializer/php-array-parser';
import type {
  ReverseProjectOptions,
  ReverseProjectResult,
  ReverseProjectDiagnostic,
  YamlAuthorResource,
} from './types';

/**
 * 解析 PHP 文件内容并归一化为 map-keyed 字典形态。
 *
 * 用于 item.template / recipe.template / poi.template / loot.table / config.runtime 等
 * 顶层 key 是资源 ID 的 PHP 文件。
 *
 * @param options.filePath 编译产物路径（用于诊断）
 * @param options.content PHP 文件内容
 * @param rootKey YAML 顶层 key（如 'items'）
 * @param yamlFilePath 作者资源 YAML 路径
 * @returns ReverseProjectResult——成功时 resource.data 是 Record<id, entry>
 */
export function reverseProjectMapKeyedPhp(
  options: ReverseProjectOptions,
  rootKey: string,
  yamlFilePath: string,
): ReverseProjectResult {
  const diagnostics: ReverseProjectDiagnostic[] = [];
  const parseResult = parsePhpArrayExt(options.content);
  if (!parseResult.ok || parseResult.value === null) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.php_parse_failed',
      message: `PHP 解析失败：${parseResult.error?.message ?? '未知错误'}`,
      line: parseResult.error?.line,
      column: parseResult.error?.column,
    });
    return { success: false, diagnostics };
  }

  const value = parseResult.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.not_object',
      message: `PHP 顶层值不是关联数组：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const dict: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, PhpValue>)) {
    dict[key] = stripUndefinedFields(val);
  }

  const resource: YamlAuthorResource = {
    filePath: yamlFilePath,
    rootKey,
    data: dict,
  };
  return { success: true, resource, diagnostics };
}

/**
 * 解析 PHP 文件内容并归一化为 single 形态（整文件作为单个 entry）。
 *
 * 用于 config.runtime（obl_config.php）——整文件是单个 obl_config 字典。
 *
 * @param options.filePath 编译产物路径
 * @param options.content PHP 文件内容
 * @param rootKey YAML 顶层 key（如 'obl_config'）
 * @param yamlFilePath 作者资源 YAML 路径
 * @returns ReverseProjectResult——成功时 resource.data 是 obl_config 字典
 */
export function reverseProjectSinglePhp(
  options: ReverseProjectOptions,
  rootKey: string,
  yamlFilePath: string,
): ReverseProjectResult {
  const diagnostics: ReverseProjectDiagnostic[] = [];
  const parseResult = parsePhpArrayExt(options.content);
  if (!parseResult.ok || parseResult.value === null) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.php_parse_failed',
      message: `PHP 解析失败：${parseResult.error?.message ?? '未知错误'}`,
      line: parseResult.error?.line,
      column: parseResult.error?.column,
    });
    return { success: false, diagnostics };
  }

  const value = parseResult.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push({
      severity: 'error',
      code: 'reverse_projector.not_object',
      message: `PHP 顶层值不是关联数组：${options.filePath}`,
    });
    return { success: false, diagnostics };
  }

  const resource: YamlAuthorResource = {
    filePath: yamlFilePath,
    rootKey,
    data: stripUndefinedFields(value),
  };
  return { success: true, resource, diagnostics };
}

/**
 * 解析 PHP 文件内容并归一化为 partitioned 形态（按 tide 桶分区）。
 *
 * 用于 distribution.scatter / distribution.poi / distribution.enemy——
 * PHP 文件顶层是按 tide 桶分区的关联数组。
 *
 * @param options.filePath 编译产物路径
 * @param options.content PHP 文件内容
 * @param rootKey YAML 顶层 key（如 'scatter_pool'）
 * @param yamlFilePath 作者资源 YAML 路径
 * @returns ReverseProjectResult——成功时 resource.data 是 Record<tide, bucket>
 */
export function reverseProjectPartitionedPhp(
  options: ReverseProjectOptions,
  rootKey: string,
  yamlFilePath: string,
): ReverseProjectResult {
  // partitioned 与 map-keyed 数据结构同构（顶层 key 是 tide 桶名）
  return reverseProjectMapKeyedPhp(options, rootKey, yamlFilePath);
}

/**
 * 递归移除 undefined 字段——与正向投影器 stripUndefinedFields 行为一致。
 *
 * 保留所有显式值（含 false / 0 / '' / null），仅移除 undefined。
 * 用于保证 round-trip 一致性——正向投影器输出时省略 undefined 字段，
 * 逆向投影器解析后也需移除 undefined，避免 YAML 序列化时出现 undefined。
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
