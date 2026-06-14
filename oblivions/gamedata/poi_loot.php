<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions POI 掉落表
// POI ID → 首次掉落表 (loot) / 重复搜索掉落表 (repeat_loot)
// 每条独立按 rate 判定，一次搜索可能掉落 0~N 种道具
// 字段：item_id(关联item_table) / count(int或[min,max]) / rate(0-1)
// ================================================================

return [
    // ─── 浅水区 ──────────────────────────────────────────

    'supply_cache' => [
        'loot' => [
            ['item_id' => 'supply_pack',    'count' => [2,4],  'rate' => 1.0],
            ['item_id' => 'health_potion',  'count' => [1,2],  'rate' => 0.6],
            ['item_id' => 'stamina_potion', 'count' => 1,      'rate' => 0.4],
        ],
    ],

    'scrap_pile' => [
        'loot' => [
            ['item_id' => 'scrap_metal',  'count' => [2,5], 'rate' => 1.0],
            ['item_id' => 'rusty_gear',   'count' => [1,3], 'rate' => 0.8],
            ['item_id' => 'rusty_pipe',   'count' => 1,     'rate' => 0.3],
        ],
        'repeat_loot' => [
            ['item_id' => 'scrap_metal',  'count' => [1,2], 'rate' => 0.7],
            ['item_id' => 'rusty_gear',   'count' => 1,     'rate' => 0.4],
        ],
    ],

    'landmark' => [
        // 不可搜索，无掉落表
    ],

    // ─── 深水区 ──────────────────────────────────────────

    'danger_chest' => [
        'loot' => [
            ['item_id' => 'nail_gun',       'count' => 1,      'rate' => 0.3],
            ['item_id' => 'swamp_cloak',    'count' => 1,      'rate' => 0.2],
            ['item_id' => 'supply_pack',    'count' => [3,5],  'rate' => 1.0],
            ['item_id' => 'health_potion',  'count' => [1,3],  'rate' => 0.8],
        ],
    ],

    'swamp_spring' => [
        'loot' => [
            ['item_id' => 'health_potion', 'count' => 1, 'rate' => 1.0],
            ['item_id' => 'antidote',      'count' => 1, 'rate' => 0.5],
        ],
        'repeat_loot' => [
            ['item_id' => 'swamp_herb',    'count' => [1,2], 'rate' => 0.8],
            ['item_id' => 'antidote',      'count' => 1,     'rate' => 0.3],
        ],
    ],

    'life_totem' => [
        // 机制触发型，无道具掉落
    ],

    // ─── 深渊区 ──────────────────────────────────────────

    'ancient_relic' => [
        'loot' => [
            ['item_id' => 'ancient_core',       'count' => 1,  'rate' => 1.0],
            ['item_id' => 'ancient_core_blade', 'count' => 1,  'rate' => 0.15],
            ['item_id' => 'element_pocket',     'count' => 1,  'rate' => 0.3],
        ],
    ],

    'skill_totem' => [
        // 机制触发型，无道具掉落
    ],
];
