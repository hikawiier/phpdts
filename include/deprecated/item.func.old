<?php

if (! defined ( 'IN_GAME' )) {
	exit ( 'Access Denied' );
}


include_once GAME_ROOT.'./include/game/clubslct.func.php';
include_once GAME_ROOT.'./include/game/item_nouveau_booster1.php';

function itemuse($itmn,&$data=NULL) {
	//global $mode, $log, $nosta, $pid, $name, $state, $now,$nick,$achievement,$club,$clbpara,$pdata;

	global $url,$cmd,$mode,$db,$tablepre,$log,$nosta,$noarb,$gamevars,$corpseprotect,$now,$gamecfg,$hack,$gamevars;
	global $exdmginf,$ex_inf,$cskills,$elements_info,$sparkle,$event_bgm;
	global $upexp,$baseexp,$elec_cap;
	//Some globals seems to be still needed... ...
	global $itemspkinfo,$plsinfo;
	global $pid;

	if(!isset($data))
	{
		global $pdata;
		$data = &$pdata;
	}
	extract($data,EXTR_REFS);

	if (($itmn < 1 || $itmn > 6) && $itmn != 0 ){
		$log .= '此道具不存在，请重新选择。';
		$mode = 'command';
		return;
	}

	////global ${'itm' . $itmn}, ${'itmk' . $itmn}, ${'itme' . $itmn}, ${'itms' . $itmn}, ${'itmsk' . $itmn};
	//2024-07-19: I'm mad enough to add $itmpara, with me luck.
	$itm = & ${'itm' . $itmn};
	$itmk = & ${'itmk' . $itmn};
	$itme = & ${'itme' . $itmn};
	$itms = & ${'itms' . $itmn};
	$itmsk = & ${'itmsk' . $itmn};
	//$itmpara = & ${'itmpara' . $itmn};
	$itmpara = & get_itmpara(${'itmpara' . $itmn});
	$i=$itm;$ik=$itmk;$ie=$itme;$is=$itms;$isk=$itmsk;$ipara=$itmpara;

	if (($itms <= 0) && ($itms != $nosta)) {
		$itm = $itmk = $itmsk = '';
		$itme = $itms = 0;
		$log .= '此道具不存在，请重新选择。<br>';
		$mode = 'command';
		return;
	}

	//If you are dead, you can't use items!
	if ($hp <= 0) {
		$log .= '你的大脑看起来仍旧想挣扎一下，但你的手已经动不了了，挣扎似乎也没有什么意义。<br>';
		$log .= '你已经死亡，无法使用道具。<br>';
		$mode = 'command';
		return;
	}

	if(strpos ( $itmk, 'W' ) === 0 || strpos ( $itmk, 'D' ) === 0 || strpos ( $itmk, 'A' ) === 0 || strpos ( $itmk, 'ss' ) === 0){

		if(strpos ( $itmk, 'W' ) === 0) {
			$eqp = 'wep';
			$noeqp = 'WN';
		}elseif(strpos ( $itmk, 'DB' ) === 0) {
			$eqp = 'arb';
			$noeqp = 'DN';
		}elseif(strpos ( $itmk, 'DH' ) === 0) {
			$eqp = 'arh';
			$noeqp = '';
		}elseif(strpos ( $itmk, 'DA' ) === 0) {
			$eqp = 'ara';
			$noeqp = '';
		}elseif(strpos ( $itmk, 'DF' ) === 0) {
			$eqp = 'arf';
			$noeqp = '';
		}elseif (strpos ( $itmk, 'A' ) === 0) {
			$eqp = 'art';
			$noeqp = '';
		}elseif (strpos ( $itmk, 'ss' ) === 0) {
			$eqp = 'art';
			$noeqp = '';
		}elseif (strpos ( $itmk, 'XX' ) === 0) {
			$eqp = 'art';
			$noeqp = '';
		}elseif (strpos ( $itmk, 'XY' ) === 0) {
			$eqp = 'art';
			$noeqp = '';
		}
		//global ${$eqp}, ${$eqp.'k'}, ${$eqp.'e'}, ${$eqp.'s'}, ${$eqp.'sk'};
		//global $artk;
		if((($artk=='XX')||($artk=='XY'))&&($eqp == 'art')){
			$log .= '你的饰品不能替换！<br>';
			$mode = 'command';
			return;
		}
		# 诅咒装备不能主动卸下
		if(in_array('V',get_itmsk_array(${$eqp.'sk'})))
		{
			$log .= "你尝试着将{$$eqp}替换下来……但它就像长在了你身上一样，纹丝不动！<br>";
			$mode = 'command';
			return;
		}
		# 主动装备诅咒装备时，会变得不幸！
		if(in_array('V',get_itmsk_array($isk)))
		{
			$log .= "<span class=\"grey\">你感觉自己要倒大霉了……</span><br>";
			getclubskill('inf_cursed',$clbpara);
		}

		//PORT
		if(strpos($itmsk,'^')!==false){
			//global $itmnumlimit;
			$itmnumlimit = $itme>=$itms ? $itms : $itme;
		}
		if (($noeqp && strpos ( ${$eqp.'k'}, $noeqp ) === 0) || ! ${$eqp.'s'}) {

			// 装备道具时，进行单次套装检测
			include_once GAME_ROOT.'./include/game/itemmain.func.php';
			reload_single_set_item($data,$eqp,$itm,1);

			${$eqp} = $itm;
			${$eqp.'k'} = $itmk;
			${$eqp.'e'} = $itme;
			${$eqp.'s'} = $itms;
			${$eqp.'sk'} = $itmsk;
			${$eqp.'para'} = $itmpara;
			$log .= "装备了<span class=\"yellow\">$itm</span>。<br>";
			$itm = $itmk = $itmsk = $itmpara = '';
			$itme = $itms = 0;
		} else {

			// 替换装备时，进行单次套装检测
			// 先检测目前穿的装备
			include_once GAME_ROOT.'./include/game/itemmain.func.php';
			reload_single_set_item($data,$eqp,${$eqp});
			// 再检测要替换的装备，类型为1，表示装备
			reload_single_set_item($data,$eqp,$itm,1);

			$itmt = ${$eqp};
			$itmkt = ${$eqp.'k'};
			$itmet = ${$eqp.'e'};
			$itmst = ${$eqp.'s'};
			$itmskt = ${$eqp.'sk'};
			$itmparat = ${$eqp.'para'};
			${$eqp} = $itm;
			${$eqp.'k'} = $itmk;
			${$eqp.'e'} = $itme;
			${$eqp.'s'} = $itms;
			${$eqp.'sk'} = $itmsk;
			${$eqp.'para'} = $itmpara;
			$itm = $itmt;
			$itmk = $itmkt;
			$itme = $itmet;
			$itms = $itmst;
			$itmsk = $itmskt;
			$itmpara = $itmparat;
			$log .= "卸下了<span class=\"red\">$itm</span>，装备了<span class=\"yellow\">{${$eqp}}</span>。<br>";
		}
	} elseif (strpos ( $itmk, 'HS' ) === 0) {
		//global $sp, $msp,$club;
		if ($sp < $msp) {
			$oldsp = $sp;
			if($club == 12){
				$spup = round($itme*1.25);
			}else{
				$spup = $itme;
			}
			/*$sp += $spup;
			$sp = $sp > $msp ? $msp : $sp;
			$oldsp = $sp - $oldsp;*/
			$addsp = $msp - $sp < $spup ? $msp - $sp : $spup;
			//ADD: Process Luck Battle Mode random SP/HP gains.
			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$addsp = diceroll($itme);
				$log .= "随机数大神不喜欢给定值，你回复的体力被骰子改动了！<br>";
			}
			if($addsp > 0) $sp += $addsp;
			else $addsp = 0;
			$log .= "你使用了<span class=\"red\">$itm</span>，恢复了<span class=\"yellow\">$addsp</span>点体力。<br>";
			//吃了无毒果酱
			if($itm == '桔黄色的果酱') $clbpara['achvars']['eat_jelly'] = 1;
			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>用光了。<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}
		} else {
			$log .= '你的体力不需要恢复。<br>';
		}
	} elseif ($itm == '鱼篓子' && $itmk == 'Z' && $itmsk == 'Z') {
		// 如果是鱼篓子，调用 item.nouveau_booster1.php 中的函数
		include_once GAME_ROOT.'./include/game/item.nouveau_booster1.php';
		item_nouveau_booster1($itmn, $data);
	} elseif (strpos ( $itmk, 'HH' ) === 0) {
		//global $hp, $mhp,$club;
		if ($hp < $mhp) {
			$oldhp = $hp;
			if($club == 12){
				$hpup = round($itme*1.25);
			}else{
				$hpup = $itme;
			}
			/*$hp += $hpup;
			$hp = $hp > $mhp ? $mhp : $hp;
			$oldhp = $hp - $oldhp;*/
			$addhp = $mhp - $hp < $hpup ? $mhp - $hp : $hpup;
			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$addhp = diceroll($itme);
				$log .= "随机数大神不喜欢给定值，你回复的生命被骰子改动了！<br>";
			}
			if($addhp > 0) $hp += $addhp;
			else $addhp = 0;
			$log .= "你使用了<span class=\"red\">$itm</span>，恢复了<span class=\"yellow\">$addhp</span>点生命。<br>";
			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>用光了。<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}

			}
		} else {
			$log .= '你的生命不需要恢复。<br>';
		}
	}elseif (strpos ( $itmk, 'HM' ) === 0) {
		//global $mss,$ss;
		$mss+=$itme;
		$ss+=$itme;
		$log .= "你使用了<span class=\"red\">$itm</span>，增加了<span class=\"yellow\">$itme</span>点歌魂。<br>";
		if ($clbpara['BGMBrand'] == 'lila'){
			$check = diceroll(20);
			if ($check > 17){
				$log .= "<span class=\"clan\">突然，一位纯洁的女初中生形象出现在你的脑海中，<br>你觉醒了额外的歌魂！<br></span>";
				$mss += $check * 2;
				$ss += $check * 2;
			}
		}
		if ($itms != $nosta) {
			$itms --;
			if ($itms <= 0) {
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		}
	}elseif (strpos ( $itmk, 'HT' ) === 0) {
		//global $ss, $mss;
		$ssup=$itme;
		if ($ss < $mss) {
			$oldss = $ss;
			$ss += $ssup;
			$ss = $ss > $mss ? $mss : $ss;
			$oldss = $ss - $oldss;
			$log .= "你使用了<span class=\"red\">$itm</span>，恢复了<span class=\"yellow\">$oldss</span>点歌魂。<br>";
			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>用光了。<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}

			}
		} else {
			$log .= '你的歌魂不需要恢复。<br>';
		}
	}elseif (strpos ( $itmk, 'HR' ) === 0) {
		$rageup=$itme;
		require config('gamecfg',$gamecfg);
		if ($rage < $mrage) {
			$oldrage = $rage;
			$rage += $rageup;
			$rage = $rage > $mrage ? $mrage : $rage;
			$oldrage = $rage - $oldrage;
			$log .= "你吃了一口<span class=\"red\">$itm</span>，顿时感觉心中充满了愤怒。你的怒气值增加了<span class=\"yellow b\">$oldrage</span>点！<br>";
			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>用光了。<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}

			}
		} else {
			$log .= '你已经出离愤怒了，动怒伤肝，还是歇歇吧！<br>';
		}
	} elseif (strpos ( $itmk, 'HB' ) === 0) {
		//global $hp, $mhp, $sp, $msp,$club;
		if (($hp < $mhp) || ($sp < $msp)) {
			if($club == 12){
				$bpup = round($itme*1.25);
			}else{
				$bpup = $itme;
			}
			//$oldsp = $sp;
			//$sp += $bpup;
			//$sp = $sp > $msp ? $msp : $sp;
			//$oldsp = $sp - $oldsp;
			$addsp = $msp - $sp < $bpup ? $msp - $sp : $bpup;
			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$addsp = diceroll($itme);
				$log .= "随机数大神不喜欢给定值，你回复的体力被骰子改动了！<br>";
			}
			if($addsp > 0) $sp += $addsp;
			else $addsp = 0;
			//$oldhp = $hp;
			//$hp += $bpup;
			//$hp = $hp > $mhp ? $mhp : $hp;
			//$oldhp = $hp - $oldhp;
			$addhp = $mhp - $hp < $bpup ? $mhp - $hp : $bpup;
			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$addhp = diceroll($itme);
				$log .= "随机数大神不喜欢给定值，你回复的生命被骰子改动了！<br>";
			}
			if($addhp > 0) $hp += $addhp;
			else $addhp = 0;
			$log .= "你使用了<span class=\"red\">$itm</span>，恢复了<span class=\"yellow\">$addhp</span>点生命和<span class=\"yellow\">$addsp</span>点体力。<br>";
			//吃了无毒的围棋子饼干 真勇啊！
			if($itm == '像围棋子一样的饼干') $clbpara['achvars']['eat_weiqi'] = 1;
			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>用光了。<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}
		} else {
			$log .= '你的生命和体力都不需要恢复。<br>';
		}
	} elseif (strpos ( $itmk, 'P' ) === 0) {
		//global $lvl, $db, $tablepre, $now, $hp, $inf, $bid;
		if (strpos ( $itmk, '2' ) === 2) {
			$damage = round ( $itme * 2 );
		} elseif (strpos ( $itmk, '1' ) === 2) {
			$damage = round ( $itme * 1.5 );
		} else {
			$damage = round ( $itme );
		}
		if (strpos ( $inf, 'p' ) === false) {
			$inf .= 'p';
		}
		$hp -= $damage;
		if ($itmsk && is_numeric($itmsk)) {
			$result = $db->query ( "SELECT * FROM {$tablepre}players WHERE pid='$itmsk'" );
			$wdata = $db->fetch_array ( $result );
			$log .= "糟糕，<span class=\"yellow\">$itm</span>中被<span class=\"yellow\">{$wdata['name']}</span>掺入了毒药！你受到了<span class=\"dmg\">$damage</span>点伤害！<br>";
			addnews ( $now, 'poison', $name, $wdata ['name'], $itm , $nick);
		} else {
			$log .= "糟糕，<span class=\"yellow\">$itm</span>有毒！你受到了<span class=\"dmg\">$damage</span>点伤害！<br>";
		}
		if ($hp <= 0) {
			if ($itmsk && is_numeric($itmsk)) {
				$bid = $itmsk;
				$result = $db->query ( "SELECT * FROM {$tablepre}players WHERE pid='$itmsk'" );
				$edata = $db->fetch_array ( $result );
				//include_once GAME_ROOT . './include/state.func.php';
				//$killmsg = death ( 'poison', $wdata ['name'], $wdata ['type'], $itm );
				//$log .= "你被<span class=\"red\">" . $wdata ['name'] . "</span>毒死了！";
				//if($killmsg){$log .= "<span class=\"yellow\">{$wdata['name']}对你说：“{$killmsg}”</span><br>";}
				if(!$edata['type'])
				{
					$w_log = "<span class=\"yellow\">{$name}误食了你下毒的补给<span class=\"red\">{$itm}</span>被毒死！</span><br>";
					logsave ( $itmsk, $now, $w_log ,'b');
				}
				$edata['wep_name'] = $itm;
				include_once GAME_ROOT.'./include/state.func.php';
				$last = pre_kill_events($edata,$data,0,'poison');
				if($itmsk == $data['pid']) $last = 0;
				final_kill_events($edata,$data,0,$last);
				player_save($edata); //current_player_save();
			} else {
				//$bid = 0;
				include_once GAME_ROOT . './include/state.func.php';
				death ( 'poison', '', 0, $itm );
				$log .= "你被毒死了！";
			}
		}
		else
		{
			//吃了像围棋子一样的饼干但是活下来了……怎么做到的！
			if($itm == '像围棋子一样的饼干') $clbpara['achvars']['eat_weiqi'] = 1;
			if($itm == '桔黄色的果酱') $clbpara['achvars']['eat_jelly'] = 1;
		}
		if ($itms != $nosta) {
			$itms --;
			if ($itms <= 0) {
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		}

	} elseif (strpos ( $itmk, 'T' ) === 0) {

		if(!check_skill_unlock('c13_master',$data))
		{
			$log .= "你老脸一红，只觉得自己是被鬼迷了心窍，怎么会起了这种卑劣的念头！<br>羞愤之下，你一口把<span class='yellow'>{$itm}</span>吞进了肚子。<br>";
			$itms = 0;
			destory_single_item($data,$itmn,1);
			$mode = 'command';
			return;
		}

		$trapk = str_replace('TN','TO',$itmk);

		if($clbpara['BGMBrand'] == 'rixolamal'){
			$trapk = str_replace('TO','TOr',$itmk);
			$log .= "你对随机数大神的反叛让随机数大神将<span class=\"red\">$itm</span>变成了一个随机造成伤害的地雷！<br>";
		}

		$db->query("INSERT INTO {$tablepre}maptrap (itm, itmk, itme, itms, itmsk, pls) VALUES ('$itm', '$trapk', '$itme', '1', '$pid', '$pls')");
		$log .= "设置了陷阱<span class=\"red\">$itm</span>。<br>小心，自己也很难发现。<br>";

		if($club == 5){$exp += 2;$wd+=2;}
		else{$exp++;$wd++;}

		if ($exp >= $upexp) {
			include_once GAME_ROOT . './include/state.func.php';
			lvlup_rev($data,$data,1);
		}
		if ($itms != $nosta) {
			$itms --;
			if ($itms <= 0) {
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		}
	} elseif (strpos ( $itmk, 'GB' ) === 0) {
		//global $wep, $wepk, $weps, $wepsk;
		if ((strpos ( $wepk, 'WG' ) !== 0)&&(strpos ( $wepk, 'WJ' ) !== 0)) {
			$log .= "<span class=\"red\">你没有装备枪械，不能使用子弹。</span><br>";
			$mode = 'command';
			return;
		}
		if (strpos ($wepk,'WG')===false){
			if ($itmk=='GBh'){
			$bulletnum = 3;
			}else{
			$log .= "<span class=\"red\">枪械类型和弹药类型不匹配。</span><br>";
			$mode = 'command';
			return;
			}
		}
		elseif (strpos ( $wepsk, 'o' ) !== false) {
			$log .= "<span class=\"red\">{$wep}不能装填弹药。</span><br>";
			$mode = 'command';
			return;
		} elseif (strpos ( $wepsk, 'e' ) !== false || strpos ( $wepsk, 'w' ) !== false) {
			if ($itmk == 'GBe') {
				$bulletnum = 18;
			} else {
				$log .= "<span class=\"red\">枪械类型和弹药类型不匹配。</span><br>";
				$mode = 'command';
				return;
			}
		} elseif (strpos ( $wepsk, 'i' ) !== false || strpos ( $wepsk, 'u' ) !== false) {
			if ($itmk == 'GBi') {
				$bulletnum = 18;
			} else {
				$log .= "<span class=\"red\">枪械类型和弹药类型不匹配。</span><br>";
				$mode = 'command';
				return;
			}
		} else {
			if (strpos ( $wepsk, 'r' ) !== false) {
				if ($itmk == 'GBr') {
					$bulletnum = 24;
				} else {
					$log .= "<span class=\"red\">枪械类型和弹药类型不匹配。</span><br>";
					$mode = 'command';
					return;
				}
			} else {
				if ($itmk == 'GB') {
					$bulletnum = 12;
				} else {
					$log .= "<span class=\"red\">枪械类型和弹药类型不匹配。</span><br>";
					$mode = 'command';
					return;
				}
			}
		}
		if ($weps == $nosta) {
			$weps = 0;
		}
		$bullet = $bulletnum - $weps;
		if ($bullet <= 0) {
			$log .= "<span class=\"red\">{$wep}的弹匣是满的，不能装弹。</span>";
			return;
		} elseif ($bullet >= $itms) {
			$bullet = $itms;
		}
		$itms -= $bullet;
		$weps += $bullet;
		$log .= "为<span class=\"red\">$wep</span>装填了<span class=\"red\">$itm</span>，<span class=\"red\">$wep</span>残弹数增加<span class=\"yellow\">$bullet</span>。<br>";
		if ($itms <= 0) {
			$log .= "<span class=\"red\">$itm</span>用光了。<br>";
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}
	} elseif(strpos ( $itmk, 'GA' ) === 0) {//使用箭矢
		if (strpos ( $wepk, 'WB' ) !== 0) {
			$log .= "<span class=\"red b\">你没有装备弓，不能给武器上箭。</span><br>";
			$mode = 'command';
			return;
		}	elseif(0 === $itmn && !empty($weps)) {//捡到的箭矢不能马上拉弓，避免换箭覆盖itm0的问题
			$log .= "你一只手捏着弓箭，一只手抓着刚捡到的箭矢，没法马上弯弓搭箭。<span class=\"red b\">还是先把箭矢收进包裹里吧。</span><br>";
			$mode = 'command';
			return;
		} else {
			//$theitem = Array('itm' => &$itm, 'itmk' => &$itmk, 'itme' => &$itme, 'itms' => &$itms, 'itmsk' => &$itmsk);
			include_once GAME_ROOT . './include/game/item2.func.php';
			itemuse_ugb($pdata, $itmn);
		}
	} elseif (strpos ( $itmk, 'R' ) === 0) {
		//$log.= $itm .'已经废弃，请联系管理员。';
		if ($itme > 0) {
			$log .= "使用了<span class=\"red\">$itm</span>。<br>";
			include_once GAME_ROOT . './include/game/item2.func.php';
			newradar ( $itmsk );
			$itme --;
			if ($itme <= 0) {
				$log .= $itm . '的电力用光了，请使用电池充电。<br>';
			}
		} else {
			$itme = 0;
			$log .= $itm . '没有电了，请先充电。<br>';
		}
	} elseif (strpos ( $itmk, 'C' ) === 0) {
		//global $inf, $exdmginf,$ex_inf;
		$ck=substr($itmk,1,1);
		if($ck == 'a'){
			$flag=false;
			$log .= "服用了<span class=\"red\">$itm</span>。<br>";
			foreach ($ex_inf as $value) {
				if(strpos ( $inf, $value ) !== false){
					$inf = str_replace ( $value, '', $inf );
					$log .= "{$exdmginf[$value]}状态解除了。<br>";
					$flag=true;
				}
			}
			if(!$flag){
				$log .= '但是什么也没发生。<br>';
			}
		}elseif(in_array($ck,$ex_inf)){
			if(strpos ( $inf, $ck ) !== false){
				$inf = str_replace ( $ck, '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf[$ck]}状态解除了。<br>";
			}else{
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
		}elseif ($ck == 'x'){
			$inf = "puiewhbaf";
			$log .= "服用了<span class=\"red\">$itm</span>，<br>";
			$log .= "但是，假冒伪劣的<span class=\"red\">$itm</span>导致你{$exdmginf['p']}了！<br>";
			$log .= "假冒伪劣的<span class=\"red\">$itm</span>导致你{$exdmginf['u']}了！<br>";
			$log .= "假冒伪劣的<span class=\"red\">$itm</span>导致你{$exdmginf['i']}了！<br>";
			$log .= "假冒伪劣的<span class=\"red\">$itm</span>导致你{$exdmginf['e']}了！<br>";
			$log .= "而且，假冒伪劣的<span class=\"red\">$itm</span>还导致你{$exdmginf['w']}了！<br>";
			$log .= "你遍体鳞伤地站了起来。<br>";
			$log .= "真是大快人心啊！<br>";
		}else{
			$log .= "服用了<span class=\"red\">$itm</span>……发生了什么？<br>";
		}

		$itms --;
		/*if (strpos ( $itm, '烧伤药剂' ) === 0) {
			if (strpos ( $inf, 'u' ) !== false) {
				$inf = str_replace ( 'u', '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf['u']}状态解除了。<br>";
			} else {
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
			$itms --;
		} elseif (strpos ( $itm, '麻痹药剂' ) === 0) {
			if (strpos ( $inf, 'e' ) !== false) {
				$inf = str_replace ( 'e', '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf['e']}状态解除了。<br>";
			} else {
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
			$itms --;

		} elseif (strpos ( $itm, '解冻药水' ) === 0) {
			if (strpos ( $inf, 'i' ) !== false) {
				$inf = str_replace ( 'i', '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf['i']}状态解除了。<br>";
			} else {
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
			$itms --;

		} elseif (strpos ( $itm, '解毒剂' ) === 0) {
			if (strpos ( $inf, 'p' ) !== false) {
				$inf = str_replace ( 'p', '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf['p']}状态解除了。<br>";
			} else {
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
			$itms --;

		} elseif (strpos ( $itm, '清醒药剂' ) === 0) {
			if (strpos ( $inf, 'w' ) !== false) {
				$inf = str_replace ( 'w', '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf['w']}状态解除了。<br>";
			} else {
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
			$itms --;

		} elseif (strpos ( $itm, '全恢复药剂' ) === 0) {
			if (strpos ( $inf, 'w' ) !== false) {
				$inf = str_replace ( 'w', '', $inf );
				$log .= "服用了<span class=\"red\">$itm</span>，{$exdmginf['w']}状态解除了。<br>";
			} else {
				$log .= "服用了<span class=\"red\">$itm</span>，但是什么效果也没有。<br>";
			}
			$itms --;

		} else {
			$log .= "服用了<span class=\"red\">$itm</span>……发生了什么？<br>";
			$itms --;
		}*/
		if ($itms <= 0) {
			$log .= "<span class=\"red\">$itm</span>用光了。<br>";
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}

	} elseif (strpos ( $itmk, 'V' ) === 0) {
		$skill_minimum = 100;
		$skill_limit = 380;
		$log .= "你阅读了<span class=\"red\">$itm</span>。<br>";
		$dice = rand ( - 10, 10 );
		if (strpos ( $itmk, 'VV' ) === 0) {
			//global $wp, $wk, $wg, $wc, $wd, $wf;
			$ws_sum = $wp + $wk + $wg + $wc + $wd + $wf;
			if ($ws_sum < $skill_minimum * 5) {
				$vefct = $itme;
			} elseif ($ws_sum < $skill_limit * 5) {
				$vefct = round ( $itme * (1 - ($ws_sum - $skill_minimum * 5) / ($skill_limit * 5 - $skill_minimum * 5)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wp += $vefct; //$itme;
			$wk += $vefct; //$itme;
			$wg += $vefct; //$itme;
			$wc += $vefct; //$itme;
			$wd += $vefct; //$itme;
			$wf += $vefct; //$itme;
			$wsname = "全系熟练度";
		} elseif (strpos ( $itmk, 'VP' ) === 0) {
			//global $wp;
			if ($wp < $skill_minimum) {
				$vefct = $itme;
			} elseif ($wp < $skill_limit) {
				$vefct = round ( $itme * (1 - ($wp - $skill_minimum) / ($skill_limit - $skill_minimum)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wp += $vefct; //$itme;
			$wsname = "斗殴熟练度";
		} elseif (strpos ( $itmk, 'VK' ) === 0) {
			//global $wk;
			if ($wk < $skill_minimum) {
				$vefct = $itme;
			} elseif ($wk < $skill_limit) {
				$vefct = round ( $itme * (1 - ($wk - $skill_minimum) / ($skill_limit - $skill_minimum)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wk += $vefct; //$itme;
			$wsname = "斩刺熟练度";
		} elseif (strpos ( $itmk, 'VG' ) === 0) {
			//global $wg;
			if ($wg < $skill_minimum) {
				$vefct = $itme;
			} elseif ($wg < $skill_limit) {
				$vefct = round ( $itme * (1 - ($wg - $skill_minimum) / ($skill_limit - $skill_minimum)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wg += $vefct; //$itme;
			$wsname = "射击熟练度";
		} elseif (strpos ( $itmk, 'VC' ) === 0) {
			//global $wc;
			if ($wc < $skill_minimum) {
				$vefct = $itme;
			} elseif ($wc < $skill_limit) {
				$vefct = round ( $itme * (1 - ($wc - $skill_minimum) / ($skill_limit - $skill_minimum)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wc += $vefct; //$itme;
			$wsname = "投掷熟练度";
		} elseif (strpos ( $itmk, 'VD' ) === 0) {
			//global $wd;
			if ($wd < $skill_minimum) {
				$vefct = $itme;
			} elseif ($wd < $skill_limit) {
				$vefct = round ( $itme * (1 - ($wd - $skill_minimum) / ($skill_limit - $skill_minimum)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wd += $vefct; //$itme;
			$wsname = "引爆熟练度";
		} elseif (strpos ( $itmk, 'VF' ) === 0) {
			//global $wf;
			if ($wf < $skill_minimum) {
				$vefct = $itme;
			} elseif ($wf < $skill_limit) {
				$vefct = round ( $itme * (1 - ($wf - $skill_minimum) / ($skill_limit - $skill_minimum)) );
			} else {
				$vefct = 0;
			}
			if ($vefct < 10) {
				if ($vefct < $dice) {
					$vefct = - $dice;
				}
			}
			$wf += $vefct; //$itme;
			$wsname = "灵击熟练度";
		} elseif (strpos ( $itmk, 'VS' ) === 0) {
			//global $cskills,$clbpara;
			if(!empty($itmsk) && isset($cskills[$itmsk]))
			{

				$flag = getclubskill($itmsk,$clbpara);
				if($flag)
				{
					$log.="哇！没想到这本书里竟然介绍了<span class='yellow'>「{$cskills[$itmsk]['name']}」</span>的原理！<br>获得了技能<span class='yellow'>「{$cskills[$itmsk]['name']}」</span>！<br>你心满意足地把<span class='red'>{$itm}</span>吃进了肚里。<br>";
					addnews($now,'getsk_'.$itmsk,$name,$itm,$nick);
				}
				else
				{
					$log.="什么嘛！原来里面都是些你看过的东西了，你没有从书中学到任何新东西。<br>你一怒之下把这本破书撕了个稀巴烂！<br>";
				}
			}
			else
			{
				$log.="但是你横看竖看，也弄不明白作者到底想表达什么！<br>你一怒之下把这本破书撕了个稀巴烂！<br>";
			}
		}
		if(isset($vefct))
		{
			if ($vefct > 0) {
				$log .= "嗯，有所收获。<br>你的{$wsname}提高了<span class=\"yellow\">$vefct</span>点！<br>";
			} elseif ($vefct == 0) {
				$log .= "对你来说书里的内容过于简单了。<br>你的熟练度没有任何提升。<br>";
			} else {
				$vefct = - $vefct;
				$log .= "对你来说书里的内容过于简单了。<br>而且由于盲目相信书上的知识，你反而被编写者的纰漏所误导了！<br>你的{$wsname}下降了<span class=\"red\">$vefct</span>点！<br>";
			}
		}
		if ($itms != $nosta) {
			$itms --;
			if ($itms <= 0) {
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		}
	} elseif (strpos ( $itmk, 'M' ) === 0) {
		$log .= "你服用了<span class=\"red\">$itm</span>。<br>";

		if (strpos ( $itmk, 'MA' ) === 0) {
			//global $att;
			$att_min = 500;
			$att_limit = 2500;
			$dice = rand ( - 5, 5 );
			if ($att < $att_min) {
				$mefct = $itme;
			} elseif ($att < $att_limit) {
				$mefct = round ( $itme * (1 - ($att - $att_min) / ($att_limit - $att_min)) );
			} else {
				$mefct = 0;
			}
			if ($mefct < 5) {
				if ($mefct < $dice) {
					$mefct = - $dice;
				}
			}
			$att += $mefct;
			$mdname = "基础攻击力";
		} elseif (strpos ( $itmk, 'MD' ) === 0) {
			//global $def;
			$def_min = 500;
			$def_limit = 2500;
			$dice = rand ( - 5, 5 );
			if ($def < $def_min) {
				$mefct = $itme;
			} elseif ($def < $def_limit) {
				$mefct = round ( $itme * (1 - ($def - $def_min) / ($def_limit - $def_min)) );
			} else {
				$mefct = 0;
			}
			if ($mefct < 5) {
				if ($mefct < $dice) {
					$mefct = - $dice;
				}
			}
			$def += $mefct;
			$mdname = "基础防御力";
		} elseif (strpos ( $itmk, 'ME' ) === 0) {
			//global $exp, $upexp, $baseexp;
			$lvlup_objective = $itme / 10;
			$mefct = round ( $baseexp * 2 * $lvlup_objective + rand ( 0, 5 ) );
			$exp += $mefct;
			$mdname = "经验值";
		} elseif (strpos ( $itmk, 'MS' ) === 0) {
			//global $sp, $msp;
			$mefct = $itme;
			$sp += $mefct;
			$msp += $mefct;
			$mdname = "体力上限";
		} elseif (strpos ( $itmk, 'MH' ) === 0) {
			//global $hp, $mhp;
			$mefct = $itme;
			$hp += $mefct;
			$mhp += $mefct;
			$mdname = "生命上限";
		} elseif (strpos ( $itmk, 'MV' ) === 0) {
			//global $wp, $wk, $wg, $wc, $wd, $wf;
			$skill_minimum = 100;
			$skill_limit = 380;
			$dice = rand ( - 10, 10 );
			$ws_sum = $wp + $wk + $wg + $wc + $wd + $wf;
			if ($ws_sum < $skill_minimum * 5) {
				$mefct = $itme;
			} elseif ($ws_sum < $skill_limit * 5) {
				$mefct = round ( $itme * (1 - ($ws_sum - $skill_minimum * 5) / ($skill_limit * 5 - $skill_minimum * 5)) );
			} else {
				$mefct = 0;
			}
			if ($mefct < 10) {
				if ($mefct < $dice) {
					$mefct = - $dice;
				}
			}
			$wp += $mefct;
			$wk += $mefct;
			$wg += $mefct;
			$wc += $mefct;
			$wd += $mefct;
			$wf += $mefct;
			$mdname = "全系熟练度";
		}
		if ($mefct > 0) {
			$log .= "身体里有种力量涌出来！<br>你的{$mdname}提高了<span class=\"yellow\">$mefct</span>点！<br>";
		} elseif ($mefct == 0) {
			$log .= "已经很强了，却还想靠药物继续强化自己，是不是太贪心了？<br>你的能力没有任何提升。<br>";
		} else {
			$mefct = - $mefct;
			$log .= "已经很强了，却还想靠药物继续强化自己，是不是太贪心了？<br>你贪婪的行为引发了药物的副作用！<br>你的{$mdname}下降了<span class=\"red\">$mefct</span>点！<br>";
		}
		if (strpos ( $itmk, 'ME' ) === 0) {

			if ($exp >= $upexp) {
				include_once GAME_ROOT . './include/state.func.php';
				lvlup_rev($data,$data,1);
			}
		}
		if ($itms != $nosta) {
			$itms --;
			if ($itms <= 0) {
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		}
	} elseif ( strpos( $itmk,'EW' ) ===0 )	{
		include_once GAME_ROOT . './include/game/item2.func.php';
		wthchange ( $itm,$itmsk);
		$itms--;
		if ($itms <= 0) {
			$log .= "<span class=\"red\">$itm</span>用光了。<br>";
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}
	} elseif (strpos ( $itmk, 'EE' ) === 0 || $itm == '移动PC') {//移动PC
		include_once GAME_ROOT . './include/game/item2.func.php';
		hack ( $itmn );
	} elseif (strpos ( $itmk, 'ER' ) === 0) {//雷达
		if ($itme > 0) {
			$log .= "使用了<span class=\"red\">$itm</span>。<br>";
			include_once GAME_ROOT . './include/game/item2.func.php';
			newradar ( $itmsk );
			//global $club;
			if($club == 7){
				$e_dice = rand(0,1);
				if($e_dice == 1){
					$itme--;
					$log .= "消耗了<span class=\"yellow\">$itm</span>的电力。<br>";
				}else{
					$log .= "由于操作迅速，<span class=\"yellow\">$itm</span>的电力没有消耗。<br>";
				}
			}else{
				$itme--;
				$log .= "消耗了<span class=\"yellow\">$itm</span>的电力。<br>";
			}
			if ($itme <= 0) {
				$log .= $itm . '的电力用光了，请使用电池充电。<br>';
			}
		} else {
			$itme = 0;
			$log .= $itm . '没有电了，请先充电。<br>';
		}
	} elseif (strpos ( $itmk, 'B' ) === 0) {
		$flag = false;
		//global $elec_cap;
		$bat_kind = substr($itmk,1,1);
		for($i = 1; $i <= 6; $i ++) {
			//global ${'itm' . $i}, ${'itmk' . $i}, ${'itme' . $i}, ${'itms' . $i};
			if (${'itmk' . $i} == 'E'.$bat_kind && ${'itms' . $i}) {
				if(${'itme' . $i} >= $elec_cap){
					$log .= "包裹{$i}里的<span class=\"yellow\">{${'itm'.$i}}</span>已经充满电了。<br>";
				}else{
					${'itme' . $i} += $itme;
					if(${'itme' . $i} > $elec_cap){${'itme' . $i} = $elec_cap;}
					$itms --;
					$flag = true;
					$log .= "为包裹{$i}里的<span class=\"yellow\">{${'itm'.$i}}</span>充了电。";
					break;
				}
			}
		}
		if (! $flag) {
			$log .= '你没有需要充电的物品。<br>';
		}
		if ($itms <= 0 && $itm) {
			$log .= "<span class=\"red\">$itm</span>用光了。<br>";
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}
	} elseif(strpos ( $itmk, 'p' ) === 0){
		//你们这帮乱用itmk的都乖乖自觉归类！itmk空间也是有限的！
		$log.="你打开了<span class=\"yellow\">$itm</span>。<br>";

		$itms--; $oitm = $itm; $oitmk = $itmk;
		//if($itms <= 0) destory_single_item($data,$itmn,1);

		if(strpos( $oitmk, 'ps' ) === 0){//银色盒子
			include_once config('randomitem',$gamecfg);
			//1st case of the new diceroll system.
			//include_once GAME_ROOT.'./include/game/dice.func.php';
			$dice = diceroll(100);
			//$dice = rand(1,100);
			if($dice <= 75){//一般物品
				$itemflag = $itmlow;
			}elseif($dice <= 95){//中级道具
				$itemflag = $itmmedium;
			}elseif($dice <= 97){//神装
				$itemflag = $itmhigh;
			}elseif($dice <= 99){//礼品盒和游戏王
				$file = config('present',$gamecfg);
				$plist = openfile($file);
				$file2 = config('box',$gamecfg);
				$plist2 = openfile($file2);
				$plist = array_merge($plist,$plist2);
				$rand = rand(0,count($plist)-1);
				list($in,$ik,$ie,$is,$isk) = explode(',',$plist[$rand]);
				$itmflag = false;
			}else{//三抽
				$itemflag = $antimeta;
			}
			if($itemflag){
				$itemflag = explode("\r\n",$itemflag);
				$rand = rand(0,count($itemflag)-1);
				list($in,$ik,$ie,$is,$isk) = explode(',',$itemflag[$rand]);
			}
		}elseif(strpos( $oitmk, 'p0' ) === 0){//新福袋·VOL1
			// 用$clbpara['opened_pack']记录打开福袋的名称，只要有这个名称，就搞事！
 			if(!empty($clbpara['opened_pack'])){
				$log.="似乎你本轮已经打开过福袋，因此不能再打开更多的福袋！<br>";
				$db->query("INSERT INTO {$tablepre}shopitem (kind,num,price,area,item,itmk,itme,itms,itmsk) VALUES ('17','1','20','0','$itm','$itmk','$itme','1','$itmsk')");
				$log.="<span class=\"yellow\">$itm</span>从你的手中飞出，向商店的方向飞去。<br>";
			}
			if(strpos( $itmk, 'p0P' ) === 0){
				include_once config('randomWP',$gamecfg);
			}elseif(strpos( $itmk, 'p0K' ) === 0){
				include_once config('randomWK',$gamecfg);
			}elseif(strpos( $itmk, 'p0G' ) === 0){
				include_once config('randomWG',$gamecfg);
			}elseif(strpos( $itmk, 'p0C' ) === 0){
				include_once config('randomWC',$gamecfg);
			}elseif(strpos( $itmk, 'p0D' ) === 0){
				include_once config('randomWD',$gamecfg);
			}elseif(strpos( $itmk, 'p0F' ) === 0){
				include_once config('randomWF',$gamecfg);
			}elseif(strpos( $itmk, 'p0O1' ) === 0){
				include_once config('randomO1',$gamecfg);
			}elseif(strpos( $itmk, 'p000' ) === 0){
				include_once config('random00',$gamecfg);
			}elseif(strpos( $itmk, 'p0AV' ) === 0){ #TODO VTuber大福袋
				//include_once config('randomAV',$gamecfg);
				include_once config('randomO1',$gamecfg);
			}else{ #防呆
				include_once config('randomO1',$gamecfg);
			}
			//include_once GAME_ROOT.'./include/game/dice.func.php';
			$dice = diceroll(1000);
			if($dice <= 550){//一般物品
				$itemflag = $itmlow;
			}elseif($dice <= 888){//中级道具
				$itemflag = $itmmedium;
			}elseif($dice <= 995){//神装
				$itemflag = $itmhigh;
				$clbpara['achvars']['gacha_sr'] += 1;
			}else{
				$itemflag = $antimeta;
				$clbpara['achvars']['gacha_ssr'] += 1;
			}
			if($itemflag){
				$itemflag = explode("\r\n",$itemflag);
				$rand = rand(0,count($itemflag)-1);
				list($in,$ik,$ie,$is,$isk) = explode(',',$itemflag[$rand]);
				if($clbpara['opened_pack']){
					$in = '乌黑的脸'; # 给一个惩罚用物品
					$ik = 'X';
					$ie = 1;
					$is = 1;
					$isk = '';
				}
				$clbpara['opened_pack'] = $oitm; //记录打开福袋
			}
		}else{//一般礼品盒
			$file = config('present',$gamecfg);
			$plist = openfile($file);
			$rand = rand(0,count($plist)-1);
			list($in,$ik,$ie,$is,$isk) = explode(',',$plist[$rand]);
		}
		//global $itm0,$itmk0,$itme0,$itms0,$itmsk0,$mode;
		if($itms <= 0) destory_single_item($data,$itmn,1);
		$itm0 = $in;$itmk0=$ik;$itme0=$ie;$itms0=$is;$itmsk0=$isk;
		addnews($now,'present',$name,$oitm,$in,$nick);

		include_once GAME_ROOT.'./include/game/itemmain.func.php';
		itemget($data);
	} elseif(strpos ( $itmk, 'ygo' ) === 0){
		$log.="你打开了<span class=\"yellow\">$itm</span>。<br>";
		$itms--; $oitm = $itm;
		if($itms <= 0) destory_single_item($data,$itmn,1);

		$file1 = config('box',$gamecfg);
		$plist1 = openfile($file1);
		$rand1 = rand(0,count($plist1)-1);
		list($in,$ik,$ie,$is,$isk) = explode(',',$plist1[$rand1]);
		//global $itm0,$itmk0,$itme0,$itms0,$itmsk0,$mode;
		$itm0 = $in;$itmk0=$ik;$itme0=$ie;$itms0=$is;$itmsk0=$isk;
		addnews($now,'present',$name,$oitm,$in,$nick);

		include_once GAME_ROOT.'./include/game/itemmain.func.php';
		itemget($data);
	} elseif(strpos ( $itmk, 'fy' ) === 0){
		$log.="你打开了<span class=\"yellow\">$itm</span>。<br>";
		$itms--; $oitm = $itm;
		if($itms <= 0) destory_single_item($data,$itmn,1);

		$file1 = config('fy',$gamecfg);
		$plist1 = openfile($file1);
		$rand1 = rand(0,count($plist1)-1);
		list($in,$ik,$ie,$is,$isk) = explode(',',$plist1[$rand1]);
		//global $itm0,$itmk0,$itme0,$itms0,$itmsk0,$mode;
		$itm0 = $in;$itmk0=$ik;$itme0=$ie;$itms0=$is;$itmsk0=$isk;
		addnews($now,'present',$name,$oitm,$in,$nick);

		include_once GAME_ROOT.'./include/game/itemmain.func.php';
		itemget($data);
	} elseif(strpos ( $itmk, 'f99' ) === 0){ // Debug Box for testing $itmpara
		$log.="你打开了<span class=\"yellow\">$itm</span>。<br>";
		$itms--; $oitm = $itm;
		if($itms <= 0) destory_single_item($data,$itmn,1);

		$file1 = config('f99',$gamecfg);
		$plist1 = openfile($file1);
		$rand1 = rand(0,count($plist1)-1);
		list($in,$ik,$ie,$is,$isk,$ipara) = explode(',',$plist1[$rand1]);
		//global $itm0,$itmk0,$itme0,$itms0,$itmsk0,$mode;
		$itm0 = $in;$itmk0=$ik;$itme0=$ie;$itms0=$is;$itmsk0=$isk;$itmpara0=$ipara;
		addnews($now,'present',$name,$oitm,$in,$nick);

		include_once GAME_ROOT.'./include/game/itemmain.func.php';
		itemget($data);
	}elseif ($itmk=='U') {
		//global $db, $tablepre,$pls;
		$trapresult = $db->query("SELECT * FROM {$tablepre}maptrap WHERE pls = '$pls' AND itme>='$itme'");
		$trpnum = $db->num_rows($trapresult);
		$itms--;
		if ($itms <= 0) {
			$log .= "<span class=\"red\">$itm</span>用光了。<br>";
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}
		if ($trpnum>0){
			$itemno = rand(0,$trpnum-1);
			$db->data_seek($trapresult,$itemno);
			$mi=$db->fetch_array($trapresult);
			$deld = $mi['itm'];
			$delp = $mi['tid'];
			$db->query("DELETE FROM {$tablepre}maptrap WHERE tid='$delp'");
			$log.="远方传来一阵爆炸声，伟大的<span class=\"yellow\">{$itm}</span>用生命和鲜血扫除了<span class=\"yellow\">{$deld}</span>。<br><span class=\"red\">实在是大快人心啊！</span><br>";
		}else{
			$log.="你使用了<span class=\"yellow\">{$itm}</span>，但是没有发现陷阱。<br>";
		}
	}elseif (strpos ( $itmk, '🎲' ) === 0 ) {
		//invoke fortune cookie.
		include_once GAME_ROOT.'./include/game/fortune.func.php';

		if ($itm == '［Ｄ３］') {
			$log .= '你向天空投出了骰子！<br><br>进行１ｄ３检定！<br>';
			fortuneCookie1(diceroll($clbpara['randver1']));
			//D3 - Randomly shuffle the effect and stamina of player's equipment and weapon.
			//grabbing the effect and stamina of player equipment and weapon
			//Does not affect "A" equipment
			$rand_e = array($wepe, $wep2e, $arbe, $arhe, $arae, $arfe);
			$rand_s = array($weps, $wep2s, $arbs, $arhs, $aras, $arfs);
			$etotal = round(($wepe + $wep2e + $arbe + $arhe + $arae + $arfe) / 2);
			$stotal = round(($weps + $wep2s + $arbs + $arhs + $aras + $arfs) / 2);
			//Loop through the effect and stamina arrays, randomize each one that's not 0
			foreach ($rand_s as $key => &$value) {
				if ($value != 0) {
					$value = diceroll($stotal);
				}
			}

			foreach ($rand_e as $key => &$value) {
				if ($value != 0) {
					$value = diceroll($etotal);
				}
			}

			//place the contents of arraies back to player equipment.
			$wepe = $rand_e[0];
			$wep2e = $rand_e[1];
			$arbe = $rand_e[2];
			$arhe = $rand_e[3];
			$arae = $rand_e[4];
			$arfe = $rand_e[5];

			$weps = $rand_s[0];
			$wep2s = $rand_s[1];
			$arbs = $rand_s[2];
			$arhs = $rand_s[3];
			$aras = $rand_s[4];
			$arfs = $rand_s[5];

			//echo "$wepe,$wep2e,$arbe,$arhe,$arae,$arfe,$weps,$wep2s,$arbs,$arhs,$aras,$arfs";

			//output description logs.
			$log .= '似乎你身上的装备的效果和耐久都出现了变化！<br>';
			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver1']);

			//check if this value is greater than half of player's 1st Yume Value, if so, we do not destroy the item.
			if($dicebreak > $clbpara['randver1'] / 3){
				$log .= '骰子落了下来，令人惊奇的是，它竟然没有被摔坏，还可以继续使用！<br>';
			}else{
			//destroy the dice item.
			$log .= '骰子落了下来，化为一缕青烟消失了……<br>';
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}
		}elseif ($itm == '［Ｄ６］') {
			$log .= '你向天空投出了骰子！<br><br>进行１ｄ６检定！<br>';
			fortuneCookie1(diceroll($clbpara['randver1']));
			//D6 - spawn a random item to player's hand.
			$log .= '骰子骨碌碌地旋转起来，变成了一件【空想道具】！<br>';
			//Populate an array desinating which kind of item this would turn into.
			$randomtype = Array('DB','DH','DA','DF','WGK','WCF','WCP','WKF','WKP','WFK','WDG','WDF','WJ','WB','HB');
			//Populate an array desinating which property can be added onto the item, we need to include an empty value for an empty roll.
			$randomprop = Array('','D','d','','E','e','','I','i','','U','u','','p','q','','W','w','','R','x','-','*','+','','A','a','V','v'
								,'','C','F','G','','P','K','z');

			$rtype = array_rand($randomtype);

			//There should be a check to ensure defensive prop only goes on defensive items and offensive prop only goes on offensive items.
			//but gosh darn it to f*cking hack of bloody hell - We'll let players taste the true power of true randomness.
			//Thus, this check is omitted - On PURPOSE!!!

			//populate this item.
			$itm0 = "【异色·空想道具】";
			//itmk is one of the values in above array, $randomtype.
			$itmk0 = $randomtype[$rtype];
			//We roll 5 times to populate the itmsk value.
			for ($i = 0; $i < 5; $i++) {
				$itemrandomproproll = diceroll(count($randomprop));
				$itmsk0 .= $randomprop[$itemrandomproproll];
			}
			//generate the item's effect and stimina, based on player's Yume values.
			$itme0 = diceroll($clbpara['randver3'] * 3);
			$itms0 = diceroll($clbpara['randver2']);

			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver1']);
			//check if this value is greater than half of player's 1st Yume Value, if so, we do not destroy the item.
			if($dicebreak > $clbpara['randver1'] / 3){
				$log .= '令人惊讶的是，你在出现的空想道具里面又发现了一枚骰子！<br>';
			}else{
			//destroy the dice item.
			$log .= '骰子落了下来，化为一缕青烟消失了……<br>';
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			}
		}elseif ($itm == '［Ｄ１０］') {
			$log .= '你向天空投出了骰子！<br><br>进行１ｄ１０检定！<br>';
			fortuneCookie1(diceroll($clbpara['randver1']));
			//D10 - spawn a random item to player's hand - Enhanced D6 with a better item pool.
			$log .= '骰子骨碌碌地旋转起来，变成了一件【空想道具】！<br>';
			//Populate an array desinating which kind of item this would turn into.
			$randomtype = Array('DB','DH','DA','DF','WGK','WCF','WCP','WKF','WKP','WFK','WDG','WDF','WJ','WB','HB');
			//Populate an array desinating which property can be added onto the item, we need to include an empty value for an empty roll.
			$randomprop = Array('','D','d','E','e','','I','i','U','u','','p','q','','W','w','','R','x','-','*','+','','A','a');

			$rtype = array_rand($randomtype);

			//There should be a check to ensure defensive prop only goes on defensive items and offensive prop only goes on offensive items.
			//AGAIN, this check is omitted - On PURPOSE!!!

			//populate this item.
			$itm0 = "【超异色·空想道具】";
			//itmk is one of the values in above array, $randomtype.
			$itmk0 = $randomtype[$rtype];
			//We roll 10 times to populate the itmsk value.
			for ($i = 0; $i < 10; $i++) {
				$itemrandomproproll = diceroll(count($randomprop));
				$itmsk0 .= $randomprop[$itemrandomproproll];
			}
			//generate the item's effect and stimina, based on player's Yume values.
			$itme0 = diceroll($clbpara['randver3'] * 3);
			$itms0 = diceroll($clbpara['randver2']);

			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver1']);
			//check if this value is greater than half of player's 1st Yume Value, if so, we do not destroy the item.
			if($dicebreak > $clbpara['randver1'] / 3){
				$log .= '令人惊讶的是，你在出现的空想道具里面又发现了一枚骰子！<br>';
			}else{
			//destroy the dice item.
			$log .= '骰子落了下来，化为一缕青烟消失了……<br>';
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			}
		}elseif ($itm == '［Ｄ２０］') {
			$log .= '你向天空投出了骰子！<br><br>进行１ｄ２０检定！<br><br>';
			fortuneCookie1(diceroll($clbpara['randver1']));
			//D20 - Randomly fill player's bag with items from player's location.
			//Get item from database.
			$result = $db->query("SELECT * FROM {$tablepre}mapitem WHERE pls = '$pls'");
			$itemnum = $db->num_rows($result);
			//First we deal with some special cases...
			//What if there's no item， or not enough items on the map?
			if($itemnum <= 6){
				$log .= '骰子落在了地上，突然碎裂成了六个更小的骰子，你的背包被骰子占满，其他物品都消失了！<br>';
				$itm1 = $itm2 = $itm3 = $itm4 = $itm5 = $itm6 = '［Ｄ６］';
				$itmk1 = $itmk2 = $itmk3 = $itmk4 = $itmk5 = $itmk6 = '🎲';
				$itme1 = $itme2 = $itme3 = $itme4 = $itme5 = $itme6 = 1;
				$itms1 = $itms2 = $itms3 = $itms4 = $itms5 = $itms6 = 1;
				$itmsk1 = $itmsk2 = $itmsk3 = $itmsk4 = $itmsk5 = $itmsk6 = '';
				$itmpara0 = $itmpara1 = $itmpara2 = $itmpara3 = $itmpara4 = $itmpara5 = $itmpara6 = '';
			}else{
				//Otherwise, we swap every item in player's bag with random items at player's location.
				$log .= '一道白光闪过，你背包中的物品都消失了，但是……<br>';
				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm1=$mi['itm'];
				$itmk1=$mi['itmk'];
				$itme1=$mi['itme'];
				$itms1=$mi['itms'];
				$itmsk1=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm1}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm2=$mi['itm'];
				$itmk2=$mi['itmk'];
				$itme2=$mi['itme'];
				$itms2=$mi['itms'];
				$itmsk2=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm2}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm3=$mi['itm'];
				$itmk3=$mi['itmk'];
				$itme3=$mi['itme'];
				$itms3=$mi['itms'];
				$itmsk3=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm3}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm4=$mi['itm'];
				$itmk4=$mi['itmk'];
				$itme4=$mi['itme'];
				$itms4=$mi['itms'];
				$itmsk4=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm4}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm5=$mi['itm'];
				$itmk5=$mi['itmk'];
				$itme5=$mi['itme'];
				$itms5=$mi['itms'];
				$itmsk5=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm5}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm6=$mi['itm'];
				$itmk6=$mi['itmk'];
				$itme6=$mi['itme'];
				$itms6=$mi['itms'];
				$itmsk6=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm6}</span>！<br>";
			}
			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver1']);
			if($dicebreak > $clbpara['randver1'] / 3){
				$log .= '骰子落了下来，令人惊奇的是，它竟然没有被摔坏，还可以继续使用！<br>';
				$itm0 = '［Ｄ２０］';
				$itmk0 = '🎲';
				$itme0 = $itms0 = 1;
				$itmsk0 = '';
			}
		}elseif ($itm == '［Ｄ４０］') {
			$log .= '你向天空投出了骰子！<br><br>进行１ｄ４０检定！<br><br>';
			fortuneCookie1(diceroll($clbpara['randver1']));
			//D40 - Randomly fill player's bag with items from all mapitems. - Enhanced D20
			//Get item from database.
			$result = $db->query("SELECT * FROM {$tablepre}mapitem");
			$itemnum = $db->num_rows($result);
			//First we deal with some special cases...
			//What if there's no item， or not enough items on the map?
			if($itemnum <= 6){
				$log .= '骰子落在了地上，突然碎裂成了六个更小的骰子，你的背包被骰子占满，其他物品都消失了！<br>';
				$itm1 = $itm2 = $itm3 = $itm4 = $itm5 = $itm6 = '［Ｄ１０］';
				$itmk1 = $itmk2 = $itmk3 = $itmk4 = $itmk5 = $itmk6 = '🎲';
				$itme1 = $itme2 = $itme3 = $itme4 = $itme5 = $itme6 = 1;
				$itms1 = $itms2 = $itms3 = $itms4 = $itms5 = $itms6 = 1;
				$itmsk1 = $itmsk2 = $itmsk3 = $itmsk4 = $itmsk5 = $itmsk6 = '';
				$itmpara1 = $itmpara2 = $itmpara3 = $itmpara4 = $itmpara5 = $itmpara6 = '';
			}else{
				//Otherwise, we swap every item in player's bag with random items at player's location.
				$log .= '一道白光闪过，你背包中的物品都消失了，但是……<br>';
				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm1=$mi['itm'];
				$itmk1=$mi['itmk'];
				$itme1=$mi['itme'];
				$itms1=$mi['itms'];
				$itmsk1=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm1}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm2=$mi['itm'];
				$itmk2=$mi['itmk'];
				$itme2=$mi['itme'];
				$itms2=$mi['itms'];
				$itmsk2=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm2}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm3=$mi['itm'];
				$itmk3=$mi['itmk'];
				$itme3=$mi['itme'];
				$itms3=$mi['itms'];
				$itmsk3=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm3}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm4=$mi['itm'];
				$itmk4=$mi['itmk'];
				$itme4=$mi['itme'];
				$itms4=$mi['itms'];
				$itmsk4=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm4}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm5=$mi['itm'];
				$itmk5=$mi['itmk'];
				$itme5=$mi['itme'];
				$itms5=$mi['itms'];
				$itmsk5=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm5}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm6=$mi['itm'];
				$itmk6=$mi['itmk'];
				$itme6=$mi['itme'];
				$itms6=$mi['itms'];
				$itmsk6=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm6}</span>！<br>";
			}
			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver1']);
			if($dicebreak > $clbpara['randver1'] / 4){
				$log .= '骰子落了下来，令人惊奇的是，它竟然没有被摔坏，还可以继续使用！<br>';
				$itm0 = '［Ｄ４０］';
				$itmk0 = '🎲';
				$itme0 = $itms0 = 1;
				$itmsk0 = '';
			}
		}elseif ($itm == '［Ｄ１００］') {
			$log .= '你向天空投出了骰子！<br><br>进行１ｄ１００检定！<br><br>';
			fortuneCookie1(diceroll($clbpara['randver1']));
			//D100 - Shuffle the player's mhp, msp, mss, atk, def and all w values.
			//Firstly, are you the chosen one?
			$chosenone = 1;
			if ($clbpara['randver1'] == 77 || $clbpara['randver1'] == 111){
				$chosenone += 1;
			}
			if ($clbpara['randver2'] == 233 || $clbpara['randver2'] == 211){
				$chosenone += 1;
			}
			if ($clbpara['randver3'] == 573 || $clbpara['randver2'] == 765){
				$chosenone += 1;
			}
			//Then, we calculate your new values:
			$log .= '你突然觉得头晕目眩！<br>';
			//->mhp and msp
			$tvalue = round(($mhp + $msp + $mss) / 2);
			//Make sure you don't die from this.
			$hp = $mhp = (diceroll($tvalue) + 1) * $chosenone;
			$sp = $msp = (diceroll($tvalue) + 1) * $chosenone;
			$mss = (diceroll($tvalue) + 1) * $chosenone;
			$ss = round($mss / 2);
			$log .= '你的最大生命，最大体力值与歌魂发生了变化！<br>';
			//->atk and def
			$avalue = round(($att + $def) / 1.5);
			$att = (diceroll($avalue) + 1) * $chosenone;
			$def = (diceroll($avalue) + 1) * $chosenone;
			$log .= '你的攻击力与防御力发生了变化！<br>';
			//->w values
			$wvalue = round(($wp + $wk + $wd + $wc + $wg + $wf) / 4);
			$wp = (diceroll($wvalue) + 1) * $chosenone;
			$wk = (diceroll($wvalue) + 1) * $chosenone;
			$wd = (diceroll($wvalue) + 1) * $chosenone;
			$wc = (diceroll($wvalue) + 1) * $chosenone;
			$wg = (diceroll($wvalue) + 1) * $chosenone;
			$wf = (diceroll($wvalue) + 1) * $chosenone;
			$log .= '你的武器熟练度发生了变化！<br>';

			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver2']);
			//check if this value is greater than player's 1st Yume Value, if so, we do not destroy the item.
			if($dicebreak > $clbpara['randver1']){
				$log .= '骰子落了下来，令人惊奇的是，它竟然没有被摔坏，还可以继续使用！<br>';
			}else{
			//destroy the dice item.
			$log .= '骰子落了下来，化为一缕青烟消失了……<br>';
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			}
		}elseif ($itm == '［Ｄ１０００］') {
			$log .= '你投出了这个骰子！<br>骰子飞上了天空，变成了三个不同的骰子！这真是太炫酷了！<br>';
			//D1000 - Does all of the above, based on player's Yume Values.
			//D3
			if ($clbpara['randver1'] > 64){
				fortuneCookie1(diceroll($clbpara['randver1']));
				$rand_e = array($wepe, $wep2e, $arbe, $arhe, $arae, $arfe);
				$rand_s = array($weps, $wep2s, $arbs, $arhs, $aras, $arfs);
				$etotal = round(($wepe + $wep2e + $arbe + $arhe + $arae + $arfe) / 2);
				$stotal = round(($weps + $wep2s + $arbs + $arhs + $aras + $arfs) / 2);
				//Loop through the effect and stamina arrays, randomize each one that's not 0
				foreach ($rand_s as $key => &$value) {
					if ($value != 0) {
						$value = diceroll($stotal);
					}
				}

				foreach ($rand_e as $key => &$value) {
					if ($value != 0) {
						$value = diceroll($etotal);
					}
				}

			//place the contents of arraies back to player equipment.
			//This dice doubles the power of all items.
			$wepe = $rand_e[0] * 2;
			$wep2e = $rand_e[1]* 2;
			$arbe = $rand_e[2]* 2;
			$arhe = $rand_e[3]* 2;
			$arae = $rand_e[4]* 2;
			$arfe = $rand_e[5]* 2;

			$weps = $rand_s[0]* 2;
			$wep2s = $rand_s[1]* 2;
			$arbs = $rand_s[2]* 2;
			$arhs = $rand_s[3]* 2;
			$aras = $rand_s[4]* 2;
			$arfs = $rand_s[5]* 2;

			//output description logs.
			$log .= '似乎你身上的装备的效果和耐久都出现了变化！<br>';
			}else{
				$log .= '其中一个骰子就这么飞出了你的视野，你看不到它的出目！<br>';
			}

			//D20
			if ($clbpara['randver2'] > 128){
				fortuneCookie1(diceroll($clbpara['randver1']));
			//Different from the normal D20, this pulls from entire mapitem table.
			$result = $db->query("SELECT * FROM {$tablepre}mapitem");
			$itemnum = $db->num_rows($result);
			//First we deal with some special cases...
			//What if there's no item， or not enough items on the map?
			if($itemnum <= 6){
				$log .= '骰子落在了地上，突然碎裂成了六个更小的骰子，你的背包被骰子占满，其他物品都消失了！<br>';
				$itm1 = $itm2 = $itm3 = $itm4 = $itm5 = $itm6 = '［Ｄ６］';
				$itmk1 = $itmk2 = $itmk3 = $itmk4 = $itmk5 = $itmk6 = '🎲';
				$itme1 = $itme2 = $itme3 = $itme4 = $itme5 = $itme6 = 1;
				$itms1 = $itms2 = $itms3 = $itms4 = $itms5 = $itms6 = 1;
				$itmsk1 = $itmsk2 = $itmsk3 = $itmsk4 = $itmsk5 = $itmsk6 = '';
				$itmpara1 = $itmpara2 = $itmpara3 = $itmpara4 = $itmpara5 = $itmpara6 = 0;
			}else{
				//Otherwise, we swap every item in player's bag with random items at player's location.
				$log .= '一道白光闪过，你背包中的物品都消失了，但是……<br>';
				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm1=$mi['itm'];
				$itmk1=$mi['itmk'];
				$itme1=$mi['itme'];
				$itms1=$mi['itms'];
				$itmsk1=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm1}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm2=$mi['itm'];
				$itmk2=$mi['itmk'];
				$itme2=$mi['itme'];
				$itms2=$mi['itms'];
				$itmsk2=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm2}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm3=$mi['itm'];
				$itmk3=$mi['itmk'];
				$itme3=$mi['itme'];
				$itms3=$mi['itms'];
				$itmsk3=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm3}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm4=$mi['itm'];
				$itmk4=$mi['itmk'];
				$itme4=$mi['itme'];
				$itms4=$mi['itms'];
				$itmsk4=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm4}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm5=$mi['itm'];
				$itmk5=$mi['itmk'];
				$itme5=$mi['itme'];
				$itms5=$mi['itms'];
				$itmsk5=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm5}</span>！<br>";

				$itemno = rand(0,$itemnum-1);
				$db->data_seek($result,$itemno);
				$mi=$db->fetch_array($result);
				$itm6=$mi['itm'];
				$itmk6=$mi['itmk'];
				$itme6=$mi['itme'];
				$itms6=$mi['itms'];
				$itmsk6=$mi['itmsk'];
				$iid=$mi['iid'];
				$db->query("DELETE FROM {$tablepre}mapitem WHERE iid='$iid'");
				$log .= "你获得了<span class=\"yellow\">{$itm6}</span>！<br>";
			}
			}else{
				$log .= '其中一个骰子就这么飞出了你的视野，你看不到它的出目！<br>';
			}

			//D100
			if ($clbpara['randver3'] < 1024){
				fortuneCookie1(diceroll($clbpara['randver1']));
				//This dice is triple the power of original D100.
				$chosenone = 3;
				if ($clbpara['randver1'] == 77 || $clbpara['randver1'] == 111){
					$chosenone += 2;
				}
				if ($clbpara['randver2'] == 233 || $clbpara['randver2'] == 211){
					$chosenone += 2;
				}
				if ($clbpara['randver3'] == 573 || $clbpara['randver2'] == 765){
					$chosenone += 2;
				}
				//Then, we calculate your new values:
				$log .= '你突然觉得头晕目眩！<br>';
				//->mhp and msp
				$tvalue = $mhp + $msp + $mss;
				//Make sure you don't die from this.
				$hp = $mhp = (diceroll($tvalue) + 1) * $chosenone;
				$sp = $msp = (diceroll($tvalue) + 1) * $chosenone;
				$mss = (diceroll($tvalue) + 1) * $chosenone;
				$ss = round($mss / 2);
				$log .= '你的最大生命，最大体力值与歌魂发生了变化！<br>';
				//->atk and def
				$avalue = $att + $def;
				$att = (diceroll($avalue) + 1) * $chosenone;
				$def = (diceroll($avalue) + 1) * $chosenone;
				$log .= '你的攻击力与防御力发生了变化！<br>';
				//->w values
				$wvalue = $wp + $wk + $wd + $wc + $wg + $wf;
				$wp = (diceroll($wvalue) + 1) * $chosenone;
				$wk = (diceroll($wvalue) + 1) * $chosenone;
				$wd = (diceroll($wvalue) + 1) * $chosenone;
				$wc = (diceroll($wvalue) + 1) * $chosenone;
				$wg = (diceroll($wvalue) + 1) * $chosenone;
				$wf = (diceroll($wvalue) + 1) * $chosenone;
				$log .= '你的武器熟练度发生了变化！<br>';
			}else{
				$log .= '其中一个骰子就这么飞出了你的视野，你看不到它的出目！<br>';
			}
			//Generate a random number based on player's 1st Yume Value.
			$dicebreak = diceroll($clbpara['randver1']);
			//check if this value is greater than half of player's 1st Yume Value, if so, we do not destroy the item.
			if($dicebreak > $clbpara['randver1'] / 3){
				$log .= '骰子再次合成一体，落了下来，令人惊奇的是，它竟然没有被摔坏，还可以继续使用！<br>';
			}else{
			//destroy the dice item.
			$log .= '骰子落了下来，化为一缕青烟消失了……<br>';
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			}
		}
	}elseif (strpos ( $itmk, '🥚' ) === 0 ) {
		//🥚 items does a variety of different things based on its itmsk - may expand in the future.
		if (strpos ( $itmsk, 'J' ) === 0){
			//J item turns into a yugioh pack.
			$log .= '你将这个蛋捧在手里仔细端详着……<br>它突然变成了一包卡牌！<br>';
			//destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//generate a yugioh pack in player's hand.
			$itm0 = '游戏王卡包';
			$itmk0 = 'ygo';
			$itme0 = 1;
			$itms0 = 1;
			$itmsk0 = '';
		}elseif (strpos ( $itmsk, 's' ) === 0){
			//s item turns into a yugioh pack.
			//TODO: May actually implement new yugioh packs for Exceed and Synchro only packs.
			$log .= '你将这个蛋捧在手里仔细端详着……<br>它突然变成了一包卡牌！<br>';
			//destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//generate a yugioh pack in player's hand.
			$itm0 = '游戏王卡包';
			$itmk0 = 'ygo';
			$itme0 = 1;
			$itms0 = 1;
			$itmsk0 = '';
		}elseif (strpos ( $itmsk, 'X' ) === 0){
			//X item turns into a Deathnote.
			$log .= '你将这个蛋捧在手里仔细端详着……<br>它突然变成了一本黑色的小册子<br>卧槽，这不会是……<br>';
			//destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//generate a Deathnote in player's hand.
			$itm0 = '■DeathNote■';
			$itmk0 = 'Y';
			$itme0 = 1;
			$itms0 = 1;
			$itmsk0 = '';
		}elseif (strpos ( $itmsk, 'x' ) === 0){
			//x item turns into a super recovery item.
			$log .= '你将这个蛋捧在手里仔细端详着……<br>它突然变成了一包卡牌！<br>';
			//destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//generate the item in player's hand.
			$itm0 = '奇迹的元素';
			$itmk0 = 'HB';
			$itme0 = 65535;
			$itms0 = 1;
			$itmsk0 = 'z';
		}elseif (strpos ( $itmsk, 'v' ) === 0){
			//v item curses player's current weapon.
			$log .= '你看了一眼这个蛋，就理解了它的用法。<br>你痛快地……吃掉了它？<br>你感觉到你的武器泛起了一股诅咒的力量……<br>';
			//destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//Apply curses to player's current holding weapon.
			$wepsk .='v';
		}elseif (strpos ( $itmsk, 'V' ) === 0){
			//X item make player's current weapon soulbind.
			$log .= '你看了一眼这个蛋，就理解了它的用法。<br>你痛快地……吃掉了它？<br>你感觉到你的武器绑定在了你的身上……<br>';
			//destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//Apply soulbind to player's current holding weapon.
			$wepsk .='V';
		}else{
			//FUTURE FEAT: We can make so much use of this in the future.
			$log .= '你似乎听到了一个佻皮的女孩声音：<br><br>“这个代码片段……不妨以后再来探索吧！”<br>';
		}
	}elseif (strpos ( $itmk, '🎆' ) === 0 ) {
		//В ΜΑЛΨ, В ЩΑЁΨ, В ЦΨΨ ОΑЙЙ, В ТИХ ЩДТЖИΜД.
		//ХЖ ДЖХЖТ, ЖХΨ ЦЩТΑВΜДЩ ТЖΑΡ, ΜΨЩ. ЩДВХΜЦ. ΡЖХΨ.
		//Thanks Chantal for crunching those numbers - I'll make sure I find you something else to crunch on some other time...
		# This method concerns 4 of them, and one additional check:
		//$hp up, $w[X] up, $mhp up, $def up

		# Then, decide on the Rank of the Fireseed Item, this will decide its maximum value:
		$rank = 0;
		# Those items will always start with either ◆,✦,★,☾, and ☼
		if (strpos ( $itm, '◆' ) === 0){
			$rank = 1;
		}elseif (strpos ( $itm, '✦' ) === 0){
			$rank = 2;
		}elseif (strpos ( $itm, '★' ) === 0){
			$rank = 3;
		}elseif (strpos ( $itm, '☾' ) === 0){
			$rank = 4;
		}elseif (strpos ( $itm, '☼') === 0){
			$rank = 5;
		}else{
			$rank = 0;
		}

		# Special check for a invalid item (Rank = 0), Just turn it into healing.
		if($rank == 0){
			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚，你感觉焕然一新！<br>";
			$hp = $mhp;
			$sp = $msp;

			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}
		}

		# Logic for each of the 4 usages.
		elseif($itmk == '🎆H'){
			# This is healing item, it can heal beyond your $mhp based on its rank.
			if ($rank == 1){
				$gainmax = round($mhp * 0.51);
			}elseif ($rank == 2){
				$gainmax = round($mhp * 1.08);
			}elseif ($rank == 3){
				$gainmax = round($mhp * 2.33);
			}elseif ($rank == 4){
				$gainmax = round($mhp * 5.73);
			}else{
				$gainmax = '∞';
			}
			// Tracking how much HP one can overheal based on its rank.
			$clbpara['fireseedMaxHPRecover'] = $gainmax;
			if ($gainmax !== '∞'){
			// Gain HP and SP - note we don't overheal SP here.

			$addsp = $msp - $sp < $itme ? $msp - $sp : $itme;
			if($addsp > 0) $sp += $addsp;
			else $addsp = 0;
			// Calculating overheal HP value.
			$addhp = ($mhp + $gainmax) - $hp < $itme ? ($mhp + $gainmax) - $hp : $itme;
			if($addhp > 0) $hp += $addhp;
			else $addhp = 0;

			if ($addhp <= 0){
				$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
				但是似乎并没有回复生命！<br>
				<br>
				<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
				「你可能需要找个纯度更高的代码片段哟~」<br></span>";
			}else{

			$gainless = ($mhp + $gainmax) - $hp;

			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			治愈的代码片段为你恢复了<span class=\"yellow\">$addhp</span>点生命和<span class=\"yellow\">$addsp</span>点体力。<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你还能获得{$gainless}点临时生命哟~<br>
			但临时生命就是临时的，随时都有可能消失哟~」<br></span>";

			if($gainless < $itme){
				$log.="<br><span class=\"redseed\">这时，有另一把声音插了进来：<br>
				「看起来这个纯度的代码片段已经喂不饱你了。<br>
				赶快找下一个纯度的代码片段吧！」<br></span>";
			}

			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}
		}
			}else{
				$addsp = $msp - $sp < $itme ? $msp - $sp : $itme;
				if($addsp > 0) $sp += $addsp;
				else $addsp = 0;

				$addhp = $itme;
				$hp += $addhp;

				$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			治愈的代码片段为你恢复了<span class=\"yellow\">$addhp</span>点生命和<span class=\"yellow\">$addsp</span>点体力。<br>";

			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}
			}
		}elseif ($itmk == '🎆V'){
			# This is $w[X] up, it simply add to all $w[X] values.
			if ($rank == 1){
				$gainmax = 201;
			}elseif ($rank == 2){
				$gainmax = 502;
			}elseif ($rank == 3){
				$gainmax = 2003;
			}elseif ($rank == 4){
				$gainmax = 8011;
			}else{
				$gainmax = '∞';
			}
			// Tracking how much w value one can gain based on its rank.
			$clbpara['fireseedmaxProfGain'] = $gainmax;
			if ($gainmax !== '∞'){
			// Gain w value

			$addw = $itme;
			$clbpara['fireseedmaxProfAdd'] += $addw;
			if($clbpara['fireseedmaxProfGain'] - $clbpara['fireseedmaxProfAdd'] > 0) {
				$wp += $addw;
				$wk += $addw;
				$wg += $addw;
				$wc += $addw;
				$wd += $addw;
				$wf += $addw;}
			else $addw = 0;

			if ($addw <= 0){
			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			但是似乎什么都没有发生！<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你可能需要找个纯度更高的代码片段哟~」<br></span>";
			}else{

			$gainless = $clbpara['fireseedmaxProfGain'] - $clbpara['fireseedmaxProfAdd'];

			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			载有熟练度的代码片段让你获得了<span class=\"yellow\">$addw</span>点全系熟练度！<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你还能通过这个纯度的代码获得{$gainless}点熟练度哟~」<br></span>";

			if($gainless < $itme){
				$log.="<br><span class=\"redseed\">这时，有另一把声音插了进来：<br>
				「看起来这个纯度的代码片段已经喂不饱你了。<br>
				赶快找下一个纯度的代码片段吧！」<br></span>";
			}

			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}

			}
			}else{
				$addw = $itme;
				$wp += $addw;
				$wk += $addw;
				$wg += $addw;
				$wc += $addw;
				$wd += $addw;
				$wf += $addw;

				$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
				载有熟练度的代码片段让你获得了<span class=\"yellow\">$addw</span>点全系熟练度！<br>";

				if ($itms != $nosta) {
					$itms --;
					if ($itms <= 0) {
						$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
						$itm = $itmk = $itmsk = '';
						$itme = $itms = 0;
					}
				}
			}
		}elseif ($itmk == '🎆O'){
			# This is $mhp up item, it simply add to that value.
			if ($rank == 1){
				$gainmax = 1001;
			}elseif ($rank == 2){
				$gainmax = 3002;
			}elseif ($rank == 3){
				$gainmax = 5003;
			}elseif ($rank == 4){
				$gainmax = 8008;
			}else{
				$gainmax = '∞';
			}
			// Tracking how much $mhp value one can gain based on its rank.
			$clbpara['fireseedmaxHPGain'] = $gainmax;
			if ($gainmax !== '∞'){
			// Gain $mhp value

			$addmhp = $itme;
			$clbpara['fireseedmaxHPAdd'] += $addmhp;
			if($clbpara['fireseedmaxHPGain'] - $clbpara['fireseedmaxHPAdd'] > 0) $mhp += $addmhp;
			else $addmhp = 0;

			if ($addmhp <= 0){
			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			但是似乎什么都没有发生！<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你可能需要找个纯度更高的代码片段哟~」<br></span>";
			}else{

			$gainless = $clbpara['fireseedmaxHPGain'] - $clbpara['fireseedmaxHPAdd'];

			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			载有生命的代码片段让你获得了<span class=\"yellow\">$addmhp</span>点生命最大值！<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你还能通过这个纯度的代码获得{$gainless}点生命最大值哟~」<br></span>";

			if($gainless < $itme){
				$log.="<br><span class=\"redseed\">这时，有另一把声音插了进来：<br>
				「看起来这个纯度的代码片段已经喂不饱你了。<br>
				赶快找下一个纯度的代码片段吧！」<br></span>";

			}

			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}

			}
			}else{
				$addw = $itme;
				$mhp += $addmhp;

				$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
				载有生命的代码片段让你获得了<span class=\"yellow\">$addmhp</span>点生命最大值！<br>";

				if ($itms != $nosta) {
					$itms --;
					if ($itms <= 0) {
						$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
						$itm = $itmk = $itmsk = '';
						$itme = $itms = 0;
					}
				}
			}
		}elseif ($itmk == '🎆D'){
			# This is $def up item, it simply add to that value.
			if ($rank == 1){
				$gainmax = 1001;
			}elseif ($rank == 2){
				$gainmax = 3002;
			}elseif ($rank == 3){
				$gainmax = 5003;
			}elseif ($rank == 4){
				$gainmax = 8008;
			}else{
				$gainmax = '∞';
			}
			// Tracking how much $def value one can gain based on its rank.
			$clbpara['fireseedmaxDefGain'] = $gainmax;
			if ($gainmax !== '∞'){
			// Gain $def value

			$adddef = $itme;
			$clbpara['fireseedmaxDefAdd'] += $adddef;
			if($clbpara['fireseedmaxDefGain'] - $clbpara['fireseedmaxDefAdd'] > 0) $def += $adddef;
			else $adddef = 0;

			if ($adddef <= 0){
			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			但是似乎什么都没有发生！<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你可能需要找个纯度更高的代码片段哟~」<br></span>";
			}else{

			$gainless = $clbpara['fireseedmaxDefGain'] - $clbpara['fireseedmaxDefAdd'];

			$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
			载有防御数据的代码片段让你获得了<span class=\"yellow\">$adddef</span>点基础防御力！<br>
			<br>
			<br>
			<span class=\"blueseed\">同时，你还隐约听见了一个声音：<br>
			「你还能通过这个纯度的代码获得{$gainless}点基础防御力哟~」<br></span>";

			if($gainless < $itme){
				$log.="<br><span class=\"redseed\">这时，有另一把声音插了进来：<br>
				「看起来这个纯度的代码片段已经喂不饱你了。<br>
				赶快找下一个纯度的代码片段吧！」<br></span>";
			}
			if ($itms != $nosta) {
				$itms --;
				if ($itms <= 0) {
					$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}

			}
			}else{
				$adddef = $itme;
				$def += $adddef;

				$log.="你将<span class=\"yellow\">{$itm}</span>吞下了肚。<br>
				载有防御数据的代码片段让你获得了<span class=\"yellow\">$adddef</span>点基础防御力！<br>";

				if ($itms != $nosta) {
					$itms --;
					if ($itms <= 0) {
						$log .= "<span class=\"red\">$itm</span>的余烬崩解消失了……<br>";
						$itm = $itmk = $itmsk = '';
						$itme = $itms = 0;
					}
				}
			}

		}elseif($itmk == '🎆B'){
			# Fireseed Box, containing various helpful items.
			# Officially dubbed Silent Box.
			$log.="你打开了<span class=\"yellow\">$itm</span>。<br>";

			$itms--; $oitm = $itm; $oitmk = $itmk;

			include_once config('randomFS',$gamecfg);

			$dice = diceroll(1000);
			if($dice <= 420){
				$itemflag = $lesserdata;
			}elseif($dice <= 740){
				$itemflag = $item;
			}elseif($dice <= 927){
				$itemflag = $constructs;
			}elseif($dice <= 998){
				$itemflag = $material;
			}else{
				$itemflag = $sundata;
				$clbpara['achvars']['gacha_ssr'] += 1;
			}
			if($itemflag){
				$itemflag = explode("\r\n",$itemflag);
				$rand = rand(0,count($itemflag)-1);
				list($in,$ik,$ie,$is,$isk) = explode(',',$itemflag[$rand]);
			}

			if($itms <= 0) destory_single_item($data,$itmn,1);
			$itm0 = $in;$itmk0=$ik;$itme0=$ie;$itms0=$is;$itmsk0=$isk;
			if($itemflag = $sundata) addnews($now,'present',$name,$oitm,$in,$nick);

			include_once GAME_ROOT.'./include/game/itemmain.func.php';
			itemget($data);

		}elseif($itmk == '🎆C'){
			# Weird Fireseed Box, containing interesting items.
			# Officially dubbed Weird Box.
			$log.="你打开了<span class=\"yellow\">$itm</span>。<br>";

			$itms--; $oitm = $itm; $oitmk = $itmk;

			include_once config('randomFSW',$gamecfg);

			$dice = diceroll(1000);
			if($dice <= 660){
				$itemflag = $selfjoke;
			}elseif($dice <= 996){
				$itemflag = $jokeonothers;
			}else{
				$itemflag = $superjoke;
				$clbpara['achvars']['gacha_ssr'] += 1;
			}
			if($itemflag){
				$itemflag = explode("\r\n",$itemflag);
				$rand = rand(0,count($itemflag)-1);
				list($in,$ik,$ie,$is,$isk) = explode(',',$itemflag[$rand]);
			}

			if($itms <= 0) destory_single_item($data,$itmn,1);
			$itm0 = $in;$itmk0=$ik;$itme0=$ie;$itms0=$is;$itmsk0=$isk;
			if($itemflag = $sundata) addnews($now,'present',$name,$oitm,$in,$nick);

			include_once GAME_ROOT.'./include/game/itemmain.func.php';
			itemget($data);

		}else{
			$log.="这段代码……要如何使用呢？<br>";
		}

		//Process a special check for total Ash item used, for future usage.
		$clbpara['fireseedAshUsage'] += $rank;

		//Process item decrease. - Changed to do it only after succeeding item usage.
/* 		if ($itms != $nosta) {
			$itms --;
			if ($itms <= 0) {
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} */
	# Special check for a poisoned fireseed item, WIP for now.

	}elseif($itmk == 'P🎆'){
		$log.="这个<span class=\"yellow\">{$itm}</span>有毒！到底是谁干的！<br>";
		# For Maximum Funniness, we destroy this item.
		$log .= "<span class=\"red\">$itm</span>的余烬向天上盘旋飞舞，消失了。<br>";
		$itm = $itmk = $itmsk = '';
		$itme = $itms = 0;
	}elseif (strpos ( $itmk, '💝' ) === 0 ) {
		// NPC Platform Logic starts here.- 2024-07-24
		// Part 0: Extracting some special values from $itmpara.
		$targetChargeBaseValue = (int)$itmpara['PlatformChargeBaseValue'] + $itme;
		$playerOriginalName = $name;
		$platformPlayerMode = $itmpara['PlatformPlayerMode'];
		$platformPlayerPID = $itmpara['PlatformPlayerPID'];
		$platformPlayerName = $itmpara['PlatformPlayerName'];
		// 1st part: decides if the item is a pid type.
		if($platformPlayerMode == 2 && isset($platformPlayerPID)){
			//Extract the target player PID.
			$targetPID = $platformPlayerPID;
			//Extract all other data by going into Player Table.
			$result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='$targetPID' LIMIT 1");
			$targetData = $db->fetch_array($result);
			//Extract Process
			//Name
			$targetname = $targetData['name'];
			$targeticon = $targetData['icon'];
			$targettype = $targetData['type'];
			//Stats
			$targetlvl = $targetData['lvl'];$targetexp = $targetData['exp'];
			$targetclub = $targetData['club'];$targetclubskill = $targetData['clubskill'];
			$targetclubskillpara = $targetData['clubskillpara'];$targetskills = $targetData['skills'];
			$targetskill = $targetData['skill'];
			$targetwp = $targetData['wp'];$targetwk = $targetData['wk'];$targetwg = $targetData['wg'];
			$targetwc = $targetData['wc'];$targetwd = $targetData['wd'];$targetwf = $targetData['wf'];
			$targetinf = $targetData['inf'];
			$targetgd = $targetData['gd'];
			$targetmhp = $targetData['mhp'];$targetmsp = $targetData['msp'];$targetmss = $targetData['mss'];
			$targetatt = $targetData['att'];$targetdef = $targetData['def'];
			$targetrp = $targetData['rp'];$targetrage = $targetData['rage'];
			//Weapon + Armor
			$targetwep = $targetData['wep'];$targetwepk = $targetData['wepk'];$targetwepe = $targetData['wepe'];
			$targetweps = $targetData['weps'];$targetwepsk = $targetData['wepsk'];$targetweppara = $targetData['weppara'];
			$targetarb = $targetData['arb'];$targetarbk = $targetData['arbk'];$targetarbe = $targetData['arbe'];
			$targetarbs = $targetData['arbs'];$targetarbsk = $targetData['arbsk'];$targetarbpara = $targetData['arbpara'];
			$targetarh = $targetData['arh'];$targetarhk = $targetData['arhk'];$targetarhe = $targetData['arhe'];
			$targetarhs = $targetData['arhs'];$targetarhsk = $targetData['arhsk'];$targetarhpara = $targetData['arhpara'];
			$targetara = $targetData['ara'];$targetarak = $targetData['arak'];$targetarae = $targetData['arae'];
			$targetaras = $targetData['aras'];$targetarask = $targetData['arask'];$targetarapara = $targetData['arapara'];
			$targetarf = $targetData['arf'];$targetarfk = $targetData['arfk'];$targetarfe = $targetData['arfe'];
			$targetarfs = $targetData['arfs'];$targetarfsk = $targetData['arfsk'];$targetarfpara = $targetData['arfpara'];
			$targetart = $targetData['art'];$targetartk = $targetData['artk'];$targetarte = $targetData['arte'];
			$targetarts = $targetData['arts'];$targetartsk = $targetData['artsk'];$targetartpara = $targetData['artpara'];
			//Items
			$targetitm1 = $targetData['itm1'];$targetitmk1 = $targetData['itmk1'];$targetitme1 = $targetData['itme1'];
			$targetitms1 = $targetData['itms1'];$targetitmsk1 = $targetData['itmsk1'];$targetitmpara1 = $targetData['itmpara1'];
			$targetitm2 = $targetData['itm2'];$targetitmk2 = $targetData['itmk2'];$targetitme2 = $targetData['itme2'];
			$targetitms2 = $targetData['itms2'];$targetitmsk2 = $targetData['itmsk2'];$targetitmpara2 = $targetData['itmpara2'];
			$targetitm3 = $targetData['itm3'];$targetitmk3 = $targetData['itmk3'];$targetitme3 = $targetData['itme3'];
			$targetitms3 = $targetData['itms3'];$targetitmsk3 = $targetData['itmsk3'];$targetitmpara3 = $targetData['itmpara3'];
			$targetitm4 = $targetData['itm4'];$targetitmk4 = $targetData['itmk4'];$targetitme4 = $targetData['itme4'];
			$targetitms4 = $targetData['itms4'];$targetitmsk4 = $targetData['itmsk4'];$targetitmpara4 = $targetData['itmpara4'];
			$targetitm5 = $targetData['itm5'];$targetitmk5 = $targetData['itmk5'];$targetitme5 = $targetData['itme5'];
			$targetitms5 = $targetData['itms5'];$targetitmsk5 = $targetData['itmsk5'];$targetitmpara5 = $targetData['itmpara5'];
			$targetitm6 = $targetData['itm6'];$targetitmk6 = $targetData['itmk6'];$targetitme6 = $targetData['itme6'];
			$targetitms6 = $targetData['itms6'];$targetitmsk6 = $targetData['itmsk6'];$targetitmpara6 = $targetData['itmpara6'];
			//Other values
			$targetclbpara = $targetData['clbpara'];
			$targetclbstatusa = $targetData['clbstatusa'];$targetclbstatusb = $targetData['clbstatusb'];$targetclbstatusc = $targetData['clbstatusc'];$targetclbstatusd = $targetData['clbstatusd'];$targetclbstatuse = $targetData['clbstatuse'];
			$targetnikstatusa = $targetData['nikstatusa'];$targetnikstatusb = $targetData['nikstatusb'];$targetnikstatusc = $targetData['nikstatusc'];$targetnikstatusd = $targetData['nikstatusd'];$targetnikstatuse = $targetData['nikstatuse'];
		}elseif($platformPlayerMode != 2 && isset($platformPlayerName)){
			//Extract Following values from item
			//Name
			$targetname = $itmpara['PlatformPlayername'];
			$targeticon = $itmpara['PlatformPlayericon'];
			//Stats
			$targetlvl = $itmpara['PlatformPlayerlvl'];$targetexp = $itmpara['PlatformPlayerexp'];
			$targetclub = $itmpara['PlatformPlayerclub'];$targetclubskill = $itmpara['PlatformPlayerclubskill'];
			$targetclubskillpara = $itmpara['PlatformPlayerclubskillpara'];$targetskills = $itmpara['PlatformPlayerskills'];
			$targetskill = $itmpara['PlatformPlayerskill'];
			$targetwp = $itmpara['PlatformPlayerwp'];$targetwk = $itmpara['PlatformPlayerwk'];$targetwg = $itmpara['PlatformPlayerwg'];
			$targetwc = $itmpara['PlatformPlayerwc'];$targetwd = $itmpara['PlatformPlayerwd'];$targetwf = $itmpara['PlatformPlayerwf'];
			$targetinf = $itmpara['PlatformPlayerinf'];
			$targetgd = $itmpara['PlatformPlayergd'];
			$targetmhp = $itmpara['PlatformPlayermhp'];$targetmsp = $itmpara['PlatformPlayermsp'];$targetmss = $itmpara['PlatformPlayermss'];
			$targetatt = $itmpara['PlatformPlayeratt'];$targetdef = $itmpara['PlatformPlayerdef'];
			$targetrp = $itmpara['PlatformPlayerrp'];$targetrage = $itmpara['PlatformPlayerrage'];
			//Weapon + Armor
			$targetwep = $itmpara['PlatformPlayerwep'];$targetwepk = $itmpara['PlatformPlayerwepk'];$targetwepe = $itmpara['PlatformPlayerwepe'];
			$targetweps = $itmpara['PlatformPlayerweps'];$targetwepsk = $itmpara['PlatformPlayerwepsk'];$targetweppara = $itmpara['PlatformPlayerweppara'];
			$targetarb = $itmpara['PlatformPlayerarb'];$targetarbk = $itmpara['PlatformPlayerarbk'];$targetarbe = $itmpara['PlatformPlayerarbe'];
			$targetarbs = $itmpara['PlatformPlayerarbs'];$targetarbsk = $itmpara['PlatformPlayerarbsk'];$targetarbpara = $itmpara['PlatformPlayerarbpara'];
			$targetarh = $itmpara['PlatformPlayerarh'];$targetarhk = $itmpara['PlatformPlayerarhk'];$targetarhe = $itmpara['PlatformPlayerarhe'];
			$targetarhs = $itmpara['PlatformPlayerarhs'];$targetarhsk = $itmpara['PlatformPlayerarhsk'];$targetarhpara = $itmpara['PlatformPlayerarhpara'];
			$targetara = $itmpara['PlatformPlayerara'];$targetarak = $itmpara['PlatformPlayerarak'];$targetarae = $itmpara['PlatformPlayerarae'];
			$targetaras = $itmpara['PlatformPlayeraras'];$targetarask = $itmpara['PlatformPlayerarask'];$targetarapara = $itmpara['PlatformPlayerarapara'];
			$targetarf = $itmpara['PlatformPlayerarf'];$targetarfk = $itmpara['PlatformPlayerarfk'];$targetarfe = $itmpara['PlatformPlayerarfe'];
			$targetarfs = $itmpara['PlatformPlayerarfs'];$targetarfsk = $itmpara['PlatformPlayerarfsk'];$targetarfpara = $itmpara['PlatformPlayerarfpara'];
			$targetart = $itmpara['PlatformPlayerart'];$targetartk = $itmpara['PlatformPlayerartk'];$targetarte = $itmpara['PlatformPlayerarte'];
			$targetarts = $itmpara['PlatformPlayerarts'];$targetartsk = $itmpara['PlatformPlayerartsk'];$targetartpara = $itmpara['PlatformPlayerartpara'];
			//Items
			$targetitm1 = $itmpara['PlatformPlayeritm1'];$targetitmk1 = $itmpara['PlatformPlayeritmk1'];$targetitme1 = $itmpara['PlatformPlayeritme1'];
			$targetitms1 = $itmpara['PlatformPlayeritms1'];$targetitmsk1 = $itmpara['PlatformPlayeritmsk1'];$targetitmpara1 = $itmpara['PlatformPlayeritmpara1'];
			$targetitm2 = $itmpara['PlatformPlayeritm2'];$targetitmk2 = $itmpara['PlatformPlayeritmk2'];$targetitme2 = $itmpara['PlatformPlayeritme2'];
			$targetitms2 = $itmpara['PlatformPlayeritms2'];$targetitmsk2 = $itmpara['PlatformPlayeritmsk2'];$targetitmpara2 = $itmpara['PlatformPlayeritmpara2'];
			$targetitm3 = $itmpara['PlatformPlayeritm3'];$targetitmk3 = $itmpara['PlatformPlayeritmk3'];$targetitme3 = $itmpara['PlatformPlayeritme3'];
			$targetitms3 = $itmpara['PlatformPlayeritms3'];$targetitmsk3 = $itmpara['PlatformPlayeritmsk3'];$targetitmpara3 = $itmpara['PlatformPlayeritmpara3'];
			$targetitm4 = $itmpara['PlatformPlayeritm4'];$targetitmk4 = $itmpara['PlatformPlayeritmk4'];$targetitme4 = $itmpara['PlatformPlayeritme4'];
			$targetitms4 = $itmpara['PlatformPlayeritms4'];$targetitmsk4 = $itmpara['PlatformPlayeritmsk4'];$targetitmpara4 = $itmpara['PlatformPlayeritmpara4'];
			$targetitm5 = $itmpara['PlatformPlayeritm5'];$targetitmk5 = $itmpara['PlatformPlayeritmk5'];$targetitme5 = $itmpara['PlatformPlayeritme5'];
			$targetitms5 = $itmpara['PlatformPlayeritms5'];$targetitmsk5 = $itmpara['PlatformPlayeritmsk5'];$targetitmpara5 = $itmpara['PlatformPlayeritmpara5'];
			$targetitm6 = $itmpara['PlatformPlayeritm6'];$targetitmk6 = $itmpara['PlatformPlayeritmk6'];$targetitme6 = $itmpara['PlatformPlayeritme6'];
			$targetitms6 = $itmpara['PlatformPlayeritms6'];$targetitmsk6 = $itmpara['PlatformPlayeritmsk6'];$targetitmpara6 = $itmpara['PlatformPlayeritmpara6'];
			//Other values
			$targetclbpara = $itmpara['PlatformPlayerclbpara'];
			$targetclbstatusa = $itmpara['PlatformPlayerclbstatusa'];$targetclbstatusb = $itmpara['PlatformPlayerclbstatusb'];$targetclbstatusc = $itmpara['PlatformPlayerclbstatusc'];$targetclbstatusd = $itmpara['PlatformPlayerclbstatusd'];$targetclbstatuse = $itmpara['PlatformPlayerclbstatuse'];
			$targetnikstatusa = $itmpara['PlatformPlayernikstatusa'];$targetnikstatusb = $itmpara['PlatformPlayernikstatusb'];$targetnikstatusc = $itmpara['PlatformPlayernikstatusc'];$targetnikstatusd = $itmpara['PlatformPlayernikstatusd'];$targetnikstatuse = $itmpara['PlatformPlayernikstatuse'];
		}else{
			$log .= '似乎这个NPC平台损坏了，不能使用……<br>';
		}
		// 2nd part: decides if the clone status is temporary, if so, store player's values in their $clbpara
		if (isset($itmpara['PlatformIsTimed'])){
			//Name
			$clbpara['oriname'] = $name;
			$clbpara['oriicon'] = $icon;
			$clbpara['orinick'] = $nick;
			//Stats
			$clbpara['orilvl'] = $lvl;$clbpara['oriexp'] = $exp;
			$clbpara['oriclub'] = $club;$clbpara['oriclubskill'] = $clubskill;
			$clbpara['oriclubskillpara'] = $clubskillpara;
			$clbpara['oriwp'] = $wp;$clbpara['oriwk'] = $wk;$clbpara['oriwg'] = $wg;
			$clbpara['oriwc'] = $wc;$clbpara['oriwd'] = $wd;$clbpara['oriwf'] = $wf;
			$clbpara['oriinf'] = $inf;
			$clbpara['origd'] = $gd;
			$clbpara['orimhp'] = $mhp;$clbpara['orimsp'] = $msp;$clbpara['orimss'] = $mss;
			$clbpara['oriatt'] = $att;$clbpara['oridef'] = $def;
			$clbpara['orirp'] = $rp;$clbpara['orirage'] = $rage;
			//Weapon + Armor
			$clbpara['oriwep'] = $wep;$clbpara['oriwepk'] = $wepk;$clbpara['oriwepe'] = $wepe;
			$clbpara['oriweps'] = $weps;$clbpara['oriwepsk'] = $wepsk;$clbpara['oriweppara'] = $weppara;
			$clbpara['oriarb'] = $arb;$clbpara['oriarbk'] = $arbk;$clbpara['oriarbe'] = $arbe;
			$clbpara['oriarbs'] = $arbs;$clbpara['oriarbsk'] = $arbsk;$clbpara['oriarbpara'] = $arbpara;
			$clbpara['oriarh'] = $arh;$clbpara['oriarhk'] = $arhk;$clbpara['oriarhe'] = $arhe;
			$clbpara['oriarhs'] = $arhs;$clbpara['oriarhsk'] = $arhsk;$clbpara['oriarhpara'] = $arhpara;
			$clbpara['oriara'] = $ara;$clbpara['oriarak'] = $arak;$clbpara['oriarae'] = $arae;
			$clbpara['oriaras'] = $aras;$clbpara['oriarask'] = $arask;$clbpara['oriarapara'] = $arapara;
			$clbpara['oriarf'] = $arf;$clbpara['oriarfk'] = $arfk;$clbpara['oriarfe'] = $arfe;
			$clbpara['oriarfs'] = $arfs;$clbpara['oriarfsk'] = $arfsk;$clbpara['oriarfpara'] = $arfpara;
			$clbpara['oriart'] = $art;$clbpara['oriartk'] = $artk;$clbpara['oriarte'] = $arte;
			$clbpara['oriarts'] = $arts;$clbpara['oriartsk'] = $artsk;$clbpara['oriartpara'] = $artpara;
			//Items
			$clbpara['oriitm1'] = $itm1;$clbpara['oriitmk1'] = $itmk1;$clbpara['oriitme1'] = $itme1;
			$clbpara['oriitms1'] = $itms1;$clbpara['oriitmsk1'] = $itmsk1;$clbpara['oriitmpara1'] = $itmpara1;
			$clbpara['oriitm2'] = $itm2;$clbpara['oriitmk2'] = $itmk2;$clbpara['oriitme2'] = $itme2;
			$clbpara['oriitms2'] = $itms2;$clbpara['oriitmsk2'] = $itmsk2;$clbpara['oriitmpara2'] = $itmpara2;
			$clbpara['oriitm3'] = $itm3;$clbpara['oriitmk3'] = $itmk3;$clbpara['oriitme3'] = $itme3;
			$clbpara['oriitms3'] = $itms3;$clbpara['oriitmsk3'] = $itmsk3;$clbpara['oriitmpara3'] = $itmpara3;
			$clbpara['oriitm4'] = $itm4;$clbpara['oriitmk4'] = $itmk4;$clbpara['oriitme4'] = $itme4;
			$clbpara['oriitms4'] = $itms4;$clbpara['oriitmsk4'] = $itmsk4;$clbpara['oriitmpara4'] = $itmpara4;
			$clbpara['oriitm5'] = $itm5;$clbpara['oriitmk5'] = $itmk5;$clbpara['oriitme5'] = $itme5;
			$clbpara['oriitms5'] = $itms5;$clbpara['oriitmsk5'] = $itmsk5;$clbpara['oriitmpara5'] = $itmpara5;
			$clbpara['oriitm6'] = $itm6;$clbpara['oriitmk6'] = $itmk6;$clbpara['oriitme6'] = $itme6;
			$clbpara['oriitms6'] = $itms6;$clbpara['oriitmsk6'] = $itmsk6;$clbpara['oriitmpara6'] = $itmpara6;
			//Other values
			$clbpara['oriclbpara'] = $clbpara;
			$clbpara['oriclbstatusa'] = $clbstatusa;$clbpara['oriclbstatusb'] = $clbstatusb;$clbpara['oriclbstatusc'] = $clbstatusc;$clbpara['oriclbstatusd'] = $clbstatusd;$clbpara['oriclbstatuse'] = $clbstatuse;
			$clbpara['orinikstatusa'] = $nikstatusa;$clbpara['orinikstatusb'] = $nikstatusb;$clbpara['orinikstatusc'] = $nikstatusc;$clbpara['orinikstatusd'] = $nikstatusd;$clbpara['orinikstatuse'] = $nikstatuse;
		}
		//3rd Part: Write in all the cloned values.
		//DEBUG
		//echo "clbpara is ",gettype($clbpara),"itmpara is $itmpara ",gettype($itmpara),"platformPlayerMode is $platformPlayerMode ",gettype($platformPlayerMode), "targetPID is $targetPID ", gettype($targetPID),"targetData is $targetData ",gettype($targetData);
		//Name
		//$name = $targetname; # can't do this.
		$clbpara['PlatformName'] = $targetname;
		$icon = $targeticon;
		//Stats
		$lvl = $targetlvl;$exp = $targetexp;
		changeclub($targetclub,$data);
		$clubskill = $targetclubskill;
		$clubskillpara = $targetclubskillpara;
		$wp = $targetwp + $targetskill;$wk = $targetwk + $targetskill;$wc = $targetwc + $targetskill;$wg = $targetwg + $targetskill;$wd = $targetwd + $targetskill;$wf = $targetwf + $targetskill;
		$inf = $targetinf; $gd = $targetgd;
		if ($targettype > 0) {$gd = 'n';}
		$hp = $mhp = $targetmhp; $sp = $msp = $targetmsp; $ss = $mss = $targetmss;
		$rp = $targetrp;$att = $targetatt;$def = $targetdef;$rage = $targetrage;

		//Weapon + Armor
		$wep = $targetwep;$wepk = $targetwepk;$wepe = $targetwepe;$weps = $targetweps;$wepsk = $targetwepsk;$weppara = $targetweppara;
		$arb = $targetarb;$arbk = $targetarbk;$arbe = $targetarbe;$arbs = $targetarbs;$arbsk = $targetarbsk;$arbpara = $targetarbpara;
		$arh = $targetarh;$arhk = $targetarhk;$arhe = $targetarhe;$arhs = $targetarhs;$arhsk = $targetarhsk;$arhpara = $targetarhpara;
		$ara = $targetara;$arak = $targetarak;$arae = $targetarae;$aras = $targetaras;$arask = $targetarask;$arapara = $targetarapara;
		$arf = $targetarf;$arfk = $targetarfk;$arfe = $targetarfe;$arfs = $targetarfs;$arfsk = $targetarfsk;$arfpara = $targetarfpara;
		$art = $targetart;$artk = $targetartk;$arte = $targetarte;$arts = $targetarts;$artsk = $targetartsk;$artpara = $targetartpara;
		//Items
		$itm1 = $targetitm1;$itmk1 = $targetitmk1;$itme1 = $targetitme1;$itms1 = $targetitms1;$itmsk1 = $targetitmsk1;$itmpara1 = $targetitmpara1;
		$itm2 = $targetitm2;$itmk2 = $targetitmk2;$itme2 = $targetitme2;$itms2 = $targetitms2;$itmsk2 = $targetitmsk2;$itmpara2 = $targetitmpara2;
		$itm3 = $targetitm3;$itmk3 = $targetitmk3;$itme3 = $targetitme3;$itms3 = $targetitms3;$itmsk3 = $targetitmsk3;$itmpara3 = $targetitmpara3;
		$itm4 = $targetitm4;$itmk4 = $targetitmk4;$itme4 = $targetitme4;$itms4 = $targetitms4;$itmsk4 = $targetitmsk4;$itmpara4 = $targetitmpara4;
		$itm5 = $targetitm5;$itmk5 = $targetitmk5;$itme5 = $targetitme5;$itms5 = $targetitms5;$itmsk5 = $targetitmsk5;$itmpara5 = $targetitmpara5;
		$itm6 = $targetitm6;$itmk6 = $targetitmk6;$itme6 = $targetitme6;$itms6 = $targetitms6;$itmsk6 = $targetitmsk6;$itmpara6 = $targetitmpara6;
		//Other Values
		//$clbpara = $targetclbpara; Let's not do this for now.
		$clbstatusa = $targetclbstatusa;$clbstatusb = $targetclbstatusb; $clbstatusc = $targetclbstatusc; $clbstatusd = $targetclbstatusd; $clbstatuse = $targetclbstatuse;
		$nikstatusa = $targetnikstatusa;$nikstatusb = $targetnikstatusb; $nikstatusc = $targetnikstatusc; $nikstatusd = $targetnikstatusd; $nikstatuse = $targetnikstatuse;
		//Write in the temporary charge value. Won't matter if the clone is permanent anyways.
		$clbpara['NPCPlatformCharge'] = $clbpara['NPCPlatformMAXCharge'] = $targetChargeBaseValue;
		//4th Part: Produce some dialogue.
		$clbpara['dialogue'] = 'npcplatform';
		//$clbpara['noskip_dialogue'] = 1;
		//5th Part: Output a log and news.
		$log .= '这个平台完成了使命，消失了……<br>';
		addnews ( $now, 'npcplatformusage',$playerOriginalName,$nick);
	}elseif (strpos ( $itmk, 'Y' ) === 0 || strpos ( $itmk, 'Z' ) === 0) {
		if ($itm == '电池') {
			//功能需要修改，改为选择道具使用YE类型道具可充电
			$flag = false;
			for($i = 1; $i <= 6; $i ++) {
				//global ${'itm' . $i}, ${'itme' . $i};
				if (${'itm' . $i} == '移动PC') {
					${'itme' . $i} += $itme;
					$itms --;
					$flag = true;
					$log .= "为<span class=\"yellow\">{${'itm'.$i}}</span>充了电。";
					break;
				}
			}
			if (! $flag) {
				$log .= '你没有需要充电的物品。<br>';
			}
			}elseif ($itm == '群青多面体') {
			//global $plsinfo,$nosta,$db,$tablepre;
			$result = $db->query("SELECT pid,name,pls FROM {$tablepre}players WHERE type = 14 && hp > 0");
			$ndata = array();
			while($nd = $db->fetch_array($result)){
				$ndata[$nd['name']] = $nd;
			}
			if(!empty($ndata)){
				foreach($ndata as $key => &$val){
					$npls = $val['pls'];
					while($npls == $val['pls']){
						$npls = rand(1,count($plsinfo)-1);
					}
					$val['pls'] = $npls;$npls = $plsinfo[$npls];
					$log .= "<span class=\"yellow\">{$key}</span>响应道具号召，移动到了<span class=\"yellow\">{$npls}</span>。<br>";
					addnews($now,'npcmove',$name,$key,$nick);
				}
				$db->multi_update("{$tablepre}players",$ndata,'pid');
				if($itms != $nosta){$itms --;}
			}

			return;
		}	elseif ($itm == '残响兵器') {
			//global $cmd;
			foreach(Array('wep','arb','arh','ara','arf','art') as $val) {
				//global ${$val},${$val.'k'}, ${$val.'e'}, ${$val.'s'},${$val.'sk'};
			}
			for($i = 1; $i <= 6; $i ++) {
				//global ${'itmk' . $i},${'itm' . $i}, ${'itme' . $i}, ${'itms' . $i},${'itmsk' . $i};
			}

			include template('nametag');

			$cmd = ob_get_contents();
			ob_clean();
			return;
		}	elseif ($itm == '超臆想时空') {
			//global $cmd;
			foreach(Array('wep','arb','arh','ara','arf','art') as $val) {
				//global ${$val},${$val.'k'}, ${$val.'e'}, ${$val.'s'},${$val.'sk'};
			}
			for($i = 1; $i <= 6; $i ++) {
				//global ${'itmk' . $i},${'itm' . $i}, ${'itme' . $i}, ${'itms' . $i},${'itmsk' . $i};
			}

			include template('supernametag');

			$cmd = ob_get_contents();
			ob_clean();
			return;
		} elseif ($itm == '毒药') {
			//global $cmd;
			for($i = 1; $i <= 6; $i ++) {
				//global ${'itmk' . $i},${'itm' . $i}, ${'itme' . $i}, ${'itms' . $i};
			}
			include template('poison');

			$cmd = ob_get_contents();
			ob_clean();
			return;
		} elseif (strpos ( $itm, '磨刀石' ) !== false) {
			//global $wep, $wepk, $wepe, $weps, $wepsk;
			if (strpos ( $wepk, 'K' ) == 1 && strpos ( $wepsk, 'Z' ) === false) {
				if (strpos($wepsk,'j')!==false){
					$log.='多重武器不能改造。<br>';
					return;
				}
				$dice = rand ( 0, 100 );
				if ($dice >= 15) {
					if ($clbpara['BGMBrand'] == 'crimson'){
						$check = diceroll(20);
						if ($check > 17){
							$log .= "<span class=\"ltcrimson\">你想到了红暮挥舞红杀铁剑的英姿，<br>手上的刀磨得更快了！<br></span>";
							$wepe += $check;
						}
					}
					$wepe += $itme;
					$log .= "使用了<span class=\"yellow\">$itm</span>，<span class=\"yellow\">$wep</span>的攻击力变成了<span class=\"yellow\">$wepe</span>。<br>";
					if (strpos ( $wep, '锋利的' ) === false) {
						$wep = '锋利的'.$wep;
					}
				} else {
					$wepe -= ceil ( $itme / 2 );
					if ($wepe <= 0) {
						$log .= "<span class=\"red\">$itm</span>使用失败，<span class=\"red\">$wep</span>损坏了！<br>";
						$wep = $wepk = $wepsk = '';
						$wepe = $weps = 0;
					} else {
						$log .= "<span class=\"red\">$itm</span>使用失败，<span class=\"red\">$wep</span>的攻击力变成了<span class=\"red\">$wepe</span>。<br>";
					}
				}

				$itms --;
			} elseif(strpos ( $wepsk, 'Z' ) !== false){
				$log .= '咦……刀刃过于薄了，感觉稍微磨一点都会造成不可逆的损伤呢……<br>';
			} else {
				$log .= '你没装备锐器，不能使用磨刀石。<br>';
			}
		} elseif (preg_match ( "/钉$/", $itm ) || preg_match ( "/钉\[/", $itm )) {
			//global $wep, $wepk, $wepe, $weps, $wepsk;
            //码语行人，$club==21的时候不能使用钉子
            if ($club == 21) {
				$log .= "<span class=\"yellow\">突然，你的眼前出现了扭曲的字符！</span><br>";
				$log .= "<span class=\"glitchb\">
				“凌乱陈言省略号，<br>
				数值爆炸知多少？<br>
				玩家以外用不到，<br>
				出了问题再来找！”<br></span><br>";
				$log .= "<span class=\"yellow\">唔，看起来这个钉子对你似乎没有什么意义……</span><br>";
                return;
            } elseif ((strpos($wep, '棍棒') !== false) && ($wepk == 'WP')) {
                if (strpos($wepsk, 'j') !== false) {
                    $log .= '多重武器不能改造。<br>';
					return;
				}
				$dice = rand ( 0, 100 );
				if ($dice >= 10) {
					if ($clbpara['BGMBrand'] == 'crimson'){
						$check = diceroll(20);
						if ($check > 17){
							$log .= "<span class=\"ltcrimson\">你想到了红暮挥舞红杀铁锤的英姿，<br>手上的钉子打得更快了！<br><span>";
							$wepe += $check;
						}
					}
					$wepe += $itme;
					$log .= "使用了<span class=\"yellow\">$itm</span>，<span class=\"yellow\">$wep</span>的攻击力变成了<span class=\"yellow\">$wepe</span>。<br>";
					if (strpos ( $wep, '钉' ) === false) {
						$wep = str_replace ( '棍棒', '钉棍棒', $wep );
					}
				} else {
					$wepe -= ceil ( $itme / 2 );
					if ($wepe <= 0) {
						$log .= "<span class=\"red\">$itm</span>使用失败，<span class=\"red\">$wep</span>损坏了！<br>";
						$wep = $wepk = $wepsk = '';
						$wepe = $weps = 0;
					} else {
						$log .= "<span class=\"red\">$itm</span>使用失败，<span class=\"red\">$wep</span>的攻击力变成了<span class=\"red\">$wepe</span>。<br>";
					}
				}

				$itms --;
			} else {
				$log .= '你没装备棍棒，不能安装钉子。<br>';
			}
		} elseif ($itm == '针线包') {
			//global $arb, $arbk, $arbe, $arbs, $arbsk, $noarb;
            //码语行人，$club==21的时候不能使用针线包
            if ($club == 21) {
				$log .= "<span class=\"yellow\">突然，你的眼前出现了扭曲的字符！</span><br>";
				$log .= "<span class=\"glitchb\">
				“冷汗直流小问号，<br>
				防御堆到多少好？<br>
				与其数值罩白梦，<br>
				不如让她转生了！”<br></span><br>";
				$log .= "<span class=\"yellow\">唔，看起来这个针线包对你似乎没有什么意义……</span><br>";
                return;
            } elseif (($arb == $noarb) || !$arb) {
				$log .= '你没有装备防具，不能使用针线包。<br>';
			} elseif(strpos($arbsk,'^')!==false){
				$log .= '<span class="yellow">你不能对背包使用针线包。<br>';
			} elseif(strpos($arbsk,'Z')!==false){
				$log .= '<span class="yellow">该防具太单薄以至于不能使用针线包。</span><br>你感到一阵蛋疼菊紧，你的蛋疼度增加了<span class="yellow">233</span>点。<br>';
			}else {
				if ($clbpara['BGMBrand'] == 'rimefire'){
					$check = diceroll(20);
					if ($check > 17){
						$log .= "<span class=\"orange\">你突然脑海中浮现了一位青年彻夜优化装甲的英姿，<br>手上的针线打得更快了！<br></span>";
						$arbe += $check;
					}
				}
				$arbe += (rand ( 0, 2 ) + $itme);
				$log .= "用<span class=\"yellow\">$itm</span>给防具打了补丁，<span class=\"yellow\">$arb</span>的防御力变成了<span class=\"yellow\">$arbe</span>。<br>";
				$itms --;
			}
		} elseif ($itm == '消音器') {
			//global $wep, $wepk, $wepe, $weps, $wepsk;
			if (strpos ( $wepk, 'WG' ) !== 0) {
				$log .= '你没有装备枪械，不能使用消音器。<br>';
			} elseif (strpos ( $wepsk, 'S' ) === false) {
				$wepsk .= 'S';
				$log .= "你给<span class=\"yellow\">$wep</span>安装了<span class=\"yellow\">$itm</span>。<br>";
				$itms --;
			} else {
				$log .= "你的武器已经安装了消音器。<br>";
			}
		} elseif ($itm == '探测器电池') {
			$flag = false;
			for($i = 1; $i <= 6; $i ++) {
				//global ${'itmk' . $i}, ${'itme' . $i}, ${'itm' . $i};
				if (${'itmk' . $i} == 'R') {
					//if((strpos(${'itm'.$i}, '雷达') !== false)&&(strpos(${'itm'.$i}, '电池') === false)) {
					${'itme' . $i} += $itme;
					$itms --;
					$flag = true;
					$log .= "为<span class=\"yellow\">{${'itm'.$i}}</span>充了电。";
					break;
				}
			}
			if (! $flag) {
				$log .= '你没有探测仪器。<br>';
			}
		} elseif ($itm == '御神签') {
			$log .= "使用了<span class=\"yellow\">$itm</span>。<br>";
			include_once GAME_ROOT . './include/game/item2.func.php';
			divining ();
			$itms --;
		} elseif ($itm == '凸眼鱼') {
			//global $db, $tablepre, $name,$now,$corpseprotect;
			$tm = $now - $corpseprotect;//尸体保护
			$db->query ( "UPDATE {$tablepre}players SET weps='0',wep2s='0',arbs='0',arhs='0',aras='0',arfs='0',arts='0',itms0='0',itms1='0',itms2='0',itms3='0',itms4='0',itms5='0',itms6='0',money='0' WHERE hp <= 0 AND endtime <= $tm" );
			$cnum = $db->affected_rows ();
			addnews ( $now, 'corpseclear', $name, $cnum ,$nick);
			$log .= "使用了<span class=\"yellow\">$itm</span>。<br>突然刮起了一阵怪风，吹走了地上的{$cnum}具尸体！<br>";
			$itms --; $isk = $cnum;
		} elseif ($itm == '鱼眼凸') {
			//global $db, $tablepre, $name,$now,$corpseprotect;
			$tm = $now - $corpseprotect;//尸体保护
			$db->query ( "UPDATE {$tablepre}players SET pls='$pls' WHERE hp <= 0 AND endtime <= $tm" );
			$cnum = $db->affected_rows ();
			addnews ( $now, 'corpsegather', $name, $cnum ,$nick);
			$log .= "使用了<span class=\"yellow\">$itm</span>。<br>突然刮起了一阵怪风，将遍布全场的{$cnum}具尸体吹到了你所在的地方！<br>";
			$rp += diceroll(1024);
			$log .= "<span class=\"lime\">这过于惨无人道了！</span><br>你觉得罪恶感爬上了你的脊梁！<br>";
			$itms --; $isk = $cnum;
		} elseif ($itm == '天候棒') {
			//global $weather, $wthinfo, $name;
			if($weather <= 13)
			{
				$weather = rand ( 10, 13 );
				include_once GAME_ROOT . './include/system.func.php';
				save_gameinfo ();
				addnews ( $now, 'wthchange', $name, $weather ,$nick);
				$log .= "你转动了几下天候棒。<br>天气突然转变成了<span class=\"red\">$wthinfo[$weather]</span>！<br>";
			}
			else
			{
				addnews ( $now, 'wthfail', $name, $weather ,$nick);
				$log .= "你转动了几下天候棒。<br>但天气并未发生改变！<br>";
			}
			$itms --;
		}	elseif ($itm == '天然呆四面的奖赏') {
			//global $wep, $wepk, $wepe, $weps, $wepsk;
            //码语行人，$club==21的时候不能使用天然呆四面的奖赏
            if ($club == 21) {
				$log .= "<span class=\"yellow\">突然，你的眼前出现了扭曲的字符！</span><br>";
				$log .= "<span class=\"glitchb\">
				“无语无言点句号，<br>
				第四墙外看不到！<br>
				无法干涉即取消，<br>
				反正一个也不少！<br>”</span><br>";
				$log .= "<span class=\"yellow\">唔，看起来这个奇怪的物品对你似乎没有什么意义……</span><br>";
                return;
            }
            if (!$weps || !$wepe) {
				$log .= '请先装备武器。<br>';
				return;
			}
            if (strpos($wepsk, 'j') !== false) {
                $log .= '多重武器不能改造。<br>';
				return;
			}
            if (strpos($wepsk, 'O') !== false) {
                $log .= '进化武器不能改造。<br>';
				return;
			}
			$log .= "使用了<span class='yellow'>天然呆四面的奖赏</span>。<br>";
			$log .= "你召唤了<span class='lime'>天然呆四面</span>对你的武器进行改造！<br>";
			addnews ( $now, 'newwep', $name, $itm, $wep ,$nick);
			$dice=rand(0,99);
			if ($dice<70)
			{
				$log.="<span class='lime'>天然呆四面</span>把你的武器弄坏了！<br>";
				$log.="你的武器变成了一块废铁！<br>";
				$log.="<span class='lime'>“不小心把你的武器弄坏了，还真是对不起呢……<br>";
				$wep="一块废铁"; $wepk="WP"; $wepe=1; $weps=1; $wepsk="";
				$log.="那么…… 给你点补偿吧，请务必收下。”<br></span>";
				$itm=""; $itmk=""; $itme=0; $itms=0; $itmsk="";
				$dice2=rand(0,99);
				//global $itm0,$itmk0,$itme0,$itms0,$itmsk0;
				$itm0='四面亲手制作的■DeathNote■'; $itmk0='Y'; $itme0=1; $itms0=1; $itmsk0='z';
				include_once GAME_ROOT . './include/game/itemmain.func.php';
				itemget($data);
			}
			else  if ($dice<90)
			{
				$log.="<span class='lime'>天然呆四面</span>把玩了一会儿你的武器。<br>";
				$log.="你的武器的耐久似乎稍微多了一点。<br>";
				if (strpos ( $wep, '-改' ) === false) $wep = $wep . '-改';
				$weps += ceil ( $wepe / 200 );
				$itm=""; $itmk=""; $itme=0; $itms=0; $itmsk="";
			}
			else
			{
				$log.="<span class='lime'>天然呆四面</span>把玩了一会儿你的武器。<br>";
				$log.="你的武器似乎稍微变强了一点。<br>";
				if (strpos ( $wep, '-改' ) === false) $wep = $wep . '-改';
				$wepe += ceil ( $wepe / 200 );
				$itm=""; $itmk=""; $itme=0; $itms=0; $itmsk="";
			}
		}	elseif ($itm == '武器师安雅的奖赏') {
			//global $wep, $wepk, $wepe, $weps, $wepsk, $wp, $wk, $wg, $wc, $wd, $wf;
            //码语行人，$club==21的时候不能使用武器师安雅的奖赏
            if ($club == 21) {
				$log .= "<span class=\"yellow\">突然，你的眼前出现了扭曲的字符！</span><br>";
				$log .= "<span class=\"glitchb\">
				“奇诡无比省略号，<br>
				奇葩捏他哪里找？<br>
				横竖都是用不上。<br>
				看我直接注释掉！”<br></span><br>";
				$log .= "<span class=\"yellow\">唔，看起来武器师安雅的奖赏对你似乎没有什么意义……</span><br>";
                return;
            } elseif (!$weps || !$wepe) {
				$log .= '请先装备武器。<br>';
				return;
			}
			if (strpos($wepsk,'j')!==false){
				$log.='多重武器不能改造。<br>';
				return;
			}
			$dice = rand ( 0, 99 );
			$dice2 = rand ( 0, 99 );
			$skill = array ('WP' => $wp, 'WK' => $wk, 'WG' => $wg, 'WC' => $wc, 'WD' => $wd, 'WF' => $wf );
			$skill_advanced = array ('WJ' => $wg, 'WB' => $wc );
			arsort ( $skill );
			$skill_keys = array_keys ( $skill );
			$skill_advanced_keys = array_keys ( $skill_advanced );
			$nowsk = substr ( $wepk, 0, 2 );
			if (strlen($wepk) > 2) $subsk = 'W'.$wepk[2];
			$maxsk = $skill_keys [0];
			// 复合武器只要其中一个类别是最高就不会改系
			// 上位武器熟练超过1200不会改系，可能算加强六系称号
			if (((!in_array($nowsk, $skill_advanced_keys) && ($skill [$nowsk] != $skill [$maxsk]) && (empty($subsk) || ((!empty($subsk) && !in_array($subsk, $skill_advanced_keys) && ($skill [$subsk] != $skill [$maxsk]))))) || (in_array($nowsk, $skill_advanced_keys) && ($skill_advanced [$nowsk] < 1200))) && ($dice < 30))
			{
				$wepk = substr_replace($wepk, $maxsk, 0, 2);
				$kind = "更改了{$wep}的<span class=\"yellow\">类别</span>！";
			} elseif (($weps != $nosta) && ($dice2 < 70)) {
				$weps += ceil ( $wepe / 2 );
				$kind = "增强了{$wep}的<span class=\"yellow\">耐久</span>！";
			} else {
				$wepe += ceil ( $wepe / 2 );
				$kind = "提高了{$wep}的<span class=\"yellow\">攻击力</span>！";
			}
			$log .= "你使用了<span class=\"yellow\">$itm</span>，{$kind}";
			addnews ( $now, 'newwep', $name, $itm, $wep ,$nick);
			if (strpos ( $wep, '-改' ) === false) {
				$wep = $wep . '-改';
			}
			$itms --;
		} elseif ($itm == '■DeathNote■') {
			$mode = 'deathnote';
			$log .= '你翻开了■DeathNote■<br>';
			return;
		} elseif ($itm == '游戏解除钥匙') {
			//global $url;
			$state = 6;
			$url = 'end.php';
			include_once GAME_ROOT . './include/system.func.php';
			gameover ( $now, 'end3', $name );
		}elseif ($itm == '『C.H.A.O.S』') {
			//global $ss,$rp,$killnum,$att,$def,$log;
			$flag=false;
			$log.="一阵强光刺得你睁不开眼。<br>强光逐渐凝成了光球，你揉揉眼睛，发现包裹里的东西全都不翼而飞了。<br>";
			for ($i=1;$i<=6;$i++){
				//global ${'itm'.$i},${'itmk'.$i},${'itme'.$i},${'itms'.$i},${'itmsk'.$i};
				$itm = & ${'itm'.$i};
				$itmk = & ${'itmk'.$i};
				$itme = & ${'itme'.$i};
				$itms = & ${'itms'.$i};
				$itmsk = & ${'itmsk'.$i};
				# ventus
				if ($itm=='黑色发卡') {$flag=true;}
				$itm = '';
				$itmk = '';
				$itme = 0;
				$itms = 0;
				$itmsk = '';
			}
			//global $itm0,$itmk0,$itme0,$itms0,$itmsk0;
			$karma=$rp*$killnum-$def+$att;
			$f1=false;

			//『G.A.M.E.O.V.E.R』itmk:Y itme:1 itms:1 itmsk:zxZ

			# terra
			$tflag = (($ss>=600)&&($killnum<=15)) ? 1 : 0;
			# aqua
			$hflag = $karma<=2000 ? 1 : 0;

			# 元素大师使用chaos时，不再需要进一步合成，但是会失去元素合成功能
			if($club == 20)
			{
				$log .= "系在你腰间的口袋剧烈颤动着，下一刻，你的直觉被某物触动了。<br>
				在你的视界里，浮现出了难以描绘、似真似幻的独特“元素”：<br><br>";
				if($tflag) $log .= "有生命的热火、有逝者的悲怆；<br>";
				if($hflag) $log .= "有命运的尾迹、有因缘的蟠结；<br>";
				if($flag) $log .= "有衬出影子的光、有糅在光里的影。<br>";
				$log .= "<br>然后，你的<span class='sparkle'>{$sparkle}元素口袋{$sparkle}</span>飞了出去——<br><br>";
				# 失去元素口袋
				$clbstatusa = 1;
				# 追加判定
				if ($tflag and $hflag and $flag==true){
				# 直接获得gameover
				$itm0='『G.A.M.E.O.V.E.R』';
				$itmk0='Y';
				$itme0=1;
				$itms0=1;
				$itmsk0='zv';
				$f1=true;
				itemget($data);
				}else{
					$log .= "但似乎还是少了些什么东西……<br>";
					# 大侠请重新来过
					$itm0='『S.C.R.A.P』';
					$itmk0='Y';
					$itme0=1;
					$itms0=1;
					//$itmsk0='zv';
					$f1=false;
					itemget($data);
				}
			}
			else
			{
				if ($tflag){
					$itm0='『T.E.R.R.A』';
					$itmk0='Y';
					$itme0=1;
					$itms0=1;
					$itmsk0='z';
					include_once GAME_ROOT . './include/game/itemmain.func.php';
					itemget($data);
					$f1=true;
				}
				if ($hflag){
					$itm0='『A.Q.U.A』';
					$itmk0='Y';
					$itme0=1;
					$itms0=1;
					$itmsk0='x';
					include_once GAME_ROOT . './include/game/itemmain.func.php';
					itemget($data);
					$f1=true;
				}
				if ($flag==true){
					$itm0='『V.E.N.T.U.S』';
					$itmk0='Y';
					$itme0=1;
					$itms0=1;
					$itmsk0='Z';
					include_once GAME_ROOT . './include/game/itemmain.func.php';
					itemget($data);
					$f1=true;
				}
			}
			if ($f1==false){
				$itm0='『S.C.R.A.P』';
				$itmk0='Y';
				$itme0=1;
				$itms0=1;
				include_once GAME_ROOT . './include/game/itemmain.func.php';
				itemget($data);
			}
		}elseif ($itm == '『G.A.M.E.O.V.E.R』') {
			//global $url;
			$state = 6;
			$url = 'end.php';
			include_once GAME_ROOT . './include/system.func.php';
			gameover ( $now, 'end7', $name );
		}elseif ($itm == '杏仁豆腐的ID卡') {
			include_once GAME_ROOT . './include/system.func.php';
			$duelstate = duel($now,$itm);
			if($duelstate == 50){
				$log .= "<span class=\"yellow\">你使用了{$itm}。</span><br><span class=\"evergreen\">“干得不错呢，看来咱应该专门为你清扫一下战场……”</span><br><span class=\"evergreen\">“所有的NPC都离开战场了。好好享受接下来的杀戮吧，祝你好运。”</span>——林无月<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}elseif($duelstate == 51){
				$log .= "你使用了<span class=\"yellow\">{$itm}</span>，不过什么反应也没有。<br><span class=\"evergreen\">“咱已经帮你准备好舞台了，请不要要求太多哦。”</span>——林无月<br>";
			} else {
				$log .= "你使用了<span class=\"yellow\">{$itm}</span>，不过什么反应也没有。<br><span class=\"evergreen\">“表演的时机还没到呢，请再忍耐一下吧。”</span>——林无月<br>";
			}
		} elseif ($itm == '奇怪的按钮') {
			//global $bid;
			$button_dice = rand ( 1, 10 );
			if ($button_dice < 5) {
				$log .= "你按下了<span class=\"yellow\">$itm</span>，不过好像什么都没有发生！";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			} elseif ($button_dice < 8) {
				//global $url;
				$state = 6;
				$url = 'end.php';
				include_once GAME_ROOT . './include/system.func.php';
				gameover ( $now, 'end5', $name );
			} else {
				$log .= '好像什么也没发生嘛？<br>咦，按钮上的标签写着什么？“危险，勿触”……？<br>';
				include_once GAME_ROOT . './include/state.func.php';
				$log .= '呜哇，按钮爆炸了！<br>';
				//$bid = 0;
				death ( 'button', '', 0, $itm );
			}
		} elseif ($itm == '装有H173的注射器') {
			//global $wp, $wk, $wg, $wc, $wd, $wf, $club, $bid, $att, $def;
			$log .= '你考虑了一会，<br>把袖子卷了起来，给自己注射了H173。<br>';
			$deathdice = rand ( 0, 4096 );
			$spdice = 1;
			// Shiny Charm
			if ($art == '★闪耀护符★'){
				// Reference: https://wiki.52poke.com/wiki/%E7%95%B0%E8%89%B2%E5%AF%B6%E5%8F%AF%E5%A4%A2#%E3%80%8A%E6%9C%B1%EF%BC%8F%E7%B4%AB%E3%80%8B
				//$deathdice += 2731; # 4096 - 1365
				$spdice = diceroll(1365);
			}
			if ($deathdice >= 4096 || $club == 15 || $spdice == 0) {
				$log .= '你突然感觉到一种不可思议的力量贯通全身！<br>';
				$wp = $wk = $wg = $wc = $wd = $wf = 8010;
				$att = $def = 13337;
				changeclub(15,$data);
				addnews ( $now, 'suisidefail',$name,$nick);
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			} else {
				include_once GAME_ROOT . './include/state.func.php';
				$log .= '你失去了知觉。<br>';
				//$bid = 0;
				death ( 'suiside', '', 0, $itm );
			}
		} elseif (strpos($itm, '溶剂SCP-294')===0) {
			//global $wp, $wk, $wg, $wc, $wd, $wf, $club, $att, $def, $hp, $mhp, $sp, $msp, $rp;
			if($itm == '溶剂SCP-294_PT_Poini_Kune'){
				$log .= '你考虑了一会，一扬手喝下了杯中中冒着紫色幽光的液体。<br><span class="yellow">你感到全身就像燃烧起来一样，不禁扪心自问这值得么？</span><br>';
				if ($mhp > 573){
					$up = rand (0, $mhp + $msp);
				} else{
					$up = rand (0, 573);
				}


				if($club == 17){
					$hpdown = $spdown = round($up * 1.5);
				}elseif($club == 12){
					$hpdown = $up+250;
					$spdown = $up;
					//根性兄贵加成消失
				}else{
					$hpdown = $spdown = $up;
				}
				$wp += $up;$wk += $up;$wg += $up;$wc += $up;$wd += $up;$wf += $up;
				$rp += 500;
				//$down = $club == 17 ? round($up * 1.5) : $up;

				$mhp = $mhp - $hpdown;
				$msp = $msp - $spdown;
				$log .= '你的生命上限减少了<span class="yellow">'.$hpdown.'</span>点，体力上限减少了<span class="yellow">'.$spdown.'</span>点，而你的全系熟练度提升了<span class="yellow">'.$up.'</span>点！<br>';
			} elseif ($itm == '溶剂SCP-294_PT_Arnval'){
				$log .= '你考虑了一会，一扬手喝下了杯中中冒着白色气泡的清澈液体。<br><span class="yellow">你感到全身就像燃烧起来一样，不禁扪心自问这值得么？</span><br>';
				if ($msp > 573){
					$up = rand (0, $msp * 1.5);
				} else{
					$up = rand (0, 573);
				}
				$mhp = $mhp + $up;
				$def = $def + $up;
				$down = $club == 17 ? round($up * 1.5) : $up;
				$rp += 200;
				$msp = $msp - $down;
				$att = $att - $down;

				$log .= '你的体力上限和攻击力减少了<span class="yellow">'.$down.'</span>点，而你的生命上限和防御力提升了<span class="yellow">'.$up.'</span>点！<br>';
			} elseif ($itm == '溶剂SCP-294_PT_Strarf') {
				$log .= '你考虑了一会，一扬手喝下了杯中中冒着灰色气泡的清澈液体。<br><span class="yellow">你感到全身就像燃烧起来一样，不禁扪心自问这值得么？</span><br>';
				if ($mhp > 573){
					$up = rand (0, $msp * 1.5);
				} else{
					$up = rand (0, 573);
				}
				$msp = $msp + $up;
				$att = $att + $up;
				$down = $club == 17 ? round($up * 1.5) : $up;
				$rp += 200;
				$mhp = $mhp - $down;
				$def = $def - $down;
				$log .= '你的生命上限和防御力减少了<span class="yellow">'.$down.'</span>点，而你的体力上限和攻击力提升了<span class="yellow">'.$up.'</span>点！<br>';
			} elseif ($itm == '溶剂SCP-294_PT_ErulTron') {
				$log .= '你考虑了一会，<br>一扬手喝下了杯中中冒着粉红光辉的液体。<br>你感到你整个人貌似变得更普通了点。<br>';
				//global $lvl, $exp;
				$lvl = $exp = 0;
				$att = round($att * 0.8);
				$def = round($def * 0.8);
				$log .= '<span class="yellow">你的等级和经验值都归0了！但是，你的攻击力和防御力也变得更加普通了。</span><br>';
			}
			if($att < 0){$att = 0;}
			if($def < 0){$def = 0;}
			if($hp > $mhp){$hp = $mhp;}
			if($sp > $msp){$sp = $msp;}
			$deathflag = false;
			if($mhp <= 0){$hp = $mhp =0;$deathflag = true;}
			if($msp <= 0){$sp = $msp =0;$deathflag = true;}
			if($deathflag){
				$log .= '<span class="yellow">看起来你的身体无法承受药剂的能量……<br>果然这一点都不值得……<br></span>';
				include_once GAME_ROOT . './include/state.func.php';
				death ( 'SCP', '', 0, $itm );
			} else {
				changeclub(17,$data);
				addnews ( $now, 'notworthit',$name,$nick);
			}
			$itms --;
			if($itms <= 0){
				if($hp > 0){$log .= "<span class=\"yellow\">{$itm}用完了。</span><br>";}
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} elseif ($itm == '挑战者之印') {
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '你已经呼唤了幻影执行官，现在寻找并击败他们，<br>并且搜寻他们的ID卡吧！<br>';
			addnpc ( 7, 0,1);
			addnpc ( 7, 1,1);
			addnpc ( 7, 2,1);
			addnews ($now,'secphase',$name,$nick);
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '破灭之诗') {
			//global $hack,$rp,$clbpara,$gamevars;
			$rp = 0;
			$clbpara['dialogue'] = 'thiphase';
			$clbpara['console'] = 1;
			$clbpara['achvars']['thiphase'] += 1;
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '在你唱出那单一的旋律的霎那，<br>整个虚拟世界起了翻天覆地的变化……<br>';
			addnpc ( 4, 0,1);
			include_once GAME_ROOT . './include/game/item2.func.php';
			$log .= '世界响应着这旋律，产生了异变……<br>';
			wthchange( $itm,$itmsk);
			addnews ($now,'thiphase',$name,$nick);
			$hack = 1;
			$gamevars['apis'] = $gamevars['api'] = 3;
			$log .= '因为破灭之歌的作用，全部锁定被打破了！<br>';
			movehtm();
			addnews($now,'hack2',$name,$nick);
			save_gameinfo();
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '黑色碎片') {
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '你已经呼唤了一个未知的存在，现在寻找并击败她，<br>并且搜寻她的游戏解除钥匙吧！<br>';
			addnews ($now,'dfphase',$name,$nick);
			addnpc ( 12, 0,1);

			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '✦钥匙碎片') {
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '嗯……？只有碎片也能用吗？<br>好像将一小部分NPC部署进了游戏内……<br>';
			//思念体 4*3
			addnpc ( 2, 0, 2);
			addnpc ( 2, 1, 2);
			addnpc ( 2, 2, 2);
			addnpc ( 2, 3, 2);
			addnpc ( 2, 4, 2);
			addnpc ( 2, 5, 2);
			addnpc ( 2, 6, 2);
			addnpc ( 2, 7, 2);
			addnews ($now , 'key0', $name,$nick);
			$itms --;
			if($itms <= 0) destory_single_item($data,$itmn,1);
		} elseif ($itm == '✦NPC钥匙·一阶段') {
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '已解锁一阶段NPC！<br>似乎大量NPC已经部署至游戏内……<br>';
			//职人 1*6
			addnpc ( 11, 0,1);
			addnpc ( 11, 1,1);
			addnpc ( 11, 2,1);
			addnpc ( 11, 3,1);
			addnpc ( 11, 4,1);
			addnpc ( 11, 5,1);
			//妖精幻象 1*3
			addnpc ( 13, 0,1);
			addnpc ( 13, 1,1);
			addnpc ( 13, 2,1);
			addnews ($now , 'key1', $name,$nick);
			$itms --;
			if($itms <= 0){
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} elseif ($itm == '✦✦NPC钥匙·二阶段') {
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '已解锁二阶段NPC！<br>似乎凶恶NPC已经部署至游戏内……<br>';
			//杏仁豆腐 2*2
			addnpc ( 5, 0,1);
			addnpc ( 5, 1,1);
			addnpc ( 5, 0,1);
			addnpc ( 5, 1,1);
			//猴子 1*2
			addnpc ( 6, 0,1);
			addnpc ( 6, 0,1);
			//假蓝凝
			addnpc ( 9, 0,1);
			addnews ($now , 'key2', $name,$nick);
			$itms --;
			if($itms <= 0){
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} elseif ($itm == '✦种火钥匙') {
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '虽然不知道你究竟想干啥，<br>但总之你放出了更多的种火……<br>';
			// $dice = rand(0,100);
			// if ($dice > 98){
			// 	$log .= '似乎还有其他的什么被你放出来咯！<br>';
			// 	addnpc ( 89, 0,1);
			// 	addnpc ( 89, 1,1);
			// 	addnpc ( 89, 2,1);
			// }
			//种火 5*10
			addnpc ( 92, 0,10);
			addnpc ( 92, 1,10);
			addnpc ( 92, 2,10);
			addnpc ( 92, 3,10);
			addnpc ( 92, 4,10);
			addnews ($now , 'key3', $name,$nick);
			$itms --;
			if($itms <= 0){
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} elseif ($itm == '✦【自律AI呼唤器】') {
			//Call in 30 type 93 NPCs, 6 each.
			//get player's 1st Yume value - different value results in different NPC.
			//There are 5 sets - K, C, G, P, D.
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '你将这根权杖一般的钥匙狠狠插在了地面上，<br>很快，大批NPC就从空中降落到了战场上！<br>';
			if ($clbpara['randver1'] < 21){
				// 1st set - WK High School Oni Girls
				addnpc ( 93,0,6);
				addnpc ( 93,1,6);
				addnpc ( 93,2,6);
				addnpc ( 93,3,6);
				addnpc ( 93,4,6);
			}elseif ($clbpara['randver1'] < 42){
				// 2nd set - WC Idol Magical Girls
				addnpc ( 93,5,6);
				addnpc ( 93,6,6);
				addnpc ( 93,7,6);
				addnpc ( 93,8,6);
				addnpc ( 93,9,6);
			}elseif ($clbpara['randver1'] < 63){
				// 3rd set - WG Small Mascots
				addnpc ( 93,10,6);
				addnpc ( 93,11,6);
				addnpc ( 93,12,6);
				addnpc ( 93,13,6);
				addnpc ( 93,14,6);
			}elseif ($clbpara['randver1'] < 84){
				// 4th set - WD Maids
				addnpc ( 93,15,6);
				addnpc ( 93,16,6);
				addnpc ( 93,17,6);
				addnpc ( 93,18,6);
				addnpc ( 93,19,6);
			}elseif ($clbpara['randver1'] < 105){
				// 5th set - WP Yandere Experiments
				addnpc ( 93,20,6);
				addnpc ( 93,21,6);
				addnpc ( 93,22,6);
				addnpc ( 93,23,6);
				addnpc ( 93,24,6);
			}else{
				// Critial Success!
				addnpc ( 93,22,5);
				addnpc ( 93,3,5);
				addnpc ( 93,11,5);
				addnpc ( 93,5,5);
				addnpc ( 93,19,5);
			}
			//This is considered a troll move - we don't announce it in game newsinfo - however--!
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('0','$now','$name','','「神奇AI们，快过来！」')");
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','竟然有人从幻境中叫出了外援！怎么可能！')");

			//HOWEVER--
			$log .= '突然你感到全身一寒，<br>你感觉罪恶感爬上了你的脊梁！<br>';
			$rp += diceroll(1555);
			$moralcheck = diceroll(6);
			if ($moralcheck > 4 || $rp < 1000){
				$log .= '罪恶感让你不禁呕吐起来。<br>你感觉头晕目眩。<br>';
				$mhp = round($mhp / 1.33);
				$msp = round($msp / 1.22);
				$hp = round($hp / 1.33);
				$sp = round($sp / 1.22);
			}
			$itms --;
			if($itms <= 0) destory_single_item($data,$itmn,1);
		} elseif ($itm == '✦种火定点移位装置✦') {
			//global $db, $tablepre, $pls;
			$result = $db->query("SELECT * FROM {$tablepre}players WHERE type = 92"); //SELECT 全部种火NPC
			$fsdata = $db->fetch_array($result);//获取以上结果
			//$fspid = $fsdata['pid'];
			//echo "成功获得$fspid";
			$dice = rand ( 0, 100 );
			//echo "骰子点数$dice";
			if($dice <= 20){
				//1/5 可能性种火聚集到无月之影
				//$npls = 0;
				//更新位置
				$db->query("UPDATE {$tablepre}players SET pls = 0 WHERE type = 92 AND hp > 0");
				//文案
				$log .= '你使用了种火定点移位装置。<br>地图上全部种火被移动到了【无月之影】！<br>';
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','看起来有搅局的人出现了，我们被全扔去了【无月之影】')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','不过红暮看上去像个好人就是了……')");
			}elseif($dice <= 40){
				//1/5 可能性种火聚集到初始之树
				//$npls = 22;
				//更新位置
				$db->query("UPDATE {$tablepre}players SET pls = 22 WHERE type = 92 AND hp > 0");
				//文案
				$log .= '你使用了种火定点移位装置。<br>地图上全部种火被移动到了【初始之树】！<br>';
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','看起来有搅局的人出现了，我们被全扔去了【初始之树】')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','唔……这里是【约定】之地呢。')");
			}elseif($dice <= 60){
				//1/5 可能性种火聚集到幻想世界
				//$npls = 23;
				//更新位置
				$db->query("UPDATE {$tablepre}players SET pls = 23 WHERE type = 92 AND hp > 0");
				//文案
				$log .= '你使用了种火定点移位装置。<br>地图上全部种火被移动到了【幻想世界】！<br>';
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','看起来有搅局的人出现了，我们被全扔去了【幻想世界】')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','唔……这里是【幻想】之地呢。')");
			}elseif($dice <= 80){
				//1/5 可能性种火聚集到永恒的世界
				//$npls = 24;
				//更新位置
				$db->query("UPDATE {$tablepre}players SET pls = 24 WHERE type = 92 AND hp > 0");
				//文案
				$log .= '你使用了种火定点移位装置。<br>地图上全部种火被移动到了【永恒的世界】！<br>';
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','看起来有搅局的人出现了，我们被全扔去了【永恒的世界】')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','唔……这里是【永恒】之地呢。')");
			}else{
				//1/5 可能性种火聚集到FARGO前基地
				//$npls = 28;
				//更新位置
				$db->query("UPDATE {$tablepre}players SET pls = 28 WHERE type = 92 AND hp > 0");
				//文案
				$log .= '你使用了种火定点移位装置。<br>地图上全部种火被移动到了【FARGO前基地】！<br>';
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','看起来有搅局的人出现了，我们被全扔去了【FARGO前基地】')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','唔……这里是【试炼】之地呢。')");
			}
			addnews ($now , 'fsmove', $name, '', $pls,$nick);
			//销毁物品
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '✦种火聚集装置✦') {
			//global $db, $tablepre, $pls;
			$result = $db->query("SELECT * FROM {$tablepre}players WHERE type = 92"); //SELECT 全部种火NPC
			$fsdata = $db->fetch_array($result);//获取以上结果
			//聚集种火
			$db->query("UPDATE {$tablepre}players SET pls = '$pls' WHERE type = 92 AND hp > 0");
			//文案
			$log .= '你使用了种火聚集装置。<br>地图上全部种火被移动到了你所在的位置！<br>';
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','看起来有搅局的人出现了，我们被什么玩家全体移动了位置呢。')");
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','看一下「游戏状况」，来确认一下吧！')");
			addnews ($now , 'fsmove', $name, '', $pls,$nick);
			//销毁物品
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '✦呼唤种火✦') {
			//global $db, $tablepre, $pls;
			$result = $db->query("SELECT * FROM {$tablepre}players WHERE type = 92"); //SELECT 全部种火NPC
			$fsdata = $db->fetch_array($result);//获取以上结果
			//聚集种火
			$db->query("UPDATE {$tablepre}players SET pls = '$pls' WHERE type = 92 AND hp > 0");
			//文案
			$log .= '你使用了种火聚集装置。<br>地图上全部种火被移动到了你所在的位置！<br>';
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｅ】','','听到了……')");
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【Ｐ】','','…………召唤…………')");
			addnews ($now , 'fsmove', $name, '', $pls,$nick);
		} elseif ($itm == '镣铐的碎片') {
//			include_once GAME_ROOT . './include/system.func.php';
//			$log .= '呜哦，看起来你闯了大祸……<br>请自己去收拾残局！<br>';
//			addnpc ( 12, 0,1);
//			addnews ($now , 'dfsecphase', $name);
//			$itm = $itmk = $itmsk = '';
//			$itme = $itms = 0;
		} elseif($itm == '莱卡召唤器') {
//			include_once GAME_ROOT . './include/system.func.php';
//			//global $db,$tablepre;
//			$result = $db->query("SELECT pid FROM {$tablepre}players WHERE type = 13");
//			$num = $db->num_rows($result);
//			if($num){
//				$log.= '召唤器似乎用尽了能量。<br>';
//			}else{
//				addnpc ( 13, 0,1);
//				$log.= '你成功召唤了小莱卡，去测试吧。<br>';
//			}
//			$n_name = evonpc (1,'红暮');
//			if($n_name){
//				addnews($now , 'evonpc','红暮', $n_name);
//			}
		} elseif($itm == '【Ｄ】电子狐召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,0,1);
			$log.= '你成功召唤了电子狐，去测试吧。<br>';
		} elseif($itm == '【Ｄ】百命猫召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,1,1);
			$log.= '你成功召唤了百命猫，去测试吧。<br>';
		} elseif($itm == '【Ｄ】笼中鸟召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,2,1);
			$log.= '你成功召唤了笼中鸟，去测试吧。<br>';
		} elseif($itm == '【Ｄ】走地羊召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,3,1);
			$log.= '你成功召唤了走地羊，去测试吧。<br>';
		} elseif($itm == '【Ｄ】书中虫召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,4,1);
			$log.= '你成功召唤了书中虫，去测试吧。<br>';
		} elseif($itm == '【Ｄ】迷你蜂召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,5,1);
			$log.= '你成功召唤了迷你蜂，去测试吧。<br>';
		} elseif($itm == '【Ｄ】种火花召唤机') {
			include_once GAME_ROOT . './include/system.func.php';
			addnpc(89,6,1);
			$log.= '你成功召唤了种火花，去测试吧。<br>';
		} elseif($itm == '电掣召唤仪') {
			include_once GAME_ROOT . './include/system.func.php';
			$dice = rand(0,6);
			if($dice==0){
				addnpc(89,0,1);
			}elseif($dice==1){
				addnpc(89,1,1);
			}elseif($dice==2){
				addnpc(89,2,1);
			}elseif($dice==3){
				addnpc(89,3,1);
			}elseif($dice==4){
				addnpc(89,4,1);
			}elseif($dice==5){
				addnpc(89,5,1);
			}elseif($dice==6){
				addnpc(89,6,1);
			}else{
				addnpc(89,6,1);
			}
			$log.= '【电掣】公司为你服务，你点的神秘乐子已送达，祝你愉快！<br>';
			//销毁物品
			$itms --;
			if($itms <= 0){
				$log .= "<span class=\"red\">$itm</span>用光了。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} elseif ($itm == '【我想要领略真正的红杀之力】') {
		//文案
			//global $db, $tablepre, $pls;
			include_once GAME_ROOT . './include/system.func.php';
			$log .= '你拿起了这个球状物体，重重地向天空抛去！<br>地图上空出现了红杀组织的龙虎徽标！<br>';
			addnpc(19,0,1);
			addnpc(19,1,1);
			addnews ($now , 'keyuu', $name, '', $pls,$nick);
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','切，真是少见的要求，那么我会在【无月之影】等着你们的挑战！')");
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【蓝凝】','','英雄就该姗姗来迟，我会和姐姐一起迎接你们！')");
			//销毁物品
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itmk =='ZA'){
			//global $plsinfo,$db,$tablepre;
			if($itm =='→【单兵撤退按钮】←'){
				$log .= "你按下了这个按钮。<br>但似乎什么都没有发生。<br>按钮就这样消失了。<br>在你觉得你买到了假冒伪劣产品时，你听到了来自红暮的广播。<br>";
				//销毁物品
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','如果你们发现了什么带有异样颜色的代码断片，千万别合成它们，老实带过来给我就行。')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','大家请注意，虚拟幻境系统似乎遭到了来自不明人士的入侵。')");
				//播撒合成用物品
				$kitm1="［ＩＮＮＯＣＥＮＣＥ］";
				$kitm2="［ＤＩＬＩＧＥＮＣＥ］";
				$kitm3="［ＣＯＮＳＣＩＥＮＣＥ］";
				$rndpls1= rand(1,count($plsinfo)-2);
				$rndpls2= rand(1,count($plsinfo)-2);
				$rndpls3= rand(1,count($plsinfo)-2);
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm1', 'XA', '1', '1', '', '$rndpls1')");
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm2', 'XA', '1', '1', '', '$rndpls2')");
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm3', 'XA', '1', '1', '', '$rndpls3')");
				$plsname1 = $plsinfo[$rndpls1];
				$plsname2 = $plsinfo[$rndpls2];
				$plsname3 = $plsinfo[$rndpls3];
				$log .= "然后，你听到了来自蓝凝的私聊——<br><span class=\"clan\">【蓝凝】就给你一些提示吧，你需要找到三个代码断片进行合成：{$kitm1}，{$kitm2}与{$kitm3}，它们分别位于{$plsname1}，{$plsname2}与{$plsname3}。<br>【蓝凝】别谢我，问就是我免贵姓雷了。祝你好运！</span>";
				$log .= "<br>看起来，在脱出幻境之前，你需要玩一把寻宝游戏了……";
			}elseif($itm == '→【神器任意门】←'){
				$log .= "你将这个门扉种在了地上。<br>但门扉突然消失了。<br>在你觉得你捡到了个笑话时，你听到了来自红暮的广播。<br>";
				//销毁物品
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','如果你们发现了什么带有异样颜色的代码断片，千万别合成它们，老实带过来给我就行。')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','大家请注意，虚拟幻境系统似乎遭到了来自不明人士的入侵。')");
				//播撒合成用物品
				$kitm1="［ΨТОВХ］";
				$kitm2="［ЫΑИЙВХΨ］";
				$kitm3="［ΩЙΑТΨ］";
				$rndpls1= rand(1,count($plsinfo)-2);
				$rndpls2= rand(1,count($plsinfo)-2);
				$rndpls3= rand(1,count($plsinfo)-2);
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm1', 'XB', '1', '1', '', '$rndpls1')");
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm2', 'XB', '1', '1', '', '$rndpls2')");
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm3', 'XB', '1', '1', '', '$rndpls3')");
				$plsname1 = $plsinfo[$rndpls1];
				$plsname2 = $plsinfo[$rndpls2];
				$plsname3 = $plsinfo[$rndpls3];
				$log .= "然后，你听到了来自不明人士的私聊——<br><span class=\"lime\">【？？？】就给你一些提示吧，你需要找到三个代码断片进行合成：{$kitm1}，{$kitm2}与{$kitm3}，它们分别位于{$plsname1}，{$plsname2}与{$plsname3}。<br>【？？？】祝你好运！</span>";
				$log .= "<br>看起来，在脱出幻境之前，你需要玩一把寻宝游戏了……";
			}else{
				$log .= "你启动了单人脱出机构。<br>";
				//销毁物品
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','如果你们发现了什么带有异样颜色的代码断片，千万别合成它们，老实带过来给我就行。')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','大家请注意，虚拟幻境系统似乎遭到了来自不明人士的入侵。')");
				//播撒合成用物品
				$kitm1="［ｒｍ］";
				$kitm2="［－ｒ］";
				$kitm3="［－ｆ］";
				$rndpls1= rand(1,count($plsinfo)-2);
				$rndpls2= rand(1,count($plsinfo)-2);
				$rndpls3= rand(1,count($plsinfo)-2);
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm1', 'XC', '1', '1', '', '$rndpls1')");
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm2', 'XC', '1', '1', '', '$rndpls2')");
				$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm3', 'XC', '1', '1', '', '$rndpls3')");
				$plsname1 = $plsinfo[$rndpls1];
				$plsname2 = $plsinfo[$rndpls2];
				$plsname3 = $plsinfo[$rndpls3];
				$log .= "然后，你听到了来自不明人士的私聊——<br><span class=\"lime\">【？？？】就给你一些提示吧，你需要找到三个代码断片进行合成：{$kitm1}，{$kitm2}与{$kitm3}，它们分别位于{$plsname1}，{$plsname2}与{$plsname3}。<br>【？？？】祝你好运！</span>";
				$log .= "<br>看起来，在脱出幻境之前，你需要玩一把寻宝游戏了……";
			}
		} elseif ($itm == '【E.S.C.A.P.E】'){
			//global $db, $tablepre;
			//这实际上是个死法，但是会给成就，称号，并加积分与胜场。
			include_once GAME_ROOT . './include/state.func.php';
			//成就检查该物品本身的使用，逻辑不写在这里。
			$log .= '万事俱备，只欠逃离！<br>';
			//销毁物品
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			death ( 's_escape', '', 0, $itm );
		} elseif ($itmk =='ZB'){ //社团卡
			if($club)
			{
				//global $db,$tablepre;
				$log .="你已经是有身份的人了！不能再使用称号卡。<br>";
				$db->query("INSERT INTO {$tablepre}shopitem (kind,num,price,area,item,itmk,itme,itms,itmsk) VALUES ('18','1','20','0','$itm','$itmk','$itme','$itms','$itmsk')");
				$log .="<span class='yellow'>$itm</span>像是有生命一般从你的手上脱离，飞回了商店！";

			}
			//处理不能成为合法社团的情况
			elseif ($itme == 15){ //L5状态
				//global $wp, $wk, $wg, $wc, $wd, $wf, $club, $bid, $att, $def;
				$log .="【DEBUG】进入L5状态<br>";
				$log .= '你突然感觉到一种不可思议的力量贯通全身！<br>';
				$wp = $wk = $wg = $wc = $wd = $wf = 8010;
				$att = $def = 13337;
				changeclub(15,$data);
				addnews ( $now, 'suisidefail',$name ,$nick);
			}
			elseif ($itme == 17 || $itme > 22){ //状态机社团以及不存在的社团
				$log .="但是什么都没有发生！";
			}
			elseif ($itme == 20){ // 元素大师特殊处理
				//global $elements_info,$sparkle;
				//规则怪谈类型文案
				$log.="你拿起<span class='yellow'>$itm</span>左右端详着……<br>
				然后，它突然就在你的眼前消失了！<br>
				在你寻思着出了什么事情之后，你的面前突然多了几条类似于规则的玩意。<br>
				【特殊程序·元素大师使用规则】<br>
				<br>
				【其之一】这世上的一切都由六种元素组成。<br>
				【其之二】每种元素都能组成一种武器或防具。<br>
				【其之三】当你捡到物品后，便可将其提炼成元素。<br>
				【其之四】此外，看起来没有用的尸体也可被提炼，不过后果自负。<br>
				【其之五】提炼时偶尔会蹦出特殊信息，最好将它们记录下来。<br>
				【其之六】提炼出的元素，可以通过「元素合成」产出各种物品。<br>
				【其之七】相对是这个世界的摄理之一，如果过于追求数字，就无法体现特殊性。<br>
				正在你读着这些规则的时候，它们也在你的眼前慢慢消失……<br>";
				$log.="最后变成了一个<span class='sparkle'>{$sparkle}元素口袋{$sparkle}</span>！<br>";
				$log.="在你将这个口袋收起来时，突然胸口一紧，你的眼前跳出了更多的文字：<br>
				【其之零】在D.T.S.的虚拟环境中，不存在将物品单纯地放在一起就能合成的手段。<br>
				然后，一行新的文字替代了这条规则：<br>
				【其之零】一切都是数字的假象而已。<br>
				正在你回味着这句话的时候，一切已经恢复如初。";
				//社团变更
				changeclub(20,$data);
				//获取初始元素与第一条配方
				$dice = rand(0,5); $dice2 = rand(0,1); $dice3 = rand(0,3);
				${'element'.$dice} += 500+$dice;
				$clbpara['elements'] = Array();
				$clbpara['elements']['tags'] = Array($dice => Array('dom' => Array(0 => 1),'sub' => Array(0 => 1)));
				$clbpara['elements']['info']['d']['d1'] = 1;
				//初始化元素合成缓存文件
                include_once GAME_ROOT . './include/game/elementmix.func.php';
				emix_spawn_info();
            } elseif ($itme == 21) { //码语行人特殊处理
                //Let's have some fun !
				$clbpara['dialogue'] = 'club21entry';
				//$log .= "码语行人特殊处理<br>";
                //社团变更
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('0','$now','$name','','「Ρжжηψψρип ρип, ρжжηψψρжжρип ρип」')");
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('0','$now','$name','','「ρψψρип ρип, ρип ρип ρжжηψψρжж ρδ」')");
                changeclub(21, $data);
				//And we inflict some pretty damage as entry fee.
				$hp = $hp / 3;
				$sp = 1;
            } elseif ($itme == 22) { //偶像大师特殊处理
                $log .= "再等等吧……<br>";
            } else { //直接将社团卡的效果写入玩家club
                changeclub($itme, $data);
                $log .= "你的称号被改动了！";
			}
			//销毁物品
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '小叶子的妙妙箱'){
			// A multiuse item that will provide various of items for you, mainly traps.
			// However, there will be an increasing possibity that this item will self-explode.
			// And when it does, there will also be a possibity that you'll lose HP and SP.
			// Very low chance of insta-death.

			//init itm0.
			$itm0 = '';
			$itmk0 = '';
			$itme0 = 0;
			$itms0 = 0;
			$itmsk0 = '';
			$itmpara = '';

			//Par 低维生物's suggestion, the explode-rate will be stored in its $itmsk.
			$log.="你下定决心，打开了这个可疑的<span class='yellow'>$itm</span>，开始翻找起来……<br>";
			//Getting the item's current self-destruct rate.
			$harukaBoxExplodeRate = intval($itmsk);
			//Generate a random number based on the user's 1st Yume value.
			$harukaBoxCheck = diceroll($clbpara['randver1']);

			if ($harukaBoxCheck <= 17){
				//Get random low-mid effect trap.
				$log.="你从里面翻找出了看起来能作为<span class='yellow'>略微有趣的陷阱</span>的东西！<br>";

				$itm0 = '略微有趣的玻璃珠';
				$itmk0 = 'TN';
				$itme0 = diceroll($clbpara['randver1']);
				$itms0 = diceroll(5);
				$itmsk0 = '';
			}elseif ($harukaBoxCheck <= 23){
				//Get random HB item.
				$log.="你从里面翻找出了看起来能作为<span class='yellow'>有趣的补给</span>的东西！<br>";

				$itm0 = '有趣的零食';
				$itmk0 = 'HB';
				$itme0 = diceroll($clbpara['randver1']) * diceroll(3);
				$itms0 = diceroll(17);
				$itmsk0 = 'z';
			}elseif ($harukaBoxCheck <= 42){
				// Get random mid effect true damage trap.
				$log.="你从里面翻找出了看起来能作为<span class='yellow'>精心制作的陷阱</span>的东西！<br>";

				$itm0 = '精心制作的玻璃珠阵';
				$itmk0 = 'TNt';
				$itme0 = diceroll($clbpara['randver2']);
				$itms0 = diceroll(5);
				$itmsk0 = '';
			}elseif ($harukaBoxCheck <= 61){
				// Get random high effect trap.
				$log.="你从里面翻找出了看起来能作为<span class='yellow'>非常有趣的陷阱</span>的东西！<br>";

				$itm0 = '非常有趣的玻璃珠';
				$itmk0 = 'TN';
				$itme0 = diceroll($clbpara['randver3']);
				$itms0 = diceroll(5);
				$itmsk0 = '';
			}elseif ($harukaBoxCheck <= 80){
				// Get random percent damage trap.
				$log.="你从里面翻找出了看起来能作为<span class='yellow'>十分强力的陷阱</span>的东西！<br>";

				$itm0 = '强而有力的玻璃珠';
				$itmk0 = 'TN8';
				$itme0 = 1;
				$itms0 = diceroll(2);
				$itmsk0 = 'x';
			}elseif ($harukaBoxCheck <= 109){
				// Get high true damage trap.
				$log.="你从里面翻找出了看起来能作为<span class='yellow'>精心制作的可怕陷阱</span>的东西！<br>";

				$itm0 = '精心制作的可怕玻璃珠阵';
				$itmk0 = 'TNt';
				$itme0 = diceroll($clbpara['randver3']);
				$itms0 = diceroll(5);
				$itmsk0 = '';
			}else{
				// Get Chaos Normal Trap.
				$log.="你从里面翻找出了一些<span class='yellow'>不可名状</span>的东西！<br>它似乎可以当作陷阱使用……<br>";

				$itm0 = '不可名状之物';
				$itmk0 = 'TN';
				$itme0 = diceroll(114514);
				$itms0 = diceroll(69);
				$itmsk0 = '';
			}

			//Troll the player if itms0 somehow rolled an 0. YSK: I encountered that 4 times in a row.
			if ($itms0 == 0){
				$log.="然而，<span class='yellow'>$itm0</span>却伴随着一阵少女银铃般的笑声，<br>在你的手上化作一阵青烟消失了！<br>靠！<br>";
				$itm0 = '';
				$itmk0 = '';
				$itme0 = 0;
				$itms0 = 0;
				$itmsk0 = '';

				//Refund some of explode rate.
				//$harukaBoxCheck -= 30;
			}

			//Add to explode rate.
			$harukaBoxExplodeRate += $harukaBoxCheck;
			if ($harukaBoxExplodeRate < 667){
				$log.="<span class='yellow'>妙妙箱不怀好意地颤抖了一下。</span>但最终什么都没发生！<br>";
				//Write explode rate back to itmsk.
				$itmsk = strval($harukaBoxExplodeRate);
			}else{
				//BOOM!!
				$log.="<span class='yellow'>妙妙箱不怀好意地颤抖了一下。</span>然后华丽地在你的手上炸开了！<br>";
				//Destroy this item.
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
				//Also Destroy item0.
				$itm0 = $itmk0 = $itmsk0 = '';
				$itme0 = $itms0 = 0;
				//Get damage.
				$harukaBoxDamage = diceroll($clbpara['randver2']) * (diceroll(3) + 1);
				//Calculate Damage.
				if ($hp < $harukaBoxDamage){
					$dflag = diceroll(1024);
					if ($dflag > 1020){
						//YOU WA SHOCK!!
						include_once GAME_ROOT . './include/state.func.php';
						$log .= '你在一片火焰中失去了知觉。<br>';
						death ( 'event', '', 0, $itm );
					}else{
						$log .= "你受到了<span class='yellow'>巨大的</span>伤害！你感觉你整个人都要折在这里了！<br>";
						$hp = 1;
						$sp = 1;
					}
				}else{
					$hp -= $harukaBoxDamage;
					$sp -= $harukaBoxDamage;
					if ($sp < 1){
						$sp = 1;
					}
					$log .= "你受到了<span class='yellow'>$harukaBoxDamage</span>点伤害！<br>";
					$inf .= 'a';
					$log .= "你的双手也被炸得血肉模糊！真是不幸啊！<br>";
				}
			}

		} elseif ($itm == '随机数之神的庇佑'){
			//global $wp, $wk, $wg, $wc, $wd, $wf, $club, $bid, $att, $def;
			$log.="你将<span class='yellow'>$itm</span>捧在手心……<br>
			突然，从天上传来一个慵懒的声音：<br>
			<span class=\"blueseed\">“现在还没到我的上班时间呢！”<br>
			“不过既然你提前抽出来了，我也给你点好处，那么载入既定事项……”</span><br>
			然后你看到天上出现了一行字：【实行L5改造】<br>";
			$log .= '你突然感觉到一种不可思议的力量贯通全身！<br>';
			$wp = $wk = $wg = $wc = $wd = $wf = 8010;
			$att = $def = 13337;
			//$club = 15; 因为是神力嘛！↓但是下面这个还是要适用的。
			addnews ( $now, 'suisidefail',$name,$nick);
			//销毁物品
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】红暮'){
			//Songlists. They change your BGM, but more importantly...
			//They place a Brand on your character named BGMBrand in $clbpara.
			//It will have various hidden effects, search for BGMBrand for details.

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了音乐播放器的启动！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			$log.="你打开了手上的音乐播放器，里面传出了这样的声音：<br>
			<span class=\"ltcrimson\">“你的选择很不错，我这里为你准备了一些劲爆的摇滚乐。<br>
			一定能让你在这场战斗中热血沸腾的。”——红暮<br><br></span>
			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			$clbpara['event_bgmbook'] = $event_bgm['crimsontracks'];
			$clbpara['BGMBrand'] = 'crimson';
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】蓝凝'){

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了音乐播放器的启动！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			$log.="你打开了手上的音乐播放器，里面传出了这样的声音：<br>
			<span class=\"ltazure\">“姐姐似乎给你准备了摇滚乐，但我觉得还是我的更好一点。<br>
			这些歌曲都是上个年代的流行曲风，梦幻般的人声和幻境也更相称吧？<br>
			欸？你说这不就仅仅是音乐，没有人声么？为什么会这样呢？”——蓝凝<br><br></span>
			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			if ($clbpara['randver1'] < 64){
				$clbpara['event_bgmbook'] = $event_bgm['altazuretracks'];
			}else{
			$clbpara['event_bgmbook'] = $event_bgm['azuretracks'];}
			$clbpara['BGMBrand'] = 'azure';
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】芙蓉'){

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了音乐播放器的启动！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			$log.="你打开了手上的音乐播放器，里面传出了这样的声音：<br>
			<span class=\"tmagenta\">“干我们这行的，得时刻保持冷静优雅。<br>
			所以我给你准备了古典音乐，确切地说，是李斯特的《巡礼之年》第一部。<br>
			这可是被人称作是李斯特的大成之作的作品，Enjoy~”——芙蓉<br><br></span>
			<span class=\"ltcrimson\">“……做好身份隔离，芙蓉。”——红暮<br><br></span>
			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			$clbpara['event_bgmbook'] = $event_bgm['fleurtracks'];
			$clbpara['BGMBrand'] = 'fleur';
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】丁香'){

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了音乐播放器的启动！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			$log.="你打开了手上的音乐播放器，里面传出了这样的声音：<br>
			<span class=\"clan\">“欸？我也要提交一批歌单吗……？<br>
			那么我就尽量尝试一下……<br>
			就这些如何？虽然我觉得这可能不适合这个游戏吧……”——丁香<br><br></span>
			<span class=\"sienna\">“适合不适合另说，但这起名太差劲了——就地丢弃，请。”——芙蓉<br><br></span>
			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			$clbpara['event_bgmbook'] = $event_bgm['lilatracks'];
			$clbpara['BGMBrand'] = 'lila';
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】冰炎'){

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了音乐播放器的启动！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			$log.="你打开了手上的音乐播放器，里面传出了这样的声音：<br>
			<span class=\"orange\">“虚拟幻境我自然是知道的。高速动作PVP对吧？<br>
			要为这里提供一点音乐……吗。<br>
			那么就来点听起来很像某驰名游戏系列的配乐的曲子吧！”——冰炎<br><br></span>
			<span class=\"ltcrimson\">“微妙。”——红暮<br><br></span>
			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			$clbpara['event_bgmbook'] = $event_bgm['rimefiretracks'];
			$clbpara['BGMBrand'] = 'rimefire';
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】瑞克·拉玛尔'){
			$log.="你打开了手上的音乐播放器，里面传出了这样的声音：<br>
			<span class=\"orange\">“哦，你是想反叛随机数大神吧！<br>
			我知道的，摇骰子总是会让人心潮澎湃，那么就让我这位大英雄帮你一把吧！<br>
			音乐是其次，欢迎来到骰子的反叛世界！”——瑞克·拉玛尔<br><br></span>
			<span class=\"ltcrimson\">“这……这个不是都市传说么？快去查一查。”——红暮<br><br></span>
			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			$clbpara['event_bgmbook'] = $event_bgm['rixolamaltracks'];
			$clbpara['BGMBrand'] = 'rixolamal';
			//Some init...
			$clbpara['traitorRoll'] = 0;
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】小兔子警报！'){

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了音乐播放器的启动！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			if ($clbpara['touchedByBunny'] == 0){
			$rp -= 120;}
			$log.="你打开了手上的奇怪物品，里面传出了这样的声音：<br>
			<span class=\"lime\">“为什么突然会给游戏加入歌单这种东西……？<br>
			那么为了更好地伪装，我也注入个歌单进来。<br>
			毕竟我平时码代码就是听这些的。顺路啦。”——？？？？<br><br></span>

			<span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
			if ($clbpara['randver3'] < 512){
				$clbpara['event_bgmbook'] = $event_bgm['christracks'];
			}else{
				$log.="<span class=\"tmagenta\">“哈，抓到你了。<br>顺便……这个啊……要用我喜欢的语言来唱。”——芙蓉<br></span>";
			$clbpara['event_bgmbook'] = $event_bgm['altchristracks'];}
			$clbpara['BGMBrand'] = 'christine';
			$clbpara['touchedByBunny'] += 1;
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '【歌单】林无月'){

			if ($clbpara['BGMBrand'] == 'rixolamal'){
				$log.="一种神奇的力量阻止了你按下按钮！<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}

			$log.="你按下了手中遥控器的按钮。<br>
			<span class=\"yellow\">你重置了你的音乐播放列表！<br></span>";
			unset($clbpara['event_bgmbook']);
			unset($clbpara['BGMBrand']);
			//Destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '人生重来炮'){
			//detect if you are actually able to use this.
			if ($pls > 100){
				$log.="你点燃了这门炮的引线，然后尝试将头伸进炮筒之中。<br>
				<span class=\"yellow\">但是大炮突然就这么消失了！这是怎么回事呢？<br></span>";
				//destroy this item.
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
			if ($mhp <= 200){
				$log.="你点燃了这门炮的引线，然后尝试将头伸进炮筒之中。<br>
				<span class=\"yellow\">但是你体能已经太弱，在成功将头伸进去之前，大炮就在你面前发射了！<br></span>
				<span class=\"red\">你被炮弹射了一脸，受到了巨大的伤害！<br>";
				$hp = 1;
				//destroy this item.
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
			$log.="你点燃了这门炮的引线，然后迅速将头伸进了炮筒之中！<br>
			<span class=\"yellow\">只听轰地一声，你被炮弹击出了千米之外，你感觉身体内的什么东西焕然一新了……<br></span>";
			//Reset... some values...
			$clbpara['randver1'] = rand(1,128);
			$clbpara['randver2'] = rand(1,256);
			$clbpara['randver3'] = rand(1,1024);
			//process damage
			$mhp -= 200;
			$hp = $mhp;
			$msp -= 200;
			$sp = $msp;
			$log.="<span class=\"red\">你受到了相当的伤害，龇牙咧嘴地站了起来。<br></span>";
			//process area change
			$pls = rand(1,count($plsinfo)-2);
			//destroy this item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		} elseif ($itm == '善良之刃'){
			//fake a death message.
			$log.="你觉得这个幻境太过危险，真的呆不下去了！<br>
				<span class=\"yellow\">于是你将这把匕首对着自己，噗叽一声就刺了下去！<br></span>";
			//it will require 200+ rage.
			if ($rage <= 200){
				$log.="匕首的刀刃却被弹开了！<br>
				从匕首中传来了恶意的嘲笑：<br>
				<span class=\"yellow\">“桀桀桀，连自裁的决心都没有，你还真是个软蛋！”<br></span>
				你出离愤怒，一脚将匕首踩碎了。<br>
				<br>
				你被整蛊物品嘲讽，非常生气！<br>";
				$rage = 200;
				//destroy this item.
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}else{
				$log.="白刀子进，白刀子出！<br>
				你被中刀的冲击击飞，落在了地上。<br>
				好疼。<br>
				<span class=\"yellow\">等下……白刀子……出？<br></span>
				你听到了你的死亡报告，但还是毫发无伤地站了起来。<br>
				想死而不能，这可是太逊了……<br>
				你不禁叹出一口气。<br>";

				$rage = 0;
				//add fake death news - Event Death.
				addnews($now,'death13',$name,0);
				//add fake death chat.
				$db->query ( "INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('3','$now','$name','$pls','我觉得我还可以抢救一下……')" );
				//destroy this item.
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			}
		} elseif ($itm == 'NPC战斗测试仪'){
			include_once GAME_ROOT.'./include/game/revcombat.func.php';
			$pa = fetch_playerdata_by_pid(1);
			$pd = fetch_playerdata_by_pid(2);
			\revcombat\rev_combat_prepare($pa,$pd,1);
		} elseif ($itm == '显现战斗测试仪'){
			//Mod the above item, YOU'll enter fight with a player entry matching the item's $itme value.
			global $pid;
			include_once GAME_ROOT.'./include/game/revcombat.func.php';
			$pa = fetch_playerdata_by_pid($pid);
			$pd = fetch_playerdata_by_pid($itme);
			\revcombat\rev_combat_prepare($pa,$pd,1);
		} elseif ($itm == '战斗显现测试仪'){
			//Mod the above item, A player entry matching item's $itme value will enter a fight with YOU.
			global $pid;
			include_once GAME_ROOT.'./include/game/revcombat.func.php';
			$pa = fetch_playerdata_by_pid($itme);
			$pd = fetch_playerdata_by_pid($pid);
			\revcombat\rev_combat_prepare($pa,$pd,1);
		} elseif ($itm == '对话测试器'){
			//???
			$clbpara['dialogue'] = 'testingDialog';
			//$clbpara['noskip_dialogue'] = 1;
		} elseif ($itm == '事件BGM替换器'){
			// 这是一个触发事件BGM的案例，只要输入$clbpara['event_bgmbook'] = Array('事件曲集名'); 即可将当前曲集替换为特殊事件BGM
			// 特殊事件曲集'event_bgmbook'的优先级高于地图曲集'pls_bgmbook'，前者存在时后者不会生效
			//global $clbpara,$event_bgm;
			//include_once config('audio',$gamecfg);
			$log.="【DEBUG】你目前的播放列表被替换为了{$event_bgm['test'][0]}！<br>特殊的事件曲集不会被其他曲集覆盖，除非你使用下面的道具。<br>";
			$clbpara['event_bgmbook'] = $event_bgm['test'];
		} elseif ($itm == '事件BGM还原器'){
			// 这是一个取消事件BGM的案例，只要unset($clbpara['event_bgmbook']);就可以将当前曲集替换为地图曲集或默认曲集；
			// 如果你想播放另一个事件曲集，也可以$clbpara['event_bgmbook'] = Array('另一个事件曲集名');
			//global $clbpara;
			$log.="【DEBUG】你目前的播放列表还原为了默认播放列表！<br>";
			unset($clbpara['event_bgmbook']);
		} elseif ($itm == '成就重置装置'){
			//使用会重置对应属性编号的成就进度
			include_once GAME_ROOT.'./include/game/achievement.func.php';
			reset_achievement_rev($itmsk,$name);
		} elseif ($itm == '测试用元素口袋'){
			//global $elements_info;
			$log.="【DEBUG】你不知道从哪里摸出来一大堆元素！<br>";
			foreach($elements_info as $e_key=>$e_info)
			{
				//global ${'element'.$e_key};
				${'element'.$e_key} += 100000;
				$log.="获得了100000份".$elements_info[$e_key]."！<br>";
			}
			//初始化元素合成缓存文件
			include_once GAME_ROOT.'./include/game/elementmix.func.php';
			emix_spawn_info();
		} elseif ($itm == '测试用元素大师社团卡'){
			//-----------------------//
			//这是一张测试用卡 冴冴可以挑一些用得上的放在使用社团卡后执行的事件里
			//global $elements_info,$sparkle;
			//未选择社团情况下才可以用社团卡
			if($club)
			{
				$log.="你已经是有身份的人了！不能再使用社团卡。<br>";

			}
			//反正是测试用的 发段怪log
			$log.="你拿起<span class='yellow'>$itm</span>左右端详着……<br>
			你将目光扫过卡片上若隐若现的纹理，突然发现这张卡内似乎别有洞天。<br>
			透过纹理，你看到一群奇装异服的小人们，围坐在一处颇具古典风格的露天广场上。<br>
			广场中央有一人，正抬手指天，慷慨陈词。<br>
			你听不到它们在说什么，但演讲者那极富感染力的动作勾起了你的好奇心，<br>
			你不由自主得沿着它指的方向望去——<br>
			<br>
			洁白如镜的天穹上，倒映出的是你的脸。<br>
			<br>
			你赶忙移开视线，但小人们已经发现了你。<br>
			从广场再到远处的平原上，数以十计、百计、千计、万计，
			一眼望不到头的小人们从你视野的尽头涌出，挤向你所在的方向。<br>
			你一时慌乱，下意识地便将手里的卡片丢了出去。<br>
			眼前亦真亦幻的怪异景象登时消失不见了。<br>
			<br>
			你低下头，发现脚下的卡片已经被烧掉了一半，<br>
			在被火焰烧灼得卷曲起的边缘处，漏出了某样东西的一角。<br>
			你捡起卡片，甩了甩，便看到一个足足有卡片五倍甚至四倍大的东西从里面掉了出来！<br>";
			$log.="<br>获得了<span class='sparkle'>{$sparkle}元素口袋{$sparkle}</span>！<br>";
			$log.="……这到底是怎么一回事呢？<br><br>";
			//社团变更
			changeclub(20,$data);
			//获取初始元素与第一条配方
			$dice = rand(0,5);
			//global ${'element'.$dice};
			${'element'.$dice} += 200+$dice;
			//初始化元素合成缓存文件
			include_once GAME_ROOT.'./include/game/elementmix.func.php';
			emix_spawn_info();
			//销毁道具
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			//-----------------------//
		} elseif ($itm == '提示纸条A') {
			$log .= '你读着纸条上的内容：<br>“执行官其实都是幻影，那个红暮的身上应该有召唤幻影的玩意。”<br>“用那个东西然后打倒幻影的话能用游戏解除钥匙出去吧。”<br>';
		} elseif ($itm == '提示纸条B') {
			$log .= '你读着纸条上的内容：<br>“我设下的灵装被残忍地清除了啊……”<br>“不过资料没全部清除掉。<br>用那个碎片加上传奇的画笔和天然属性……”<br>“应该能重新组合出那个灵装。”<br>';
		} elseif ($itm == '提示纸条C') {
			$log .= '你读着纸条上的内容：<br>“小心！那个叫红暮的家伙很强！”<br>“不过她太依赖自己的枪了，有什么东西能阻挡那伤害的话……”<br>';
		} elseif ($itm == '提示纸条D') {
			$log .= '你读着纸条上的内容：<br>“我不知道另外那个孩子的底细。如果我是你的话，不会随便乱惹她。”<br>“但是她貌似手上拿着符文册之类的东西。”<br>“也许可以利用射程优势？！”<br>“你知道的，法师的射程都不咋样……”';
		} elseif ($itm == '提示纸条E') {
			$log .= '你读着纸条上的内容：<br>“生存并不能靠他人来喂给你知识，”<br>“有一套和元素有关的符卡的公式是没有出现在帮助里面的，用逻辑推理好好推理出正确的公式吧。”<br>“金木水火土在这里都能找到哦～”<br>';
		} elseif ($itm == '提示纸条F') {
			$log .= '你读着纸条上的内容：<br>“喂你真的是全部买下来了么……”<br>“这样的提示纸条不止这六种，其他的纸条估计被那两位撒出去了吧。”<br>“总之祝你好运。”<br>';
		} elseif ($itm == '提示纸条G') {
			$log .= '你读着纸条上的内容：<br>“上天保佑，”<br>“请不要在让我在模拟战中被击坠了！”<br>“空羽 上。”<br>';
		} elseif ($itm == '提示纸条H') {
			$log .= '你读着纸条上的内容：<br>“在研究施设里面出了大事的SCP竟然又输出了新的样本！”<br>“按照董事长的意见就把这些家伙当作人体试验吧！”<br>署名看不清楚……<br>';
		} elseif ($itm == '提示纸条I') {
			$log .= '你读着纸条上的内容：<br>“嗯……”<br>“制作神卡所用的各种认证都可以在商店里面买到。”<br>“其实卡片真的有那么强大的力量么？”<br>';
		} elseif ($itm == '提示纸条J') {
			$log .= '你读着纸条上的内容：<br>“知道么？”<br>“果酱面包果然还是甜的好，哪怕是甜的生姜也能配制出如地雷般爆炸似的美味。”<br>“祝你好运。”<br>';
		} elseif ($itm == '提示纸条K') {
			$log .= '你读着纸条上的内容：<br>“水符？”<br>“你当然需要水，然后水看起来是什么颜色的？”<br>“找一个颜色类似的东西合成就有了吧。”<br>';
		} elseif ($itm == '提示纸条L') {
			$log .= '你读着纸条上的内容：<br>“木符？”<br>“你当然需要树叶，然后说到树叶那是什么颜色？”<br>“找一个颜色类似的东西合成就有了吧。”<br>';
		} elseif ($itm == '提示纸条M') {
			$log .= '你读着纸条上的内容：<br>“火符？”<br>“你当然需要找把火，然后说到火那是什么颜色？”<br>“找一个颜色类似的东西合成就有了吧。”<br>';
		} elseif ($itm == '提示纸条N') {
			$log .= '你读着纸条上的内容：<br>“土符？”<br>“说到土那就是石头吧，然后说到石头那是什么颜色？”<br>“找一个颜色类似的东西合成就有了吧。”<br>';
		} elseif ($itm == '提示纸条P') {
			$log .= '你读着纸条上的内容：<br>“金符？这个的确很绕人……”<br>“说到金那就是炼金，然后这是21世纪了，炼制一个金色方块需要什么？”<br>“总之祝你好运。”<br>';
		} elseif ($itm == '提示纸条Q') {
			$log .= '你读着纸条上的内容：<br>“据说在另外的空间里面；”<br>“一个吸血鬼因为无聊就在她所居住的地方洒满了大雾，”<br>“真任性。”<br>';
		} elseif ($itm == '提示纸条R') {
			$log .= '你读着纸条上的内容：<br>“知道么，”<br>“东方幻想乡这作游戏里面EXTRA的最终攻击”<br>“被老外们称作『幻月的Rape Time』，当然对象是你。”<br>';
		} elseif ($itm == '提示纸条S') {
			$log .= '你读着纸条上的内容：<br>“土水符？”<br>“哈哈哈那肯定是需要土和水啦，可能还要额外的素材吧。”<br>“总之祝你好运。”<br>';
		} elseif ($itm == '提示纸条T') {
			$log .= '你读着纸条上的内容：<br>“我一直对虚拟现实中的某些迹象很在意……”<br>“这种未名的威压感是怎么回事？”<br>“总之祝你好运。”<br>';
		} elseif ($itm == '提示纸条U') {
			$log .= '你读着纸条上的内容：<br>“纸条啥的……”<br>“希望这张纸条不会成为你的遗书。”<br>“总之祝你好运。”<br>';
		} elseif ($itm == '人品探测器') {
			//global $rp;
			$log .= '你读着纸条上的内容：<br>“你的RP值为'.$rp.'。”<br>“总之祝你好运。”<br>';
		} elseif ($itm == '仪水镜') {
			//global $rp;
			$log .= '水面上映出了你自己的脸，你仔细端详着……<br>';
			if ($rp < 40){
				$log .= '你的脸看起来十分白皙。<br>';
			} elseif ($rp < 200){
				$log .= '你的脸看起来略微有点黑。<br>';
			} elseif ($rp < 550){
				$log .= '你的脸上貌似笼罩着一层黑雾。<br>';
			} elseif ($rp < 1200){
				$log .= '你的脸已经和黑炭差不多了，赶快去洗洗！<br>';
			} elseif ($rp < 5499){
				$log .= '你印堂漆黑，看起来最近要有血光之灾！<br>';
			} elseif ($rp > 5500){
				$log .= '水镜中已经黑的如墨一般了。<br>希望你的H173还在……<br>';
			} else{
				$log .= '你的脸从水镜中消失了。<br>';
			}
		} elseif ($itm == '风祭河水'){
			//global $rp, $wp, $wk, $wg, $wc, $wd, $wf;
			$slv_dice = rand ( 1, 20 );
				if ($slv_dice < 8) {
				$log .= "你一口干掉了<span class=\"yellow\">$itm</span>，不过好像什么都没有发生！";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			} elseif ($slv_dice < 16) {
				$rp = $rp - 10*$slv_dice;
				$log .= "你感觉身体稍微轻了一点点。<br>";
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			} elseif ($slv_dice < 20) {
				$rp = 0 ;
				$log .= "你头晕脑胀地躺到了地上，<br>感觉整个人都被救济了。<br>你努力着站了起来。<br>";
				$wp = $wk = $wg = $wc = $wd = $wf = 100;
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
			} else {
				$log .= '你头晕脑胀地躺到了地上，<br>感觉整个人都被救济了。<br>';
				include_once GAME_ROOT . './include/state.func.php';
				$log .= '然后你失去了意识。<br>';
				//$bid = 0;
				death ( 'salv', '', 0, $itm );
			}
		} elseif ($itm == '『灵魂宝石』' || $itm == '『祝福宝石』') {
			//global $cmd;
            //码语行人，$club==21的时候不能使用宝石
            if ($club == 21) {
				$log .= "<span class=\"yellow\">突然，你的眼前出现了扭曲的字符！</span><br>";
				$log .= "<span class=\"glitchb\">
				“纠结纠结小问号，<br>
				代码溢出怎么搞？<br>
				干脆一刀禁了它。<br>
				反正挨打不用愁！”<br></span><br>";
				$log .= "<span class=\"yellow\">唔，看起来这个宝石对你似乎没有什么意义……</span><br>";
                return;
            }
			$cmd = '<input type="hidden" name="mode" value="item"><input type="hidden" name="usemode" value="qianghua"><input type="hidden" name="itmp" value="' . $itmn . '">你想强化哪一件装备？<br><input type="radio" name="command" id="menu" value="menu" checked><a onclick=sl("menu"); href="javascript:void(0);" >返回</a><br><br><br>';
            for ($i = 1; $i <= 6; $i++) {
				//global ${'itmsk' . $i};
                if ((strpos(${'itmsk' . $i}, 'Z') !== false) && (strpos(${'itm' . $i}, '宝石』') === false)) {
					//global ${'itm' . $i}, ${'itme' . $i}, ${'itms' . $i};
                    $cmd .= '<input type="radio" name="command" id="itm' . $i . '" value="itm' . $i . '"><a onclick=sl("itm' . $i . '"); href="javascript:void(0);" >' . "{${'itm' .$i}}/{${'itme' .$i}}/{${'itms' .$i}}" . '</a><br>';
				  $flag = true;
				}
			}
			$cmd .= '<br><br><input type="button" onclick="postCmd(\'gamecmd\',\'command.php\');" value="提交">';
			if (! $flag) {
				$log .='唔？你的包裹里没有可以强化的装备，是不是没有脱下来呢？DA☆ZE<br><br>';
			}else{
				$log .="宝石在你的手上发出异样的光芒，似乎有个奇怪的女声在你耳边说道<span class=\"yellow\">\"我是从天界来的凯丽\"</span>.";
			}
			return;
		} elseif ($itm == '调制解调器'){
			if(!empty($gamevars['apis']))
			{
				$log .= '你将这件长得很像猫的东西放在了地上……目送它慢悠悠地爬走了。<br>';
				if($gamevars['api'] < $gamevars['apis'])
				{
					$gamevars['api']++;
					save_gameinfo();
					$log .= '<span class="yellow">好像有什么东西恢复了！</span><br>';
				}
				else
				{
					$log .= '<span class="yellow">但是什么也没有发生！</span><br>';
				}
				$itms--;
			}
			else
			{
				$log .= '这件长得很像猫的东西该怎么用呢？<br>';
			}
		} elseif ($itm == '水果刀') {
			$flag = false;

			for($i = 1; $i <= 6; $i ++) {
				//global ${'itm' . $i}, ${'itmk' . $i},${'itms' . $i},${'itme' . $i},$wk;
				if (strpos(${'itmsk' . $i}, '🍎') !== false) {
					if($wk >= 120){
						$log .= "练过刀就是好啊。你娴熟地削着果皮。<br><span class=\"yellow\">{${'itm'.$i}}</span>变成了<span class=\"yellow\">★残骸★</span>！<br>咦为什么会出来这种东西？算了还是不要吐槽了。<br>";
						${'itm' . $i} = '★残骸★';
						${'itme' . $i} *= rand(2,4);
						${'itms' . $i} *= rand(3,5);
						${'itmsk' . $i} = '';
						$flag = true;
						$wk++;
					}else{
						$log .= "想削皮吃<span class=\"yellow\">{${'itm'.$i}}</span>，没想到削完发现只剩下一堆果皮……<br>手太笨拙了啊。<br>";
						$brackets_arr = Array('☆☆','★★','〖〗','【】','『』','「」','✦✦','☾☽','☼☼','■■');
						$if_brackets = 0;
						foreach ($brackets_arr as $brackets)
						{
							if ((mb_substr(${'itm' . $i}, 0, 1)).(mb_substr(${'itm' . $i}, -1)) === $brackets){
								$if_brackets = 1;
								${'itm' . $i} = mb_substr(${'itm' . $i}, 0, -1).'皮'.mb_substr(${'itm' . $i}, -1);
								break;
							}
						}
						if ($if_brackets == 0) ${'itm' . $i} = ${'itm' . $i}.'皮';
						${'itmk' . $i} = 'TN';
						${'itms' . $i} *= rand(2,4);
						${'itmsk' . $i} = '';
						$flag = true;
						$wk++;
					}
					break;
				}
				if($flag == true) {break;};
			}
			if (! $flag) {
				$log .= '包裹里没有水果。<br>';
			} else {
				$dice = rand(1,5);
				if($dice==1){
					$log .= "<span class=\"red\">$itm</span>变钝了，无法再使用了。<br>";
					$itm = $itmk = $itmsk = '';
					$itme = $itms = 0;
				}
			}
		} elseif(strpos($itm,'RP回复设备')!==false){
			//global $rp;
			$rp = 0;
			$log .= "你使用了<span class=\"yellow\">$itm</span>。你的RP归零了。<br>";
		} elseif($itm == '😂我太酷啦！😂') {
			$log .= "你毅然决然地高喊了一句：“我·太·酷·啦~”<br>一拳头锤碎了这个奇形怪状的按钮。<br>随后，在失去意识之前，你感觉你的身体飞上了天空。<br>";
			# Also produce a chatlog
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('0','$now','$name','','「我·太·酷·啦~」')");

			# Do an initial coin toss
			$selfdestructdice1 = diceroll(1);
			$selfdestructdice2 = diceroll(6);

			if ($selfdestructdice1 > 0){
				# You'll self destruct into a bunch of happy items, to bring smile to others.
				$happyitemname = $name . "的存在意义";
				# Firstly, we look at your stats to see how strong those would be, and how many of them would it be.
				$happyitemeffect = round($mhp / 20);
				$happyitemnumber = round($exp / 20);
				# Then, we look at the dice result to see what would you explode into.
				if ($selfdestructdice2 == 1){
					$happyitemkind = "HH";
				}elseif ($selfdestructdice2 == 2){
					$happyitemkind = "HS";
				}elseif ($selfdestructdice2 == 3){
					$happyitemkind = "PH";
				}elseif ($selfdestructdice2 == 4){
					$happyitemkind = "PS";
				}elseif ($selfdestructdice2 == 5){
					$happyitemkind = "HM";
				}elseif ($selfdestructdice2 == 6){
					$happyitemkind = "TO";
				}else{
					$happyitemkind = "T";
				}

				# Producing a valid arealist
				$rndhappypls= rand(1,count($plsinfo)-2);

				# Process the item insertation process.
				# But, before that, a special treatment for map traps:
				if ($selfdestructdice2 == 6){
					# Insert traps into maptrap table.
					for ($i = 0; $i < $happyitemnumber; $i++){
						$rndhappypls= rand(1,count($plsinfo)-2);
						$db->query("INSERT INTO {$tablepre}maptrap (itm, itmk, itme, itms, itmsk, pls) VALUES ('$happyitemname', '$happyitemkind', '$happyitemeffect', '1', '$pid', '$rndhappypls')");
					}
					$log .= "你的身体在高空中炸出了一片烟花。<br>
					在那烟花中，那曾经属于你的存在落在了幻境的地面上，钻进了地底下。<br>
					想必，这会为大家带来惊喜吧……<br>";
				}else{
					# Insert items into mapitem table.
					for ($i = 0; $i < $happyitemnumber; $i++){
						$rndhappypls= rand(1,count($plsinfo)-2);
						$db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$happyitemname', '$happyitemkind', '$happyitemeffect', '1', '$pid', '$rndhappypls')");
					}
					$log .= "你的身体在高空中炸出了一片烟花。<br>
					在那烟花中，那曾经属于你的存在落在了幻境的地面上。<br>
					想必，这会为大家带来笑容吧……<br>";
				}
				# Then we produce a chat for this feat.
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【幻境自检】','','检测到未经授权的地图物品！')");

			}else{
				# Nothing happens, you just self destruct.
				$log .= "你的身体在高空中炸成了一片烟花，<br>
				给虚拟幻境的天空带来了五彩的红霞。<br>
				大家看到这祥瑞的天象，纷纷露出了笑容。<br>
				这大概就是……「笑容世界」吧。<br>
				大逃杀真是塔洛西啊！<br>";
			}
			# Then we kill you to end everything.
			include_once GAME_ROOT . './include/state.func.php';
			death ( 'sdestruct', '', 0, $itm );
			# But wait, since you exploded, you can't leave a body!
			$db->query ( "UPDATE {$tablepre}players SET weps='0',arbs='0',arhs='0',aras='0',arfs='0',arts='0',itms0='0',itms1='0',itms2='0',itms3='0',itms4='0',itms5='0',itms6='0',money='0' WHERE pid = {$pid} " );
		} elseif($itm == '【我太帅啦！】') {
			# Joke Item, fill the user's bag with garbage items.
			$log .= "按下这个按钮后，你突然有了一种神奇的想表现自己的欲望，<br>
				<span class=\"minirainbow\">于是你突然从手中具现出了一大堆卡牌，然后自顾自摆起了阵法！</span><br>
				等你回过神来，你发现你的背包里面到处都是莫名其妙的卡牌。<br>
				希望这真的值得……<br>";
			$itm1 = '脑内印出的超雷龙-雷龙 ★8'; $itm2 = '脑内印出的命运英雄 毁灭凤凰人 ★8'; $itm3 = '脑内印出的枪管上膛狞猛龙 ★8';
			$itm4 = '勇者衍生物 ★4'; $itm5 = '脑内印出的流离的狮鹫骑手 ★7'; $itm6 = '脑内印出的T.G.超图书馆员 ★5';
			$itme1 = $itme2 = $itme3 = $itme5 = $itme6 = 1;
			$itme4 = 20;
			$itmk1 = $itmk2 = $itmk3 = 'WC08';
			$itms1 = $itms2 = $itms3 = $itms4 = $itms5 = $itms6 = 1;
			$itmk4 = 'WC04'; $itmk5 = 'WC07'; $itmk6 = 'WC05';
			$itmsk1 = $itmsk2 = $itmsk3 = $itmsk4 = $itmsk5 = $itmsk6 = '';
			# Destroy the item.
			//$itm = $itmk = $itmsk = '';
			//$itme = $itms = 0;
			# Sign
			$clbpara['iAmHandsome'] += 1;
		} elseif($itm == '【我太棒啦！】') {
			# Joke Item, shred the user's HP and SP, then convert them into health item.
			$log .= "按下这个按钮后，你突然觉得你很棒，<br>
			于是举起双拳就像大猩猩一样擂起胸膛。<br>
			<span class=\"minirainbow\">但你用力过猛，感觉体内的什么东西竟然被吐了出来！</span><br>
			希望这真的值得……<br>";
			$lossdice = diceroll(92);
			$oldhp = $hp;
			$oldsp = $sp;
			$hp = round($hp * ($lossdice / 100));
			$sp = round($sp * ($lossdice / 100));
			$diff = ($oldhp + $oldsp) - ($hp + $sp);

			$itm0 = $name . "的力量";
			$itme0 = $diff;
			$itmk0 = 'HB';
			$itms0 = 1;
			$itmsk0 = '';
			# Destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			# Sign
			$clbpara['iAmGreat'] += 1;
		} elseif($itm == '【我太强啦！】') {
			# Joke Item, Alerting the position of the user by generate a chatlog and decrease their $mhp by 100.
			if ($mhp < 100) {
				$log .= "你作势想按下按钮，但立刻觉得你似乎还不够强……<br>还是算了吧。<br>";
			}else{
				# Output some log.
				$log .= "按下这个按钮后，你突然想让战场上的各位看到你强大的一面，于是你吐气扬声，大吼一句：<br>
				<span class=\"minirainbow\">“我　太　强　啦！”</span><br>
				然而，因为你喊得太用力了，你吐出了一口鲜血！<br>
				<span class=\"minirainbow\">你的最大生命值减少了100点！</span><br>
				希望这真的值得……<br>";
				$mhp -= 100;
				if ($hp>$mhp) $hp = $mhp;
				$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('0','$now','$name','','「我　太　强　啦！」')");
				# Destroy the item.
				$itm = $itmk = $itmsk = '';
				$itme = $itms = 0;
				# Sign
				$clbpara['iAmStrong'] += 1;
			}
		} elseif($itm == '【我太牛啦！】') {
			# Joke Item, Aleating the position of the user, then turn their $mhp and $msp into money.
			$log .= "按下这个按钮后，你突然觉得你很牛Ｂ。于是你仰天长啸：<br>
			<span class=\"minirainbow\">“我身上钱很多，快来撩我！”</span><br>
			然后，你觉得眼前一黑，你的身上真的多出了很多钱！<br>
			希望这真的值得……<br>";
			$lossdice = diceroll(98);
			$oldmhp = $mhp;
			$oldmsp = $msp;
			$mhp = round($mhp * ($lossdice / 100));
			$msp = round($msp * ($lossdice / 100));
			$hp = $mhp; $sp = $msp;
			$diff = ($oldmhp + $oldmsp) - ($mhp + $msp);
			$money += $diff;
			$log .= "你的最大生命值和最大体力值被转换成了<span class=\"yellow\">$diff</span>点金钱！<br>";
			$db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('0','$now','$name','','「我身上钱很多，快来撩我！」')");
			# Destroy the item.
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
			# Sign
			$clbpara['iAmRich'] += 1;
		} elseif ($itm == '棱镜八面体'){
			$log .= "你使用了<span class=\"yellow b\">{$itm}</span>。<br>";
			$theitem = array('itm' => &$itm, 'itmk' => &$itmk, 'itme' => &$itme,'itms' => &$itms,'itmsk' => &$itmsk);
			octitem_rotate($theitem, $itmn, 1);
		} else {
			$log .= " <span class=\"yellow\">$itm</span> 该如何使用呢？<br>";
		}

		//元素大师使用提示纸条的特殊效果：
		if($club == 20 && strpos($itmk,'Y')===0 && strpos($itm,'提示纸条')!==false)
		{
			$log.="<br>就在你读完内容打算把纸条收起来时，你愕然发现纸条背面竟然还有字！<br><br>";
			include config('elementmix',$gamecfg);
			$log.= $emix_slip[array_rand($emix_slip)];
			//除商店纸条外：提供一条元素特征（TODO）、或一条固定配方、或一条随机属性组合
			$log .= "<br><span class='yellow'>附：见面有缘，再送你一条提示吧：<br>“将带有";
			if(!preg_match('/(A|B|C|D)/',$itm))
			{
				//野生纸条：给随机属性组合提示
				$submix_list = array_merge_recursive($submix_list,$gamevars['rand_emixsubres']);
			}
			$s_id = array_rand($submix_list);
			$s_result = $itemspkinfo[$submix_list[$s_id]['result']];
			foreach($submix_list[$s_id]['stuff'] as $skey) $log .= "【$itemspkinfo[$skey]】";
			$log .= "特征的元素组合起来，就有机会组合出【{$s_result}】属性。”</span><br>";
			//阅后即焚
			$log .="<br>……说这么多鬼记得住啊！<br>你思考了一下，决定把{$itm}吃进肚子里，以便慢慢消化其中的知识。<br>";
			$itms--;
			# 将提示给到的次要特征组合加入笔记内
			if(empty($clbpara['elements']['info']['sd']['sd'.$s_id]))
				$clbpara['elements']['info']['sd']['sd'.$s_id] = 1;
		}

		if (($itms <= 0) && ($itm)) {
			$log .= "<span class=\"red\">$itm</span> 用光了。<br>";
			$itm = $itmk = $itmsk = '';
			$itme = $itms = 0;
		}

	} else {
		$log .= "你使用了道具 <span class=\"yellow\">$itm</span> 。<br>但是什么也没有发生。<br>";
	}

	include_once GAME_ROOT.'./include/game/achievement.func.php';
	check_item_achievement_rev($name,$i,$ie,$is,$ik,$isk);

	$mode = 'command';
	return;
}

function octitem_rotate(&$theitem, $rotpos, $showlog = 0)
{
	global $log;
	$itm=&$theitem['itm']; $itmk=&$theitem['itmk'];
	$itme=&$theitem['itme']; $itms=&$theitem['itms']; $itmsk=&$theitem['itmsk'];
	$oct_colors_words = array('<span class="red">红</span>','<span class="lime">绿</span>','<span class="clan">蓝</span>','<span class="yellow">黄</span>','<span class="gold">金</span>','<span class="linen">银</span>','<span class="mtgblack">黑</span>','<span class="mtgwhite">白</span>');

	if (strlen($itmsk) != 16)
	{
		$oct_seq = range(0, 7);
		shuffle($oct_seq);
		$oct_colors = range(0, 7);
		shuffle($oct_colors);
	}
	else
	{
		$itmsk_arr = str_split($itmsk);
		$oct_seq = array_slice($itmsk_arr, 0, 8);
		$oct_colors = array_slice($itmsk_arr, 8);
	}

	//改变选中面和另两个面的颜色
	$oct_colors[$rotpos] = ($oct_colors[$rotpos] + 1) % 8;
	$rotpos2 = ($rotpos + 1) % 8;
	$oct_colors[$rotpos2] = ($oct_colors[$rotpos2] + 1) % 8;
	$rotpos3 = ($rotpos + 2) % 8;
	$oct_colors[$rotpos3] = ($oct_colors[$rotpos3] + 1) % 8;
	$itmsk = implode('', $oct_seq).implode('', $oct_colors);

	if ($showlog)
	{
		$log .= "<br><span class=\"yellow b\">{$itm}</span>八个面的颜色为：<br>";
		foreach ($oct_seq as $v)
		{
			$log .=	$oct_colors_words[$oct_colors[$v]].' ';
		}
		//$log .= "测试：真实序列为".implode('', $oct_colors);
		$log .= "<br>";
	}

	//结果检查
	$oc_count = count(array_unique($oct_colors));
	if ($oc_count == 1)
	{
		if ($showlog)
		{
			$log .= "<span class=\"yellow b\">{$itm}</span>的形状发生了变化……<br>";
		}
		$itm = '★棱镜八面体模样的彩色糖果★'; $itmk = 'HM';
		$itme = 88; $itms = 8; $itmsk = 'x';
	}
}

?>
