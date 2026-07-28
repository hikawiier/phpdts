/**
 * @module O 内容工具箱
 *
 * YAML 适配器——把 oblivions/content/*.yaml 作者资源解析为 ResourceNode[]。
 *
 * P5-1 阶段实现最小化基础设施（parseYaml / serializeYaml + YamlDiagnostic），
 * 为 P5-2 投影器、P5-4 一次性迁移流程提供 YAML 读写能力。
 *
 * 设计意图：
 *   - 与 php-adapter / ts-locale-adapter 共用 Adapter 接口，由 adapter-registry
 *     按 kindSchema.parser='yaml' 路由
 *   - 解析时按 kindSchema.authorFormat.rootKey 定位作者资源顶层 key，
 *     按 itemKey 标识每个 entry——schema 集中声明路径，adapter 不硬编码
 *   - 序列化时按相同 authorFormat 重建 YAML 结构，保证 round-trip 一致性
 *
 * 依赖 `yaml` npm 包（v2.x）——比 js-yaml 更完整的 AST 与注释保留能力，
 * P5-4 迁移流程可基于 parseDocument 保留原文件注释与字段顺序。
 *
 * 当前阶段已注册到 registerBuiltInAdapters()——P5-1 提供能力，
 * 但 kindSchema.adapterFormat 仍留空（默认走 PHP/TS fallback），
 * P5-4 迁移流程逐 kind 切换 adapterFormat='yaml' 时 loader 才调用本适配器。
 */

import { parse, stringify, type YAMLParseError } from 'yaml';
import type { KindSchema, SourceFileSpec } from '../schema/types';
import type { ResourceNode } from '../graph/types';
import type { SourceAnchor } from '../graph/edge';

/**
 * 序列化后的 YAML 文件形态——与 SerializedPhpFile / SerializedTsFile 对齐。
 */
export interface SerializedYamlFile {
  filePath: string;
  content: string;
}

/**
 * YAML 解析/序列化诊断——结构化错误信息，供 O-10 第 7 层编译校验消费。
 *
 * severity 二档（对齐 validate.ts 决策）：
 *   - 'error'：阻断编译（YAML 语法错误、rootKey 缺失等）
 *   - 'warning'：不阻断但提示（字段类型不匹配等）
 */
export interface YamlDiagnostic {
  /** 工作区相对路径 */
  filePath: string;
  /** 1-based 行号（解析错误时来自 YAMLParseError；其他场景为 0） */
  line: number;
  /** 1-based 列号（解析错误时来自 YAMLParseError；其他场景为 0） */
  column: number;
  /** 诊断消息（中文） */
  message: string;
  /** 严重级别 */
  severity: 'error' | 'warning';
  /** 诊断码（如 'yaml_syntax_error' / 'root_key_missing' / 'item_key_missing'） */
  code: string;
}

/**
 * YAML 值类型——递归联合，与 PhpValue / TsValue 对齐。
 */
type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

/**
 * 解析 YAML 文件内容为 ResourceNode[]
 *
 * 解析流程：
 *   1. 用 `yaml` 包 parse YAML 字符串为 JS 对象
 *   2. 按 kindSchema.authorFormat.rootKey 提取作者资源顶层 key 的值
 *   3. 按 kindSchema.sourceFiles[0].load 切分为 ResourceNode[]
 *
 * 三种 load 模式（与 php-adapter 对齐）：
 *   - 'single'      — 整 rootKey 值作为单个 ResourceNode，id 用 singleNodeId
 *   - 'map-keyed'   — rootKey 值是 Map<id, entry>，每个 key 一个 ResourceNode
 *   - 'partitioned' — rootKey 值按顶层 key 分桶（如 tide 桶），每个桶一个 ResourceNode
 *
 * @param filePath 工作区相对路径（如 'oblivions/content/items/items.yaml'）
 * @param content YAML 文件完整内容
 * @param kindSchema 资源 kind 的 schema 契约（必须含 authorFormat）
 * @param extractedId 模板路径提取的 ID（如 region_0.yaml → '0'）；固定路径不传
 * @returns ResourceNode[]；解析失败或 authorFormat 缺失时返回空数组
 */
export function parseYamlResource(
  filePath: string,
  content: string,
  kindSchema: KindSchema,
  extractedId?: string,
): ResourceNode[] {
  const authorFormat = kindSchema.authorFormat;
  if (!authorFormat) {
    // 无 authorFormat 的 kind（如 effect.func）不走 YAML 路径
    return [];
  }

  const spec = kindSchema.sourceFiles[0];
  if (!spec) return [];

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err) {
    // YAML 语法错误——YAMLParseError 含 line/pos/message
    const e = err as YAMLParseError;
    const diag: YamlDiagnostic = {
      filePath,
      line: e.linePos ? e.linePos[0].line : 0,
      column: e.linePos ? e.linePos[0].col : 0,
      message: `YAML 语法错误：${e.message}`,
      severity: 'error',
      code: 'yaml_syntax_error',
    };
    // P5-1 阶段：诊断通过 console.error 暂存，P5-2 接入 debugBus
    // eslint-disable-next-line no-console
    console.error('[O-4] yaml-adapter parse error:', diag);
    return [];
  }

  if (parsed === null || parsed === undefined) {
    // 空 YAML 文件（如 P5-1 占位文件只有注释）——返回空数组，不算错误
    return [];
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    // 顶层不是对象（如纯字符串/数字）——返回空数组
    return [];
  }

  // 提取 rootKey 对应的值
  const rootObj = parsed as Record<string, YamlValue>;
  const rootValue: YamlValue | undefined = authorFormat.rootKey
    ? rootObj[authorFormat.rootKey]
    : (parsed as YamlValue);

  if (rootValue === undefined || rootValue === null) {
    // rootKey 缺失——可能是占位文件还未填充数据，返回空数组
    return [];
  }

  const sourceAnchor: SourceAnchor = {
    filePath,
    lineStart: 0,
    lineEnd: 0,
    format: 'yaml',
  };

  return splitByLoad(rootValue, spec, kindSchema, sourceAnchor, extractedId);
}

