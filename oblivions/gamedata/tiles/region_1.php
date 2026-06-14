<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 地图格数据 — 区域 1：区域数据
// pls 范围 1-254，区域内局部索引
// ================================================================

return [
    '1' => [
        'name' => '废弃的入口',
        'desc' => '一处被铁丝网半围着的缺口，是进入垃圾平原的唯一入口。',
        'floor' => 'standard',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            2
        ],
        'x' => 0,
        'y' => 0
    ],
    '2' => [
        'name' => '散落的零件堆',
        'desc' => '废弃机械零件凌乱地散落在地面，踩上去嘎吱作响。',
        'floor' => 'metal',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            1,
            3,
            7,
            8
        ],
        'x' => 1,
        'y' => 0
    ],
    '3' => [
        'name' => '废旧轮胎山',
        'desc' => '堆积如山的废旧轮胎，有些还在缓慢燃烧，黑烟刺鼻。',
        'floor' => 'standard',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            2,
            4,
            7,
            8,
            14,
            15
        ],
        'x' => 3,
        'y' => 0
    ],
    '4' => [
        'name' => '生锈的管道',
        'desc' => '巨大的金属管道横卧在地面，锈迹斑斑。可以从下方钻过去。',
        'floor' => 'metal',
        'tide' => 'deep',
        'passable' => true,
        'neighbors' => [
            3,
            6,
            5,
            14,
            15
        ],
        'x' => 4,
        'y' => 0
    ],
    '5' => [
        'name' => '高耸的废铁山',
        'desc' => '堆积如山的废铁阻挡了去路，无法通过。也许需要绕道。',
        'floor' => 'metal',
        'tide' => 'shallow',
        'passable' => false,
        'neighbors' => [
            4,
            6,
            12,
            13,
            14
        ],
        'x' => 5,
        'y' => 0
    ],
    '6' => [
        'name' => '平原尽头',
        'desc' => '垃圾平原的尽头，前方隐约可见一片阴森的沼泽地。',
        'floor' => 'standard',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            4,
            5,
            12,
            13
        ],
        'x' => 7,
        'y' => 0
    ],
    '7' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            2,
            3,
            8,
            15
        ],
        'x' => 2,
        'y' => 0,
        'preset_safe' => false
    ],
    '8' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            2,
            7,
            3,
            9,
            15
        ],
        'x' => 2,
        'y' => 1,
        'preset_safe' => false
    ],
    '9' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8,
            10,
            14,
            15
        ],
        'x' => 3,
        'y' => 2,
        'preset_safe' => false
    ],
    '10' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            9,
            11
        ],
        'x' => 4,
        'y' => 3,
        'preset_safe' => false
    ],
    '11' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            10,
            12,
            14
        ],
        'x' => 5,
        'y' => 2,
        'preset_safe' => false
    ],
    '12' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            5,
            6,
            11,
            13
        ],
        'x' => 6,
        'y' => 1,
        'preset_safe' => false
    ],
    '13' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            5,
            6,
            12
        ],
        'x' => 6,
        'y' => 0,
        'preset_safe' => false
    ],
    '14' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            3,
            4,
            5,
            9,
            11,
            15
        ],
        'x' => 4,
        'y' => 1,
        'preset_safe' => false
    ],
    '15' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            7,
            3,
            4,
            8,
            14,
            9
        ],
        'x' => 3,
        'y' => 1,
        'preset_safe' => false
    ]
];
