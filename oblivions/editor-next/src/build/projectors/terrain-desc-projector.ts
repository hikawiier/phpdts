/**
 * @module O 内容工具箱
 *
 * presentation.terrain 投影器——把 Resource Graph 中的 presentation.terrain 节点投影回
 * vex-vue/src/data/terrain-desc.ts 的 TS locale 形态。
 *
 * 设计意图（执行案 06-P5 §4.3.4）：
 * - terrain-desc.ts 与其他 locale 结构不同（嵌套词库 vs 扁平 name/desc），需要独立投影器。
 * - 文件头注入 `// AUTO-GENERATED FROM ...` 只读保护注释（执行案 §4.8.2）。
 * - 生成内容包含：
 *   * FloorType / TideType 类型别名
 *   * FloorConfig / TerrainDescConfig 接口
 *   * TERRAIN_DESC 常量（嵌套词库结构）
 *   * pickRandom / generateTerrainDesc 辅助函数（固定运行时逻辑）
 * - 单一节点（id='terrain_desc'），data 含 floor / tide / impassable_suffix / templates 四字段。
 *
 * 反向投影字段映射：
 *   - node.data.floor              → TERRAIN_DESC.floor（Record<FloorType, FloorConfig>）
 *   - node.data.tide               → TERRAIN_DESC.tide（Record<TideType, string[]>）
 *   - node.data.impassable_suffix  → TERRAIN_DESC.impassable_suffix（string[]）
 *   - node.data.templates          → TERRAIN_DESC.templates（{ default: string[]; no_tide: string[] }）
 *
 * 边界：
 * - 节点 data 为 null/非对象时输出空骨架
 * - undefined 字段递归移除（与 ts-locale-adapter.stripUndefinedFields 对齐）
 * - 字符串转义：单引号字符串，`\\` → `\\\\`，`'` → `\\'`
 * - 文件末尾保留单换行
 *
 * 集成：
 * - ts-locale-adapter.serializeTsLocale 路由到本投影器（当 kind='presentation.terrain' 时）
 * - BuildView 在发布前通过 serializeNodes 间接调用本投影器生成 PublishableFile
 */

import type { ResourceNode } from '../../graph/types';
import type { SerializedTsFile } from '../../adapters/ts-locale-adapter';

/** 目标文件路径（工作区相对路径） */
const TERRAIN_DESC_FILE_PATH = 'vex-vue/src/data/terrain-desc.ts';

/** 作者资源 YAML 路径——用于 AUTO-GENERATED 注释 */
const TERRAIN_DESC_AUTHOR_SOURCE = 'oblivions/content/presentations/terrain-desc.yaml';

/**
 * terrain-desc.ts 尾部辅助函数模板——pickRandom / generateTerrainDesc 是固定运行时
 * 逻辑（K 状态管理层地形描述生成），不随数据变化。
 *
 * 与 vex-vue/src/data/terrain-desc.ts:92-137 保持一致；如运行时契约变化，必须同步更新此模板。
 */
const TERRAIN_DESC_TRAILING_CODE = `/** 从数组中随机取一个元素 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成无名地块的随机描述
 *
 * @param floor    地面类型（standard/metal/water/vegetation）
 * @param tide     潮汐类型（shallow/deep/abyss）
 * @param passable 是否可通行
 * @returns 描述文本
 */
export function generateTerrainDesc(
  floor: string,
  tide: string,
  passable: boolean,
): string {
  const floorCfg =
    TERRAIN_DESC.floor[floor as FloorType] || TERRAIN_DESC.floor.standard;
  const floorName = pickRandom(floorCfg.name);
  const floorAdj = pickRandom(floorCfg.adj);

  const tidePool = TERRAIN_DESC.tide[tide as TideType] || [''];
  const tideAdj = pickRandom(tidePool);

  let text: string;
  if (tideAdj) {
    const tpl = pickRandom(TERRAIN_DESC.templates.default);
    text = tpl
      .replace('{tide_adj}', tideAdj)
      .replace('{floor_adj}', floorAdj)
      .replace('{floor_name}', floorName);
  } else {
    const tpl = pickRandom(TERRAIN_DESC.templates.no_tide);
    text = tpl
      .replace('{floor_adj}', floorAdj)
      .replace('{floor_name}', floorName);
  }

  if (!passable) {
    text += pickRandom(TERRAIN_DESC.impassable_suffix);
  }

  return text;
}
`;

