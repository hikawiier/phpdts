<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 玩家认证函数 / Player authentication function
// 检查登录状态、获取玩家数据、验证密码、检查游戏状态
// 返回数组：['status' => 'ok'|'no_login'|'no_player'|'wrong_pw'|'gamestate_zero', 'pdata' => $pdata]
function auth_game_player() {
    global $cuser, $cpass, $db, $tablepre, $gtablepre, $gamestate;

    if (!$cuser || !$cpass) {
        return array('status' => 'no_login');
    }

    $pdata = fetch_playerdata_by_name($cuser);
    if (!$pdata) {
        return array('status' => 'no_player');
    }

    if ($pdata['pass'] != $cpass) {
        $tr = $db->query("SELECT `password` FROM {$gtablepre}users WHERE username='$cuser'");
        $tp = $db->fetch_array($tr);
        $password = $tp['password'];
        if ($password == $cpass) {
            $db->query("UPDATE {$tablepre}players SET pass='$password' WHERE name='$cuser'");
        } else {
            return array('status' => 'wrong_pw');
        }
    }

    if ($gamestate == 0) {
        return array('status' => 'gamestate_zero', 'pdata' => $pdata);
    }

    return array('status' => 'ok', 'pdata' => $pdata);
}