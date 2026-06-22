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
    //根据技能配置的 damage_type 和 damage_factor 计算伤害
    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    $config = skill_get_config($atk_act);

    // 无伤害技能返回 0
    if (!$config || $config['damage_type'] === 'none') {
        return 0;
    }

    $damage_factor = isset($config['damage_factor']) ? (float)$config['damage_factor'] : 1.0;
    $damage = ($actor_data['att'] * $damage_factor) - $target_data['def'];
    $damage = max(1, $damage); //伤害不能为负数，最小为1
    return $damage;
}