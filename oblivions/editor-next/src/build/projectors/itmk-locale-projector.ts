/**
 * @module O 内容工具箱
 *
 * presentation.itmk 投影器——把 Resource Graph 中的 presentation.itmk 节点投影回
 * vex-vue/src/data/itmk-locale.ts 的 TS locale 形态。
 *
 * 设计意图（执行案 06-P5 §4.3.3）：
 * - P5-2 投影器接管原 ts-locale-adapter 的职责，独立维护文件模板。
 * - 文件头注入 `// AUTO-GENERATED FROM ...` 只读保护注释（执行案 §4.8.2）。
 * - 简单形态：`export const ITMK_LOCALE: Record<string, string> = {...}`（key→中文名扁平映射）。
 * - 辅助函数 getItmkName 是固定运行时逻辑，不随数据变化，模板中保留。
 * - 每个 key 是 itmk 代码（如 'WP' / 'WK'），value 是中文名。
 *
 * 反向投影字段映射：
 *   - 节点 id                          → ITMK_LOCALE 字面量 key（2 字母大写代码，必须用字符串字面量）
 *   - node.data.name                   → 字符串值（中文名）
 *
 * 边界：
 * - 节点 data 为 null/非对象时跳过该节点
 * - name 缺失时输出空字符串
 * - 节点数组为空时仍生成完整文件骨架
 * - 文件末尾保留单换行
 *
 * 集成：
 * - ts-locale-adapter.serializeTsLocale 路由到本投影器（当 kind='presentation.itmk' 时）
 * - BuildView 在发布前通过 serializeNodes 间接调用本投影器生成 PublishableFile
 */

import type { ResourceNode } from '../../graph/types';
import type { SerializedTsFile } from '../../adapters/ts-locale-adapter';

/** 目标文件路径（工作区相对路径） */
const ITMK_LOCALE_FILE_PATH = 'vex-vue/src/data/itmk-locale.ts';

/** 作者资源 YAML 路径——用于 AUTO-GENERATED 注释 */
const ITMK_LOCALE_AUTHOR_SOURCE = 'oblivions/content/presentations/itmk-locale.yaml';

/**
 * itmk-locale.ts 尾部辅助函数模板——getItmkName 是 K 状态管理层的 fallback 链纯函数。
 *
 * 与 vex-vue/src/data/itmk-locale.ts:40-43 保持一致；如运行时契约变化，必须同步更新此模板。
 */
const ITMK_LOCALE_TRAILING_CODE = `/**
 * 获取 itmk 对应的中文类别名
 * @param itmk 道具类别代码（如 'HH'、'WK'）
 * @returns 中文类别名，未知代码原样返回，空值返回空字符串
 */
export function getItmkName(itmk: string | undefined | null): string {
  if (!itmk) return '';
  return ITMK_LOCALE[itmk] ?? itmk;
}
`;

/**
 * 把 presentation.itmk 节点投影回 itmk-locale.ts 形态。
 *
 * @param nodes presentation.itmk 节点数组（顺序保留为 ITMK_LOCALE 字面量 key 顺序）
 * @returns 单个 SerializedTsFile（filePath 指向 vex-vue/src/data/itmk-locale.ts）
 */
export function projectItmkLocale(nodes: ResourceNode[]): SerializedTsFile[] {
  const entries: string[] = [];
  for (const node of nodes) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      continue;
    }
    const cleaned = stripUndefinedFields(node.data) as { name?: string };
    const name = tsString(cleaned.name ?? '');
    // itmk 代码是 2 字母大写（如 'WP'），不是合法标识符，必须用字符串字面量
    entries.push(`  ${tsString(node.id)}: ${name},`);
  }

  const content =
    `// AUTO-GENERATED FROM ${ITMK_LOCALE_AUTHOR_SOURCE}\n` +
    `// DO NOT EDIT MANUALLY - modify the source YAML and recompile\n\n` +
    `/**\n` +
    ` * @module K 状态管理层\n` +
    ` */\n\n` +
    `export const ITMK_LOCALE: Record<string, string> = {\n` +
    `${entries.join('\n')}\n` +
    `};\n\n` +
    ITMK_LOCALE_TRAILING_CODE;

  return [{ filePath: ITMK_LOCALE_FILE_PATH, content }];
}

// ─── codegen 工具（与 ts-locale-adapter 对齐，独立声明以保持投影器自包含） ───

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
