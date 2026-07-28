/**
 * @module O 内容工具箱
 *
 * presentation.status 投影器——把 Resource Graph 中的 presentation.status 节点投影回
 * vex-vue/src/data/status-locale.ts 的 TS locale 形态。
 *
 * 设计意图（执行案 06-P5 §4.3.3）：
 * - P5-2 投影器接管原 ts-locale-adapter 的职责，独立维护文件模板。
 * - 文件头注入 `// AUTO-GENERATED FROM ...` 只读保护注释（执行案 §4.8.2）。
 * - 标准形态 + description 字段：`StatusLocaleEntry { name; description }`。
 * - 辅助函数 getStatusLocale / getCapabilityLabel / getStatusDisplayName 是固定运行时逻辑。
 * - status-locale.ts 还导出 CAPABILITY_LABELS（ActorCapability→中文标签），属于与 status
 *   强耦合的辅助静态数据——投影器按 schema.auxiliaryData 重建该常量，避免硬编码。
 * - 注意：原文件 STATUS_LOCALE 与 CAPABILITY_LABELS 未导出（const 而非 export const），
 *   投影器保留此行为以维持运行时契约不变。
 *
 * 反向投影字段映射：
 *   - 节点 id                          → STATUS_LOCALE 字面量 key（status ID，如 'flustered'）
 *   - node.data.name                   → { name: '...' }
 *   - node.data.description            → { description: '...' }
 *
 * 边界：
 * - 节点 data 为 null/非对象时跳过该节点
 * - name / description 缺失时输出空字符串
 * - 节点数组为空时仍生成完整文件骨架
 * - 文件末尾保留单换行
 *
 * 集成：
 * - ts-locale-adapter.serializeTsLocale 路由到本投影器（当 kind='presentation.status' 时）
 * - BuildView 在发布前通过 serializeNodes 间接调用本投影器生成 PublishableFile
 */

import type { KindSchema } from '../../schema/types';
import type { ResourceNode } from '../../graph/types';
import type { SerializedTsFile } from '../../adapters/ts-locale-adapter';

/** 目标文件路径（工作区相对路径） */
const STATUS_LOCALE_FILE_PATH = 'vex-vue/src/data/status-locale.ts';

/** 作者资源 YAML 路径——用于 AUTO-GENERATED 注释 */
const STATUS_LOCALE_AUTHOR_SOURCE = 'oblivions/content/presentations/status-locale.yaml';

/**
 * status-locale.ts 尾部辅助函数模板——getStatusLocale / getCapabilityLabel /
 * getStatusDisplayName 是 K 状态管理层的 fallback 链纯函数。
 *
 * 与 vex-vue/src/data/status-locale.ts:29-41 保持一致；如运行时契约变化，必须同步更新此模板。
 */
const STATUS_LOCALE_TRAILING_CODE = `export function getStatusLocale(statusId: string): StatusLocaleEntry {
  return STATUS_LOCALE[statusId] ?? { name: statusId, description: '当前受到持续状态影响。' };
}

export function getCapabilityLabel(capability: ActorCapability): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

export function getStatusDisplayName(status: ActorStatusProjection): string {
  const name = getStatusLocale(status.status_id).name;
  if (status.phase === 'pending') return \`\${name}·待生效\`;
  return status.remaining_ticks === null ? name : \`\${name} \${status.remaining_ticks}T\`;
}
`;

/**
 * 默认 CAPABILITY_LABELS 数据——与 vex-vue/src/data/status-locale.ts:19-27 对齐。
 *
 * 若 schema.auxiliaryData.capabilityLabels 存在，则用 schema 数据覆盖。
 */
const DEFAULT_CAPABILITY_LABELS: Record<string, string> = {
  world_ai: '行动',
  voluntary_move: '移动',
  enter_combat: '发起战斗',
  participate_combat: '参与战斗',
  combat_action: '执行战斗行动',
  free_mutation: '进行即时操作',
  time_pass: '推进时间',
};

/**
 * 把 presentation.status 节点投影回 status-locale.ts 形态。
 *
 * @param nodes presentation.status 节点数组（顺序保留为 STATUS_LOCALE 字面量 key 顺序）
 * @param kindSchema 资源 kind 的 schema 契约（用于读取 auxiliaryData.capabilityLabels）
 * @returns 单个 SerializedTsFile（filePath 指向 vex-vue/src/data/status-locale.ts）
 */
export function projectStatusLocale(
  nodes: ResourceNode[],
  kindSchema: KindSchema,
): SerializedTsFile[] {
  const entries: string[] = [];
  for (const node of nodes) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      continue;
    }
    const cleaned = stripUndefinedFields(node.data) as {
      name?: string;
      description?: string;
    };
    const name = tsString(cleaned.name ?? '');
    const description = tsString(cleaned.description ?? '');
    // status-locale.ts 原文件用多行格式（每个 entry 占 3 行），投影器对齐此风格
    entries.push(
      `  ${tsKey(node.id)}: {\n    name: ${name},\n    description: ${description},\n  },`,
    );
  }

  // 从 schema.auxiliaryData 读取 capabilityLabels——避免在投影器硬编码业务数据
  const capabilityLabels =
    (kindSchema.auxiliaryData?.capabilityLabels as Record<string, string> | undefined) ??
    DEFAULT_CAPABILITY_LABELS;

  const capabilityEntries = Object.entries(capabilityLabels).map(
    ([key, label]) => `  ${tsKey(key)}: ${tsString(label)},`,
  );

  const content =
    `// AUTO-GENERATED FROM ${STATUS_LOCALE_AUTHOR_SOURCE}\n` +
    `// DO NOT EDIT MANUALLY - modify the source YAML and recompile\n\n` +
    `/**\n` +
    ` * @module K 状态管理层\n` +
    ` */\n\n` +
    `import type { ActorCapability, ActorStatusProjection } from '@/types/api';\n\n` +
    `export interface StatusLocaleEntry {\n` +
    `  name: string;\n` +
    `  description: string;\n` +
    `}\n\n` +
    `const STATUS_LOCALE: Record<string, StatusLocaleEntry> = {\n` +
    `${entries.join('\n')}\n` +
    `};\n\n` +
    `const CAPABILITY_LABELS: Record<ActorCapability, string> = {\n` +
    `${capabilityEntries.join('\n')}\n` +
    `};\n\n` +
    STATUS_LOCALE_TRAILING_CODE;

  return [{ filePath: STATUS_LOCALE_FILE_PATH, content }];
}

// ─── codegen 工具（与 ts-locale-adapter 对齐，独立声明以保持投影器自包含） ───

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
