<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions POI 模板表
// 唯一 ID 索引 → POI 模板属性
// 不含掉落表（见 poi_loot.php）和刷新配置（见 poi_pool.php）
// ================================================================

return [
    'supply_cache' => [
        'name'       => '补给储藏箱',
        'desc'       => '一个被铁皮加固的木箱，里面可能还有能用的物资。',
        'searchable' => true,
        'repeatable' => false,
    ],

    'scrap_pile' => [
        'name'            => '废料堆',
        'desc'            => '堆积着各种金属废料，翻翻看也许能找到什么。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,     // 最大搜索次数，0=无限
        'repeat_cooldown' => 3,     // 冷却回合数
    ],

    'landmark' => [
        'name'       => '地标',
        'desc'       => '醒目的地标建筑，可以作为导航参考。',
        'searchable' => false,
        'repeatable' => false,
    ],

    'danger_chest' => [
        'name'       => '危险宝箱',
        'desc'       => '散发着不祥气息的金属箱，里面也许有值钱的东西。',
        'searchable' => true,
        'repeatable' => false,
    ],

    'swamp_spring' => [
        'name'            => '沼泽泉眼',
        'desc'            => '从地下涌出的清澈泉水，在污浊的沼泽中格外珍贵。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,
        'repeat_cooldown' => 5,
    ],

    'life_totem' => [
        'name'            => '生命图腾',
        'desc'            => '刻满符文的石柱，触碰后感到一股暖流涌入体内。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 3,
        'repeat_cooldown' => 0,
        'mechanic'        => 'max_hp_up',
        'mechanic_value'  => 10,
    ],

    'ancient_relic' => [
        'name'       => '古代遗物',
        'desc'       => '半埋在泥土中的古代装置，核心似乎还在运转。',
        'searchable' => true,
        'repeatable' => false,
    ],

    'skill_totem' => [
        'name'            => '技能图腾',
        'desc'            => '散发着神秘光芒的古老石碑，似乎能传授某种能力。',
        'searchable'      => true,
        'repeatable'      => false,
        'mechanic'        => 'learn_skill',
        'mechanic_params' => ['passive', 'strategy', 'damage'],
    ],

    // ─── 工作台 POI（mechanic='craft_source'）──────────────
    // mechanic_value 存储 item_id，指向 item_table 中的工作台道具
    // 玩家站在该 POI 上时，工作台素材加入可用列表（详见设计案 §3.5 / §5.5.3）

    'forge_anvil_poi' => [
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'craft_source',
        'mechanic_value'  => 'forge_t1',
    ],
    'vent_stove' => [
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'craft_source',
        'mechanic_value'  => 'stove_t1',
    ],
    'precision_stove_poi' => [
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'craft_source',
        'mechanic_value'  => 'stove_t2',
    ],
];
