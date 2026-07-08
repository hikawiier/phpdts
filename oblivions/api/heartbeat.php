<?php

define('CURSCRIPT', 'api');

$obl_project_root = dirname(__DIR__, 2);
chdir($obl_project_root);

define('IN_GAME', true);
define('GAME_ROOT', $obl_project_root . '/');
define('GAMENAME', 'bra');

require_once GAME_ROOT . './oblivions/include/api/obl_heartbeat_api_bootstrap.php';

$ctx = obl_runtime_boot('heartbeat');
$GLOBALS['obl_runtime_ctx'] = $ctx;

register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true)) {
        obl_command_response_emit(obl_command_response_error(
            'PHP_FATAL',
            $error['message'] . ' in ' . $error['file'] . ':' . $error['line']
        ));
    }
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    obl_command_response_emit(obl_command_response_error('INVALID_METHOD', '只允许 POST 请求'));
    exit;
}

if (!obl_runtime_require_oblivions($ctx)) {
    obl_command_response_emit(obl_command_response_error('COMMAND_NOT_ALLOWED', '当前不是 Oblivions 模式'));
    exit;
}

$lock_name = obl_runtime_acquire_room_lock(5);
if (!$lock_name) {
    obl_command_response_emit(obl_command_response_error('COMMAND_IN_PROGRESS', '房间正在处理中'));
    exit;
}

try {
    obl_runtime_reload_tick_globals();
    $result = obl_tick_orchestrator_heartbeat($ctx);
    $pdata = obl_fetch_playerdata_by_name($GLOBALS['cuser']);
    if ($pdata) {
        obl_runtime_persist_logs($pdata, 'heartbeat');
    }
    obl_runtime_release_room_lock($lock_name);
    obl_command_response_emit(array(
        'ok' => true,
        'code' => 'OK',
        'message' => 'OK',
        'data' => $result,
    ));
} catch (Throwable $e) {
    obl_runtime_release_room_lock($lock_name);
    obl_command_response_emit(obl_command_response_error('INTERNAL_ERROR', $e->getMessage()));
}
exit;
