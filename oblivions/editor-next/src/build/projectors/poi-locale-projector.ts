/**
 * @module O 内容工具箱
 *
 * presentation.poi 投影器——把 Resource Graph 中的 presentation.poi 节点投影回
 * vex-vue/src/data/poi-locale.ts 的 TS locale 形态。
 *
 * 设计意图（执行案 §4.7.2 / §4.2.3）：
 * - 执行案要求 round-trip 一致性（加载 → 投影 → 字节对比，TS 键顺序稳定）。
 * - 不复用 ts-locale-adapter 的 serializeItemLocale / serializeRecipeLocale 模板——
 *   poi-locale.ts 有独立的文件头（@module K 状态管理层）、PoiLocaleEntry 接口、
 *   POI_LOCALE 常量、getPoiName / getPoiDesc 辅助函数。投影器各自维护文件模板
 *   以精确对齐原文件。
 * - 键顺序按节点数组顺序保留——TS 对象字面量保留 string key 顺序，原文件的
 *   手工编排顺序（基本型 → 工作台 → 任务3 浅水/深水/深渊 → F-7 → 任务4 浅水/深水）
 *   由调用方（loader / graph-store）按 source 顺序传入节点，投影器原样输出。
 * - 辅助函数（getPoiName / getPoiDesc）是固定运行时逻辑（K 状态管理层 fallback 链），
 *   不随数据变化，模板中保留。
 *
 * 反向投影字段映射：
 *   - 节点 id                          → POI_LOCALE 字面量 key（合法标识符直接输出，否则字符串字面量）
 *   - node.data.name                   → { name: '...' }
 *   - node.data.desc                   → { desc: '...' }
 *
 * 边界：
 * - 节点 data 为 null/非对象时跳过该节点（不写入常量）
 * - name / desc 缺失时输出空字符串（与 schema default 对齐）
 * - undefined 字段递归移除（与 ts-locale-adapter.stripUndefinedFields 对齐）
 * - 节点数组为空时仍生成完整文件骨架（仅常量为空对象），保证 round-trip 一致性
 * - 字符串转义：单引号字符串，`\\` → `\\\\`，`'` → `\\'`
 * - 文件末尾保留单换行
 *
 * 集成：
 * - adapter-registry.serializeNodes 路由到本投影器（当 kind='presentation.poi' 时），
 *   由 ts-locale-adapter.serializeTsLocale 的 presentation.poi case 调用
 * - BuildView 在发布前通过 serializeNodes 间接调用本投影器生成 PublishableFile
 */

import type { ResourceNode } from '../../graph/types';
import type { SerializedTsFile } from '../../adapters/ts-locale-adapter';

/** 目标文件路径（工作区相对路径） */
const POI_LOCALE_FILE_PATH = 'vex-vue/src/data/poi-locale.ts';

/** 作者资源 YAML 路径——用于 AUTO-GENERATED 注释（执行案 06-P5 §4.3.3） */
const POI_LOCALE_AUTHOR_SOURCE = 'oblivions/content/presentations/poi-locale.yaml';

/**
 * poi-locale.ts 尾部辅助函数模板——getPoiName / getPoiDesc 是 K 状态管理层
 * 的 fallback 链纯函数，不随数据变化。
 *
 * 与 vex-vue/src/data/poi-locale.ts:55-64 保持一致；如运行时契约变化
 * （K 状态管理层 fallback 链），必须同步更新此模板。
 */
const POI_LOCALE_TRAILING_CODE = `export function getPoiName(poiId: string | number | undefined, fallbackName?: string): string {
  if (poiId === undefined || poiId === null || poiId === '') return fallbackName || '';
  const key = String(poiId);
  return POI_LOCALE[key]?.name || fallbackName || key;
}

export function getPoiDesc(poiId: string | number | undefined, fallbackDesc?: string): string {
  if (poiId === undefined || poiId === null || poiId === '') return fallbackDesc || '';
  return POI_LOCALE[String(poiId)]?.desc || fallbackDesc || '';
}
`;

/**
 * 把 presentation.poi 节点投影回 poi-locale.ts 形态。
 *
 * @param nodes presentation.poi 节点数组（顺序保留为 POI_LOCALE 字面量 key 顺序）
 * @returns 单个 SerializedTsFile（filePath 指向 vex-vue/src/data/poi-locale.ts）
 */
export function projectPoiLocale(nodes: ResourceNode[]): SerializedTsFile[] {
  const entries: string[] = [];
  for (const node of nodes) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      // 非法 data 形态：跳过该节点，避免污染常量
      continue;
    }
    const cleaned = stripUndefinedFields(node.data) as { name?: string; desc?: string };
    const name = tsString(cleaned.name ?? '');
    const desc = tsString(cleaned.desc ?? '');
    entries.push(`  ${tsKey(node.id)}: { name: ${name}, desc: ${desc} },`);
  }

  const content =
    `// AUTO-GENERATED FROM ${POI_LOCALE_AUTHOR_SOURCE}\n` +
    `// DO NOT EDIT MANUALLY - modify the source YAML and recompile\n\n` +
    `/**\n` +
    ` * @module K 状态管理层\n` +
    ` */\n\n` +
    `export interface PoiLocaleEntry {\n` +
    `  name: string;\n` +
    `  desc: string;\n` +
    `}\n\n` +
    `export const POI_LOCALE: Record<string, PoiLocaleEntry> = {\n` +
    `${entries.join('\n')}\n` +
    `};\n\n` +
    POI_LOCALE_TRAILING_CODE;

  return [{ filePath: POI_LOCALE_FILE_PATH, content }];
}

// ─── codegen 工具（与 ts-locale-adapter 对齐，独立声明以保持投影器自包含） ───

/**
 * 标识符 key——若是合法标识符直接输出，否则用字符串字面量。
 *
 * 与原文件对齐：`supply_cache` 直接输出，`hunter_cache` 用字符串字面量
 * （原文件中 'hunter_cache' / 'mystic_shrine' / 'campfire_unlit' 都用了引号）。
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
 * 用于序列化时对齐原文件省略字段的契约。
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
