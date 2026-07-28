/**
 * @module O 内容工具箱
 *
 * 适配器注册表——按 kindSchema.parser 字段路由到对应的 PHP / TS / YAML 适配器。
 *
 * 注册的 5 个 parser（对齐 schema/types.ts 中的 ParserName 联合类型）：
 *   - 'php-array'         — PHP 通用适配器（return [...] / return array(...)）
 *   - 'php-global-var'    — PHP 通用适配器（$var = array(...) / $var = [...]）
 *   - 'ts-locale'         — TS locale 适配器（export const XXX: Record<string, T> = {...}）
 *   - 'php-function-def'  — 标记为代码模块，不解析内部（combat_skills/skill_*.php）
 *   - 'yaml'              — P5 作者资源 YAML 适配器（oblivions/content/*.yaml）
 *
 * 'ts-terrain-desc' / 'ts-status-locale' 两个 parser 在 P3 阶段注册，P0 阶段
 * 调用 parseFile 时若遇到这两个 parser 返回空数组（未注册 = 视为代码模块）。
 *
 * P5-1 阶段 yaml 适配器注册到注册表，但 kindSchema.adapterFormat 仍留空
 * （默认走 PHP/TS fallback）——P5-4 迁移流程逐 kind 切换 adapterFormat='yaml'
 * 时，loader 才会按 authorFormat.filePath 加载 YAML 文件。
 *
 * 集成提示：main.ts 必须在 registerAllKinds() 之后调用 registerBuiltInAdapters()
 * （或直接 import 本模块副作用注册）。registerBuiltInAdapters() 内部做幂等保护，
 * 重复调用不会重复注册。
 */

import type { KindSchema, ParserName, AdapterFormat } from '../schema/types';
import type { ResourceNode } from '../graph/types';
import {
  parsePhpResource,
  serializePhpResource,
  type SerializedPhpFile,
} from './php-adapter';
import {
  parseTsLocale,
  serializeTsLocale,
  type SerializedTsFile,
} from './ts-locale-adapter';
import {
  parseYamlResource,
  serializeYamlResource,
  type SerializedYamlFile,
} from './yaml-adapter';

/**
 * 序列化后的文件形态——PHP / TS / YAML 适配器统一返回此结构。
 */
export type SerializedFile = SerializedPhpFile | SerializedTsFile | SerializedYamlFile;

/**
 * 适配器接口——每种 parser 注册一个 Adapter 实例。
 *
 * parse 与 serialize 都是纯函数，不持有状态。
 * extractedId 仅在模板路径（如 region_${id}.php）下传递，固定路径不传。
 */
export interface Adapter {
  parse(
    filePath: string,
    content: string,
    kindSchema: KindSchema,
    extractedId?: string,
  ): ResourceNode[];
  serialize(nodes: ResourceNode[], kindSchema: KindSchema): SerializedFile[];
}

// —— 内部适配器实现 ——

const phpAdapter: Adapter = {
  parse: parsePhpResource,
  serialize: serializePhpResource,
};

const tsLocaleAdapter: Adapter = {
  parse: parseTsLocale,
  serialize: serializeTsLocale,
};

/**
 * YAML 适配器——P5-1 阶段注册到注册表。
 *
 * 解析 oblivions/content/*.yaml 作者资源为 ResourceNode[]。
 * 序列化方向：把 ResourceNode[] 写回 YAML 形态（用于 P5-4 一次性迁移流程）。
 *
 * 注意：yamlAdapter 的 parse/serialize 返回类型 SerializedYamlFile 与
 * SerializedPhpFile / SerializedTsFile 结构对齐（都是 { filePath, content }），
 * 但保持独立类型以便调用方区分。
 */
const yamlAdapter: Adapter = {
  parse: parseYamlResource,
  serialize: serializeYamlResource,
};

