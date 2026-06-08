<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 杂项指令处理：choose_fish / memory / menu
// Misc command handlers: choose_fish / memory / menu
// ================================================================

// 鱼篓子物品选择 / Handle choose_fish
function cmd_handle_choose_fish(&$mode, &$pdata) {
    global $clbpara, $log;
    if (isset($clbpara['fish_basket'])) {
        include_once GAME_ROOT . './include/game/item/type/nouveau_booster1.php';
        item_nouveau_booster1($clbpara['fish_basket']['position'], $pdata);
    } else {
        $log .= '出现了错误，请重新使用鱼篓子。<br>';
        $mode = 'command';
    }
}

// 记忆指令 / Handle memory command
// 返回 'chase_action' 表示需要进入追击，否则返回 null
function cmd_handle_memory($command, &$pdata) {
    global $clbpara;

    $smn = substr($command, 6);
    if (!empty($clbpara['smeo']) && isset($clbpara['smeo'][$smn])) {
        $iid = $clbpara['smeo'][$smn][0];
        $itp = $clbpara['smeo'][$smn][1];
        lost_searchmemory($smn, $pdata);

        if ($itp == 'itm') {
            include_once GAME_ROOT . './include/game/search.func.php';
            focus_item($pdata, $iid);
        } else {
            // 返回 chase_action 标记，由 command.php 进入追击流程
            global $action, $bid;
            $action = 'focus';
            $bid = $iid;
            return 'chase_action';
        }
    }
    return null;
}