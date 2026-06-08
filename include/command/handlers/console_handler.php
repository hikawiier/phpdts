<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 控制台指令处理 / Console command handler (consle*)
// ================================================================

function cmd_handle_console($command, &$mode) {
    global $clbpara, $csc, $cwth, $csnm, $cstype;

    if (!isset($clbpara['console'])) {
        $mode = 'command';
        return;
    }

    $cls_cmd = substr($command, 7);
    include_once GAME_ROOT . './include/game/console.func.php';

    if ($cls_cmd == 'wthchange') {
        console_wthchange($cwth);
    } elseif ($cls_cmd == 'dbutton') {
        console_dbutton();
    } elseif ($cls_cmd == 'radar') {
        include_once GAME_ROOT . './include/game/item/item2.func.php';
        newradar(2);
    } elseif ($cls_cmd == 'search') {
        $cls_cmd_kind = substr($csc, 7);
        console_searching($cls_cmd_kind, $csnm, $cstype);
    } elseif (strpos($cls_cmd, 'areactrl') === 0) {
        $cls_cmd_kind = substr($cls_cmd, 8);
        console_areacontrol($cls_cmd_kind);
    }
}