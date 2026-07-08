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
        return obl_command_response_error('UNKNOWN_COMMAND', '未知命令', array('command' => $command), $request_id);
    }

    $payload_check = obl_command_validate_payload($envelope['payload'], isset($contract['payload_schema']) ? $contract['payload_schema'] : array());
    if (!$payload_check['ok']) {
        return obl_command_response_error($payload_check['code'], $payload_check['message'], isset($payload_check['details']) ? $payload_check['details'] : null, $request_id);
    }
    $payload = $payload_check['payload'];

    $auth = obl_command_authenticate_player();
    if (!$auth['ok']) {
        return obl_command_response_error('AUTH_FAILED', $auth['message'], null, $request_id);
    }
    $pdata = $auth['pdata'];

    $lock = obl_command_acquire_lock($groomid, $pdata['pid']);
    if (!$lock['ok']) {
        return obl_command_response_error('COMMAND_IN_PROGRESS', '上一个命令仍在处理中', null, $request_id);
    }

    try {
        $gate = obl_command_gate($command, $contract, $payload, $envelope, $pdata);
        $dispatched = false;
        if (!$gate['ok']) {
            obl_command_emit_rejected($command, $pdata, $gate['code']);
            $response = obl_command_response_error($gate['code'], $gate['message'], isset($gate['details']) ? $gate['details'] : null, $request_id);
        } elseif ((int)$pdata['hp'] <= 0) {
            $response = obl_command_response_error('COMMAND_NOT_ALLOWED', '角色无法行动', null, $request_id);
        } else {
            $dispatch = obl_command_handler_dispatch($command, $payload, $pdata);
            if (!$dispatch['ok']) {
                $response = obl_command_response_error($dispatch['code'], $dispatch['message'], null, $request_id);
            } else {
                $dispatched = true;
                obl_command_after_dispatch($command, $contract, $pdata);
                $response = obl_command_response_success($request_id, obl_command_build_response_data($command, $contract, $pdata), 'OK');
            }
        }

        obl_command_persist_logs($pdata);
        obl_command_save_and_tick($command, $contract, $pdata, $dispatched, isset($obl_runtime_ctx) ? $obl_runtime_ctx : null);
        return $response;
    } catch (Throwable $e) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('command.exception', array(
                'command' => $command,
                'message' => $e->getMessage(),
            ), 'command');
        }
        if (isset($pdata) && is_array($pdata)) {
            obl_command_persist_logs($pdata);
        }
        return obl_command_response_error('INTERNAL_ERROR', $e->getMessage(), null, $request_id);
    }
}


function obl_command_authenticate_player() {
    global $cuser, $cpass;
    if (!$cuser || !$cpass) {
        return array('ok' => false, 'message' => '认证失败，请重新登录');
    }
    $pid = obl_auth_player($cuser, $cpass);
    if ($pid === false) {
        return array('ok' => false, 'message' => '认证失败，请重新登录');
    }
    $pdata = obl_fetch_playerdata_by_pid($pid);
    if (!$pdata) {
        return array('ok' => false, 'message' => '角色不存在，请重新激活');
    }
    obl_format_playerdata($pdata);
    return array('ok' => true, 'pdata' => $pdata);
}

function obl_command_gate($command, $contract, $payload, $envelope, &$pdata) {
    if (!obl_command_allowed_by_contract($contract, $pdata)) {
        return array('ok' => false, 'code' => 'COMMAND_NOT_ALLOWED', 'message' => '当前状态不可执行此命令');
    }

    $state_conflict = obl_command_check_expected(isset($envelope['expected']) ? $envelope['expected'] : array(), $pdata);
    if (!$state_conflict['ok']) {
        return $state_conflict;
    }

    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending && empty($contract['itm0_allowed'])) {
        return array('ok' => false, 'code' => 'ITM0_PENDING', 'message' => '手持临时道具未处理');
    }
    if ($itm0_pending && $command === 'item.use' && isset($payload['slot']) && (int)$payload['slot'] !== 0) {
        return array('ok' => false, 'code' => 'ITM0_PENDING', 'message' => '手持临时道具未处理');
    }

    if (!empty($contract['battle_state_required'])) {
        $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $state = $qid > 0 ? obl_battle_state_get($qid) : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
        if ($state !== $contract['battle_state_required']) {
            return array('ok' => false, 'code' => 'STATE_CONFLICT', 'message' => '战斗状态已变化', 'details' => array('battle_state' => $state));
        }
    }

    if (!empty($contract['advances_tick']) && obl_tick_has_busy_battle()) {
        $qid = isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
        $own_state = $qid > 0 ? obl_battle_state_get($qid) : '';
        if (!($command === 'battle.submit_turn' && $own_state === (defined('OBL_BS_PLAYER_TURN') ? OBL_BS_PLAYER_TURN : 'PLAYER_TURN'))) {
            return array('ok' => false, 'code' => 'BATTLE_BUSY', 'message' => '战斗处理中，请稍候');
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
    if (!empty($details)) return array('ok' => false, 'code' => 'STATE_CONFLICT', 'message' => '客户端状态已过期', 'details' => $details);
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
