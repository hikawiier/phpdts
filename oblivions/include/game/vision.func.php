<?php
/**
 * @module E 游戏逻辑
 * @framework E-6 视野与感知系统
 */

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ----------------------------------------------------------------
// Oblivions 视野 / 迷雾 / 发现系统
//
// 职责边界：
//   - 视野范围计算（BFS）
//   - 迷雾点亮（地图格可见性 DB 操作）
//   - 敌人发现与状态更新
//
// 依赖：
//   - obl_global.func.php（obl_get_config）
//   - player.func.php（obl_fetch_enemies_by_region, obl_save_player）
//   - move.func.php（obl_get_map_data, obl_get_distance）
//   - log.func.php（$obl_log）
//
// 从 explore.func.php 移入：obl_calc_vision_range, obl_clear_fog
// 从 enemy_ai.func.php 移入：obl_get_player_vision_range, obl_discover_enemies, obl_update_enemy_discovered
// ----------------------------------------------------------------

/**
 * 计算玩家视野范围内的所有格及其距离
 *
 * @param int   $pgroup 当前区域
 * @param int   $pls    当前格
 * @param array &$pdata 玩家数据（预留：技能/装备加成覆盖 vision_range）
 * @return array [pls => ['distance' => int]]，空数组表示当前格无效
 */
function obl_calc_vision_range($pgroup, $pls, &$pdata) {
    $cfg = obl_get_config();
    $vision_lv = (int)($cfg['vision_range'] ?? 1);

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? [];
    if (!isset($tiles[$pls])) return [];

    $visible_tiles = [$pls => ['distance' => 0]];

    // BFS 扩展视野
    $visited = [$pls => true];
    $queue = [[$pls, 0]];
    while (!empty($queue)) {
        $frame = array_shift($queue);
        $cur = $frame[0];
        $dist = $frame[1];
        if ($dist >= $vision_lv) continue;

        $neighbors = $tiles[$cur]['neighbors'] ?? [];
        foreach ($neighbors as $n_pls) {
            if (isset($visited[$n_pls])) continue;
            $visited[$n_pls] = true;
            $visible_tiles[$n_pls] = ['distance' => $dist + 1];
            // 不可通行格可见但不再继续扩展（不能站在山上看到更远的地方）
            if (empty($tiles[$n_pls]['passable'])) continue;
            $queue[] = [$n_pls, $dist + 1];
        }
    }

    return $visible_tiles;
}

/**
 * 点亮视野范围内所有格的迷雾
 * 迷雾清除后，该格上的 POI 自动可见（POI 无 discovered 字段）
 *
 * @param int   $pgroup       当前区域
 * @param array $visible_tiles [pls => ['distance' => int]]
 */
function obl_clear_fog($pgroup, $visible_tiles) {
    global $db, $tablepre;

    if (empty($visible_tiles)) return;

    $pgroup_i = (int)$pgroup;
    $fog_values = [];
    foreach ($visible_tiles as $t_pls => $info) {
        $t_pls = (int)$t_pls;
        $fog_values[] = "($pgroup_i, $t_pls, 1, 0, '', 0, 0)";
    }

    // INSERT ... ON DUPLICATE KEY UPDATE fog=1（幂等）
    // 注：INSERT 字段含 last_refresh_turn/refresh_count 占位 0，但 ON DUPLICATE KEY UPDATE 只更新 fog，
    //     已存在记录的刷新字段不会被重置（保留已有野生道具刷新元数据）。
    foreach (array_chunk($fog_values, 500) as $batch) {
        $qry = "INSERT INTO {$tablepre}oblmapstates (pgroup, pls, fog, damaged, flags, last_refresh_turn, refresh_count)
                VALUES " . implode(',', $batch) . "
                ON DUPLICATE KEY UPDATE fog=1";
        $db->query($qry);
    }
}

/**
 * 查询地图格是否已点亮（fog=1）
 *
 * 任务2b：解耦敌人移动与迷雾——敌人移动到迷雾格时通过此函数判定是否仍可见
 *
 * @param int $pgroup 区域 ID
 * @param int $pls    格子 ID
 * @return bool true=已点亮（fog=1），false=在迷雾中或记录不存在
 */
