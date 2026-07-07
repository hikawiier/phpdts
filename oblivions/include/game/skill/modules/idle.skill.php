<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 发呆技能模块 / Idle skill module
//
// 由 skill_load_modules() 自动加载。idle_calc 由 skill_execute 调用。
// NPC 专属兜底技能：无功能、无消耗，仅 emit 发呆日志供前端渲染文案。
// 前端根据 actor_type（敌人类型 ID）选择对应文案。
// ================================================================

function idle_calc(&$actor_data, &$target_data, &$obl_battle_log, &$battle_cache)
{
    if (!$obl_battle_log) return;

    $obl_battle_log->setPhase('idle');
    $obl_battle_log->emit([
        'actor_pid'  => (int)$actor_data['pid'],
        'actor_type' => (int)$actor_data['type'],
        'actor_name' => $actor_data['name'],
    ]);
}
