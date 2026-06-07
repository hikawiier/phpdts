<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 积分结算与赌局系统 / Credits settlement and gambling system
include_once GAME_ROOT.'./include/meta/credits.func.php';

function rs_game($mode = 0) {
	global $db,$gtablepre,$tablepre,$groomid,$gamecfg,$now,$gamestate,$plsinfo,$typeinfo,$areanum,$areaadd,$afktime,$combonum,$deathlimit;
//	$stime=getmicrotime();
	$dir = GAME_ROOT.'./gamedata/';
	$sqldir = GAME_ROOT.'./gamedata/sql/';
	if ($mode & 1) {
		//重设玩家互动信息、聊天记录、地图道具、地图陷阱、进行状况
		$sql = file_get_contents("{$sqldir}reset.sql");
		$sql = str_replace("\r", "\n", str_replace(' bra_', ' '.$tablepre, $sql));

		$db->queries($sql);

		//重设游戏进行状况的时间
		/*if($fp = fopen("{$dir}newsinfo.php", 'wb')) {
			global $checkstr;
			fwrite($fp, $checkstr);
			fclose($fp);
		} else {
			gexit('Can not write to cache files, please check directory ./gamedata/ and ./gamedata/cache/ .', __file__, __line__);
		}*/

		//清空战斗信息
		global $hdamage,$hplayer,$noisetime,$noisepls,$noiseid,$noiseid2,$noisemode,$starttime,$gamevars;
		$hdamage = 0;
		$hplayer = '';
		$noisetime = 0;
		$noisepls = 0;
		$noiseid = 0;
		$noiseid2 = 0;
		$noisemode = '';
		save_combatinfo();

		//修改反挂机间隔
		$afktime = $starttime;
		//重设连斗判断死亡数
		$combonum = $deathlimit;
		//重设游戏剧情开关
		$gamevars = Array();
		save_gameinfo();

	}
	if ($mode & 2) {
		//echo " - 禁区初始化 - ";
		global $rswtharr,$arealist,$areanum,$weather,$hack,$areatime,$starttime,$startmin,$areaadd,$areahour;
		list($sec,$min,$hour,$day,$month,$year,$wday,$yday,$isdst) = localtime($starttime);
		$areatime = (ceil(($starttime + $areahour*60)/600))*600;//$areahour已改为按分钟计算，ceil是为了让禁区分钟为10的倍数
		$plsnum = sizeof($plsinfo);
		$arealist = range(1,$plsnum-1);
		shuffle($arealist);
		array_unshift($arealist,0);
		$areanum = 0;
		$weather = $rswtharr[array_rand($rswtharr)];
		$hack = 0;
		movehtm($areatime);
	}
	if ($mode & 4) {
		//echo " - 角色数据库初始化 - ";
		global $validnum,$alivenum,$deathnum;
		$sql = file_get_contents("{$sqldir}players.sql");
		$sql = str_replace("\r", "\n", str_replace(' bra_', ' '.$tablepre, $sql));
		$db->queries($sql);
		//runquery($sql);
		$validnum = $alivenum = $deathnum = 0;
	}
	if ($mode & 8) {
		//echo " - NPC初始化 - ";
		$db->query("DELETE FROM {$tablepre}players WHERE type>0 ");
		include_once config('npc',$gamecfg);
		include_once GAME_ROOT."./include/pregame/clubslct.func.php";
		//$typenum = sizeof($typeinfo);
		$plsnum = sizeof($plsinfo);
		$npcqry = '';

		//for($i = 1; $i < $typenum; $i++) {
		foreach ($npcinfo as $i => $npcs){
			if(!empty($npcs)) {
				if (sizeof($npcs['sub'])>$npcs['num'])shuffle($npcs['sub']);
				for($j = 1; $j <= $npcs['num']; $j++) {
					$npc = array_merge($npcinit,$npcs);
					//$npc = $npcinfo[$i];
					$npc['type'] = $i;
					$npc['endtime'] = $now;
					$npc['sNo'] = $j;

					//if(($npc['mode'] == 1)&&($npc['num'] <= $npc['sub'])){
					//	$npc = array_merge($npc,$npc[$j]);
					//} elseif($npc['mode'] == 2) {
					//	$k = rand(1,$npc['sub']);
					//	$npc = array_merge($npc,$npc[$k]);
					//} else {
					//	$npc = array_merge($npc,$npc[1]);
					//}


					// 检查sub数组是否存在且不为空
					if(isset($npc['sub']) && is_array($npc['sub']) && !empty($npc['sub'])) {
						$subnum = sizeof($npc['sub']);
						$sub = $j % $subnum;
						// 确保sub数组中的元素存在且为数组
						if(isset($npc['sub'][$sub]) && is_array($npc['sub'][$sub])) {
							$npc = array_merge($npc,$npc['sub'][$sub]);
						} else {
							error_log("Warning: NPC type {$i} sub[{$sub}] is null or not array. Using base NPC data.");
						}
					} else {
						// 如果没有sub数组或sub数组为空，记录警告但继续使用基础NPC数据
						error_log("Warning: NPC type {$i} has no valid 'sub' array. Using base NPC data.");
						// 不跳过，继续使用当前的$npc数据
					}
					$npc['hp'] = $npc['mhp'];
					$npc['sp'] = $npc['msp'];
					$npc['exp'] = round(2*$npc['lvl']*$GLOBALS['baseexp']);
					foreach(Array('p','k','g','c','d','f') as $val){
						if(!$npc['w'.$val]){
							$npc['w'.$val] = $npc['skill'];
						}
					}
					//$npc['wp'] = $npc['wk'] = $npc['wg'] = $npc['wc'] = $npc['wd'] = $npc['wf'] = $npc['skill'];
					if($npc['gd'] == 'r'){$npc['gd'] = rand(0,1) ? 'm':'f';}

					# NPC称号技能初始化
					if(!empty($npc['club'])) changeclub($npc['club'],$npc);
					# NPC自定义技能初始化
					if(!empty($npc['clubskill']) || !empty($npc['clubskillpara'])) customtclubskill($npc);
					# RuleSet钩子：随机化NPC数值
					if(function_exists('ruleset_randomize_npc_stats')) ruleset_randomize_npc_stats($npc);

					# 初始化NPC所在位置
					global $hidding_typelist,$danger_areas;

					# RuleSet钩子：检查NPC位置是否需要随机化
					if(function_exists('ruleset_should_randomize_npc') && ruleset_should_randomize_npc($npc['pls']))
					{
						if(function_exists('ruleset_get_random_npc_location'))
						{
							$npc['pls'] = ruleset_get_random_npc_location($plsnum);
						}
					}
					else
					{
						# 位置信息为数组时，在两地中择一随机刷新
						if(is_array($npc['pls'])) $npc['pls'] = $npc['pls'][array_rand($npc['pls'])];

						# 女主不会刷新在危险区域
						if(in_array($npc['type'],$hidding_typelist))
						{
							do{
								$rpls=rand(1,$plsnum-1);
							}while (in_array($rpls,$danger_areas));
						}
						else
						{
							do{$rpls=rand(1,$plsnum-1);}while (is_event_area($rpls));
						}
						if($npc['pls'] == 99)
						{
							$npc['pls'] = $rpls;
						}
					}

					$npc['state'] = 0;
					$npc=player_format_with_db_structure($npc);
					$db->array_insert("{$tablepre}players", $npc);
					//$npcqry .= "('".$npc['name']."','".$npc['pass']."','".$npc['type']."','".$npc['endtime']."','".$npc['gd']."','".$npc['sNo']."','".$npc['icon']."','".$npc['club']."','".$npc['rp']."','".$npc['hp']."','".$npc['mhp']."','".$npc['sp']."','".$npc['msp']."','".$npc['att']."','".$npc['def']."','".$npc['pls']."','".$npc['lvl']."','".$npc['exp']."','".$npc['money']."','".$npc['bid']."','".$npc['inf']."','".$npc['rage']."','".$npc['pose']."','".$npc['tactic']."','".$npc['killnum']."','".$npc['state']."','".$npc['wp']."','".$npc['wk']."','".$npc['wg']."','".$npc['wc']."','".$npc['wd']."','".$npc['wf']."','".$npc['teamID']."','".$npc['teamPass']."','".$npc['wep']."','".$npc['wepk']."','".$npc['wepe']."','".$npc['weps']."','".$npc['arb']."','".$npc['arbk']."','".$npc['arbe']."','".$npc['arbs']."','".$npc['arh']."','".$npc['arhk']."','".$npc['arhe']."','".$npc['arhs']."','".$npc['ara']."','".$npc['arak']."','".$npc['arae']."','".$npc['aras']."','".$npc['arf']."','".$npc['arfk']."','".$npc['arfe']."','".$npc['arfs']."','".$npc['art']."','".$npc['artk']."','".$npc['arte']."','".$npc['arts']."','".$npc['itm0']."','".$npc['itmk0']."','".$npc['itme0']."','".$npc['itms0']."','".$npc['itm1']."','".$npc['itmk1']."','".$npc['itme1']."','".$npc['itms1']."','".$npc['itm2']."','".$npc['itmk2']."','".$npc['itme2']."','".$npc['itms2']."','".$npc['itm3']."','".$npc['itmk3']."','".$npc['itme3']."','".$npc['itms3']."','".$npc['itm4']."','".$npc['itmk4']."','".$npc['itme4']."','".$npc['itms4']."','".$npc['itm5']."','".$npc['itmk5']."','".$npc['itme5']."','".$npc['itms5']."','".$npc['itm6']."','".$npc['itmk6']."','".$npc['itme6']."','".$npc['itms6']."','".$npc['wepsk']."','".$npc['arbsk']."','".$npc['arhsk']."','".$npc['arask']."','".$npc['arfsk']."','".$npc['artsk']."','".$npc['itmsk0']."','".$npc['itmsk1']."','".$npc['itmsk2']."','".$npc['itmsk3']."','".$npc['itmsk4']."','".$npc['itmsk5']."','".$npc['itmsk6']."','".$npc['skills']."'),";
					//$db->query("INSERT INTO {$tablepre}players (name,pass,type,endtime,gd,sNo,icon,club,hp,mhp,sp,msp,att,def,pls,lvl,`exp`,money,bid,inf,rage,pose,tactic,killnum,state,wp,wk,wg,wc,wd,wf,teamID,teamPass,wep,wepk,wepe,weps,arb,arbk,arbe,arbs,arh,arhk,arhe,arhs,ara,arak,arae,aras,arf,arfk,arfe,arfs,art,artk,arte,arts,itm0,itmk0,itme0,itms0,itm1,itmk1,itme1,itms1,itm2,itmk2,itme2,itms2,itm3,itmk3,itme3,itms3,itm4,itmk4,itme4,itms4,itm5,itmk5,itme5,itms5,wepsk,arbsk,arhsk,arask,arfsk,artsk,itmsk0,itmsk1,itmsk2,itmsk3,itmsk4,itmsk5) VALUES ('".$npc['name']."','".$npc['pass']."','".$npc['type']."','".$npc['endtime']."','".$npc['gd']."','".$npc['sNo']."','".$npc['icon']."','".$npc['club']."','".$npc['hp']."','".$npc['mhp']."','".$npc['sp']."','".$npc['msp']."','".$npc['att']."','".$npc['def']."','".$npc['pls']."','".$npc['lvl']."','".$npc['exp']."','".$npc['money']."','".$npc['bid']."','".$npc['inf']."','".$npc['rage']."','".$npc['pose']."','".$npc['tactic']."','".$npc['killnum']."','".$npc['death']."','".$npc['wp']."','".$npc['wk']."','".$npc['wg']."','".$npc['wc']."','".$npc['wd']."','".$npc['wf']."','".$npc['teamID']."','".$npc['teamPass']."','".$npc['wep']."','".$npc['wepk']."','".$npc['wepe']."','".$npc['weps']."','".$npc['arb']."','".$npc['arbk']."','".$npc['arbe']."','".$npc['arbs']."','".$npc['arh']."','".$npc['arhk']."','".$npc['arhe']."','".$npc['arhs']."','".$npc['ara']."','".$npc['arak']."','".$npc['arae']."','".$npc['aras']."','".$npc['arf']."','".$npc['arfk']."','".$npc['arfe']."','".$npc['arfs']."','".$npc['art']."','".$npc['artk']."','".$npc['arte']."','".$npc['arts']."','".$npc['itm0']."','".$npc['itmk0']."','".$npc['itme0']."','".$npc['itms0']."','".$npc['itm1']."','".$npc['itmk1']."','".$npc['itme1']."','".$npc['itms1']."','".$npc['itm2']."','".$npc['itmk2']."','".$npc['itme2']."','".$npc['itms2']."','".$npc['itm3']."','".$npc['itmk3']."','".$npc['itme3']."','".$npc['itms3']."','".$npc['itm4']."','".$npc['itmk4']."','".$npc['itme4']."','".$npc['itms4']."','".$npc['itm5']."','".$npc['itmk5']."','".$npc['itme5']."','".$npc['itms5']."','".$npc['wepsk']."','".$npc['arbsk']."','".$npc['arhsk']."','".$npc['arask']."','".$npc['arfsk']."','".$npc['artsk']."','".$npc['itmsk0']."','".$npc['itmsk1']."','".$npc['itmsk2']."','".$npc['itmsk3']."','".$npc['itmsk4']."','".$npc['itmsk5']."')");
					unset($npc);
				}
			}
		}
		/*if(!empty($npcqry)){
			$npcqry = "INSERT INTO {$tablepre}players (name,pass,type,endtime,gd,sNo,icon,club,rp,hp,mhp,sp,msp,att,def,pls,lvl,`exp`,money,bid,inf,rage,pose,tactic,killnum,state,wp,wk,wg,wc,wd,wf,teamID,teamPass,wep,wepk,wepe,weps,arb,arbk,arbe,arbs,arh,arhk,arhe,arhs,ara,arak,arae,aras,arf,arfk,arfe,arfs,art,artk,arte,arts,itm0,itmk0,itme0,itms0,itm1,itmk1,itme1,itms1,itm2,itmk2,itme2,itms2,itm3,itmk3,itme3,itms3,itm4,itmk4,itme4,itms4,itm5,itmk5,itme5,itms5,itm6,itmk6,itme6,itms6,wepsk,arbsk,arhsk,arask,arfsk,artsk,itmsk0,itmsk1,itmsk2,itmsk3,itmsk4,itmsk5,itmsk6,skills) VALUES ".substr($npcqry, 0, -1);
			$db->query($npcqry);
			unset($npcqry);
		}*/
	}
	if ($mode & 16) {
		//echo " - 地图道具/陷阱初始化 - ";
		//2024-07-19 Added itmpara support for map items
		//感谢 Martin1994 提供地图道具数据库化的源代码
		$plsnum = sizeof($plsinfo);
		$iqry = $tqry = '';
//		if($gamestate == 0){
//			global $checkstr;
//			dir_clear("{$dir}mapitem/");
//			for($i = 0;$i < $plsnum; $i++){
//				$mapfile = GAME_ROOT."./gamedata/mapitem/{$i}mapitem.php";
//				writeover($mapfile,$checkstr);
//			}
//		}
		$file = config('mapitem',$gamecfg);
		$itemlist = openfile($file);
		$in = sizeof($itemlist);
		$an = $areanum ? ceil($areanum/$areaadd) : 0;
		//$mapitem = array();
		//$ifqry = $iqry = 'INSERT INTO '.$tablepre.'mapitem (itm,itmk,itme,itms,itmsk,map) VALUES ';
		for($i = 1; $i < $in; $i++) {
			if(!empty($itemlist[$i])){
				// 特殊处理JSON对象中的逗号
				$line = $itemlist[$i];
				$json_start = strpos($line, '{');
				$json_end = strrpos($line, '}');
				$json_content = '';

				// 如果存在JSON对象
				if($json_start !== false && $json_end !== false && $json_end > $json_start) {
					// 提取JSON内容
					$json_content = substr($line, $json_start, $json_end - $json_start + 1);
					// 替换JSON内容为占位符
					$line = substr($line, 0, $json_start) . 'JSON_PLACEHOLDER';
				}

				// 分割字符串
				$item_parts = explode(',', $line);

				// 确保数组有足够的元素
				$item_parts = array_pad($item_parts, 9, '');

				// 检查是否有itmpara字段
				$itmpara = '';
				if(count($item_parts) >= 9) {
					$itmpara = $item_parts[8];
					// 如果itmpara是JSON占位符，则替换回实际的JSON内容
					if($itmpara === 'JSON_PLACEHOLDER') {
						$itmpara = $json_content;
					}
				}

				list($iarea,$imap,$inum,$iname,$ikind,$ieff,$ista,$iskind) = array_slice($item_parts, 0, 8);

				if(($iarea == $an)||($iarea == 99)) {
					for($j = $inum; $j>0; $j--) {
						// RuleSet钩子：检查地图物品是否需要随机刷新
						$force_random = function_exists('ruleset_should_randomize_item') && ruleset_should_randomize_item($imap, $iarea, $an);

						if($imap == 99 || $force_random) {
							$rmap = rand(1,$plsnum-1);
							while (is_event_area($rmap)){$rmap = rand(1,$plsnum-1);}
							if(strpos($ikind ,'TO')===0){
								$tqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$rmap','$itmpara'),";
							}else{
								$iqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$rmap','$itmpara'),";
							}
							//$iqry[$rmap] .= "('$iname', '$ikind','$ieff','$ista','$iskind'),";
							//$db->query("INSERT INTO {$tablepre}{$rmap}mapitem (itm,itmk,itme,itms,itmsk) VALUES ('$iname', '$ikind','$ieff','$ista','$iskind')");
						}else{
							if(strpos($ikind ,'TO')===0){
								$tqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$imap','$itmpara'),";
							}else{
								$iqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$imap','$itmpara'),";
							}
							//$db->query("INSERT INTO {$tablepre}{$imap}mapitem (itm,itmk,itme,itms,itmsk) VALUES ('$iname', '$ikind','$ieff','$ista','$iskind')");
						}

						//if($imap == 99) {
						//	$imap = rand(1,$plsnum-1);
							//$mapitem[$rmap] .= "$iname,$ikind,$ieff,$ista,$iskind,\n";
						//} else {
							//$mapitem[$imap] .= "$iname,$ikind,$ieff,$ista,$iskind,\n";
						//}
					}
				}
			}
		}
		if(!empty($iqry)){
			$iqry = "INSERT INTO {$tablepre}mapitem (itm,itmk,itme,itms,itmsk,pls,itmpara) VALUES ".substr($iqry, 0, -1);
			$db->query($iqry);
		}
		if(!empty($tqry)){
			$tqry = "INSERT INTO {$tablepre}maptrap (itm,itmk,itme,itms,itmsk,pls,itmpara) VALUES ".substr($tqry, 0, -1);
			$db->query($tqry);
		}
//		for($imap = 0;$imap<$plsnum;$imap++){
//			if(!empty($iqry[$imap])){
//				$iqry[$imap] = "INSERT INTO {$tablepre}{$imap}mapitem (itm,itmk,itme,itms,itmsk) VALUES ".substr($iqry[$imap], 0, -1);
//				$db->query($iqry[$imap]);
//			}
//		}
//		if($ifqry != $iqry){//判定是否有数据写入
//			$iqry = substr($iqry, 0, -1);//去除尾部多余的逗号
//			$db->query($iqry);
//		}
//		foreach($mapitem as $map => $itemdata) {
//			$mapfile = GAME_ROOT."./gamedata/mapitem/{$map}mapitem.php";
//			writeover($mapfile,$itemdata,'ab');
//		}

		unset($itemlist);unset($iqry);
		//unset($mapitem);
		//挤一挤 仓库道具初始化
		include_once GAME_ROOT.'./include/game/depot.func.php';
		if(isset($npc_depot) && count($npc_depot)>0)
		{
			foreach($npc_depot as $nd_num => $nd_arr)
			{
				foreach($nd_arr['itm'] as $nd_itm_arr)
				{
					$ditm = $nd_itm_arr['itm'];$ditmk = $nd_itm_arr['itmk'];$ditmsk = $nd_itm_arr['itmsk'];$ditmpara = $nd_itm_arr['itmpara'];
					$ditme = $nd_itm_arr['itme'];$ditms = $nd_itm_arr['itms'];
					$dname = $nd_arr['name'];$dtype = $nd_arr['type'];
					$db->query("INSERT INTO {$tablepre}itemdepot (itm, itmk, itme, itms, itmsk , itmpara, itmowner, itmpw) VALUES ('$ditm', '$ditmk', '$ditme', '$ditms', '$ditmsk', '$ditmpara', '$dname', '$dtype')");
				}
			}
		}
	}
	if ($mode & 32) {
		//echo " - 商店初始化 - ";
		//2024-07-19 Added itmpara support for shop items
		$sql = file_get_contents("{$sqldir}shopitem.sql");
		$sql = str_replace("\r", "\n", str_replace(' bra_', ' '.$tablepre, $sql));
		$db->queries($sql);
		//runquery($sql);

		$file = config('shopitem',$gamecfg);
		$shoplist = openfile($file);
		$qry = '';
		foreach($shoplist as $lst){
			if(!empty($lst)){
				// 特殊处理JSON对象中的逗号
				$line = $lst;
				$json_start = strpos($line, '{');
				$json_end = strrpos($line, '}');
				$json_content = '';

				// 如果存在JSON对象
				if($json_start !== false && $json_end !== false && $json_end > $json_start) {
					// 提取JSON内容
					$json_content = substr($line, $json_start, $json_end - $json_start + 1);
					// 替换JSON内容为占位符
					$line = substr($line, 0, $json_start) . 'JSON_PLACEHOLDER';
				}

				// 分割字符串
				$lst = explode(',', $line);

				// 确保数组有足够的元素
				$lst = array_pad($lst, 10, '');

				// 检查是否有itmpara字段
				$itmpara = '';
				if(count($lst) >= 10) {
					$itmpara = $lst[9];
					// 如果itmpara是JSON占位符，则替换回实际的JSON内容
					if($itmpara === 'JSON_PLACEHOLDER') {
						$itmpara = $json_content;
					}
				}
				list($kind,$num,$price,$area,$item,$itmk,$itme,$itms,$itmsk)=$lst;
				if($kind != 0){
					$qry .= "('$kind','$num','$price','$area','$item','$itmk','$itme','$itms','$itmsk','$itmpara'),";
				}
			}
		}
		if(!empty($qry)){
			$qry = "INSERT INTO {$tablepre}shopitem (kind,num,price,area,item,itmk,itme,itms,itmsk,itmpara) VALUES ".substr($qry, 0, -1);
		}
		$db->query($qry);

	}
}

