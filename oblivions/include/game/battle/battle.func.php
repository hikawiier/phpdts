<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统功能文件 / Oblivions battle system
// 功能函数负责实现战斗系统的具体功能
// ================================================================

include_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php'; //包含战斗系统数值计算函数文件

function battle_state_init(&$actor_data)
{
    # 进入战斗，初始化参战者的战斗状态
    $actor_data['action'] = 'battle';
}


function battle_state_clear(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 战斗已结束了，清空参战者的战斗状态
    $actor_data['action'] = '';
    # 如果还存在关联中的战斗队列，退出队列
    if(!empty($actor_data['bid']))
    {
        battle_queue_exit($actor_data,$obl_battle_log,$battle_cache);
        obl_save_player($actor_data);
    }
}

function battle_queue_create(&$actor_data,&$combatants,&$obl_battle_log)
{
    #先攻队列创建函数
    #根据$combatants和先攻率排序创建先攻队列
    #创建后的先攻队列保存到数据库，数据结构参考oblqueue.sql
    #将先攻队列中包含的每个参战者的bid修改为先攻队列的唯一索引qid
}

function battle_queue_update(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    #A. 更新参战者的 done （标记当前先攻者已行动）
    #B. 死亡参战者从队列中移除 （battle_target_alive_check 检测到死亡时，从 bra_oblqueue 删除该行，清空其 bid）
    #C. 检查队列是否需要解散 （移除死亡者后，队列中除玩家外都死了 → 解散队列，清空玩家 bid）
    #D. 检查队列是否需要重建 （队列中所有 done 都=1 → 重新先攻判定，所有人 done=0，更新 myorder）
    #E. 更新 qorder （记录当前执行顺位，方便前端显示和断点续传）
}
function battle_queue_exit(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    #从数据库中的先攻队列中移除自己

    #清空bid
    $actor_data['bid'] = '';
}


function battle_ap_recover(&$actor_data, &$battle_cache, &$obl_battle_log)
{
    #AP恢复函数：每轮开始时，先攻者恢复AP，恢复量为当前AP+AP上限，不会超过AP上限
    $actor_data['ap'] = min($actor_data['ap'] + $actor_data['ap_max'], $actor_data['ap_max']);
    return;
}

function battle_act_verify(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache)
{
    #单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；    
    #检查$actor_data['skillpara']的键名act_id是否存在，不存在说明这个动作不合法，直接返回false；存在的话继续检查AP是否满足需求，不满足的话也返回false；满足的话实际扣除AP并返回true
    #ap_cost为0的动作可以无视AP限制直接执行
    if (!isset($actor_data['skillpara'][$act_id])) {
        return false;
    }
    $act_ap_cost = $actor_data['skillpara'][$act_id]['ap_cost'];
    if ($act_ap_cost > 0 && $actor_data['ap'] < $act_ap_cost) {
        return false;
    }
    if ($act_ap_cost > 0) {
        $actor_data['ap'] -= $act_ap_cost;
    }
    return true;
}

function battle_target_alive_check(&$target_data, &$obl_battle_log, &$battle_cache)
{
    #如果目标hp<=0，但state为0，修改state标记为死亡
    if ($target_data['hp'] <= 0 && !$target_data['state']) 
    {
        $target_data['state'] = 1; //修改目标状态为死亡
    }
    #目标已死，清理目标的战斗状态，并从战斗队列中移除
    if ($target_data['state'])
    {
        battle_state_clear($target_data, $obl_battle_log, $battle_cache);
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
