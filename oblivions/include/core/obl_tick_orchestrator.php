<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions Tick Orchestrator
//
// 当前职责：集中管理 Oblivions 的 tick 推进策略。
// 底层 tick engine 仍复用 tick.func.php；本文件只负责决定“何时推进/解析/恢复”。
// ================================================================

function obl_tick_orchestrator_now() {
    return isset($GLOBALS['now']) ? (int)$GLOBALS['now'] : time();
}

function obl_tick_orchestrator_persist($extra = array()) {
    if (function_exists('obl_runtime_save_tick_globals')) {
        obl_runtime_save_tick_globals($extra);
        return;
    }
    if (function_exists('obl_gamevars_sync_from_globals')) {
        obl_gamevars_sync_from_globals($extra);
    }
}

function obl_tick_orchestrator_reload() {
    if (function_exists('obl_runtime_reload_tick_globals')) {
        obl_runtime_reload_tick_globals();
        return;
    }
    if (function_exists('obl_gamevars_sync_to_globals')) {
        obl_gamevars_sync_to_globals(true, false);
    }
}

function obl_tick_orchestrator_status($ctx = null) {
    global $gamevars;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
    $tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $processed_tick = isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;

    $status = array(
        'tick' => $tick,
        'processed_tick' => $processed_tick,
        'pending_tick' => $processed_tick < $tick,
    );

    if (function_exists('obl_game_load')) {
        $pure_read = is_array($ctx) && isset($ctx['kind']) && $ctx['kind'] === 'state';
        $row = obl_game_load(!$pure_read);
        if (is_array($row)) {
            $status['state'] = isset($row['state']) ? (string)$row['state'] : '';
            $status['phase'] = isset($row['phase']) ? (string)$row['phase'] : '';
            $status['run_id'] = isset($row['run_id']) ? (string)$row['run_id'] : '';
            $status['last_command_at'] = isset($row['last_command_at']) ? (int)$row['last_command_at'] : 0;
            $status['heartbeat_at'] = isset($row['heartbeat_at']) ? (int)$row['heartbeat_at'] : 0;
        }
    }

    return $status;
}

function obl_tick_orchestrator_after_command($ctx, $command, $contract, &$pdata, $dispatched) {
    global $gamevars;

    $escape_skip_tick = !empty($pdata['oblpara']['escape_skip_tick']);
    if ($escape_skip_tick) unset($pdata['oblpara']['escape_skip_tick']);

    obl_save_player($pdata);

    $should_advance_tick = $dispatched && !$escape_skip_tick && !empty($contract['advances_tick']);
    $command_time = obl_tick_orchestrator_now();

    if ($dispatched) {
        if ($should_advance_tick) {
            $GLOBALS['obl_last_command_at'] = $command_time;
        } elseif (function_exists('obl_game_note_command')) {
            obl_game_note_command($command_time);
        }
    }

    if ($should_advance_tick) {
        if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
        $gamevars['obl_pending_tick_actor_behavior'] = array(
            'pid' => isset($pdata['pid']) ? (int)$pdata['pid'] : 0,
            'domain' => strpos((string)$command, 'battle.') === 0 ? 'combat' : 'world',
            'behavior' => (string)$command,
        );

        obl_tick_advance();

        $player_qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $processing = defined('OBL_BS_PROCESSING') ? OBL_BS_PROCESSING : 'PROCESSING';
        if ($player_qid > 0 && function_exists('obl_battle_state_get') && obl_battle_state_get($player_qid) === $processing) {
            obl_battle_state_refresh($player_qid);
        }

        obl_tick_orchestrator_persist();
    } elseif (isset($gamevars) && is_array($gamevars)) {
        unset($gamevars['obl_pending_tick_actor_behavior']);
        unset($gamevars['obl_pending_tick_battle_actor_scope']);
    }

    $status = obl_tick_orchestrator_status($ctx);
    $status['advanced'] = $should_advance_tick;
    $status['escape_skip_tick'] = $escape_skip_tick;
    return $status;
}

