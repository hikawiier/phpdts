<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 积分结算与赌局系统 / Credits settlement and gambling system
include_once GAME_ROOT.'./include/meta/credits.func.php';

// ===== RuleSet 钩子函数桩 / RuleSet hook function stubs =====
// 这些桩函数在无 RuleSet 时提供安全的默认行为，避免 function_exists() 运行时检测。
// 若 RuleSet 已定义同名函数（通过 ruleset_override.func.php 提前加载），则桩函数不会被定义。
// These stubs provide safe defaults when no RuleSet is active, eliminating runtime function_exists() checks.
// If a RuleSet has already defined these functions (loaded earlier via ruleset_override.func.php), the stubs are skipped.

if (!function_exists('ruleset_randomize_npc_stats')) {
	function ruleset_randomize_npc_stats(&$npc) {}
}
if (!function_exists('ruleset_should_randomize_npc')) {
	function ruleset_should_randomize_npc($npc_pls) { return false; }
}
if (!function_exists('ruleset_get_random_npc_location')) {
	function ruleset_get_random_npc_location($plsnum) { return 0; }
}
if (!function_exists('ruleset_should_randomize_item')) {
	function ruleset_should_randomize_item($imap, $iarea, $an) { return false; }
}

/**
 * 游戏数据重置 / Game data reset
 *
 * 使用位掩码模式控制重置粒度，可组合使用：
 * - 1 (RS_FLAG_RESET): 重置社交数据、聊天记录、战斗信息、游戏剧情
 * - 2 (RS_FLAG_AREA): 初始化禁区列表、天气、Hack计数
 * - 4 (RS_FLAG_PLAYERS): 重建玩家数据表
 * - 8 (RS_FLAG_NPC): 初始化NPC角色（含位置随机化、技能、RuleSet钩子）
 * - 16 (RS_FLAG_MAPITEM): 初始化地图道具、陷阱、仓库道具
 * - 32 (RS_FLAG_SHOP): 初始化商店物品
 *
 * @param int $mode 位掩码标志，控制重置哪些子系统
 * @return void
 * @since 1.0
 */
function rs_game($mode = 0) {
	$mode = (int) $mode;
	if ($mode & 1)  rs_reset_social();
	if ($mode & 2)  rs_init_areas();
	if ($mode & 4)  rs_init_players();
	if ($mode & 8)  { if (rs_init_npcs() === false) return; }
	if ($mode & 16) rs_init_mapitems();
	if ($mode & 32) rs_init_shops();
	// Oblivions 模式初始化已迁移至 obl_rs_game()（init.func.php），
	// 由 gamestate.func.php 在 Oblivions 模式下直接调用，不再走 rs_game()
}

/**
 * 通过reset.sql 重置log,chat,mapitem,maptrap,newsinfo,gambling,itemdepot数据表
 *
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global int $hdamage 上次伤害
 * @global string $hplayer 上次攻击者
 * @global int $noisetime 噪音时间
 * @global int $noisepls 噪音位置
 * @global int $noiseid 噪音ID
 * @global int $noiseid2 噪音ID2
 * @global string $noisemode 噪音模式
 * @global int $afktime 反挂机时间
 * @global int $starttime 游戏开始时间
 * @global int $combonum 连斗计数
 * @global int $deathlimit 死亡限制
 * @global array $gamevars 游戏变量
 * @return void
 * @since 1.0
 */
