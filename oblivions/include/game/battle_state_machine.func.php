<?php
/**
 * @module E 游戏逻辑
 * @framework E-5 权威战斗与回合生命周期状态机
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 战场状态只描述权威回合边界。队列顺位、HTTP 请求和演出批次都不能生成状态。
define('OBL_BS_IDLE', 'IDLE');
define('OBL_BS_AWAITING_INPUT', 'AWAITING_INPUT');
define('OBL_BS_AUTO_PENDING', 'AUTO_PENDING');
define('OBL_BS_EXECUTING', 'EXECUTING');

function obl_battle_state_get($qid) {
    return obl_state_get($qid);
}

function obl_battle_state_get_record($qid, $for_update = false) {
    return obl_state_get_record($qid, $for_update);
}

function obl_battle_state_create($qid, $initial_state = OBL_BS_IDLE) {
    obl_state_create($qid, $initial_state);
}

function obl_battle_state_destroy($qid) {
    obl_state_destroy($qid);
}

function obl_battle_state_transition_atomic(
    $qid,
    $expected_state,
    $expected_active_pid,
    $expected_turn_seq,
    array $changes
) {
    global $db, $tablepre, $now;
    if (!isset($now)) $now = time();
    if ($qid <= 0) return false;

    $allowed = array('state', 'round_num', 'turn_seq', 'active_pid', 'opened_at_tick');
    $sets = array();
    foreach ($allowed as $field) {
        if (!array_key_exists($field, $changes)) continue;
        $value = $changes[$field];
        $sets[] = $field === 'state'
            ? "state='" . addslashes((string)$value) . "'"
            : $field . '=' . (int)$value;
    }
    $sets[] = 'updated_at=' . (int)$now;

    $sql = "UPDATE {$tablepre}oblbattle_state SET " . implode(', ', $sets)
        . " WHERE qid=" . (int)$qid
        . " AND state='" . addslashes((string)$expected_state) . "'"
        . " AND active_pid=" . (int)$expected_active_pid
        . " AND turn_seq=" . (int)$expected_turn_seq;
    $db->query($sql);
    return (int)$db->affected_rows() === 1;
}

function obl_battle_state_open_identity_atomic($qid, array $current, $active_pid, $opened_at_tick) {
    return obl_battle_state_transition_atomic(
        $qid,
        $current['state'],
        $current['active_pid'],
        $current['turn_seq'],
        array(
            'state' => OBL_BS_EXECUTING,
            'turn_seq' => (int)$current['turn_seq'] + 1,
            'active_pid' => (int)$active_pid,
            'opened_at_tick' => (int)$opened_at_tick,
        )
    );
}

function obl_battle_state_claim_atomic($qid, $from_state, $active_pid, $turn_seq) {
    return obl_battle_state_transition_atomic(
        $qid,
        $from_state,
        $active_pid,
        $turn_seq,
        array('state' => OBL_BS_EXECUTING)
    );
}

function obl_battle_state_publish_open_atomic($qid, $active_pid, $turn_seq, $state) {
    if ($state !== OBL_BS_AWAITING_INPUT && $state !== OBL_BS_AUTO_PENDING) return false;
    return obl_battle_state_transition_atomic(
        $qid,
        OBL_BS_EXECUTING,
        $active_pid,
        $turn_seq,
        array('state' => $state)
    );
}

function obl_battle_state_close_atomic($qid, $active_pid, $turn_seq) {
    return obl_battle_state_transition_atomic(
        $qid,
        OBL_BS_EXECUTING,
        $active_pid,
        $turn_seq,
        array(
            'state' => OBL_BS_IDLE,
            'active_pid' => 0,
            'opened_at_tick' => 0,
        )
    );
}

function obl_battle_state_reset($qid, $to_state = OBL_BS_IDLE) {
    global $db, $tablepre, $now, $obl_error_log;
    if (!isset($now)) $now = time();
    $db->query("UPDATE {$tablepre}oblbattle_state SET state='" . addslashes((string)$to_state)
        . "', updated_at=" . (int)$now . " WHERE qid=" . (int)$qid);
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('battle_state.reset', array(
            'qid' => (int)$qid,
            'to' => (string)$to_state,
            'reason' => 'manual_or_timeout',
        ), 'battle');
    }
}

function obl_battle_state_refresh($qid) {
    global $db, $tablepre, $now;
    if (!isset($now)) $now = time();
    if ($qid <= 0) return;
    $db->query("UPDATE {$tablepre}oblbattle_state SET updated_at=" . (int)$now . " WHERE qid=" . (int)$qid);
}

function obl_battle_state_get_all_active() {
    return obl_state_get_all_active();
}

function obl_battle_state_has_busy_battle() {
    return obl_state_has_busy_battle();
}

function obl_battle_state_find_stale($timeout_seconds = 30, $state = OBL_BS_EXECUTING) {
    global $now;
    if (!isset($now)) $now = time();
    return obl_state_find_stale($now - $timeout_seconds, $state);
}

function obl_battle_state_increment_round($qid) {
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblbattle_state SET round_num=round_num+1 WHERE qid=" . (int)$qid);
}

function obl_battle_state_get_round_num($qid) {
    $row = obl_battle_state_get_record($qid);
    return $row ? (int)$row['round_num'] : 0;
}
