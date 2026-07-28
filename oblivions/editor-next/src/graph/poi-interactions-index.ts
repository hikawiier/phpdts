/**
 * @module O 内容工具箱
 *
 * poi_interactions.php 辅助索引构建器（P3 §4.3.4）。
 *
 * 设计意图：
 *   poi_interactions.php 不是可编辑资源 kind——P3 不为它注册 KindSchema、不提供编辑 UI。
 *   但 O-10 校验器需要它的内容做引用闭合校验：
 *     - poi.template.mechanic=interact_* 时，校验是否存在对应 interaction 配置
 *       （poi_mechanic → interaction_id 映射）
 *     - poi_interactions.required_item 引用 item.template.id，校验引用闭合
 *       （required_item → item_id 映射，与 loot.table.groups[].entries[].item_id 同类引用）
 *
 *   因此把 poi_interactions.php 解析为辅助索引——不进入 ResourceNode 图，但
 *   可被 O-10 校验器与 O-7 删除保护查询。索引挂在模块级状态上，由 loader.ts
 *   在工作区加载完成后调用 buildPoiInteractionsIndex 重建。
 *
 * 索引内容：
 *   - poiMechanicToInteractionId: Map<poi_mechanic, interaction_id>
 *       例：'interact_locked_door' → 'crowbar_pry_door'
 *       用于校验 poi.template.mechanic 是否有对应交互配置
 *   - requiredItemToInteractionId: Map<item_id, interaction_id[]>
 *       例：'crowbar' → ['crowbar_pry_door']
 *       用于校验 poi_interactions.required_item 引用闭合，同一 item 可被多个交互配置引用
 *
 * 数据形状（与 poi_interactions.php 字段对齐）：
 *   {
 *     crowbar_pry_door: {
 *       name, poi_mechanic, required_item, required_tag,
 *       effect_type, effect_params, consume_item, consume_count, repeatable
 *     },
 *     ...
 *   }
 *
 * 边界：
 *   - required_item=null 时不加入 requiredItemToInteractionId（如 lockpick_open_chest
 *     用 required_tag 而非 required_item）
 *   - poi_mechanic=null 时不加入 poiMechanicToInteractionId（防御性，实际数据均非空）
 *   - 同一 poi_mechanic 多个 interaction 配置时，后者覆盖前者（实际数据每 mechanic 唯一）
 *   - 同一 required_item 可被多个 interaction 引用，value 是数组
 */

import type { PhpValue } from '../shared/serializer/php-array-parser';

/**
 * poi_interactions.php 单条配置的形状（仅本模块关注的字段）。
 *
 * 完整字段见 oblivions/gamedata/poi_interactions.php 文件头注释；
 * 本接口仅声明索引构建所需的字段，其余字段原样保留在 rawData 中不消费。
 */
export interface PoiInteractionEntry {
  /** 交互显示名（前端按钮文案） */
  name?: string;
  /** 匹配 POI 模板 mechanic 字段（如 interact_locked_door） */
  poi_mechanic?: string | null;
  /** 必需道具 ID（与 required_tag 二选一，严格匹配 item_id） */
  required_item?: string | null;
  /** 必需 Tag（任一道具带此 Tag 即可触发） */
  required_tag?: string | null;
  /** 分发到 poi_interact_effect_{name} 函数 */
  effect_type?: string;
  /** 效果参数 */
  effect_params?: Record<string, unknown>;
  /** 是否消耗道具 */
  consume_item?: boolean;
  /** 消耗数量 */
  consume_count?: number;
  /** 同一 POI 是否可重复交互 */
  repeatable?: boolean;
}

/**
 * poi_interactions.php 解析结果——key 是 interaction_id，value 是配置
 */
export type PoiInteractionsData = Record<string, PoiInteractionEntry>;

/**
 * 辅助索引结构——两个映射表
 */
export interface PoiInteractionsIndex {
  /**
   * poi_mechanic → interaction_id 映射
   * 用于校验 poi.template.mechanic=interact_* 时是否有对应交互配置
   */
  poiMechanicToInteractionId: Map<string, string>;
  /**
   * required_item → interaction_id[] 映射
   * 用于校验 poi_interactions.required_item 引用闭合
   * 同一 item 可被多个交互配置引用，value 是数组
   */
  requiredItemToInteractionId: Map<string, string[]>;
}

// —— 模块级状态 ——

/**
 * 当前工作区的 poi_interactions 索引——由 loader.ts 在工作区加载完成后调用
 * setPoiInteractionsIndex 重建。O-10 校验器与 O-7 删除保护通过
 * getPoiInteractionsIndex 读取。
 *
 * 初始值是空索引（两个空 Map），避免 loader 加载失败时校验器 NPE。
 */
let currentIndex: PoiInteractionsIndex = {
  poiMechanicToInteractionId: new Map(),
  requiredItemToInteractionId: new Map(),
};

/**
 * 从 poi_interactions.php 解析结果构建辅助索引。
 *
 * 输入是 PHP 解析后的 PhpValue（已通过 parsePhpArrayExt 解析）。
 * 调用方负责先解析 PHP 文件，再把结果传给本函数。
 *
 * @param rawData poi_interactions.php 的解析结果（key=interaction_id, value=配置）
 * @returns 两个映射表组成的索引结构
 */
export function buildPoiInteractionsIndex(rawData: PhpValue): PoiInteractionsIndex {
  const index: PoiInteractionsIndex = {
    poiMechanicToInteractionId: new Map(),
    requiredItemToInteractionId: new Map(),
  };

  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return index;
  }

  const obj = rawData as Record<string, PhpValue>;
  for (const [interactionId, rawEntry] of Object.entries(obj)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as PoiInteractionEntry;

    // poi_mechanic → interaction_id
    const mechanic = entry.poi_mechanic;
    if (typeof mechanic === 'string' && mechanic !== '') {
      index.poiMechanicToInteractionId.set(mechanic, interactionId);
    }

    // required_item → interaction_id[]（同一 item 可被多个交互引用）
    const requiredItem = entry.required_item;
    if (typeof requiredItem === 'string' && requiredItem !== '') {
      const existing = index.requiredItemToInteractionId.get(requiredItem);
      if (existing !== undefined) {
        existing.push(interactionId);
      } else {
        index.requiredItemToInteractionId.set(requiredItem, [interactionId]);
      }
    }
  }

  return index;
}

/**
 * 设置当前工作区的 poi_interactions 索引。
 *
 * 由 loader.ts 在工作区加载完成后调用——传入 buildPoiInteractionsIndex 的返回值。
 * 重复调用时直接替换旧索引（无幂等保护，调用方负责只在加载完成时调用一次）。
 */
export function setPoiInteractionsIndex(index: PoiInteractionsIndex): void {
  currentIndex = index;
}

/**
 * 读取当前工作区的 poi_interactions 索引。
 *
 * O-10 校验器与 O-7 删除保护通过此函数读取索引。
 * 工作区未加载时返回空索引（两个空 Map），调用方无需 NPE 检查。
 */
export function getPoiInteractionsIndex(): PoiInteractionsIndex {
  return currentIndex;
}

/**
 * 清空当前工作区的 poi_interactions 索引——仅供测试使用。
 *
 * 生产代码不应调用——loader.ts 在每次 loadWorkspace 时会重建索引，
 * 不需要显式清空。
 */
export function clearPoiInteractionsIndex(): void {
  currentIndex = {
    poiMechanicToInteractionId: new Map(),
    requiredItemToInteractionId: new Map(),
  };
}
