/**
 * @module O 内容工具箱
 *
 * 合成素材-槽位映射（移植自 item.craft.func.php:252-338）。
 *
 * 设计意图：
 * - F-2 配置驱动的合成系统的核心匹配算法——三阶段匹配（item_id > itmk > tag）
 * - 素材与配方的 materials 完全匹配则返回映射；否则返回 null
 * - consume 约束：工作台素材（source='workbench'）只能匹配 consume='none' 槽位
 * - 完全消耗约束：所有 placed_items 必须都被消耗（多放也不匹配）
 *
 * 与 PHP 的差异：
 * - 纯函数：不修改输入 placed_items，使用内部 available 副本
 * - 不调用 item_get_tags / item_get_itmk / item_get_tool_level（这些是 PHP 的辅助函数），
 *   placed_items 已包含 itmk / tags / tool_level 字段
 * - 不复现 PHP mt_rand 序列——本函数完全不使用随机数（P6 唯一能 1:1 精确对齐的子系统）
 *
 * @mirror-of oblivions/include/game/item/item.craft.func.php:227-231 (item_can_consume)
 * @mirror-of oblivions/include/game/item/item.craft.func.php:252-338 (item_resolve_material_mapping)
 */

/**
 * 配方素材需求（对齐 recipe_table.php 的 materials[] entry）。
 *
 * 三种匹配键（互斥，按优先级 item_id > itmk > tag）：
 *   - item_id：精确匹配素材的 item_id
 *   - itmk：匹配素材的 itmk 类别
 *   - tag：匹配素材的 tags 数组中是否包含该 tag
 *
 * 其他字段：
 *   - count：需要的数量（默认 1）
 *   - consume：消耗模式（'all' / 'durability' / 'none'，默认 'all'）
 *   - min_level：素材的 tool_level 下限（默认 0）
 */
export interface MaterialRequirement {
  item_id?: string;
  itmk?: string;
  tag?: string;
  count?: number;
  consume?: 'all' | 'durability' | 'none';
  min_level?: number;
  [key: string]: unknown;
}

/**
 * 放置的素材项（对齐 _item_build_placed_items 返回的 placed_item）。
 *
 * - item_id：素材的 item_id
 * - itmk：素材的类别码
 * - tags：素材的 tag 数组
 * - tool_level：素材的工具等级
 * - source：来源（'bag' 背包素材 / 'workbench' 工作台素材）
 */
export interface PlacedItem {
  item_id: string;
  itmk: string;
  tags: string[];
  tool_level: number;
  source: 'bag' | 'workbench';
  [key: string]: unknown;
}

/**
 * 匹配成功后的单项映射结果。
 *
 * - placed_index：匹配的 placed_item 在原数组中的索引
 * - consume：消耗模式（'all' / 'durability' / 'none'）
 */
export interface MaterialMappingEntry {
  placed_index: number;
  consume: 'all' | 'durability' | 'none';
}

/**
 * 内部 available 项（带 used 标记）。
 */
interface AvailableItem {
  index: number;
  item_id: string;
  itmk: string;
  tags: string[];
  tool_level: number;
  source: 'bag' | 'workbench';
  used: boolean;
}

/**
 * 检查素材是否可匹配指定 consume 模式（对齐 item_can_consume）。
 *
 * - consume='none'：任何素材都可匹配（工作台素材只能匹配此模式）
 * - consume='all' / 'durability'：工作台素材不可匹配，背包素材可匹配
 *
 * @param item     素材（含 source 字段）
 * @param consume  consume 模式
 * @returns 是否可匹配
 */
export function itemCanConsume(
  item: { source: 'bag' | 'workbench' },
  consume: 'all' | 'durability' | 'none',
): boolean {
  if (consume === 'none') return true;
  if (item.source === 'workbench') return false;
  return true;
}

