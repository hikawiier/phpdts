<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 逃跑技能模块 / Escape skill module
//
// 由 skill_load_modules() 自动加载。escape_calc 由 skill_execute 调用。
// ================================================================

function escape_calc(&$actor_data, &$target_data, &$obl_battle_log, &$battle_cache)
{
    # 1. emit flee battlelog（前端渲染逃跑到目的地色）
    if ($obl_battle_log) {
        $obl_battle_log->setPhase('flee');
        $obl_battle_log->emit([
            'actor_pid'  => (int)$actor_data['pid'],
            'actor_name' => $actor_data['name'],
            'success'    => true,
        ]);
    }

    # 2. combatants 标记为 0（不能继续战斗）+ 写入 escaped mutation
    #    main_end 流程集中 cleanup
    $pid = (int)$actor_data['pid'];
    $battle_cache['combatants'][$pid] = 0;
    if (!isset($battle_cache['tag_mutations'][$pid])) {
        $battle_cache['tag_mutations'][$pid] = ['dead' => false, 'escaped' => false, 'hidden' => false];
    }
    $battle_cache['tag_mutations'][$pid]['escaped'] = true;
}
