<?php

define('CURSCRIPT', 'game');
require './include/core/common.inc.php';
require GAME_ROOT.'./include/gamectl/game.func.php';


require GAME_ROOT.'./include/gamectl/player_auth.func.php';

if(isset($mode) && $mode == 'quit') {

	gsetcookie('user','');
	gsetcookie('pass','');
	header("Location: index.php");
	exit();

}

// 玩家认证 / Player authentication
$auth_result = auth_game_player();
if ($auth_result['status'] == 'no_login') {
	gexit($_ERROR['no_login'], __file__, __line__);
} elseif ($auth_result['status'] == 'no_player') {
	header("Location: valid.php" . '?' . $_SERVER['QUERY_STRING']);
	exit();
} elseif ($auth_result['status'] == 'wrong_pw') {
	gexit($_ERROR['wrong_pw'], __file__, __line__);
} elseif ($auth_result['status'] == 'gamestate_zero') {
	header("Location: end.php");
	exit();
}
$pdata = $auth_result['pdata'];

require GAME_ROOT.'./include/gamectl/init_player.func.php';

// 旧方案：将玩家数据展开为全局变量（仅限入口文件使用）
extract($pdata, EXTR_REFS);

// 缓存当前房间的 RuleSet ID，避免重复查询
$ruleset_id = '';
if (!empty($groomid)) {
	$result = $db->query("SELECT gruleset FROM {$gtablepre}game WHERE groomid = ".intval($groomid));
	if ($db->num_rows($result)) {
		$room_data = $db->fetch_array($result);
		$ruleset_id = $room_data['gruleset'];
	}
}

// 公共初始化
init_playerdata();
$log = init_player_log();

// 存活状态检查
if ($hp > 0) {
	$log .= init_noise_display();
	$rmcdtime = init_cooldown();
	$log .= init_dizzy_check();
	init_club_check();
}

//读取聊天信息
$chatdata = getchat(0, isset($teamID) ? $teamID : '');
//读取表情信息
$emdata = get_emdata();

//var_dump($itm3);
if($hp <= 0){
	$dtime = date("Y年m月d日H时i分s秒",$endtime);
	$kname='';
	if($bid) {
		$result = $db->query("SELECT name FROM {$tablepre}players WHERE pid='".intval($bid)."'");
		if($db->num_rows($result)) { $kname = $db->result($result,0); }
	}

	// 检查是否需要显示RuleSet结束剧情
	if(!empty($ruleset_id) && empty($clbpara['ruleset_ending_shown'])) {
			include_once GAME_ROOT.'./gamedata/ruleset/story_config.php';
			$story = get_ruleset_story($ruleset_id, 'ending');
			if ($story) {
					// 标记结束剧情已显示
					$clbpara['ruleset_ending_shown'] = true;
					player_save($pdata);

					// 设置结束剧情显示
					$opendialog = 'ruleset_ending';
					$dialogue_id = 'ruleset_ending';

					// 动态添加RuleSet结束剧情到对话系统
					global $dialogues, $dialogue_log;
					$dialogues['ruleset_ending'] = array(
						0 => $story['content']
					);
					$dialogue_log['ruleset_ending'] = "<span class='red'>※ 时光重现结束</span><br>{$story['title']}<br><br>";
			}
		}

	$mode = 'death';
} elseif($state ==1 || $state == 2 || $state == 3){
	$mode = 'rest';
} elseif($itms0){
	$mode = 'itemmain';
} else {
	$mode = 'command';
}
$command = 'enter';
$cmd = $main = '';
if(($action == 'corpse' || $action == 'pacorpse') && $gamestate < 40){
	$cid = $bid;
	if($cid){
		$result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='".intval($cid)."' AND hp=0");
		if($db->num_rows($result)>0){
			$edata = $db->fetch_array($result);
			include_once GAME_ROOT.'./include/game/encounter.func.php';
			findcorpse($edata);
			extract($edata,EXTR_PREFIX_ALL,'w');
			init_battle_rev($pdata,$edata,1);
			$main = 'battle_rev';
		}
	}
}
elseif($action == 'chase' || $action == 'pchase' || $action == 'dfight'){
	$enemyid = $bid;
	$result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='".intval($enemyid)."' AND hp>0 AND pls='$pls'");
	if($db->num_rows($result)>0){
		$edata = $db->fetch_array($result);
		include_once GAME_ROOT.'./include/game/combat/revbattle.func.php';
		\revbattle\findenemy_rev($edata);
		$main = 'battle_rev';
	}
}
elseif($action == 'neut'){
	$nid = $bid;
	if($nid){
		$result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='".intval($nid)."' AND hp>0");
		if($db->num_rows($result)>0){
			$edata = $db->fetch_array($result);
			include_once GAME_ROOT.'./include/game/combat/revbattle.func.php';
			\revbattle\findneut($edata,1);
			extract($edata,EXTR_PREFIX_ALL,'w');
			init_battle_rev($pdata,$edata,1);
			$main = 'battle_rev';
		}
	}
}
if($hp > 0 && $coldtimeon && $showcoldtimer && $rmcdtime){$log .= "行动冷却时间：<span id=\"timer\" class=\"yellow\">0.0</span>秒<script type=\"text/javascript\">demiSecTimerStarter($rmcdtime);</script><br>";}
// 检查是否有对话需要显示，但如果刚刚处理了对话选择，则不显示
// 通过检查 $_POST['command'] 是否包含 'dialogue_choice' 来判断
$just_made_choice = isset($_POST['command']) && strpos($_POST['command'], 'dialogue_choice') === 0;

// 检查是否有RuleSet开场剧情需要显示
if(!$just_made_choice && !empty($clbpara['ruleset_opening_story']) && empty($clbpara['ruleset_story_shown']))
{
	// 标记剧情已显示，避免重复显示
	$clbpara['ruleset_story_shown'] = true;
	player_save($pdata);

	// 显示RuleSet剧情
	$opendialog = 'ruleset_opening';
	$dialogue_id = 'ruleset_opening';

	// 动态添加RuleSet剧情到对话系统
	include_once GAME_ROOT.'./gamedata/ruleset/story_config.php';
	if (!empty($ruleset_id)) {
		$story = get_ruleset_story($ruleset_id, 'opening');
		if ($story) {
			// 将RuleSet剧情内容注入到对话系统
			global $dialogues, $dialogue_log;
			$dialogues['ruleset_opening'] = array(
				0 => $story['content']
			);
			$dialogue_log['ruleset_opening'] = "<span class='lime'>※ 时光重现开始！</span><br>欢迎来到{$story['title']}的世界。<br><br>";
		}
	}
}
elseif(!$just_made_choice && (!empty($clbpara['dialogue']) || !empty($clbpara['noskip_dialogue'])))
{
	$opendialog = $clbpara['noskip_dialogue'];
	if(!empty($clbpara['dialogue'])) $dialogue_id = $clbpara['dialogue'];
}
if(isset($opendialog))
{
	$log.="<script>
	var dialogElement = document.getElementById('{$opendialog}');
	if(dialogElement && dialogElement.showModal) {
		dialogElement.showModal();
	}
	</script>";
}

// VEX 前端 API 代理 / VEX frontend API proxy
if (isset($_GET['vex_api']) && $_GET['vex_api'] == '1') {
	include './api_v2.php';
	exit;
}

//if (!strstr($_SERVER['HTTP_REFERER'], 'php') && $_SERVER['HTTP_REFERER'] != '') {
init_profile();
if (isset($_GET['is_new'])) {
	include './api.php';
} else {
	include template('game');
}

?>
