<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions Runtime
//
// 当前职责：为 Oblivions command / heartbeat / state API 提供独立运行期，
// 不再依赖 include/core/common.inc.php；仍复用项目 DB 基础设施与 Oblivions 领域函数库。
// ================================================================

function obl_runtime_boot($kind = 'command') {
    global $db, $now, $gtablepre, $tablepre, $groomid, $gruleset, $udata, $gamevars, $gamestate;
    global $cuser, $cpass, $obl_log, $obl_error_log, $obl_battle_log;
    global $dbhost, $dbuser, $dbpw, $dbname, $pconnect, $database, $dbcharset, $charset;
    global $slave_level, $master_dbhost, $master_dbuser, $master_dbpw, $master_dbname, $master_tablepre;
    global $moveut, $moveutmin, $cookiedomain, $cookiepath, $errorinfo, $gamecfg;

    if (!defined('IN_GAME')) define('IN_GAME', true);
    if (!defined('GAME_ROOT')) define('GAME_ROOT', dirname(__DIR__, 3) . '/');
    if (!defined('GAMENAME')) define('GAMENAME', 'bra');

    chdir(GAME_ROOT);

    require_once GAME_ROOT . './include/core/global.func.php';
    require_once GAME_ROOT . './include/auth/user.func.php';

    if (!isset($GLOBALS['magic_quotes_gpc'])) $GLOBALS['magic_quotes_gpc'] = 0;

    error_reporting(E_ALL);
    set_error_handler('gameerrorhandler');

    $_COOKIE = gstrfilter($_COOKIE);
    $_POST = gstrfilter($_POST);
    $_GET = gstrfilter($_GET);
    $_REQUEST = gstrfilter($_REQUEST);
    $_FILES = gstrfilter($_FILES);

    require GAME_ROOT . './config.inc.php';
    require GAME_ROOT . './gamedata/system.php';

    date_default_timezone_set('Etc/GMT');
    $now = time() + $moveut * 3600 + $moveutmin * 60;

    require GAME_ROOT . './include/db/db_' . $database . '.class.php';
    $db = new dbstuff;
    if (isset($slave_level) && $slave_level == 3 && !empty($master_dbhost) && !empty($master_dbuser) && !empty($master_dbname)) {
        $db->connect($master_dbhost, $master_dbuser, $master_dbpw, $master_dbname, $pconnect);
        $gtablepre = $master_tablepre;
    } else {
        $db->connect($dbhost, $dbuser, $dbpw, $dbname, $pconnect);
        $gtablepre = $tablepre;
    }

    $cookie_user_key = $gtablepre . 'user';
    $cookie_pass_key = $gtablepre . 'pass';
    $cuser = isset($_COOKIE[$cookie_user_key]) ? $_COOKIE[$cookie_user_key] : '';
    $cpass = isset($_COOKIE[$cookie_pass_key]) ? $_COOKIE[$cookie_pass_key] : '';

    if ((!$cuser || !$cpass) && file_exists(GAME_ROOT . './debug_autologin.php')) {
        include GAME_ROOT . './debug_autologin.php';
        if (!empty($debug_autologin_user) && !empty($debug_autologin_pass)) {
            $cuser = $debug_autologin_user;
            $cpass = md5($debug_autologin_pass);
            gsetcookie('user', $cuser);
            gsetcookie('pass', $cpass);
        }
    }

    $udata = $cuser ? fetch_userdata_by_username($cuser) : null;
    $groomid = isset($udata['roomid']) ? (int)$udata['roomid'] : 0;
    $base_tablepre = $tablepre;
    $tablepre = !empty($groomid) ? $base_tablepre . 's' . $groomid . '_' : $base_tablepre;

    $room = null;
    $gruleset = '';
    if ($groomid > 0) {
        $result = $db->query("SELECT * FROM {$gtablepre}game WHERE groomid = " . (int)$groomid . " LIMIT 1");
        $room = $db->fetch_array($result);
        if ($room) {
            $gruleset = isset($room['gruleset']) ? $room['gruleset'] : '';
            $gamestate = isset($room['gamestate']) ? (int)$room['gamestate'] : 0;
        }
    }

    require_once GAME_ROOT . './oblivions/include/core/obl_bootstrap.php';

    $gamevars = array();
    if ($gruleset === 'OBLIVIONS') {
        // 旧 game 表仍提供房间生命周期，oblgame 提供 tick/gamevars。
        // state.php 是纯读入口，不应在缺表/缺行时产生创建副作用。
        obl_gamevars_sync_to_globals($kind !== 'state', false);
    }

    if (!isset($obl_log)) $obl_log = new OblivionsLogger();
    if (!isset($obl_error_log)) $obl_error_log = new OblivionsErrorLogger();
    if (!isset($obl_battle_log)) $obl_battle_log = new BattleLogCollector();

    if (empty($GLOBALS['obl_request_uid'])) {
        try {
            $GLOBALS['obl_request_uid'] = $kind . '-' . bin2hex(random_bytes(8));
        } catch (Throwable $e) {
            $GLOBALS['obl_request_uid'] = $kind . '-' . str_replace('.', '', uniqid('', true));
        }
    }

    return array(
        'kind' => $kind,
        'now' => $now,
        'db' => $db,
        'gtablepre' => $gtablepre,
        'tablepre' => $tablepre,
        'groomid' => $groomid,
        'room' => $room,
        'is_oblivions' => ($gruleset === 'OBLIVIONS'),
        'cuser' => $cuser,
        'cpass' => $cpass,
        'udata' => $udata,
    );
}

