<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions POI 刷新池
// 按潮汐区配置，开局时在对应区域生成 POI 实例
// tide: 限定生成在哪种潮汐区
// per_region: 每区域生成数量
// ================================================================

return [
    // ─── 浅水区 (shallow) ──────────────────────────────────
    // 基础补给与低危搜索点为主，新增武器柜/工具间/废弃厨房增加搜索多样性
    // 任务4 补充：废弃住宅/服装店/汽车残骸补全浅水废土场景

    'shallow' => [
        ['poi_id' => 'supply_cache',      'per_region' => 2],
        ['poi_id' => 'scrap_pile',         'per_region' => 3],
        ['poi_id' => 'landmark',           'per_region' => 1],
        ['poi_id' => 'weapon_locker',      'per_region' => 1],
        ['poi_id' => 'tool_cabinet',       'per_region' => 1],
        ['poi_id' => 'abandoned_kitchen',   'per_region' => 1],
        ['poi_id' => 'abandoned_house',    'per_region' => 1],
        ['poi_id' => 'clothing_store',     'per_region' => 1],
        ['poi_id' => 'vehicle_wreck',      'per_region' => 2],
    ],

    // ─── 深水区 (deep) ──────────────────────────────────
    // 中阶装备与文献/医疗/机械间，新增猎人储藏提供远程武器来源
    // 任务4 补充：办公楼/林中小屋/营火点/草药园丰富深水探索路径

    'deep' => [
        ['poi_id' => 'danger_chest',         'per_region' => 2],
        ['poi_id' => 'swamp_spring',         'per_region' => 1],
        ['poi_id' => 'life_totem',           'per_region' => 1],
        ['poi_id' => 'abandoned_library',    'per_region' => 1],
        ['poi_id' => 'mechanic_workshop',    'per_region' => 1],
        ['poi_id' => 'pharmacy',             'per_region' => 1],
        ['poi_id' => 'hunter_cache',         'per_region' => 1],
        ['poi_id' => 'office_building',      'per_region' => 1],
        ['poi_id' => 'forest_cabin',         'per_region' => 1],
        ['poi_id' => 'campfire_site',        'per_region' => 2],
        ['poi_id' => 'herb_garden',          'per_region' => 1],
    ],

    // ─── 深渊区 (abyss) ──────────────────────────────────
    // 稀有高回报 POI：古代遗物 + 神秘祭坛，高危但产出史诗装备/核心

    'abyss' => [
        ['poi_id' => 'ancient_relic',  'per_region' => 1],
        ['poi_id' => 'skill_totem',    'per_region' => 1],
        ['poi_id' => 'mystic_shrine',  'per_region' => 1],
    ],
];