/**
 * 把 presentation.terrain 节点投影回 terrain-desc.ts 形态。
 *
 * @param nodes presentation.terrain 节点数组（期望单个节点，id='terrain_desc'）
 * @returns 单个 SerializedTsFile（filePath 指向 vex-vue/src/data/terrain-desc.ts）
 */
export function projectTerrainDesc(nodes: ResourceNode[]): SerializedTsFile[] {
  const terrainData = extractTerrainData(nodes);

  const content =
    `// AUTO-GENERATED FROM ${TERRAIN_DESC_AUTHOR_SOURCE}\n` +
    `// DO NOT EDIT MANUALLY - modify the source YAML and recompile\n\n` +
    `/**\n` +
    ` * @module K 状态管理层\n` +
    ` */\n\n` +
    `/** 地面类型 */\n` +
    `export type FloorType = 'standard' | 'metal' | 'water' | 'vegetation';\n\n` +
    `/** 潮汐/深度类型 */\n` +
    `export type TideType = 'shallow' | 'deep' | 'abyss';\n\n` +
    `/** 地面类型词库配置 */\n` +
    `export interface FloorConfig {\n` +
    `  /** 地形名称候选（名词） */\n` +
    `  name: string[];\n` +
    `  /** 形容词修饰候选 */\n` +
    `  adj: string[];\n` +
    `}\n\n` +
    `/** 完整的地形描述词库 */\n` +
    `export interface TerrainDescConfig {\n` +
    `  floor: Record<FloorType, FloorConfig>;\n` +
    `  tide: Record<TideType, string[]>;\n` +
    `  impassable_suffix: string[];\n` +
    `  templates: {\n` +
    `    default: string[];\n` +
    `    no_tide: string[];\n` +
    `  };\n` +
    `}\n\n` +
    `/** 地形描述词库（与现有 vex/data/terrain-desc.js 一致） */\n` +
    `export const TERRAIN_DESC: TerrainDescConfig = ${renderTerrainValue(terrainData, 0)};\n\n` +
    TERRAIN_DESC_TRAILING_CODE;

  return [{ filePath: TERRAIN_DESC_FILE_PATH, content }];
}

/**
 * 从节点数组提取 terrain 数据。
 *
 * 单一节点（id='terrain_desc'）的 data 含 floor / tide / impassable_suffix / templates 四字段。
 * 若节点 data 为 null/非对象，返回空对象。
 */
function extractTerrainData(nodes: ResourceNode[]): unknown {
  for (const node of nodes) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      continue;
    }
    return stripUndefinedFields(node.data);
  }
  return {};
}

// ─── codegen 工具（TS 字面量渲染，与 ts-locale-adapter 对齐） ───

/**
 * 渲染 TS 值为字面量字符串——递归处理对象 / 数组 / 基础类型。
 *
 * @param value TS 值
 * @param indent 缩进层级（0 = 顶层）
 * @returns TS 字面量字符串（如 `{ key: 'value' }` / `['a', 'b']` / `'string'`）
 */
function renderTerrainValue(value: unknown, indent: number): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return tsString(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = '  '.repeat(indent + 1);
    const closePad = '  '.repeat(indent);
    const items = value.map((item) => `${pad}${renderTerrainValue(item, indent + 1)}`);
    return `[\n${items.join(',\n')}\n${closePad}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    const pad = '  '.repeat(indent + 1);
    const closePad = '  '.repeat(indent);
    const items = keys.map((k) => `${pad}${tsKey(k)}: ${renderTerrainValue(obj[k], indent + 1)}`);
    return `{\n${items.join(',\n')}\n${closePad}}`;
  }

  return 'null';
}

/**
 * 标识符 key——若是合法标识符直接输出，否则用字符串字面量。
 */
function tsKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : tsString(key);
}

/**
 * 单引号字符串字面量——转义 `\\` 与 `'`。
 */
function tsString(str: string): string {
  const escaped = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * 递归移除 undefined 字段（与 php-adapter.stripUndefinedFields / ts-locale-adapter
 * stripUndefinedFields 行为一致）。
 *
 * 保留所有显式值（含 false / 0 / '' / null），仅移除 undefined。
 */
function stripUndefinedFields(value: unknown): unknown {
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
