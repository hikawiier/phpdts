<?php

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 反挂机系统 / Anti-AFK system
include_once GAME_ROOT.'./include/gamectl/antiafk.func.php';

/**
 * 游戏状态机 — 各状态转换检查函数
 * Game state machine — state transition check functions
 * 
 * 每个函数返回 true 表示状态已变更，需要保存 gameinfo
 * Each function returns true if state changed, requiring save_gameinfo()
 */

// 判定游戏准备 / Check game prepare
function gamestate_try_prepare() {
    global $gamestate, $starttime, $now, $startmin;
    global $gamenum, $hdamage, $hplayer, $noisemode;

    if (!$gamestate) {
        if (($starttime) && ($now > $starttime - $startmin * 60)) {
            $gamenum++;
            $gamestate = 10;
            $hdamage = 0;
            $hplayer = '';
            $noisemode = '';
            rs_game(63 + (oblivions_is_active() ? 64 : 0));
            return true;
        }
    }
    return false;
}

// 判定游戏开始 / Check game start
function gamestate_try_start() {
    global $gamestate, $starttime, $now;
    global $groomid, $gamenum, $gamevars, $rsgame_bots;

    if ($gamestate == 10) {
        if ($now >= $starttime) {
            $gamestate = 20;

            // 小房间开始游戏 / Small room game start
            if (!empty($groomid)) {
                addnews($starttime, 'newroomgame', $gamenum, $groomid);
            }
            // 大房间开始游戏 / Main room game start
            else {
                addnews($starttime, 'newgame', $gamenum);
                // 是否部署BOT -> 数量; 只有大房间会部署bot
                $gamevars['botplayer'] = $rsgame_bots;
            }

            systemputchat($starttime, 'newgame');
            return true;
        }
    }
    return false;
}

// 判定增加禁区 & 禁区警告 / Check add area & area warning
function gamestate_try_add_area() {
    global $gamestate, $now, $areatime, $areahour;
    global $areawarn, $areawarntime;

    // OBLIVIONS 模式：无禁区系统，直接跳过
    if (oblivions_is_active()) {
        return false;
    }

    // 防御：areatime=0 表示房间尚未初始化，跳过禁区增加
    if (($gamestate > 10) && ($areatime > 0) && ($now > $areatime)) {
        while ($now > $areatime) {
            $o_areatime = $areatime;
            $areatime += $areahour * 60;
            add_once_area($o_areatime);
            $areawarn = 0;
        }
        return true;
    } elseif (($gamestate > 10) && ($now > $areatime - $areawarntime) && (!$areawarn)) {
        areawarn();
        return true;
    }
    return false;
}

// 判定游戏停止激活 / Check game stop validation
function gamestate_try_stop_valid() {
    global $gamestate, $arealimit, $validnum, $areanum, $areaadd, $validlimit, $areatime;

    // OBLIVIONS 模式：跳过停止激活，单人模式不需要此逻辑
    if (oblivions_is_active()) {
        return false;
    }

    if ($gamestate == 20) {
        $arealimit = $arealimit > 0 ? $arealimit : 1;
        if (($validnum <= 0) && ($areanum >= $arealimit * $areaadd)) {
            // 判定无人参加并结束游戏 / No participants, end game
            gameover($areatime - 3599, 'end4');
            return false;
        } elseif (($areanum >= $arealimit * $areaadd) || ($validnum >= $validlimit)) {
            // 判定游戏停止激活 / Stop activation
            $gamestate = 30;
            return true;
        }
    }
    return false;
}

// 判定进入连斗 / Check combo mode
function gamestate_try_combo() {
    global $gamestate, $now, $alivenum, $combolimit;
    global $combonum, $deathnum, $deathlimit, $validnum, $deathdeno, $deathnume;

    // OBLIVIONS 模式：单人模式不需要连斗机制
    if (oblivions_is_active()) {
        return false;
    }

    // 条件1：停止激活时玩家数少于特定值 / Condition 1: players below threshold during stop
    if ($gamestate < 40 && $gamestate > 20 && $alivenum <= $combolimit) {
        $gamestate = 40;
        addnews($now, 'combo');
        systemputchat($now, 'combo');
        return true;
    }
    // 条件2：死亡人数超过特定公式计算出的值 / Condition 2: deaths exceed formula threshold
    elseif ($gamestate < 40 && $gamestate >= 20 && $combonum && $deathnum >= $combonum) {
        $real_combonum = $deathlimit + ceil($validnum / $deathdeno) * $deathnume;
        if ($deathnum >= $real_combonum) {
            $gamestate = 40;
            addnews($now, 'combo');
            systemputchat($now, 'combo');
        } else {
            $combonum = $real_combonum;
            addnews($now, 'comboupdate', $combonum, $deathnum);
            systemputchat($now, 'comboupdate', $combonum);
        }
        return true;
    }
    return false;
}

// 判定自动反挂机 / Check anti-AFK
function gamestate_try_anti_afk() {
    global $gamestate, $now, $afktime, $antiAFKertime;

    if (($gamestate >= 40) && ($now > $afktime + $antiAFKertime * 60)) {
        antiAFK();
        $afktime = $now;
        return true;
    }
    return false;
}

// 判定游戏结束 / Check game over
function gamestate_try_gameover() {
    global $gamestate, $db, $tablepre, $alivenum;

    // OBLIVIONS 模式：游戏不自动结束，死亡/人数不足均不触发 gameover
    // 仅 GM 中止或玩家退出房间可终止游戏
    if (oblivions_is_active()) {
        return false;
    }

    if ($gamestate >= 40) {
        $result = $db->query("SELECT pid FROM {$tablepre}players WHERE hp>0 AND type=0");
        $alivenum = $db->num_rows($result);
        save_gameinfo();
        if ($alivenum <= 1) {
            gameover();
            return true;
        }
    }
    return false;
}