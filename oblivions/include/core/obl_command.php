<?php
/**
 * Oblivions 模式命令入口
 *
 * 由 command.php 在 Oblivions 模式下 require，处理全部 Oblivions 命令流程：
 * 认证 → 路由分发 → 日志持久化 → tick 推进 → 保存 → 响应
 *
 * 设计原则：
 * - 不使用 extract，直接操作 $pdata
 * - 跳过传统预检查/模板渲染（SPA 前端不需要）
 * - 前端通过 api_v2.php 获取业务数据，本文件只返回最小确认
 */

// 载入 Oblivions 玩家函数库（认证 + 数据抓取 + 保存 + 道具栏辅助）
require GAME_ROOT.'./oblivions/include/game/player.func.php';

// $obl_log 已在 common.inc.php 中初始化（核心机制，放全局入口）
// 此处无需重复初始化

// [A] 玩家认证 + 数据抓取
$pdata = obl_game_entrypoint('command');

// [A2] 并发锁：同一玩家同时只能处理一个命令（防止多标签页/脚本攻击并发）
// 使用 flock 非阻塞模式，获取失败直接返回错误；进程结束 OS 自动释放锁
$obl_lock_file = GAME_ROOT . './vex/cache/obl_lock_' . $groomid . '_' . $pdata['pid'] . '.php';
$obl_lock_fp = fopen($obl_lock_file, 'w');
if (!$obl_lock_fp || !flock($obl_lock_fp, LOCK_EX | LOCK_NB)) {
    // 另一个请求正在处理
    ob_clean();
    echo compatible_json_encode(array('error' => 'COMMAND_IN_PROGRESS'));
    ob_end_flush();
    exit;
}

// [B] 公共初始化（不使用 extract，不调用 init_playerdata()）
// obl_* 命令处理器仅依赖 $pdata 参数 + $obl_log，不依赖 extracted 全局变量
$cmd = $main = '';
$cmdnum = 0;
$gamedata = array();

// $command/$mode 来自 common.inc.php 的 POST extract（POST 参数）
if (!isset($mode)) $mode = '';
if (!isset($command)) $command = '';
$cmdcdtime = 0;

// [C] battle 状态防呆校验（路由分发前，确保玩家操作不被脏状态卡住）
//obl_validate_battle_state($pdata);

// [C2] 命令过滤：根据 action 状态拒绝非法命令
// 防止前端在 battleMode 下提交 move/explore 等命令，或在 normalMode 下提交战斗命令
$command_rejected = !obl_command_allowed_by_state($command, $pdata['action']);
if ($command_rejected) {
	$obl_log->emit('command.rejected', 'system', array(
		'command' => $command,
		'action'  => $pdata['action'],
		'reason'  => 'command_not_allowed_in_current_state',
	));
}

// [D] 路由分发（跳过传统预检查：眩晕/冷却/对话框/追击/物品索引）
if (!$command_rejected && $pdata['hp'] > 0) {
	require GAME_ROOT.'./include/command/router_helpers.php';
	require GAME_ROOT.'./include/command/router.php';

	$post = gstrfilter($_POST);
	$mode = cmd_router_dispatch($command, $mode, $pdata, $cmdcdtime, $post);
}

// [E] 日志持久化（结构化日志替代 $log HTML 字符串）
if ($obl_log && $obl_log->hasEntries()) {
	obl_log_persist($obl_log, $groomid, $pdata['pid']);
}

// [E2] 战斗日志持久化
// 所有 battlelog（含玩家命令 obl_battle_start/obl_battle_action 和遭遇战）都持久化到文件，
// 前端通过 api_v2.php handle_battle_log 拉取 played=0 的条目播放，
// 播完后调 mark_battle_log_played.php 标记 played=1。
if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries()) {
	obl_battle_log_persist($obl_battle_log, $groomid, $pdata['pid']);
}

// [F] 游戏刻推进（白名单机制：只有白名单内的命令才推进 tick）
// 例外 1：逃跑成功时设置 escape_skip_tick 标志，跳过本次 tick 推进
// 例外 2：被 [C2] 拒绝的命令不推进 tick
$escape_skip_tick = isset($pdata['oblpara']['escape_skip_tick']) && $pdata['oblpara']['escape_skip_tick'];
if ($escape_skip_tick) {
    // 清除标志（一次性，仅跳过本次命令的 tick 推进）
    unset($pdata['oblpara']['escape_skip_tick']);
}
if (!$command_rejected && !$escape_skip_tick && function_exists('obl_command_advances_tick') && obl_command_advances_tick($command)) {
	if (!isset($gamevars['obl_tick'])) $gamevars['obl_tick'] = 0;
	$tickdebug_file = GAME_ROOT . './oblivions/tickdebug_from_oblcommand.php';
	$tickdebug_content = "当前tick：".$gamevars['obl_tick'];
	writeover($tickdebug_file, $tickdebug_content);
	$gamevars['obl_tick']++;
	save_gameinfo();  // 持久化 gamevars（common.inc.php 不会自动保存）
}

// [G] 保存到 oblplayers（替代 player_save）
obl_save_player($pdata);

// [H] 响应（前端通过 api_v2.php 获取数据，本文件返回最小确认）
// battlelog 不再随响应返回：所有 battlelog 持久化到文件，前端统一通过 api_v2.php 拉取 played=0 的条目。
ob_clean();
echo compatible_json_encode(array());
ob_end_flush();
