<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 指令路由辅助函数 / Command Router Helper Functions
// ================================================================

// 检查额外背包是否超限 / Check extrabag overflow
function check_extrabag_overflow() {
    global $arbsk, $arbs, $arbe, $extrabag_max;
    if (strpos($arbsk, '^') !== false && $arbs && $arbe) {
        $extrabag_max = $arbe >= $arbs ? $arbs : $arbe;
        include_once GAME_ROOT . './include/game/extrabag.func.php';
        extrabag_over_limit();
    }
}

// 预检查：眩晕/追击/对话框/冷却/物品索引/TP移动
// 返回预检查结果数组，决定是否跳过指令分发
// Pre-check: dizzy/chase/dialogue/cooldown/itemindex/tpmove
// Returns pre-check result dictating whether to skip command dispatch
function resolve_pre_checks($command, $action, $mode, $coldtimeon, $rmcdtime, $sp_cmd) {
    global $clbpara, $log, $opendialog, $dialogue_id, $itemindex, $itemcmd, $bid;

    // 眩晕状态：跳过指令执行 / Dizzy: skip command execution
    if (!empty($clbpara['skill']) && in_array('inf_dizzy', $clbpara['skill'])) {
        return array(
            'skip_cmd' => true,
            'mode' => 'command'
        );
    }

    // 追击标记：直接进入追击判定 / Chase flag: enter chase judgment
    if (!empty($action) && in_array($action, array('chase', 'pchase', 'dfight', 'cover')) && $mode !== 'revcombat') {
        return array(
            'skip_cmd' => false,
            'mode' => 'chase_action',
            'command' => $action
        );
    }

    // 无法跳过的对话框 / Unskippable dialogue
    if (!empty($clbpara['noskip_dialogue']) && strpos($command, 'end_dialogue') === false) {
        $opendialog = $clbpara['noskip_dialogue'];
        if (!empty($clbpara['dialogue'])) {
            $dialogue_id = $clbpara['dialogue'];
        }
        return array(
            'skip_cmd' => true,
            'mode' => $mode
        );
    }

    // 冷却时间检查 / Cooldown check
    if ($coldtimeon && $rmcdtime > 0 && (
        strpos($command, 'move') === 0 ||
        strpos($command, 'search') === 0 ||
        (strpos($command, 'itm') === 0 && $command != 'itemget') ||
        strpos($sp_cmd, 'sp_weapon') === 0 ||
        strpos($command, 'song') === 0
    )) {
        $log .= '<span class="yellow">冷却时间尚未结束！</span><br>';
        return array(
            'skip_cmd' => true,
            'mode' => 'command'
        );
    }

    // 物品合成索引 → 自动打开合成提示 / Item index → auto-open mix tips
    if (!empty($itemindex)) {
        $opendialog = 'itemmix_tips';
        $mode = 'command';
        $command = 'itemmain';
        $itemcmd = 'itemmix';
    }

    // TP移动处理 / Teleport move handling
    if (!empty($action)) {
        if ($action == 'tpmove') {
            $mode = 'command';
            $command = 'search';
        }
        if ($action != 'chase' && $action != 'dfight' && $mode !== 'combat' &&
            $mode !== 'revcombat' && $mode !== 'corpse' && $action != 'pacorpse' &&
            $mode !== 'senditem') {
            $action = '';
            $bid = 0;
        }
    }

    // 正常路径：进入指令分发 / Normal path: proceed to dispatch
    return array(
        'skip_cmd' => false,
        'mode' => $mode,
        'command' => $command,
        'action' => $action,
        'itemcmd' => $itemcmd
    );
}

// 指令执行后处理：尸体/冷却/背包 / Post-execution processing: corpse/cooldown/extrabag
// 通过 global 访问 $cdsec/$cdmsec/$cdtime/$endtime（均为 EXTR_REFS 引用，直接修改即更新 $pdata）
function cmd_router_post_process($action, $gamestate, $bid, $coldtimeon, &$cmdcdtime, &$rmcdtime, $now) {
    global $db, $tablepre, $pls, $pid, $arbsk, $arbs, $arbe;
    global $cdsec, $cdmsec, $cdtime, $endtime, $cmdnum;

    // pacorpse 尸体发现 / pacorpse corpse discovery
    if ($action == 'pacorpse' && $gamestate < 40) {
        $cid = $bid;
        if ($cid) {
            $result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='$cid' AND hp=0");
            if ($db->num_rows($result) > 0) {
                $edata = $db->fetch_array($result);
                include_once GAME_ROOT . './include/game/encounter.func.php';
                findcorpse($edata);
            }
        }
    }

    // 更新冷却时间 / Update cooldown
    if ($coldtimeon && isset($cmdcdtime)) {
        $nowmtime = floor(getmicrotime() * 1000);
        $cdsec = floor($nowmtime / 1000);
        $cdmsec = fmod($nowmtime, 1000);
        $cdtime = $cmdcdtime;
        $rmcdtime = $cmdcdtime;
    }

    // 读取背包内道具 / Read extrabag items
    if (strpos($arbsk, '^') !== false && $arbs && $arbe) {
        include_once GAME_ROOT . './include/game/extrabag.func.php';
        $itemlist = item_arr();
    }
    $endtime = $now;
    $cmdnum++;
}