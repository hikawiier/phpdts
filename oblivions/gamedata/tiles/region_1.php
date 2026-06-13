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
            2,
            7,
            34
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
            31,
            32,
            34
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
            21,
            22,
            31,
            32
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
            20,
            21,
            22,
            5
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
            20,
            21,
            23,
            33
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
            23,
            28,
            33,
            5
        ],
        'x' => 7,
        'y' => 0
    ],
    '7' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            1,
            2,
            8,
            31,
            32,
            34,
            35,
            36
        ],
        'x' => 1,
        'y' => 1,
        'preset_safe' => false
    ],
    '8' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            7,
            9,
            12,
            13,
            22,
            31,
            36,
            37
        ],
        'x' => 2,
        'y' => 2,
        'preset_safe' => false
    ],
    '9' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8,
            10,
            11,
            12,
            13,
            14,
            15,
            16
        ],
        'x' => 3,
        'y' => 3,
        'preset_safe' => false
    ],
    '10' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            9,
            11,
            12,
            15,
            16,
            17,
            18,
            19
        ],
        'x' => 4,
        'y' => 3,
        'preset_safe' => false
    ],
    '11' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            9,
            10,
            12,
            18,
            19,
            20,
            21,
            22
        ],
        'x' => 4,
        'y' => 2,
        'preset_safe' => false
    ],
    '12' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => false,
        'destructible' => false,
        'neighbors' => [
            8,
            11,
            9,
            10,
            13,
            21,
            22,
            31
        ],
        'x' => 3,
        'y' => 2,
        'preset_safe' => false
    ],
    '13' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8,
            12,
            9,
            14,
            15,
            36,
            37,
            40
        ],
        'x' => 2,
        'y' => 3,
        'preset_safe' => false
    ],
    '14' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            13,
            9,
            15,
            37,
            40,
            41,
            43,
            44
        ],
        'x' => 2,
        'y' => 4,
        'preset_safe' => false
    ],
    '15' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            13,
            9,
            10,
            14,
            16,
            43,
            44,
            45
        ],
        'x' => 3,
        'y' => 4,
        'preset_safe' => false
    ],
    '16' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            9,
            10,
            15,
            17,
            18,
            43,
            45,
            46
        ],
        'x' => 4,
        'y' => 4,
        'preset_safe' => false
    ],
    '17' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            10,
            16,
            18,
            25,
            26,
            45,
            46,
            47
        ],
        'x' => 5,
        'y' => 4,
        'preset_safe' => false
    ],
    '18' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            11,
            10,
            16,
            17,
            19,
            24,
            25,
            26
        ],
        'x' => 5,
        'y' => 3,
        'preset_safe' => false
    ],
    '19' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            11,
            10,
            18,
            20,
            21,
            23,
            24,
            26
        ],
        'x' => 5,
        'y' => 2,
        'preset_safe' => false
    ],
    '20' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            4,
            11,
            19,
            21,
            23,
            24,
            33,
            5
        ],
        'x' => 5,
        'y' => 1,
        'preset_safe' => false
    ],
    '21' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => false,
        'destructible' => false,
        'neighbors' => [
            3,
            4,
            20,
            12,
            11,
            19,
            22,
            5
        ],
        'x' => 4,
        'y' => 1,
        'preset_safe' => false
    ],
    '22' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            3,
            4,
            21,
            8,
            12,
            11,
            31,
            32
        ],
        'x' => 3,
        'y' => 1,
        'preset_safe' => false
    ],
    '23' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            6,
            20,
            19,
            24,
            27,
            28,
            33,
            5
        ],
        'x' => 6,
        'y' => 1,
        'preset_safe' => false
    ],
    '24' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            20,
            23,
            19,
            18,
            26,
            27,
            28,
            29
        ],
        'x' => 6,
        'y' => 2,
        'preset_safe' => false
    ],
    '25' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            17,
            26,
            29,
            30,
            46,
            47,
            48
        ],
        'x' => 6,
        'y' => 4,
        'preset_safe' => false
    ],
    '26' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            19,
            24,
            18,
            17,
            25,
            27,
            29,
            30
        ],
        'x' => 6,
        'y' => 3,
        'preset_safe' => false
    ],
    '27' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            23,
            24,
            26,
            28,
            29
        ],
        'x' => 7,
        'y' => 2,
        'preset_safe' => false
    ],
    '28' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            6,
            23,
            24,
            27,
            33
        ],
        'x' => 7,
        'y' => 1,
        'preset_safe' => false
    ],
    '29' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            24,
            27,
            26,
            25,
            30
        ],
        'x' => 7,
        'y' => 3,
        'preset_safe' => false
    ],
    '30' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            26,
            29,
            25,
            47,
            48
        ],
        'x' => 7,
        'y' => 4,
        'preset_safe' => false
    ],
    '31' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            2,
            3,
            7,
            22,
            8,
            12,
            32,
            36
        ],
        'x' => 2,
        'y' => 1,
        'preset_safe' => false
    ],
    '32' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            2,
            3,
            7,
            31,
            22
        ],
        'x' => 2,
        'y' => 0,
        'preset_safe' => false
    ],
    '33' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            6,
            20,
            23,
            28,
            5
        ],
        'x' => 6,
        'y' => 0,
        'preset_safe' => false
    ],
    '34' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            1,
            2,
            7,
            35,
            36
        ],
        'x' => 0,
        'y' => 1,
        'preset_safe' => false
    ],
    '35' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            34,
            7,
            36,
            37,
            38
        ],
        'x' => 0,
        'y' => 2,
        'preset_safe' => false
    ],
    '36' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            34,
            7,
            31,
            35,
            8,
            13,
            37,
            38
        ],
        'x' => 1,
        'y' => 2,
        'preset_safe' => false
    ],
    '37' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            35,
            36,
            8,
            13,
            14,
            38,
            39,
            40
        ],
        'x' => 1,
        'y' => 3,
        'preset_safe' => false
    ],
    '38' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            35,
            36,
            37,
            39,
            40
        ],
        'x' => 0,
        'y' => 3,
        'preset_safe' => false
    ],
    '39' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            38,
            37,
            40,
            41,
            42
        ],
        'x' => 0,
        'y' => 4,
        'preset_safe' => false
    ],
    '40' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            38,
            37,
            13,
            39,
            14,
            41,
            42,
            44
        ],
        'x' => 1,
        'y' => 4,
        'preset_safe' => false
    ],
    '41' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            39,
            40,
            14,
            42,
            44
        ],
        'x' => 1,
        'y' => 5,
        'preset_safe' => false
    ],
    '42' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            39,
            40,
            41
        ],
        'x' => 0,
        'y' => 5,
        'preset_safe' => false
    ],
    '43' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            14,
            15,
            16,
            44,
            45
        ],
        'x' => 3,
        'y' => 5,
        'preset_safe' => false
    ],
    '44' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            40,
            14,
            15,
            41,
            43
        ],
        'x' => 2,
        'y' => 5,
        'preset_safe' => false
    ],
    '45' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            15,
            16,
            17,
            43,
            46
        ],
        'x' => 4,
        'y' => 5,
        'preset_safe' => false
    ],
    '46' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            16,
            17,
            25,
            45,
            47
        ],
        'x' => 5,
        'y' => 5,
        'preset_safe' => false
    ],
    '47' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            17,
            25,
            30,
            46,
            48
        ],
        'x' => 6,
        'y' => 5,
        'preset_safe' => false
    ],
    '48' => [
        'name' => '新地图格',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            25,
            30,
            47
        ],
        'x' => 7,
        'y' => 5,
        'preset_safe' => false
    ]
];
