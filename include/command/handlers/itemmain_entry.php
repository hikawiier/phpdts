<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 物品菜单入口分发 / Itemmain entry dispatch
// 处理 itemmain → itemcmd 分发（itemmix/elementmix分流 + club20 特殊逻辑）
// ================================================================

function cmd_handle_itemmain_entry($itemcmd, &$mode, &$main) {
    global $log, $club;

    // club20 专属：元素合成/元素背包检查
    if (($club == 20 && $itemcmd == 'itemmix') || ($club != 20 && ($itemcmd == 'elementmix' || $itemcmd == 'elementbag'))) {
        $log .= "你的手突然掐住了你的头左右摇摆！<br><span class='yellow'>\"你还想要干什么，啊？你还想要干什么！！\"</span><br>看来你的手和脑子之间起了一点小摩擦。<br><br>";
        $mode = 'command';
        return;
    }

    if ($itemcmd == 'itemmix' || $itemcmd == 'elementmix') {
        $main = 'itemmix_tips';
    }

    // club20 专属：元素合成上限计算
    if ($club == 20) {
        include_once GAME_ROOT . './include/game/club/elementmix.calc.php';
        $emax = emix_calc_maxenum();
        global $clbstatusa;
        if ($clbstatusa) {
            $log .= "你习惯性摸了摸腰间，但那里已经没有元素口袋了……呼，至少元素们还没有离开你。<br>";
            $main = '';
            $itemcmd = 'command';
        }
    }

    $mode = $itemcmd;
}