<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 指令路由器：统一分发入口 / Command Router: unified dispatch entry
// 替换 command.php 原有 $mode 分发树（原 96-839 行）
// ================================================================

// 主分发函数 / Main dispatch function
// 返回最终 mode；若内部触发追击则返回 'revcombat'
//
// 参数说明：
//   $post = gstrfilter($_POST)，包含所有过滤后的 POST 参数。
//   子函数需要 POST 数据时从 $post 取值，不要 global 声明 POST 变量。
function cmd_router_dispatch($command, $mode, &$pdata, &$cmdcdtime, $post) {
    global $club, $clbpara, $log, $pls, $plsinfo, $hospitals;
    global $itemcmd, $sp_cmd, $main, $state;

    // menu 指令：重置到指令面板 / Menu: reset to command panel
    if ($command == 'menu') {
        return 'command';
    }

    // ---- mode == 'command' 分支 / command mode branch ----
    if ($mode == 'command') {
        // Oblivions 探索/搜索/拾取/丢弃（优先处理，独立于 itm0 阻塞检查）
        if (oblivions_is_active()) {
            if ($command == 'obl_explore') {
                include_once GAME_ROOT . './include/command/handlers/oblivions_commands.php';
                cmd_handle_obl_explore($pdata);
                return 'command';
            }
            if ($command == 'obl_search') {
                include_once GAME_ROOT . './include/command/handlers/oblivions_commands.php';
                cmd_handle_obl_search(isset($post['iaid']) ? $post['iaid'] : 0, $pdata);
                return 'command';
            }
            if ($command == 'obl_pickup') {
                include_once GAME_ROOT . './include/command/handlers/oblivions_commands.php';
                cmd_handle_obl_pickup(isset($post['iid']) ? $post['iid'] : 0, $pdata);
                return 'command';
            }
            if ($command == 'obl_discard') {
                include_once GAME_ROOT . './include/command/handlers/oblivions_commands.php';
                cmd_handle_obl_discard(isset($post['slot']) ? $post['slot'] : 0, $pdata);
                return 'command';
            }
        }

        // 手持道具阻塞检查 / Handheld item blocking check
        global $itms0;
        if (!empty($itms0) && !in_array($command, array('itemget', 'itm0', 'dropitm0', 'split_itm'))) {
            $log .= "你的双手都已经抓满了东西。为了完成所想，你集中意念召唤幻肢……<br>什么都没有发生，除了你的脑壳痛了起来。<br><br>";
            return 'command';
        }

        // 移动 / Move
        if ($command == 'move') {
            global $moveto;
            include_once GAME_ROOT . './include/command/handlers/basic_commands.php';
            cmd_handle_move($moveto, $cmdcdtime, $pdata);
            return 'command';
        }

        // 探索 / Search
        if ($command == 'search') {
            include_once GAME_ROOT . './include/command/handlers/basic_commands.php';
            cmd_handle_search($cmdcdtime, $pdata);
            return 'command';
        }

        // 物品使用 / Item use
        if (strpos($command, 'itm') === 0) {
            include_once GAME_ROOT . './include/command/handlers/basic_commands.php';
            cmd_handle_item_use($command, $cmdcdtime);
            return 'command';
        }

        // 休息 / Rest
        if (strpos($command, 'rest') === 0) {
            include_once GAME_ROOT . './include/command/handlers/basic_commands.php';
            cmd_handle_rest($command, $mode);
            return $mode;
        }

        // 钓鱼 / Fishing
        if ($command == 'fishing') {
            include_once GAME_ROOT . './include/command/handlers/basic_commands.php';
            cmd_handle_fishing($mode, $pdata);
            return $mode;
        }

        // 物品菜单入口 / Item main entry
        if ($command == 'itemmain') {
            include_once GAME_ROOT . './include/command/handlers/itemmain_entry.php';
            cmd_handle_itemmain_entry($itemcmd, $mode, $main);
            return $mode;
        }

        // 唱歌 / Song
        if ($command == 'song') {
            include_once GAME_ROOT . './include/command/handlers/basic_commands.php';
            cmd_handle_song();
            return 'command';
        }

        // 特殊技能 / Special skills
        if ($command == 'special') {
            include_once GAME_ROOT . './include/command/handlers/special_dispatch.php';
            cmd_handle_special_dispatch($sp_cmd, $mode, $cmdcdtime, $pdata, $post);
            return $mode;
        }

        // 队伍 / Team
        if ($command == 'team') {
            include_once GAME_ROOT . './include/command/handlers/team_handler.php';
            cmd_handle_team();
            return 'command';
        }

        // 控制台 / Console
        if (strpos($command, 'consle') === 0) {
            include_once GAME_ROOT . './include/command/handlers/console_handler.php';
            cmd_handle_console($command, $mode);
            return 'command';
        }

        // 对话选择 / Dialogue choice
        if (strpos($command, 'dialogue_choice') === 0) {
            include_once GAME_ROOT . './include/command/handlers/dialogue_handler.php';
            cmd_handle_dialogue_choice($command, $mode);
            return $mode;
        }

        // 结束对话 / End dialogue
        if (strpos($command, 'end_dialogue') === 0) {
            include_once GAME_ROOT . './include/command/handlers/dialogue_handler.php';
            cmd_handle_end_dialogue();
            return 'command';
        }

        // 选鱼 / Choose fish
        if ($command == 'choose_fish') {
            include_once GAME_ROOT . './include/command/handlers/misc_commands.php';
            cmd_handle_choose_fish($mode, $pdata);
            return $mode;
        }

        // 记忆 / Memory
        if (strpos($command, 'memory') === 0) {
            include_once GAME_ROOT . './include/command/handlers/misc_commands.php';
            $memory_result = cmd_handle_memory($command, $pdata);
            if ($memory_result === 'chase_action') {
                // 焦点敌人 → 进入追击 / Focus enemy → enter chase
                global $action;
                $command = 'focus';
                $mode = 'revcombat';
                include_once GAME_ROOT . './include/game/combat/revbattle.func.php';
                \revbattle\revbattle_prepare($command, '');
                return $mode;
            }
            return 'command';
        }

        return 'command';
    }

    // ---- $mode == 'item' 分支 ----
    if ($mode == 'item') {
        include_once GAME_ROOT . './include/game/item/item2.func.php';
        global $usemode;
        $item = substr($command, 3);
        use_func_item($usemode, $item);
        return $mode;
    }

    // ---- $mode == 'itemmain' 分支 ----
    if ($mode == 'itemmain') {
        return _dispatch_itemmain_mode($command, $mode);
    }

    // ---- $mode == 'quest' 分支 ----
    if ($mode == 'quest') {
        include_once GAME_ROOT . './include/game/quest.func.php';
        global $questselect;
        if ($command == 'quest_accept') {
            $qid = isset($questselect) ? $questselect : '';
            $accepted = quest_accept_offer($qid, $pdata);
            return $accepted ? 'command' : 'quest';
        } elseif ($command == 'quest_reject') {
            quest_reject_offer($pdata, true);
            return 'command';
        } elseif ($command == 'quest_cancel') {
            quest_reject_offer($pdata, false);
            return 'command';
        } else {
            if (empty($clbpara['quest']['pending'])) return 'command';
            return $mode;
        }
    }

    // ---- $mode == 'special' 分支 ----
    if ($mode == 'special') {
        return _dispatch_special_mode($command, $pdata);
    }

    // ---- $mode == 'senditem' 分支 ----
    if ($mode == 'senditem') {
        include_once GAME_ROOT . './include/game/encounter.func.php';
        senditem();
        return $mode;
    }

    // ---- $mode == 'revcombat' 分支（chase_flag 标签） ----
    if ($mode == 'revcombat') {
        include_once GAME_ROOT . './include/game/combat/revbattle.func.php';
        global $message;
        if (!isset($message)) $message = '';
        \revbattle\revbattle_prepare($command, $message);
        return $mode;
    }

    // ---- $mode == 'rest' 分支 ----
    if ($mode == 'rest') {
        include_once GAME_ROOT . './include/gamectl/state.func.php';
        if ($command == 'fishing') {
            include_once GAME_ROOT . './include/game/fishing.func.php';
            start_fishing($pdata);
        } else {
            rest($command);
        }
        return $mode;
    }

    // ---- $mode == 'fishing' 分支 ----
    if ($mode == 'fishing') {
        include_once GAME_ROOT . './include/game/fishing.func.php';
        fishing_command($command, $pdata);
        include_once GAME_ROOT . './include/gamectl/state.func.php';
        rest($command, $pdata);
        return $mode;
    }

    // ---- $mode == 'corpse' 分支 ----
    if ($mode == 'corpse') {
        global $bid;
        if ($command == 'fireseed_recruit' && $club == 22) {
            include_once GAME_ROOT . './include/game/club/club22.func.php';
            global $db, $tablepre;
            $result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='$bid' AND hp=0");
            if ($db->num_rows($result) > 0) {
                $npc = $db->fetch_array($result);
                FireseedRecruit($npc);
            }
            return 'command';
        } else {
            include_once GAME_ROOT . './include/game/item/itemmain.func.php';
            getcorpse($command);
            return $mode;
        }
    }

    // ---- $mode == 'team' 分支 ----
    if ($mode == 'team') {
        include_once GAME_ROOT . './include/game/team.func.php';
        global $nteamID, $nteamPass, $ticon;
        if ($command == "teammake") teammake($nteamID, $nteamPass, (int)$ticon);
        if ($command == "teamjoin") teamjoin($nteamID, $nteamPass);
        if ($command == "teamquit") teamquit($nteamID, $nteamPass);
        return $mode;
    }

    // ---- $mode == 'shop' 分支 ----
    if ($mode == 'shop') {
        global $shops, $shoptype, $buynum;
        if (in_array($pls, $shops) || !check_skill_unlock('c11_ebuy', $pdata)) {
            if ($command == 'shop') {
                return 'sp_shop';
            } else {
                include_once GAME_ROOT . './include/game/item/itemmain.func.php';
                itembuy($command, $shoptype, $buynum);
                return $mode;
            }
        } else {
            $log .= '<span class="yellow">你所在的地区没有商店。</span><br />';
            return 'command';
        }
    }

    // ---- $mode == 'depot' 分支 ----
    if ($mode == 'depot') {
        include_once GAME_ROOT . './include/game/depot.func.php';
        global $depots, $name, $type;
        if (in_array($pls, $depots)) {
            $saveitem_list = depot_getlist($name, $type);
            switch ($command) {
                case 'sp_depot_save': return 'sp_depot_save';
                case 'sp_depot_load': return 'sp_depot_load';
                default:
                    if (strpos($command, 'saveitem') === 0) {
                        $iid = substr($command, 9);
                        depot_save($iid);
                    } elseif (strpos($command, 'loaditem') === 0) {
                        $lid = substr($command, 9);
                        depot_load($lid);
                    } else {
                        return 'sp_depot';
                    }
                    return $mode;
            }
        } else {
            $log .= '<span class="yellow">你所在的地区没有安全箱。</span><br />';
            return 'command';
        }
    }

    // ---- $mode == 'deathnote' 分支 ----
    if ($mode == 'deathnote') {
        global $dnname, $dndeath, $dngender, $dnicon, $name, $item;
        if ($dnname) {
            include_once GAME_ROOT . './include/game/item/item2.func.php';
            deathnote($name, $item, $dnname, $dndeath, $dngender, $dnicon);
        } else {
            $log .= '嗯，暂时还不想杀人。<br>你合上了■DeathNote■。<br>';
            return 'command';
        }
        return $mode;
    }

    // ---- $mode == 'oneonone' 分支 ----
    if ($mode == 'oneonone') {
        global $dnname, $name;
        if ($dnname) {
            include_once GAME_ROOT . './include/game/special.func.php';
            oneonone($dnname, $name);
        } else {
            $log .= '约战取消。<br>';
            return 'command';
        }
        return $mode;
    }

    // ---- $mode == 'sp_skpts' 分支 ----
    if ($mode == 'sp_skpts') {
        $log .= "不存在该指令！<br>";
        return 'command';
    }

    // ---- $mode == 'revskpts' 分支 ----
    if ($mode == 'revskpts') {
        return _dispatch_revskpts_mode($command, $pdata, $post);
    }

    // ---- $mode == 'sp_pbomb' 分支 ----
    if ($mode == 'sp_pbomb') {
        include_once GAME_ROOT . './include/game/special.func.php';
        if ($command == "YES") press_bomb();
        return 'command';
    }

    // ---- else: command_end_flag ----
    return 'command';
}

