<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 社团技能系统依赖 / Club skill system dependency
include_once GAME_ROOT."./include/pregame/clubslct.func.php";

// 动态生成NPC / Dynamically spawn NPC
function addnpc($type,$sub,$num,$time = 0,$anpcdata = NULL) {
	global $now,$db,$gtablepre,$tablepre,$log,$plsinfo,$typeinfo,$arealist,$areanum,$gamecfg;
	global $hidding_typelist,$danger_areas;

	$time = $time == 0 ? $now : $time;
	$plsnum = sizeof($plsinfo);
	$npcinit = get_npcinit();
	$anpcinfo = get_addnpcinfo();
	$anpc_namelist = Array();
	$anpc = array_merge($npcinit,$anpcinfo[$type]);
	$anpc = array_merge($anpc,$anpc['sub'][$sub]);
	if(!$anpc){
		return;
	} else {
		$summon_ids = [];
		for($i=0;$i< $num;$i++)
		{
			$npc = $anpc;
			$npc['type'] = $type;
			$npc['endtime'] = $time;
			$npc['exp'] = round(($npc['lvl']*2+1)*$GLOBALS['baseexp']);
			$npc['sNo'] = $i;
			$npc['hp'] = $npc['mhp'];
			$npc['sp'] = $npc['msp'];
			if(!isset($npc['state'])){$npc['state'] = 0;}
			foreach(Array('p','k','g','c','d','f') as $val){
				if(!$npc['w'.$val]){
					$npc['w'.$val] = $npc['skill'];
				}
			}
			if($npc['gd'] == 'r'){$npc['gd'] = rand(0,1) ? 'm':'f';}

			# RuleSet钩子：检查NPC位置是否需要随机化
			if(function_exists('ruleset_should_randomize_npc') && ruleset_should_randomize_npc($npc['pls'])) {
				if(function_exists('ruleset_get_random_npc_location')) {
					$npc['pls'] = ruleset_get_random_npc_location($plsnum);
				}
			} else {
				# 位置信息为数组时，在两地中择一随机刷新
				if(is_array($npc['pls']))
				{
					$npc['pls'] = $npc['pls'][array_rand($npc['pls'])];
				}
				elseif($npc['pls'] == 99)
				{
					$areaarr = get_safe_areas();
					if(empty($areaarr)){
						$npc['pls'] = 0;
					}else{
						shuffle($areaarr);
						$npc['pls'] = $areaarr[0];
						if(in_array($npc['type'],$hidding_typelist))
						{
							while(in_array($npc['pls'],$danger_areas))
							{
								shuffle($areaarr);
								$npc['pls'] = $areaarr[0];
							}
						}
					}
				}
			}

			# NPC称号技能初始化
			if(!empty($npc['club'])) changeclub($npc['club'],$npc);
			# NPC自定义技能初始化
			if(!empty($npc['clubskill']) || !empty($npc['clubskillpara'])) customtclubskill($npc);

			# 自定义数据不为空时，覆盖原本预设的NPC数据
			if(!empty($anpcdata))
			{
				foreach($anpcdata as $adkey => $advalue)
				{
					if(is_array($advalue)) continue;
					$npc[$adkey] = $advalue;
				}
				if(isset($anpcdata['clbstatus']))
				{
					foreach(Array('a','b','c','d','e') as $cbs)
					{
						if(isset($anpcdata['clbstatus'][$cbs])) $npc['clbstatus'.$cbs] = $anpcdata['clbstatus'][$cbs];
					}
				}
				if(isset($anpcdata['clbpara']))
				{
					$npc['clbpara'] = is_array($npc['clbpara']) ? array_merge($npc['clbpara'],$anpcdata['clbpara']) : $anpcdata['clbpara'];
				}
			}
			# RuleSet钩子：随机化NPC数值
			if(function_exists('ruleset_randomize_npc_stats')) ruleset_randomize_npc_stats($npc);

			$npc=player_format_with_db_structure($npc);
			$db->array_insert("{$tablepre}players", $npc);
			$summon_ids[] = $db->insert_id();
			$newsname=$typeinfo[$type].' '.$npc['name'];
			if($num > 1)
			{
				$anpc_namelist[$newsname] += 1;
			}
			else
			{
				addnews($now, 'addnpc', $newsname);
			}
			unset($npc);
		}
	}
	if($num > 1)
	{
		foreach($anpc_namelist as $aname => $anum)
		{
			addnews($now, 'addnpcs', $aname, $anum);
		}
		unset($anpc_namelist);
	}
	else
	{
		return $summon_ids;
	}
	return;
}

// NPC进化 / NPC evolution
function evonpc($type,$name){
	global $now,$db,$gtablepre,$tablepre,$log,$plsinfo,$typeinfo,$enpcinfo,$gamecfg;
	if(!$type || !$name){return false;}
	if(empty($enpcinfo)){
		include_once config('evonpc',$gamecfg);
	}
	if(!isset($enpcinfo[$type])){return false;}
	$result = $db->query("SELECT * FROM {$tablepre}players WHERE type = '$type' AND name = '$name'");
	$num = $db->num_rows($result);
	if(!$num){return false;}
	if(!isset($enpcinfo[$type][$name])){return false;}
	$npc=$enpcinfo[$type][$name];
	$npc['hp'] = $npc['mhp'];
	$npc['sp'] = $npc['msp'];
	$npc['exp'] = round(($npc['lvl']*2+1)*$GLOBALS['baseexp']);
	if(!isset($npc['state'])){$npc['state'] = 0;}
	$npc['wp'] = $npc['wk'] = $npc['wg'] = $npc['wc'] = $npc['wd'] = $npc['wf'] = $npc['skill'];
	unset($npc['skill']);
	$qry = '';
	# NPC进化后技能初始化
	global $club_skillslist;
	if(isset($club_skillslist[$npc['club']]))
	{
		if(empty($npc['clbpara'])) $npc['clbpara']['skill'] = Array();
		$npc_csk = $club_skillslist[$npc['club']];
		foreach($npc_csk as $sk) getclubskill($sk,$npc['clbpara']);
	}
	global $cskills;
	if(!empty($npc['clubskill']))
	{
		foreach($npc['clubskill'] as $sk) getclubskill($sk,$npc['clbpara']);
	}
	if(!empty($npc['clubskillpara']))
	{
		foreach($npc['clubskillpara'] as $sk => $skarr)
		{
			foreach($skarr as $skpara => $skvalue) set_skillpara($sk,$skpara,$skvalue,$npc['clbpara']);
		}
	}
	unset($npc['clubskill']);unset($npc['clubskillpara']);
	# RuleSet钩子：随机化NPC数值
	if(function_exists('ruleset_randomize_npc_stats')) ruleset_randomize_npc_stats($npc);
	$npc['clbpara'] = json_encode($npc['clbpara'],JSON_UNESCAPED_UNICODE);
	foreach($npc as $key => $val){
		$qry .= "$key = '{$val}',";
	}
	if(!empty($qry)){
		$qry = substr($qry,0,-1);
		$db->query( "UPDATE {$tablepre}players SET $qry WHERE type = '$type' AND name = '$name'" );
	}

	return $npc;
}