<?php

if (! defined ( 'IN_GAME' )) {
	exit ( 'Access Denied' );
}

// Handle enhancement items
function item_enhance($itmn, &$data) {
	global $log, $nosta, $upexp ,$baseexp;
	extract($data, EXTR_REFS);
	
	$itm = & ${'itm' . $itmn};
	$itmk = & ${'itmk' . $itmn};
	$itme = & ${'itme' . $itmn};
	$itms = & ${'itms' . $itmn};
	$itmsk = & ${'itmsk' . $itmn};
	
	$log .= "你服用了<span class=\"red\">$itm</span>。<br>";
	
	if (strpos($itmk, 'MA') === 0) {
		//global $att;
		$att_min = 500;
		$att_limit = 2500;
		$dice = rand(-5, 5);
		if ($att < $att_min) {
			$mefct = $itme;
		} elseif ($att < $att_limit) {
			$mefct = round($itme * (1 - ($att - $att_min) / ($att_limit - $att_min)));
		} else {
			$mefct = 0;
		}
		if ($mefct < 5) {
			if ($mefct < $dice) {
				$mefct = -$dice;
			}
		}
		$att += $mefct;
		$mdname = "基础攻击力";
	} elseif (strpos($itmk, 'MD') === 0) {
		//global $def;
		$def_min = 500;
		$def_limit = 2500;
		$dice = rand(-5, 5);
		if ($def < $def_min) {
			$mefct = $itme;
		} elseif ($def < $def_limit) {
			$mefct = round($itme * (1 - ($def - $def_min) / ($def_limit - $def_min)));
		} else {
			$mefct = 0;
		}
		if ($mefct < 5) {
			if ($mefct < $dice) {
				$mefct = -$dice;
			}
		}
		$def += $mefct;
		$mdname = "基础防御力";
	} elseif (strpos($itmk, 'ME') === 0) {
		//global $exp, $upexp, $baseexp;
		$lvlup_objective = $itme / 10;
		$mefct = round($baseexp * 2 * $lvlup_objective + rand(0, 5));
		$exp += $mefct;
		$mdname = "经验值";
	} elseif (strpos($itmk, 'MS') === 0) {
		//global $sp, $msp;
		$mefct = $itme;
		$sp += $mefct;
		$msp += $mefct;
		$mdname = "体力上限";
	} elseif (strpos($itmk, 'MH') === 0) {
		//global $hp, $mhp;
		$mefct = $itme;
		$hp += $mefct;
		$mhp += $mefct;
		$mdname = "生命上限";
	} elseif (strpos($itmk, 'MV') === 0) {
		//global $wp, $wk, $wg, $wc, $wd, $wf;
		$skill_minimum = 100;
		$skill_limit = 380;
		$dice = rand(-10, 10);
		$ws_sum = $wp + $wk + $wg + $wc + $wd + $wf;
		if ($ws_sum < $skill_minimum * 5) {
			$mefct = $itme;
		} elseif ($ws_sum < $skill_limit * 5) {
			$mefct = round($itme * (1 - ($ws_sum - $skill_minimum * 5) / ($skill_limit * 5 - $skill_minimum * 5)));
		} else {
			$mefct = 0;
		}
		if ($mefct < 10) {
			if ($mefct < $dice) {
				$mefct = -$dice;
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
		$mefct = -$mefct;
		$log .= "已经很强了，却还想靠药物继续强化自己，是不是太贪心了？<br>你贪婪的行为引发了药物的副作用！<br>你的{$mdname}下降了<span class=\"red\">$mefct</span>点！<br>";
	}
	if (strpos($itmk, 'ME') === 0) {
		
		if ($exp >= $upexp) {
			include_once GAME_ROOT . './include/state.func.php';
			lvlup_rev($data, $data, 1);
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
}
