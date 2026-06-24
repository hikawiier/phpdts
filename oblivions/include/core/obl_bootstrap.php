<?php
// ================================================================
// Oblivions 子系统统一引导文件
// 集中加载所有函数库，消除散落的条件 include，避免漏写依赖
//
// 加载顺序按拓扑排序：被依赖的文件先加载
// require_once 保证不重复加载
// ================================================================

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 第 0 层：公共函数库（跨业务域通用函数，最先加载）
require_once GAME_ROOT . './oblivions/include/game/obl_global.func.php';

// 第 1 层：独立函数库（依赖第 0 层或无依赖）
require_once GAME_ROOT . './oblivions/include/game/log.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
require_once GAME_ROOT . './oblivions/include/game/sql.func.php';
require_once GAME_ROOT . './oblivions/include/game/player.func.php';
require_once GAME_ROOT . './oblivions/include/game/move.func.php';
require_once GAME_ROOT . './oblivions/include/game/generate.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';
require_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';

// 第 2 层：视野/迷雾/发现系统（依赖 obl_global + player + move + log）
require_once GAME_ROOT . './oblivions/include/game/vision.func.php';

// 第 2.5 层：战斗状态机（独立模块，被 battle.func.php / enemy_ai.func.php / common.inc.php 依赖）
require_once GAME_ROOT . './oblivions/include/game/battle_state_machine.func.php';

// 第 3 层：依赖第 1-2 层
require_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php';

// 第 4 层：依赖第 1-3 层
require_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';

// 第 5 层：探索交互 + 敌人 AI（依赖 vision，无循环依赖）
require_once GAME_ROOT . './oblivions/include/game/explore.func.php';
require_once GAME_ROOT . './oblivions/include/game/enemy_ai.func.php';

// 第 6 层：依赖最广，末尾注册 tick 监听器
require_once GAME_ROOT . './oblivions/include/game/tick.func.php';

// 第 7 层：游戏初始化（依赖全部函数库，仅在 obl_rs_game 调用时执行）
require_once GAME_ROOT . './oblivions/include/gamectl/init.func.php';

// 第 8 层：游戏状态机（依赖 init.func.php，由 common.inc.php 调用）
require_once GAME_ROOT . './oblivions/include/gamectl/state.func.php';
