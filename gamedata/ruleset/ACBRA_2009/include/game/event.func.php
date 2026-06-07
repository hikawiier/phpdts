<?php
if(!defined('IN_GAME')) {
	exit('Access Denied');
}

function event(){
	global $mode,$log,$hp,$sp,$inf,$pls,$rage;

	$dice1 = rand(0,5);
	$dice2 = rand(5,10);
	
	if($pls == 0) { //分校
	} elseif($pls == 1) { //北海岸
		$log .= "一个好大的海浪突然打过来！<BR>";
		if($dice1 <= 3){
			$dice2 += 10;
			if($sp <= $dice2){
				$dice2 = $sp-1;
			}
			$sp-=$dice2;
			$log .= "被卷到了海中，好不容易爬了上来！<BR>体力减少 <font color=\"red\"><b>{$dice2}</b></font>  点。<BR>";
		}else{
			$log .= "呼...幸好没被卷进去...<BR>";
		}
	} elseif($pls == 2) { //北村住宅区
		$log = ($log . "突然，天空出现一大群乌鸦！<BR>");
		if($dice1 == 2){
			$log = ($log . "被乌鸦袭击，头部受了伤！<BR>");
			$inf = str_replace('h','',$inf);
			$inf = ($inf . 'h');
		}elseif($dice1 == 3){
			$log = ($log . "被乌鸦袭击，受到<font color=\"red\"><b>{$dice2}</b></font> 点伤害！<BR>");
			$hp-=$dice2;
		}else{
			$log = ($log . "呼，总算击退了。<BR>");
		}
	} elseif($pls == 3) { //北村公所
	} elseif($pls == 4) { //邮电局
	} elseif($pls == 5) { //消防署
	} elseif($pls == 6) { //观音堂
	} elseif($pls == 7) { //清水池
		$log = ($log . "糟糕，脚下滑了一下！<BR>");
		if($dice1 <= 3){
			$dice2 += 10;
			if($sp <= $dice2){
				$dice2 = $sp-1;
			}
			$sp-=$dice2;
			$log = ($log . "掉下池中了，不过，已努力爬了上来！<BR>体力减少 <font color=\"red\"><b>{$dice2}</b></font> 点。<BR>");
		}else{
			$log = ($log . "呼...幸好没掉下水池...<BR>");
		}
	} elseif($pls == 8) { //西村神社
	} elseif($pls == 9) { //墓地
	} elseif($pls == 10) { //山丘地带
		$log = ($log . "哇！悬崖崩坏倒塌！<BR>");
		if($dice1 == 2){
			$log = ($log . "已经尽量闪避，不过，还是被石头滑落打伤了脚！<BR>");
			$inf = str_replace('f','',$inf);
			$inf = ($inf . "f");
		}elseif($dice1 == 3){
			$log = ($log . "石头滑落，受到<font color=\"red\"><b>{$dice2}</b></font> 点伤害！<BR>");
			$hp-=$dice2;
		}else{
			$log = ($log . "呼...总算是避开了...<BR>");
		}

	} elseif($pls == 11) { //隧道
		$log = ($log . "哇！脚下发现有生锈的钉子！<BR>");
		if($dice1 == 2){
			$log = ($log . "不小心踩到了钉子上，脚受伤了！<BR>");
			$inf = str_replace('f','',$inf);
			$inf = ($inf . "f");
		}elseif($dice1 == 3){
			$log = ($log . "脚被钉子扎伤，受到<font color=\"red\"><b>{$dice2}</b></font> 点伤害！<BR>");
			$hp-=$dice2;
		}else{
			$log = ($log . "呼...总算是避开了...<BR>");
		}
	} elseif($pls == 12) { //西村住宅区
		$log = ($log . "突然，天空出现一大群乌鸦！<BR>");
		if($dice1 == 2){
			$log = ($log . "被乌鸦袭击，头部受了伤！<BR>");
			$inf = str_replace('h','',$inf);
			$inf = ($inf . "h");
		}elseif($dice1 == 3){
			$log = ($log . "被乌鸦袭击，受到<font color=\"red\"><b>{$dice2}</b></font> 点伤害！<BR>");
			$hp-=$dice2;
		}else{
			$log = ($log . "呼，总算击退了。<BR>");
		}
	} elseif($pls == 13) { //寺庙
	} elseif($pls == 14) { //废校
	} elseif($pls == 15) { //南村神社
	} elseif($pls == 16) { //森林地带
		$log = ($log . "一只野狗突然向你袭来！<BR>");
		if($dice1 == 2){
			$log = ($log . "手臂被咬伤了！<BR>");
			$inf = str_replace('a','',$inf);
			$inf = ($inf . "a");
		}elseif($dice1 == 3){
			$log = ($log . "被野狗袭击，受到<font color=\"red\"><b>{$dice2}</b></font> 点伤害！<BR>");
			$hp-=$dice2;
		}else{
			$log = ($log . "呼...总算击退了...<BR>");
		}
	} elseif($pls == 17) { //源二郎池
		$log = ($log . "糟糕，脚下滑了一下！<BR>");
		if($dice1 <= 3){
			$dice2 += 10;
			if($sp <= $dice2){
				$dice2 = $sp-1;
			}
			$sp-=$dice2;
			$log = ($log . "掉下池中了，不过，已努力爬了上来！<BR>体力减少 <font color=\"red\"><b>{$dice2}</b></font> 点。<BR>");
		}else{
			$log = ($log . "呼...幸好没掉下水池...<BR>");
		}

	} elseif($pls == 18) { //南村住宅区
		$log = ($log . "突然，天空出现一大群乌鸦！<BR>");
		if($dice1 == 2){
			$log = ($log . "被乌鸦袭击，头部受了伤！<BR>");
			$inf = str_replace('h','',$inf);
			$inf = ($inf . 'h');
		}elseif($dice1 == 3){
			$log = ($log . "被乌鸦袭击，受到<font color=\"red\"><b>{$dice2}</b></font> 点伤害！<BR>");
			$hp-=$dice2;
		}else{
			$log = ($log . "呼，总算击退了。<BR>");
		}

	} elseif($pls == 19) { //诊所
	} elseif($pls == 20) { //灯塔
	} elseif($pls == 21) { //南海岸
		$log .= "一个好大的海浪突然打过来！<BR>";
		if($dice1 <= 3){
			$dice2 += 10;
			if($sp <= $dice2){
				$dice2 = $sp-1;
			}
			$sp-=$dice2;
			$log .= "被卷到了海中，好不容易爬了上来！<BR>体力减少 <font color=\"red\"><b>{$dice2}</b></font>  点。<BR>";
		}else{
			$log .= "呼...幸好没被卷进去...<BR>";
		}

	} else {
	}

	if($hp<=0){
		global $now,$alivenum,$deathnum,$name,$state;
		$hp = 0;
		$state = 13;
		addnews($now,'death13',$name,0);
		$alivenum--;
		$deathnum++;
		include_once GAME_ROOT.'./include/gamectl/system.func.php';
		save_gameinfo();
	}
	return;
}

?>