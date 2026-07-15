<?php
/**
 * @module G 技能系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// Static skill identity and lifetime metadata. Combat mechanics live only in
// combat_skill_config.php.
return array(
    'move'             => array('category' => 'maneuver', 'lifetime' => 'permanent', 'hidden' => false),
    'unarmed_strike'   => array('category' => 'assault',  'lifetime' => 'permanent', 'hidden' => false),
    'escape'           => array('category' => 'maneuver', 'lifetime' => 'permanent', 'hidden' => false),
    'heal'             => array('category' => 'support',  'lifetime' => 'permanent', 'hidden' => false),
    'throw'            => array(
        'category' => 'assault',
        'lifetime' => 'equipment',
        'hidden' => false,
        'equipment_grant' => array(
            'slots' => array('wep', 'wep2'),
            'any_tags' => array('tag_weapon_throwing'),
            'any_kinds' => array('WC'),
        ),
    ),
    'whirlwind'        => array('category' => 'assault',  'lifetime' => 'permanent', 'hidden' => false),
    'execute'          => array('category' => 'assault',  'lifetime' => 'permanent', 'hidden' => false),
    'vampiric_bite'    => array('category' => 'assault',  'lifetime' => 'permanent', 'hidden' => false),
    'grenade'          => array('category' => 'assault',  'lifetime' => 'permanent', 'hidden' => false),
    'idle'             => array('category' => 'maneuver', 'lifetime' => 'permanent', 'hidden' => true),
    // 狼狈的设计意图（2026-07-16 重校准）：
    // 狼狈表达"刚刚狼狈逃离，无法立刻重整旗鼓"的状态。其语义边界只覆盖
    // "主动行动"维度：主动发起战斗、战场内主动行动、世界 AI、主动移动、
    // 推进时间的状态修改都被阻止，避免"刚逃跑就杀回来"的违和感。
    //
    // 刻意不 deny `participate_combat`：被动进入战斗（被其他玩家作为目标拉入
    // 战场、被战场动态扩编参战）属于"被动接受"行为，不在狼狈阻止范围内。
    // 若后续设计需要阻止被动参战（如眩晕/束缚/沉默等"完全无法行动"语义），
    // 应在该状态的 capability_denies 中独立声明 participate_combat，而不是
    // 复用狼狈。
    'flustered'        => array(
        'category' => 'passive',
        'lifetime' => 'effect',
        'hidden' => false,
        'stacking' => 'refresh',
        'duration_ticks' => 1,
        'capability_denies' => array(
            'world_ai',
            'voluntary_move',
            'enter_combat',
            'combat_action',
            'free_mutation',
        ),
    ),
);
