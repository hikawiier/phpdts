<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 队伍指令处理 / Team command handler
// ================================================================

function cmd_handle_team() {
    global $teamcmd;
    include_once GAME_ROOT . './include/game/team.func.php';
    if ($teamcmd == 'teamquit') {
        teamquit();
    } else {
        teamcheck();
    }
}