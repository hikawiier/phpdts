/**
 * @module O 内容工具箱
 * @framework O-8 分布工作区
 *
 * DistributionRule 统一模型类型与投影器（执行案 §4.5.1 / §4.2.2 / 设计案 §3.3）。
 *
 * 设计意图：
 *   - distribution.poi 节点的 schema 字段 key 是带点字符串（'subject.poi_id' /
 *     'selector.tides' / 'placement.count' 等），适配器按 schema 字段 key 直接存储。
 *   - 编辑视图需要扁平化嵌套对象访问（rule.subject.poiId / rule.selector.tides 等）
 *     便于 Vue 响应式 :value 绑定与 schema-driven 渲染。
 *   - DistributionRule 是"编辑视图模型"——读时从 ResourceNode.data 投影为 DistributionRule，
 *     写时从 DistributionRule 投影回 ResourceNode.data，由 RuleTablePanel 双向调用。
 *
 * 字段映射（ResourceNode.data 带点 key ↔ DistributionRule 嵌套字段）：
 *   - data['subject.poi_id']             ↔ rule.subject.poiId
 *   - data['selector.tides']             ↔ rule.selector.tides
 *   - data['selector.regions']           ↔ rule.selector.regions
 *   - data['selector.excludeEntrance']   ↔ rule.selector.excludeEntrance
 *   - data['selector.excludeExit']       ↔ rule.selector.excludeExit
 *   - data['placement.count']            ↔ rule.placement.count
 *
 * id 格式：`${tide}:${poi_id}`，由 tide + poi_id 自动拼接，不可手编。
 * 选择某 poi_id 与 tide 后，RuleTablePanel 调用 buildRuleId() 计算 id。
 *
 * 当前运行时契约（与 schema distribution-poi.ts 一致）：
 *   - phase 固定为 'game_init'（POI 仅开局放置，无 day_refresh）
 *   - placement.mode 固定为 'per_region_count'（每区域生成 N 个）
 *   - selector.tides 每条规则只有一个值（多 tide 投影回 poi_pool.php 时构建失败）
 *   - selector.regions 留空=所有区域（运行时不支持 per-region 过滤）
 */

import type { ResourceNode } from '@/graph/types';

// ─── DistributionRule 统一模型 ──────────────────────────────────

/**
 * DistributionRule 编辑视图模型。
 *
 * 与 schema 中带点 key 的 ResourceNode.data 互为投影。
 * phase / placement.mode 是固定值，不放入编辑模型（投影时由投影器隐式应用）。
 */
export interface DistributionRule {
  /** 规则 ID = `${tide}:${poi_id}`，由 buildRuleId 拼接，不可手编 */
  id: string;
  /** 主体——POI 模板引用 */
  subject: {
    /** 引用 poi.template.id */
    poiId: string;
  };
  /** 选择器——筛选候选格 */
  selector: {
    /** 潮汐区列表，当前每条规则只有一个 tide */
    tides: string[];
    /** 区域限制，留空=所有区域（当前运行时契约不支持 per-region 过滤） */
    regions: string[];
    /** 排除区域入口格（默认 true，对齐 J-1 / E-9 运行时默认） */
    excludeEntrance: boolean;
    /** 排除区域出口格（默认 true） */
    excludeExit: boolean;
  };
  /** 放置策略——固定 mode=per_region_count */
  placement: {
    /** 每区域生成数量 */
    count: number;
  };
}

/**
 * DistributionRule data 在 graph-store 中的形状（带点 key）。
 *
 * 与 distribution-validator.ts / poi-loot-edge-builder.ts 中的 DistributionPoiUnifiedData 对齐。
 */
export interface DistributionPoiData {
  'subject.poi_id'?: string;
  'selector.tides'?: string[];
  'selector.regions'?: string[];
  'selector.excludeEntrance'?: boolean;
  'selector.excludeExit'?: boolean;
  'placement.count'?: number;
  [key: string]: unknown;
}

// ─── 默认值工厂 ──────────────────────────────────────────────────

/**
 * 默认值常量（与 schema distribution-poi.ts 字段 default 对齐）。
 */
export const DISTRIBUTION_RULE_DEFAULTS = {
  excludeEntrance: true,
  excludeExit: true,
  count: 1,
} as const;

/**
 * 构造一个空白 DistributionRule，供 RuleTablePanel「新增规则」时使用。
 *
 * tide + poiId 由调用方在用户选择后填入，然后调用 buildRuleId 计算 id。
 */