function rs_reset_social() {
	global $db, $tablepre, $hdamage, $hplayer, $noisetime, $noisepls, $noiseid, $noiseid2, $noisemode;
	global $afktime, $starttime, $combonum, $deathlimit, $gamevars;
	$sqldir = GAME_ROOT.'./gamedata/sql/';

	$sql = file_get_contents("{$sqldir}reset.sql");
	$sql = str_replace("\r", "\n", str_replace(' bra_', ' '.$tablepre, $sql));
	$db->queries($sql);

	//清空战斗信息
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

/**
 * 初始化禁区列表、天气、Hack计数 / Initialize death areas, weather, hack count
 *
 * @global int $starttime 游戏开始时间
 * @global int $areahour 禁区间隔（分钟）
 * @global int $areatime 下次禁区时间
 * @global array $plsinfo 地图位置信息
 * @global array $arealist 禁区列表
 * @global int $areanum 当前禁区数
 * @global int $weather 天气
 * @global array $rswtharr 天气配置
 * @global int $hack Hack计数
 * @return void
 * @since 1.0
 */
function rs_init_areas() {
	global $starttime, $areahour, $areatime, $plsinfo, $arealist, $areanum, $weather, $rswtharr, $hack;

	// OBLIVIONS 模式：不初始化禁区系统
	if (oblivions_is_active()) {
		$arealist = array(0);
		$areanum = 0;
		$areatime = 0;
		$weather = $rswtharr[array_rand($rswtharr)];
		$hack = 0;
		return;
	}

	list($sec,$min,$hour,$day,$month,$year,$wday,$yday,$isdst) = localtime($starttime);
	$areatime = (ceil(($starttime + $areahour*60)/600))*600;
	$plsnum = sizeof($plsinfo);
	$arealist = range(1,$plsnum-1);
	shuffle($arealist);
	array_unshift($arealist,0);
	$areanum = 0;
	$weather = $rswtharr[array_rand($rswtharr)];
	$hack = 0;
	movehtm($areatime);
}

/**
 * 重建玩家数据表 / Rebuild players table
 *
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global int $validnum 有效玩家数
 * @global int $alivenum 存活玩家数
 * @global int $deathnum 死亡玩家数
 * @return void
 * @since 1.0
 */
function rs_init_players() {
	global $db, $tablepre, $validnum, $alivenum, $deathnum;
	$sqldir = GAME_ROOT.'./gamedata/sql/';
	$sql = file_get_contents("{$sqldir}players.sql");
	$sql = str_replace("\r", "\n", str_replace(' bra_', ' '.$tablepre, $sql));
	$db->queries($sql);
	$validnum = $alivenum = $deathnum = 0;
}

/**
 * 初始化NPC角色 / Initialize NPC characters
 *
 * 含位置随机化、技能初始化、RuleSet钩子、批量INSERT。
 *
 * @global array $plsinfo 地图位置信息
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global string $gamecfg 游戏配置文件名
 * @global int $now 当前时间戳
 * @global array $hidding_typelist 隐藏NPC类型列表
 * @global array $danger_areas 危险区域列表
 * @return bool|void false表示跳过（plsinfo为空），成功无返回值
 * @since 1.0
 */
function rs_init_npcs() {
	global $plsinfo, $db, $tablepre, $gamecfg, $now, $hidding_typelist, $danger_areas;
	if (empty($plsinfo)) {
		app_log("rs_init_npcs(): \$plsinfo is empty, skipping NPC initialization.", 'WARNING');
		return false;
	}
	$db->query("DELETE FROM {$tablepre}players WHERE type>0 ");
	include_once config('npc',$gamecfg);
	include_once GAME_ROOT."./include/pregame/clubslct.func.php";
	$plsnum = sizeof($plsinfo);

	$npc_batch = array();

	foreach ($npcinfo as $i => $npcs){
		if(!empty($npcs)) {
			if (sizeof($npcs['sub'])>$npcs['num'])shuffle($npcs['sub']);
			for($j = 1; $j <= $npcs['num']; $j++) {
				$npc = array_merge($npcinit,$npcs);
				$npc['type'] = $i;
				$npc['endtime'] = $now;
				$npc['sNo'] = $j;

				if(isset($npc['sub']) && is_array($npc['sub']) && !empty($npc['sub'])) {
					$subnum = sizeof($npc['sub']);
					$sub = $j % $subnum;
					if(isset($npc['sub'][$sub]) && is_array($npc['sub'][$sub])) {
						$npc = array_merge($npc,$npc['sub'][$sub]);
					} else {
						app_log("Warning: NPC type {$i} sub[{$sub}] is null or not array. Using base NPC data.", 'WARNING');
					}
				} else {
					app_log("Warning: NPC type {$i} has no valid 'sub' array. Using base NPC data.", 'WARNING');
				}
				$npc['hp'] = $npc['mhp'];
				$npc['sp'] = $npc['msp'];
				$npc['exp'] = round(2*$npc['lvl']*$GLOBALS['baseexp']);
				foreach(Array('p','k','g','c','d','f') as $val){
					if(!$npc['w'.$val]){
						$npc['w'.$val] = $npc['skill'];
					}
				}
				if($npc['gd'] == 'r'){$npc['gd'] = rand(0,1) ? 'm':'f';}

				# NPC称号技能初始化
				if(!empty($npc['club'])) changeclub($npc['club'],$npc);
				# NPC自定义技能初始化
				if(!empty($npc['clubskill']) || !empty($npc['clubskillpara'])) customtclubskill($npc);
				# RuleSet钩子：随机化NPC数值
				ruleset_randomize_npc_stats($npc);

				# 初始化NPC所在位置
				if(ruleset_should_randomize_npc($npc['pls']))
				{
					$npc['pls'] = ruleset_get_random_npc_location($plsnum);
				}
				else
				{
					if(is_array($npc['pls'])) $npc['pls'] = $npc['pls'][array_rand($npc['pls'])];
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
				$npc_batch[] = $npc;
				unset($npc);
			}
		}
	}
	if (!empty($npc_batch)) {
		$db->array_insert("{$tablepre}players", $npc_batch);
	}
	unset($npc_batch);
}

/**
 * 初始化地图道具、陷阱、仓库道具 / Initialize map items, traps, depot items
 *
 * @global array $plsinfo 地图位置信息
 * @global string $gamecfg 游戏配置文件名
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global int $areanum 当前禁区数
 * @global int $areaadd 每次增加的禁区数
 * @return void
 * @since 1.0
 */
function rs_init_mapitems() {
	global $plsinfo, $gamecfg, $db, $tablepre, $areanum, $areaadd;
	$plsnum = sizeof($plsinfo);
	$iqry = $tqry = '';
	$file = config('mapitem',$gamecfg);
	$fp = @fopen($file, 'r');
	if ($fp) {
		fgets($fp);
		$an = $areanum ? ceil($areanum/$areaadd) : 0;
		while (($line = fgets($fp)) !== false) {
			$line = rtrim($line, "\r\n");
			if (empty($line)) continue;
			$json_start = strpos($line, '{');
			$json_end = strrpos($line, '}');
			$json_content = '';

			if($json_start !== false && $json_end !== false && $json_end > $json_start) {
				$json_content = substr($line, $json_start, $json_end - $json_start + 1);
				$line = substr($line, 0, $json_start) . 'JSON_PLACEHOLDER';
			}

			$item_parts = explode(',', $line);
			$item_parts = array_pad($item_parts, 9, '');

			$itmpara = '';
			if(count($item_parts) >= 9) {
				$itmpara = $item_parts[8];
				if($itmpara === 'JSON_PLACEHOLDER') {
					$itmpara = $json_content;
				}
			}

			list($iarea,$imap,$inum,$iname,$ikind,$ieff,$ista,$iskind) = array_slice($item_parts, 0, 8);

			if(($iarea == $an)||($iarea == 99)) {
				$iname = $db->escape_string($iname);
				$ikind = $db->escape_string($ikind);
				$ieff = $db->escape_string($ieff);
				$ista = $db->escape_string($ista);
				$iskind = $db->escape_string($iskind);
				$itmpara = $db->escape_string($itmpara);
				for($j = $inum; $j>0; $j--) {
					$force_random = ruleset_should_randomize_item($imap, $iarea, $an);

					if($imap == 99 || $force_random) {
						$rmap = rand(1,$plsnum-1);
						while (is_event_area($rmap)){$rmap = rand(1,$plsnum-1);}
						if(strpos($ikind ,'TO')===0){
							$tqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$rmap','$itmpara'),";
						}else{
							$iqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$rmap','$itmpara'),";
						}
					}else{
						if(strpos($ikind ,'TO')===0){
							$tqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$imap','$itmpara'),";
						}else{
							$iqry .= "('$iname', '$ikind','$ieff','$ista','$iskind','$imap','$itmpara'),";
						}
					}
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

	unset($iqry);
	fclose($fp);
	//挤一挤 仓库道具初始化
	include_once GAME_ROOT.'./include/game/depot.func.php';
	if(isset($npc_depot) && count($npc_depot)>0)
	{
		foreach($npc_depot as $nd_num => $nd_arr)
		{
			foreach($nd_arr['itm'] as $nd_itm_arr)
			{
				$ditm = $db->escape_string($nd_itm_arr['itm']);
				$ditmk = $db->escape_string($nd_itm_arr['itmk']);
				$ditmsk = $db->escape_string($nd_itm_arr['itmsk']);
				$ditmpara = $db->escape_string($nd_itm_arr['itmpara']);
				$ditme = $nd_itm_arr['itme'];$ditms = $nd_itm_arr['itms'];
				$dname = $db->escape_string($nd_arr['name']);
				$dtype = $db->escape_string($nd_arr['type']);
				$db->query("INSERT INTO {$tablepre}itemdepot (itm, itmk, itme, itms, itmsk , itmpara, itmowner, itmpw) VALUES ('$ditm', '$ditmk', '$ditme', '$ditms', '$ditmsk', '$ditmpara', '$dname', '$dtype')");
			}
		}
	}
}

/**
 * 初始化商店物品 / Initialize shop items
 *
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global string $gamecfg 游戏配置文件名
 * @return void
 * @since 1.0
 */
function rs_init_shops() {
	global $db, $tablepre, $gamecfg;
	$sqldir = GAME_ROOT.'./gamedata/sql/';
	$sql = file_get_contents("{$sqldir}shopitem.sql");
	$sql = str_replace("\r", "\n", str_replace(' bra_', ' '.$tablepre, $sql));
	$db->queries($sql);

	$file = config('shopitem',$gamecfg);
	$fp = @fopen($file, 'r');
	$qry = '';
	if ($fp) {
		while (($line = fgets($fp)) !== false) {
			$line = rtrim($line, "\r\n");
			if (empty($line)) continue;
			$json_start = strpos($line, '{');
			$json_end = strrpos($line, '}');
			$json_content = '';

			if($json_start !== false && $json_end !== false && $json_end > $json_start) {
				$json_content = substr($line, $json_start, $json_end - $json_start + 1);
				$line = substr($line, 0, $json_start) . 'JSON_PLACEHOLDER';
			}

			$lst = explode(',', $line);
			$lst = array_pad($lst, 10, '');

			$itmpara = '';
			if(count($lst) >= 10) {
				$itmpara = $lst[9];
				if($itmpara === 'JSON_PLACEHOLDER') {
					$itmpara = $json_content;
				}
			}
			list($kind,$num,$price,$area,$item,$itmk,$itme,$itms,$itmsk)=$lst;
			if($kind != 0){
				$kind = $db->escape_string($kind);
				$area = $db->escape_string($area);
				$item = $db->escape_string($item);
				$itmk = $db->escape_string($itmk);
				$itms = $db->escape_string($itms);
				$itmsk = $db->escape_string($itmsk);
				$itmpara = $db->escape_string($itmpara);
				$qry .= "('$kind','$num','$price','$area','$item','$itmk','$itme','$itms','$itmsk','$itmpara'),";
			}
		}
		fclose($fp);
	}
	if(!empty($qry)){
		$qry = "INSERT INTO {$tablepre}shopitem (kind,num,price,area,item,itmk,itme,itms,itmsk,itmpara) VALUES ".substr($qry, 0, -1);
	}
	$db->query($qry);
}

/**
 * 计算下一局游戏开始时间 / Calculate next game start time
 *
 * 根据 $startmode 配置决定下局开始时间：
 * - 1: 固定时间（每天 $starthour:$startmin）
 * - 2: 间隔小时数
 * - 3: 间隔分钟数
 *
 * @global int $starttime 计算结果（输出）
 * @global int $now 当前时间戳
 * @global int $startmode 开始时间模式
 * @global int $starthour 开始小时/间隔
 * @global int $startmin 开始分钟
 * @return void
 * @since 1.0
 */
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
		if($nextmin % 60 == 0){
			$nextmin +=1;
		}
		$starttime = mktime($nexthour,$nextmin,0,$month,$day,$year);
	} else {
		$starttime = 0;
	}

	return;
}


/**
 * 推进禁区并淘汰玩家 / Advance death areas and eliminate players in them
 *
 * 每次禁区时间到达时调用，负责：
 * - 增加禁区数量，推进禁区列表
 * - 淘汰位于禁区内的玩家（或强制迁移）
 * - 迁移不在禁区内的NPC
 * - 更新天气、Hack计数、信道
 * - 触发 gameover 当满足结束条件时
 *
 * @param int $atime 禁区到期时间戳
 * @global object $db 数据库连接
 * @global int $gamestate 游戏状态
 * @global int $areanum 当前禁区数量
 * @global int $arealimit 禁区数量上限
 * @global int $areaadd 每次增加的禁区数
 * @global array $arealist 禁区顺序列表
 * @global int $areaesc 是否允许逃脱禁区
 * @global array $plsinfo 地图位置信息
 * @global int $weather 天气值
 * @global int $hack Hack计数器
 * @global int $validnum 有效参赛人数
 * @global int $alivenum 存活人数
 * @global int $deathnum 死亡人数
 * @global array $gamevars 游戏变量
 * @global array $danger_areas 危险区域列表
 * @global array $sentinel_typelist 哨兵NPC类型（不迁移）
 * @global bool $npc_away_from_danger_areas NPC是否远离危险区域
 * @return int|null 在特定条件下返回 $atime，否则返回 void
 * @since 1.0
 */
function add_once_area($atime) {
	//实际上GAMEOVER的判断是在common.inc.php里
	global $db,$gtablepre,$tablepre,$now,$gamestate,$areaesc,$arealist,$areanum,$arealimit,$areaadd,$plsinfo,$weather,$hack,$validnum,$alivenum,$deathnum;
	global $gamevars;

	if (($gamestate > 10)&&($now > $atime)) {
		$plsnum = sizeof($plsinfo) - 1;
		if(($areanum >= $arealimit*$areaadd)&&($validnum<=0)) {
			gameover($atime,'end4');
			return;
		} elseif(($areanum + $areaadd) >= $plsnum) {
			$areaaddlist = get_next_death_areas(0, false);
			$areanum = $plsnum;
			if($weather <= 9) $weather = rand(0,9);
			addnews($atime, 'addarea',$areaaddlist,$weather);
			storyputchat($now,'areaadd');
			systemputchat($atime,'areaadd',$areaaddlist);
			$db->query("UPDATE {$tablepre}players SET hp=0, bid=0, state=11, endtime='$atime' WHERE type=0 AND hp>0");
			$query = $db->query("SELECT name,type,pls FROM {$tablepre}players WHERE type=0 AND hp<=0");
			while($sub = $db->fetch_array($query)) {
				addnews($atime,'death11',$sub['name'],$sub['type'],$sub['pls']);
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
			if(isset($gamevars['apis']) && isset($gamevars['api']) && $gamevars['api'] < $gamevars['apis']) $gamevars['api']++;
			$areaaddlist = get_next_death_areas();
			$areanum += $areaadd;
			movehtm();
			addnews($atime, 'addarea',$areaaddlist,$weather);
			storyputchat($now,'areaadd');
			systemputchat($atime,'areaadd',$areaaddlist);
			$str_arealist = implode(',',get_death_areas());
			if (empty($str_arealist)) {
				return;
			}
			process_death_area_players($atime, $str_arealist, $plsnum);
			return check_post_area_gameover($atime);
		}
	} else {
		return;
	}
}

/**
 * 处理禁区内的玩家淘汰与NPC迁移 / Process player elimination & NPC migration in death areas
 *
 * 查询禁区内的所有存活角色，对玩家执行淘汰/逃脱判定，对NPC执行迁移，
 * 通过批量 UPDATE 一次性写入数据库。
 *
 * @param int $atime 禁区触发时间
 * @param string $str_arealist 禁区列表（逗号分隔）
 * @param int $plsnum 地图位置总数
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global int $gamestate 游戏状态
 * @global int $areanum 当前禁区数
 * @global bool $areaesc 是否允许逃脱
 * @global array $arealist 区域列表
 * @global int $deathnum 死亡计数（输出）
 * @global array $danger_areas 危险区域
 * @global array $sentinel_typelist 哨兵NPC类型
 * @global bool $npc_away_from_danger_areas NPC远离危险区
 * @return void
 * @since 1.0
 */
function process_death_area_players($atime, $str_arealist, $plsnum) {
	global $db, $tablepre, $gamestate, $areanum, $areaesc, $arealist, $deathnum;
	global $danger_areas, $sentinel_typelist, $npc_away_from_danger_areas;

	$query = $db->query("SELECT * FROM {$tablepre}players WHERE pls IN ($str_arealist) AND hp>0");
	$death_pids = array();
	$migrate_map = array();
	$news_items = array();

	while($sub = $db->fetch_array($query)) {
		$pid = $sub['pid'];
		if(!$sub['type']) {
			if(($gamestate >= 40)||(!$areaesc&&($sub['tactic']!=4))) {
				$death_pids[] = $pid;
				$news_items[] = array(
					'time' => $atime,
					'state' => 11,
					'name' => $sub['name'],
					'type' => $sub['type'],
					'pls' => $sub['pls']
				);
				$deathnum++;
			} else {
				do{$pls = $arealist[rand($areanum+1,$plsnum)];}while (is_event_area($pls));
				$migrate_map[$pid] = $pls;
			}
		}elseif(!in_array($sub['type'],$sentinel_typelist) && $gamestate <= 40){
			if($npc_away_from_danger_areas)
			{
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
			$migrate_map[$pid] = $pls;
		}
	}

	if (!empty($death_pids)) {
		$pid_list = implode(',', $death_pids);
		$db->query("UPDATE {$tablepre}players SET hp=0, bid=0, state=11, endtime='$atime' WHERE pid IN ($pid_list)");
	}
	if (!empty($migrate_map)) {
		$cases = '';
		$pids = array();
		foreach ($migrate_map as $pid => $pls) {
			$cases .= " WHEN $pid THEN $pls";
			$pids[] = $pid;
		}
		$pid_list = implode(',', $pids);
		$db->query("UPDATE {$tablepre}players SET pls = CASE pid$cases END WHERE pid IN ($pid_list)");
	}
	foreach ($news_items as $news) {
		addnews($news['time'], 'death'.$news['state'], $news['name'], $news['type'], $news['pls']);
	}
}

/**
 * 禁区推进后检查游戏结束条件 / Check gameover conditions after area advance
 *
 * 统计存活玩家数，判断是否触发游戏结束。
 *
 * @param int $atime 当前时间
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global int $gamestate 游戏状态
 * @global int $alivenum 存活玩家数（输出）
 * @return int|null 特定条件下返回 $atime，否则返回 void
 * @since 1.0
 */
function check_post_area_gameover($atime) {
	global $db, $tablepre, $gamestate, $alivenum;
	$alivenum = $db->result($db->query("SELECT COUNT(*) FROM {$tablepre}players WHERE hp>0 AND type=0"), 0);
	if(($alivenum == 1)&&($gamestate >= 30)) {
		gameover($atime);
		return;
	} elseif(($alivenum <= 0)&&($gamestate >= 30)) {
		gameover($atime,'end1');
		return $atime;
	} else {
		rs_game(16+32);
		return;
	}
}

/**
 * 发出禁区预警 / Issue death area warning
 *
 * 在禁区即将变更时通知所有玩家，设置 $areawarn 标志并发送聊天消息。
 *
 * @global int $now 当前时间戳
 * @global array $arealist 禁区顺序列表
 * @global int $areanum 当前禁区数量
 * @global int $areaadd 每次增加的禁区数
 * @global int $areawarn 预警标志（输出）
 * @return void
 * @since 1.0
 */
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
/**
 * 游戏结束结算 / Game over settlement
 *
 * 负责一局游戏结束时的完整结算流程：
 * - 压缩归档游戏日志（gzip）
 * - 判断获胜模式并记录优胜者
 * - 处理队伍获胜（winmode 3/7）
 * - 写入优胜记录到 winners 表（含事务保护）
 * - 检查结局成就
 * - 重置游戏状态、计算下一局开始时间
 * - 生成新闻并归档HTML
 * - 结算积分
 *
 * @param int $time 游戏结束时间戳，默认0使用当前时间
 * @param string $mode 结束模式，格式 'endN'（N=0-6），空字符串则自动判断
 * @param string $winname 获胜者名称，仅在 $mode 指定时有效
 * @global int $gamestate 游戏状态
 * @global int $winmode 获胜模式（输出）
 * @global int $alivenum 存活人数
 * @global string $winner 获胜者名称（输出）
 * @global int $now 当前时间戳
 * @global int $gamenum 游戏局数
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global string $gtablepre 全局表前缀
 * @global int $starttime 游戏开始时间
 * @global int $validnum 有效参赛人数
 * @global int $hdamage 最高伤害
 * @global string $hplayer 最高伤害者
 * @global int $groomid 房间ID
 * @return void
 * @since 1.0
 */
function gameover($time = 0, $mode = '', $winname = '') {
	global $gamestate, $winmode, $alivenum, $winner, $now, $gamenum, $gtablepre, $tablepre, $starttime, $validnum, $hdamage, $hplayer;
	global $groomid;
	// 日志压缩改为异步：记录到队列，在下一局 rs_game(1) 中处理
	queue_compress_target($gamenum);
	if($gamestate < 10){return;}

	$winmode = null;
	determine_winmode_and_winner($mode, $winname);
	// auto-detect 发现不满足游戏结束条件时，determine_winmode_and_winner 内部已 save_gameinfo 并返回
	if ($winmode === null) return;
	$time = $time ? $time : $now;
	$pdata = record_game_winner($time, $winmode, $winner);
	finalize_gameover($time, $winmode, $winner, $pdata);
}

/**
 * 判断游戏结束模式与获胜者 / Determine win mode and winner
 *
 * 若未提供结束模式，则根据存活人数自动判断（无人参加/全部死亡/最后幸存）。
 *
 * @param string $mode 结束模式（'endN'格式），空字符串则自动判断
 * @param string $winname 获胜者名称（仅在 $mode 指定时有效）
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global int $validnum 有效参赛人数
 * @global int $alivenum 存活人数（输出）
 * @global int $winmode 获胜模式（输出）
 * @global string $winner 获胜者名称（输出）
 * @return void
 * @since 1.0
 */
function determine_winmode_and_winner($mode, $winname) {
	global $db, $tablepre, $validnum, $alivenum, $winmode, $winner;
	if((!$mode)||(($mode==2)&&(!$winname))) {
		if($validnum <= 0) {
			$alivenum = 0;
			$winmode = 4;
			$winner = '';
		} else {
			$result = $db->query("SELECT * FROM {$tablepre}players WHERE hp>0 AND type=0");
			$alivenum = $db->num_rows($result);
			if(!$alivenum) {
				$winmode = 1;
				$winner = '';
			} elseif($alivenum == 1) {
				$winmode = 2;
				$wdata = $db->fetch_array($result);
				$winner = $wdata['name'];
				$db->query("UPDATE {$tablepre}players SET state='5' where pid='{$wdata['pid']}'");
			} else {
				save_gameinfo();
				return;
			}
		}
	} else {
		$winmode = substr($mode,3,1);
		$winner = $winname;
	}
}

/**
 * 记录游戏优胜者到 winners 表 / Record winner to winners table
 *
 * 使用事务保护，确保 gamenum 检查和写入的原子性。
 * 根据 $winmode 不同，写入不同的字段集。
 *
 * @param int $time 游戏结束时间戳
 * @param int $winmode 获胜模式
 * @param string $winner 获胜者名称
 * @global object $db 数据库连接
 * @global string $tablepre 游戏表前缀
 * @global string $gtablepre 全局表前缀
 * @global int $gamenum 游戏局数
 * @global int $starttime 游戏开始时间
 * @global int $validnum 有效参赛人数
 * @global int $hdamage 最高伤害
 * @global string $hplayer 最高伤害者
 * @return array|null 获胜者数据数组，无人参加时返回 null
 * @since 1.0
 */
function record_game_winner($time, $winmode, $winner) {
	global $db, $gtablepre, $tablepre, $gamenum, $starttime, $validnum, $hdamage, $hplayer;
	$pdata = null;

	$db->query("START TRANSACTION");
	$result = $db->query("SELECT gid FROM {$gtablepre}winners ORDER BY gid DESC LIMIT 1");
	if($db->num_rows($result)&&($gamenum <= $db->result($result, 0))) {
		$gamenum = $db->result($result, 0) + 1;
	}
	if($winmode == 4){
		$getime = $time;
		$db->query("INSERT INTO {$gtablepre}winners (gid,wmode,vnum,getime) VALUES ('$gamenum','$winmode','$validnum','$getime')");
	}	elseif(($winmode == 0)||($winmode == 1)||($winmode == 6)){
		$gstime = $starttime;
		$getime = $time;
		$gtime = $time - $starttime;
		$result = $db->query("SELECT name,killnum FROM {$tablepre}players WHERE type=0 order by killnum desc, lvl desc limit 1");
		$hk = $db->fetch_array($result);
		$hkill = $hk['killnum'];
		$hkp = $hk['name'];
		$db->query("INSERT INTO {$gtablepre}winners (gid,wmode,vnum,gtime,gstime,getime,hdmg,hdp,hkill,hkp) VALUES ('$gamenum','$winmode','$validnum','$gtime','$gstime','$getime','$hdamage','$hplayer','$hkill','$hkp')");
	} else {
		$result = $db->query("SELECT * FROM {$tablepre}players WHERE name='$winner' AND type=0");
		$pdata = $db->fetch_array($result);
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
		$db->query("INSERT INTO {$gtablepre}winners (gid,nick,name,pass,type,endtime,gd,sNo,icon,club,hp,mhp,sp,msp,ss,mss,att,def,pls,lvl,`exp`,money,bid,inf,rage,pose,tactic,killnum,killnum2,state,wp,wk,wg,wc,wd,wf,teamID,teamPass,teamMate,teamIcon,wep,wepk,wepe,weps,arb,arbk,arbe,arbs,arh,arhk,arhe,arhs,ara,arak,arae,aras,arf,arfk,arfe,arfs,art,artk,arte,arts,itm0,itmk0,itme0,itms0,itm1,itmk1,itme1,itms1,itm2,itmk2,itme2,itms2,itm3,itmk3,itme3,itms3,itm4,itmk4,itme4,itms4,itm5,itmk5,itme5,itms5,itm6,itmk6,itme6,itms6,motto,wmode,vnum,gtime,gstime,getime,hdmg,hdp,hkill,hkp,wepsk,arbsk,arhsk,arask,arfsk,artsk,itmsk0,itmsk1,itmsk2,itmsk3,itmsk4,itmsk5,itmsk6) VALUES ('".$gamenum."','".$pdata['nick']."','".$pdata['name']."','".$pdata['pass']."','".$pdata['type']."','".$pdata['endtime']."','".$pdata['gd']."','".$pdata['sNo']."','".$pdata['icon']."','".$pdata['club']."','".$pdata['hp']."','".$pdata['mhp']."','".$pdata['sp']."','".$pdata['msp']."','".$pdata['ss']."','".$pdata['mss']."','".$pdata['att']."','".$pdata['def']."','".$pdata['pls']."','".$pdata['lvl']."','".$pdata['exp']."','".$pdata['money']."','".$pdata['bid']."','".$pdata['inf']."','".$pdata['rage']."','".$pdata['pose']."','".$pdata['tactic']."','".$pdata['killnum']."','".$pdata['killnum2']."','".$pdata['state']."','".$pdata['wp']."','".$pdata['wk']."','".$pdata['wg']."','".$pdata['wc']."','".$pdata['wd']."','".$pdata['wf']."','".$pdata['teamID']."','".$pdata['teamPass']."','".$pdata['teamMate']."','".$pdata['teamIcon']."','".$pdata['wep']."','".$pdata['wepk']."','".$pdata['wepe']."','".$pdata['weps']."','".$pdata['arb']."','".$pdata['arbk']."','".$pdata['arbe']."','".$pdata['arbs']."','".$pdata['arh']."','".$pdata['arhk']."','".$pdata['arhe']."','".$pdata['arhs']."','".$pdata['ara']."','".$pdata['arak']."','".$pdata['arae']."','".$pdata['aras']."','".$pdata['arf']."','".$pdata['arfk']."','".$pdata['arfe']."','".$pdata['arfs']."','".$pdata['art']."','".$pdata['artk']."','".$pdata['arte']."','".$pdata['arts']."','".$pdata['itm0']."','".$pdata['itmk0']."','".$pdata['itme0']."','".$pdata['itms0']."','".$pdata['itm1']."','".$pdata['itmk1']."','".$pdata['itme1']."','".$pdata['itms1']."','".$pdata['itm2']."','".$pdata['itmk2']."','".$pdata['itme2']."','".$pdata['itms2']."','".$pdata['itm3']."','".$pdata['itmk3']."','".$pdata['itme3']."','".$pdata['itms3']."','".$pdata['itm4']."','".$pdata['itmk4']."','".$pdata['itme4']."','".$pdata['itms4']."','".$pdata['itm5']."','".$pdata['itmk5']."','".$pdata['itme5']."','".$pdata['itms5']."','".$pdata['itm6']."','".$pdata['itmk6']."','".$pdata['itme6']."','".$pdata['itms6']."','".$pdata['motto']."','".$pdata['wmode']."','".$pdata['vnum']."','".$pdata['gtime']."','".$pdata['gstime']."','".$pdata['getime']."','".$pdata['hdmg']."','".$pdata['hdp']."','".$pdata['hkill']."','".$pdata['hkp']."','".$pdata['wepsk']."','".$pdata['arbsk']."','".$pdata['arhsk']."','".$pdata['arask']."','".$pdata['arfsk']."','".$pdata['artsk']."','".$pdata['itmsk0']."','".$pdata['itmsk1']."','".$pdata['itmsk2']."','".$pdata['itmsk3']."','".$pdata['itmsk4']."','".$pdata['itmsk5']."','".$pdata['itmsk6']."')");
	}
	$db->query("COMMIT");
	return $pdata;
}

/**
 * 完成游戏结束的后续处理 / Finalize game over: achievements, reset, news, credits
 *
 * 检查获胜者结局成就、重置游戏状态、生成新闻、归档HTML、结算积分。
 *
 * @param int $time 游戏结束时间戳
 * @param int $winmode 获胜模式
 * @param string $winner 获胜者名称
 * @param array|null $pdata 获胜者数据（可能为 null）
 * @global int $gamestate 游戏状态（输出）
 * @global int $gamenum 游戏局数
 * @global int $groomid 房间ID
 * @return void
 * @since 1.0
 */
function finalize_gameover($time, $winmode, $winner, $pdata) {
	global $gamestate, $gamenum, $groomid;

	if(!empty($pdata))
	{
		include_once GAME_ROOT.'./include/meta/achievement.func.php';
		check_end_achievement_rev($winner,$winmode,$pdata);
	}

	rs_sttime();
	$gamestate = 0;
	save_gameinfo();
	addnews($time, "end$winmode",$winner);
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
	set_credits();
	save_gameinfo();
	// 日志压缩放在结算阶段（而非下一局开始），因为此时玩家已离开，对载入时间不敏感
	process_compress_queue();
	return;
}

/**
 * 刷新禁区展示HTML / Refresh death area display HTML
 *
 * 已重构为由 deatharea.func.php 中的 get_areainfo_html() 统一处理。
 * Refactored: delegates to get_areainfo_html() in deatharea.func.php
 *
 * @param int $atime 禁区时间戳（当前版本未使用，保留兼容）
 * @return string 禁区信息HTML
 * @since 1.0
 */
function movehtm($atime = 0) {
	return get_areainfo_html();
}

/**
 * 将游戏局数加入压缩队列 / Append game number to compression queue
 *
 * 不在 gameover() 中直接压缩日志，而是写入队列文件，
 * 在下一局游戏开始时由 process_compress_queue() 统一处理。
 * Defer log compression to next game start instead of blocking gameover().
 *
 * @param int $gamenum 游戏局数
 * @return void
 * @since 1.0
 */
function queue_compress_target($gamenum) {
	$queue_file = GAME_ROOT . './gamedata/cache/compress_queue.php';
	if (!is_dir(dirname($queue_file))) {
		@mkdir(dirname($queue_file), 0777, true);
	}
	$line = $gamenum . "\n";
	writeover($queue_file, $line, 'ab+', 1, 0, 0);
}

/**
 * 处理压缩队列 / Process pending compression queue
 *
 * 读取队列文件，逐行压缩对应局数的日志文件，处理完成后清空队列。
 * 应在游戏重置时调用（rs_game(1)），避免阻塞 gameover()。
 * Called at game reset to avoid blocking gameover() with I/O.
 *
 * @return void
 * @since 1.0
 */
function process_compress_queue() {
	$queue_file = GAME_ROOT . './gamedata/cache/compress_queue.php';
	if (!file_exists($queue_file)) {
		return;
	}
	$content = readover($queue_file);
	if (empty($content)) {
		return;
	}
	// 清空队列文件（避免重复处理导致的问题先清，处理失败则重写）
	writeover($queue_file, '', 'wb+', 1, 0, 0);

	$lines = explode("\n", trim($content));
	$processed = array();
	foreach ($lines as $line) {
		$gamenum = intval(trim($line));
		if ($gamenum <= 0) continue;
		$filelist = glob(GAME_ROOT . "./records/$gamenum/**/*.txt");
		if (empty($filelist)) {
			// 没有需要压缩的文件，跳过
			continue;
		}
		foreach ($filelist as $file) {
			$input = @fopen($file, 'rb');
			if (!$input) continue;
			$output = @gzopen($file . '.gz', 'wb');
			if (!$output) { fclose($input); continue; }
			while (!feof($input)) {
				gzwrite($output, fread($input, 1024));
			}
			fclose($input);
			gzclose($output);
			@unlink($file);
		}
		$processed[] = $gamenum;
	}
	// 如果全部处理成功，队列已清空；否则重写未处理的条目
	$remaining = array_diff($lines, $processed);
	if (!empty($remaining)) {
		$retry = implode("\n", $remaining) . "\n";
		writeover($queue_file, $retry, 'ab+', 1, 0, 0);
	}
}


?>