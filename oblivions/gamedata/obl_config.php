<?php
/**
 * @module C 核心运行时
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 可调参数配置 / Oblivions tunable parameters
//
// 设计原则：
// - 所有可调参数集中管理，函数内部不硬编码
// - 预留配置接口，未来由技能/装备动态覆盖时只需修改读取逻辑
//   （如从 $pdata 读取加成），配置文件本身不变
// ================================================================

return [
    // ─── 探索 / Explore ──────────────────────────────────
    'explore_sp_cost'  => 0,    // 探索消耗体力（基础值 0，不消耗）
    'vision_range'     => 1,    // 视野范围等级（1 = 脚下 + 邻接格，BFS 跳数）
    'memory_range'     => 3,    // 每次探索最多发现的道具数量（兜底值，技能系统未加载或 scavenge 未注册时使用）
    // 技能化发现数量：discover_base + discover_per_level * scavenge_skill_level
    // 默认值与 memory_range 对齐，确保 G-1 技能系统未加载或 Lv0 玩家与旧版行为一致
    'discover_base'       => 3,    // 基础发现数量（Lv0 时返回此值）
    'discover_per_level'  => 1,    // 每级搜刮技能增加的发现数量

    // ─── 移动 / Move ─────────────────────────────────────
    'move_sp_cost'     => 0,    // 每格移动消耗体力（基础值 0，不消耗）

    // ─── 移动方式注册表 / Move Types ──────────────────────
    // F-E2-Move §5.1：每种移动方式定义 7 项属性（max_range/distance_calc/
    // requires_real_path/blocking/landing_rules/trajectory_interceptable/
    // info_footprint/presentation_type）。
    // 首期只启用 normal；fly/jump/teleport 仅预留配置槽位，不写路径/演出逻辑。
    'move_types' => [
        // 普通移动：存在真实路径；受墙体/连接/动态不可通行阻挡；轨迹可被拦截；
        // 信息获取合并路径沿途观察范围；前端走步行动画。
        'normal' => [
            'label'                    => '普通移动',
            'enabled'                  => true,
            'max_range'                => null,   // null = 使用角色 move_power
            'distance_calc'            => 'bfs',
            'requires_real_path'       => true,
            'blocking'                 => ['impassable_tiles', 'occupied_tiles'],
            'landing_rules'            => ['passable', 'unoccupied'],
            'trajectory_interceptable' => true,
            'info_footprint'           => 'merge_path_observation',
            'presentation_type'        => 'walk',
        ],
        // 飞行（预留槽位，首期不实现）：
        // 路径不受普通墙体阻挡；配置空中观察走廊；落点仍需合法。
        'fly' => [
            'label'                    => '飞行',
            'enabled'                  => false,
            'max_range'                => null,
            'distance_calc'            => 'bfs',
            'requires_real_path'       => false,
            'blocking'                 => [],
            'landing_rules'            => ['passable', 'unoccupied'],
            'trajectory_interceptable' => true,
            'info_footprint'           => 'air_corridor',
            'presentation_type'        => 'fly',
        ],
        // 跳跃（预留槽位，首期不实现）：
        // 路径不受普通墙体阻挡，但落点需合法；距离按直线计算。
        'jump' => [
            'label'                    => '跳跃',
            'enabled'                  => false,
            'max_range'                => 2,
            'distance_calc'            => 'euclidean',
            'requires_real_path'       => false,
            'blocking'                 => [],
            'landing_rules'            => ['passable', 'unoccupied'],
            'trajectory_interceptable' => true,
            'info_footprint'           => 'landing_only',
            'presentation_type'        => 'jump',
        ],
        // 传送（预留槽位，首期不实现）：
        // 不计算路径距离；只使用最终落点的观察范围；轨迹不可被拦截。
        'teleport' => [
            'label'                    => '传送',
            'enabled'                  => false,
            'max_range'                => null,
            'distance_calc'            => 'none',
            'requires_real_path'       => false,
            'blocking'                 => [],
            'landing_rules'            => ['passable', 'unoccupied'],
            'trajectory_interceptable' => false,
            'info_footprint'           => 'landing_only',
            'presentation_type'        => 'teleport',
        ],
    ],

    // ─── 统一信息获取 / Information Acquisition ────────────
    // E-3/E-7 共用的信息获取配置：移动后与探索使用同一原语 obl_acquire_information，
    // 通过 action_type 区分配置。设计案 §4.4 配置表。
    'info_acquisition' => [
        // 移动后基础信息获取：点亮迷雾 + 基础道具发现 + 敌人发现 + POI 发现
        'move' => [
            'observation'            => ['vision'],                              // 观察方式（首期仅 vision）
            'info_budget'            => 1,                                       // 单次道具发现上限（移动基础值，远低于探索）
            'discover_prob_modifier' => 1.0,                                     // 发现概率补正（1.0=无补正）
            'scene_filter'           => ['fog', 'map', 'items', 'enemies', 'poi'], // 允许的信息类别全集
        ],
        // 主动探索强化信息获取：强化道具发现（含技能加成）+ 敌人发现 + POI 发现
        'explore' => [
            'observation'            => ['vision'],
            'info_budget'            => null,     // null=使用 obl_get_discovery_limit($pdata) 计算技能化上限
            'discover_prob_modifier' => 1.5,       // 探索发现概率补正（>1.0 表示比移动更敏感）
            'scene_filter'           => ['fog', 'map', 'items', 'enemies', 'poi'],
        ],
        // 战斗移动信息获取（首期不实现，仅占位证明可扩展）：仅点亮迷雾+地图，不发现道具/敌人/POI
        'combat_move' => [
            'observation'            => ['vision'],
            'info_budget'            => 0,
            'discover_prob_modifier' => 0,
            'scene_filter'           => ['fog', 'map'],
        ],
    ],

    // ─── 自动导航 / Navigation ────────────────────────────
    // map.navigate 命令的安全阀与默认倾向（设计案 §6.2.1 + §10.2）
    'navigation_max_steps_default' => 20,  // max_steps 默认上限（防 PHP 超时，达到上限返回 max_steps_reached）
    'navigation_max_steps_limit'   => 50,  // max_steps 配置上界（payload 校验上限）

    // ─── 移动倾向差异化参数 / Move Tendency Parameters ─────
    // F-E5-Target §5.6 四种移动倾向（steady/nearby/deep/efficient）的差异化算法参数
    // 所有可调参数集中管理；函数内部缺失配置时回退默认值
    'tendencies' => [
        // steady：稳健探索——软性偏好低潮汐
        'steady_max_detour'           => 2,   // 路径权重软偏好的最大绕行格数（超过则回退标准最短路径）
        'steady_max_target_distance'  => 10,  // 目标候选 BFS 距离上限（防止过大候选集）

        // nearby：就近探索——限制行动次数
        'tendency_nearby_max_actions' => 5,   // 行动次数 = ceil(BFS距离 / move_power) 的上限

        // deep：深入险境——偏好高潮汐
        'tendency_deep_max_distance'  => 8,   // 目标候选 BFS 距离上限
        'tendency_deep_max_detour'    => 3,   // 路径权重软偏好的最大绕行格数

        // efficient：效率优先——满移动力
        'tendency_efficient_max_actions' => 5, // 行动次数上限（用于目标候选筛选）

        // 潮汐权重表（steady 路径成本累加；deep 路径成本取反）
        'tide_weight_map' => [
            'shallow' => 1,
            'deep'    => 2,
            'abyss'   => 3,
        ],
    ],

    // ─── 日志 / Log ──────────────────────────────────────
    'log_max_entries'       => 200,  // 正式日志最大条目数（超过后丢弃最旧的）
    'log_max_debug_entries' => 50,   // debug 日志最大条目数（与正式日志分开计数，互不挤占）

    // ─── 战斗 / Battle ──────────────────────────────────
    // battlelog.v3 是唯一玩家战斗演出事件结构。
    'battlelog_schema'      => 'v2',

    // ─── 战斗引擎 / Combat Engine ──────────────────────
    // 旧 battle/ 执行链已下线；保留该键仅避免历史读取方缺字段。
    'combat_engine'         => 'new',

    // ─── 道具系统 / Item ───────────────────────────────
    // 注意：以下两项为预留配置，当前 obl_command_advances_tick() 使用硬编码白名单（不读取此配置）。
    // obl_use_item / obl_craft 不在白名单内，已满足"不推进 tick"的要求。
    // 未来若改为配置驱动可直接启用。
    'use_item_advances_tick' => false,
    'craft_advances_tick'    => false,

    // ─── 野生道具刷新 / Wild Item Refresh ──────────────────
    // 时间流逝刷新由 tick post phase 监听器触发，订阅 day_changed 事件按天刷新
    'wild_item_refresh_mode'           => 'daily',  // 'daily'=按天刷新（订阅 day_changed 事件，每日昼开始时刷新）；'tick_interval'=旧机制（按 wild_item_refresh_interval_ticks 间隔）
    'wild_item_refresh_interval_ticks' => 100,      // [deprecated] 旧 tick 间隔刷新配置；mode='tick_interval' 时生效；mode='daily' 时忽略
    'wild_item_capacity_per_tile'      => 5,        // 单格野生道具容量上限（应用层校验，不在 DB 硬约束）
    'wild_item_refresh_rate_by_tide'   => [         // 潮汐倍率表：越危险越丰沛（作用于 refresh 相位的 rate）
        'shallow' => 0.5,
        'deep'    => 1.0,
        'abyss'   => 1.5,
    ],

    // ─── 天与昼夜 / Day & Day-Night Cycle ──────────────────
    // E-11 天与昼夜相位派生层：在刻（tick）之上建立宏观时间语义
    // 1 天 = day_length_ticks 刻；昼相位 = day_phase_ticks 刻；夜相位 = day_length - day_phase 刻
    // phase = (tick % day_length) < day_phase ? 'day' : 'night'
    'day_length_ticks'  => 120,  // 1 天 = 120 刻
    'day_phase_ticks'   => 80,   // 昼相位刻数（夜 = day_length - day_phase = 40 刻）
];
