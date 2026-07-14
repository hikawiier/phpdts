<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 野生散落道具池
// 按潮汐区配置，初始化时在地图格上随机生成 iaid=0 的道具
// 每格独立判定是否生成，生成的道具 discovered=0（迷雾中不可见）
// ================================================================

return [
    // ─── 浅水区 (shallow) ──────────────────────────────────
    // 垃圾平原常见废料和基础补给

    'shallow' => [
        ['item_id' => 'scrap_metal',   'count' => [1,3], 'rate' => 0.6],
        ['item_id' => 'rusty_gear',    'count' => 1,     'rate' => 0.3],
        ['item_id' => 'rope_coil',     'count' => 1,     'rate' => 0.1],
        ['item_id' => 'supply_pack',   'count' => 1,     'rate' => 0.15],
    ],

    // ─── 深水区 (deep) ──────────────────────────────────
    // 腐烂沼泽的草药和解毒剂

    'deep' => [
        ['item_id' => 'swamp_herb',    'count' => [1,2], 'rate' => 0.4],
        ['item_id' => 'antidote',      'count' => 1,     'rate' => 0.2],
        ['item_id' => 'scrap_metal',   'count' => 1,     'rate' => 0.2],
        ['item_id' => 'rust_circlet',  'count' => 1,     'rate' => 0.05],
    ],

    // ─── 深渊区 (abyss) ──────────────────────────────────
    // 稀有材料，偶尔有好东西

    'abyss' => [
        ['item_id' => 'ancient_core',  'count' => 1,     'rate' => 0.05],
        ['item_id' => 'scrap_metal',   'count' => 1,     'rate' => 0.15],
        ['item_id' => 'bone_amulet',   'count' => 1,     'rate' => 0.08],
    ],
];
