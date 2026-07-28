/**
 * @module O 内容工具箱
 *
 * 关系边类型枚举。所有边必须显式声明方向，反向查询通过反向索引而非双向存储。
 */

export const RELATIONSHIP_TYPES = [
  'contains',          // region -> tile；父资源包含子资源
  'adjacent_to',       // tile -> tile；地图格邻接
  'distributed_by',    // distribution.poi/scatter -> poi/item；分布规则约束资源
  'spawned_by',        // distribution.enemy -> enemy.template；敌人分布规则生成敌人模板
  'selects_tiles',     // distribution rule -> tide/region/tile predicate；分布规则选择地图格
  'uses_loot_table',   // poi -> loot table；POI 引用战利品表
  'drops_item',        // loot table -> item；战利品表产出物品
  'dismantle_returns', // poi -> item；POI 拆解返还材料
  'mechanic_ref',      // poi -> item；POI 机制值引用（仅 craft_source）
  'consumes_item',     // recipe -> item；合成配方消耗物品（item_id 精确匹配）
  'consumes_tag',      // recipe -> item；合成配方消耗 tag 性质的物品
  'consumes_itmk',     // recipe -> item；合成配方消耗 itmk 类别的物品
  'produces_item',     // recipe -> item；合成配方产出物品
  'uses_effect',       // item/poi -> registered mechanic/effect；资源使用已注册效果
  'consumes_skill',    // enemy -> effect.skill；敌人拥有技能（skills[]）
  'casts_skill',       // enemy -> effect.skill；敌人战斗倾向/策略槽施放技能（combat_skills[] / strategy_slots[].id）
  'renders_as',        // gameplay resource -> presentation entry；资源呈现映射
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * 反向关系类型映射——给定正向边类型，返回用于反向索引的"语义反向"标签。
 *
 * 用于 O-7 模板工作区删除保护提示"以下资源引用了 X"。
 */
export const REVERSE_RELATIONSHIP_LABEL: Record<RelationshipType, string> = {
  contains: '被包含于',
  adjacent_to: '邻接',
  distributed_by: '被分布规则约束',
  spawned_by: '被敌人分布规则生成',
  selects_tiles: '被分布规则选中',
  uses_loot_table: '被 POI 引用',
  drops_item: '被战利品表产出',
  dismantle_returns: '被拆解返还',
  mechanic_ref: '被机制值引用',
  consumes_item: '被配方消耗（item_id）',
  consumes_tag: '被配方消耗（tag）',
  consumes_itmk: '被配方消耗（itmk）',
  produces_item: '被配方产出',
  uses_effect: '被效果引用',
  consumes_skill: '被敌人拥有（skills[]）',
  casts_skill: '被敌人施放（combat_skills[] / strategy_slots）',
  renders_as: '被呈现映射',
};
