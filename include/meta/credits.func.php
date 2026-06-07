<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 赌局系统依赖 / Gambling system dependency
include_once GAME_ROOT.'./include/meta/gambling.func.php';

// 游戏结束积分结算 / Game end credits settlement
function set_credits(){
	global $db,$gtablepre,$tablepre,$winmode,$gamenum,$winner,$pdata,$gamblingon;
	$clist = $creditlist = $updatelist = Array();
	$result = $db->query("SELECT * FROM {$gtablepre}users RIGHT JOIN {$tablepre}players ON {$tablepre}players.name={$gtablepre}users.username WHERE {$tablepre}players.type='0'");
	while($data = $db->fetch_array($result)){
		$clist[$data['name']] = $data;
	}
	foreach($clist as $key => $val){
		$credits = get_credit_up($val,$winner,$winmode) + $val['credits'];
		$credits2 = $val['credits2'] + 10;
		$validgames = $val['validgames'] + 1;
		$wingames = $key == $winner ? $val['wingames'] + 1 : $val['wingames'];
		$updatelist[$key] = Array(
			'username' => $key,
			'credits' => $credits,
			'credits2' => $credits2,
			'wingames' => $wingames,
			'validgames' => $validgames,
		);
	}
	$db->multi_update("{$gtablepre}users", $updatelist,'username');
	if($gamblingon){// 赌注系统开启 / Gambling system enabled
		$updatelist2 = get_gambling_result($clist,$winner,$winmode);
		if($updatelist2){
			$db->multi_update("{$gtablepre}users", $updatelist2,'username');
		}
	}
	return;
}

// 计算单个玩家积分增减 / Calculate credit change for a single player
function get_credit_up($data,$winner = '',$winmode = 0){
	if($data['name'] == $winner){// 获胜 / Winner
		if($winmode == 2){$up = 200;}// 最后幸存+200 / Last survivor +200
		elseif($winmode == 3){$up = 500;}// 解禁+500 / Unlock +500
		elseif($winmode == 5){$up = 100;}// 核爆+100 / Nuke +100
		elseif($winmode == 7){$up = 10000;}// 幻境解离+10000 / Illusion dissolution +10000
		else{$up = 50;}// 其他胜利方式+50 / Other victory +50
	}
	elseif($data['hp']>0){$up = 25;}// 存活但不是获胜者+25 / Survived but not winner +25
	else{$up = 10;}// 死亡+10 / Death +10
	if($data['killnum']){
		$up += $data['killnum'] * 2;// 杀一玩家/NPC加2 / 2 per kill
	}
	if($data['lvl']){
		$up += round($data['lvl'] /2);// 等级每2级加1 / 1 per 2 levels
	}
	$skill = array ($data['wp'] , $data['wk'] , $data['wg'] , $data['wc'] , $data['wd'] , $data['wf']);
	rsort ( $skill );
	$maxskill = $skill[0];
	$up += round($maxskill / 25);// 熟练度最高的系每25点熟练加1 / 1 per 25 highest proficiency
	$up += round($data['money']/500);// 每500点金钱加1 / 1 per 500 money
	return $up;
}