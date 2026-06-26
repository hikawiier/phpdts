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

    # 2. 从队列删除自己，bid=0
    battle_queue_exit($actor_data, $obl_battle_log, $battle_cache);

    # 3. combatants 中删 actor 条目（确保 ensure 无人可建）
    if (isset($battle_cache['combatants'][$actor_data['pid']])) {
        unset($battle_cache['combatants'][$actor_data['pid']]);
    }

    # 4. 清理战斗状态
    $actor_data['action'] = '';
    $actor_data['ap'] = $actor_data['max_ap'];

    # 5. 保存
    obl_save_player($actor_data);
}
