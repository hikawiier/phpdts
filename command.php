<?php

define('CURSCRIPT', 'game');

require './include/core/common.inc.php';
require GAME_ROOT.'./include/gamectl/game.func.php';
require GAME_ROOT.'./include/gamectl/player_auth.func.php';

// [A] 玩家认证 / Player authentication
$auth_result = auth_game_player();
if ($auth_result['status'] == 'no_login') {
	gexit($_ERROR['no_login'], __file__, __line__);
} elseif ($auth_result['status'] == 'no_player') {
	header("Location: valid.php");
	exit();
} elseif ($auth_result['status'] == 'wrong_pw') {
	gexit($_ERROR['wrong_pw'], __file__, __line__);
} elseif ($auth_result['status'] == 'gamestate_zero') {
	$gamedata['url'] = 'end.php';
	ob_clean();
	$jgamedata = compatible_json_encode($gamedata);
	echo $jgamedata;
	ob_end_flush();
	exit();
}
$pdata = $auth_result['pdata'];

// [B] 公共初始化 / Common initialization
require GAME_ROOT.'./include/gamectl/init_player.func.php';

// 旧方案：将玩家数据展开为全局变量（仅限入口文件使用）
extract($pdata, EXTR_REFS);

init_playerdata();
$log = init_player_log();
$cmd = $main = '';
$cmdnum = 0;
$gamedata = array();

// [C] 预执行检查 + 路由分发 / Pre-checks + route dispatch
if ($hp > 0) {
	$log .= init_noise_display();
	$rmcdtime = init_cooldown();
	$log .= init_dizzy_check();
	init_club_check();

	// 加载路由系统 / Load routing system
	require GAME_ROOT.'./include/command/router_helpers.php';
	require GAME_ROOT.'./include/command/router.php';

	check_extrabag_overflow();

	// 预检查 / Pre-check: 眩晕/追击/对话框/冷却/物品索引/TP移动
	$pre_check = resolve_pre_checks($command, $action, $mode,
		$coldtimeon, $rmcdtime, $sp_cmd);

	if ($pre_check['skip_cmd']) {
		// 跳过指令：眩晕/冷却/对话框 / Skip: dizzy/cooldown/dialogue
		$mode = $pre_check['mode'];
	} elseif ($pre_check['mode'] === 'chase_action') {
		// 追击标记 → 直接进入战斗 / Chase flag → enter combat
		$command = $pre_check['command'];
		include_once GAME_ROOT.'./include/game/combat/revbattle.func.php';
		if (!isset($message)) $message = '';
		\revbattle\revbattle_prepare($command, $message);
	} else {
		// 正常指令分发 / Normal command dispatch
		$mode = cmd_router_dispatch($command, $mode, $pdata, $cmdcdtime);
	}

	// [D] 后处理 / Post-processing: corpse/cooldown/extrabag
	cmd_router_post_process($action, $gamestate, $bid,
		$coldtimeon, $cmdcdtime, $rmcdtime, $now);
}

// [E] 响应组装 / Response assembly: BGM/dialogue/template/JSON output

// BGM 播放器 / BGM player
$bgm_player = init_bgm();
if (!empty($bgm_player)) {
	$gamedata['innerHTML']['ingamebgm'] = $bgm_player;
}

// 对话框检查 / Dialogue check
$just_made_choice = strpos($command, 'dialogue_choice') === 0;
if (!$just_made_choice && !empty($clbpara['dialogue'])) {
	$opendialog = 'dialogue';
	$dialogue_id = $clbpara['dialogue'];
}

// 指令执行结果 / Command execution result
$gamedata['innerHTML']['notice'] = ob_get_contents();
if (($coldtimeon && $showcoldtimer && $rmcdtime) || isset($dizzy_times)) {
	$gamedata['timer'] = isset($dizzy_times) ? $dizzy_times : $rmcdtime;
}
if ($hp > 0 && $coldtimeon && $showcoldtimer && $rmcdtime) {
	$log .= '行动冷却时间：<span id="timer" class="yellow">0.0</span>秒<br>';
}
player_save($pdata);

// 资料渲染 / Profile rendering
init_profile();
if ($hp <= 0) {
	$dtime = date("Y年m月d日H时i分s秒", $endtime);
	$kname = '';
	if ($bid) {
		$result = $db->query("SELECT name FROM {$tablepre}players WHERE pid='$bid'");
		if ($db->num_rows($result)) {
			$kname = $db->result($result, 0);
		}
	}
	ob_clean();
	include template('death');
	$gamedata['innerHTML']['cmd'] = ob_get_contents();
	$mode = 'death';
} elseif ($cmd) {
	$gamedata['innerHTML']['cmd'] = $cmd;
} elseif ($itms0) {
	ob_clean();
	include template('itemfind');
	$gamedata['innerHTML']['cmd'] = ob_get_contents();
} elseif ($state == 1 || $state == 2 || $state == 3) {
	ob_clean();
	if ($mode == 'fishing') {
		$fishing_count = count($clbpara['fishing']['caught_items']);
		include template('fishing');
	} else {
		include template('rest');
	}
	$gamedata['innerHTML']['cmd'] = ob_get_contents();
} elseif (!$cmd) {
	ob_clean();
	if ($mode && file_exists(GAME_ROOT . TPLDIR . '/' . $mode . '.htm')) {
		include template($mode);
	} else {
		include template('command');
	}
	$gamedata['innerHTML']['cmd'] = ob_get_contents();
} else {
	$log .= '游戏流程故障，请联系管理员<br>';
}

// 悬浮窗口 / Floating dialog trigger
if (isset($opendialog)) {
	$log .= "<span style=\"display:none\" id=\"open-dialog\">{$opendialog}</span>";
}

// 组装 gamedata / Assemble gamedata
if (isset($url)) {
	$gamedata['url'] = $url;
}
$gamedata['innerHTML']['pls'] = (!isset($plsinfo[$pls]) && isset($hplsinfo[$pgroup])) ? $hplsinfo[$pgroup][$pls] : $plsinfo[$pls];
$gamedata['innerHTML']['anum'] = $alivenum;
$gamedata['locationId'] = $pls;

ob_clean();
$main ? include template($main) : include template('profile');
$gamedata['innerHTML']['main'] = ob_get_contents();

$gamedata['innerHTML']['log'] = $log;
$log_dir = GAME_ROOT . './vex/cache/';
if (!is_dir($log_dir)) {
	mkdir($log_dir, 0777, true);
}
writeover($log_dir . 'log_' . $groomid . '_' . $pid . '.php', $log);

if (isset($error)) {
	$gamedata['innerHTML']['error'] = $error;
}
$gamedata['clbpara'] = $clbpara;
$gamedata['value']['teamID'] = $teamID;
if ($teamID) {
	$gamedata['innerHTML']['chattype'] = "<select name=\"chattype\" value=\"2\"><option value=\"0\" selected>$chatinfo[0]<option value=\"1\" >$chatinfo[1]</select>";
} else {
	$gamedata['innerHTML']['chattype'] = "<select name=\"chattype\" value=\"2\"><option value=\"0\" selected>$chatinfo[0]</select>";
}

ob_clean();
$jgamedata = compatible_json_encode($gamedata);
if (isset($_GET['is_new'])) {
	include './api.php';
} else {
	echo $jgamedata;
}
ob_end_flush();

?>