export function createEmptyRule(tide: string, poiId: string): DistributionRule {
  return {
    id: buildRuleId(tide, poiId),
    subject: { poiId },
    selector: {
      tides: [tide],
      regions: [],
      excludeEntrance: DISTRIBUTION_RULE_DEFAULTS.excludeEntrance,
      excludeExit: DISTRIBUTION_RULE_DEFAULTS.excludeExit,
    },
    placement: { count: DISTRIBUTION_RULE_DEFAULTS.count },
  };
}

// ─── ID 构造与解析 ────────────────────────────────────────────────

/**
 * 由 tide + poiId 拼接规则 id。
 *
 * 格式：`${tide}:${poi_id}`，如 `shallow:supply_cache`。
 */
export function buildRuleId(tide: string, poiId: string): string {
  return `${tide}:${poiId}`;
}

/**
 * 从规则 id 解析出 tide 与 poi_id。
 *
 * id 形如 `shallow:supply_cache`——以第一个 `:` 切分。
 * poi_id 内部不含 `:`（受 schema idPattern `[a-z][a-z0-9_]*` 约束）。
 */
export function parseRuleId(id: string): { tide: string; poiId: string } | null {
  const idx = id.indexOf(':');
  if (idx <= 0) return null;
  const tide = id.slice(0, idx);
  const poiId = id.slice(idx + 1);
  if (!tide || !poiId) return null;
  return { tide, poiId };
}

// ─── 双向投影 ────────────────────────────────────────────────────

/**
 * 从 ResourceNode 投影出 DistributionRule 编辑视图模型。
 *
 * 节点 data 中的带点 key 转换为嵌套对象，便于 Vue 响应式 :value 绑定。
 * 缺失字段使用默认值兜底（与 schema default 一致）。
 */
export function ruleFromNode(node: ResourceNode<DistributionPoiData>): DistributionRule {
  const data = node.data ?? {};
  const tides = Array.isArray(data['selector.tides']) ? [...data['selector.tides']!] : [];
  const regions = Array.isArray(data['selector.regions']) ? [...data['selector.regions']!] : [];
  const poiId = typeof data['subject.poi_id'] === 'string' ? data['subject.poi_id']! : '';
  // 当 selector.tides 缺失时，由 parseRuleId 从 node.id 拆分回填——
  // 这是 partitioned→unified 投影中间态的兜底，常规情形由 schema idPattern 保证
  if (tides.length === 0) {
    const parsed = parseRuleId(node.id);
    if (parsed) tides.push(parsed.tide);
  }
  return {
    id: node.id,
    subject: { poiId },
    selector: {
      tides,
      regions,
      excludeEntrance: data['selector.excludeEntrance'] ?? DISTRIBUTION_RULE_DEFAULTS.excludeEntrance,
      excludeExit: data['selector.excludeExit'] ?? DISTRIBUTION_RULE_DEFAULTS.excludeExit,
    },
    placement: {
      count: typeof data['placement.count'] === 'number' ? data['placement.count']! : DISTRIBUTION_RULE_DEFAULTS.count,
    },
  };
}

/**
 * 把 DistributionRule 编辑视图模型投影回 ResourceNode.data 形态（带点 key）。
 *
 * 调用方负责 wrap 成 ResourceNode 后通过 graph-store.upsertNode 写入。
 */
export function dataFromRule(rule: DistributionRule): DistributionPoiData {
  return {
    'subject.poi_id': rule.subject.poiId,
    'selector.tides': [...rule.selector.tides],
    'selector.regions': [...rule.selector.regions],
    'selector.excludeEntrance': rule.selector.excludeEntrance,
    'selector.excludeExit': rule.selector.excludeExit,
    'placement.count': rule.placement.count,
  };
}

// ─── Tide 选项 ───────────────────────────────────────────────────

/**
 * Tide 三档枚举（与 schema distribution-poi.ts DISTRIBUTION_POI_TIDE_OPTIONS / world.tile.tide 同步）。
 *
 * 对齐 J-2 潮汐区主键——distribution.poi.selector.tides 必须是这三个值之一。
 */
export const DISTRIBUTION_TIDE_OPTIONS = [
  { value: 'shallow', label: '浅滩' },
  { value: 'deep', label: '深水' },
  { value: 'abyss', label: '深海' },
] as const;

/**
 * Tide 桶固定顺序（与 poi_pool.php 文件顺序对齐）。
 */
export const DISTRIBUTION_TIDE_ORDER = ['shallow', 'deep', 'abyss'] as const;

/**
 * 由 tide key 查询中文标签。
 */
export function tideLabel(tide: string): string {
  return DISTRIBUTION_TIDE_OPTIONS.find((o) => o.value === tide)?.label ?? tide;
}

// ─── Scatter 相位选项（distribution.scatter 专用） ────────────────

