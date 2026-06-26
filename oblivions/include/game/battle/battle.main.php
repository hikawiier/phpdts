<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗执行模块
//
// 职责：战斗动作的校验和执行（verify → execute）。
// 队列管理（queue_check → finish_check）在 battle.queue.func.php。
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/player.func.php';
require_once GAME_ROOT . './oblivions/include/game/sql.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php';

//回合主函数（不含队列管理，1 次出手 = 1 Turn = 1 tick）
// $actor_data=先攻者data $atk_act=动作数组（数字索引，每项含 act_id + target）
// $battle_cache 由调用方传入并在 battle_main 返回后传给 battle_manage_queue
// 队列管理（创建/更新/解散/结束检测）由调用方在 battle_main 返回后调用 battle_manage_queue()
function battle_main(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    $obl_battle_log->setPhase('verify');
    battle_verify($actor_data, $atk_act, $obl_battle_log, $battle_cache); 

    if (!empty($atk_act)) {
        $obl_battle_log->setPhase('excute');
        battle_execute($actor_data, $atk_act, $obl_battle_log, $battle_cache);    
    }
}

function battle_verify(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    //回合校验函数（Turn）：检验输入的技能合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP
    //校验失败的act会从$atk_act中删除，校验成功的act会实际扣除AP
    //$atk_act 是数字索引数组，每项含 act_id + target
    foreach ($atk_act as $key => $act)
    {
        $act_id = $act['act_id'];
        if (!battle_act_verify($actor_data, $act_id, $obl_battle_log, $battle_cache)) { //单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；
            unset($atk_act[$key]); //校验失败 从$atk_act中删除这个act
        }
    }
    # 重新索引数组，保证 key 连续
    $atk_act = array_values($atk_act);
}

function battle_execute(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    //$atk_act 是数字索引数组，每项含 act_id + target
    //target 可以是单个 pid 或 pid 数组（影响多目标的动作）
    foreach ($atk_act as $act) {
        $act_id = $act['act_id'];
        $target = $act['target'];

        # target 统一数组化，使用统一逻辑执行流程
        $targets_array = is_array($target) ? $target : array($target);

        foreach ($targets_array as $target_id) {
            $target_data = battle_target_check($target_id, $actor_data, $obl_battle_log, $battle_cache);  //目标合法性检测函数：检测目标是不是还活着，是不是在技能射程外；成功返回目标data，失败返回false；
            if (!$target_data) continue; //目标不合法 跳过执行
            battle_once_execute($actor_data, $act_id, $target_data, $obl_battle_log, $battle_cache); //单次先攻动作结算
        }
    }
}

function battle_target_check($target_id, &$actor_data, &$obl_battle_log, &$battle_cache)
{
    $target_data = obl_fetch_playerdata_by_pid($target_id); //获取目标data
    if (!$target_data) return false; //目标不存在 不合法
    //检测目标存活状态
    if (!battle_target_alive_check($target_data,$obl_battle_log,$battle_cache)) return false; //目标死亡 不合法
    //目标不是自己的情况下 检测目标是否在技能射程内
    if($target_id != $actor_data['pid'] && !battle_target_distance_check($actor_data, $target_data, $battle_cache)) return false; //目标不在射程内 不合法
    return $target_data;
}

function battle_once_execute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache)
{
    # 受击目标进入战斗状态（突袭入口的受击目标在此初始化）
    battle_state_init($target_data);

    // 技能执行（处理非伤害效果，如逃跑等复杂逻辑）
    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    skill_execute($actor_data, $act_id, $target_data, $obl_battle_log, $battle_cache);

    // 扣血前保存 HP 快照
    $actor_oldhp  = (int)$actor_data['hp'];
    $target_oldhp = (int)$target_data['hp'];

    //执行act_id具体的打击动作
    $damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache); //伤害计算函数，输入攻击者数据、目标数据、技能参数，输出伤害数值
    battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache); //伤害应用函数，输入目标数据、伤害数值，实际扣除目标HP

    // 记录攻击日志（必须在 battle_target_alive_check 之前 emit，确保攻击日志的 log_id 小于击杀日志）
    // 否则前端按 log_id 升序播放时会先播"战斗结束"再播"攻击伤害"，造成时序错乱
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'    => (int)$actor_data['pid'],
            'actor_type'   => (int)$actor_data['type'],
            'target_pid'   => (int)$target_data['pid'],
            'target_type'  => (int)$target_data['type'],
            'action_id'    => $act_id,
            'effect_value' => $damage,
            'extra'        => [
                'actor_oldhp'   => $actor_oldhp,
                'target_oldhp'  => $target_oldhp,
                'actor_newhp'   => (int)$actor_data['hp'],
                'target_newhp'  => (int)$target_data['hp'],
            ],
        ]);
    }

    $survival_flag = battle_target_alive_check($target_data, $obl_battle_log, $battle_cache); //目标存活状态检测，判定死亡，或者复活。如果目标没死，返回true，否则返回false；
    
    if ($survival_flag)
    {
        //建立参战者队列 ，key为pid，value为1（活着）
        $battle_cache['combatants'][$target_data['pid']] = 1; //目标还活着的情况下，把目标的pid加入到参战者数组里；
    }
    else
    {
        //参战者队列里的目标死了，value为0（死亡）
        if(isset($battle_cache['combatants'][$target_data['pid']])) $battle_cache['combatants'][$target_data['pid']] = 0; 
    }

    //defend_battle_prepare(); //反击策略准备函数
    //defend_battle_verify();  //反击策略校验函数
    //defend_battle_queue_check(); //建立反击策略队列
    //defend_battle_once_execute(); //反击策略单次执行函数
    //反击策略系统暂不实现

    obl_save_player($actor_data); //保存攻击者数据到数据库
    obl_save_player($target_data); //保存目标数据到数据库
}



