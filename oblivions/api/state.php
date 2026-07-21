<?php
/**
 * @framework A-1 HTTP 三层入口隔离架构
 * @module A API 层
 * State API 入口 —— 纯读 GET，不使用事务和锁，表不存在时返回虚拟空状态
 */

define('CURSCRIPT', 'api');

$obl_project_root = dirname(__DIR__, 2);
chdir($obl_project_root);

define('IN_GAME', true);
define('GAME_ROOT', $obl_project_root . '/');
define('GAMENAME', 'bra');

require_once GAME_ROOT . './oblivions/include/api/obl_state_api_bootstrap.php';

$ctx = obl_runtime_boot('state');
$GLOBALS['obl_runtime_ctx'] = $ctx;

register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true)) {
        obl_state_response_emit(obl_state_response_error(
            $error['message'] . ' in ' . $error['file'] . ':' . $error['line'],
            'PHP_FATAL'
        ));
    }
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    // O-4 编辑器守卫：?editor=1 时附加 Authorization 头与通配 origin，便于编辑器跨域调用
    if (isset($_GET['editor']) && $_GET['editor'] === '1') {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Headers: Authorization, Content-Type, X-CSRF-Token');
    } else {
        header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
    }
    http_response_code(200);
    exit;
}

// O-4 编辑器守卫：?editor=1 时附加 CORS 头（编辑器使用 token 认证，不发 cookie，可安全使用 *）
if (isset($_GET['editor']) && $_GET['editor'] === '1') {
    header('Access-Control-Allow-Origin: *');
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    obl_state_response_emit(obl_state_response_error('只允许 GET 请求', 'INVALID_METHOD'));
    exit;
}

if (!obl_runtime_require_oblivions($ctx)) {
    obl_state_response_emit(obl_state_response_error('当前不是 Oblivions 模式', 'NOT_OBLIVIONS'));
    exit;
}

try {
    // state.php 是纯读接口：只同步内存镜像并返回状态，不获取房间写锁，不 resolve pending tick。
    // 使用 no-create sync，避免纯读请求在缺表/缺行时产生 schema 或运行状态创建副作用。
    if (function_exists('obl_gamevars_sync_to_globals')) {
        obl_gamevars_sync_to_globals(false, false);
    }

    $scope = isset($_GET['scope']) ? (string)$_GET['scope'] : '';
    $response = obl_state_dispatch($scope, $ctx);
    obl_state_response_emit($response);
} catch (OblStateApiException $e) {
    obl_state_response_emit(obl_state_response_error($e->getMessage(), $e->getStateCode(), $e->getDetails()));
} catch (Throwable $e) {
    obl_state_response_emit(obl_state_response_error($e->getMessage(), 'INTERNAL_ERROR'));
}
exit;
