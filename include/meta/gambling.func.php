<?php

if(!defined('IN_GAME')) {
	exit('Access Denied');
}

// 判定赌局结果 / Determine gambling result
function get_gambling_result($clist, $winner='',$winmode=''){
	global $db,$tablepre,$gtablepre,$hdamage,$validnum,$now,$areanum,$areaadd,$gamevars;
	$gblog = '';
	$bwlist = array();
	if(!in_array($winmode,Array(2,3,5,7))){// 无人获胜，全部赌注被冴冴吃掉 / No winner, all bets eaten
		$gblog .= '无人获胜，全部切糕被冴冴吃掉！';
		$updatelist = false;
	}else{
		$result = $db->query("SELECT * FROM {$tablepre}gambling WHERE 1");
		if(!$db->num_rows($result)){
			$gblog .= '无人下注！';
			$updatelist = false;
		}else{
			$bwlist = $updatelist = Array();
			$bpool = $bwsum = $bwsum2 = 0;
			while($bdata = $db->fetch_array($result)){
				if($bdata['bname'] == $winner){
					$bwlist[$bdata['uname']] = $bdata;
					$bwsum += $bdata['wager'];
					$bwsum2 += $bdata['wager'] * $bdata['odds'];
				}
				$bpool += $bdata['wager'];
			}

			$creditsum = $apmnum = 0;
			foreach($clist as $cdata){
				$creditsum += $cdata['credits'];
				$apm = $cdata['deathtime'] > $cdata['validtime'] ? $cdata['cmdnum'] / ($cdata['deathtime'] - $cdata['validtime']) : $cdata['cmdnum'] / ($now - $cdata['validtime']);
				if($apm >= 1){$apmnum ++;}
			}

			$avrcredit = $creditsum / ($validnum > 0 ? $validnum : 1);
			if($avrcredit > 10000){$creditodds = 1.25;}
			else{$creditodds = round((1 + $avrcredit / 40000)*1000)/1000;}
			$apmodds = round(pow(1.02,$apmnum)*1000)/1000;
			$timeodds = 1.2 - $areanum/$areaadd * 0.1;
			if($timeodds < 0.8){$timeodds = 0.8;}

			$obpool = $bpool;
			$bpool = round($bpool * $creditodds * $apmodds * $timeodds);
			$gblog = '奖池：'.$obpool.' * '.$creditodds.' * '.$apmodds.' * '.$timeodds.' = '.$bpool.'<br>';
			if($bwlist){
				$bnlist = array_keys($bwlist);
				$bnstr = "('".implode("','",$bnlist)."')";
				$result2 = $db->query("SELECT uid,username,credits2 FROM {$gtablepre}users WHERE username IN $bnstr");
				while($udata = $db->fetch_array($result2)){
					$bwlist[$udata['username']]['credits2'] = $udata['credits2'];
				}
				if($bwsum >= $bpool){
					$gblog .= '奖池少于本金，系统资助判断正确者取回本金。';
					foreach($bwlist as $key => $val){
						$bwlist[$val['uname']]['crup'] = 0;
						$bwlist[$val['uname']]['crrst'] = $val['wager'];
						$credits2 = $val['credits2'] + $val['wager'];
						$updatelist[$key] = Array('username' => $key, 'credits2' => $credits2);
					}
				}else{
					$ext = $bpool - $bwsum;
					foreach($bwlist as $key => $val){
						$crup = ceil($ext * 0.9 * $val['wager'] * $val['odds'] / $bwsum2);
						$bwlist[$val['uname']]['crup'] = $crup;
						$bwlist[$val['uname']]['crrst'] = $val['wager'] + $crup;
						$credits2 = $val['credits2'] + $val['wager'] + $crup;
						$updatelist[$key] = Array('username' => $key, 'credits2' => $credits2);
					}
					$wcrup = ceil($ext * 0.1);
					$bwlist[] = Array('uname' => '获胜者', 'wager' => '', 'bname' => '', 'odds' => '', 'crup' => $wcrup, 'crrst' => $wcrup);
					if(is_array($updatelist) && isset($updatelist[$winner]['credits2'])){
						$updatelist[$winner]['credits2'] += $wcrup;
					}else{
						$result3 = $db->query("SELECT uid,username,credits2 FROM {$gtablepre}users WHERE username='$winner'");
						$wdata = $db->fetch_array($result3);
						$updatelist[$winner] = Array('username' => $winner, 'credits2' => $wdata['credits2'] + $wcrup);
					}
				}
			}else{
				$gblog .= '无判断正确者，奖池的20%归获胜者。';
				$wcrup = ceil($bpool * 0.2);
				$bwlist[] = Array('uname' => '获胜者', 'wager' => '', 'bname' => '', 'odds' => '', 'crup' => $wcrup, 'crrst' => $wcrup);
				if(is_array($updatelist) && isset($updatelist[$winner]['credits2'])){
					$updatelist[$winner]['credits2'] += $wcrup;
				}else{
					$result3 = $db->query("SELECT uid,username,credits2 FROM {$gtablepre}users WHERE username='$winner'");
					$wdata = $db->fetch_array($result3);
					$updatelist[$winner] = Array('username' => $winner, 'credits2' => $wdata['credits2'] + $wcrup);
				}
			}
		}
	}
	// 上一轮赌局结果存入gamevars / Store last round gambling result in gamevars
	$gamevars['gblog'] = $gblog;
	$gamevars['bwlist'] = $bwlist;
	return $updatelist;
}

