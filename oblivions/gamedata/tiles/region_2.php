<?php
/**
 * @module E 游戏逻辑
 */
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
        'x' => 8,
        'y' => 1
    ],
    '2' => [
        'name' => '泥泞小径',
        'desc' => '勉强能辨认出的小路已被泥水淹没大半，每一步都艰难无比。',
        'floor' => 'water',
        'tide' => 'deep',
        'passable' => true,
        'neighbors' => [
            1,
            3,
            5
        ],
        'x' => 7,
        'y' => 2
    ],
    '3' => [
        'name' => '枯萎的树丛',
        'desc' => '几棵枯死的老树扭曲地矗立在沼泽中央，枝干上挂满了不明黏液。',
        'floor' => 'vegetation',
        'tide' => 'deep',
        'passable' => true,
        'neighbors' => [
            2,
            5,
            16,
            17,
            21
        ],
        'x' => 6,
        'y' => 3
    ],
    '4' => [
        'name' => '沼泽深处',
        'desc' => '雾气越来越浓，前方似乎已经是沼泽的尽头……但谁知道呢？',
        'floor' => 'water',
        'tide' => 'abyss',
        'passable' => true,
        'neighbors' => [
            15
        ],
        'x' => 2,
        'y' => 8
    ],
    '5' => [
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
            6
        ],
        'x' => 7,
        'y' => 3,
        'preset_safe' => false
    ],
    '6' => [
        'name' => '',
        'desc' => '',
        'floor' => 'standard',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            5,
            7
        ],
        'x' => 8,
        'y' => 4,
        'preset_safe' => false
    ],
    '7' => [
        'name' => '',
        'desc' => '',
        'floor' => 'vegetation',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            6,
            8
        ],
        'x' => 9,
        'y' => 5,
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
            7,
            9
        ],
        'x' => 9,
        'y' => 6,
        'preset_safe' => false
    ],
    '9' => [
        'name' => '',
        'desc' => '',
        'floor' => 'vegetation',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            8,
            10,
            11
        ],
        'x' => 8,
        'y' => 7,
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
        'x' => 8,
        'y' => 8,
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
            9,
            10,
            12
        ],
        'x' => 7,
        'y' => 8,
        'preset_safe' => false
    ],
    '12' => [
        'name' => '',
        'desc' => '',
        'floor' => 'water',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            11,
            13
        ],
        'x' => 6,
        'y' => 9,
        'preset_safe' => false
    ],
    '13' => [
        'name' => '',
        'desc' => '',
        'floor' => 'vegetation',
        'tide' => 'shallow',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            12,
            14
        ],
        'x' => 5,
        'y' => 9,
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
            13,
            15
        ],
        'x' => 4,
        'y' => 9,
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
            4,
            14
        ],
        'x' => 3,
        'y' => 9,
        'preset_safe' => false
    ],
    '16' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            3,
            17,
            18,
            19,
            20,
            21
        ],
        'x' => 5,
        'y' => 3,
        'preset_safe' => false
    ],
    '17' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            16,
            3,
            18,
            19,
            28,
            29
        ],
        'x' => 5,
        'y' => 2,
        'preset_safe' => false
    ],
    '18' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            17,
            16,
            19,
            26,
            27,
            28,
            29,
            30
        ],
        'x' => 4,
        'y' => 2,
        'preset_safe' => false
    ],
    '19' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            17,
            16,
            20,
            21,
            25,
            26,
            27
        ],
        'x' => 4,
        'y' => 3,
        'preset_safe' => false
    ],
    '20' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            19,
            16,
            21,
            22,
            23,
            24,
            25,
            26
        ],
        'x' => 4,
        'y' => 4,
        'preset_safe' => false
    ],
    '21' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            19,
            16,
            3,
            20,
            22,
            23
        ],
        'x' => 5,
        'y' => 4,
        'preset_safe' => false
    ],
    '22' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            20,
            21,
            23
        ],
        'x' => 5,
        'y' => 5,
        'preset_safe' => false
    ],
    '23' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            20,
            21,
            22,
            24,
            25
        ],
        'x' => 4,
        'y' => 5,
        'preset_safe' => false
    ],
    '24' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            20,
            23,
            25,
            33,
            38
        ],
        'x' => 3,
        'y' => 5,
        'preset_safe' => false
    ],
    '25' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            19,
            20,
            24,
            23,
            26,
            32,
            33,
            38
        ],
        'x' => 3,
        'y' => 4,
        'preset_safe' => false
    ],
    '26' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            19,
            25,
            20,
            27,
            31,
            32,
            33
        ],
        'x' => 3,
        'y' => 3,
        'preset_safe' => false
    ],
    '27' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            26,
            19,
            29,
            30,
            31,
            32,
            37
        ],
        'x' => 3,
        'y' => 2,
        'preset_safe' => false
    ],
    '28' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            18,
            17,
            29
        ],
        'x' => 5,
        'y' => 1,
        'preset_safe' => false
    ],
    '29' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            28,
            27,
            18,
            17,
            30
        ],
        'x' => 4,
        'y' => 1,
        'preset_safe' => false
    ],
    '30' => [
        'name' => '',
        'desc' => '',
        'floor' => 'metal',
        'tide' => 'deep',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            29,
            27,
            18,
            31,
            37
        ],
        'x' => 3,
        'y' => 1,
        'preset_safe' => false
    ],
    '31' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            30,
            27,
            26,
            32,
            35,
            36,
            37
        ],
        'x' => 2,
        'y' => 2,
        'preset_safe' => false
    ],
    '32' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            31,
            27,
            26,
            25,
            33,
            34,
            35,
            36
        ],
        'x' => 2,
        'y' => 3,
        'preset_safe' => false
    ],
    '33' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            32,
            26,
            25,
            24,
            34,
            35,
            38
        ],
        'x' => 2,
        'y' => 4,
        'preset_safe' => false
    ],
    '34' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            32,
            33,
            35,
            38,
            39
        ],
        'x' => 1,
        'y' => 4,
        'preset_safe' => false
    ],
    '35' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            31,
            32,
            34,
            33,
            36,
            39
        ],
        'x' => 1,
        'y' => 3,
        'preset_safe' => false
    ],
    '36' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            31,
            35,
            32,
            37,
            39
        ],
        'x' => 1,
        'y' => 2,
        'preset_safe' => false
    ],
    '37' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            30,
            36,
            31,
            27
        ],
        'x' => 2,
        'y' => 1,
        'preset_safe' => false
    ],
    '38' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            34,
            33,
            25,
            24
        ],
        'x' => 2,
        'y' => 5,
        'preset_safe' => false
    ],
    '39' => [
        'name' => '',
        'desc' => '',
        'floor' => 'magic',
        'tide' => 'abyss',
        'height' => 0,
        'passable' => true,
        'destructible' => false,
        'neighbors' => [
            36,
            35,
            34
        ],
        'x' => 0,
        'y' => 3,
        'preset_safe' => false
    ]
];
