//
// 配置文件类型定义，对齐 gamedata 配置文件：
//   - scatter_pool.php（野生道具生成池，按 tide 三档分桶）
//   - poi_table.php（POI 模板，含基本字段 + E-10 三档判定 + mechanic + E-12 耐久 + 子列表）
//   - poi_pool.php（POI 生成池，按 tide 三档分桶）
//   - obl_config.php（核心配置，编辑器只读不编辑）
//
// 研判：
//   - 所有类型均服务于配置编辑框架
//   - 复用 types/map.ts 的 Tide 类型
//   - validateStore 配置交叉引用校验读取此处类型
//
// 字段形状对齐真实 PHP 文件（非设计案理想形态）：
//   - scatter_pool.count 可能是 number 或 [min, max] 范围数组
//   - poi_table 模板字段大部分可选（landmark / forge_anvil_poi 仅含部分字段）
//   - mechanic_value 可能是 number（life_totem: 10）或 string（forge_anvil_poi: 'forge_t1'）
//   - mechanic_params 类型不定（skill_totem 是 string[]，其他可能是对象），用 unknown 保留 round-trip
//   - obl_config 字段混合 number/string/boolean/嵌套数组，用 Record<string, unknown> 兜底

import type { Tide } from './map';

/**
 * 散布池条目（scatter_pool 单条）
 *
 * count 可能是固定数（如 1）或范围数组 [min, max]（如 [1,3]）
 * rate 是"基础率"，不与运行时倍率预先折算（对齐 2.6 配置驱动 + DESIGN.md §3.4.1）
 */
export interface ScatterPoolEntry {
  item_id: string;
  count: number | [number, number];
  rate: number;
}

/**
 * 散布池单档（initial=开局生成，refresh=刷新生成）
 */
export interface ScatterPoolPhase {
  initial: ScatterPoolEntry[];
  refresh: ScatterPoolEntry[];
}

/**
 * 散布池（按 tide 三档分桶，对齐 scatter_pool.php）
 */
export interface ScatterPool {
  shallow: ScatterPoolPhase;
  deep: ScatterPoolPhase;
  abyss: ScatterPoolPhase;
}

/**
 * POI 事件池条目（poi_table 中 event_pool 子列表，对齐 E-10 三档判定）
 */
export interface PoiEventPoolEntry {
  event_id: string;
  weight: number;
  kind: 'good' | 'bad';
}

/** 事件池条目别名（对齐任务需求文案） */
export type EventPoolEntry = PoiEventPoolEntry;

/**
 * POI 拆解返还条目（poi_table 中 dismantle_returns 子列表，E-12 耐久系统）
 */
export interface PoiDismantleReturn {
  item_id: string;
  count: number;
}

/** 拆解返还条目别名（对齐任务需求文案） */
export type DismantleReturn = PoiDismantleReturn;

/**
 * POI 战利品表覆盖映射（工具/技能 ID → loot_table_id）
 */
export type PoiLootTableOverride = Record<string, string>;

/** 战利品表覆盖映射别名（对齐任务需求文案） */
export type LootTableOverride = PoiLootTableOverride;

/**
 * POI 模板（对齐 poi_table.php 单条）
 *
 * 字段分组：
 *   - 基本：name / desc / searchable / repeatable / repeat_limit / repeat_cooldown
 *   - E-10 三档判定：base_loot_chance / base_good_event_chance / base_bad_event_chance /
 *                   loot_table_id / event_pool / prob_mods_source / loot_table_overrides
 *   - 机制型：mechanic / mechanic_value / mechanic_params（JSON 字符串）
 *   - E-12 耐久：ttl_days / dismantle_returns
 *
 * 除 searchable / repeatable 外其余字段可选——真实 PHP 文件中：
 *   - landmark 仅含基本字段
 *   - forge_anvil_poi / vent_stove / precision_stove_poi 仅含 mechanic 字段
 *   - life_totem / skill_totem 含 mechanic + E-10 留空字段
 */
export interface PoiTableEntry {
  // 基本
  name?: string;
  desc?: string;
  searchable: boolean;
  repeatable: boolean;
  repeat_limit?: number;
  repeat_cooldown?: number;
  // E-10 三档判定
  base_loot_chance?: number;
  base_good_event_chance?: number;
  base_bad_event_chance?: number;
  loot_table_id?: string;
  event_pool?: PoiEventPoolEntry[];
  prob_mods_source?: string[];
  loot_table_overrides?: PoiLootTableOverride;
  // 机制型
  mechanic?: string;
  mechanic_value?: string | number;
  mechanic_params?: unknown; // JSON 字符串字段，编辑器以文本框 + JSON.parse 校验，保留任意结构以支持 round-trip
  // E-12 耐久
  ttl_days?: number;
  dismantle_returns?: PoiDismantleReturn[];
}

/**
 * POI 模板表（对齐 poi_table.php，key=poi_id）
 */
export type PoiTable = Record<string, PoiTableEntry>;

/**
 * POI 生成池条目（poi_pool 单条）
 */
export interface PoiPoolEntry {
  poi_id: string;
  per_region: number;
}

/**
 * POI 生成池（按 tide 三档分桶，对齐 poi_pool.php）
 */
export type PoiPool = Record<Tide, PoiPoolEntry[]>;

/**
 * OblConfig（核心配置，对齐 obl_config.php；编辑器只读不编辑以避免覆盖后端现存配置）
 *
 * 字段混合 number / string / boolean / 嵌套数组（如 wild_item_refresh_rate_by_tide），
 * 用 Record<string, unknown> 兜底，保留 round-trip 完整性
 */
export type OblConfig = Record<string, unknown>;