/**
 * 解析素材-槽位映射。
 *
 * 匹配规则（设计案 §5.5.7）：
 *   1. 先匹配具体 item_id 素材（精确匹配优先）
 *   2. 再匹配 itmk 素材（类别匹配次之）
 *   3. 最后匹配 tag 素材（性质匹配最后）
 *   4. min_level 检查：素材的 tool_level 必须 ≥ material 的 min_level
 *   5. consume 约束：工作台素材只能匹配 consume='none' 的槽位
 *   6. 所有放置的素材必须都被消耗（多放也算不匹配，避免指向不明确）
 *   7. 同一素材不能同时满足多个槽位（由匹配优先级 + used 标记保证）
 *
 * @param materials   配方的 materials 数组
 * @param placedItems 放置的素材列表
 * @returns 匹配成功返回映射数组；失败返回 null
 */
export function itemResolveMaterialMapping(
  materials: readonly MaterialRequirement[],
  placedItems: readonly PlacedItem[],
): MaterialMappingEntry[] | null {
  // 1. 复制 placed_items 用于消耗标记
  const available: AvailableItem[] = placedItems.map((p, i) => ({
    index: i,
    item_id: typeof p.item_id === 'string' ? p.item_id : '',
    itmk: typeof p.itmk === 'string' ? p.itmk : '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    tool_level: typeof p.tool_level === 'number' ? p.tool_level : 0,
    source: p.source === 'workbench' ? 'workbench' : 'bag',
    used: false,
  }));

  const mapping: MaterialMappingEntry[] = [];

  // 2. 先匹配具体 item_id 素材（精确匹配优先）
  for (const mat of materials) {
    if (mat.item_id === undefined) continue;
    let need = typeof mat.count === 'number' ? mat.count : 1;
    const consume = mat.consume ?? 'all';
    const minLevel = typeof mat.min_level === 'number' ? mat.min_level : 0;
    const n = available.length;
    for (let i = 0; i < n && need > 0; i++) {
      const a = available[i]!;
      if (a.used) continue;
      if (a.item_id !== mat.item_id) continue;
      if (a.tool_level < minLevel) continue;
      if (!itemCanConsume(a, consume)) continue;
      a.used = true;
      mapping.push({ placed_index: a.index, consume });
      need--;
    }
    if (need > 0) return null;
  }

  // 3. 再匹配 itmk 素材（类别匹配次之）
  for (const mat of materials) {
    if (mat.itmk === undefined) continue;
    let need = typeof mat.count === 'number' ? mat.count : 1;
    const consume = mat.consume ?? 'all';
    const minLevel = typeof mat.min_level === 'number' ? mat.min_level : 0;
    const n = available.length;
    for (let i = 0; i < n && need > 0; i++) {
      const a = available[i]!;
      if (a.used) continue;
      if (a.itmk !== mat.itmk) continue;
      if (a.tool_level < minLevel) continue;
      if (!itemCanConsume(a, consume)) continue;
      a.used = true;
      mapping.push({ placed_index: a.index, consume });
      need--;
    }
    if (need > 0) return null;
  }

  // 4. 最后匹配 tag 素材（性质匹配最后）
  for (const mat of materials) {
    if (mat.tag === undefined) continue;
    let need = typeof mat.count === 'number' ? mat.count : 1;
    const consume = mat.consume ?? 'all';
    const minLevel = typeof mat.min_level === 'number' ? mat.min_level : 0;
    const n = available.length;
    for (let i = 0; i < n && need > 0; i++) {
      const a = available[i]!;
      if (a.used) continue;
      if (!a.tags.includes(mat.tag)) continue;
      if (a.tool_level < minLevel) continue;
      if (!itemCanConsume(a, consume)) continue;
      a.used = true;
      mapping.push({ placed_index: a.index, consume });
      need--;
    }
    if (need > 0) return null;
  }

  // 5. 检查是否所有放置的素材都被消耗（多放也不匹配）
  for (const a of available) {
    if (!a.used) return null;
  }

  return mapping;
}

/**
 * 素材多重集匹配（item_resolve_material_mapping 的布尔包装，对齐 item_materials_match）。
 *
 * @param materials   配方的 materials 数组
 * @param placedItems 放置的素材列表
 * @returns true=匹配成功
 */
export function itemMaterialsMatch(
  materials: readonly MaterialRequirement[],
  placedItems: readonly PlacedItem[],
): boolean {
  return itemResolveMaterialMapping(materials, placedItems) !== null;
}
