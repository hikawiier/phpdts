<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统功能文件 / Oblivions battle system
// 功能函数负责实现战斗系统的具体功能
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';

function battle_state_init(&$actor_data)
{
    # 进入战斗，初始化参战者的战斗状态
    $actor_data['action'] = 'battle';
}


function battle_state_clear(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 二次调用保护：已清理则跳过
    if (empty($actor_data['action']) && empty($actor_data['bid'])) {
        return;
    }

    # 战斗已结束了，清空参战者的战斗状态
    $actor_data['action'] = '';
    # 如果还存在关联中的战斗队列，退出队列
    if(!empty($actor_data['bid']))
    {
        battle_queue_exit($actor_data,$obl_battle_log,$battle_cache);
    }
    # 恢复AP
    $actor_data['ap'] = $actor_data['max_ap'];
    # 无论 bid 是否为空，都保存 action 的修改（避免战斗结束后卡在 battle 状态）
    obl_save_player($actor_data);

    # 记录日志（DEBUG：战斗结束，清空战斗状态）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'battle_end',
            'extra'       => ['ended' => true],
        ]);
    }
}








function battle_ap_recover(&$actor_data, &$battle_cache, &$obl_battle_log)
{
    #AP恢复函数：每轮开始时，先攻者恢复AP，恢复量为当前AP+AP上限，不会超过AP上限
    $old_ap = (int)$actor_data['ap'];
    $max_ap = (int)$actor_data['max_ap'];
    $actor_data['ap'] = min($old_ap + $max_ap, $max_ap);
    $recovered = $actor_data['ap'] - $old_ap;

    # 记录日志（DEBUG：AP 恢复信息）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'    => (int)$actor_data['pid'],
            'actor_type'   => (int)$actor_data['type'],
            'target_pid'   => (int)$actor_data['pid'],
            'target_type'  => (int)$actor_data['type'],
            'action_id'    => 'ap_recover',
            'effect_value' => $recovered,
        ]);
    }
}

function battle_act_verify(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache)
{
    #单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；
    #委托给技能系统的 skill_act_verify 处理：查配置、检查拥有、检查CD、检查AP、自动引用 verify 文件
    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    return skill_act_verify($actor_data, $act_id, $obl_battle_log, $battle_cache);
}

function battle_target_alive_check(&$target_data, &$obl_battle_log, &$battle_cache)
{
    # 首次检测到死亡：hp<=0 且 state=0 → 标记死亡并清理战斗状态（emit battle_end、退出队列）
    if ($target_data['hp'] <= 0 && !$target_data['state'])
    {
        $target_data['state'] = 1; //修改目标状态为死亡
        battle_state_clear($target_data, $obl_battle_log, $battle_cache);
        return false;
    }
    # 已死（state=1）：直接返回 false，不重复清理（避免重复 emit battle_end 和重复队列操作）
    if ($target_data['state'])
    {
        return false;
    }
    #目标没死
    return true;
}

function battle_target_distance_check(&$actor_data, &$target_data, &$battle_cache)
{
    $actor_range = obl_get_range($actor_data);
    // 这里应该实现具体的距离检查逻辑，然后和射程比较判断目标是否合法。由于目前没有具体的距离计算逻辑，暂时默认所有目标都在射程内。
    return true;
}

function battle_apply_damage(&$actor_data, &$target_data, $damage, &$obl_battle_log, &$battle_cache)
{
    #伤害应用函数，输入目标数据、伤害数值，实际扣除目标HP，并且记录战斗日志
    $target_data['hp'] -= $damage;
    if ($target_data['hp'] < 0) {
        $target_data['hp'] = 0;
    }
}
