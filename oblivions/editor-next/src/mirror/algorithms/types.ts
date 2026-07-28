/**
 * @module O 内容工具箱
 *
 * 算法移植层共享类型定义。
 *
 * 这些类型对齐后端 PHP 的物品模板与物品实例结构（item_table.php / obl_instantiate_item），
 * 供 9 个移植函数共享。所有字段名保持蛇形命名以与 PHP 一致（对齐 3.1 锚点保留原则）。
 */

/**
 * 物品模板（对齐 item_table.php 的 entry）。
 *
 * 字段语义：
 *   - itmk：道具类别码（WP/WK/.../MT/TK/SP）
 *   - itme：效果值（武器为攻击力，护甲为减伤）
 *   - itms：数量/耐久字符串（数字字符串如 "20" 或 "∞"）
 *   - itmsk：技能/属性后缀
 *   - itmpara：参数协议字符串（item_table 中为 JSON 字符串，实例化后为数组）
 *   - stack：是否可堆叠——堆叠道具 itms 是数量，非堆叠是耐久
 *   - stack_limit：可堆叠道具的单实例上限（默认 1）
 *   - tags：性质描述 Tag 数组
 *   - tool_level：工具等级（0-3）
 *   - tier：稀有度（common/uncommon/rare/epic）
 */
export interface ItemTemplate {
  itmk: string;
  itme: number;
  itms: string;
  itmsk: string;
  itmpara: string | unknown[];
  stack?: boolean;
  stack_limit?: number;
  tags?: string[];
  tool_level?: number;
  tier?: string;
  [key: string]: unknown;
}

/**
 * 物品实例（对齐 obl_instantiate_item 返回的 itempara 七字段结构）。
 *
 * - itm 留空：新实例遵循约定，前端通过 itmid 查 locale 渲染名称
 * - itmpara 为数组或对象（item_table.php 中 itmpara 是 JSON 字符串；PHP json_decode(,true)
 *   对 {...} 返回关联数组，is_array 为 true；TS 中 JSON.parse 对 {...} 返回对象、对 [...] 返回数组。
 *   本引擎保留解码后的原始值以对齐 PHP 语义）
 * - itms 为字符串（保留 '∞' 表示无限耐久/数量）
 */
export interface ItemInstance {
  itm: string;
  itmk: string;
  itme: number;
  itms: string;
  itmsk: string;
  itmpara: unknown[] | Record<string, unknown>;
  itmid: string;
}

/**
 * 物品模板表（map-keyed load：item_id → template）。
 */
export type ItemTable = Record<string, ItemTemplate>;

/**
 * 战利品表 entry（对齐 loot_tables.php 中 groups[].entries[]）。
 *
 * - item_id：物品模板 ID（引用 item_table 的 key）
 * - weight：组内互斥权重（默认 1.0）
 * - count：int 或 [min, max] 区间——生成数量
 */
export interface LootEntry {
  item_id: string;
  weight?: number;
  count?: number | [number, number];
  [key: string]: unknown;
}

/**
 * 战利品表 group（对齐 loot_tables.php 中 groups[]）。
 *
 * - chance：组级概率（0-1，默认 1.0）
 * - entries：互斥选项列表
 */
export interface LootGroup {
  chance?: number;
  entries: LootEntry[];
  [key: string]: unknown;
}

/**
 * 战利品表（对齐 loot_tables.php 的 entry）。
 *
 * - name：表名（日志/调试用）
 * - durability_decay：是否对产出物品应用耐久衰减
 * - groups：物品组列表
 */
export interface LootTable {
  name?: string;
  durability_decay?: boolean;
  groups: LootGroup[];
  [key: string]: unknown;
}

/**
 * 战利品表集合（map-keyed load：table_id → table）。
 */
export type LootTables = Record<string, LootTable>;

/**
 * POI 事件池 entry（对齐 poi_table.php 中 event_pool[]）。
 *
 * - event_id：事件 ID
 * - weight：加权权重（默认 1.0）
 * - kind：事件类别（good/bad）
 */
export interface PoiEventEntry {
  event_id: string;
  weight?: number;
  kind?: 'good' | 'bad';
  [key: string]: unknown;
}

/**
 * Scatter pool 配置 entry（对齐 scatter_pool.php 中 initial/refresh 数组项）。
 *
 * - item_id：物品模板 ID
 * - count：int 或 [min, max] 区间
 * - rate：生成概率（0-1）
 */
export interface ScatterEntry {
  item_id: string;
  count?: number | [number, number];
  rate?: number;
  [key: string]: unknown;
}

/**
 * Scatter pool（对齐 scatter_pool.php 的 [tide] 相位结构）。
 *
 * - initial：开局生成相位（obl_generate_wild_items 使用）
 * - refresh：按天刷新相位（obl_refresh_wild_items 使用）
 */
export interface ScatterTidePool {
  initial?: ScatterEntry[];
  refresh?: ScatterEntry[];
  [key: string]: unknown;
}

/**
 * Scatter pool 集合（map-keyed load：tide → pool）。
 */
export type ScatterPool = Record<string, ScatterTidePool>;

/**
 * 敌人池 entry（对齐 enemy_pool.php 中 [tide][] 数组项）。
 *
 * - enemy_type：敌人类型 ID（对应 enemies_config 的 key）
 * - count：int 或 [min, max] 区间
 */
export interface EnemyPoolEntry {
  enemy_type: number;
  count?: number | [number, number];
  [key: string]: unknown;
}

/**
 * 敌人池（map-keyed load：tide → entries）。
 */
export type EnemyPool = Record<string, EnemyPoolEntry[]>;

/**
 * Wild item refresh 配置（对齐 obl_config.php 的 wild_item_* 字段子集）。
 */
export interface WildItemRefreshConfig {
  /** 刷新模式（'daily' 启用按天刷新） */
  wild_item_refresh_mode?: string;
  /** 单格野生道具容量上限 */
  wild_item_capacity_per_tile?: number;
  /** 潮汐倍率表（tide → multiplier） */
  wild_item_refresh_rate_by_tide?: Record<string, number>;
  [key: string]: unknown;
}

/**
 * 区域元数据（对齐 map.php 中 regions[pgroup]，仅含敌人放置所需字段）。
 */
export interface RegionInfo {
  entrance_pls: number | null;
  exit_pls: number | null;
  [key: string]: unknown;
}