function rs_sttime() {
	//echo " - 游戏开始时间初始化 - ";
	global $starttime,$now,$startmode,$starthour,$startmin;

	list($sec,$min,$hour,$day,$month,$year,$wday,$yday,$isdst) = localtime($now);
	$month++;
	$year += 1900;

	if($startmode == 1) {
		if($hour >= $starthour){ $nextday = $day+1;}
		else{$nextday = $day;}
		$nexthour = $starthour;
		$starttime = mktime($nexthour,$startmin,0,$month,$nextday,$year);
	} elseif($startmode == 2) {
		$starthour = $starthour> 0 ? $starthour : 1;
		$startmin = $startmin> 0 ? $startmin : 1;
		$nexthour = $hour + $starthour;
		$starttime = mktime($nexthour,$startmin,0,$month,$day,$year);
	} elseif($startmode == 3) {
		$starthour = $starthour> 0 ? $starthour : 1;
		$nextmin = $min + $starthour;
		$nexthour = $hour;
//		if($nextmin % 60 >= 40){//回避速1禁
//			$nextmin+=20;
//		}
		if($nextmin % 60 == 0){
			$nextmin +=1;
		}
		$starttime = mktime($nexthour,$nextmin,0,$month,$day,$year);
	} else {
		$starttime = 0;
	}

	return;
}


