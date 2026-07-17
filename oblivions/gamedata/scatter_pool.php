<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 野生散落道具池
// 按潮汐区配置，每个潮汐区分为 initial / refresh 两个相位：
// - initial：区域初始化时（obl_generate_wild_items）使用，rate 较高、池较丰富
// - refresh：时间流逝刷新时（obl_refresh_wild_items）使用，rate 较低、池较稀疏
// 每格独立判定是否生成，生成的道具 discovered=0（迷雾中不可见）
//
// 注意：refresh 相位的 rate 会被 obl_config.php 的
//       wild_item_refresh_rate_by_tide 倍率（shallow 0.5 / deep 1.0 / abyss 1.5）调整
//       配置时按"基础 rate"填写，无需手动折算潮汐倍率
// ================================================================

return [
    // ─── 浅水区 (shallow) ──────────────────────────────────
    // 垃圾平原常见废料和基础补给，少量食物与投掷素材

    'shallow' => [
        'initial' => [
            ['item_id' => 'scrap_metal',   'count' => [1,3], 'rate' => 0.60],
            ['item_id' => 'rusty_gear',    'count' => 1,     'rate' => 0.30],
            ['item_id' => 'crushed_can',   'count' => [1,2], 'rate' => 0.25],
            ['item_id' => 'dirty_rag',     'count' => 1,     'rate' => 0.20],
            ['item_id' => 'tree_branch',   'count' => 1,     'rate' => 0.20],
            ['item_id' => 'stone_pebble',  'count' => [1,3], 'rate' => 0.15],
            ['item_id' => 'rope_coil',     'count' => 1,     'rate' => 0.10],
            ['item_id' => 'supply_pack',   'count' => 1,     'rate' => 0.15],
        ],
        // 刷新相位：环境慢慢补给，只有最基础的废料与少量布料
        'refresh' => [
            ['item_id' => 'scrap_metal',   'count' => 1,     'rate' => 0.25],
            ['item_id' => 'rusty_gear',    'count' => 1,     'rate' => 0.10],
            ['item_id' => 'dirty_rag',     'count' => 1,     'rate' => 0.08],
            ['item_id' => 'tree_branch',   'count' => 1,     'rate' => 0.08],
            ['item_id' => 'crushed_can',   'count' => 1,     'rate' => 0.05],
            ['item_id' => 'stone_pebble',  'count' => 1,     'rate' => 0.05],
        ],
    ],

    // ─── 深水区 (deep) ──────────────────────────────────
    // 腐烂沼泽的草药、解毒剂与中阶装备；草药再生较频繁

    'deep' => [
        'initial' => [
            ['item_id' => 'swamp_herb',     'count' => [1,2], 'rate' => 0.40],
            ['item_id' => 'wild_mushroom', 'count' => 1,     'rate' => 0.25],
            ['item_id' => 'antidote',      'count' => 1,     'rate' => 0.20],
            ['item_id' => 'scrap_metal',   'count' => 1,     'rate' => 0.20],
            ['item_id' => 'bandage',        'count' => 1,     'rate' => 0.15],
            ['item_id' => 'cola',           'count' => 1,     'rate' => 0.10],
            ['item_id' => 'rust_circlet',   'count' => 1,     'rate' => 0.05],
            ['item_id' => 'throwing_spear', 'count' => 1,     'rate' => 0.04],
        ],
        // 刷新相位：草药偶尔再生，少量废料与布料
        'refresh' => [
            ['item_id' => 'swamp_herb',    'count' => 1,     'rate' => 0.15],
            ['item_id' => 'scrap_metal',   'count' => 1,     'rate' => 0.10],
            ['item_id' => 'wild_mushroom', 'count' => 1,     'rate' => 0.08],
            ['item_id' => 'dirty_rag',     'count' => 1,     'rate' => 0.05],
            ['item_id' => 'berries',       'count' => 1,     'rate' => 0.05],
            ['item_id' => 'antidote',      'count' => 1,     'rate' => 0.03],
        ],
    ],

    // ─── 深渊区 (abyss) ──────────────────────────────────
    // 稀有材料、特殊装备与高危高回报道具

    'abyss' => [
        'initial' => [
            ['item_id' => 'scrap_metal',         'count' => 1,    'rate' => 0.15],
            ['item_id' => 'bone_amulet',         'count' => 1,    'rate' => 0.08],
            ['item_id' => 'circuit_board',      'count' => 1,    'rate' => 0.06],
            ['item_id' => 'hunting_arrow',       'count' => [1,2],'rate' => 0.06],
            ['item_id' => 'ancient_core',        'count' => 1,    'rate' => 0.05],
            ['item_id' => 'element_pocket',      'count' => 1,    'rate' => 0.03],
            ['item_id' => 'pipe_bomb',           'count' => 1,    'rate' => 0.02],
            ['item_id' => 'ancient_core_blade',  'count' => 1,    'rate' => 0.01],
        ],
        // 刷新相位：深渊补给缓慢但仍有稀有材料
        'refresh' => [
            ['item_id' => 'scrap_metal',    'count' => 1,    'rate' => 0.10],
            ['item_id' => 'bone_amulet',   'count' => 1,    'rate' => 0.03],
            ['item_id' => 'blade_shard',    'count' => 1,    'rate' => 0.04],
            ['item_id' => 'circuit_board',  'count' => 1,    'rate' => 0.02],
            ['item_id' => 'small_parts',    'count' => 1,    'rate' => 0.03],
            ['item_id' => 'ancient_core',   'count' => 1,    'rate' => 0.01],
        ],
    ],
];
