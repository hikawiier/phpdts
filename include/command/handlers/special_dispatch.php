<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 特殊技能分发 / Special skill dispatch
// 处理 command=special → sp_cmd 的14个 elseif 分支
//
// $post = gstrfilter($_POST)，POST 参数统一入口。
// 子分支需要 POST 参数（如 choice）时从此数组取值。
// ================================================================
function cmd_handle_special_dispatch($sp_cmd, &$mode, &$cmdcdtime, &$pdata, $post) {
    global $log, $club, $coldtimeon, $weaponswapcoldtime;

    // sp_word: 获取词语 / Get word
    if ($sp_cmd == 'sp_word') {
        include_once GAME_ROOT . './include/game/special.func.php';
        getword();
        $mode = $sp_cmd;
        return;
    }

    // sp_adtsk: 管理任务 / Manage tasks
    if ($sp_cmd == 'sp_adtsk') {
        include_once GAME_ROOT . './include/game/special.func.php';
        adtsk();
        $mode = 'command';
        return;
    }

    // sp_trapadtsk: 陷阱改造（club 7/8） / Trap modification
    if ($sp_cmd == 'sp_trapadtsk') {
        $position = 0;
        if ($club == 7) {
            foreach (array(1, 2, 3, 4, 5, 6) as $imn) {
                if (strpos($pdata['itmk' . $imn], 'B') === 0 && $pdata['itme' . $imn] > 0) {
                    $position = $imn;
                    break;
                }
            }
            if (!$position) {
                $log .= '<span class="red">你没有电池，无法改造陷阱！</span><br />';
                $mode = 'command';
                return;
            }
        } elseif ($club == 8) {
            foreach (array(1, 2, 3, 4, 5, 6) as $imn) {
                if ($pdata['itm' . $imn] == '毒药' && $pdata['itmk' . $imn] == 'Y' && $pdata['itme' . $imn] > 0) {
                    $position = $imn;
                    break;
                }
            }
            if (!$position) {
                $log .= '<span class="red">你没有毒药，无法改造陷阱！</span><br />';
                $mode = 'command';
                return;
            }
        } else {
            $log .= '<span class="red">你不懂得如何改造陷阱！</span><br />';
            $mode = 'command';
            return;
        }
        if ($position) {
            $position = 0;
            foreach (array(1, 2, 3, 4, 5, 6) as $imn) {
                if (strpos($pdata['itmk' . $imn], 'T') === 0 && $pdata['itme' . $imn] > 0) {
                    $position = $imn;
                    break;
                }
            }
            if (!$position) {
                $log .= '<span class="red">你的背包中没有陷阱，无法改造！</span><br />';
                $mode = 'command';
            } else {
                $mode = 'sp_trapadtsk';
            }
        }
        return;
    }

    // sp_trapadtskselected: 陷阱改造执行 / Trap modification execute
    if ($sp_cmd == 'sp_trapadtskselected') {
        $choice = isset($post['choice']) ? $post['choice'] : null;
        if (!isset($choice) || $choice == 'menu') {
            $mode = 'command';
        } else {
            $choice = (int)$choice;
            if ($choice < 1 || $choice > 6) {
                $log .= '<span class="red">无此物品。</span><br />';
            } else {
                include_once GAME_ROOT . './include/game/special.func.php';
                trap_adtsk($choice);
            }
            $mode = 'command';
        }
        return;
    }

    // Club 21 相关: 码语行人 / Cipher Walker
    $club21_cmds = array('sp_extract_trait', 'sp_extract_trait_selected',
        'sp_add_trait', 'sp_add_trait_selected',
        'sp_consume_trait', 'sp_consume_trait_selected');
    if (in_array($sp_cmd, $club21_cmds)) {
        include_once GAME_ROOT . './include/game/club/club21.func.php';
        club21_cmd_entry($sp_cmd, $mode);
        return;
    }

    // Club 22 相关: 枫火歌者 / Fireseed Singer
    $club22_cmds = array('sp_fireseed_deploy', 'sp_fireseed_getitem',
        'sp_fireseed_enhance', 'sp_save_fireseed_select');
    if (in_array($sp_cmd, $club22_cmds)) {
        include_once GAME_ROOT . './include/game/club/club22.func.php';
        club22_cmd_entry($sp_cmd, $mode);
        return;
    }

    // sp_pickpocket_selected: 妙手 / Pickpocket
    if ($sp_cmd == 'sp_pickpocket_selected') {
        $choice = isset($post['choice']) ? $post['choice'] : null;
        if (!isset($choice)) {
            $mode = 'command';
        } else {
            $choice = (int)($choice);
            include_once GAME_ROOT . './include/game/club/revclubskills_extra.func.php';
            skill_tl_pickpocket_act($choice);
        }
        $mode = 'command';
        return;
    }

    // sp_weapon: 换武器 / Weapon swap
    if ($sp_cmd == 'sp_weapon') {
        include_once GAME_ROOT . './include/game/special.func.php';
        weaponswap();
        $mode = 'command';
        if ($coldtimeon) {
            $cmdcdtime = $weaponswapcoldtime;
        }
        return;
    }

    // sp_pbomb: 炸弹 / Bomb
    if ($sp_cmd == 'sp_pbomb') {
        $mode = 'sp_pbomb';
        return;
    }

    // oneonone: 约战 / Duel request
    if ($sp_cmd == 'oneonone') {
        $mode = 'oneonone';
        return;
    }

    // fallback: 其余 sp_cmd 直接作为 mode / Other sp_cmd used as mode
    $mode = $sp_cmd;
}