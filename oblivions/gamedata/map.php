<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 地图数据 — 区域元数据 + 网格布局
// 地图格数据按区域拆分至 tiles/region_{pgroup}.php，按需加载
// 数据结构：regions[pgroup] + grids[pgroup]
// pls 范围 1-254，区域内局部索引，pls=0 保留不使用
// ================================================================

return [
    'regions' => [
    '1' => [
        'name' => '垃圾平原',
        'desc' => '堆积着废弃物的荒原，散发着腐朽金属的气味。',
        'entrance_pls' => 1,
        'exit_pls' => 6,
        'next_region' => 2,
        'prev_region' => null,
        'exit_links' => [
            2
        ],
        'cols' => 11,
        'rows' => 11
    ],
    '2' => [
        'name' => '腐烂沼泽',
        'desc' => '散发着恶臭的泥泞湿地，每一步都可能陷入未知的深渊。',
        'entrance_pls' => 1,
        'exit_pls' => 4,
        'next_region' => null,
        'prev_region' => 1,
        'exit_links' => [],
        'cols' => 11,
        'rows' => 11
    ]
],
    'grids' => [
    '1' => [
        'cols' => 11,
        'rows' => 11
    ],
    '2' => [
        'cols' => 11,
        'rows' => 11
    ]
],
];
