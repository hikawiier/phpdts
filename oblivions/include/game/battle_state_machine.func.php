<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗状态机模块
//
// 职责：
// - 管理战斗流程的状态转换（按 qid 分离，支持多战场）
// - 监听 tick 推进事件，触发状态转换
// - 提供单一数据源 obl_battle_state 供前后端查询
// - 提供全局统筹查询（替代 pending_npc）
//
// 存储方案：bra_oblbattle_state 表（qid 主键）
//
// 设计原则：
// - 状态转换集中管理，其他模块只触发事件
// - 非法转换记录错误日志，不抛异常（避免阻塞流程）
// - 状态按 qid 分离，多战场互不干扰
// ================================================================

// 状态枚举
define('OBL_BS_IDLE',           'IDLE');
define('OBL_BS_PLAYER_DONE',    'PLAYER_DONE');
define('OBL_BS_NPC_ACTING',     'NPC_ACTING');
define('OBL_BS_WAITING_PLAYER', 'WAITING_PLAYER');
define('OBL_BS_ENDED',          'ENDED');

/**
 * 获取指定战场的战斗状态
 *
 * @param int $qid 先攻队列编号（战场编号）
 * @return string 战斗状态，qid 不存在时返回 IDLE
 */
function obl_battle_state_get($qid) {
    return obl_state_get($qid);
}

/**
 * 设置指定战场的战斗状态（内部函数，外部应使用 transition）
 *
 * @param int    $qid   先攻队列编号
 * @param string $state 新状态
 * @return void
 */
function obl_battle_state_set($qid, $state) {
    obl_state_set($qid, $state);
}

/**
 * 创建战场状态记录
 * 在 battle_queue_create 创建先攻队列后调用
 *
 * 实现说明：使用 INSERT IGNORE，记录已存在时不覆盖。
 * - 新建队列：插入新记录，状态为 $initial_state（通常为 PLAYER_DONE）
 * - 重建队列：状态记录已存在，INSERT IGNORE 不覆盖，保持原状态
 *   （由后续的 tick_advanced / npc_done 事件驱动状态转换）
 *
 * @param int    $qid          先攻队列编号
 * @param string $initial_state 初始状态（默认 PLAYER_DONE）
 * @return void
 */
function obl_battle_state_create($qid, $initial_state = OBL_BS_PLAYER_DONE) {
    obl_state_create($qid, $initial_state);
}

/**
 * 销毁战场状态记录
 * 在 battle_queue_update 检测到队列解散时调用
 *
 * @param int $qid 先攻队列编号
 * @return void
 */
function obl_battle_state_destroy($qid) {
    obl_state_destroy($qid);
}

/**
 * 状态转换（核心函数）
 *
 * 根据当前状态和触发事件，按状态转换表查询目标状态。
 * 非法转换记录错误日志并保持原状态，不抛异常。
 *
 * @param int    $qid   先攻队列编号（战场编号）
 * @param string $event 触发事件
 * @return string 转换后的状态（如果非法转换则保持原状态）
 */
function obl_battle_state_transition($qid, $event) {
    global $obl_error_log;

    if ($qid <= 0) return OBL_BS_IDLE;

    $current = obl_battle_state_get($qid);

    // 状态转换表（集中管理）
    static $transitions = array(
        OBL_BS_IDLE => array(
            'battle_start' => OBL_BS_PLAYER_DONE,
        ),
        OBL_BS_PLAYER_DONE => array(
            'tick_advanced' => OBL_BS_NPC_ACTING,
            'battle_end'    => OBL_BS_ENDED,
        ),
        OBL_BS_NPC_ACTING => array(
            'npc_done_player_turn' => OBL_BS_WAITING_PLAYER,
            'npc_done_npc_turn'    => OBL_BS_NPC_ACTING,
            'battle_end'           => OBL_BS_ENDED,
        ),
        OBL_BS_WAITING_PLAYER => array(
            'player_action_complete' => OBL_BS_PLAYER_DONE,
            'battle_end'             => OBL_BS_ENDED,
        ),
        OBL_BS_ENDED => array(
            'cleanup' => OBL_BS_IDLE,
        ),
    );

    $new_state = isset($transitions[$current][$event]) ? $transitions[$current][$event] : null;

    if ($new_state === null) {
        // 非法转换：记录错误日志，保持原状态
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_state.illegal_transition', array(
                'qid'     => (int)$qid,
                'current' => $current,
                'event'   => $event,
            ), 'battle');
        }
        return $current;
    }

    // 特殊处理：NPC_ACTING → NPC_ACTING（循环，不实际改变状态，仅刷新 updated_at）
    if ($current === $new_state) {
        obl_battle_state_set($qid, $new_state);
        return $current;
    }

    obl_battle_state_set($qid, $new_state);

    // 正常转换不记录到 errorlog（避免与非法转换混淆）
    // 如需调试状态转换流程，可临时在此添加 error_log() 或 obl_log 记录

    return $new_state;
}

/**
 * 强制重置指定战场的状态（用于异常恢复）
 *
 * 不经过状态转换表，直接设置为目标状态。
 *
 * @param int    $qid        先攻队列编号
 * @param string $to_state   目标状态（默认 IDLE）
 * @return void
 */
function obl_battle_state_reset($qid, $to_state = OBL_BS_IDLE) {
    global $obl_error_log;
    obl_battle_state_set($qid, $to_state);
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('battle_state.reset', array(
            'qid'    => (int)$qid,
            'to'     => $to_state,
            'reason' => 'manual_or_timeout',
        ), 'battle');
    }
}

// ── 全局统筹查询（替代 pending_npc） ──

/**
 * 获取所有活跃战场状态
 *
 * @return array [qid => state, ...]
 */
function obl_battle_state_get_all_active() {
    return obl_state_get_all_active();
}

/**
 * 检测是否有任何战场在 NPC_ACTING 状态
 * 替代 obl_tick_is_pending_npc() 的全局判断
 *
 * @return bool
 */
function obl_battle_state_has_npc_acting() {
    return obl_state_has_npc_acting();
}

/**
 * 找出卡死的战场（指定状态超时）
 *
 * @param int    $timeout_seconds 超时秒数（默认 30 秒）
 * @param string $state           目标状态（默认 NPC_ACTING）
 * @return array [qid, ...] 卡死的战场编号列表
 */
function obl_battle_state_find_stale($timeout_seconds = 30, $state = OBL_BS_NPC_ACTING) {
    global $now;
    if (!isset($now)) $now = time();
    return obl_state_find_stale($now - $timeout_seconds, $state);
}
