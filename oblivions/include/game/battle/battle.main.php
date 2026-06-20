<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统主文件 / Oblivions battle system
// 战斗系统的关键入口文件，包含了战斗系统的流程处理函数。功能函数在battle.func.php中实现，主函数在battle.main.php中实现。主函数负责调用功能函数完成战斗流程的处理，功能函数负责实现战斗系统的具体功能。
// ================================================================

if(!function_exists('obl_fetch_playerdata_by_pid')) {
    include_once GAME_ROOT . './oblivions/include/game/player.func.php'; //包含玩家数据相关函数文件
}
include_once GAME_ROOT . './oblivions/include/game/sql.func.php'; //包含数据库抓取相关函数文件
include_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php'; //包含战斗系统功能函数文件

//先攻轮完整流程主函数 $actor_data=先攻者data $atk_act=动作ID $atk_target=动作目标pid
function battle_main(&$actor_data, &$atk_act, &$atk_target, &$obl_battle_log)
{
    $battle_cache = []; //先攻轮中会产生的临时变量
    $battle_cache['tick_flag'] = false; //初始化游戏刻flag
    $battle_cache['combatants'] = array($actor_data['pid']); //收集本次先攻轮中出现的所有参战者，第一个是动作发起者本人

    battle_prepare($actor_data, $battle_cache, $obl_battle_log); //先攻轮准备函数：恢复AP
    battle_verify($actor_data, $atk_act, $atk_target, $obl_battle_log, $battle_cache); //先攻轮校验函数：检验输入的技能合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP

    # battle_verify()会过滤掉$atk_act内所有不合法的act，$atk_act不为空时才会进入先攻轮结算
    if (!empty($atk_act)) {
        battle_excute($actor_data, $atk_act, $atk_target, $obl_battle_log, $battle_cache);    //先攻轮结算函数
    }

    battle_queue_check($actor_data, $obl_battle_log, $battle_cache);  //先攻队列校验函数：检验是否所有人都已执行完先攻队列，是否需要重建先攻队列；
    battle_finish_check($actor_data, $obl_battle_log, $battle_cache); //战斗结束检测函数：遍历先攻队列，检查是否满足战斗结束条件（玩家是唯一幸存者，或玩家成功逃跑）
    
    $battle_cache['tick_flag'] = true;    //游戏刻推进检测 - 返回游戏刻推进flag
}

function battle_prepare(&$actor_data, &$battle_cache, &$obl_battle_log)
{
    //先攻轮准备函数：恢复AP
    battle_ap_recover($actor_data,$battle_cache,$obl_battle_log); //AP恢复函数
}

function battle_verify(&$actor_data, &$atk_act, &$atk_target, &$obl_battle_log, &$battle_cache)
{
    //先攻轮校验函数：检验输入的技能合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP
    //校验失败的act_id会被从$atk_act中删除，校验成功的act_id会实际扣除AP
    foreach ($atk_act as $act_id => $target) 
    {
        if (!battle_act_verify($actor_data, $act_id, $obl_battle_log, $battle_cache)) { //单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；
            unset($atk_act[$act_id]); //校验失败 从$atk_act中删除这个act_id
        }
    }
}

function battle_excute(&$actor_data, &$atk_act, &$atk_target, &$obl_battle_log, &$battle_cache)
{
    foreach ($atk_act as $act_id => $atk_target) {
        // atk_target是数组的情况，代表act_id是一个能影响多个目标的动作，atk_target包含若干pid
        // 否则act_id只影响单独的atk_target 值为pid

        // 单独的atk_target也数组化 使用统一逻辑执行流程
        $targets_array = [];
        $targets_array = is_array($atk_target) ? $atk_target : $targets_array[] = $atk_target;

        foreach ($targets_array as $target_id) {
            $target_data = battle_target_check($target_id, $actor_data, $battle_cache);  //目标合法性检测函数：检测目标是不是还活着，是不是在技能射程外；成功返回目标data，失败返回false；
            if (!$target_data) continue; //目标不合法 跳过执行
            battle_once_excute($actor_data, $act_id, $target_data, $obl_battle_log, $battle_cache); //单次先攻动作结算
        }
    }
}

function battle_target_check($target_id, &$actor_data, &$battle_cache)
{
    $target_data = obl_fetch_playerdata_by_pid($target_id); //获取目标data
    if (!$target_data) return false; //目标不存在 不合法
    //检测目标存活状态
    if (!battle_target_alive_check($target_data,$obl_battle_log,$battle_cache)) return false; //目标死亡 不合法
    //目标不是自己的情况下 检测目标是否在技能射程内
    if($target_id != $actor_data['pid'] && !battle_target_distance_check($actor_data, $target_data, $battle_cache)) return false; //目标不在射程内 不合法
    return $target_data;
}

function battle_once_excute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache)
{
    //执行act_id具体的打击动作 
    $damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache); //伤害计算函数，输入攻击者数据、目标数据、技能参数，输出伤害数值
    battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache); //伤害应用函数，输入目标数据、伤害数值，实际扣除目标HP，并且记录战斗日志

    //defend_battle_prepare(); //反击策略准备函数
    //defend_battle_verify();  //反击策略校验函数
    //defend_battle_queue_check(); //建立反击策略队列
    //defend_battle_once_excute(); //反击策略单次执行函数
    //反击策略系统暂不实现

    $survival_flag = battle_target_alive_check($target_data,$obl_battle_log,$battle_cache); //目标存活状态检测，判定死亡，或者复活。如果目标没死，返回true，否则返回false；
    if ($survival_flag) $battle_cache['combatants'][] = $target_data['pid']; //目标还活着的情况下，把目标的pid加入到参战者数组里；

    obl_save_player($actor_data); //保存攻击者数据到数据库
    obl_save_player($target_data); //保存目标数据到数据库
}

function battle_queue_check(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 检验$actor_data['bid']是否关联存在的先攻队列
    if(empty($actor_data['bid']))
    {
        # 至少2个参战者才能组成先攻队列
        if (count($battle_cache['combatants']) < 2) return;
        # 没有则创建一个新的先攻队列 所有参战者的pid保存在 $battle_cache['combatants'] 内，可据此判断哪些人需要加入当前先攻队列
        battle_queue_create($actor_data,$battle_cache['combatants'], $obl_battle_log);
    }
    #存在先攻队列，更新先攻者在队列中的done，并检查是否需要重建或清空先攻队列
    battle_queue_update($actor_data, $obl_battle_log, $battle_cache);
}

function battle_finish_check(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 检验$actor_data['bid']是否关联存在的先攻队列
    if (empty($actor_data['bid'])) 
    {
        # 没有关联战斗队列，且在之前的流程里也没有建立新的战斗队列。说明战斗已结束了
        battle_state_clear($actor_data, $obl_battle_log, $battle_cache);
        return;
    }
    # 战斗没结束，没有变化
    return;
}