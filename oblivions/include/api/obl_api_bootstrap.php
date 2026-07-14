<?php
/**
 * @module A API 层
 * @framework A-2 最小依赖引导链
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions API Shared Bootstrap
//
// 仅聚合所有 Oblivions API 入口共用的基础运行期依赖。
// 注意：本文件不调用 obl_runtime_boot()，不执行业务逻辑，不产生写入副作用。
// ================================================================

require_once GAME_ROOT . './oblivions/include/core/obl_runtime.php';