function obl_is_tile_visible($pgroup, $pls) {
    global $db, $tablepre;
    $pgroup_i = (int)$pgroup;
    $pls_i = (int)$pls;
    $result = $db->query("SELECT fog FROM {$tablepre}oblmapstates
                          WHERE pgroup='{$pgroup_i}' AND pls='{$pls_i}' LIMIT 1");
    $row = $db->fetch_array($result);
    return !empty($row['fog']);
}

/**
 * 获取玩家视野范围（敌人发现用）
 *
 * 注意：此值大于 obl_config.php 的 vision_range（迷雾清除范围），
 * 代表玩家能"感知"到更远处的敌人气息。
 *
 * @param array &$player 玩家数据
 * @return int 视野范围（BFS 跳数）
 */
function obl_get_player_vision_range(&$player) {
    // MVP 阶段固定值，未来可基于属性/装备/技能计算
    return 3;
}

/**
 * 发现视野内的敌人，标记 discovered=1，清除该格迷雾，emit 日志
 *
 * @param int $player_pgroup 玩家所在区域
 * @param int $player_pls    玩家所在格
 * @param int $vision_range  玩家视野范围
 * @return void
 */
function obl_discover_enemies($player_pgroup, $player_pls, $vision_range) {
    global $obl_log;

    $enemies = obl_fetch_enemies_by_region($player_pgroup);
    foreach ($enemies as &$enemy) {
        // 死亡敌人不更新 discovered（保留原状态供搜刮）
        if ($enemy['state'] > 0) continue;

        $distance = obl_get_distance($player_pgroup, $player_pls, $enemy['pls']);
        if ($distance >= 0 && $distance <= $vision_range && $enemy['discovered'] == 0) {
            $enemy['discovered'] = 1;
            obl_save_player($enemy);

            // 发现敌人时清除该格迷雾（玩家"感知"到敌人位置）
            obl_clear_fog($player_pgroup, array($enemy['pls'] => array('distance' => $distance)));

            // emit 结构化日志：发现敌人
            $obl_log->emit('enemy.discovered', 'enemy', array(
                'enemy_name' => $enemy['name'],
                'enemy_pid'  => $enemy['pid'],
            ));
        }
    }
}

/**
 * 敌人移动后更新 discovered 状态
 *
 * 解耦敌人移动与迷雾（任务2b）：敌人在迷雾格中移动不再自动点亮迷雾
 *   - 超出玩家视野 → discovered=0（静默移除，不 emit 日志）
 *   - 在玩家视野内但目标格仍在迷雾中 → discovered=0（敌人变为未被发现，不点亮迷雾）
 *   - 在玩家视野内且目标格已点亮 → 保持 discovered=1
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据
 * @return void
 */
function obl_update_enemy_discovered(&$enemy, &$player) {
    // 死亡敌人不更新 discovered
    if ($enemy['state'] > 0) return;

    // 不同区域 → 未发现
    if ($enemy['pgroup'] != $player['pgroup']) {
        $enemy['discovered'] = 0;
        return;
    }

    // 超出玩家视野 → 未发现（静默移除）
    $distance = obl_get_distance($enemy['pgroup'], $enemy['pls'], $player['pls']);
    $player_vision = obl_get_player_vision_range($player);
    if ($distance < 0 || $distance > $player_vision) {
        $enemy['discovered'] = 0;
        return;
    }

    // 在玩家视野内，但目标格仍在迷雾中 → 敌人变为未发现（不点亮迷雾）
    // 解耦敌人移动与迷雾：敌人在迷雾中移动不再自动点亮迷雾
    if (!obl_is_tile_visible($enemy['pgroup'], $enemy['pls'])) {
        $enemy['discovered'] = 0;
        return;
    }

    // 目标格已点亮（玩家可见）→ 敌人保持被发现状态
    // 注：不再调用 obl_clear_fog，因为该格已经被点亮，无需重复操作
}
