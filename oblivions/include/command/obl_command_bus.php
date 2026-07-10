<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

require_once GAME_ROOT . './oblivions/include/command/obl_command_contract.php';
require_once GAME_ROOT . './oblivions/include/command/obl_command_handlers.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';

function obl_command_api_handle($envelope) {
    global $groomid, $obl_log, $obl_error_log, $obl_battle_log, $obl_runtime_ctx;

    $command = $envelope['command'];
    $request_id = isset($envelope['request_id']) ? (string)$envelope['request_id'] : '';
    $contract = obl_command_contract($command);
    if (!$contract) {
        return obl_command_response_error('UNKNOWN_COMMAND', '', array('command' => $command), $request_id);
    }

    $payload_check = obl_command_validate_payload($envelope['payload'], isset($contract['payload_schema']) ? $contract['payload_schema'] : array());
    if (!$payload_check['ok']) {
        return obl_command_response_error(
            $payload_check['code'],
            isset($payload_check['message']) ? $payload_check['message'] : '',
            isset($payload_check['details']) ? $payload_check['details'] : null,
            $request_id
        );
    }
    $payload = $payload_check['payload'];

    $auth = obl_command_authenticate_player();
    if (!$auth['ok']) {
        $auth_code = isset($auth['code']) ? $auth['code'] : 'AUTH_FAILED';
        return obl_command_response_error($auth_code, '', null, $request_id);
    }
    $pdata = $auth['pdata'];

    $lock = obl_command_acquire_lock($groomid, $pdata['pid']);
    if (!$lock['ok']) {
        return obl_command_response_error('COMMAND_IN_PROGRESS', '', null, $request_id);
    }

    try {
        $gate = obl_command_gate($command, $contract, $payload, $envelope, $pdata);
        $dispatched = false;
        if (!$gate['ok']) {
            obl_command_emit_rejected($command, $pdata, $gate['code']);
            $response = obl_command_response_error(
                $gate['code'],
                isset($gate['message']) ? $gate['message'] : '',
                isset($gate['details']) ? $gate['details'] : null,
                $request_id
            );
        } elseif ((int)$pdata['hp'] <= 0) {
            $response = obl_command_response_error('COMMAND_NOT_ALLOWED', '', null, $request_id);
        } else {
            $feedback_snapshot = obl_command_feedback_snapshot();
            if (!empty($contract['advances_tick']) && function_exists('obl_tick_prepare_pending_battle_actor_scope')) {
                obl_tick_prepare_pending_battle_actor_scope($command, isset($pdata['pid']) ? (int)$pdata['pid'] : 0);
            }
            $dispatch = obl_command_handler_dispatch($command, $payload, $pdata);
            if (!empty($dispatch['rollback'])) $GLOBALS['obl_transaction_rollback_only'] = true;
            $feedback = obl_command_feedback_result($command, $feedback_snapshot);
            if (!$dispatch['ok']) {
                $response = obl_command_response_error($dispatch['code'], isset($dispatch['message']) ? $dispatch['message'] : '', null, $request_id);
            } elseif (!$feedback['ok']) {
                $response_data = array(
                    'command' => $command,
                    'refresh' => isset($contract['refresh']) ? $contract['refresh'] : array(),
                );
                if (isset($feedback['feedback'])) {
                    $response_data['feedback'] = $feedback['feedback'];
                }
                $response = obl_command_response_error(
                    $feedback['code'],
                    '',
                    isset($feedback['details']) ? $feedback['details'] : null,
                    $request_id,
                    $response_data
                );
            } else {
                $dispatched = true;
                if (empty($contract['read_only'])) obl_command_after_dispatch($command, $contract, $pdata);
                $response_data = obl_command_build_response_data($command, $contract, $pdata);
                // 允许 handler 返回额外数据（如 combat.can_engage 的 L0 可达性查询结果）
                if (isset($dispatch['data']) && is_array($dispatch['data'])) {
                    $response_data = array_merge($response_data, $dispatch['data']);
                }
                $response = obl_command_response_success($request_id, $response_data, 'OK');
            }
        }

        if (empty($contract['read_only'])) {
            obl_command_save_and_tick($command, $contract, $pdata, $dispatched, isset($obl_runtime_ctx) ? $obl_runtime_ctx : null);
        }
        return $response;
    } catch (Throwable $e) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('command.exception', array(
                'command' => $command,
                'message' => $e->getMessage(),
            ), 'command');
        }
        throw $e;
    }
}


