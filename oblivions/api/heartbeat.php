<?php
/**
 * @framework A-1 HTTP 三层入口隔离架构
 * @module A API 层
 * Heartbeat API 入口 —— 服务器端写入（tick 推进），使用 MySQL 事务 + 房间锁
 */

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
    $error = obl_runtime_shutdown_cleanup();
    if ($error) {
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
$GLOBALS['obl_runtime_lock_name'] = $lock_name;

try {
    obl_runtime_transaction_begin();
    obl_runtime_reload_tick_globals();
    $result = obl_tick_orchestrator_heartbeat($ctx);
    $presentation_pdata = obl_fetch_playerdata_by_name($GLOBALS['cuser']);
    $presentation = obl_runtime_prepare_presentation($presentation_pdata, '');
    obl_runtime_transaction_commit();
    $pdata = obl_fetch_playerdata_by_name($GLOBALS['cuser']);
    $warnings = array();
    if ($pdata) {
        $persist = obl_runtime_persist_logs($pdata, 'heartbeat');
        $warnings = $persist['warnings'] ?? array();
    }
    obl_runtime_release_room_lock($lock_name);
    $GLOBALS['obl_runtime_lock_name'] = null;
    $response = array(
        'ok' => true,
        'code' => 'OK',
        'message' => 'OK',
        'data' => $result,
    );
    if (!empty($warnings)) $response['warnings'] = array_values($warnings);
    $response = obl_runtime_attach_presentation($response, $presentation);
    obl_command_response_emit($response);
} catch (Throwable $e) {
    obl_runtime_transaction_rollback();
    obl_runtime_release_room_lock($lock_name);
    $GLOBALS['obl_runtime_lock_name'] = null;
    obl_command_response_emit(obl_command_response_error('INTERNAL_ERROR', $e->getMessage()));
}
exit;
