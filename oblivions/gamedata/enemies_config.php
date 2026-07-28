<?php
/**
 * @module E 游戏逻辑
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions NPC 敌人类型属性配置
//
// 定义每种敌人的静态属性。与 item_table.php / poi_table.php 同层，
// 只定义属性，不关心分布（分布由 enemy_pool.php 按潮汐区控制）。
// NPC 与玩家共用 bra_oblplayers 表，通过 type 字段区分（type>0 为敌人类型 ID）。
// ================================================================

return array(
    // 敌人类型 ID => 配置
    1 => array(
        'name' => '废铁史莱姆',
        'icon' => 'enemy_slime',
        'gd' => 'm',
        'hp' => 50, 'mhp' => 50,
        'sp' => 10, 'msp' => 10,
        'att' => 8, 'def' => 3,
        'lvl' => 1,
        'ai_type' => 'patrol',        // AI 类型：patrol/aggressive/idle
        'vision_range' => 3,           // 感知范围（BFS 跳数）
        'action_chance' => 0.4,        // 行动意愿（每 tick 行动概率，0-1）
        'skills' => ['unarmed_strike', 'escape'],
        'combat_skills' => ['unarmed_strike'],  // 战斗中倾向于使用的技能（按优先级排列）
        'strategy_slots' => array(     // 初始策略槽（4 槽）
            array('type' => 'skill', 'id' => 'unarmed_strike'),
            null, null, null
        ),
    ),
    2 => array(
        'name' => '锈蚀守卫',
        'icon' => 'enemy_guard',
        'gd' => 'm',
        'hp' => 80, 'mhp' => 80,
        'sp' => 15, 'msp' => 15,
        'att' => 12, 'def' => 8,
        'lvl' => 2,
        'ai_type' => 'aggressive',
        'vision_range' => 5,
        'action_chance' => 0.7,
        'skills' => ['unarmed_strike', 'escape'],
        'combat_skills' => ['unarmed_strike'],  // 战斗中倾向于使用的技能（按优先级排列）
        'strategy_slots' => array(
            array('type' => 'skill', 'id' => 'unarmed_strike'),
            array('type' => 'skill', 'id' => 'unarmed_strike'),
            null, null
        ),
    ),
);
