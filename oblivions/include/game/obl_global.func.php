<?php
/**
 * @module C 核心运行时
 */

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ----------------------------------------------------------------
// Oblivions 公共函数库
// 收纳跨业务域的通用函数（配置读取、通用辅助等）
// 对应旧 PHPDTS 核心的 include/core/global.func.php
// ----------------------------------------------------------------

/**
 * 读取 Oblivions 配置（带静态缓存）
 *
 * 测试覆盖：当 $GLOBALS['obl_test_config_override'] 为数组时，合并覆盖顶层配置键。
 * 仅用于单元测试，生产环境不设置此全局变量。
 *
 * @return array
 */
function obl_get_config() {
    static $cfg = null;
    if ($cfg === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
    }
    if (isset($GLOBALS['obl_test_config_override']) && is_array($GLOBALS['obl_test_config_override'])) {
        return array_merge($cfg, $GLOBALS['obl_test_config_override']);
    }
    return $cfg;
}