function obl_command_authenticate_player() {
    global $cuser, $cpass;
    if (!$cuser || !$cpass) {
        return array('ok' => false, 'code' => 'AUTH_FAILED');
    }
    $pid = obl_auth_player($cuser, $cpass);
    if ($pid === false) {
        return array('ok' => false, 'code' => 'AUTH_FAILED');
    }
    $pdata = obl_fetch_playerdata_by_pid($pid);
    if (!$pdata) {
        return array('ok' => false, 'code' => 'AUTH_FAILED');
    }
    obl_format_playerdata($pdata);
    return array('ok' => true, 'pdata' => $pdata);
}

function obl_command_gate($command, $contract, $payload, $envelope, &$pdata) {
    if (!obl_command_allowed_by_contract($contract, $pdata)) {
        return array('ok' => false, 'code' => 'COMMAND_NOT_ALLOWED');
    }

    $state_conflict = obl_command_check_expected(isset($envelope['expected']) ? $envelope['expected'] : array(), $pdata);
    if (!$state_conflict['ok']) {
        return $state_conflict;
    }

    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending && empty($contract['itm0_allowed'])) {
        return array('ok' => false, 'code' => 'ITM0_PENDING');
    }
    if ($itm0_pending && $command === 'item.use' && isset($payload['slot']) && (int)$payload['slot'] !== 0) {
        return array('ok' => false, 'code' => 'ITM0_PENDING');
    }

    if (!empty($contract['battle_state_required'])) {
        $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $state = $qid > 0 ? obl_battle_state_get($qid) : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
        if ($state !== $contract['battle_state_required']) {
            return array('ok' => false, 'code' => 'STATE_CONFLICT', 'details' => array('battle_state' => $state));
        }
    }

    if (!empty($contract['queue_actor_required'])) {
        $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $current = $qid > 0 && function_exists('obl_fetch_queue_current_initiator')
            ? obl_fetch_queue_current_initiator($qid)
            : false;
        $current_pid = $current ? (int)$current['pid'] : 0;
        if ($contract['queue_actor_required'] === 'self' && $current_pid !== (int)$pdata['pid']) {
            return array('ok' => false, 'code' => 'STATE_CONFLICT', 'details' => array(
                'current_pid' => $current_pid,
                'pid' => (int)$pdata['pid'],
            ));
        }
    }

    if (!empty($contract['advances_tick']) && obl_tick_has_busy_battle()) {
        $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $own_state = $qid > 0 ? obl_battle_state_get($qid) : '';
        if (!($command === 'battle.submit_turn' && $own_state === (defined('OBL_BS_PLAYER_TURN') ? OBL_BS_PLAYER_TURN : 'PLAYER_TURN'))) {
            return array('ok' => false, 'code' => 'BATTLE_BUSY');
        }
    }

    return array('ok' => true);
}

function obl_command_allowed_by_contract($contract, &$pdata) {
    $action = isset($pdata['action']) ? (string)$pdata['action'] : '';
    $allowed = isset($contract['allowed_actions']) ? $contract['allowed_actions'] : array('');
    foreach ($allowed as $v) {
        $allowed_action = ($v === null) ? '' : (string)$v;
        if ($action === $allowed_action) return true;
    }
    return false;
}

function obl_command_check_expected($expected, &$pdata) {
    if (!is_array($expected) || empty($expected)) return array('ok' => true);
    $details = array();
    if (array_key_exists('pid', $expected) && (int)$expected['pid'] !== (int)$pdata['pid']) $details['pid'] = (int)$pdata['pid'];
    if (array_key_exists('action', $expected) && (string)$expected['action'] !== (string)$pdata['action']) $details['action'] = (string)$pdata['action'];
    if (array_key_exists('bid', $expected) && (int)$expected['bid'] !== (int)$pdata['bid']) $details['bid'] = (int)$pdata['bid'];
    if (array_key_exists('battle_state', $expected)) {
        $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $state = $qid > 0 ? obl_battle_state_get($qid) : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
        if ((string)$expected['battle_state'] !== (string)$state) $details['battle_state'] = $state;
    }
    if (!empty($details)) return array('ok' => false, 'code' => 'STATE_CONFLICT', 'details' => $details);
    return array('ok' => true);
}