/**
 * Scatter 相位枚举——game_init 开局放置 / day_refresh 时间流逝刷新。
 *
 * 与 schema distribution-scatter.ts DISTRIBUTION_SCATTER_PHASE_OPTIONS 同步。
 */
export const DISTRIBUTION_SCATTER_PHASE_OPTIONS = [
  { value: 'game_init', label: '初始' },
  { value: 'day_refresh', label: '刷新' },
] as const;

export const DISTRIBUTION_SCATTER_PHASE_ORDER = ['game_init', 'day_refresh'] as const;

export function phaseLabel(phase: string): string {
  return DISTRIBUTION_SCATTER_PHASE_OPTIONS.find((o) => o.value === phase)?.label ?? phase;
}

// ─── ScatterRule 模型（distribution.scatter 专用） ────────────────

/**
 * distribution.scatter 编辑视图模型。
 *
 * id 格式 `${tide}:${phase}:${item_id}`，phase 用运行时枚举值（game_init / day_refresh）。
 * placement.rate 是基础率；refresh 相位的 effective_rate = rate × tide 倍率（派生，不可编辑）。
 */
export interface ScatterRule {
  id: string;
  subject: { itemId: string };
  selector: {
    tides: string[];
    regions: string[];
  };
  phase: 'game_init' | 'day_refresh';
  placement: {
    rate: number;
    count: number | [number, number];
  };
}

export interface DistributionScatterData {
  'subject.item_id'?: string;
  'selector.tides'?: string[];
  'selector.regions'?: string[];
  'phase'?: 'game_init' | 'day_refresh';
  'placement.rate'?: number;
  'placement.count'?: number | [number, number];
  [key: string]: unknown;
}

export function buildScatterRuleId(
  tide: string,
  phase: 'game_init' | 'day_refresh',
  itemId: string,
): string {
  return `${tide}:${phase}:${itemId}`;
}

/**
 * 从 scatter 规则 id 解析出 tide / phase / item_id。
 *
 * id 形如 `shallow:game_init:scrap_metal`——以 `:` 切分，前两段是 tide / phase，
 * 第三段是 item_id（item_id 内部不含 `:`，受 schema idPattern 约束）。
 */
export function parseScatterRuleId(
  id: string,
): { tide: string; phase: 'game_init' | 'day_refresh'; itemId: string } | null {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const tide = parts[0];
  const phase = parts[1];
  const itemId = parts.slice(2).join(':');
  if (!tide || !phase || !itemId) return null;
  if (phase !== 'game_init' && phase !== 'day_refresh') return null;
  return { tide, phase, itemId };
}

export function scatterRuleFromNode(
  node: ResourceNode<DistributionScatterData>,
): ScatterRule {
  const data = node.data ?? {};
  const tides = Array.isArray(data['selector.tides']) ? [...data['selector.tides']!] : [];
  const regions = Array.isArray(data['selector.regions']) ? [...data['selector.regions']!] : [];
  const itemId = typeof data['subject.item_id'] === 'string' ? data['subject.item_id']! : '';
  if (tides.length === 0) {
    const parsed = parseScatterRuleId(node.id);
    if (parsed) tides.push(parsed.tide);
  }
  const phase = data['phase'] ?? 'game_init';
  const rate = typeof data['placement.rate'] === 'number' ? data['placement.rate']! : 0.1;
  const count = data['placement.count'] ?? 1;
  return {
    id: node.id,
    subject: { itemId },
    selector: { tides, regions },
    phase,
    placement: { rate, count: count as number | [number, number] },
  };
}

export function dataFromScatterRule(rule: ScatterRule): DistributionScatterData {
  return {
    'subject.item_id': rule.subject.itemId,
    'selector.tides': [...rule.selector.tides],
    'selector.regions': [...rule.selector.regions],
    phase: rule.phase,
    'placement.rate': rule.placement.rate,
    'placement.count': rule.placement.count,
  };
}

export function createEmptyScatterRule(
  tide: string,
  phase: 'game_init' | 'day_refresh',
  itemId: string,
): ScatterRule {
  return {
    id: buildScatterRuleId(tide, phase, itemId),
    subject: { itemId },
    selector: { tides: [tide], regions: [] },
    phase,
    placement: { rate: 0.1, count: 1 },
  };
}

// ─── EnemyRule 模型（distribution.enemy 专用） ────────────────────

/**
 * distribution.enemy 编辑视图模型。
 *
 * id 格式 `${tide}:${enemy_type}`，enemy_type 是数字字符串（与 enemy.template.id 同命名空间）。
 * excludeOccupied 在 P4 是静态派生（假设无占用），P6 引入动态占用。
 */
