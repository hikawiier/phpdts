<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 合成配方表
// 唯一 recipe_id → 配方数据（仅游戏逻辑，不含文案）
//
// 字段说明：
// - category：配方分类标识（tool/armor/food/weapon），用于前端显示过滤
// - materials：素材数组，每个元素支持三种匹配形式：
//   * ['item_id'=>xxx, ...]  精确匹配指定道具
//   * ['itmk'=>xxx, ...]     匹配道具类别（如 'MT' 匹配所有金属类素材）
//   * ['tag'=>xxx, ...]      匹配性质描述 Tag
// - materials 可选字段：
//   * count（默认 1）：数量
//   * consume（默认 'all'）：'all'=消耗 / 'durability'=扣耐久 / 'none'=返还
//   * min_level（默认 0）：要求素材 tool_level >= min_level（高级工具兼容低级配方）
// - results：产物数组，支持多产物 ['item_id'=>xxx, 'count'=>n]
//
// 匹配规则（见设计案 §5.5.7）：
// - 匹配优先级：item_id > itmk > tag
// - 工作台素材只能匹配 consume='none' 的槽位
// - 所有放置的素材必须都被消耗（多放也不匹配）
// - 同一素材不能同时满足多个槽位
// ================================================================

return [
    // ─── 基础配方（无需工作台素材）──────────────────────

    'craft_bandage' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'cloth', 'count' => 3, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'bandage', 'count' => 1],
        ],
    ],
    'craft_thick_shoes' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'crushed_can',  'count' => 1, 'consume' => 'all'],
            ['item_id' => 'scrap_wire',   'count' => 1, 'consume' => 'all'],
            ['item_id' => 'cabin_sponge', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'thick_shoes', 'count' => 1],
        ],
    ],
    'craft_roasted_rabbit' => [
        'category'  => 'food',
        'materials' => [
            ['item_id' => 'rabbit_meat_raw', 'count' => 1, 'consume' => 'all'],
            ['tag'     => 'tag_combustible', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'roasted_rabbit', 'count' => 1],
        ],
    ],

    // ─── 需要工作台素材的配方 ──────────────────────────

    'craft_frying_pan' => [
        'category'  => 'tool',
        'materials' => [
            ['tag'     => 'tag_forge', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['itmk'    => 'MT', 'count' => 4, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'frying_pan', 'count' => 1],
        ],
    ],
    'craft_simple_stew' => [
        'category'  => 'food',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'roasted_rabbit', 'count' => 1, 'consume' => 'all'],
            ['tag'     => 'tag_raw_food',   'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'simple_stew', 'count' => 1],
        ],
    ],
    'craft_blade_wrapped' => [
        'category'  => 'weapon',
        'materials' => [
            ['tag'     => 'tag_sharp', 'count' => 1, 'consume' => 'durability'],
            ['item_id' => 'cloth',     'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'blade_wrapped', 'count' => 1],
        ],
    ],

    // ─── 高级配方（需要高等级工作台素材）────────────────

    'craft_precision_stove' => [
        'category'  => 'tool',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 2, 'count' => 1, 'consume' => 'none'],
            ['itmk'    => 'MT', 'count' => 6, 'consume' => 'all'],
            ['item_id' => 'circuit_board', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'rusty_gear',    'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'precision_stove', 'count' => 1],
        ],
    ],
];