function obl_command_itm0_pending(&$pdata) {
    return isset($pdata['itempara'][0]) && is_array($pdata['itempara'][0]) && !empty($pdata['itempara'][0]['itmid']);
}

function obl_command_acquire_lock($groomid, $pid) {
    $lock_file = GAME_ROOT . './oblivions/cache/locks/obl_lock_' . (int)$groomid . '_' . (int)$pid . '.php';
    $lock_dir = dirname($lock_file);
    if (!is_dir($lock_dir)) @mkdir($lock_dir, 0755, true);
    $fp = fopen($lock_file, 'w');
    if (!$fp || !flock($fp, LOCK_EX | LOCK_NB)) return array('ok' => false);
    return array('ok' => true, 'fp' => $fp);
}

function obl_command_after_dispatch($command, $contract, &$pdata) {
    if (empty($contract['advances_tick'])) return;
    $player_qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
    if ($player_qid > 0 && obl_battle_state_get($player_qid) === (defined('OBL_BS_PLAYER_TURN') ? OBL_BS_PLAYER_TURN : 'PLAYER_TURN')) {
        obl_battle_state_transition($player_qid, 'player_acted');
    }
}

function obl_command_save_and_tick($command, $contract, &$pdata, $dispatched, $ctx = null) {
    if (!function_exists('obl_tick_orchestrator_after_command')) {
        throw new RuntimeException('Tick Orchestrator 未加载');
    }
    return obl_tick_orchestrator_after_command($ctx, $command, $contract, $pdata, $dispatched);
}

function obl_command_feedback_snapshot() {
    global $obl_log, $obl_error_log;
    $log_count = 0;
    $error_count = 0;
    if (isset($obl_log) && $obl_log) {
        $entries = $obl_log->getEntries();
        $log_count = is_array($entries) ? count($entries) : 0;
    }
    if (isset($obl_error_log) && $obl_error_log) {
        $entries = $obl_error_log->getEntries();
        $error_count = is_array($entries) ? count($entries) : 0;
    }
    return array('log_count' => $log_count, 'error_count' => $error_count);
}

function obl_command_feedback_result($command, $snapshot) {
    global $obl_log, $obl_error_log;

    $log_entries = array();
    if (isset($obl_log) && $obl_log) {
        $entries = $obl_log->getEntries();
        if (is_array($entries)) {
            $start = isset($snapshot['log_count']) ? (int)$snapshot['log_count'] : 0;
            $log_entries = array_slice($entries, $start);
        }
    }

    $error_entries = array();
    if (isset($obl_error_log) && $obl_error_log) {
        $entries = $obl_error_log->getEntries();
        if (is_array($entries)) {
            $start = isset($snapshot['error_count']) ? (int)$snapshot['error_count'] : 0;
            $error_entries = array_slice($entries, $start);
        }
    }

    $rules = obl_command_feedback_rules($command);
    $error_rules = isset($rules['error']) ? $rules['error'] : array();
    foreach ($error_entries as $entry) {
        $id = isset($entry['id']) ? (string)$entry['id'] : '';
        if ($id !== '' && isset($error_rules[$id])) {
            return obl_command_feedback_error($error_rules[$id], $entry, 'error');
        }
    }

    $log_rules = isset($rules['log']) ? $rules['log'] : array();
    foreach ($log_entries as $entry) {
        $id = isset($entry['id']) ? (string)$entry['id'] : '';
        if ($id !== '' && isset($log_rules[$id])) {
            return obl_command_feedback_error($log_rules[$id], $entry, 'log');
        }
    }

    return array('ok' => true);
}