export interface EnemyRule {
  id: string;
  subject: { enemyType: string };
  selector: {
    tides: string[];
    regions: string[];
    excludeEntrance: boolean;
    excludeExit: boolean;
    excludeOccupied: boolean;
  };
  placement: {
    count: number | [number, number];
  };
}

export interface DistributionEnemyData {
  'subject.enemy_type'?: string;
  'selector.tides'?: string[];
  'selector.regions'?: string[];
  'selector.excludeEntrance'?: boolean;
  'selector.excludeExit'?: boolean;
  'selector.excludeOccupied'?: boolean;
  'placement.count'?: number | [number, number];
  [key: string]: unknown;
}

export function buildEnemyRuleId(tide: string, enemyType: string): string {
  return `${tide}:${enemyType}`;
}

/**
 * 从 enemy 规则 id 解析出 tide / enemy_type。
 *
 * id 形如 `shallow:1`——以 `:` 切分。enemy_type 是数字字符串。
 */
export function parseEnemyRuleId(id: string): { tide: string; enemyType: string } | null {
  const idx = id.indexOf(':');
  if (idx <= 0) return null;
  const tide = id.slice(0, idx);
  const enemyType = id.slice(idx + 1);
  if (!tide || !enemyType) return null;
  return { tide, enemyType };
}

export function enemyRuleFromNode(node: ResourceNode<DistributionEnemyData>): EnemyRule {
  const data = node.data ?? {};
  const tides = Array.isArray(data['selector.tides']) ? [...data['selector.tides']!] : [];
  const regions = Array.isArray(data['selector.regions']) ? [...data['selector.regions']!] : [];
  const enemyType =
    typeof data['subject.enemy_type'] === 'string' ? data['subject.enemy_type']! : '';
  if (tides.length === 0) {
    const parsed = parseEnemyRuleId(node.id);
    if (parsed) tides.push(parsed.tide);
  }
  const count = data['placement.count'] ?? 1;
  return {
    id: node.id,
    subject: { enemyType },
    selector: {
      tides,
      regions,
      excludeEntrance: data['selector.excludeEntrance'] ?? true,
      excludeExit: data['selector.excludeExit'] ?? true,
      excludeOccupied: data['selector.excludeOccupied'] ?? true,
    },
    placement: { count: count as number | [number, number] },
  };
}

export function dataFromEnemyRule(rule: EnemyRule): DistributionEnemyData {
  return {
    'subject.enemy_type': rule.subject.enemyType,
    'selector.tides': [...rule.selector.tides],
    'selector.regions': [...rule.selector.regions],
    'selector.excludeEntrance': rule.selector.excludeEntrance,
    'selector.excludeExit': rule.selector.excludeExit,
    'selector.excludeOccupied': rule.selector.excludeOccupied,
    'placement.count': rule.placement.count,
  };
}

export function createEmptyEnemyRule(tide: string, enemyType: string): EnemyRule {
  return {
    id: buildEnemyRuleId(tide, enemyType),
    subject: { enemyType },
    selector: {
      tides: [tide],
      regions: [],
      excludeEntrance: true,
      excludeExit: true,
      excludeOccupied: true,
    },
    placement: { count: 1 },
  };
}

// ─── 规则类别（用于三视图同步） ─────────────────────────────────

/**
 * 分布规则的资源类别——POI / 野生道具 / 敌人。
 *
 * 用于 DistributionView 二维 Tab 顶层维度，以及叠层组件决定渲染哪个 OverlayXxxDistribution。
 */
export type DistributionCategory = 'poi' | 'scatter' | 'enemy';

/**
 * 由规则 ID 推断资源类别。
 *
 * - 含 2 个 `:` 的 id 是 scatter（`${tide}:${phase}:${item_id}`）
 * - 含 1 个 `:` 且第二段是数字的 id 是 enemy（`${tide}:${enemy_type}`）
 * - 其余是 POI（`${tide}:${poi_id}`）
 *
 * 用于 OverlayPoiDistribution / OverlayWilditemDistribution / OverlayEnemyDistribution
 * 各自判断当前 selectedRuleId 是否属于自己处理的类别。
 */
export function inferCategoryFromRuleId(ruleId: string): DistributionCategory {
  const colonCount = (ruleId.match(/:/g) ?? []).length;
  if (colonCount >= 2) return 'scatter';
  if (colonCount === 1) {
    const idx = ruleId.indexOf(':');
    const second = ruleId.slice(idx + 1);
    if (/^[1-9]\d*$/.test(second)) return 'enemy';
  }
  return 'poi';
}