function obl_tick_orchestrator_resolve_pending($ctx = null, $reason = 'heartbeat') {
    global $gamevars, $ginfochange;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
    if (!isset($gamevars['obl_tick'])) $gamevars['obl_tick'] = 0;
    if (!isset($gamevars['obl_pretick'])) $gamevars['obl_pretick'] = 0;

    $before_tick = (int)$gamevars['obl_tick'];
    $before_processed = (int)$gamevars['obl_pretick'];
    $resolved = false;
    $delta = 0;
    $tick_frame = null;

    if ($before_processed < $before_tick) {
        $delta = $before_tick - $before_processed;
        obl_tick_synchronize();
        $tick_frame = obl_resolve_tick_events($delta);
        $resolved = true;
        $ginfochange = true;
    }

    $after_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $after_processed = isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;
    $advanced = ($after_tick > $before_tick);
    $changed_scopes = array();

    if (is_array($tick_frame)) {
        $tick_frame['tick'] = $before_tick;
        $tick_frame['processed_tick'] = $after_processed;
        $tick_frame['next_tick'] = $after_tick;
        $changed_scopes = isset($tick_frame['changed_scopes']) && is_array($tick_frame['changed_scopes'])
            ? array_values($tick_frame['changed_scopes'])
            : array();
    }

    if ($resolved || $advanced) {
        obl_tick_orchestrator_persist();
    }

    return array(
        'resolved' => $resolved,
        'advanced' => $advanced,
        'delta' => $delta,
        'tick' => $after_tick,
        'processed_tick' => $after_processed,
        'pending_tick' => $after_processed < $after_tick,
        'reason' => $reason,
        'tick_frame' => $tick_frame,
        'changed_scopes' => $changed_scopes,
    );
}

function obl_tick_orchestrator_recover_stale_battles($ctx = null, $ttl = 30) {
    global $gamevars, $obl_error_log;

    $recovered = array();
    if (!function_exists('obl_battle_state_find_stale')) {
        return $recovered;
    }

    $processing = defined('OBL_BS_PROCESSING') ? OBL_BS_PROCESSING : 'PROCESSING';
    $player_turn = defined('OBL_BS_PLAYER_TURN') ? OBL_BS_PLAYER_TURN : 'PLAYER_TURN';
    $stale_qids = obl_battle_state_find_stale((int)$ttl, $processing);
    foreach ($stale_qids as $stale_qid) {
        $current = function_exists('obl_fetch_queue_current_initiator')
            ? obl_fetch_queue_current_initiator((int)$stale_qid)
            : false;

        if ($current && (int)$current['type'] === 0 && function_exists('obl_battle_state_reset')) {
            obl_battle_state_reset($stale_qid, $player_turn);
            $recovered[] = (int)$stale_qid;
            continue;
        }

        if ($current && (int)$current['type'] > 0) {
            if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
            $tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
            $processed_tick = isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;
            if ($processed_tick >= $tick && function_exists('obl_tick_advance')) {
                obl_tick_advance();
            }
            if (function_exists('obl_battle_state_refresh')) {
                obl_battle_state_refresh((int)$stale_qid);
            }
            if (isset($obl_error_log) && $obl_error_log) {
                $obl_error_log->emit('battle_state.recover_npc_pending_tick', array(
                    'qid' => (int)$stale_qid,
                    'current_pid' => (int)$current['pid'],
                ), 'battle');
            }
            $recovered[] = (int)$stale_qid;
            continue;
        }

        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_state.recover_no_current_actor', array(
                'qid' => (int)$stale_qid,
            ), 'battle');
        }
    }

    return $recovered;
}

function obl_tick_orchestrator_heartbeat($ctx = null) {
    obl_tick_orchestrator_reload();

    $result = obl_tick_orchestrator_resolve_pending($ctx, 'heartbeat');
    $recovered = obl_tick_orchestrator_recover_stale_battles($ctx, 30);
    if (!empty($recovered)) {
        $result['recovered_battles'] = $recovered;
        if (!isset($result['changed_scopes']) || !is_array($result['changed_scopes'])) {
            $result['changed_scopes'] = array();
        }
        foreach (array('player_info', 'battle_log') as $scope) {
            if (!in_array($scope, $result['changed_scopes'], true)) {
                $result['changed_scopes'][] = $scope;
            }
        }
        obl_tick_orchestrator_persist();
    } else {
        $result['recovered_battles'] = array();
    }

    if (function_exists('obl_game_note_heartbeat') && empty($result['resolved']) && empty($result['advanced'])) {
        obl_game_note_heartbeat();
    }

    $status = obl_tick_orchestrator_status($ctx);
    foreach ($status as $key => $value) {
        $result[$key] = $value;
    }

    return $result;
}