function obl_command_feedback_rules($command) {
    $common = array();
    $rules = array(
        'map.move' => array(
            'log' => array(
                'move.same_pos' => 'MOVE_SAME_POSITION',
                'move.invalid_target' => 'MOVE_INVALID_TARGET',
                'move.blocked' => 'MOVE_BLOCKED',
                'move.occupied' => 'MOVE_OCCUPIED',
                'move.unreachable' => 'MOVE_UNREACHABLE',
                'move.no_path' => 'MOVE_NO_PATH',
                'move.no_sp_far' => 'NO_SP',
                'move.no_sp' => 'NO_SP',
            ),
        ),
        'map.explore' => array(
            'log' => array(
                'explore.no_sp' => 'NO_SP',
            ),
        ),
        'poi.search' => array(
            'log' => array(
                'search.not_found' => 'POI_NOT_FOUND',
                'search.not_adjacent' => 'POI_NOT_HERE',
                'search.not_searchable' => 'POI_NOT_SEARCHABLE',
                'search.already_searched' => 'POI_ALREADY_SEARCHED',
            ),
            'error' => array(
                'search.data_error' => 'POI_DATA_ERROR',
            ),
        ),
        'item.pickup' => array(
            'log' => array(
                'pickup.not_found' => 'ITEM_NOT_FOUND',
                'pickup.empty_item' => 'ITEM_EMPTY',
                'pickup.not_adjacent' => 'ITEM_NOT_HERE',
                'pickup.unknown' => 'ITEM_NOT_DISCOVERED',
                'system.itm0_occupied' => 'ITM0_PENDING',
                'system.pickup_concurrent_loss' => 'ITEM_NOT_FOUND',
            ),
        ),
        'item.discard' => array(
            'log' => array(
                'discard.invalid_slot' => 'INVALID_SLOT',
                'discard.empty_slot' => 'EMPTY_SLOT',
            ),
        ),
        'item.use' => array(
            'log' => array(
                'system.itm0_pending' => 'ITM0_PENDING',
                'use_item.empty_slot' => 'EMPTY_SLOT',
                'use_item.not_usable' => 'ITEM_NOT_USABLE',
                'use_item.broken' => 'ITEM_BROKEN',
            ),
        ),
        'inventory.organize' => array(
            'log' => array(
                'organize.fail' => 'BAG_FULL',
            ),
        ),
        'craft.execute' => array(
            'log' => array(
                'craft.fail_no_match' => 'CRAFT_NO_MATCH',
                'craft.fail_ambiguous' => 'CRAFT_AMBIGUOUS',
                'craft.fail_itm0_occupied' => 'ITM0_PENDING',
            ),
        ),
        'battle.start' => array(
            'error' => array(
                'battle_entry.empty_actions' => 'INVALID_PAYLOAD',
            ),
        ),
        'battle.submit_turn' => array(
            'error' => array(
                'battle_entry.empty_actions' => 'INVALID_PAYLOAD',
            ),
        ),
    );

    return isset($rules[$command]) ? $rules[$command] : array('log' => $common, 'error' => array());
}

function obl_command_feedback_error($rule, $entry, $source = 'log') {
    $code = is_string($rule) ? $rule : 'DOMAIN_REJECTED';
    $params = isset($entry['params']) && is_array($entry['params']) ? $entry['params'] : array();

    $id = isset($entry['id']) ? (string)$entry['id'] : '';
    $feedback = array(
        'id' => $id,
        'params' => $params,
        'source' => $source,
    );
    return array(
        'ok' => false,
        'code' => $code,
        'feedback' => $feedback,
        'details' => array(
            'event_id' => $id,
            'params' => $params,
            'feedback' => $feedback,
        ),
    );
}

function obl_command_persist_logs(&$pdata) {
    global $obl_log, $obl_error_log, $obl_battle_log, $groomid;
    if (isset($obl_log) && $obl_log && $obl_log->hasEntries()) obl_log_persist($obl_log, $groomid, $pdata['pid']);
    if (isset($obl_error_log) && $obl_error_log && $obl_error_log->hasEntries()) obl_error_log_persist($obl_error_log, $groomid, $pdata['pid']);
    if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries()) obl_battle_log_persist($obl_battle_log, $groomid, $pdata['pid']);
}

function obl_command_emit_rejected($command, &$pdata, $reason) {
    global $obl_error_log;
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('command.rejected', array(
            'command' => $command,
            'action' => isset($pdata['action']) ? $pdata['action'] : '',
            'reason' => $reason,
        ), 'command');
    }
}

function obl_command_build_response_data($command, $contract, &$pdata) {
    $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
    $battle_state = $qid > 0 ? obl_battle_state_get($qid) : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
    return array(
        'command' => $command,
        'tick_advanced' => !empty($contract['advances_tick']),
        'refresh' => isset($contract['refresh']) ? $contract['refresh'] : array(),
        'server_state' => array(
            'pid' => (int)$pdata['pid'],
            'action' => isset($pdata['action']) ? (string)$pdata['action'] : '',
            'bid' => $qid,
            'battle_state' => $battle_state,
        ),
    );
}
