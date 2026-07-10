<?php

define('CURSCRIPT', 'api');

$obl_project_root = dirname(__DIR__, 2);
chdir($obl_project_root);

define('IN_GAME', true);
define('GAME_ROOT', $obl_project_root . '/');
define('GAMENAME', 'bra');

require_once GAME_ROOT . './oblivions/include/api/obl_command_api_bootstrap.php';

$ctx = obl_runtime_boot('command');
$GLOBALS['obl_runtime_ctx'] = $ctx;

register_shutdown_function(function () {
    $error = obl_runtime_shutdown_cleanup();
    if ($error) {
        $response = obl_command_response_error(
            'PHP_FATAL',
            $error['message'] . ' in ' . $error['file'] . ':' . $error['line']
        );
        obl_command_response_emit($response);
    }
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    obl_command_response_emit(obl_command_response_error('INVALID_ENVELOPE', '', array('reason' => 'method_not_allowed')));
    exit;
}

if (!obl_runtime_require_oblivions($ctx)) {
    obl_command_response_emit(obl_command_response_error('COMMAND_NOT_ALLOWED', '', array('reason' => 'not_oblivions_mode')));
    exit;
}

$read = obl_json_request_read();
if (!$read['ok']) {
    obl_command_response_emit(obl_command_response_error(
        $read['code'],
        isset($read['message']) ? $read['message'] : '',
        isset($read['details']) ? $read['details'] : null
    ));
    exit;
}

$envelope_check = obl_command_validate_envelope($read['body']);
if (!$envelope_check['ok']) {
    obl_command_response_emit(obl_command_response_error(
        $envelope_check['code'],
        isset($envelope_check['message']) ? $envelope_check['message'] : '',
        isset($envelope_check['details']) ? $envelope_check['details'] : null
    ));
    exit;
}

$lock_name = obl_runtime_acquire_room_lock(5);
if (!$lock_name) {
    obl_command_response_emit(obl_command_response_error('COMMAND_IN_PROGRESS', '', array('reason' => 'room_lock_busy')));
    exit;
}
$GLOBALS['obl_runtime_lock_name'] = $lock_name;

try {
    obl_runtime_transaction_begin();
    obl_runtime_reload_tick_globals();
    $response = obl_command_api_handle($envelope_check['envelope']);
    $rolled_back = !empty($GLOBALS['obl_transaction_rollback_only']);
    $presentation = null;
    if ($rolled_back) {
        obl_runtime_transaction_rollback();
    } else {
        $presentation_pdata = obl_fetch_playerdata_by_name($GLOBALS['cuser']);
        $presentation = obl_runtime_prepare_presentation(
            $presentation_pdata,
            isset($response['request_id']) ? (string)$response['request_id'] : ''
        );
        obl_runtime_transaction_commit();
        $response = obl_runtime_attach_presentation($response, $presentation);
    }

    if (!$rolled_back) {
        $pdata = obl_fetch_playerdata_by_name($GLOBALS['cuser']);
        $persist = obl_runtime_persist_logs($pdata, 'command');
        if (!empty($persist['warnings'])) $response['warnings'] = array_values($persist['warnings']);
    }
    obl_runtime_release_room_lock($lock_name);
    $GLOBALS['obl_runtime_lock_name'] = null;
    obl_command_response_emit($response);
} catch (Throwable $e) {
    obl_runtime_transaction_rollback();
    obl_runtime_release_room_lock($lock_name);
    $GLOBALS['obl_runtime_lock_name'] = null;
    obl_command_response_emit(obl_command_response_error('INTERNAL_ERROR', $e->getMessage()));
}
exit;
