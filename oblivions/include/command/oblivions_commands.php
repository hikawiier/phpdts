<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 指令处理：探索/搜索/拾取/丢弃/战斗
// Command handlers for Oblivions explore/search/pickup/discard/battle
//
// 由 oblivions_router.php 在 Oblivions 模式下分发调用。
// 每个 handler 内部按需 include 所需函数库，避免非 Oblivions 模式加载。
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
 * 玩家前端点击已发现的 NPC → 前端预装填动作 → 提交 obl_battle_start 命令。
 * 流程：解析 actions → 提取突袭目标 → 校验目标 → 设置突袭标记 → battle_state_init → battle_main。
 * 突袭不创建先攻队列，直接动手打一次，由 battle_main 尾部的 battle_queue_check 后补票创建队列。
 *
 * 指令格式统一：只传 actions JSON 数组，突袭目标从 actions[0]['target'] 推导。
 *
 * @param array     &$pdata    玩家数据
 * @param array|null $actions   预装填动作数组，每项含 act_id + target。null 时为空（不执行动作）
 */
function cmd_handle_obl_battle_start(&$pdata, $actions = null) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
    include_once GAME_ROOT . './oblivions/include/game/move.func.php';

    global $obl_log, $obl_battle_log, $obl_error_log;

    # 1. 解析 actions，提取突袭目标（第一个有效动作的 target）
    include_once GAME_ROOT . './oblivions/include/game/battle/battle.entry.php';
    $atk_act = battle_entry_parse_actions($actions, $pdata['pid'], 'battle_start');
    $ambush_target_pid = !empty($atk_act) ? (int)$atk_act[0]['target'] : 0;

    if (empty($atk_act) || $ambush_target_pid <= 0) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_start.invalid_actions', array(
                'pid' => (int)$pdata['pid'],
                'actions_count' => is_array($actions) ? count($actions) : 0,
                'reason' => 'no_valid_action_or_target',
            ), 'command');
        }
        return;
    }

    # 2. 校验突袭目标合法性
    $enemy = obl_fetch_playerdata_by_pid($ambush_target_pid);
    if (!$enemy) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_start.target_not_found', array(
                'pid' => (int)$pdata['pid'],
                'target_pid' => $ambush_target_pid,
            ), 'command');
        }
        return;
    }
    obl_format_playerdata($enemy);

    if ((int)$enemy['state'] !== 0) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_start.target_dead', array(
                'pid' => (int)$pdata['pid'],
                'target_pid' => $ambush_target_pid,
                'target_state' => (int)$enemy['state'],
            ), 'command');
        }
        return;
    }
    if (empty($enemy['discovered'])) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_start.target_undiscovered', array(
                'pid' => (int)$pdata['pid'],
                'target_pid' => $ambush_target_pid,
            ), 'command');
        }
        return;
    }
    if ((int)$enemy['pgroup'] !== (int)$pdata['pgroup']) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_start.target_wrong_region', array(
                'pid' => (int)$pdata['pid'],
                'target_pid' => $ambush_target_pid,
                'player_pgroup' => (int)$pdata['pgroup'],
                'target_pgroup' => (int)$enemy['pgroup'],
            ), 'command');
        }
        return;
    }
    $distance = obl_get_distance($pdata['pgroup'], $pdata['pls'], $enemy['pls']);
    $range = obl_get_range($pdata);
    if ($distance < 0 || $distance > $range) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_start.target_out_of_range', array(
                'pid' => (int)$pdata['pid'],
                'target_pid' => $ambush_target_pid,
                'distance' => $distance,
                'range' => $range,
            ), 'command');
        }
        return;
    }

    # 3. 委托战斗入口函数（设置 ambush_flag + state_init + 调用 battle_main）
    include_once GAME_ROOT . './oblivions/include/game/battle/battle.entry.php';
    battle_entry_player_ambush($pdata, $actions);
}

/**
 * 玩家先攻轮（已有先攻队列的情况下）
 *
 * 由前端在玩家选择动作后提交 obl_battle_action 命令时调用。
 * 流程：解析 actions → battle_main。
 *
 * 指令格式统一：只传 actions JSON 数组，移除冗余的 action_id + target_pid 参数。
 *
 * @param array     &$pdata    玩家数据
 * @param array|null $actions   预装填动作数组，每项含 act_id + target。提供时优先使用
 */
function cmd_handle_obl_battle_action(&$pdata, $actions = null) {
    if (!oblivions_is_active()) return;
    global $obl_battle_log, $obl_error_log;

    # 1. 解析 actions
    $atk_act = battle_entry_parse_actions($actions, $pdata['pid'], 'battle_action');

    if (empty($atk_act)) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_action.invalid_actions', array(
                'pid' => (int)$pdata['pid'],
                'actions_count' => is_array($actions) ? count($actions) : 0,
                'reason' => 'no_valid_action',
            ), 'command');
        }
        return;
    }

    # 2. 初始化 battle_log（入口处局部初始化）
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 3. 战斗上下文
    $battle_cache = battle_cache_create($pdata['pid'], false);

    # 4. 执行动作 + 队列管理分离调用
    battle_main($pdata, $atk_act, $obl_battle_log, $battle_cache);
    battle_manage_queue($pdata, $obl_battle_log, $battle_cache);
}