// ================================================================
// 内部辅助函数 / Internal helper functions
// ================================================================

// itemmain 模式分发 / itemmain mode dispatch
// TODO: 后续可改为接收 $post 参数并消除下方 global 的 POST 变量（mitm1~6 等）
function _dispatch_itemmain_mode($command, $mode) {
    global $log, $club, $arbs, $arbe, $arbsk;
    global $merge1, $merge2, $from, $to, $mixmask, $itemselect, $mitm1, $mitm2, $mitm3, $mitm4, $mitm5, $mitm6;
    global $change_emax, $emixitmemax, $emixitmer, $emixlist, $emixnums;

    include_once GAME_ROOT . './include/game/item/itemmain.func.php';

    if ($command == 'itemget') {
        itemget();
    } elseif ($command == 'itemadd') {
        itemadd();
    } elseif ($command == 'itemmerge') {
        if ($merge2 == 'n') { itemadd(); } else { itemmerge($merge1, $merge2); }
    } elseif ($command == 'itemmove') {
        itemmove($from, $to);
    } elseif (strpos($command, 'split_itm') === 0) {
        $split_item = substr($command, 9);
        include_once GAME_ROOT . './include/game/club/elementmix.func.php';
        split_item_to_elements($split_item);
    } elseif (strpos($command, 'drop') === 0) {
        $drop_item = substr($command, 4);
        itemdrop($drop_item);
    } elseif (strpos($command, 'off') === 0) {
        $off_item = substr($command, 3);
        itemoff($off_item);
    } elseif (strpos($command, 'swap') === 0) {
        $swap_item = substr($command, 4);
        itemdrop($swap_item);
        itemadd();
    } elseif ($command == 'itemmix') {
        if (isset($itemselect) && $itemselect == 999) {
            return 'command';
        } else {
            $mixlist = array();
            if (!isset($mixmask)) {
                for ($i = 1; $i <= 6; $i++) {
                    if (isset(${'mitm' . $i}) && ${'mitm' . $i} == $i) {
                        $mixlist[] = $i;
                    }
                }
            } else {
                for ($i = 1; $i <= 6; $i++) {
                    if ($mixmask & (1 << ($i - 1))) {
                        $mixlist[] = $i;
                    }
                }
            }
            include_once GAME_ROOT . './include/game/item/itemmix.func.php';
            if (isset($itemselect)) {
                itemmix_rev($mixlist, $itemselect);
            } else {
                itemmix_rev($mixlist);
            }
        }
    } elseif ($command == 'elementmix') {
        include_once GAME_ROOT . './include/game/club/elementmix.func.php';
        $itmemax = $change_emax ? (int)$emixitmemax : 100;
        $itmer = $change_emr ? (int)$emixitmer : 55;
        elements_mix_prepare($emixlist, $emixnums, $itmemax, $itmer);
        return 'command';
    } elseif ($command == 'itemencase') {
        if (strpos($arbsk, '^') !== false && $arbs && $arbe) {
            $ilist = array();
            for ($i = 1; $i <= 6; $i++) {
                if (isset(${'mitm' . $i}) && ${'mitm' . $i} == $i) {
                    $ilist[] = $i;
                }
            }
            item_encase($ilist);
        } else {
            $log .= "<span class='red'>你身上没有背包，或是没有将背包装备上！<br>";
        }
    } elseif ($command == 'iteminfo') {
        if (strpos($arbsk, '^') !== false && $arbs && $arbe) {
            item_info();
        } else {
            $log .= "<span class='red'>你身上没有背包，或是没有将背包装备上！<br>";
        }
    } elseif (strpos($command, 'usebagitm') !== false) {
        if (strpos($arbsk, '^') !== false && $arbs && $arbe) {
            $itemid = substr($command, 10);
            item_out($itemid);
        } else {
            $log .= "<span class='red'>你身上没有背包，或是没有将背包装备上！<br>";
        }
    } elseif (strpos($command, 'changewep') !== false) {
        include_once GAME_ROOT . './include/game/item/itemmain.func.php';
        change_subwep();
        return 'command';
    }
    return $mode;
}

