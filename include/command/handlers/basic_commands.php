<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 基础指令处理：移动/探索/物品使用/休息/钓鱼/唱歌
// Basic command handlers: move/search/item use/rest/fishing/song
// ================================================================

// 移动指令 / Move command
function cmd_handle_move($moveto, &$cmdcdtime, &$pdata) {
    global $coldtimeon, $movecoldtime;
    if (oblivions_is_active()) {
        include_once GAME_ROOT . './oblivions/include/game/move.func.php';
        obl_move($moveto,$pdata);
    } else {
        include_once GAME_ROOT . './include/game/search.func.php';
        move($moveto);
    }
    if ($coldtimeon) {
        $cmdcdtime = $movecoldtime;
    }
}

// 探索指令 / Search command
function cmd_handle_search(&$cmdcdtime) {
    global $coldtimeon, $searchcoldtime;
    include_once GAME_ROOT . './include/game/search.func.php';
    search();
    if ($coldtimeon) {
        $cmdcdtime = $searchcoldtime;
    }
}

// 物品使用指令 / Item use command (itm1~itm6)
function cmd_handle_item_use($command, &$cmdcdtime) {
    global $coldtimeon, $itemusecoldtime;
    include_once GAME_ROOT . './include/game/item/item.func.php';
    $item = substr($command, 3);
    itemuse($item);
    if ($coldtimeon) {
        $cmdcdtime = $itemusecoldtime;
    }
}

// 休息指令 / Rest command
function cmd_handle_rest($command, &$mode) {
    global $pls, $hospitals, $state;
    if ($command == 'rest3' && !in_array($pls, $hospitals)) {
        global $log;
        $log .= '<span class="yellow">你所在的位置并非医院，不能静养！</span><br>';
    } else {
        $state = substr($command, 4, 1);
        $mode = 'rest';
    }
}

// 钓鱼指令 / Fishing command
function cmd_handle_fishing(&$mode, &$pdata) {
    include_once GAME_ROOT . './include/game/fishing.func.php';
    start_fishing($pdata);
    if ($mode == 'fishing') {
        // 如果成功开始钓鱼，同时应用休息效果
        include_once GAME_ROOT . './include/gamectl/state.func.php';
        rest('rest', $pdata);
    }
}

// 唱歌指令 / Song command
function cmd_handle_song() {
    global $art;
    $sname = trim(trim($art, '【'), '】');
    include_once GAME_ROOT . './include/game/song.inc.php';
    sing($sname);
}

