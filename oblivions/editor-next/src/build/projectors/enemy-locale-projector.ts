/**
 * @module O 内容工具箱
 *
 * presentation.enemy 投影器——把 Resource Graph 中的 presentation.enemy 节点投影回
 * vex-vue/src/data/enemy-locale.ts 的 TS locale 形态。
 *
 * 设计意图（执行案 §4.7.2 / §4.2.3）：
 * - 执行案要求 round-trip 一致性（加载 → 投影 → 字节对比，TS 键顺序稳定）。
 * - 不复用 ts-locale-adapter 的 serializeItemLocale 模板——enemy-locale.ts 有独立的
 *   文件头（@module K 状态管理层）、EnemyLocaleEntry 接口、ENEMY_LOCALE 常量、
 *   getEnemyName / getEnemyDesc 辅助函数。投影器各自维护文件模板以精确对齐原文件。
 * - 键顺序按节点数组顺序保留——TS 对象字面量保留 string key 顺序，原文件的
 *   手工编排顺序（浅水区敌人 → 深水区敌人）由调用方（loader / graph-store）按
 *   source 顺序传入节点，投影器原样输出。
 * - 辅助函数（getEnemyName / getEnemyDesc）是固定运行时逻辑（K 状态管理层 fallback 链），
 *   不随数据变化，模板中保留。
 *
 * 反向投影字段映射：
 *   - 节点 id                          → ENEMY_LOCALE 字面量 key（数字字符串用字符串字面量）
 *   - node.data.name                   → { name: '...' }
 *   - node.data.desc                   → { desc: '...' }（缺失时省略，与原文件对齐）
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
 * - adapter-registry.serializeNodes 路由到本投影器（当 kind='presentation.enemy' 时），
 *   由 ts-locale-adapter.serializeTsLocale 的 presentation.enemy case 调用
 * - BuildView 在发布前通过 serializeNodes 间接调用本投影器生成 PublishableFile
 */

import type { ResourceNode } from '../../graph/types';
import type { SerializedTsFile } from '../../adapters/ts-locale-adapter';

/** 目标文件路径（工作区相对路径） */
const ENEMY_LOCALE_FILE_PATH = 'vex-vue/src/data/enemy-locale.ts';

/** 作者资源 YAML 路径——用于 AUTO-GENERATED 注释（执行案 06-P5 §4.3.3） */
const ENEMY_LOCALE_AUTHOR_SOURCE = 'oblivions/content/presentations/enemy-locale.yaml';

/**
 * enemy-locale.ts 尾部辅助函数模板——getEnemyName / getEnemyDesc 是 K 状态管理层
 * 的 fallback 链纯函数，不随数据变化。
 *
 * 与 vex-vue/src/data/enemy-locale.ts:17-25 保持一致；如运行时契约变化
 * （K 状态管理层 fallback 链），必须同步更新此模板。
 */
const ENEMY_LOCALE_TRAILING_CODE = `export function getEnemyName(enemyType: string | number, fallback?: string): string {
  const key = String(enemyType);
  return ENEMY_LOCALE[key]?.name ?? fallback ?? \`enemy_\${key}\`;
}

export function getEnemyDesc(enemyType: string | number, fallback?: string): string {
  const key = String(enemyType);
  return ENEMY_LOCALE[key]?.desc ?? fallback ?? '';
}
`;

/**
 * 把 presentation.enemy 节点投影回 enemy-locale.ts 形态。
 *
 * @param nodes presentation.enemy 节点数组（顺序保留为 ENEMY_LOCALE 字面量 key 顺序）
 * @returns 单个 SerializedTsFile（filePath 指向 vex-vue/src/data/enemy-locale.ts）
 */
export function projectEnemyLocale(nodes: ResourceNode[]): SerializedTsFile[] {
  const entries: string[] = [];
  for (const node of nodes) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      // 非法 data 形态：跳过该节点，避免污染常量
      continue;
    }
    const cleaned = stripUndefinedFields(node.data) as { name?: string; desc?: string };
    const name = tsString(cleaned.name ?? '');
    const desc = tsString(cleaned.desc ?? '');
    // enemy.template.id 是数字字符串（如 '1'），TS 对象字面量中数字字符串 key
    // 必须用字符串字面量（不能用裸标识符），用 tsString 强制加引号
    entries.push(`  ${tsString(node.id)}: { name: ${name}, desc: ${desc} },`);
  }

  const content =
    `// AUTO-GENERATED FROM ${ENEMY_LOCALE_AUTHOR_SOURCE}\n` +
    `// DO NOT EDIT MANUALLY - modify the source YAML and recompile\n\n` +
    `/**\n` +
    ` * @module K 状态管理层\n` +
    ` */\n\n` +
    `export interface EnemyLocaleEntry {\n` +
    `  name: string;\n` +
    `  desc?: string;\n` +
    `}\n\n` +
    `export const ENEMY_LOCALE: Record<string, EnemyLocaleEntry> = {\n` +
    `${entries.join('\n')}\n` +
    `};\n\n` +
    ENEMY_LOCALE_TRAILING_CODE;

  return [{ filePath: ENEMY_LOCALE_FILE_PATH, content }];
}

// ─── codegen 工具（与 ts-locale-adapter 对齐，独立声明以保持投影器自包含） ───

/**
 * 单引号字符串字面量——转义 `\\` 与 `'`。
 *
 * enemy-locale.ts 的 key 是数字字符串（如 '1'），必须用字符串字面量输出。
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
