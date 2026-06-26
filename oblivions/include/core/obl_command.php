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

// obl_bootstrap.php 已由 command.php 在 require 本文件之前加载
// player.func.php / tick.func.php 等所有函数库均已可用

// $obl_log 已在 common.inc.php 中初始化（核心机制，放全局入口）
// 此处无需重复初始化

// [A0] 兜底关闭函数：PHP 崩溃时仍输出 JSON 错误
// 注册在 [H] 输出之前，只在真正发生 fatal error 时触发
register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        ob_clean();
        echo compatible_json_encode(array(
            'error' => 'PHP_FATAL',
            'message' => $error['message'] . ' in ' . $error['file'] . ':' . $error['line'],
        ));
        ob_end_flush();
    }
});

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

// [C2b] NPC 待结算检测：NPC 事件未结算完时，拒绝推进 tick 的命令
// 由战斗状态机管辖，查询是否有战场在 NPC_ACTING 状态
// 非推进 tick 的命令（查看状态等）不受此限制
if (!$command_rejected
    && obl_tick_is_pending_npc()
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

// [D] 路由分发（使用 Oblivions 独立路由，不再依赖旧模式 include/command/router.php）
if (!$command_rejected && $pdata['hp'] > 0) {
	require GAME_ROOT.'./oblivions/include/command/oblivions_router.php';

	$post = gstrfilter($_POST);
	$mode = oblivions_cmd_dispatch($command, $pdata, $post);
}

// [C2d] 战斗状态机：命令执行完成后，从 WAITING_PLAYER 过渡到 PLAYER_DONE
// 玩家动作已被 battle_main + battle_manage_queue 完整处理后才更新状态，
// 避免原 [C2c] 在命令提交瞬间就设 PLAYER_ACTING 导致中间态卡死。
if (!$command_rejected
    && function_exists('obl_command_advances_tick')
    && obl_command_advances_tick($command)) {
    $player_qid = (int)$pdata['bid'];
    if ($player_qid > 0
        && function_exists('obl_battle_state_get')
        && obl_battle_state_get($player_qid) === OBL_BS_WAITING_PLAYER) {
        obl_battle_state_transition($player_qid, 'player_action_complete');
    }
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
// 注意：状态机重构后，逃跑成功会触发 battle_end 事件销毁状态记录，
//       tick 推进时 obl_tick_phase_battle_npc 不会找到已销毁的战场，故此标志不再必需。
//       保留读取逻辑以兼容未来可能的设置点。
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
// tick.func.php 已由 obl_bootstrap.php 加载，无需条件 include
if (!$command_rejected && !$escape_skip_tick
    && obl_command_advances_tick($command)) {
    obl_tick_advance();             // obl_tick++ + 标记 $ginfochange（只改内存）

    // [F-bs] 战斗状态机：感知 tick 推进
    // 状态转换：PLAYER_DONE → NPC_ACTING
    // 仅当玩家在战场中且当前状态为 PLAYER_DONE 时触发
    $player_qid = (int)$pdata['bid'];
    if ($player_qid > 0
        && function_exists('obl_battle_state_get')
        && obl_battle_state_get($player_qid) === OBL_BS_PLAYER_DONE) {
        obl_battle_state_transition($player_qid, 'tick_advanced');
    }

    save_gameinfo();                // 命令路径需显式持久化（无 common 末尾兜底）
}

// [H] 响应（前端通过 api_v2.php 获取数据，本文件返回最小确认）
// battlelog 不再随响应返回：所有 battlelog 持久化到文件，前端统一通过 api_v2.php 拉取 played=0 的条目。
ob_clean();
echo compatible_json_encode(array());
ob_end_flush();