// 从数据库加载全部赌局记录 / Load all gambling records from DB
// 返回: [$gbingdata, $gbeddata, $gbpool, $gbnum]
function gambling_load_all_records(){
	global $db, $tablepre;
	$gbingdata = $gbeddata = array();
	$gbpool = 0;
	$result = $db->query("SELECT * FROM {$tablepre}gambling WHERE 1");
	$gbnum = $db->num_rows($result);
	if($gbnum){
		while($gbdata = $db->fetch_array($result)) {
			$gbingdata[$gbdata['bid']][$gbdata['uid']] = $gbdata;
			$gbeddata[$gbdata['uid']] = $gbdata;
			$gbpool += $gbdata['wager'];
		}
	}
	return array($gbingdata, $gbeddata, $gbpool, $gbnum);
}

// 为存活玩家数据填充赌局信息 / Populate gambling info for player data
function gambling_populate_player_info(&$player_data, $gbingdata, $gbnum){
	$player_data['gbnum'] = $gbnum && isset($gbingdata[$player_data['pid']]) ? count($gbingdata[$player_data['pid']]) : 0;
	$player_data['gbsum'] = 0;
	if($gbnum && isset($gbingdata[$player_data['pid']])){
		foreach($gbingdata[$player_data['pid']] as $gad){
			$player_data['gbsum'] += $gad['wager'];
		}
	}
}

// 获取玩家下注人数 / Get number of bets on a player
function gbnum($pdata){
	global $gbnum, $gbingdata;
	if($gbnum && isset($gbingdata[$pdata['pid']])){
		return count($gbingdata[$pdata['pid']]);
	}
	return 0;
}

// 获取玩家下注总额 / Get total wager on a player
function gbsum($pdata){
	global $gbnum, $gbingdata;
	if($gbnum && isset($gbingdata[$pdata['pid']])){
		$gbsum = 0;
		foreach($gbingdata[$pdata['pid']] as $gad){
			$gbsum += $gad['wager'];
		}
		return $gbsum;
	}
	return 0;
}

// 计算当前赔率 / Calculate current odds
function odds(){
	global $now, $starttime;
	$pasttime = $now - $starttime;
	if($pasttime <= 180){
		$timeodds = 5;// 前3分钟系数为5 / First 3 minutes: multiplier 5
	}else{
		$timeodds = 5 / ($pasttime / 180);// 系数趋近于0 / Multiplier converges to 0
	}
	return round($timeodds * 100000) / 100000;
}