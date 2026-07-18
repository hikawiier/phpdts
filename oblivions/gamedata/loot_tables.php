<?php
/**
 * @module F 物品系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 战利品表（F-4 引擎配置）
//
// 表 ID (string key) → 表定义
// 表 ID 与 POI 模板 ID 共用同一命名空间（"表 ID 即 POI ID"约定）
//
// 结构：groups[] 物品组 + 组内 entries[] 互斥选项 + 表级 durability_decay 开关
// 替代旧 poi_loot.php 的扁平 [['item_id','count','rate']] 结构
//
// 字段语义：
//   - 表级 name               : 表名（日志/调试用）
//   - 表级 durability_decay    : bool 是否对产出物品应用耐久衰减（仅对非 stackable 装备生效）
//   - 表级 groups              : 物品组列表，每组独立掷骰
//   - 组级 chance             : float 0-1 组级概率（先于 entry 判定），默认 1.0
//   - 组级 entries            : 互斥选项列表，按 weight 加权选一
//   - entry item_id           : 物品模板 ID（对应 item_table.php 的 key）
//   - entry weight            : int/float 组内互斥权重（非概率，组内归一化），默认 1
//   - entry count             : int 或 [min,max] 生成数量
//                                - stackable 物品作为 itms（超 stack_limit 自动分批）
//                                - 非 stackable 物品作为实例数
//
// 引擎实现：oblivions/include/game/loot/loot.engine.func.php
// 设计案：oblivions/docs/搜索建筑物与掉落机制重构-模块F-战利品表引擎.md
// ================================================================

return [
    // ─── 医疗物资表（典型三组互斥 + 装备衰减）──────────────────
    'medical_supplies' => [
        'name' => '医疗物资表',
        'durability_decay' => true,    // 启用耐久衰减（仅对非 stackable 装备生效）
        'groups' => [
            // 第一组：100% 出一件基础医疗品（互斥三选一，按权重）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'health_potion',  'weight' => 60, 'count' => 1],
                    ['item_id' => 'stamina_potion', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'antidote',       'weight' => 10, 'count' => 1],
                ],
            ],
            // 第二组：50% 出 1~3 件草药（可堆叠，count 直接作为 itms）
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'swamp_herb', 'weight' => 100, 'count' => [1, 3]],
                ],
            ],
            // 第三组：20% 出一件头部装备（耐久衰减生效）
            [
                'chance' => 0.2,
                'entries' => [
                    ['item_id' => 'rust_circlet', 'weight' => 70, 'count' => 1],
                    ['item_id' => 'bone_amulet',  'weight' => 30, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 废料堆掉落（纯素材 + 装备混出，无衰减）──────────────────
    'scrap_pile_loot' => [
        'name' => '废料堆掉落',
        'durability_decay' => false,   // 纯素材表，无耐久概念
        'groups' => [
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'scrap_metal', 'weight' => 50, 'count' => [2, 5]],
                    ['item_id' => 'rusty_gear',  'weight' => 30, 'count' => [1, 3]],
                    ['item_id' => 'cloth',       'weight' => 20, 'count' => [1, 2]],
                ],
            ],
            [
                'chance' => 0.3,
                'entries' => [
                    ['item_id' => 'rusty_pipe', 'weight' => 100, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 补给箱掉落（消耗品 + 装备混出）──────────────────
    'supply_cache_loot' => [
        'name' => '补给箱掉落',
        'durability_decay' => false,   // 补给包/药剂都是 stackable 数量模型，衰减无意义
        'groups' => [
            // 第一组：必出 2~4 件补给包
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'supply_pack', 'weight' => 100, 'count' => [2, 4]],
                ],
            ],
            // 第二组：60% 出 1~2 件生命药剂
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'health_potion', 'weight' => 100, 'count' => [1, 2]],
                ],
            ],
            // 第三组：40% 出 1 件体力药剂
            [
                'chance' => 0.4,
                'entries' => [
                    ['item_id' => 'stamina_potion', 'weight' => 100, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 弹药基础掉落（投掷武器 + 数量素材）──────────────────
    'ammo_basic' => [
        'name' => '弹药基础掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：互斥三选一（投掷类武器，stackable，count 作为 itms）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'stone_pebble',  'weight' => 50, 'count' => [3, 6]],
                    ['item_id' => 'hunting_arrow', 'weight' => 30, 'count' => [2, 4]],
                    ['item_id' => 'rock',           'weight' => 20, 'count' => [1, 2]],
                ],
            ],
            // 第二组：30% 出 1~2 件素材
            [
                'chance' => 0.3,
                'entries' => [
                    ['item_id' => 'scrap_metal', 'weight' => 60, 'count' => [1, 2]],
                    ['item_id' => 'crushed_can', 'weight' => 40, 'count' => [1, 2]],
                ],
            ],
        ],
    ],

    // ─── 食物储藏掉落（食物 + 饮料，stackable 衰减无意义）──────────────────
    'food_cache' => [
        'name' => '食物储藏掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：互斥食物选一
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'bread',            'weight' => 30, 'count' => [1, 2]],
                    ['item_id' => 'soda_crackers',    'weight' => 25, 'count' => [1, 3]],
                    ['item_id' => 'cooked_meat_chunk','weight' => 20, 'count' => 1],
                    ['item_id' => 'cured_meat',       'weight' => 15, 'count' => 1],
                    ['item_id' => 'berries',          'weight' => 10, 'count' => [2, 4]],
                ],
            ],
            // 第二组：60% 出 1~2 件饮料
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'mineral_water', 'weight' => 50, 'count' => [1, 2]],
                    ['item_id' => 'cola',          'weight' => 30, 'count' => 1],
                    ['item_id' => 'herbal_tea',    'weight' => 20, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 空表（无 groups，返回空数组）──────────────────
    // 用于不可搜索或机制触发型 POI（如 life_totem / skill_totem / landmark）
    'empty_loot' => [
        'name' => '空白表',
        'durability_decay' => false,
        'groups' => [],
    ],

    // ─── 额外补给箱掉落（E-10 find_extra_cache 事件专用）──────────────────
    // 由 obl_event_find_extra_cache 调用 F-4 引擎生成物品实例数组，
    // 通过返回值 items 字段交回 obl_search_poi 物化进 oblmapitem。
    // 物资比 supply_cache_loot 更丰沛（玩家发现"额外"补给箱应感到惊喜）
    'extra_cache_loot' => [
        'name' => '额外补给箱掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出 3~5 件补给包
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'supply_pack', 'weight' => 100, 'count' => [3, 5]],
                ],
            ],
            // 第二组：80% 出 1~3 件生命药剂
            [
                'chance' => 0.8,
                'entries' => [
                    ['item_id' => 'health_potion', 'weight' => 100, 'count' => [1, 3]],
                ],
            ],
            // 第三组：50% 出 1~2 件体力药剂
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'stamina_potion', 'weight' => 100, 'count' => [1, 2]],
                ],
            ],
            // 第四组：30% 出一件防具（耐久衰减生效）
            [
                'chance' => 0.3,
                'entries' => [
                    ['item_id' => 'scrap_vest',  'weight' => 60, 'count' => 1],
                    ['item_id' => 'swamp_cloak', 'weight' => 40, 'count' => 1],
                ],
            ],
        ],
    ],

    // ================================================================
    // ─── 内容扩充（任务3：从外部世界实例挑选并适配本游戏道具表）──────
    // ================================================================

    // ─── 武器柜掉落（武器库 POI）──────────────────
    // 设计意图：高概率出武器 + 投掷弹药；耐久衰减启用（被丢弃前已用过）
    'weapon_locker_loot' => [
        'name' => '武器柜掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：互斥近战武器选一（必出）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'rusty_pipe',    'weight' => 35, 'count' => 1],
                    ['item_id' => 'scrap_blade',   'weight' => 25, 'count' => 1],
                    ['item_id' => 'kitchen_knife', 'weight' => 20, 'count' => 1],
                    ['item_id' => 'crowbar',       'weight' => 15, 'count' => 1],
                    ['item_id' => 'wooden_club',   'weight' => 5,  'count' => 1],
                ],
            ],
            // 第二组：60% 出投掷弹药（堆叠）
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'stone_pebble',  'weight' => 40, 'count' => [3, 6]],
                    ['item_id' => 'hunting_arrow', 'weight' => 35, 'count' => [2, 4]],
                    ['item_id' => 'rock',          'weight' => 25, 'count' => [1, 2]],
                ],
            ],
            // 第三组：20% 出远程武器（耐久衰减）
            [
                'chance' => 0.2,
                'entries' => [
                    ['item_id' => 'sling',        'weight' => 50, 'count' => 1],
                    ['item_id' => 'self_bow',     'weight' => 35, 'count' => 1],
                    ['item_id' => 'nail_gun',     'weight' => 15, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 工具间掉落 ──────────────────
    // 设计意图：工具 + 维修素材；工具多为 stack=false，启用耐久衰减
    'tool_cabinet_loot' => [
        'name' => '工具间掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：互斥工具选一（必出）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'rope_coil',    'weight' => 30, 'count' => 1],
                    ['item_id' => 'lockpick',     'weight' => 25, 'count' => 1],
                    ['item_id' => 'flashlight',   'weight' => 20, 'count' => 1],
                    ['item_id' => 'lighter',      'weight' => 15, 'count' => 1],
                    ['item_id' => 'compass',      'weight' => 10, 'count' => 1],
                ],
            ],
            // 第二组：必出 2~4 件维修素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'scrap_metal',  'weight' => 40, 'count' => [2, 4]],
                    ['item_id' => 'rusty_gear',   'weight' => 30, 'count' => [1, 3]],
                    ['item_id' => 'scrap_wire',   'weight' => 20, 'count' => [1, 2]],
                    ['item_id' => 'small_parts',  'weight' => 10, 'count' => 1],
                ],
            ],
            // 第三组：30% 出高阶工具（耐久衰减）
            [
                'chance' => 0.3,
                'entries' => [
                    ['item_id' => 'lockpick_set',   'weight' => 50, 'count' => 1],
                    ['item_id' => 'multitool_knife', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'water_tester',    'weight' => 20, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 废弃图书馆掉落 ──────────────────
    // 设计意图：纸张素材 + 稀有配件（地图/望远镜/护身符）；无装备，无衰减
    'library_loot' => [
        'name' => '废弃图书馆掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出 3~6 件纸张素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'old_newspaper', 'weight' => 60, 'count' => [3, 6]],
                    ['item_id' => 'dirty_rag',     'weight' => 25, 'count' => [1, 2]],
                    ['item_id' => 'clean_cloth',   'weight' => 15, 'count' => 1],
                ],
            ],
            // 第二组：40% 出一件配件/饰品
            [
                'chance' => 0.4,
                'entries' => [
                    ['item_id' => 'binoculars',      'weight' => 35, 'count' => 1],
                    ['item_id' => 'compass',         'weight' => 30, 'count' => 1],
                    ['item_id' => 'bronze_amulet',   'weight' => 20, 'count' => 1],
                    ['item_id' => 'rifle_scope',     'weight' => 15, 'count' => 1],
                ],
            ],
            // 第三组：15% 出知识类特殊道具
            [
                'chance' => 0.15,
                'entries' => [
                    ['item_id' => 'mystery_box',     'weight' => 60, 'count' => 1],
                    ['item_id' => 'element_pocket',   'weight' => 40, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 机械间掉落 ──────────────────
    // 设计意图：电子零件 + 机械素材；部分稀有高阶材料
    'mechanic_workshop_loot' => [
        'name' => '机械间掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出机械素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'rusty_gear',     'weight' => 35, 'count' => [2, 4]],
                    ['item_id' => 'scrap_metal',    'weight' => 25, 'count' => [1, 3]],
                    ['item_id' => 'small_parts',   'weight' => 20, 'count' => [1, 2]],
                    ['item_id' => 'scrap_wire',     'weight' => 20, 'count' => [1, 2]],
                ],
            ],
            // 第二组：60% 出电子元件
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'circuit_board',  'weight' => 40, 'count' => 1],
                    ['item_id' => 'aa_battery',      'weight' => 35, 'count' => [1, 2]],
                    ['item_id' => 'plastic_shard',   'weight' => 25, 'count' => [1, 2]],
                ],
            ],
            // 第三组：25% 出稀有机械部件
            [
                'chance' => 0.25,
                'entries' => [
                    ['item_id' => 'laptop_battery', 'weight' => 50, 'count' => 1],
                    ['item_id' => 'rifle_barrel',   'weight' => 30, 'count' => 1],
                    ['item_id' => 'wooden_stock',   'weight' => 20, 'count' => 1],
                ],
            ],
            // 第四组：10% 出工具（耐久衰减生效，但本表 durability_decay=false，所以不衰减）
            [
                'chance' => 0.10,
                'entries' => [
                    ['item_id' => 'multitool_knife', 'weight' => 60, 'count' => 1],
                    ['item_id' => 'precision_stove', 'weight' => 40, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 神秘祭坛掉落 ──────────────────
    // 设计意图：深渊区高回报，配饰/核心/特殊；部分概率出装备（耐久衰减）
    'mystic_shrine_loot' => [
        'name' => '神秘祭坛掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：必出一件稀有配饰
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'bone_amulet',     'weight' => 35, 'count' => 1],
                    ['item_id' => 'bronze_amulet',   'weight' => 25, 'count' => 1],
                    ['item_id' => 'rust_circlet',    'weight' => 20, 'count' => 1],
                    ['item_id' => 'element_pocket',  'weight' => 15, 'count' => 1],
                    ['item_id' => 'mystery_box',     'weight' => 5,  'count' => 1],
                ],
            ],
            // 第二组：70% 出古代核心
            [
                'chance' => 0.7,
                'entries' => [
                    ['item_id' => 'ancient_core', 'weight' => 100, 'count' => 1],
                ],
            ],
            // 第三组：30% 出一件史诗装备（耐久衰减）
            [
                'chance' => 0.30,
                'entries' => [
                    ['item_id' => 'ancient_core_blade', 'weight' => 50, 'count' => 1],
                    ['item_id' => 'night_vision_goggles','weight' => 30, 'count' => 1],
                    ['item_id' => 'gas_mask',             'weight' => 20, 'count' => 1],
                ],
            ],
            // 第四组：10% 出特殊武器 pipe_bomb
            [
                'chance' => 0.10,
                'entries' => [
                    ['item_id' => 'pipe_bomb', 'weight' => 100, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 废弃厨房掉落 ──────────────────
    // 设计意图：食物 + 饮料 + 烹饪工具；耐久衰减无意义（消耗品堆叠）
    'kitchen_loot' => [
        'name' => '废弃厨房掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出 1~2 件食物
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'bread',            'weight' => 25, 'count' => [1, 2]],
                    ['item_id' => 'soda_crackers',    'weight' => 25, 'count' => [1, 3]],
                    ['item_id' => 'berries',          'weight' => 20, 'count' => [1, 3]],
                    ['item_id' => 'cooked_meat_chunk','weight' => 15, 'count' => 1],
                    ['item_id' => 'concentrated_soup', 'weight' => 15, 'count' => 1],
                ],
            ],
            // 第二组：60% 出饮料
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'mineral_water', 'weight' => 40, 'count' => [1, 2]],
                    ['item_id' => 'cola',          'weight' => 30, 'count' => 1],
                    ['item_id' => 'herbal_tea',    'weight' => 20, 'count' => 1],
                    ['item_id' => 'whiskey',       'weight' => 10, 'count' => 1],
                ],
            ],
            // 第三组：30% 出烹饪工具（stack=false 但本表无衰减；不模拟耐久）
            [
                'chance' => 0.3,
                'entries' => [
                    ['item_id' => 'frying_pan', 'weight' => 70, 'count' => 1],
                    ['item_id' => 'lighter',    'weight' => 30, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 药房掉落 ──────────────────
    // 设计意图：药物 + 解毒剂 + 高级医疗包；衰减无意义
    'pharmacy_loot' => [
        'name' => '药房掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出 1~2 件药剂
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'health_potion',  'weight' => 35, 'count' => [1, 2]],
                    ['item_id' => 'stamina_potion', 'weight' => 25, 'count' => 1],
                    ['item_id' => 'antidote',       'weight' => 20, 'count' => [1, 2]],
                    ['item_id' => 'painkiller',     'weight' => 15, 'count' => 1],
                    ['item_id' => 'orange_pill',    'weight' => 5,  'count' => 1],
                ],
            ],
            // 第二组：50% 出医疗消耗品
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'bandage',      'weight' => 60, 'count' => [1, 2]],
                    ['item_id' => 'supply_pack', 'weight' => 40, 'count' => [1, 2]],
                ],
            ],
            // 第三组：15% 出高级医疗包
            [
                'chance' => 0.15,
                'entries' => [
                    ['item_id' => 'nano_medkit',  'weight' => 100, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 猎人储藏掉落 ──────────────────
    // 设计意图：远程武器 + 弹药 + 兽皮/肉；远程武器耐久衰减
    'hunter_cache_loot' => [
        'name' => '猎人储藏掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：互斥远程武器选一（必出）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'self_bow',        'weight' => 35, 'count' => 1],
                    ['item_id' => 'compound_bow',   'weight' => 25, 'count' => 1],
                    ['item_id' => 'sling',           'weight' => 20, 'count' => 1],
                    ['item_id' => 'revolver',       'weight' => 15, 'count' => 1],
                    ['item_id' => 'hunting_rifle',   'weight' => 5,  'count' => 1],
                ],
            ],
            // 第二组：必出 3~6 件投掷弹药
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'hunting_arrow', 'weight' => 60, 'count' => [3, 6]],
                    ['item_id' => 'stone_pebble',  'weight' => 25, 'count' => [2, 4]],
                    ['item_id' => 'rock',          'weight' => 15, 'count' => [1, 2]],
                ],
            ],
            // 第三组：60% 出食材（猎人储备）
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'cured_meat',       'weight' => 35, 'count' => [1, 2]],
                    ['item_id' => 'cooked_meat_chunk','weight' => 30, 'count' => 1],
                    ['item_id' => 'animal_pelt',      'weight' => 25, 'count' => [1, 2]],
                    ['item_id' => 'raw_meat_chunk',   'weight' => 10, 'count' => 1],
                ],
            ],
            // 第四组：25% 出狩猎配件
            [
                'chance' => 0.25,
                'entries' => [
                    ['item_id' => 'rifle_scope',  'weight' => 60, 'count' => 1],
                    ['item_id' => 'binoculars',   'weight' => 40, 'count' => 1],
                ],
            ],
        ],
    ],

    // ================================================================
    // ─── 内容扩充（任务4：基于外部世界实例扩充主题掉落表）──────────
    // 设计意图：补全主题 POI 类型，覆盖住宅/办公/服装/林中小屋/
    //          营火点/草药园/汽车残骸 7 类典型废土场景，
    //          参考 oblivions/docs/原始方案/loot_tables.json 主题分布
    // ================================================================

    // ─── 废弃住宅掉落 ──────────────────
    // 设计意图：家居杂物 + 衣物 + 少量食物；装备耐久衰减
    'residential_loot' => [
        'name' => '废弃住宅掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：必出家居素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'old_newspaper', 'weight' => 35, 'count' => [2, 4]],
                    ['item_id' => 'dirty_rag',     'weight' => 30, 'count' => [1, 2]],
                    ['item_id' => 'clean_cloth',   'weight' => 20, 'count' => 1],
                    ['item_id' => 'tarpaulin',     'weight' => 15, 'count' => 1],
                ],
            ],
            // 第二组：60% 出衣物/鞋具（耐久衰减）
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'cloth_shoes',   'weight' => 35, 'count' => 1],
                    ['item_id' => 'sneakers',      'weight' => 25, 'count' => 1],
                    ['item_id' => 'assassin_hood', 'weight' => 20, 'count' => 1],
                    ['item_id' => 'beast_hide_coat','weight' => 20, 'count' => 1],
                ],
            ],
            // 第三组：40% 出少量食物
            [
                'chance' => 0.4,
                'entries' => [
                    ['item_id' => 'soda_crackers',    'weight' => 40, 'count' => [1, 2]],
                    ['item_id' => 'berries',          'weight' => 30, 'count' => [1, 2]],
                    ['item_id' => 'concentrated_soup','weight' => 20, 'count' => 1],
                    ['item_id' => 'cola',             'weight' => 10, 'count' => 1],
                ],
            ],
            // 第四组：15% 出家用工具/配件（耐久衰减）
            [
                'chance' => 0.15,
                'entries' => [
                    ['item_id' => 'lighter',         'weight' => 40, 'count' => 1],
                    ['item_id' => 'flashlight',      'weight' => 30, 'count' => 1],
                    ['item_id' => 'tactical_gloves', 'weight' => 30, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 废弃办公楼掉落 ──────────────────
    // 设计意图：电子元件 + 文献素材 + 办公工具；耐久衰减
    'office_building_loot' => [
        'name' => '废弃办公楼掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：必出办公素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'old_newspaper', 'weight' => 40, 'count' => [3, 6]],
                    ['item_id' => 'small_parts',   'weight' => 30, 'count' => [1, 3]],
                    ['item_id' => 'plastic_shard', 'weight' => 20, 'count' => [1, 2]],
                    ['item_id' => 'circuit_board', 'weight' => 10, 'count' => 1],
                ],
            ],
            // 第二组：50% 出电子元件
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'aa_battery',     'weight' => 50, 'count' => [1, 2]],
                    ['item_id' => 'laptop_battery', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'circuit_board',  'weight' => 20, 'count' => 1],
                ],
            ],
            // 第三组：30% 出办公工具（耐久衰减）
            [
                'chance' => 0.30,
                'entries' => [
                    ['item_id' => 'binoculars',       'weight' => 35, 'count' => 1],
                    ['item_id' => 'multitool_knife', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'compass',          'weight' => 25, 'count' => 1],
                    ['item_id' => 'water_tester',     'weight' => 10, 'count' => 1],
                ],
            ],
            // 第四组：12% 出稀有配件
            [
                'chance' => 0.12,
                'entries' => [
                    ['item_id' => 'rifle_scope',     'weight' => 50, 'count' => 1],
                    ['item_id' => 'night_vision_goggles', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'mystery_box',     'weight' => 20, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 服装店掉落 ──────────────────
    // 设计意图：衣物 + 布料 + 配饰；耐久衰减
    'clothing_store_loot' => [
        'name' => '服装店掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：必出布料素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'clean_cloth', 'weight' => 45, 'count' => [2, 4]],
                    ['item_id' => 'cloth',       'weight' => 35, 'count' => [2, 4]],
                    ['item_id' => 'dirty_rag',   'weight' => 20, 'count' => [1, 2]],
                ],
            ],
            // 第二组：必出一件衣物/鞋具（耐久衰减）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'cloth_shoes',       'weight' => 25, 'count' => 1],
                    ['item_id' => 'sneakers',          'weight' => 20, 'count' => 1],
                    ['item_id' => 'combat_boots',      'weight' => 15, 'count' => 1],
                    ['item_id' => 'assassin_hood',     'weight' => 15, 'count' => 1],
                    ['item_id' => 'beast_hide_coat',   'weight' => 15, 'count' => 1],
                    ['item_id' => 'scrap_metal_raincoat','weight' => 10, 'count' => 1],
                ],
            ],
            // 第三组：35% 出配饰（耐久衰减）
            [
                'chance' => 0.35,
                'entries' => [
                    ['item_id' => 'tactical_gloves', 'weight' => 40, 'count' => 1],
                    ['item_id' => 'bronze_amulet',   'weight' => 35, 'count' => 1],
                    ['item_id' => 'tactical_vest',   'weight' => 25, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 林中小屋掉落 ──────────────────
    // 设计意图：猎具 + 兽皮 + 木材 + 食物；装备耐久衰减
    'cabin_loot' => [
        'name' => '林中小屋掉落',
        'durability_decay' => true,
        'groups' => [
            // 第一组：必出木材素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'tree_branch',  'weight' => 45, 'count' => [2, 4]],
                    ['item_id' => 'wooden_stock', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'rope_coil',    'weight' => 25, 'count' => 1],
                ],
            ],
            // 第二组：60% 出猎具/工具（耐久衰减）
            [
                'chance' => 0.6,
                'entries' => [
                    ['item_id' => 'self_bow',        'weight' => 30, 'count' => 1],
                    ['item_id' => 'wooden_club',     'weight' => 25, 'count' => 1],
                    ['item_id' => 'lighter',         'weight' => 20, 'count' => 1],
                    ['item_id' => 'lockpick_set',    'weight' => 15, 'count' => 1],
                    ['item_id' => 'multitool_knife', 'weight' => 10, 'count' => 1],
                ],
            ],
            // 第三组：50% 出食材（猎人储备）
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'cured_meat',        'weight' => 35, 'count' => [1, 2]],
                    ['item_id' => 'cooked_meat_chunk', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'berries',           'weight' => 20, 'count' => [1, 3]],
                    ['item_id' => 'raw_meat_chunk',    'weight' => 15, 'count' => 1],
                ],
            ],
            // 第四组：25% 出兽皮/狩猎配件
            [
                'chance' => 0.25,
                'entries' => [
                    ['item_id' => 'animal_pelt', 'weight' => 50, 'count' => [1, 2]],
                    ['item_id' => 'rifle_scope','weight' => 30, 'count' => 1],
                    ['item_id' => 'binoculars', 'weight' => 20, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 营火点掉落 ──────────────────
    // 设计意图：柴火/灰烬 + 偶发烤肉/工具；纯素材，无耐久概念
    'campfire_loot' => [
        'name' => '营火点掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出可燃素材（柴火堆）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'tree_branch',  'weight' => 60, 'count' => [3, 6]],
                    ['item_id' => 'old_newspaper','weight' => 25, 'count' => [2, 4]],
                    ['item_id' => 'dirty_rag',    'weight' => 15, 'count' => 1],
                ],
            ],
            // 第二组：45% 出未点燃火把或引火工具
            [
                'chance' => 0.45,
                'entries' => [
                    ['item_id' => 'torch_unlit', 'weight' => 60, 'count' => [1, 2]],
                    ['item_id' => 'lighter',     'weight' => 40, 'count' => 1],
                ],
            ],
            // 第三组：25% 出熟食（前任营火客留下的存粮）
            [
                'chance' => 0.25,
                'entries' => [
                    ['item_id' => 'cooked_meat_chunk','weight' => 50, 'count' => 1],
                    ['item_id' => 'cured_meat',       'weight' => 35, 'count' => 1],
                    ['item_id' => 'herbal_tea',       'weight' => 15, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 草药园掉落 ──────────────────
    // 设计意图：草药 + 浆果 + 蘑菇；纯消耗品堆叠
    'herb_garden_loot' => [
        'name' => '草药园掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出 2~4 件草药
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'swamp_herb',   'weight' => 45, 'count' => [2, 4]],
                    ['item_id' => 'wild_mushroom','weight' => 30, 'count' => [1, 3]],
                    ['item_id' => 'berries',      'weight' => 25, 'count' => [2, 4]],
                ],
            ],
            // 第二组：40% 出 1~2 件药饮
            [
                'chance' => 0.4,
                'entries' => [
                    ['item_id' => 'herbal_tea', 'weight' => 60, 'count' => [1, 2]],
                    ['item_id' => 'whiskey',    'weight' => 25, 'count' => 1],
                    ['item_id' => 'painkiller', 'weight' => 15, 'count' => 1],
                ],
            ],
            // 第三组：15% 出医用耗材
            [
                'chance' => 0.15,
                'entries' => [
                    ['item_id' => 'bandage',       'weight' => 50, 'count' => [1, 2]],
                    ['item_id' => 'antidote',      'weight' => 35, 'count' => 1],
                    ['item_id' => 'white_pill',    'weight' => 15, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 汽车残骸掉落 ──────────────────
    // 设计意图：电池 + 机械零件 + 油布；纯素材，无耐久概念
    'vehicle_wreck_loot' => [
        'name' => '汽车残骸掉落',
        'durability_decay' => false,
        'groups' => [
            // 第一组：必出机械素材
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'scrap_metal',  'weight' => 40, 'count' => [2, 5]],
                    ['item_id' => 'rusty_gear',   'weight' => 25, 'count' => [1, 3]],
                    ['item_id' => 'small_parts',  'weight' => 20, 'count' => [1, 2]],
                    ['item_id' => 'scrap_wire',   'weight' => 15, 'count' => [1, 2]],
                ],
            ],
            // 第二组：50% 出电池/电子元件
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'aa_battery',     'weight' => 45, 'count' => [1, 2]],
                    ['item_id' => 'circuit_board',  'weight' => 30, 'count' => 1],
                    ['item_id' => 'laptop_battery', 'weight' => 25, 'count' => 1],
                ],
            ],
            // 第三组：30% 出车辆附件
            [
                'chance' => 0.30,
                'entries' => [
                    ['item_id' => 'tarpaulin',  'weight' => 50, 'count' => 1],
                    ['item_id' => 'rifle_barrel','weight' => 30, 'count' => 1],
                    ['item_id' => 'wooden_stock', 'weight' => 20, 'count' => 1],
                ],
            ],
            // 第四组：8% 出遗留工具
            [
                'chance' => 0.08,
                'entries' => [
                    ['item_id' => 'crowbar',         'weight' => 50, 'count' => 1],
                    ['item_id' => 'multitool_knife', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'compass',         'weight' => 20, 'count' => 1],
                ],
            ],
        ],
    ],

    // ─── 上锁宝箱掉落（F-6 lockpick_open_chest 效果专用）──────────────
    // 由 poi_interact_effect_open_container 调用 F-4 引擎掷骰，
    // 物化到 oblmapitem（source_iaid = POI.iaid, discovered=1）。
    // 一次性开箱（POI state 同步改为 'exhausted'）。
    'locked_chest_loot' => [
        'name' => '上锁宝箱掉落',
        'durability_decay' => true,
        'groups' => [
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'scrap_metal',     'weight' => 30, 'count' => [2, 5]],
                    ['item_id' => 'supply_pack',     'weight' => 25, 'count' => [1, 3]],
                    ['item_id' => 'health_potion',   'weight' => 15, 'count' => 1],
                    ['item_id' => 'stamina_potion',  'weight' => 15, 'count' => 1],
                    ['item_id' => 'rusty_pipe',      'weight' => 10, 'count' => 1],
                    ['item_id' => 'scrap_vest',      'weight' => 5,  'count' => 1],
                ],
            ],
        ],
    ],
];
