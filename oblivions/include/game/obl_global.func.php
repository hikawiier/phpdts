<?php

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
 * @return array
 */
function obl_get_config() {
    static $cfg = null;
    if ($cfg === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
    }
    return $cfg;
}