// special 模式分发（pose/tac/hor/inf/chkp/shop/clubsel）
function _dispatch_special_mode($command, &$pdata) {
    global $log, $club, $pls, $pose, $tactic, $horizon;
    global $poseinfo, $tacinfo, $horizoninfo;
    global $apose, $atac;

    include_once GAME_ROOT . './include/game/special.func.php';

    if (strpos($command, 'pose') === 0) {
        $cpose = substr($command, 4, 1);
        if (in_array($cpose, $apose)) {
            $pose = $cpose;
            $log .= "基础姿态变为<span class=\"yellow\">$poseinfo[$pose]</span>。<br> ";
            return 'command';
        } else {
            $log .= "<span class=\"yellow\">这个姿势太奇怪了！</span><br> ";
            return 'command';
        }
    } elseif (strpos($command, 'tac') === 0) {
        $ctac = substr($command, 3, 1);
        if (in_array($ctac, $atac)) {
            $tactic = $ctac;
            $log .= "应战策略变为<span class=\"yellow\">$tacinfo[$tactic]</span>。<br> ";
            return 'command';
        } else {
            $log .= "<span class=\"yellow\">这种策略太奇怪了！</span><br> ";
            return 'command';
        }
    } elseif (strpos($command, 'hor') === 0) {
        $chor = substr($command, 3, 1);
        if (isset($horizoninfo[$chor])) {
            $horizon = $chor;
            $log .= "视界切换为<span class=\"yellow\">$horizoninfo[$chor]</span>。<br> ";
            lost_searchmemory('all', $pdata);
            $log .= "<span id='HsUipfcGhU'></span>";
        } else {
            $log .= "<span class=\"yellow\">这种想法太奇怪了！</span><br> ";
        }
        return 'command';
    } elseif (strpos($command, 'inf') === 0) {
        $infpos = substr($command, 3, 1);
        chginf($infpos);
        return 'command';
    } elseif (strpos($command, 'chkp') === 0) {
        $itmn = substr($command, 4, 1);
        chkpoison($itmn);
        return 'command';
    } elseif (strpos($command, 'shop') === 0) {
        $shop = substr($command, 4, 2);
        shoplist($shop);
        return 'command';
    } elseif (strpos($command, 'clubsel') === 0) {
        $clubchosen = (int)str_replace('clubsel', '', $command);
        include_once GAME_ROOT . './include/pregame/clubslct.func.php';
        $retval = selectclub($clubchosen);
        if ($retval == 0) $log .= "称号选择成功。<br>";
        elseif ($retval == 1) $log .= "称号选择失败，称号一旦被选择便无法更改。<br>";
        elseif ($retval == 2) $log .= "未选择称号。<br>";
        else $log .= "称号选择非法！<br>";
        return 'command';
    }
    return 'command';
}

