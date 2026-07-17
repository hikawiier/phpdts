<?php
/**
 * @module F 物品系统
 */
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
    'craft_frying_pan' => [
        'category'  => 'tool',
        'materials' => [
            ['itmk'    => 'MT', 'count' => 4, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'frying_pan', 'count' => 1],
        ],
    ],
    'craft_dismantle_pan' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'frying_pan', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'scrap_metal', 'count' => 4],
        ],
    ],

    // ─── 需要工作台素材的配方 ──────────────────────────

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

    // ================================================================
    // ─── 内容扩充（任务3：从外部世界实例挑选合成案例）──────────────
    // 设计意图：补全早期-中期-后期各阶段的合成路径，覆盖武器/防具/工具/食物四类
    // 参考外部 recipes.json 的"抽象材料 + 工具消耗"模式，
    // 适配本游戏 item_table 的 item_id / itmk / tag 三种匹配形式
    // ================================================================

    // ─── 基础配方（无需工作台素材）──────────────────────

    'craft_torch_unlit' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'tree_branch', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'dirty_rag',   'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'torch_unlit', 'count' => 1],
        ],
    ],
    'craft_lockpick_set' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'scrap_metal', 'count' => 3, 'consume' => 'all'],
            ['item_id' => 'rusty_gear',  'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'lockpick_set', 'count' => 1],
        ],
    ],
    'craft_tarpaulin' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'cloth',     'count' => 3, 'consume' => 'all'],
            ['item_id' => 'rope_coil', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'tarpaulin', 'count' => 1],
        ],
    ],
    'craft_cloth_shoes' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'cloth',     'count' => 2, 'consume' => 'all'],
            ['item_id' => 'dirty_rag', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'cloth_shoes', 'count' => 1],
        ],
    ],
    'craft_assassin_hood' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'cloth',     'count' => 2, 'consume' => 'all'],
            ['item_id' => 'dirty_rag', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'assassin_hood', 'count' => 1],
        ],
    ],
    'craft_glass_knife' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'glass_shard', 'count' => 3, 'consume' => 'all'],
            ['item_id' => 'cloth',       'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'glass_knife', 'count' => 1],
        ],
    ],
    'craft_wooden_club' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'tree_branch', 'count' => 2, 'consume' => 'all'],
            ['item_id' => 'rope_coil',    'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'wooden_club', 'count' => 1],
        ],
    ],
    'craft_wooden_splint' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'tree_branch', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'cloth',        'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'wooden_splint', 'count' => 1],
        ],
    ],
    'craft_sling' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'tree_branch', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'animal_pelt', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'rope_coil',    'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'sling', 'count' => 1],
        ],
    ],
    'craft_kitchen_knife' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'blade_shard',  'count' => 2, 'consume' => 'all'],
            ['item_id' => 'wooden_stock', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'kitchen_knife', 'count' => 1],
        ],
    ],
    'craft_crowbar' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'scrap_metal', 'count' => 3, 'consume' => 'all'],
            ['item_id' => 'rusty_gear',  'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'crowbar', 'count' => 1],
        ],
    ],
    'craft_self_bow' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'wooden_stock', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'tree_branch',  'count' => 1, 'consume' => 'all'],
            ['item_id' => 'rope_coil',     'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'self_bow', 'count' => 1],
        ],
    ],
    'craft_hunting_arrow_bunch' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'tree_branch', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'blade_shard', 'count' => 3, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'hunting_arrow', 'count' => 3],
        ],
    ],
    'craft_throwing_spear' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'wooden_stock', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'blade_shard',   'count' => 1, 'consume' => 'all'],
            ['item_id' => 'rope_coil',     'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'throwing_spear', 'count' => 1],
        ],
    ],
    'craft_binoculars' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'circuit_board', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'plastic_shard', 'count' => 2, 'consume' => 'all'],
            ['item_id' => 'small_parts',   'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'binoculars', 'count' => 1],
        ],
    ],

    // ─── 需要工作台素材的配方（中阶食物）──────────────────

    'craft_cooked_meat_chunk' => [
        'category'  => 'food',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'raw_meat_chunk',  'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'cooked_meat_chunk', 'count' => 1],
        ],
    ],
    'craft_cured_meat' => [
        'category'  => 'food',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'cooked_meat_chunk', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'old_newspaper',     'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'cured_meat', 'count' => 1],
        ],
    ],
    'craft_concentrated_soup' => [
        'category'  => 'food',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'cooked_meat_chunk', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'swamp_herb',        'count' => 1, 'consume' => 'all'],
            ['item_id' => 'mineral_water',    'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'concentrated_soup', 'count' => 1],
        ],
    ],

    // ================================================================
    // ─── 内容扩充（任务4：基于外部世界实例扩充合成配方）──────────────
    // 设计意图：补全近战/远程/防具/工具/食材 5 类中后期合成路径
    // 参考外部 recipes.json 的"抽象材料 + 工具消耗"模式，
    // 适配本游戏 item_table 的 item_id / itmk / tag 三种匹配形式
    // ================================================================

    // ─── 中阶近战武器配方 ──────────────────────────────

    'craft_sharpened_spear' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'wooden_stock', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'blade_shard',   'count' => 2, 'consume' => 'all'],
            ['item_id' => 'rope_coil',     'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'sharpened_spear', 'count' => 1],
        ],
    ],
    'craft_broad_spear' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'wooden_stock', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'blade_shard',   'count' => 3, 'consume' => 'all'],
            ['item_id' => 'cloth',         'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'broad_spear', 'count' => 1],
        ],
    ],

    // ─── 中阶远程武器配方 ──────────────────────────────

    'craft_compound_bow' => [
        'category'  => 'weapon',
        'materials' => [
            ['item_id' => 'wooden_stock', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'rope_coil',     'count' => 2, 'consume' => 'all'],
            ['item_id' => 'rusty_gear',    'count' => 2, 'consume' => 'all'],
            ['item_id' => 'scrap_wire',    'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'compound_bow', 'count' => 1],
        ],
    ],

    // ─── 中阶防具配方 ──────────────────────────────

    'craft_beast_hide_coat' => [
        'category'  => 'armor',
        'materials' => [
            ['tag'     => 'tag_sharp', 'count' => 1, 'consume' => 'durability'],
            ['item_id' => 'animal_pelt', 'count' => 4, 'consume' => 'all'],
            ['item_id' => 'rope_coil',   'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'beast_hide_coat', 'count' => 1],
        ],
    ],
    'craft_scrap_metal_raincoat' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'scrap_metal',  'count' => 4, 'consume' => 'all'],
            ['item_id' => 'tarpaulin',    'count' => 1, 'consume' => 'all'],
            ['item_id' => 'scrap_wire',   'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'scrap_metal_raincoat', 'count' => 1],
        ],
    ],
    'craft_tactical_vest' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'scrap_metal',  'count' => 4, 'consume' => 'all'],
            ['item_id' => 'cloth',        'count' => 3, 'consume' => 'all'],
            ['item_id' => 'small_parts',  'count' => 2, 'consume' => 'all'],
            ['item_id' => 'scrap_wire',   'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'tactical_vest', 'count' => 1],
        ],
    ],
    'craft_combat_boots' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'animal_pelt', 'count' => 2, 'consume' => 'all'],
            ['item_id' => 'scrap_metal', 'count' => 2, 'consume' => 'all'],
            ['item_id' => 'rope_coil',   'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'combat_boots', 'count' => 1],
        ],
    ],
    'craft_tactical_gloves' => [
        'category'  => 'armor',
        'materials' => [
            ['item_id' => 'cloth',       'count' => 2, 'consume' => 'all'],
            ['item_id' => 'animal_pelt', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'scrap_wire',  'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'tactical_gloves', 'count' => 1],
        ],
    ],

    // ─── 中阶工具/工作台配方 ──────────────────────────────

    'craft_flashlight' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'circuit_board', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'aa_battery',     'count' => 2, 'consume' => 'all'],
            ['item_id' => 'plastic_shard',  'count' => 2, 'consume' => 'all'],
            ['item_id' => 'small_parts',    'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'flashlight', 'count' => 1],
        ],
    ],
    'craft_lighter' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'scrap_metal', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'small_parts', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'aa_battery',  'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'lighter', 'count' => 1],
        ],
    ],

    // ─── 布料精炼配方（需烹饪工作台煮沸消毒）──────────────────

    'craft_clean_cloth_boil' => [
        'category'  => 'tool',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'dirty_rag',     'count' => 2, 'consume' => 'all'],
            ['item_id' => 'mineral_water', 'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'clean_cloth', 'count' => 2],
        ],
    ],
    'craft_clean_cloth_disinfect' => [
        'category'  => 'tool',
        'materials' => [
            ['item_id' => 'dirty_rag', 'count' => 2, 'consume' => 'all'],
            ['item_id' => 'whiskey',    'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'clean_cloth', 'count' => 2],
        ],
    ],

    // ─── 烹饪配方扩展（需烹饪工作台）──────────────────

    'craft_cooked_mushroom' => [
        'category'  => 'food',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'wild_mushroom', 'count' => 2, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'simple_stew', 'count' => 1],
        ],
    ],
    'craft_wild_stew' => [
        'category'  => 'food',
        'materials' => [
            ['tag'     => 'tag_tool_cooking', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],
            ['item_id' => 'raw_meat_chunk', 'count' => 1, 'consume' => 'all'],
            ['item_id' => 'wild_mushroom',  'count' => 1, 'consume' => 'all'],
            ['item_id' => 'berries',         'count' => 1, 'consume' => 'all'],
        ],
        'results'   => [
            ['item_id' => 'concentrated_soup', 'count' => 1],
        ],
    ],
];
