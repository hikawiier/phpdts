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
 * 玩家主动攻击：直接进入战斗状态
 *
 * 取消 prebattle 中间态，obl_battle_start 命令直接完成：
 * 校验 + 状态检测 + 先攻判定（玩家强制先攻）+ NPC 自动执行。
 *
 * @param int   $enemy_pid 目标敌人 PID
 * @param array &$pdata    玩家数据
 */
function cmd_handle_obl_battle_start($enemy_pid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/battle.func.php';
    include_once GAME_ROOT . './oblivions/include/game/move.func.php';

    $error = obl_battle_initiate($enemy_pid, $pdata);
    if ($error !== '') {
        global $obl_log;
        $obl_log->emit('battle.invalid', 'battle', array(
            'reason' => $error,
            'action' => 'obl_battle_start',
        ));
    }
}

/**
 * 战斗载入流程入口：结算玩家先攻轮 + NPC 自动执行
 *
 * 由前端在玩家选择动作后提交 obl_battle_action 命令时调用。
 * 内部调用 obl_battle_resolve_round()，处理：
 * - 玩家先攻轮执行
 * - NPC 自动执行直到玩家顺位或战斗结束
 *
 * 注意：prebattle → battle 转换已前移到 obl_battle_initiate()。
 *
 * @param string $action_id 玩家选择的动作 ID（如 'unarmed_strike'）
 * @param array  &$pdata    玩家数据
 */
function cmd_handle_obl_battle_action($action_id, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/battle.func.php';
    include_once GAME_ROOT . './oblivions/include/game/move.func.php';

    $error = obl_battle_resolve_round($action_id, $pdata);
    if ($error !== '') {
        global $obl_log;
        $obl_log->emit('battle.invalid', 'battle', array(
            'reason' => $error,
            'action' => 'obl_battle_action',
        ));
    }
}
