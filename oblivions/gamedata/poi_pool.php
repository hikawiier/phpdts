<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions POI 刷新池
// 按潮汐区配置，开局时在对应区域生成 POI 实例
// tide: 限定生成在哪种潮汐区
// per_region: 每区域生成数量
// ================================================================

return [
    // ─── 浅水区 (shallow) ──────────────────────────────────

    'shallow' => [
        ['poi_id' => 'supply_cache', 'per_region' => 2],
        ['poi_id' => 'scrap_pile',   'per_region' => 3],
        ['poi_id' => 'landmark',     'per_region' => 1],
    ],

    // ─── 深水区 (deep) ──────────────────────────────────

    'deep' => [
        ['poi_id' => 'danger_chest', 'per_region' => 2],
        ['poi_id' => 'swamp_spring', 'per_region' => 1],
        ['poi_id' => 'life_totem',   'per_region' => 1],
    ],

    // ─── 深渊区 (abyss) ──────────────────────────────────

    'abyss' => [
        ['poi_id' => 'ancient_relic', 'per_region' => 1],
        ['poi_id' => 'skill_totem',   'per_region' => 1],
    ],
];
