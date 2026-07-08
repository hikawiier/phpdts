<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 投掷技能模块 / Throw skill module
//
// @deprecated 1.0 旧技能模块，被 oblivions/gamedata/combat_skills/skill_throw.php 替代
// @see oblivions/gamedata/combat_skills/skill_throw.php
// ================================================================

function skill_throw_actor_has_throwing_weapon(&$actor_data)
{
    $wepk = isset($actor_data['wepk']) ? (string)$actor_data['wepk'] : '';
    $wepid = isset($actor_data['wepid']) ? (string)$actor_data['wepid'] : '';

    if ($wepk === 'WC') return true;
    if ($wepid !== '' && function_exists('item_has_tag') && item_has_tag($wepid, 'tag_weapon_throwing')) return true;

    return false;
}

function skill_throw_inject_equipment(&$skillpara, &$pdata)
{
    if (!skill_throw_actor_has_throwing_weapon($pdata)) return;

    if (!isset($skillpara['throw']) || !is_array($skillpara['throw'])) {
        $skillpara['throw'] = array('lstact' => 0);
    }
    if (!isset($skillpara['throw']['lstact'])) {
        $skillpara['throw']['lstact'] = 0;
    }
}

function throw_verify_check(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    return skill_throw_actor_has_throwing_weapon($actor_data);
}

skill_register_equipment_injector('skill_throw_inject_equipment');