/**
 * 按 kindSchema.sourceFiles[0].load 切分 YamlValue 为 ResourceNode[]
 *
 * 与 php-adapter 的 splitByLoad 行为对齐——保证 P5-4 切换 adapterFormat 后，
 * 同一 kind 的节点 ID 与 data 形态在 PHP / YAML 来源下一致。
 */
function splitByLoad(
  value: YamlValue,
  spec: SourceFileSpec,
  kindSchema: KindSchema,
  source: SourceAnchor,
  extractedId: string | undefined,
): ResourceNode[] {
  switch (spec.load) {
    case 'single': {
      const id = spec.singleNodeId ?? 'default';
      // 若 schema.fields 只有一个 kv-list 字段，则把 YAML 字典包装到该字段下
      // （与 php-adapter config.runtime 处理对齐）
      const singleField = kindSchema.fields.length === 1 ? kindSchema.fields[0] : undefined;
      const shouldWrap =
        singleField !== undefined && singleField.type === 'kv-list';
      const data = shouldWrap ? { [singleField!.key]: value } : value;
      return [
        {
          kind: kindSchema.kind,
          id,
          data,
          source: [source],
          revision: '',
        },
      ];
    }

    case 'map-keyed': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const obj = value as Record<string, YamlValue>;
      const nodes: ResourceNode[] = [];
      for (const [key, val] of Object.entries(obj)) {
        // 模板路径（如 region_${id}.yaml）下，extractedId 是 pgroup，
        // 文件内每个 pls 是区域内局部索引。用 `${extractedId}:${key}` 作为
        // 全局唯一 ID（与 world.tile idPattern /^\d+:\d+$/ 对齐）
        const id = extractedId !== undefined ? `${extractedId}:${key}` : key;
        nodes.push({
          kind: kindSchema.kind,
          id,
          data: val,
          source: [source],
          revision: '',
        });
      }
      return nodes;
    }

    case 'partitioned': {
      // partitioned 模式（如 distribution.* 走 tide 桶切分）——
      // P5-1 阶段最小化实现：每个顶层 key 一个 ResourceNode，id=tide。
      // P5-2 投影器实现时，distribution.* 需要复用 php-adapter 的
      // projectDistributionPoi / projectDistributionEnemy / projectDistributionScatter
      // 统一模型投影逻辑（迁移到独立模块，PHP/YAML 共用）。
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const obj = value as Record<string, YamlValue>;
      const nodes: ResourceNode[] = [];
      for (const [tide, val] of Object.entries(obj)) {
        nodes.push({
          kind: kindSchema.kind,
          id: tide,
          data: val,
          source: [source],
          revision: '',
        });
      }
      return nodes;
    }

    default:
      return [];
  }
}

/**
 * 把 ResourceNode[] 序列化为 YAML 文件内容
 *
 * 序列化流程：
 *   1. 按 kindSchema.authorFormat.rootKey 构建 YAML 顶层结构
 *   2. 按 itemKey 把每个节点组装为 entry（map-keyed 模式下 key 即 ID）
 *   3. 用 `yaml` 包 stringify 输出
 *
 * @param nodes 同一 kind 的资源节点列表
 * @param kindSchema 资源 kind 的 schema 契约（必须含 authorFormat）
 * @returns SerializedYamlFile[]；authorFormat 缺失时返回空数组
 */
export function serializeYamlResource(
  nodes: ResourceNode[],
  kindSchema: KindSchema,
): SerializedYamlFile[] {
  const authorFormat = kindSchema.authorFormat;
  if (!authorFormat) {
    return [];
  }

  const spec = kindSchema.sourceFiles[0];
  if (!spec) return [];

  // 按 load 模式组装 rootValue
  let rootValue: YamlValue;
  if (spec.load === 'single') {
    // single 模式：节点 data 直接作为 rootKey 的值
    // 若 data 是 { [singleField.key]: {...} } 包装形态，则解包
    const singleField = kindSchema.fields.length === 1 ? kindSchema.fields[0] : undefined;
    const shouldUnwrap =
      singleField !== undefined && singleField.type === 'kv-list';
    const nodeData = nodes[0]?.data;
    if (shouldUnwrap && nodeData && typeof nodeData === 'object' && !Array.isArray(nodeData)) {
      const wrapped = nodeData as Record<string, YamlValue>;
      rootValue = wrapped[singleField!.key] ?? {};
    } else {
      rootValue = (nodeData ?? {}) as YamlValue;
    }
  } else {
    // map-keyed / partitioned 模式：构建 Map<id, entry>
    const obj: Record<string, YamlValue> = {};
    for (const node of nodes) {
      obj[node.id] = node.data as YamlValue;
    }
    rootValue = obj;
  }

  // 包装到 rootKey 下（若声明）
  const topObj: Record<string, YamlValue> = authorFormat.rootKey
    ? { [authorFormat.rootKey]: rootValue }
    : (rootValue as Record<string, YamlValue>);

  // stringify 选项：
  //   - 默认缩进 2 空格（YAML 社区惯例）
  //   - 不使用 block 样式强制——yaml 包按值类型自动选择 flow/block
  //   - lineWidth: 0 表示不换行长字符串（避免中文文案被切断）
  const content = stringify(topObj, {
    indent: 2,
    lineWidth: 0,
  });

  return [
    {
      filePath: authorFormat.filePath,
      content,
    },
  ];
}
