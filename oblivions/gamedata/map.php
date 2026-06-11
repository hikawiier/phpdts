<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 地图数据 — 区域 + 地图格 + 网格布局
// 数据结构：regions[pgroup] + tiles[pgroup][pls] + grids[pgroup]
// pls 范围 1-254，区域内局部索引，pls=0 保留不使用
// ================================================================

return [
    'regions' => [
        1 => [
            'name'          => '垃圾平原',
            'desc'          => '堆积着废弃物的荒原，散发着腐朽金属的气味。',
            'entrance_pls'  => 1,
            'exit_pls'      => 6,
            'next_region'   => 2,
            'prev_region'   => null,
            'exit_links'    => [2],
        ],
        2 => [
            'name'          => '腐烂沼泽',
            'desc'          => '散发着恶臭的泥泞湿地，每一步都可能陷入未知的深渊。',
            'entrance_pls'  => 1,
            'exit_pls'      => 4,
            'next_region'   => null,
            'prev_region'   => 1,
            'exit_links'    => [],
        ],
    ],
    'tiles' => [
        // ===== 区域 1：垃圾平原 (8×6) =====
        1 => [
            1 => [
                'name'      => '废弃的入口',
                'desc'      => '一处被铁丝网半围着的缺口，是进入垃圾平原的唯一入口。',
                'floor'     => 'standard',
                'tide'      => 'shallow',
                'passable'  => true,
                'neighbors' => [2],
                'x'         => 0, 'y' => 0,
            ],
            2 => [
                'name'      => '散落的零件堆',
                'desc'      => '废弃机械零件凌乱地散落在地面，踩上去嘎吱作响。',
                'floor'     => 'metal',
                'tide'      => 'shallow',
                'passable'  => true,
                'neighbors' => [1, 3],
                'x'         => 1, 'y' => 0,
            ],
            3 => [
                'name'      => '废旧轮胎山',
                'desc'      => '堆积如山的废旧轮胎，有些还在缓慢燃烧，黑烟刺鼻。',
                'floor'     => 'standard',
                'tide'      => 'shallow',
                'passable'  => true,
                'neighbors' => [2, 4],
                'x'         => 3, 'y' => 0,
            ],
            4 => [
                'name'      => '生锈的管道',
                'desc'      => '巨大的金属管道横卧在地面，锈迹斑斑。可以从下方钻过去。',
                'floor'     => 'metal',
                'tide'      => 'deep',
                'passable'  => true,
                'neighbors' => [3, 6],
                'x'         => 4, 'y' => 0,
            ],
            5 => [
                'name'      => '高耸的废铁山',
                'desc'      => '堆积如山的废铁阻挡了去路，无法通过。也许需要绕道。',
                'floor'     => 'metal',
                'tide'      => 'shallow',
                'passable'  => false,
                'neighbors' => [4, 6],
                'x'         => 5, 'y' => 0,
            ],
            6 => [
                'name'      => '平原尽头',
                'desc'      => '垃圾平原的尽头，前方隐约可见一片阴森的沼泽地。',
                'floor'     => 'standard',
                'tide'      => 'shallow',
                'passable'  => true,
                'neighbors' => [4],
                'x'         => 7, 'y' => 0,
            ],
        ],
        // ===== 区域 2：腐烂沼泽 (6×4) =====
        2 => [
            1 => [
                'name'      => '沼泽入口',
                'desc'      => '从垃圾平原的出口踏入这片散发着恶臭的湿地，脚底传来黏腻的触感。',
                'floor'     => 'water',
                'tide'      => 'deep',
                'passable'  => true,
                'neighbors' => [2],
                'x'         => 0, 'y' => 0,
            ],
            2 => [
                'name'      => '泥泞小径',
                'desc'      => '勉强能辨认出的小路已被泥水淹没大半，每一步都艰难无比。',
                'floor'     => 'water',
                'tide'      => 'deep',
                'passable'  => true,
                'neighbors' => [1, 3],
                'x'         => 1, 'y' => 0,
            ],
            3 => [
                'name'      => '枯萎的树丛',
                'desc'      => '几棵枯死的老树扭曲地矗立在沼泽中央，枝干上挂满了不明黏液。',
                'floor'     => 'vegetation',
                'tide'      => 'deep',
                'passable'  => true,
                'neighbors' => [2, 4],
                'x'         => 3, 'y' => 0,
            ],
            4 => [
                'name'      => '沼泽深处',
                'desc'      => '雾气越来越浓，前方似乎已经是沼泽的尽头……但谁知道呢？',
                'floor'     => 'water',
                'tide'      => 'abyss',
                'passable'  => true,
                'neighbors' => [3],
                'x'         => 5, 'y' => 0,
            ],
        ],
    ],
    'grids' => [
        1 => ['cols' => 8, 'rows' => 6],
        2 => ['cols' => 6, 'rows' => 4],
    ],
];