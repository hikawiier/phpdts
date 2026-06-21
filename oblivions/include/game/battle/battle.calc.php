<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统数值计算文件 / Oblivions battle system
// 功能函数负责实现战斗系统的数值计算
// ================================================================

/**
 * 获取对象的基本攻击射程
 *
 * 阶段一固定返回 1（近战）。未来由武器类型决定。
 *
 * @param array &$actor_data 对象数据
 * @return int 射程（BFS 跳数）
 */
function obl_get_range(&$actor_data)
{
    $basic_range = 1; //基础射程，阶段一固定为1（近战），未来由武器类型决定
    $fix_range = obl_get_range_fix($actor_data,$basic_range);
    return $fix_range;
}

/**
 * 获取对象的射程补正
 *
 *
 * @param array &$actor_data 对象数据
 * @return int 射程（BFS 跳数）
 */
function obl_get_range_fix(&$actor_data, $basic_range)
{
    // 暂时没有补正，原路返回
    return $basic_range;
}

function obl_calc_damage(&$actor_data,$target_data, $atk_act, $battle_cache)
{
    //伤害计算函数，输入攻击者数据、目标数据、技能参数，输出伤害数值
    //伤害计算函数需要根据技能参数中的伤害类型和伤害数值来计算伤害
    $damage = $actor_data['att'] - $target_data['def']; //伤害计算公式，阶段一简单的攻击力-防御力，未来会根据伤害类型和伤害数值进行调整
    $damage = max(1, $damage); //伤害不能为负数，最小为1
    return $damage;
}