function obl_runtime_require_oblivions($ctx) {
    return is_array($ctx) && !empty($ctx['is_oblivions']);
}

function obl_runtime_acquire_room_lock($timeout = 5) {
    global $db, $groomid;
    $lock_name = 'game_state_' . intval($groomid);
    $lock_result = $db->query("SELECT GET_LOCK('" . addslashes($lock_name) . "', " . (int)$timeout . ") AS lock_acquired");
    $lock_row = $db->fetch_array($lock_result);
    if ($lock_row && (int)$lock_row['lock_acquired'] === 1) {
        return $lock_name;
    }
    return false;
}

function obl_runtime_release_room_lock($lock_name) {
    global $db;
    if ($lock_name) {
        try {
            $db->query("SELECT RELEASE_LOCK('" . addslashes($lock_name) . "')", 'SILENT');
        } catch (Throwable $e) {
            // A broken connection already releases its MySQL named locks server-side.
        }
    }
}

function obl_runtime_transaction_begin() {
    global $db;
    if (!empty($GLOBALS['obl_transaction_active'])) {
        throw new RuntimeException('Oblivions transaction already active');
    }
    $GLOBALS['obl_db_throw_on_error'] = true;
    $db->query('START TRANSACTION');
    $GLOBALS['obl_transaction_active'] = true;
}

function obl_runtime_transaction_commit() {
    global $db;
    if (empty($GLOBALS['obl_transaction_active'])) return;
    $db->query('COMMIT');
    $GLOBALS['obl_transaction_active'] = false;
    $GLOBALS['obl_db_throw_on_error'] = false;
}

function obl_runtime_transaction_rollback() {
    global $db;
    if (empty($GLOBALS['obl_transaction_active'])) {
        $GLOBALS['obl_db_throw_on_error'] = false;
        return;
    }
    try {
        $db->query('ROLLBACK', 'SILENT');
    } catch (Throwable $e) {
        // Connection loss rolls the server transaction back automatically.
    } finally {
        $GLOBALS['obl_transaction_active'] = false;
        $GLOBALS['obl_db_throw_on_error'] = false;
    }
}

function obl_runtime_transaction_is_active() {
    return !empty($GLOBALS['obl_transaction_active']);
}

function obl_runtime_shutdown_cleanup() {
    $error = error_get_last();
    if (obl_runtime_transaction_is_active()) {
        obl_runtime_transaction_rollback();
    }
    if (!empty($GLOBALS['obl_runtime_lock_name'])) {
        obl_runtime_release_room_lock($GLOBALS['obl_runtime_lock_name']);
        $GLOBALS['obl_runtime_lock_name'] = null;
    }
    if ($error && in_array($error['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true)) {
        return $error;
    }
    return null;
}

function obl_runtime_persist_logs($pdata = null, $source = 'api', $writers = array()) {
    global $obl_log, $obl_error_log, $obl_battle_log, $groomid;
    $pid = is_array($pdata) && isset($pdata['pid']) ? (int)$pdata['pid'] : 0;
    if ($pid <= 0) return array('ok' => true, 'warnings' => array());
    $warnings = array();
    if (isset($obl_log) && $obl_log && $obl_log->hasEntries()) obl_log_persist($obl_log, $groomid, $pid);
    if (isset($obl_error_log) && $obl_error_log && $obl_error_log->hasEntries()) obl_error_log_persist($obl_error_log, $groomid, $pid);
    if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries()) {
        $battle_writer = isset($writers['battle']) && is_callable($writers['battle'])
            ? $writers['battle']
            : 'obl_battle_log_persist';
        $persisted = call_user_func($battle_writer, $obl_battle_log, $groomid, $pid);
        if ($persisted === false) $warnings[] = 'BATTLELOG_PERSIST_FAILED';
    }
    $debug_writer = isset($writers['debug']) && is_callable($writers['debug'])
        ? $writers['debug']
        : (function_exists('combat_debug_persist') ? 'combat_debug_persist' : null);
    if ($debug_writer !== null && call_user_func($debug_writer) === false) {
        $warnings[] = 'COMBAT_DEBUG_PERSIST_FAILED';
    }
    return array('ok' => true, 'warnings' => $warnings);
}

function obl_runtime_reload_tick_globals() {
    if (function_exists('obl_gamevars_sync_to_globals')) {
        obl_gamevars_sync_to_globals(true, false);
    }
}

function obl_runtime_save_tick_globals($extra = array()) {
    if (function_exists('obl_gamevars_sync_from_globals')) {
        obl_gamevars_sync_from_globals($extra);
    }
}
