<?php
/**
 * @module A API 层
 * @framework A-2 最小依赖引导链
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions State API Bootstrap
//
// 纯读状态入口依赖聚合：Runtime + State response + Tick status + State handlers。
// 注意：本文件只做 require_once 聚合，不调用 obl_runtime_boot()，不加载 Command Bus。
// ================================================================

require_once GAME_ROOT . './oblivions/include/api/obl_api_bootstrap.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_response.php';
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_handlers.php';
