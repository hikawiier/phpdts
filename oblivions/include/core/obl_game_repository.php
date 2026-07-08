<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 单房间 Game State Repository
//
// 当前职责：把 Oblivions 单局 runtime state 从旧 game.gamevars
// 分离到当前房间专属 {$tablepre}oblgame 表。
//
// 约定：
// - 每个房间一张 {$tablepre}oblgame 表。
// - 每张表固定一行，id = 1。
// - tick / processed_tick 是主字段，不写入 vars_json。
// - 仍通过 $gamevars 给部分领域函数提供运行期兼容镜像。
// ================================================================

function obl_game_table_name($tablepre_override = '') {
    global $tablepre;
    $prefix = ($tablepre_override !== '') ? $tablepre_override : (isset($tablepre) ? $tablepre : '');
    return $prefix . 'oblgame';
}

function obl_game_json_encode($data) {
    if (function_exists('compatible_json_encode')) {
        return compatible_json_encode($data);
    }
    if (defined('JSON_UNESCAPED_UNICODE')) {
        return json_encode($data, JSON_UNESCAPED_UNICODE);
    }
    return json_encode($data);
}

function obl_game_json_decode($json) {
    if (!is_string($json) || $json === '') return array();
    $data = json_decode($json, true);
    return is_array($data) ? $data : array();
}

function obl_gamevars_without_tick_keys($vars) {
    if (!is_array($vars)) return array();
    $copy = $vars;
    if (isset($copy['obl_tick'])) unset($copy['obl_tick']);
    if (isset($copy['obl_pretick'])) unset($copy['obl_pretick']);
    return $copy;
}

function obl_game_encode_vars($vars) {
    return obl_game_json_encode(obl_gamevars_without_tick_keys($vars));
}

function obl_game_state_from_legacy_gamestate($legacy_gamestate) {
    $legacy_gamestate = (int)$legacy_gamestate;
    if ($legacy_gamestate >= 20) return 'RUNNING';
    if ($legacy_gamestate >= 10) return 'READY';
    return 'INIT';
}

function obl_game_state_to_legacy_gamestate($state, $fallback = 0) {
    $state = strtoupper((string)$state);
    if ($state === 'RUNNING') return 20;
    if ($state === 'READY' || $state === 'PREPARE' || $state === 'PREPARING') return 10;
    if ($state === 'INIT') return 0;
    if ($state === 'ENDED') return 0;
    return (int)$fallback;
}

function obl_game_generate_run_id() {
    global $groomid, $now;
    $base_time = isset($now) ? (int)$now : time();
    $room = isset($groomid) ? (int)$groomid : 0;
    return 'obl_r' . $room . '_' . $base_time . '_' . str_replace('.', '', uniqid('', true));
}

function obl_game_schema_ensure() {
    global $db;
    static $ensured = array();

    $table = obl_game_table_name();
    if (isset($ensured[$table])) return;

    $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
        `id` tinyint unsigned NOT NULL DEFAULT '1',
        `run_id` varchar(64) NOT NULL DEFAULT '',
        `state` varchar(32) NOT NULL DEFAULT 'INIT',
        `phase` varchar(32) NOT NULL DEFAULT '',
        `tick` int unsigned NOT NULL DEFAULT '0',
        `processed_tick` int unsigned NOT NULL DEFAULT '0',
        `tick_version` int unsigned NOT NULL DEFAULT '0',
        `vars_json` mediumtext NOT NULL,
        `map_seed` varchar(64) NOT NULL DEFAULT '',
        `map_version` int unsigned NOT NULL DEFAULT '1',
        `started_at` int unsigned NOT NULL DEFAULT '0',
        `updated_at` int unsigned NOT NULL DEFAULT '0',
        `ended_at` int unsigned NOT NULL DEFAULT '0',
        `heartbeat_at` int unsigned NOT NULL DEFAULT '0',
        `last_command_at` int unsigned NOT NULL DEFAULT '0',
        `winner_pid` int unsigned NOT NULL DEFAULT '0',
        `winner_name` varchar(64) NOT NULL DEFAULT '',
        `end_reason` varchar(64) NOT NULL DEFAULT '',
        PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

    $db->query($sql);
    $ensured[$table] = true;
}

function obl_game_schema_known($table = '') {
    global $db;
    static $known = array();

    if ($table === '') $table = obl_game_table_name();
    if (isset($known[$table])) return $known[$table];

    $like = addslashes(addcslashes($table, '\\_%'));
    $result = $db->query("SHOW TABLES LIKE '" . $like . "'", 'SILENT');
    $known[$table] = ($result && $db->num_rows($result) > 0);
    return $known[$table];
}

