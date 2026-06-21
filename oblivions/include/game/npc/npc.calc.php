<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions NPC系统 计算组件
// ================================================================

/**
 * 获取指定区域所有已占用的 pls（玩家 + NPC）
 *
 * @param int $pgroup 区域 ID
 * @return array {pls => true} 已占用的格集合
 */
function obl_get_occupied_positions($pgroup)
{
    global $db, $tablepre;
    $occupied = array();
    $result = $db->query("SELECT pls FROM {$tablepre}oblplayers WHERE pgroup='{$pgroup}' AND state=0");
    while ($row = $db->fetch_array($result)) {
        $occupied[(int)$row['pls']] = true;
    }
    return $occupied;
}

/**
 * 从可用格列表中随机选一个未被占用的
 *
 * @param array $available_pls 可用格 pls 列表
 * @param array &$occupied     已占用格集合（引用传递，选中后会被标记）
 * @return int|false 选中的 pls，无可用格返回 false
 */
function obl_pick_available_tile($available_pls, &$occupied)
{
    $candidates = array();
    foreach ($available_pls as $pls) {
        if (!isset($occupied[$pls])) {
            $candidates[] = $pls;
        }
    }
    if (empty($candidates)) return false;
    return $candidates[array_rand($candidates)];
}

/**
 * 检查地图格是否被其他单位占用
 *
 * @param int $pgroup      区域 ID
 * @param int $pls         格子 ID
 * @param int $exclude_pid 排除的 pid（避免检查自己）
 * @return bool 是否被占用
 */
function obl_is_tile_occupied_by_others($pgroup, $pls, $exclude_pid)
{
    global $db, $tablepre;
    $result = $db->query("SELECT pid FROM {$tablepre}oblplayers
	                      WHERE pgroup='{$pgroup}' AND pls='{$pls}' AND state=0
	                      AND pid != '{$exclude_pid}' LIMIT 1");
    return $db->num_rows($result) > 0;
}

/**
 * 计算向目标移动的下一步（选距离目标最近的邻居格）
 *
 * @param int $pgroup   区域 ID
 * @param int $from_pls 起点格
 * @param int $to_pls   终点格
 * @return int|false 下一步的 pls，无可行路径返回 false
 */
function obl_calc_next_step_towards($pgroup, $from_pls, $to_pls)
{
    $neighbors = obl_get_tile_neighbors($pgroup, $from_pls);
    if (empty($neighbors)) return false;

    $min_dist = PHP_INT_MAX;
    $best_pls = false;
    foreach ($neighbors as $neighbor_pls) {
        $dist = obl_get_distance($pgroup, $neighbor_pls, $to_pls);
        if ($dist >= 0 && $dist < $min_dist) {
            $min_dist = $dist;
            $best_pls = $neighbor_pls;
        }
    }
    return $best_pls;
}

/**
 * 获取地图格的邻居列表
 *
 * @param int $pgroup 区域 ID
 * @param int $pls    格子 ID
 * @return array 邻居格 pls 列表
 */
function obl_get_tile_neighbors($pgroup, $pls)
{
    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup];
    if (!isset($tiles[$pls])) return array();
    return isset($tiles[$pls]['neighbors']) ? $tiles[$pls]['neighbors'] : array();
}

/**
 * 获取玩家视野范围（MVP 固定值，未来可基于属性计算）
 *
 * 用于敌人 discovered 状态管理（敌人移动后判断是否仍在玩家视野内）。
 * 注意：此值大于 obl_config.php 的 vision_range（迷雾清除范围），
 * 代表玩家能"感知"到更远处的敌人气息。
 *
 * @param array &$player 玩家数据
 * @return int 视野范围（BFS 跳数）
 */
function obl_get_player_vision_range(&$player)
{
    // MVP 阶段固定值，未来可基于属性/装备/技能计算
    return 3;
}