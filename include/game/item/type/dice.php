<?php

if (! defined ( 'IN_GAME' )) {
	exit ( 'Access Denied' );
}

// Include required function files
require_once GAME_ROOT . './include/game/fortune.func.php';
require_once GAME_ROOT . './include/game/dice.func.php';

// Handle dice items
function item_dice($itmn, &$data) {
	global $log, $db, $tablepre;
	extract($data, EXTR_REFS);
	
	$itm = & ${'itm' . $itmn};
	$itmk = & ${'itmk' . $itmn};
	$itme = & ${'itme' . $itmn};
	$itms = & ${'itms' . $itmn};
	$itmsk = & ${'itmsk' . $itmn};
	
	// 这里需要从原item.func.php文件中移植骰子相关的逻辑
	// 从第1139行到第1530行的代码
	// 包括各种不同类型的骰子（D3, D6, D10, D20, D40, D100, D1000）的处理逻辑
	
	// 示例框架:
	if ($itm == '［Ｄ３］') {
		// 处理D3骰子逻辑
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
	} elseif ($itm == '［Ｄ６］') {
		// 处理D6骰子逻辑
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
			// 确保生成的物品效果值和耐久值不会为0
			if ($itme0 == 0) {
				$itme0 = 1;
			}
			if ($itms0 == 0) {
				$itms0 = 1;
			}

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
	} elseif ($itm == '［Ｄ１０］') {
		// 处理D10骰子逻辑
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
			// 确保生成的物品效果值和耐久值不会为0
			if ($itme0 == 0) {
				$itme0 = 1;
			}
			if ($itms0 == 0) {
				$itms0 = 1;
			}

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
	} elseif ($itm == '［Ｄ２０］') {
		// 处理D20骰子逻辑
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
	} elseif ($itm == '［Ｄ４０］') {
		// 处理D40骰子逻辑
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
	} elseif ($itm == '［Ｄ１００］') {
		// 处理D100骰子逻辑
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
	} elseif ($itm == '［Ｄ１０００］') {
		// 处理D1000骰子逻辑
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
						// 确保耐久值不会变成0
						if ($value == 0) {
							$value = 1;
						}
					}
				}

				foreach ($rand_e as $key => &$value) {
					if ($value != 0) {
						$value = diceroll($etotal);
						// 确保效果值不会变成0
						if ($value == 0) {
							$value = 1;
						}
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
}