function obl_game_default_row($defaults = array()) {
    global $now, $groomid, $gamestate, $starttime, $winner, $winmode, $gamevars;

    $vars = array();
    if (isset($defaults['vars']) && is_array($defaults['vars'])) {
        $vars = $defaults['vars'];
    } elseif (isset($gamevars) && is_array($gamevars)) {
        $vars = $gamevars;
    }

    $tick = isset($defaults['tick']) ? (int)$defaults['tick'] : (isset($vars['obl_tick']) ? (int)$vars['obl_tick'] : 0);
    $processed_tick = isset($defaults['processed_tick']) ? (int)$defaults['processed_tick'] : (isset($vars['obl_pretick']) ? (int)$vars['obl_pretick'] : 0);
    $legacy_gamestate = isset($defaults['legacy_gamestate']) ? (int)$defaults['legacy_gamestate'] : (isset($gamestate) ? (int)$gamestate : 0);
    $state = isset($defaults['state']) ? (string)$defaults['state'] : obl_game_state_from_legacy_gamestate($legacy_gamestate);
    $current_time = isset($now) ? (int)$now : time();
    $started_at = 0;
    if (isset($defaults['started_at'])) {
        $started_at = (int)$defaults['started_at'];
    } elseif ($state === 'RUNNING' && isset($starttime)) {
        $started_at = (int)$starttime;
    }

    $row = array(
        'id' => 1,
        'run_id' => isset($defaults['run_id']) ? (string)$defaults['run_id'] : obl_game_generate_run_id(),
        'state' => $state,
        'phase' => isset($defaults['phase']) ? (string)$defaults['phase'] : '',
        'tick' => $tick,
        'processed_tick' => $processed_tick,
        'tick_version' => isset($defaults['tick_version']) ? (int)$defaults['tick_version'] : 0,
        'vars_json' => isset($defaults['vars_json']) ? (string)$defaults['vars_json'] : obl_game_encode_vars($vars),
        'map_seed' => isset($defaults['map_seed']) ? (string)$defaults['map_seed'] : '',
        'map_version' => isset($defaults['map_version']) ? (int)$defaults['map_version'] : 1,
        'started_at' => $started_at,
        'updated_at' => isset($defaults['updated_at']) ? (int)$defaults['updated_at'] : $current_time,
        'ended_at' => isset($defaults['ended_at']) ? (int)$defaults['ended_at'] : 0,
        'heartbeat_at' => isset($defaults['heartbeat_at']) ? (int)$defaults['heartbeat_at'] : 0,
        'last_command_at' => isset($defaults['last_command_at']) ? (int)$defaults['last_command_at'] : 0,
        'winner_pid' => isset($defaults['winner_pid']) ? (int)$defaults['winner_pid'] : 0,
        'winner_name' => isset($defaults['winner_name']) ? (string)$defaults['winner_name'] : (isset($winner) ? (string)$winner : ''),
        'end_reason' => isset($defaults['end_reason']) ? (string)$defaults['end_reason'] : (isset($winmode) ? (string)$winmode : ''),
    );

    return $row;
}

function obl_game_load($ensure = true) {
    global $db;
    if ($ensure) obl_game_schema_ensure();

    $table = obl_game_table_name();
    if (!$ensure && !obl_game_schema_known()) {
        return false;
    }
    $result = $db->query("SELECT * FROM `{$table}` WHERE id = 1 LIMIT 1");
    $row = $result ? $db->fetch_array($result) : false;
    if (!$row && $ensure) {
        return obl_game_reset();
    }
    if ($row && !empty($row['__missing_id'])) unset($row['__missing_id']);
    return $row ? $row : false;
}

function obl_game_reset($defaults = array()) {
    global $db;
    obl_game_schema_ensure();

    $table = obl_game_table_name();
    $row = obl_game_default_row($defaults);
    $db->query("DELETE FROM `{$table}` WHERE id = 1");
    $db->array_insert($table, $row);
    $GLOBALS['obl_game'] = $row;
    return $row;
}

function obl_game_save($data) {
    global $db, $now;
    obl_game_schema_ensure();

    $table = obl_game_table_name();
    $current = obl_game_load(false);
    if (!$current) {
        return obl_game_reset($data);
    }
    $missing_id = !empty($current['__missing_id']);
    if ($missing_id) unset($current['__missing_id']);

    if (isset($data['vars']) && is_array($data['vars'])) {
        $data['vars_json'] = obl_game_encode_vars($data['vars']);
        unset($data['vars']);
    }

    $allowed = array(
        'run_id' => true,
        'state' => true,
        'phase' => true,
        'tick' => true,
        'processed_tick' => true,
        'tick_version' => true,
        'vars_json' => true,
        'map_seed' => true,
        'map_version' => true,
        'started_at' => true,
        'updated_at' => true,
        'ended_at' => true,
        'heartbeat_at' => true,
        'last_command_at' => true,
        'winner_pid' => true,
        'winner_name' => true,
        'end_reason' => true,
    );

    $row = array();
    foreach ($data as $key => $value) {
        if (isset($allowed[$key])) $row[$key] = $value;
    }

    $row['updated_at'] = isset($data['updated_at']) ? (int)$data['updated_at'] : (isset($now) ? (int)$now : time());
    if (!isset($row['tick_version'])) {
        $row['tick_version'] = isset($current['tick_version']) ? ((int)$current['tick_version'] + 1) : 1;
    }

    if ($missing_id) {
        $insert_row = array_merge(obl_game_default_row(), $current, $row);
        $insert_row['id'] = 1;
        $db->array_insert($table, $insert_row);
    } else {
        $db->array_update($table, $row, 'id = 1');
    }
    $merged = array_merge($current, $row);
    $merged['id'] = 1;
    $GLOBALS['obl_game'] = $merged;
    return $merged;
}

function obl_game_touch($field, $time = null) {
    global $now;
    $allowed = array('updated_at' => true, 'heartbeat_at' => true, 'last_command_at' => true);
    if (!isset($allowed[$field])) return false;
    $t = ($time !== null) ? (int)$time : (isset($now) ? (int)$now : time());
    $data = array($field => $t, 'updated_at' => $t);
    obl_game_save($data);
    return true;
}

function obl_game_note_command($time = null) {
    return obl_game_touch('last_command_at', $time);
}

function obl_game_note_heartbeat($time = null) {
    return obl_game_touch('heartbeat_at', $time);
}
