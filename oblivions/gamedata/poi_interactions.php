<?php
/**
 * @module F 物品系统
 * @framework F-6 POI 道具交互系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions POI 道具交互配置表
// 唯一 interaction_id → 交互属性映射
//
// 配置驱动：poi.mechanic × 道具匹配 → effect_type 分发
// 主流程：obl/include/game/poi/poi.interact.func.php
// 效果函数：obl/include/game/poi/poi.interact_effects.func.php
//
// 字段说明：
//   - name             交互显示名（前端按钮文案）
//   - poi_mechanic     匹配 POI 模板 mechanic 字段（与 E-10 三档判定并列）
//   - required_item    必需道具 ID（与 required_tag 二选一，严格匹配 item_id）
//   - required_tag     必需 Tag（任一道具带此 Tag 即可触发）
//   - effect_type      分发到 poi_interact_effect_{name} 函数
//   - effect_params    效果参数（如 target_state / loot_table_id）
//   - consume_item     是否消耗道具（itms-1）
//   - consume_count    消耗数量
//   - repeatable       同一 POI 是否可重复交互
// ================================================================

return [
    'crowbar_pry_door' => [
        'name'           => '撬开',
        'poi_mechanic'   => 'interact_locked_door',
        'required_item'  => 'crowbar',
        'required_tag'   => null,
        'effect_type'    => 'unlock_door',
        'effect_params'  => ['target_state' => 'idle'],
        'consume_item'   => false,    // 撬棍耐久模型，未来可扣耐久
        'consume_count'  => 0,
        'repeatable'     => false,
    ],
    'lockpick_open_chest' => [
        'name'           => '开锁',
        'poi_mechanic'   => 'interact_locked_chest',
        'required_item'  => null,
        'required_tag'   => 'tag_tool_lockpick',  // lockpick 或 lockpick_set 均可
        'effect_type'    => 'open_container',
        'effect_params'  => ['loot_table_id' => 'locked_chest_loot'],
        'consume_item'   => true,     // 数量模型扣 1
        'consume_count'  => 1,
        'repeatable'     => false,
    ],
    'lighter_ignite_campfire' => [
        'name'           => '点燃',
        'poi_mechanic'   => 'interact_campfire',
        'required_item'  => 'lighter',
        'required_tag'   => null,
        'effect_type'    => 'ignite',
        'effect_params'  => ['target_state' => 'ignited'],
        'consume_item'   => false,    // 耐久模型，未来可扣耐久
        'consume_count'  => 0,
        'repeatable'     => false,
    ],
];
