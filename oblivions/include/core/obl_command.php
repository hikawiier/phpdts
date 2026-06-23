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
$obl_lock_file = GAME_ROOT . './oblivions/cache/locks/obl_lock_' . $groomid . '_' . $pdata['pid'] . '.php';
$obl_lock_dir = dirname($obl_lock_file);
if (!is_dir($obl_lock_dir)) @mkdir($obl_lock_dir, 0755, true);
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

// [C2] 命令过滤：根据 action 状态拒绝非法命令
// 防止前端在 battleMode 下提交 move/explore 等命令，或在 normalMode 下提交战斗命令
$command_rejected = !obl_command_allowed_by_state($command, $pdata['action']);
if ($command_rejected) {
	// 迁移到 obl_error_log：设计文档第 197 行明确要求，前端通过错误 Toast 即时感知
	if (isset($obl_error_log) && $obl_error_log) {
		$obl_error_log->emit('command.rejected', array(
			'command' => $command,
			'action'  => $pdata['action'],
			'reason'  => 'command_not_allowed_in_current_state',
		), 'command');
	}
}

// [C2b] NPC 待结算标志检测：NPC 事件未结算完时，拒绝推进 tick 的命令
// 保证玩家操作与 NPC 先攻轮互斥：玩家行动后必须等 NPC 事件结算完毕才能再次行动
// 非推进 tick 的命令（查看状态等）不受此限制
if (!$command_rejected
    && function_exists('obl_tick_is_pending_npc')
    && obl_tick_is_pending_npc()
    && function_exists('obl_command_advances_tick')
    && obl_command_advances_tick($command)) {
    $command_rejected = true;
    // 迁移到 obl_error_log：NPC 待结算时拒绝命令，前端通过错误 Toast 即时感知
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('command.rejected', array(
            'command' => $command,
            'action'  => $pdata['action'],
            'reason'  => 'npc_action_pending',
        ), 'command');
    }
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

// [E1b] 错误日志持久化（与 obl_log 物理隔离，独立存储）
if (isset($obl_error_log) && $obl_error_log && $obl_error_log->hasEntries()) {
	obl_error_log_persist($obl_error_log, $groomid, $pdata['pid']);
}

// [E2] 战斗日志持久化
// 所有 battlelog（含玩家命令 obl_battle_start/obl_battle_action 和遭遇战）都持久化到文件，
// 前端通过 api_v2.php handle_battle_log 拉取 played=0 的条目播放，
// 播完后调 mark_battle_log_played.php 标记 played=1。
if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries()) {
	obl_battle_log_persist($obl_battle_log, $groomid, $pdata['pid']);
}

// [F-pre] 游戏刻推进准备：处理 escape_skip_tick 标志
// 逃跑成功时设置此标志，跳过本次命令的 tick 推进（一次性）
$escape_skip_tick = !empty($pdata['oblpara']['escape_skip_tick']);
if ($escape_skip_tick) {
    // 清除标志（一次性，仅跳过本次命令的 tick 推进）
    unset($pdata['oblpara']['escape_skip_tick']);
}

// [G] 保存玩家数据（先保存，再推进 tick，保证状态一致）
obl_save_player($pdata);

// [F] 游戏刻推进（白名单机制 + escape_skip_tick 例外 + 命令拒绝例外）
// 顺序说明：先保存玩家数据（含 escape_skip_tick 清除），再推进 tick，
// 避免 tick 已推进但玩家动作未持久化的不一致。
// obl_tick 唯两处增加：玩家先攻轮（此处）/ NPC 先攻轮（obl_tick_dispatch 末尾），互斥。
// 推进后设置 obl_tick_pending_npc 标志，锁定玩家后续操作直到 NPC 事件结算完毕。
if (!$command_rejected && !$escape_skip_tick
    && function_exists('obl_command_advances_tick')
    && obl_command_advances_tick($command)) {
    if (!function_exists('obl_tick_advance')) {
        include_once GAME_ROOT . './oblivions/include/game/tick.func.php';
    }
    obl_tick_advance();             // obl_tick++ + 标记 $ginfochange（只改内存）
    obl_tick_set_pending_npc();     // 设置 NPC 待结算标志，锁定玩家操作
    save_gameinfo();                // 命令路径需显式持久化（无 common 末尾兜底）
}

// [H] 响应（前端通过 api_v2.php 获取数据，本文件返回最小确认）
// battlelog 不再随响应返回：所有 battlelog 持久化到文件，前端统一通过 api_v2.php 拉取 played=0 的条目。
ob_clean();
echo compatible_json_encode(array());
ob_end_flush();
