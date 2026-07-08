<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions Command API Bootstrap
//
// 写入命令入口依赖聚合：Runtime + JSON request + Command response + Command Bus。
// 注意：本文件只做 require_once 聚合，不调用 obl_runtime_boot()。
// ================================================================

require_once GAME_ROOT . './oblivions/include/api/obl_api_bootstrap.php';
require_once GAME_ROOT . './oblivions/include/core/obl_json_request.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';
require_once GAME_ROOT . './oblivions/include/command/obl_command_bus.php';
