/**
 * @module O 内容工具箱
 *
 * 逆向投影器通用类型——P5-4 一次性迁移流程的基础契约。
 *
 * 设计意图（执行案 06-P5 §4.10.1）：
 * - 逆向投影器与正向投影器（build/projectors/*.ts）一一对应，方向相反——
 *   从 PHP/TS 编译产物提取数据，输出 YAML 作者资源结构。
 * - 输出结构对齐 kindSchema.authorFormat：包含 rootKey 顶层 key 与
 *   map-keyed / single / partitioned 三种 load 模式对应的 entry 形态。
 * - 不直接写文件——返回 YamlAuthorResource 由 migration-flow 统一写入磁盘，
 *   便于在写入前做 round-trip 一致性验证与回滚。
 * - 诊断收集所有失败条目（不抛异常），由 migration-flow 决定是否回滚。
 *
 * 边界：
 * - 输入 PHP/TS 文件内容为空或格式错误时，返回 success=false + 诊断，不抛异常
 * - 解析层复用现有 php-array-parser / ts-locale-adapter，不重新实现
 * - 输出 YamlAuthorResource.data 必须是 JSON 可序列化结构（YAML 兼容），
 *   不含 undefined / 函数 / Symbol
 */

import type { ResourceNode } from '../../graph/types';

/**
 * 逆向投影器入参——按 kind 包装 PHP/TS 编译产物内容。
 *
 * - filePath：编译产物工作区相对路径（用于诊断）
 * - content：编译产物完整文件内容
 * - nodes：可选，已解析的 ResourceNode[]（若调用方已解析过）；
 *   未提供时由投影器内部调用 parsePhpResource / parseTsLocale 解析
 */
export interface ReverseProjectOptions {
  filePath: string;
  content: string;
  nodes?: ResourceNode[];
}

/**
 * 逆向投影器输出——单个 YAML 作者资源文件结构。
 *
 * - filePath：作者资源 YAML 文件路径（如 'oblivions/content/items/items.yaml'）
 * - rootKey：YAML 顶层 key（如 'items'）；空表示顶层直接是 entry map
 * - data：YAML 数据结构（不含 rootKey 包装层；由 migration-flow 包装到 rootKey 下）
 *
 * data 形态由 kindSchema.sourceFiles[0].load 决定：
 *   - 'map-keyed'   — Record<id, entry>（与 PHP 文件顶层 key 一一对应）
 *   - 'single'      — 直接是 entry object（如 config.runtime 的 obl_config 字典）
 *   - 'partitioned' — Record<tide, bucket>（如 distribution.scatter 的 tide 桶）
 */
export interface YamlAuthorResource {
  filePath: string;
  rootKey?: string;
  data: unknown;
}

/**
 * 逆向投影器结果——成功/失败均通过此结构返回，不抛异常。
 *
 * - success：是否成功提取数据
 * - resource：成功时填充 YamlAuthorResource
 * - diagnostics：失败诊断（解析错误、字段缺失等）
 */
export interface ReverseProjectResult {
  success: boolean;
  resource?: YamlAuthorResource;
  diagnostics: ReverseProjectDiagnostic[];
}

/**
 * 逆向投影诊断——结构化错误信息，由 migration-flow 收集后返回给 UI。
 */
export interface ReverseProjectDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * 逆向投影器函数签名——所有 21 个逆向投影器都遵循此签名。
 *
 * 实现要点：
 * - 不直接读文件——content 由 migration-flow 从磁盘读取后传入
 * - 不直接写文件——返回 YamlAuthorResource 由 migration-flow 写入
 * - 不抛异常——所有错误通过 diagnostics 返回
 */
export type ReverseProjectorFn = (options: ReverseProjectOptions) => ReverseProjectResult;