// revskpts 模式分发（技能升级/切换/激活）
//
// 参数：
//   $command - 前端发来的指令名，如 swtskill_c10_inspire / actskill_c11_merc
//   &$pdata  - 玩家数据引用
//   $post    - 过滤后的 POST 数组，从中读取动态参数（*upgpara, *mkey 等）
//             由 command.php 入口统一构造，无需再次 gstrfilter()
function _dispatch_revskpts_mode($command, &$pdata, $post) {
    global $log, $cskills;

    $sk = substr($command, 9);
    if (!isset($cskills[$sk])) return 'command';

    if (strpos($command, 'upgskill_') !== false) {
        if (isset($cskills[$sk]['num_input'])) {
            $nums = isset($post[$command . '_nums']) ? (int)$post[$command . '_nums'] : 1;
            upgclbskills($sk, $nums);
        } else {
            upgclbskills($sk);
        }
    } elseif (strpos($command, 'swtskill_') !== false) {
        $upgpara = isset($post[$sk . 'upgpara']) ? $post[$sk . 'upgpara'] : null;
        if (isset($upgpara) && isset($cskills[$sk]['choice']) && in_array($upgpara, $cskills[$sk]['choice'])) {
            switchclbskills($sk, $upgpara);
        }
    } elseif (strpos($command, 'actskill_') !== false) {
        include_once GAME_ROOT . './include/game/club/revclubskills_extra.func.php';
        if ($sk == 'c4_roar' || $sk == 'c4_sniper') {
            skill_c4_unlock($sk);
        } elseif ($sk == 'c11_merc') {
            $mkey   = isset($post[$sk . 'mkey']) ? $post[$sk . 'mkey'] : null;
            $fire   = isset($post[$sk . 'fire']) ? $post[$sk . 'fire'] : null;
            $chase  = isset($post[$sk . 'chase']) ? $post[$sk . 'chase'] : null;
            $moveto = isset($mkey) ? (isset($post[$sk . $mkey . 'moveto']) ? $post[$sk . $mkey . 'moveto'] : null) : null;
            if (isset($mkey) && isset($fire) && $fire == $mkey) {
                skill_merc_fire($sk, $mkey);
            } elseif (isset($mkey) && isset($chase)) {
                skill_merc_chase($sk, $mkey);
            } elseif (isset($mkey) && isset($moveto)) {
                skill_merc_move($sk, $mkey, $moveto);
            }
        }
    }
    return 'command';
}