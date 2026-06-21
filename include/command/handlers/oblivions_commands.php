<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 指令处理：探索/搜索/拾取/丢弃
// Command handlers for Oblivions explore/search/pickup/discard
//
// 由 router.php 在 Oblivions 模式下分发调用。
// 每个 handler 内部按需 include explore.func.php，避免非 Oblivions 模式加载。
// ================================================================

/**
 * Oblivions 原地探索
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_explore(&$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_explore($pdata);
}

/**
 * Oblivions 搜索建筑物
 * @param int   $iaid   建筑物实例 ID
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_search($iaid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_search_poi((int)$iaid, $pdata);
}

/**
 * Oblivions 拾取道具
 * @param int   $iid    道具实例 ID（bra_oblmapitem.iid）
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_pickup($iid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_pickup_item((int)$iid, $pdata);
}

/**
 * Oblivions 丢弃道具
 * @param int   $slot   背包槽位号（1~6）
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_discard($slot, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_discard_item((int)$slot, $pdata);
}

// ================================================================
// Oblivions 战斗指令处理 / Oblivions battle command handlers
// ================================================================

/**
 * 玩家突袭 NPC（战斗入口1）
 *
 * 玩家前端点击已发现的 NPC → 提交 obl_battle_start 命令。
 * 流程：校验目标 → 设置突袭标记 → battle_state_init → 构造预装填动作 → battle_main。
 * 突袭不创建先攻队列，直接动手打一次，由 battle_main 尾部的 battle_queue_check 后补票创建队列。
 *
 * @param int   $enemy_pid 目标敌人 PID
 * @param array &$pdata    玩家数据
 */
function cmd_handle_obl_battle_start($enemy_pid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
    include_once GAME_ROOT . './oblivions/include/game/move.func.php';

    global $obl_log, $obl_battle_log;

    # 校验目标
    $enemy_pid = (int)$enemy_pid;
    if ($enemy_pid <= 0) return;

    $enemy = obl_fetch_playerdata_by_pid($enemy_pid);
    if (!$enemy) return;
    obl_format_playerdata($enemy);

    # 校验：敌人未死亡
    if ((int)$enemy['state'] !== 0) return;
    # 校验：敌人已发现
    if (empty($enemy['discovered'])) return;
    # 校验：同一区域
    if ((int)$enemy['pgroup'] !== (int)$pdata['pgroup']) return;
    # 校验：BFS 距离 ≤ 射程
    $distance = obl_get_distance($pdata['pgroup'], $pdata['pls'], $enemy['pls']);
    if ($distance < 0 || $distance > obl_get_range($pdata)) return;

    # 初始化 battle_log（入口处局部初始化）
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 设置突袭标记（battle_queue_create 据此给玩家先攻优势）
    $pdata['oblpara']['ambush_flag'] = true;

    # 玩家进入战斗状态
    battle_state_init($pdata);

    # 构造预装填动作（unarmed_strike，目标为 enemy_pid）
    $atk_act = array(
        array('act_id' => 'unarmed_strike', 'target' => $enemy_pid),
    );

    # 调用 battle_main（内部会完成后补票创建先攻队列）
    battle_main($pdata, $atk_act, $obl_battle_log);
}

/**
 * 玩家先攻轮（已有先攻队列的情况下）
 *
 * 由前端在玩家选择动作后提交 obl_battle_action 命令时调用。
 * 流程：构造 $atk_act → battle_main。
 *
 * @param string $action_id 玩家选择的动作 ID（如 'unarmed_strike'）
 * @param int    $target_pid 目标敌人 PID
 * @param array  &$pdata    玩家数据
 */
function cmd_handle_obl_battle_action($action_id, $target_pid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';

    global $obl_battle_log;

    # 校验 action_id 和 target_pid
    $action_id = (string)$action_id;
    $target_pid = (int)$target_pid;
    if (empty($action_id) || $target_pid <= 0) return;

    # 初始化 battle_log（入口处局部初始化）
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 构造动作数组（数字索引，每项含 act_id + target）
    $atk_act = array(
        array('act_id' => $action_id, 'target' => $target_pid),
    );

    # 调用 battle_main
    battle_main($pdata, $atk_act, $obl_battle_log);
}