function add_once_area($atime) {
	//实际上GAMEOVER的判断是在common.inc.php里
	global $db,$gtablepre,$tablepre,$now,$gamestate,$areaesc,$arealist,$areanum,$arealimit,$areaadd,$plsinfo,$weather,$hack,$validnum,$alivenum,$deathnum;
	global $gamevars,$danger_areas,$sentinel_typelist,$npc_away_from_danger_areas;

	if (($gamestate > 10)&&($now > $atime)) {
		$plsnum = sizeof($plsinfo) - 1;
		if(($areanum >= $arealimit*$areaadd)&&($validnum<=0)) {//无人参加GAMEOVER不是因为这里，这里只是保险。
			gameover($atime,'end4');
			return;
		} elseif(($areanum + $areaadd) >= $plsnum) {
			$areaaddlist = get_next_death_areas(0, false);
			$areanum = $plsnum;
			if($weather <= 9) $weather = rand(0,9);
			//addnews($atime,'addarea',$areaaddlist,$weather);
			addnews($atime, 'addarea',$areaaddlist,$weather);
			storyputchat($now,'areaadd');
			systemputchat($atime,'areaadd',$areaaddlist);
			$query = $db->query("SELECT * FROM {$tablepre}players WHERE type=0 AND hp>0");
			while($sub = $db->fetch_array($query)) {
				$pid = $sub['pid'];
				$hp = 0;
				$state = 11;
				$deathpls = $sub['pls'];
				$bid = 0;
				$endtime = $atime;
				$db->query("UPDATE {$tablepre}players SET hp='$hp', bid='$bid', state='$state', endtime='$endtime' WHERE pid=$pid");
				addnews($endtime,"death$state",$sub['name'],$sub['type'],$deathpls);
			}
			$db->free_result($query);
			$alivenum = 0;
			$dquery = $db->query("SELECT pid FROM {$tablepre}players WHERE hp<=0");
			$deathnum = $db->num_rows($dquery);
			$db->free_result($dquery);
			gameover($atime,'end1');
			return;
		} else {
			if($weather <= 9) $weather = rand(0,9);
			if($hack > 0){$hack--;}
			# 解锁子面板功能后，每次增加禁区时，释放一条被占用的信道
			if(isset($gamevars['apis']) && isset($gamevars['api']) && $gamevars['api'] < $gamevars['apis']) $gamevars['api']++;
			$areaaddlist = get_next_death_areas();
			$areanum += $areaadd;
			movehtm();
			addnews($atime, 'addarea',$areaaddlist,$weather);
			storyputchat($now,'areaadd');
			systemputchat($atime,'areaadd',$areaaddlist);
			$str_arealist = implode(',',get_death_areas());
			$query = $db->query("SELECT * FROM {$tablepre}players WHERE pls IN ($str_arealist) AND hp>0");
			while($sub = $db->fetch_array($query)) {
				$pid = $sub['pid'];
				if(!$sub['type']) {
					if(($gamestate >= 40)||(!$areaesc&&($sub['tactic']!=4))) {
					$hp = 0;
					$state = 11;
					$deathpls = $sub['pls'];
					$bid = 0;
					$endtime = $atime;
					$db->query("UPDATE {$tablepre}players SET hp='$hp', bid='$bid', state='$state', endtime='$endtime' WHERE pid=$pid");
					addnews($endtime,"death$state",$sub['name'],$sub['type'],$deathpls);
					$deathnum++;
					} else {
					do{$pls = $arealist[rand($areanum+1,$plsnum)];}while (is_event_area($pls));
					$db->query("UPDATE {$tablepre}players SET pls='$pls' WHERE pid=$pid ");
					}
				//躲避禁区判定
				//} elseif($sub['type'] != 1 && $sub['type'] != 7 && $sub['type'] != 9 && $sub['type'] != 13 && $sub['type'] != 20 && $sub['type'] != 21 && $sub['type'] != 88 && $sub['type'] != 22 && $sub['type'] != 92) {
				// Let's try giving NPCs less human rights to migrate the leak problem
				}elseif(!in_array($sub['type'],$sentinel_typelist) && $gamestate <= 40){
					if($npc_away_from_danger_areas)
					{	//开启了NPC不会因躲避禁区移动到危险地图的功能
						do{
							$pls = $arealist[rand($areanum+1,$plsnum)];
						}while (in_array($pls,$danger_areas));
					}
					else
					{
						do{
							$pls = $arealist[rand($areanum+1,$plsnum)];
						}while (is_event_area($pls));
					}
					$db->query("UPDATE {$tablepre}players SET pls='$pls' WHERE pid=$pid");
				}
			}
			$alivenum = $db->result($db->query("SELECT COUNT(*) FROM {$tablepre}players WHERE hp>0 AND type=0"), 0);
			if(($alivenum == 1)&&($gamestate >= 30)) {
				gameover($atime);
				return;
			} elseif(($alivenum <= 0)&&($gamestate >= 30)) {
				gameover($atime,'end1');
				return $atime;
			} else {
				rs_game(16+32);
				//$areatime += $areahour*3600;
				//addarea($areatime);
				return;
			}
		}
	} else {
		return;
	}
}

