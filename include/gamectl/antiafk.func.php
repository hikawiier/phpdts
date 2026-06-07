<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 反挂机检测 / Anti-AFK detection
function antiAFK($timelimit = 0){
	global $now,$db,$gtablepre,$tablepre,$antiAFKertime,$alivenum,$deathnum;
	if(empty($timelimit)){
		$timelimit = $antiAFKertime;
	}
	$timelimit *= 60;
	$deadline=$now-$timelimit;
	$result = $db->query("SELECT * FROM {$tablepre}players WHERE type=0 AND endtime < '$deadline' AND hp>'0' AND state<'10'");
	while($al = $db->fetch_array($result)) {
		$afkerlist[$al['pid']]=Array('name' => $al['name'] ,'pls' => $al['pls']);
	}

	if(empty($afkerlist)){return;}
	foreach($afkerlist as $kid => $kcontent){
		$db->query("UPDATE {$tablepre}players SET hp='0',state='32',bid='0' WHERE pid='$kid' AND type='0' AND hp>'0' AND state<'10'");
		if($db->affected_rows()){
			addnews($now,'death32',$kcontent['name'],'',$kcontent['pls']);
			$alivenum--;
			$deathnum++;
		}
	}
	save_gameinfo();
	return;
}