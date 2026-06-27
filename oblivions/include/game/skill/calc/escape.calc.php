<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function escape_calc(&$actor_data, &$target_data, &$obl_battle_log, &$battle_cache)
{
    # 1. emit flee battlelog（前端通过 'flee' 动作 ID 渲染逃跑到目的地色）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'flee',
            'extra'       => ['success' => true],
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
