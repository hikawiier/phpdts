<?php
/**
 * @module I 旧战斗队列系统
 * @framework I-2 数值计算共享库
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Shared combat infrastructure — 数值计算层
//
// 说明：
// - 本文件已不属于“旧 battle engine 主执行链”。
// - 当前保留为 new combat 与共享队列层复用的数值原语：
//   射程、先攻、伤害计算等。
// - 现阶段不迁名，优先保持活代码引用稳定。
// ================================================================

/**
 * 获取对象的基本攻击射程
 *
 * 当前固定返回 1（近战）。TODO：未来由武器类型决定。
 *
 * @param array &$actor_data 对象数据
 * @return int 射程（BFS 跳数）
 */
function obl_get_range(&$actor_data)
{
    $basic_range = 1; //基础射程，当前固定为1（近战）；TODO：未来由武器类型决定
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


/**
 * 获取本次动作的最终射程。
 *
 * 射程三维度：
 * - fixed：固定最大射程 range_max
 * - inherit：继承 actor 基础射程
 * - additive：actor 基础射程 + range_bonus
 * - capped_additive：min(actor 基础射程 + range_bonus, range_max)
 *
 * 未配置时默认 fixed 1，避免旧技能继续形成无限射程。
 *
 * @param array  &$actor_data 行动者数据
 * @param string $act_id      技能/动作 ID
 * @return int 最终射程（BFS 跳数）
 */
function obl_get_action_range(&$actor_data, $act_id)
{
    $resolved = combat_range_resolve_base($actor_data, (string)$act_id);
    return !empty($resolved['ok']) ? (int)$resolved['base_range'] : 0;
}

/**
 * 获取动作射程配置摘要（供日志/API 展示使用）。
 */
function obl_get_action_range_meta(&$actor_data, $act_id)
{
    $resolved = combat_range_resolve_base($actor_data, (string)$act_id);
    return array(
        'range_mode'   => $resolved['mode'],
        'range_max'    => (int)$resolved['max'],
        'range_bonus'  => (int)$resolved['bonus'],
        'base_range'   => (int)$resolved['base_range'],
        'action_range' => (int)$resolved['base_range'],
        'effective_range' => $resolved['effective_range'],
    );
}

/**
 * 获取对象的先攻属性
 *
 * 当前：返回 50。TODO：未来接入命中公式。
 * 未来可扩展：技能补正。
 *
 * @param array &$actor_data 对象数据
 * @return int 先攻属性
 */
function obl_get_initiative(&$actor_data)
{
    $basic_initiative = 50;
    return $basic_initiative;
}

function obl_calc_damage(&$actor_data,$target_data, $atk_act, $battle_cache)
{
    //伤害计算函数，输入攻击者数据、目标数据、技能参数，输出伤害数值
    //根据技能配置的 damage_type 和 damage_factor 计算伤害
    $config = function_exists('combat_skill_get_config') ? combat_skill_get_config((string)$atk_act) : null;

    // 无伤害技能返回 0
    if (!$config || ($config['damage_type'] ?? 'none') === 'none') {
        return 0;
    }

    $damage_factor = isset($config['damage_factor']) ? (float)$config['damage_factor'] : 1.0;
    $damage = ($actor_data['att'] * $damage_factor) - $target_data['def'];
    $damage = max(1, $damage); //伤害不能为负数，最小为1

    //调试用 伤害最大为25
    $damage = min(25, $damage);

    return $damage;
}

/**
 * 纯伤害计算函数（无副作用，可独立单测）
 * 与旧 obl_calc_damage 的差异：config 由调用方传入，不再内部调 skill_get_config
 * 调用方应通过 combat_skill_get_config 获取配置后传入
 * 保留 obl_calc_damage 不修改（当前 battle/ 共享层仍有活代码引用）
 *
 * @param array $actor_data  攻击者数据
 * @param array $target_data 目标数据
 * @param array $config      技能配置数组（由调用方获取后传入）
 * @return int 伤害值
 */
function obl_calc_damage_value($actor_data, $target_data, $config): int {
    // 无伤害技能返回 0
    if (!$config || (($config['damage_type'] ?? 'none') === 'none')) {
        return 0;
    }

    $damage_factor = isset($config['damage_factor']) ? (float)$config['damage_factor'] : 1.0;
    $damage = ($actor_data['att'] * $damage_factor) - $target_data['def'];
    $damage = max(1, $damage); //伤害最小为1

    //调试用 伤害最大为25
    $damage = min(25, $damage);

    return (int)$damage;
}