/**
 * 代码模块适配器——不解析文件内部，parse 返回空数组。
 *
 * 用于 'php-function-def' parser（combat_skills/skill_*.php 9 个函数定义文件）。
 * 这些文件包含技能钩子函数定义，不是数据资源；P5 阶段投影器才会扫描其内部
 * 提取 skill_id 清单。
 */
const codeModuleAdapter: Adapter = {
  parse: () => [],
  serialize: () => [],
};

// —— 注册表核心 ——

const registry = new Map<ParserName, Adapter>();
let builtinRegistered = false;

/**
 * 注册一个 parser 的适配器。
 *
 * 重复注册策略：dev 模式 emit warning（不抛错，避免 HMR 触发崩溃）；
 * prod 模式静默覆盖。与 schema/registry.ts 的策略对齐。
 */
export function registerAdapter(parserName: ParserName, adapter: Adapter): void {
  const existing = registry.get(parserName);
  if (existing !== undefined && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[O-4] Duplicate adapter registration: '${parserName}'. Later overrides earlier.`,
    );
  }
  registry.set(parserName, adapter);
}

/**
 * 按文件路径路由到对应的 kind schema + 适配器，解析文件内容为 ResourceNode[]
 *
 * @param filePath 工作区相对路径
 * @param content 文件完整内容
 * @param kindSchema 资源 kind 的 schema 契约
 * @param extractedId 模板路径提取的 ID（如 region_1.php → '1'）
 * @returns ResourceNode[]；解析失败或未注册 parser 返回空数组
 */
export function parseFile(
  filePath: string,
  content: string,
  kindSchema: KindSchema,
  extractedId?: string,
): ResourceNode[] {
  const adapter = registry.get(kindSchema.parser);
  if (!adapter) {
    // 未注册的 parser（如 'ts-terrain-desc' / 'ts-status-locale' 在 P3 才注册）
    // 视为代码模块，返回空数组
    return [];
  }
  try {
    return adapter.parse(filePath, content, kindSchema, extractedId);
  } catch (err) {
    // 解析抛异常：返回空数组，loader 层会记录诊断
    // eslint-disable-next-line no-console
    console.error(
      `[O-4] parseFile threw for '${filePath}' (parser='${kindSchema.parser}'):`,
      err,
    );
    return [];
  }
}

/**
 * 按 kindSchema.serializer 路由到对应适配器的 serialize
 *
 * 路由优先级：
 *   1. kindSchema.serializer 字段（P1-B schema 已声明，如 'php-region' / 'php-tile' / 'php-config'）
 *   2. 未声明时从 sourceFiles[0].parser 推断（兼容旧 schema）
 *   3. 仍未识别时按 parser 注册表回退
 *
 * PHP 类序列化器（'php-array' / 'php-global-var' / 'php-region' / 'php-tile' / 'php-config'）
 * 统一路由到 phpAdapter——phpAdapter 内部按 kindSchema.kind 二次路由到具体 codegen。
 * 'ts-locale' 序列化器路由到 tsLocaleAdapter。
 * 'yaml' 序列化器路由到 yamlAdapter（P5-1 新增，用于 P5-4 迁移流程的逆向投影）。
 * 未识别的 serializer（如 'php-function-def' 标记的代码模块）返回空数组。
 */
export function serializeNodes(
  nodes: ResourceNode[],
  kindSchema: KindSchema,
): SerializedFile[] {
  const serializer = kindSchema.serializer ?? inferSerializerFromParser(kindSchema);

  if (serializer !== undefined) {
    // PHP 类序列化器统一路由到 phpAdapter（内部按 kindSchema.kind 二次路由）
    if (
      serializer === 'php-array' ||
      serializer === 'php-global-var' ||
      serializer === 'php-region' ||
      serializer === 'php-tile' ||
      serializer === 'php-config'
    ) {
      return phpAdapter.serialize(nodes, kindSchema);
    }
    if (serializer === 'ts-locale') {
      return tsLocaleAdapter.serialize(nodes, kindSchema);
    }
    if (serializer === 'yaml') {
      return yamlAdapter.serialize(nodes, kindSchema);
    }
    // 未识别的 serializer：返回空数组
    return [];
  }

  // 回退：未声明 serializer 且无法从 sourceFiles 推断时，按 parser 注册表路由
  const adapter = registry.get(kindSchema.parser);
  if (!adapter) return [];
  return adapter.serialize(nodes, kindSchema);
}

/**
 * 从 sourceFiles[0].parser 推断 serializer 名称（兼容未声明 serializer 的旧 schema）。
 *
 * 与 kindSchema.parser 字段对齐——P0 阶段所有 schema 的 parser 与 sourceFiles[0].parser 同步。
 */
function inferSerializerFromParser(kindSchema: KindSchema): string | undefined {
  const spec = kindSchema.sourceFiles[0];
  return spec?.parser;
}

/**
 * 注册 P0 + P5-1 阶段的 5 个内置适配器。
 *
 * 幂等：重复调用不会重复注册。
 *
 * 集成时机：main.ts 在 registerAllKinds() 之后调用本函数，确保 Resource Graph
 * 加载前所有适配器已就位。
 *
 * P5-1 阶段新增 'yaml' 适配器注册——但 kindSchema.adapterFormat 仍留空
 * （默认走 PHP/TS fallback），yaml 适配器仅在 P5-4 迁移流程切换 adapterFormat='yaml'
 * 后才被 loader 调用。注册本身不影响现有运行时行为。
 */
export function registerBuiltInAdapters(): void {
  if (builtinRegistered) return;
  registerAdapter('php-array', phpAdapter);
  registerAdapter('php-global-var', phpAdapter);
  registerAdapter('ts-locale', tsLocaleAdapter);
  registerAdapter('php-function-def', codeModuleAdapter);
  registerAdapter('yaml', yamlAdapter);
  builtinRegistered = true;
}

/**
 * 查询 kind 当前的有效读取来源标记（P5 过渡期）。
 *
 * 优先级：
 *   1. kindSchema.adapterFormat 显式声明
 *   2. 未声明时按 sourceFiles[0].format 推断：
 *      - 'php' → 'php'
 *      - 'ts'  → 'ts-locale'
 *      - 'yaml' → 'yaml'
 *   3. 仍未识别时返回 'php'（最保守的 fallback）
 *
 * loader（P5-4 迁移流程）按本函数返回值决定从哪个文件加载资源：
 *   - 'yaml'：从 oblivions/content/*.yaml 加载
 *   - 'php'：从 oblivions/gamedata/*.php 加载（过渡期 fallback）
 *   - 'ts-locale'：从 vex-vue/src/data/*-locale.ts 加载（过渡期 fallback）
 *
 * 注意：adapterFormat 标记是"读取来源"，与 parser 字段不冲突——
 * parser 描述"如何解析文件内部"，adapterFormat 描述"从哪类文件读取"。
 * 例如 presentation.item 的 parser 是 'ts-locale'（描述 TS 文件解析），
 * 但 adapterFormat 可以是 'yaml'（迁移完成后从 YAML 读取，但 parser 仍记录
 * 原 TS 解析逻辑，作为逆向投影的元数据）。
 */
export function getAdapterFormat(kindSchema: KindSchema): AdapterFormat {
  if (kindSchema.adapterFormat) return kindSchema.adapterFormat;
  const spec = kindSchema.sourceFiles[0];
  if (!spec) return 'php';
  switch (spec.format) {
    case 'yaml':
      return 'yaml';
    case 'ts':
      return 'ts-locale';
    case 'php':
    default:
      return 'php';
  }
}

/**
 * 清空注册表。仅供单元测试使用，生产代码禁止调用。
 */
export function clearAdapterRegistry(): void {
  registry.clear();
  builtinRegistered = false;
}

// 模块加载时自动注册内置适配器，避免调用方忘记调用 registerBuiltInAdapters()。
// 幂等保护由 builtinRegistered 标志位实现。
registerBuiltInAdapters();
