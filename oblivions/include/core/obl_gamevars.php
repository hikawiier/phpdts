<?php
/**
 * @module C 核心运行时
 * @framework C-7 旧版游戏变量兼容镜像
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

require_once GAME_ROOT . './oblivions/include/core/obl_game_repository.php';

// ================================================================
// Oblivions gamevars 兼容镜像层
//
// 当前职责：让 {$tablepre}oblgame 成为 Oblivions tick/gamevars
// 的 source of truth，同时继续向旧流程暴露 $gamevars['obl_tick'] /
// $gamevars['obl_pretick'] 兼容镜像。
// ================================================================

function obl_gamevars_normalize($vars) {
    return is_array($vars) ? $vars : array();
}

function obl_gamevars_from_row($row) {
    $vars = array();
    if (is_array($row) && isset($row['vars_json'])) {
        $vars = obl_game_json_decode($row['vars_json']);
    }
    $vars['obl_tick'] = (is_array($row) && isset($row['tick'])) ? (int)$row['tick'] : 0;
    $vars['obl_pretick'] = (is_array($row) && isset($row['processed_tick'])) ? (int)$row['processed_tick'] : 0;
    return $vars;
}

function obl_gamevars_sync_to_globals($create_from_legacy = true, $sync_lifecycle = false) {
    global $gamevars, $gamestate, $winner;

    $legacy_vars = obl_gamevars_normalize(isset($gamevars) ? $gamevars : array());
    if ($create_from_legacy) {
        obl_game_schema_ensure();
    }
    $row = obl_game_load(false);

    if (!$row && $create_from_legacy) {
        $row = obl_game_reset(array(
            'vars' => $legacy_vars,
            'tick' => isset($legacy_vars['obl_tick']) ? (int)$legacy_vars['obl_tick'] : 0,
            'processed_tick' => isset($legacy_vars['obl_pretick']) ? (int)$legacy_vars['obl_pretick'] : 0,
            'legacy_gamestate' => isset($gamestate) ? (int)$gamestate : 0,
        ));
    } elseif (!$row && !$create_from_legacy) {
        // 未拿到房间锁时不能写库；临时使用旧 game.gamevars 作为只读兼容镜像，
        // 并标记缺失，等待后续持锁请求补建 {$tablepre}oblgame 行。
        $row = obl_game_default_row(array(
            'vars' => $legacy_vars,
            'tick' => isset($legacy_vars['obl_tick']) ? (int)$legacy_vars['obl_tick'] : 0,
            'processed_tick' => isset($legacy_vars['obl_pretick']) ? (int)$legacy_vars['obl_pretick'] : 0,
            'legacy_gamestate' => isset($gamestate) ? (int)$gamestate : 0,
        ));
        $row['__missing_id'] = 1;
    }

    if (!$row) return false;

    $gamevars = obl_gamevars_from_row($row);

    // 旧 {$gtablepre}game 当前仍是房间生命周期 / gamestate 的权威来源。
    // 这里只同步 tick/gamevars；不能用旧局残留的 oblgame.state 覆盖 $gamestate，
    // 否则重开局时 gamestate 可能被 stale RUNNING 行改回 20，导致 obl_rs_game() 不执行。
    if ($sync_lifecycle) {
        $gamestate = obl_game_state_to_legacy_gamestate(isset($row['state']) ? $row['state'] : '', isset($gamestate) ? $gamestate : 0);
        if (isset($row['winner_name']) && $row['winner_name'] !== '') {
            $winner = $row['winner_name'];
        }
    }

    $GLOBALS['obl_game'] = $row;
    return $row;
}

function obl_gamevars_sync_from_globals($extra = array()) {
    global $gamevars, $gamestate, $winner, $winmode, $starttime;

    $vars = obl_gamevars_normalize(isset($gamevars) ? $gamevars : array());
    $state = obl_game_state_from_legacy_gamestate(isset($gamestate) ? (int)$gamestate : 0);

    $data = array(
        'state' => $state,
        'tick' => isset($vars['obl_tick']) ? (int)$vars['obl_tick'] : 0,
        'processed_tick' => isset($vars['obl_pretick']) ? (int)$vars['obl_pretick'] : 0,
        'vars' => $vars,
        'winner_name' => isset($winner) ? (string)$winner : '',
        'end_reason' => isset($winmode) ? (string)$winmode : '',
    );

    if (isset($GLOBALS['obl_last_command_at'])) {
        $data['last_command_at'] = (int)$GLOBALS['obl_last_command_at'];
    }

    if ($state === 'RUNNING' && isset($starttime)) {
        $current = obl_game_load(false);
        if (!$current || empty($current['started_at'])) {
            $data['started_at'] = (int)$starttime;
        }
    }

    if (is_array($extra)) {
        foreach ($extra as $key => $value) {
            $data[$key] = $value;
        }
    }

    $saved = obl_game_save($data);
    if (isset($GLOBALS['obl_last_command_at'])) unset($GLOBALS['obl_last_command_at']);
    return $saved;
}