function areawarn(){
	global $now,$arealist,$areanum,$areaadd,$areawarn;
	$areaaddlist = get_next_death_areas();
	$areawarn = 1;
	storyputchat($now,'areawarn');
	systemputchat($now,'areawarn',$areaaddlist);
	return;
}

//------游戏结束------
//模式：0保留：程序故障；1：全部死亡；2：最后幸存；3：禁区解除；4：无人参加；5：核爆全灭；6：GM中止
function gameover($time = 0, $mode = '', $winname = '') {
	global $gamestate,$winmode,$alivenum,$winner,$now,$gamenum,$db,$gtablepre,$tablepre,$gamenum,$starttime,$validnum,$hdamage,$hplayer;
	global $groomid;
    //遍历./records/$gamenum/下的所有txt文件
    $filelist = glob("./records/$gamenum/**/*.txt");
    //然后gzip压缩
    foreach($filelist as $file){
        $input = fopen($file, 'rb');
        $output = gzopen($file . '.gz', 'wb');
        while (!feof($input)) {
            gzwrite($output, fread($input, 1024));
        }
        fclose($input);
        //删除原文件
        unlink($file);
    }
	if($gamestate < 10){return;}
	if((!$mode)||(($mode==2)&&(!$winname))) {//在没提供游戏结束模式的情况下，自行判断模式
		if($validnum <= 0) {//无激活者情况下，全部死亡
			$alivenum = 0;
			$winmode = 4;
			$winner = '';

		} else {//判断谁是最后幸存者
			$result = $db->query("SELECT * FROM {$tablepre}players WHERE hp>0 AND type=0");
			$alivenum = $db->num_rows($result);
			if(!$alivenum) {//全部死亡
				$winmode = 1;
				$winner = '';
			} elseif($alivenum == 1) {//最后幸存
				$winmode = 2;
				$wdata = $db->fetch_array($result);
				$winner = $wdata['name'];
				$db->query("UPDATE {$tablepre}players SET state='5' where pid='{$wdata['pid']}'");
			} else {//不满足游戏结束条件，返回
				save_gameinfo();
				return;
			}
		}
	} else {//提供了游戏结束模式的情况下
		$winmode = substr($mode,3,1);
		$winner = $winname;
	}
	$time = $time ? $time : $now;
	$result = $db->query("SELECT gid FROM {$gtablepre}winners ORDER BY gid DESC LIMIT 1");//判断当前游戏局数是否正确，以优胜列表为准
	if($db->num_rows($result)&&($gamenum <= $db->result($result, 0))) {
		$gamenum = $db->result($result, 0) + 1;
	}
	if($winmode == 4){//无人参加；不需要记录任何资料
		$getime = $time;
		$db->query("INSERT INTO {$gtablepre}winners (gid,wmode,vnum,getime) VALUES ('$gamenum','$winmode','$validnum','$getime')");
	}	elseif(($winmode == 0)||($winmode == 1)||($winmode == 6)){//程序故障、全部死亡、GM中止，不需要记录优胜者资料
		$gstime = $starttime;
		$getime = $time;
		$gtime = $time - $starttime;
		$result = $db->query("SELECT name,killnum FROM {$tablepre}players WHERE type=0 order by killnum desc, lvl desc limit 1");
		$hk = $db->fetch_array($result);
		$hkill = $hk['killnum'];
		$hkp = $hk['name'];
		$db->query("INSERT INTO {$gtablepre}winners (gid,wmode,vnum,gtime,gstime,getime,hdmg,hdp,hkill,hkp) VALUES ('$gamenum','$winmode','$validnum','$gtime','$gstime','$getime','$hdamage','$hplayer','$hkill','$hkp')");
	} else {//最后幸存、锁定解除、核爆全灭，需要记录优胜者资料
		$result = $db->query("SELECT * FROM {$tablepre}players WHERE name='$winner' AND type=0");
		$pdata = $db->fetch_array($result);
		//锁定解除、幻境解离结局，检查是否为队伍获胜……
		if(($winmode == 3 || $winmode == 7) && !empty($pdata['teamID']))
		{
			$team = $pdata['teamID']; $team_mates = Array($pdata['name']); $team_ips = Array($pdata['ip']);
			$tresult = $db->query("SELECT name,ip FROM {$tablepre}players WHERE teamID='$team' AND type=0");
			if($db->num_rows($tresult) > 1)
			{
				while($tpdata = $db->fetch_array($tresult))
				{
					if(!in_array($tpdata['name'],$team_mates) && !in_array($tpdata['ip'],$team_ips))
					{
						$team_mates[] = $tpdata['name'];
						$team_ips[] = $tpdata['ip'];
						//队伍获胜时 同队玩家也可以获得对应结局成就
						include_once GAME_ROOT.'./include/meta/achievement.func.php';
						check_end_achievement_rev($tpdata['name'],$winmode);
					}
				}
			}
		}
		$result2 = $db->query("SELECT motto FROM {$gtablepre}users WHERE username='$winner'");
		$pdata['motto'] = $db->result($result2, 0);
		$result3 = $db->query("SELECT name,killnum FROM {$tablepre}players WHERE type=0 order by killnum desc, lvl desc limit 1");
		$hk = $db->fetch_array($result3);
		$pdata['hkill'] = $hk['killnum'];
		$pdata['hkp'] = $hk['name'];
		$pdata['wmode'] = $winmode;
		$pdata['vnum'] = $validnum;
		$pdata['gtime'] = $time - $starttime;
		$pdata['gstime'] = $starttime;
		$pdata['getime'] = $time;
		$pdata['hdmg'] = $hdamage;
		$pdata['hdp'] = $hplayer;
		$pdata['teamMate'] = !empty($team_mates) && count($team_mates)>1 ? implode("+",$team_mates) : '';
		//$pdata['teamIcon'] = !empty($team_mates) ? 1 : 0;
		$db->query("INSERT INTO {$gtablepre}winners (gid,nick,name,pass,type,endtime,gd,sNo,icon,club,hp,mhp,sp,msp,ss,mss,att,def,pls,lvl,`exp`,money,bid,inf,rage,pose,tactic,killnum,killnum2,state,wp,wk,wg,wc,wd,wf,teamID,teamPass,teamMate,teamIcon,wep,wepk,wepe,weps,arb,arbk,arbe,arbs,arh,arhk,arhe,arhs,ara,arak,arae,aras,arf,arfk,arfe,arfs,art,artk,arte,arts,itm0,itmk0,itme0,itms0,itm1,itmk1,itme1,itms1,itm2,itmk2,itme2,itms2,itm3,itmk3,itme3,itms3,itm4,itmk4,itme4,itms4,itm5,itmk5,itme5,itms5,itm6,itmk6,itme6,itms6,motto,wmode,vnum,gtime,gstime,getime,hdmg,hdp,hkill,hkp,wepsk,arbsk,arhsk,arask,arfsk,artsk,itmsk0,itmsk1,itmsk2,itmsk3,itmsk4,itmsk5,itmsk6) VALUES ('".$gamenum."','".$pdata['nick']."','".$pdata['name']."','".$pdata['pass']."','".$pdata['type']."','".$pdata['endtime']."','".$pdata['gd']."','".$pdata['sNo']."','".$pdata['icon']."','".$pdata['club']."','".$pdata['hp']."','".$pdata['mhp']."','".$pdata['sp']."','".$pdata['msp']."','".$pdata['ss']."','".$pdata['mss']."','".$pdata['att']."','".$pdata['def']."','".$pdata['pls']."','".$pdata['lvl']."','".$pdata['exp']."','".$pdata['money']."','".$pdata['bid']."','".$pdata['inf']."','".$pdata['rage']."','".$pdata['pose']."','".$pdata['tactic']."','".$pdata['killnum']."','".$pdata['killnum2']."','".$pdata['state']."','".$pdata['wp']."','".$pdata['wk']."','".$pdata['wg']."','".$pdata['wc']."','".$pdata['wd']."','".$pdata['wf']."','".$pdata['teamID']."','".$pdata['teamPass']."','".$pdata['teamMate']."','".$pdata['teamIcon']."','".$pdata['wep']."','".$pdata['wepk']."','".$pdata['wepe']."','".$pdata['weps']."','".$pdata['arb']."','".$pdata['arbk']."','".$pdata['arbe']."','".$pdata['arbs']."','".$pdata['arh']."','".$pdata['arhk']."','".$pdata['arhe']."','".$pdata['arhs']."','".$pdata['ara']."','".$pdata['arak']."','".$pdata['arae']."','".$pdata['aras']."','".$pdata['arf']."','".$pdata['arfk']."','".$pdata['arfe']."','".$pdata['arfs']."','".$pdata['art']."','".$pdata['artk']."','".$pdata['arte']."','".$pdata['arts']."','".$pdata['itm0']."','".$pdata['itmk0']."','".$pdata['itme0']."','".$pdata['itms0']."','".$pdata['itm1']."','".$pdata['itmk1']."','".$pdata['itme1']."','".$pdata['itms1']."','".$pdata['itm2']."','".$pdata['itmk2']."','".$pdata['itme2']."','".$pdata['itms2']."','".$pdata['itm3']."','".$pdata['itmk3']."','".$pdata['itme3']."','".$pdata['itms3']."','".$pdata['itm4']."','".$pdata['itmk4']."','".$pdata['itme4']."','".$pdata['itms4']."','".$pdata['itm5']."','".$pdata['itmk5']."','".$pdata['itme5']."','".$pdata['itms5']."','".$pdata['itm6']."','".$pdata['itmk6']."','".$pdata['itme6']."','".$pdata['itms6']."','".$pdata['motto']."','".$pdata['wmode']."','".$pdata['vnum']."','".$pdata['gtime']."','".$pdata['gstime']."','".$pdata['getime']."','".$pdata['hdmg']."','".$pdata['hdp']."','".$pdata['hkill']."','".$pdata['hkp']."','".$pdata['wepsk']."','".$pdata['arbsk']."','".$pdata['arhsk']."','".$pdata['arask']."','".$pdata['arfsk']."','".$pdata['artsk']."','".$pdata['itmsk0']."','".$pdata['itmsk1']."','".$pdata['itmsk2']."','".$pdata['itmsk3']."','".$pdata['itmsk4']."','".$pdata['itmsk5']."','".$pdata['itmsk6']."')");
	}

	//存在获胜者数据时 检查获胜者结局成就
	if(!empty($pdata))
	{
		include_once GAME_ROOT.'./include/meta/achievement.func.php';
		check_end_achievement_rev($winner,$winmode,$pdata);
	}

	rs_sttime();//重置游戏开始时间和当前游戏状态
	$gamestate = 0;
	save_gameinfo();//先保存一次免得后面的处理过程太长，尽可能避免脏数据
	//echo '**游戏结束**';
	//$gamestate = 0;
	//addnews($time, "end$winmode" , $winner);
	addnews($time, "end$winmode",$winner);
	//addnews($time, 'gameover',$gamenum);
	if($groomid)
	{
		addnews($time, 'roomgameover' ,$gamenum, $groomid);
	}
	else
	{
		addnews($time, 'gameover' ,$gamenum);
	}
	systemputchat($time,'gameover');
	include_once './include/gamectl/news.func.php';
	$newsinfo = nparse_news(0,65535);
	writeover(GAME_ROOT."./gamedata/bak/{$gamenum}_newsinfo.html",$newsinfo,'wb+');
	//writeover(GAME_ROOT."./gamedata/bak/{$gamenum}_newsinfo.php",readover(GAME_ROOT.'./gamedata/newsinfo.php'),'wb+');
	//rs_sttime();
	//save_gameinfo();
	set_credits();
	save_gameinfo();//set_credits()里也有修改$gamevars的需求，再存一次，反正就一条记录读写不可能高并发
	return;
}

function movehtm($atime = 0) {
	// 已重构为由 deatharea.func.php 中的 get_areainfo_html() 统一处理
	// Refactored: delegates to get_areainfo_html() in deatharea.func.php
	return get_areainfo_html();
}


?>
