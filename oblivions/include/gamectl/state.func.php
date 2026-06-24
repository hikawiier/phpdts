<?php

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 游戏状态机 / Oblivions game state machine
//
// 完全与旧模式解耦：Oblivions 模式下 common.inc.php 直接调用
// obl_gamestate_* 系列函数，不再走 gamestate.func.php 的旧状态机。
//
// Oblivions 只需要 2 个状态转换：
//   - prepare：游戏准备（0 → 10），调用 obl_rs_game 完成初始化
//   - start：游戏开始（10 → 20），发布新闻 + 系统聊天
//
// 不需要的状态转换（旧模式专属）：
//   - add_area：禁区系统（Oblivions 有自己的地图系统）
//   - stop_valid：停止激活（单人模式不需要）
//   - combo：连斗机制（单人模式不需要）
//   - anti_afk：反挂机（依赖 state >= 40，Oblivions 不会进入）
//   - gameover：游戏不自动结束，仅 GM 中止或玩家退出可终止
// ================================================================
// 依赖：init.func.php（obl_rs_game）
//       system.func.php（addnews / systemputchat，由 common.inc.php 加载）

/**
 * Oblivions 游戏准备状态转换 / Oblivions game prepare state transition
 *
 * state 0 → 10：到达准备时间时，调用 obl_rs_game 完成全部初始化。
 * 替代旧模式的 gamestate_try_prepare + rs_game(63)。
 *
 * @return bool 状态变更返回 true，需要 save_gameinfo
 */
function obl_gamestate_try_prepare() {
    global $gamestate, $starttime, $now, $startmin;
    global $gamenum, $hdamage, $hplayer, $noisemode;

    if (!$gamestate) {
        if (($starttime) && ($now > $starttime - $startmin * 60)) {
            $gamenum++;
            $gamestate = 10;
            $hdamage = 0;
            $hplayer = '';
            $noisemode = '';

            // 调用 Oblivions 专属初始化流程（建表+tick变量+地图+敌人+日志清理）
            if (!function_exists('obl_rs_game')) {
                require_once GAME_ROOT . './oblivions/include/gamectl/init.func.php';
            }
            obl_rs_game();

            return true;
        }
    }
    return false;
}

/**
 * Oblivions 游戏开始状态转换 / Oblivions game start state transition
 *
 * state 10 → 20：到达开始时间时，发布新闻 + 系统聊天。
 * 替代旧模式的 gamestate_try_start，但不部署 bot（Oblivions 是单人模式）。
 *
 * @return bool 状态变更返回 true，需要 save_gameinfo
 */
function obl_gamestate_try_start() {
    global $gamestate, $starttime, $now;
    global $groomid, $gamenum;

    if ($gamestate == 10) {
        if ($now >= $starttime) {
            $gamestate = 20;

            // Oblivions 都是单人房间，统一用 newroomgame 新闻
            if (!empty($groomid)) {
                addnews($starttime, 'newroomgame', $gamenum, $groomid);
            } else {
                // 防御性 fallback：理论上 Oblivions 必有 groomid
                addnews($starttime, 'newgame', $gamenum);
            }

            systemputchat($starttime, 'newgame');
            return true;
        }
    }
    return false;
}
