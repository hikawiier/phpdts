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
