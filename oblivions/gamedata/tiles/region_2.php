<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 地图格数据 — 区域 2：区域数据
// pls 范围 1-254，区域内局部索引
// ================================================================

return [
    '1' => [
        'name' => '沼泽入口',
        'desc' => '从垃圾平原的出口踏入这片散发着恶臭的湿地，脚底传来黏腻的触感。',
        'floor' => 'water',
        'tide' => 'deep',
        'passable' => true,
        'neighbors' => [
            2
        ],
        'x' => 0,
        'y' => 0
    ],
    '2' => [
        'name' => '泥泞小径',
        'desc' => '勉强能辨认出的小路已被泥水淹没大半，每一步都艰难无比。',
        'floor' => 'water',
        'tide' => 'deep',
        'passable' => true,
        'neighbors' => [
            1,
            3
        ],
        'x' => 1,
        'y' => 0
    ],
    '3' => [
        'name' => '枯萎的树丛',
        'desc' => '几棵枯死的老树扭曲地矗立在沼泽中央，枝干上挂满了不明黏液。',
        'floor' => 'vegetation',
        'tide' => 'deep',
        'passable' => true,
        'neighbors' => [
            2,
            4
        ],
        'x' => 3,
        'y' => 0
    ],
    '4' => [
        'name' => '沼泽深处',
        'desc' => '雾气越来越浓，前方似乎已经是沼泽的尽头……但谁知道呢？',
        'floor' => 'water',
        'tide' => 'abyss',
        'passable' => true,
        'neighbors' => [
            3
        ],
        'x' => 5,
        'y' => 0
    ]
];
