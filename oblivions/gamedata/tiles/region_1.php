<?php
/**
 * @module E 游戏逻辑
 */
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
            24,
            17,
            5,
            4
        ],
        'x' => 5,
        'y' => 6
    ],
    '2' => [
        'name' => '散落的零件堆',
        'desc' => '废弃机械零件凌乱地散落在地面，踩上去嘎吱作响。',
        'floor' => 'metal',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            23,
            4,
            22,
            21,
            26
        ],
        'x' => 3,
        'y' => 6
    ],
    '3' => [
        'name' => '废旧轮胎山',
        'desc' => '堆积如山的废旧轮胎，有些还在缓慢燃烧，黑烟刺鼻。',
        'floor' => 'standard',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            11,
            44,
            10,
            28,
            29,
            30
        ],
        'x' => 5,
        'y' => 3
    ],
    '4' => [
        'name' => '生锈的管道',
        'desc' => '巨大的金属管道横卧在地面，锈迹斑斑。可以从下方钻过去。',
        'floor' => 'standard',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            27,
            28,
            29,
            23,
            5,
            1,
            2
        ],
        'x' => 4,
        'y' => 5
    ],
    '5' => [
        'name' => '高耸的废铁山',
        'desc' => '堆积如山的废铁阻挡了去路，无法通过。也许需要绕道。',
        'floor' => 'metal',
        'tide' => 'shallow',
        'passable' => false,
        'neighbors' => [
            28,
            29,
            30,
            1,
            4
        ],
        'x' => 5,
        'y' => 5
    ],
    '6' => [
        'name' => '平原尽头',
        'desc' => '垃圾平原的尽头，前方隐约可见一片阴森的沼泽地。',
        'floor' => 'standard',
        'tide' => 'shallow',
        'passable' => true,
        'neighbors' => [
            13,
            12,
            44,
            43,
            42
        ],
        'x' => 7,
        'y' => 1
    ],
    '7' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8
        ],
        'x' => 1,
        'y' => 2,
        'preset_safe' => false
    ],
    '8' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            9,
            15,
            7
        ],
        'x' => 2,
        'y' => 1,
        'preset_safe' => false
    ],
    '9' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8,
            10,
            15,
            14
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
            11,
            27,
            28,
            29,
            3,
            14
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
            44,
            3
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
            11,
            13,
            43,
            44,
            6
        ],
        'x' => 6,
        'y' => 1,
        'preset_safe' => false
    ],
    '13' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            12,
            6
        ],
        'x' => 6,
        'y' => 0,
        'preset_safe' => false
    ],
    '14' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            9,
            10,
            27,
            28
        ],
        'x' => 3,
        'y' => 3,
        'preset_safe' => false
    ],
    '15' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8,
            9
        ],
        'x' => 3,
        'y' => 1,
        'preset_safe' => false
    ],
    '17' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            24,
            1
        ],
        'x' => 6,
        'y' => 7,
        'preset_safe' => false
    ],
    '18' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            17,
            19,
            24,
            25
        ],
        'x' => 5,
        'y' => 8,
        'preset_safe' => false
    ],
    '19' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            20,
            25
        ],
        'x' => 4,
        'y' => 9,
        'preset_safe' => false
    ],
    '20' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            19,
            21,
            25,
            26
        ],
        'x' => 3,
        'y' => 8,
        'preset_safe' => false
    ],
    '21' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            20,
            22,
            26,
            2
        ],
        'x' => 2,
        'y' => 7,
        'preset_safe' => false
    ],
    '22' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            21,
            23,
            26,
            2
        ],
        'x' => 2,
        'y' => 6,
        'preset_safe' => false
    ],
    '23' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            22,
            27,
            28,
            4,
            2
        ],
        'x' => 3,
        'y' => 5,
        'preset_safe' => false
    ],
    '24' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            17,
            18,
            25,
            1
        ],
        'x' => 5,
        'y' => 7,
        'preset_safe' => false
    ],
    '25' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            24,
            20,
            18,
            19,
            26
        ],
        'x' => 4,
        'y' => 8,
        'preset_safe' => false
    ],
    '26' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            22,
            21,
            20,
            25,
            2
        ],
        'x' => 3,
        'y' => 7,
        'preset_safe' => false
    ],
    '27' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            10,
            23,
            28,
            4,
            14
        ],
        'x' => 3,
        'y' => 4,
        'preset_safe' => false
    ],
    '28' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            10,
            27,
            23,
            29,
            5,
            4,
            3,
            14
        ],
        'x' => 4,
        'y' => 4,
        'preset_safe' => false
    ],
    '29' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            10,
            28,
            30,
            5,
            4,
            3
        ],
        'x' => 5,
        'y' => 4,
        'preset_safe' => false
    ],
    '30' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            29,
            31,
            33,
            5,
            3
        ],
        'x' => 6,
        'y' => 4,
        'preset_safe' => false
    ],
    '31' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            30,
            32,
            33,
            34,
            40
        ],
        'x' => 7,
        'y' => 5,
        'preset_safe' => false
    ],
    '32' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            31,
            33,
            34,
            40,
            46,
            47,
            48
        ],
        'x' => 8,
        'y' => 5,
        'preset_safe' => false
    ],
    '33' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            30,
            31,
            32,
            40,
            41
        ],
        'x' => 7,
        'y' => 4,
        'preset_safe' => false
    ],
    '34' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            31,
            32,
            35,
            45,
            46,
            47
        ],
        'x' => 8,
        'y' => 6,
        'preset_safe' => false
    ],
    '35' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            34,
            36,
            45,
            46
        ],
        'x' => 8,
        'y' => 7,
        'preset_safe' => false
    ],
    '36' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            35,
            38,
            39,
            45
        ],
        'x' => 8,
        'y' => 8,
        'preset_safe' => false
    ],
    '38' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            36,
            39
        ],
        'x' => 7,
        'y' => 9,
        'preset_safe' => false
    ],
    '39' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            36,
            38
        ],
        'x' => 8,
        'y' => 9,
        'preset_safe' => false
    ],
    '40' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            33,
            31,
            32,
            41,
            47,
            48,
            49
        ],
        'x' => 8,
        'y' => 4,
        'preset_safe' => false
    ],
    '41' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            33,
            40,
            42,
            43,
            48,
            49
        ],
        'x' => 8,
        'y' => 3,
        'preset_safe' => false
    ],
    '42' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            41,
            43,
            6,
            49
        ],
        'x' => 8,
        'y' => 2,
        'preset_safe' => false
    ],
    '43' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            12,
            42,
            41,
            44,
            6
        ],
        'x' => 7,
        'y' => 2,
        'preset_safe' => false
    ],
    '44' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            12,
            11,
            43,
            6,
            3
        ],
        'x' => 6,
        'y' => 2,
        'preset_safe' => false
    ],
    '45' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            34,
            35,
            36,
            46
        ],
        'x' => 9,
        'y' => 7,
        'preset_safe' => false
    ],
    '46' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            32,
            34,
            35,
            45,
            47
        ],
        'x' => 9,
        'y' => 6,
        'preset_safe' => false
    ],
    '47' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            40,
            32,
            34,
            46,
            48
        ],
        'x' => 9,
        'y' => 5,
        'preset_safe' => false
    ],
    '48' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            41,
            40,
            32,
            47,
            49
        ],
        'x' => 9,
        'y' => 4,
        'preset_safe' => false
    ],
    '49' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            42,
            41,
            40,
            48
        ],
        'x' => 9,
        'y' => 3,
        'preset_safe' => false
    ]
];
