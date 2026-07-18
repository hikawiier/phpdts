<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions POI 模板表
// 唯一 ID 索引 → POI 模板属性
// 不含掉落表（见 loot_tables.php）和刷新配置（见 poi_pool.php）
//
// E-10 字段（可搜索 POI）：
//   - base_loot_chance          基础物资概率（0-1）
//   - base_good_event_chance    基础良性事件概率（0-1）
//   - base_bad_event_chance     基础恶性事件概率（0-1）
//   - event_pool                事件 ID 列表（带 weight/kind）
//   - loot_table_id             关联 F-4 战利品表 ID（默认与 POI ID 共用命名空间）
//   - loot_table_overrides      工具/技能路由的改良版表 ID 映射
//   - prob_mods_source          接受哪些工具/技能的 prob_mods（白名单）
// ================================================================

return [
    'supply_cache' => [
        'name'       => '补给储藏箱',
        'desc'       => '一个被铁皮加固的木箱，里面可能还有能用的物资。',
        'searchable' => true,
        'repeatable' => false,

        // E-10 三档判定配置
        'base_loot_chance'        => 0.7,
        'base_good_event_chance'  => 0.1,
        'base_bad_event_chance'   => 0.1,
        'loot_table_id'           => 'supply_cache_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',  'weight' => 30, 'kind' => 'good'],
            ['event_id' => 'safe_route',        'weight' => 20, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',      'weight' => 35, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse','weight' => 15, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'supply_cache_loot',  // 暂用同表；未来可改为改良版表
        ],
    ],

    'scrap_pile' => [
        'name'            => '废料堆',
        'desc'            => '堆积着各种金属废料，翻翻看也许能找到什么。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,     // 最大搜索次数，0=无限
        'repeat_cooldown' => 3,     // 冷却回合数

        // E-10 三档判定配置
        'base_loot_chance'        => 0.85,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.05,
        'loot_table_id'           => 'scrap_pile_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',  'weight' => 40, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',      'weight' => 60, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'landmark' => [
        'name'       => '地标',
        'desc'       => '醒目的地标建筑，可以作为导航参考。',
        'searchable' => false,
        'repeatable' => false,
    ],

    'danger_chest' => [
        'name'       => '危险宝箱',
        'desc'       => '散发着不祥气息的金属箱，里面也许有值钱的东西。',
        'searchable' => true,
        'repeatable' => false,

        // E-10 三档判定配置（危险宝箱：物资丰沛但陷阱概率高）
        'base_loot_chance'        => 0.8,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.3,
        'loot_table_id'           => 'supply_cache_loot',  // 暂复用补给箱表，未来可改 danger_chest_loot
        'event_pool' => [
            ['event_id' => 'trap_trigger',       'weight' => 60, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse', 'weight' => 40, 'kind' => 'bad'],
            ['event_id' => 'find_extra_cache',   'weight' => 30, 'kind' => 'good'],
        ],
        'prob_mods_source'   => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'supply_cache_loot',
        ],
    ],

    'swamp_spring' => [
        'name'            => '沼泽泉眼',
        'desc'            => '从地下涌出的清澈泉水，在污浊的沼泽中格外珍贵。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,
        'repeat_cooldown' => 5,

        // E-10 三档判定配置（泉眼：高物资低事件）
        'base_loot_chance'        => 0.9,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'medical_supplies',
        'event_pool'              => [],  // 纯掉落型 POI
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    'life_totem' => [
        'name'            => '生命图腾',
        'desc'            => '刻满符文的石柱，触碰后感到一股暖流涌入体内。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 3,
        'repeat_cooldown' => 0,
        'mechanic'        => 'max_hp_up',
        'mechanic_value'  => 10,
        // 注意：mechanic 型 POI 走 obl_execute_mechanic 分发框架，与 E-10 三档判定并列。
        // searchable=true 但实际行为由 mechanic 决定；E-10 三档判定概率配置留空以避免误触发
        'base_loot_chance'        => 0.0,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'empty_loot',
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    'ancient_relic' => [
        'name'       => '古代遗物',
        'desc'       => '半埋在泥土中的古代装置，核心似乎还在运转。',
        'searchable' => true,
        'repeatable' => false,

        // E-10 三档判定配置（古代遗物：必出物资，无事件）
        'base_loot_chance'        => 1.0,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'supply_cache_loot',  // 暂复用补给箱表，未来可改 ancient_relic_loot
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    'skill_totem' => [
        'name'            => '技能图腾',
        'desc'            => '散发着神秘光芒的古老石碑，似乎能传授某种能力。',
        'searchable'      => true,
        'repeatable'      => false,
        'mechanic'        => 'learn_skill',
        'mechanic_params' => ['passive', 'strategy', 'damage'],
        // mechanic 型 POI：同 life_totem，E-10 概率配置留空
        'base_loot_chance'        => 0.0,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'empty_loot',
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    // ─── 工作台 POI（mechanic='craft_source'）──────────────
    // mechanic_value 存储 item_id，指向 item_table 中的工作台道具
    // 玩家站在该 POI 上时，工作台素材加入可用列表（详见设计案 §3.5 / §5.5.3）

    'forge_anvil_poi' => [
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'craft_source',
        'mechanic_value'  => 'forge_t1',
    ],
    'vent_stove' => [
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'craft_source',
        'mechanic_value'  => 'stove_t1',
    ],
    'precision_stove_poi' => [
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'craft_source',
        'mechanic_value'  => 'stove_t2',
    ],

    // ================================================================
    // ─── 内容扩充（任务3：新增 POI 模板，关联新掉落表）──────────────
    // 设计意图：每个 POI 都关联 F-4 掉落表，配置 search_count/repeat_limit/state 等字段
    // 参考外部世界实例的 POI 类型分布，结合本游戏 item_table 适配
    // ================================================================

    // ─── 浅水区 POI ──────────────────────────────────

    'weapon_locker' => [
        'name'            => '武器柜',
        'desc'            => '锈迹斑斑的金属柜，门虚掩着，里面应该有武器或弹药。',
        'searchable'      => true,
        'repeatable'      => false,

        // 武器柜：高物资 + 中等陷阱概率，需要开锁器改良
        'base_loot_chance'        => 0.85,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.20,
        'loot_table_id'           => 'weapon_locker_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',  'weight' => 25, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',      'weight' => 55, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse','weight' => 20, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'weapon_locker_loot',  // 暂用同表，未来可改为 lockpick 改良版
        ],
    ],

    'tool_cabinet' => [
        'name'            => '工具间',
        'desc'            => '堆满杂物的小工作间，墙上挂着各种工具。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 3,
        'repeat_cooldown' => 4,

        // 工具间：高物资低事件
        'base_loot_chance'        => 0.80,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.10,
        'loot_table_id'           => 'tool_cabinet_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 35, 'kind' => 'good'],
            ['event_id' => 'safe_route',       'weight' => 25, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 40, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'abandoned_kitchen' => [
        'name'            => '废弃厨房',
        'desc'            => '满是油垢的厨房，炉灶上还摆着变质的食材。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,     // 无限搜索
        'repeat_cooldown' => 5,

        // 厨房：高物资无事件，纯补给型
        'base_loot_chance'        => 0.90,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.05,
        'loot_table_id'           => 'kitchen_loot',
        'event_pool' => [
            ['event_id' => 'trap_trigger', 'weight' => 100, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    // ─── 深水区 POI ──────────────────────────────────

    'abandoned_library' => [
        'name'            => '废弃图书馆',
        'desc'            => '倒塌的书架散落着泛黄的纸张，知识在此长眠。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 2,
        'repeat_cooldown' => 6,

        // 图书馆：中物资 + 中等良性事件（找到避难路线）
        'base_loot_chance'        => 0.65,
        'base_good_event_chance'  => 0.15,
        'base_bad_event_chance'   => 0.10,
        'loot_table_id'           => 'library_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 20, 'kind' => 'good'],
            ['event_id' => 'safe_route',       'weight' => 50, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 30, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'mechanic_workshop' => [
        'name'            => '机械间',
        'desc'            => '满是油污的车间，机械残骸堆积如山。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 3,
        'repeat_cooldown' => 4,

        // 机械间：高物资 + 结构塌陷风险
        'base_loot_chance'        => 0.85,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.20,
        'loot_table_id'           => 'mechanic_workshop_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',   'weight' => 20, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',       'weight' => 30, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse', 'weight' => 50, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'pharmacy' => [
        'name'            => '药房',
        'desc'            => '药品柜倾倒在地，散落着各色药瓶，空气中弥漫着消毒水味。',
        'searchable'      => true,
        'repeatable'      => false,

        // 药房：高物资 + 中等陷阱（有毒泄漏风险）
        'base_loot_chance'        => 0.85,
        'base_good_event_chance'  => 0.10,
        'base_bad_event_chance'   => 0.15,
        'loot_table_id'           => 'pharmacy_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 30, 'kind' => 'good'],
            ['event_id' => 'safe_route',       'weight' => 20, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 50, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'hunter_cache' => [
        'name'            => '猎人储藏',
        'desc'            => '藏在岩缝中的猎人物资，用油布仔细包裹着。',
        'searchable'      => true,
        'repeatable'      => false,

        // 猎人储藏：高物资 + 偶尔良性事件
        'base_loot_chance'        => 0.95,
        'base_good_event_chance'  => 0.10,
        'base_bad_event_chance'   => 0.05,
        'loot_table_id'           => 'hunter_cache_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 60, 'kind' => 'good'],
            ['event_id' => 'safe_route',       'weight' => 20, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 20, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'hunter_cache_loot',
        ],
    ],

    // ─── 深渊区 POI ──────────────────────────────────

    'mystic_shrine' => [
        'name'            => '神秘祭坛',
        'desc'            => '石砌祭坛上凝结着古老的血迹，周围散发着令人不安的气息。',
        'searchable'      => true,
        'repeatable'      => false,

        // 神秘祭坛：极高物资 + 极高恶性事件（深渊风险）
        'base_loot_chance'        => 1.0,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.35,
        'loot_table_id'           => 'mystic_shrine_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',   'weight' => 15, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',       'weight' => 50, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse', 'weight' => 35, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    // ================================================================
    // ─── 内容扩充（任务4：新增 7 个主题 POI 模板）──────────────────
    // 设计意图：补全主题 POI 类型，覆盖住宅/办公/服装/林中小屋/
    //          营火点/草药园/汽车残骸 7 类典型废土场景
    // ================================================================

    // ─── 浅水区新增 POI ──────────────────────────────────

    'abandoned_house' => [
        'name'            => '废弃住宅',
        'desc'            => '坍塌了一半的木屋，里面散落着家居杂物和旧衣物。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 2,
        'repeat_cooldown' => 5,

        // 住宅：中物资 + 低事件，可重复搜刮
        'base_loot_chance'        => 0.80,
        'base_good_event_chance'  => 0.10,
        'base_bad_event_chance'   => 0.05,
        'loot_table_id'           => 'residential_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 40, 'kind' => 'good'],
            ['event_id' => 'safe_route',       'weight' => 30, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 30, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'clothing_store' => [
        'name'            => '服装店',
        'desc'            => '橱窗破碎的服装店，模特倒在地上，衣架上还有几件衣物。',
        'searchable'      => true,
        'repeatable'      => false,

        // 服装店：高物资 + 低事件，一次性搜刮
        'base_loot_chance'        => 0.85,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.10,
        'loot_table_id'           => 'clothing_store_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 30, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 70, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'vehicle_wreck' => [
        'name'            => '汽车残骸',
        'desc'            => '锈蚀变形的汽车残骸，车门半开，仪表盘还亮着微光。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,
        'repeat_cooldown' => 4,

        // 汽车残骸：中物资 + 中事件
        'base_loot_chance'        => 0.75,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.15,
        'loot_table_id'           => 'vehicle_wreck_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',   'weight' => 25, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',       'weight' => 40, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse', 'weight' => 35, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => ['crowbar'],
        'loot_table_overrides' => [
            'crowbar' => 'vehicle_wreck_loot',
        ],
    ],

    // ─── 深水区新增 POI ──────────────────────────────────

    'office_building' => [
        'name'            => '废弃办公楼',
        'desc'            => '玻璃幕墙破碎的办公楼，文件柜倾倒，电脑屏闪烁杂讯。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 3,
        'repeat_cooldown' => 5,

        // 办公楼：中物资 + 中事件
        'base_loot_chance'        => 0.75,
        'base_good_event_chance'  => 0.10,
        'base_bad_event_chance'   => 0.15,
        'loot_table_id'           => 'office_building_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache',   'weight' => 25, 'kind' => 'good'],
            ['event_id' => 'safe_route',         'weight' => 20, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',       'weight' => 35, 'kind' => 'bad'],
            ['event_id' => 'structure_collapse', 'weight' => 20, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'forest_cabin' => [
        'name'            => '林中小屋',
        'desc'            => '苔藓覆盖的木屋，烟囱歪斜，门口散落着猎具碎片。',
        'searchable'      => true,
        'repeatable'      => false,

        // 林中小屋：高物资 + 低事件，一次性搜刮
        'base_loot_chance'        => 0.90,
        'base_good_event_chance'  => 0.10,
        'base_bad_event_chance'   => 0.05,
        'loot_table_id'           => 'cabin_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 50, 'kind' => 'good'],
            ['event_id' => 'safe_route',       'weight' => 30, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 20, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'cabin_loot',
        ],
    ],

    'campfire_site' => [
        'name'            => '营火点',
        'desc'            => '石块围拢的旧营火堆，灰烬中还埋着未燃尽的柴火。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,
        'repeat_cooldown' => 3,

        // 营火点：中物资 + 低事件，纯素材点
        'base_loot_chance'        => 0.80,
        'base_good_event_chance'  => 0.05,
        'base_bad_event_chance'   => 0.05,
        'loot_table_id'           => 'campfire_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 60, 'kind' => 'good'],
            ['event_id' => 'trap_trigger',     'weight' => 40, 'kind' => 'bad'],
        ],
        'prob_mods_source'   => [],
        'loot_table_overrides' => [],
    ],

    'herb_garden' => [
        'name'            => '草药园',
        'desc'            => '荒废的药草园，野生的草药与浆果丛在角落里蔓延。',
        'searchable'      => true,
        'repeatable'      => true,
        'repeat_limit'    => 0,
        'repeat_cooldown' => 4,

        // 草药园：高物资 + 无事件，纯补给型
        'base_loot_chance'        => 0.90,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'herb_garden_loot',
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    // ================================================================
    // ─── 道具交互 POI（任务2：mechanic=interact_*，配合 F-6 道具交互系统）─
    // 设计意图：与 E-10 三档判定并列；POI 实例初始 state 由生成器写入
    //          （locked_door/locked_chest → 'locked'；campfire_unlit → 'idle'）
    // 不配置 E-10 概率字段，mechanic 分发由 poi_interact 主流程接管
    // ================================================================

    'locked_door' => [
        'name'       => '上锁的门',
        'desc'       => '一扇紧锁的金属门，看起来需要工具才能打开。',
        'searchable' => false,
        'repeatable' => false,
        'mechanic'   => 'interact_locked_door',
        // mechanic 型 POI：E-10 概率配置留空，交互后 state='idle' 由 E-10 接管搜刮
        'base_loot_chance'        => 0.0,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'empty_loot',
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    'locked_chest' => [
        'name'       => '上锁的宝箱',
        'desc'       => '结实的金属宝箱，锁孔锈迹斑斑，需要合适的工具。',
        'searchable' => false,
        'repeatable' => false,
        'mechanic'   => 'interact_locked_chest',
        // mechanic 型 POI：unlock_door effect 直接调用 F-4 掷骰物化
        'base_loot_chance'        => 0.0,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'locked_chest_loot',
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],

    'campfire_unlit' => [
        'name'            => '熄灭的营火',
        'desc'            => '一堆未点燃的柴火，看起来可以生火。',
        'searchable'      => false,
        'repeatable'      => false,
        'mechanic'        => 'interact_campfire',
        // mechanic 型 POI：ignite effect 将 state 改为 'ignited'，emit 事件供未来状态系统订阅
        'base_loot_chance'        => 0.0,
        'base_good_event_chance'  => 0.0,
        'base_bad_event_chance'   => 0.0,
        'loot_table_id'           => 'empty_loot',
        'event_pool'              => [],
        'prob_mods_source'        => [],
        'loot_table_overrides'    => [],
    ],
];
