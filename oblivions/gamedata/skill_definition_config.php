<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// Static skill identity and lifetime metadata. Combat mechanics live only in
// combat_skill_config.php.
return array(
    'move'             => array('category' => 'utility', 'lifetime' => 'permanent', 'hidden' => false),
    'unarmed_strike'   => array('category' => 'attack',  'lifetime' => 'permanent', 'hidden' => false),
    'escape'           => array('category' => 'utility', 'lifetime' => 'permanent', 'hidden' => false),
    'heal'             => array('category' => 'utility', 'lifetime' => 'permanent', 'hidden' => false),
    'throw'            => array(
        'category' => 'attack',
        'lifetime' => 'equipment',
        'hidden' => false,
        'equipment_grant' => array(
            'slots' => array('wep', 'wep2'),
            'any_tags' => array('tag_weapon_throwing'),
            'any_kinds' => array('WC'),
        ),
    ),
    'whirlwind'        => array('category' => 'attack',  'lifetime' => 'permanent', 'hidden' => false),
    'execute'          => array('category' => 'attack',  'lifetime' => 'permanent', 'hidden' => false),
    'vampiric_bite'    => array('category' => 'attack',  'lifetime' => 'permanent', 'hidden' => false),
    'grenade'          => array('category' => 'attack',  'lifetime' => 'permanent', 'hidden' => false),
    'idle'             => array('category' => 'utility', 'lifetime' => 'permanent', 'hidden' => true),
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
            'participate_combat',
            'combat_action',
            'free_mutation',
        ),
    ),
);
