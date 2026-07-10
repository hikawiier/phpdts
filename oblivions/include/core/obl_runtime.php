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

/**
 * 在领域事务内冻结本请求的演出批次并推进房间级 head sequence。
 * 返回值只能在事务 COMMIT 成功后附加到 HTTP response。
 */
function obl_runtime_prepare_presentation($pdata = null, $request_id = '') {
    global $obl_battle_log, $gamevars, $groomid;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
    $head_seq = isset($gamevars['obl_presentation_head_seq'])
        ? max(0, (int)$gamevars['obl_presentation_head_seq'])
        : 0;

    $entries = isset($obl_battle_log) && $obl_battle_log
        ? $obl_battle_log->getEntries()
        : array();
    $events = array();
    foreach ($entries as $entry) {
        if (!is_array($entry) || !empty($entry['debug'])) continue;
        $event = $entry;
        $event['event_seq'] = count($events) + 1;
        // 迁移期兼容现有 Director；log_id 不再具有服务端确认语义。
        $event['log_id'] = $event['event_seq'];
        $event['played'] = 1;
        $events[] = $event;
    }

    if (empty($events)) {
        return array('head_seq' => $head_seq, 'batch' => null);
    }

    $batch_seq = $head_seq + 1;
    $gamevars['obl_presentation_head_seq'] = $batch_seq;
    obl_runtime_save_tick_globals();

    $pid = is_array($pdata) && isset($pdata['pid']) ? (int)$pdata['pid'] : 0;
    $player_bid = is_array($pdata) && isset($pdata['bid']) ? (int)$pdata['bid'] : 0;
    $qid = $player_bid;
    foreach (array_reverse($events) as $event) {
        $event_qid = isset($event['qid']) ? (int)$event['qid'] : 0;
        if ($event_qid <= 0 && isset($event['payload']['qid'])) {
            $event_qid = (int)$event['payload']['qid'];
        }
        if ($event_qid > 0) {
            $qid = $event_qid;
            break;
        }
    }

    $battle_state = $player_bid > 0 && function_exists('obl_battle_state_get')
        ? obl_battle_state_get($player_bid)
        : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
    $state_after = array(
        'pid' => $pid,
        'action' => is_array($pdata) && isset($pdata['action']) ? (string)$pdata['action'] : '',
        'bid' => $player_bid,
        'battle_state' => $battle_state,
        'pgroup' => is_array($pdata) && isset($pdata['pgroup']) ? (int)$pdata['pgroup'] : 0,
        'pls' => is_array($pdata) && isset($pdata['pls']) ? (int)$pdata['pls'] : 0,
        'state' => is_array($pdata) && isset($pdata['state']) ? (int)$pdata['state'] : 0,
        'hp' => is_array($pdata) && isset($pdata['hp']) ? (int)$pdata['hp'] : 0,
        'ap' => is_array($pdata) && isset($pdata['ap']) ? (int)$pdata['ap'] : 0,
    );

    return array(
        'head_seq' => $batch_seq,
        'batch' => array(
            'schema' => 'presentation.v1',
            'batch_seq' => $batch_seq,
            'groomid' => isset($groomid) ? (int)$groomid : 0,
            'recipient_pid' => $pid,
            'qid' => $qid > 0 ? $qid : null,
            'request_id' => $request_id !== '' ? (string)$request_id : (string)($GLOBALS['obl_request_uid'] ?? ''),
            'tick' => isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0,
            'state_after' => $state_after,
            'events' => $events,
        ),
    );
}

function obl_runtime_attach_presentation($response, $prepared) {
    if (!is_array($response)) $response = array();
    $response['presentation_head_seq'] = is_array($prepared) && isset($prepared['head_seq'])
        ? (int)$prepared['head_seq']
        : 0;
    if (is_array($prepared) && !empty($prepared['batch'])) {
        $response['presentation'] = $prepared['batch'];
    }
    return $response;
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
    if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries()
        && isset($writers['battle']) && is_callable($writers['battle'])) {
        // 在线演出已由 response PresentationBatch 投递。这里只保留显式注入的
        // best-effort archive writer，不再默认维护 mutable played JSON。
        $persisted = call_user_func($writers['battle'], $obl_battle_log, $groomid, $pid);
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
