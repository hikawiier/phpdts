<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 决斗系统 / Duel system
function duel($time = 0,$keyitm = ''){
	global $now,$gamestate,$name,$nick;
	if($gamestate < 30){
		return 30;
	} elseif($gamestate >= 50) {
		return 51;
	}	else{
		$time = $time == 0 ? $now : $time;
		$gamestate = 50;
		save_gameinfo();

		addnews($time,'duelkey',$name,$keyitm,$nick);
		addnews($time,'duel');
		systemputchat($time,'duel');
		return 50;
	}

}