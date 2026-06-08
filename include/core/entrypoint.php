<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 游戏入口公共骨架 / Common game entrypoint skeleton
// Phase 2: 消除 game.php 与 command.php 的认证逻辑重复
//
// 设计说明 / Design notes:
// - entrypoint 函数仅处理认证（含密码升级），返回 $pdata
// - extract($pdata, EXTR_REFS) + init_playerdata() 保留在入口文件中
//   因为 init 系列函数通过 global 关键字访问玩家变量，必须在全局作用域执行

// 处理认证失败的分支响应 / Handle auth failure branches
// game.php: redirect; command.php: JSON response
function _entrypoint_handle_auth_failure($status, $entry_type) {
    switch ($status) {
        case 'no_login':
            gexit($_ERROR['no_login'], __file__, __line__);
        case 'no_player':
            $qs = ($entry_type === 'game') ? ('?' . $_SERVER['QUERY_STRING']) : '';
            header("Location: valid.php" . $qs);
            exit();
        case 'wrong_pw':
            gexit($_ERROR['wrong_pw'], __file__, __line__);
        case 'gamestate_zero':
            if ($entry_type === 'command') {
                // command.php 返回 JSON 响应 / JSON response for AJAX
                $gdata = array('url' => 'end.php');
                ob_clean();
                echo compatible_json_encode($gdata);
                ob_end_flush();
            } else {
                // game.php 直接跳转 / Redirect for page load
                header("Location: end.php");
            }
            exit();
    }
}

// 游戏入口认证函数 / Game entrypoint authentication function
// 执行玩家认证，成功后返回 $pdata；失败时直接 gexit/redirect
// $entry_type: 'game'（game.php 页面加载）或 'command'（command.php AJAX 指令）
// 返回: $pdata 数组
function game_entrypoint($entry_type = 'game') {

    // [A] 玩家认证 / Player authentication
    $auth_result = auth_game_player();
    if ($auth_result['status'] !== 'ok') {
        _entrypoint_handle_auth_failure($auth_result['status'], $entry_type);
        // unreachable
    }

    return $auth_result['pdata'];
}