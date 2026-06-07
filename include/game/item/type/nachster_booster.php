<?php

if (! defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * 处理nachster版本中加入的杂项物品
 * 包括小叶子的妙妙箱、歌单系列、人生重来炮等
 * 
 * @param int $itmn 物品在物品栏中的位置
 * @param array &$data 玩家数据
 */
function item_nachster_booster($itmn, &$data) {
    global $log, $db, $tablepre, $now, $plsinfo, $event_bgm, $elements_info, $nosta;
    extract($data, EXTR_REFS);
    
    $itm = & ${'itm' . $itmn};
    $itmk = & ${'itmk' . $itmn};
    $itme = & ${'itme' . $itmn};
    $itms = & ${'itms' . $itmn};
    $itmsk = & ${'itmsk' . $itmn};
    
    if ($itm == '小叶子的妙妙箱') {
        // A multiuse item that will provide various of items for you, mainly traps.
        // However, there will be an increasing possibity that this item will self-explode.
        // And when it does, there will also be a possibity that you'll lose HP and SP.
        // Very low chance of insta-death.

        // init itm0.
        $itm0 = '';
        $itmk0 = '';
        $itme0 = 0;
        $itms0 = 0;
        $itmsk0 = '';
        $itmpara = '';

        // Par 低维生物's suggestion, the explode-rate will be stored in its $itmsk.
        $log .= "你下定决心，打开了这个可疑的<span class='yellow'>$itm</span>，开始翻找起来……<br>";
        // Getting the item's current self-destruct rate.
        $harukaBoxExplodeRate = intval($itmsk);
        // Generate a random number based on the user's 1st Yume value.
        $harukaBoxCheck = diceroll($clbpara['randver1']);

        if ($harukaBoxCheck <= 17) {
            // Get random low-mid effect trap.
            $log .= "你从里面翻找出了看起来能作为<span class='yellow'>略微有趣的陷阱</span>的东西！<br>";

            $itm0 = '略微有趣的玻璃珠';
            $itmk0 = 'TN';
            $itme0 = diceroll($clbpara['randver1']);
            $itms0 = diceroll(5);
            $itmsk0 = '';
            // 确保效果值和耐久值不会为0
            if ($itme0 == 0) {
                $itme0 = 1;
            }
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        } elseif ($harukaBoxCheck <= 23) {
            // Get random HB item.
            $log .= "你从里面翻找出了看起来能作为<span class='yellow'>有趣的补给</span>的东西！<br>";

            $itm0 = '有趣的零食';
            $itmk0 = 'HB';
            $itme0 = diceroll($clbpara['randver1']) * diceroll(3);
            $itms0 = diceroll(17);
            $itmsk0 = 'z';
            // 确保效果值和耐久值不会为0
            if ($itme0 == 0) {
                $itme0 = 1;
            }
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        } elseif ($harukaBoxCheck <= 42) {
            // Get random mid effect true damage trap.
            $log .= "你从里面翻找出了看起来能作为<span class='yellow'>精心制作的陷阱</span>的东西！<br>";

            $itm0 = '精心制作的玻璃珠阵';
            $itmk0 = 'TNt';
            $itme0 = diceroll($clbpara['randver2']);
            $itms0 = diceroll(5);
            $itmsk0 = '';
            // 确保效果值和耐久值不会为0
            if ($itme0 == 0) {
                $itme0 = 1;
            }
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        } elseif ($harukaBoxCheck <= 61) {
            // Get random high effect trap.
            $log .= "你从里面翻找出了看起来能作为<span class='yellow'>非常有趣的陷阱</span>的东西！<br>";

            $itm0 = '非常有趣的玻璃珠';
            $itmk0 = 'TN';
            $itme0 = diceroll($clbpara['randver3']);
            $itms0 = diceroll(5);
            $itmsk0 = '';
            // 确保效果值和耐久值不会为0
            if ($itme0 == 0) {
                $itme0 = 1;
            }
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        } elseif ($harukaBoxCheck <= 80) {
            // Get random percent damage trap.
            $log .= "你从里面翻找出了看起来能作为<span class='yellow'>十分强力的陷阱</span>的东西！<br>";

            $itm0 = '强而有力的玻璃珠';
            $itmk0 = 'TN8';
            $itme0 = 1;
            $itms0 = diceroll(2);
            $itmsk0 = 'x';
            // 确保耐久值不会为0
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        } elseif ($harukaBoxCheck <= 109) {
            // Get high true damage trap.
            $log .= "你从里面翻找出了看起来能作为<span class='yellow'>精心制作的可怕陷阱</span>的东西！<br>";

            $itm0 = '精心制作的可怕玻璃珠阵';
            $itmk0 = 'TNt';
            $itme0 = diceroll($clbpara['randver3']);
            $itms0 = diceroll(5);
            $itmsk0 = '';
            // 确保效果值和耐久值不会为0
            if ($itme0 == 0) {
                $itme0 = 1;
            }
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        } else {
            // Get Chaos Normal Trap.
            $log .= "你从里面翻找出了一些<span class='yellow'>不可名状</span>的东西！<br>它似乎可以当作陷阱使用……<br>";

            $itm0 = '不可名状之物';
            $itmk0 = 'TN';
            $itme0 = diceroll(114514);
            $itms0 = diceroll(69);
            $itmsk0 = '';
            // 确保效果值和耐久值不会为0
            if ($itme0 == 0) {
                $itme0 = 1;
            }
            if ($itms0 == 0) {
                $itms0 = 1;
            }
        }

        // Troll the player if itms0 somehow rolled an 0. YSK: I encountered that 4 times in a row.
        if ($itms0 == 0) {
            $log .= "然而，<span class='yellow'>$itm0</span>却伴随着一阵少女银铃般的笑声，<br>在你的手上化作一阵青烟消失了！<br>靠！<br>";
            $itm0 = '';
            $itmk0 = '';
            $itme0 = 0;
            $itms0 = 0;
            $itmsk0 = '';

            // Refund some of explode rate.
            //$harukaBoxCheck -= 30;
        }

        // Add to explode rate.
        $harukaBoxExplodeRate += $harukaBoxCheck;
        if ($harukaBoxExplodeRate < 667) {
            $log .= "<span class='yellow'>妙妙箱不怀好意地颤抖了一下。</span>但最终什么都没发生！<br>";
            // Write explode rate back to itmsk.
            $itmsk = strval($harukaBoxExplodeRate);
        } else {
            // BOOM!!
            $log .= "<span class='yellow'>妙妙箱不怀好意地颤抖了一下。</span>然后华丽地在你的手上炸开了！<br>";
            // Destroy this item.
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
            // Also Destroy item0.
            $itm0 = $itmk0 = $itmsk0 = '';
            $itme0 = $itms0 = 0;                
            // Get damage.
            $harukaBoxDamage = diceroll($clbpara['randver2']) * (diceroll(3) + 1);
            // Calculate Damage.
            if ($hp < $harukaBoxDamage) {
                $dflag = diceroll(1024);
                if ($dflag > 1020) {
                    // YOU WA SHOCK!!
                    include_once GAME_ROOT . './include/gamectl/state.func.php';
                    $log .= '你在一片火焰中失去了知觉。<br>';
                    death('event', '', 0, $itm);
                } else {
                    $log .= "你受到了<span class='yellow'>巨大的</span>伤害！你感觉你整个人都要折在这里了！<br>";
                    $hp = 1;
                    $sp = 1;
                }
            } else {
                $hp -= $harukaBoxDamage;
                $sp -= $harukaBoxDamage;
                if ($sp < 1) {
                    $sp = 1;
                }
                $log .= "你受到了<span class='yellow'>$harukaBoxDamage</span>点伤害！<br>";
                $inf .= 'a';
                $log .= "你的双手也被炸得血肉模糊！真是不幸啊！<br>";
            }
        }
    } elseif ($itm == '随机数之神的庇佑') {
        $log .= "你将<span class='yellow'>$itm</span>捧在手心……<br>
        突然，从天上传来一个慵懒的声音：<br>
        <span class=\"blueseed\">“现在还没到我的上班时间呢！”<br>
        “不过既然你提前抽出来了，我也给你点好处，那么载入既定事项……”</span><br>
        然后你看到天上出现了一行字：【实行L5改造】<br>";
        $log .= '你突然感觉到一种不可思议的力量贯通全身！<br>';
        $wp = $wk = $wg = $wc = $wd = $wf = 8010;
        $att = $def = 13337;
        //$club = 15; 因为是神力嘛！↓但是下面这个还是要适用的。
        addnews($now, 'suisidefail', $name, $nick);
        // 销毁物品
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】红暮') {
        // Songlists. They change your BGM, but more importantly...
        // They place a Brand on your character named BGMBrand in $clbpara.
        // It will have various hidden effects, search for BGMBrand for details.

        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了音乐播放器的启动！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        $log .= "你打开了手上的音乐播放器，里面传出了这样的声音：<br>
        <span class=\"ltcrimson\">”你的选择很不错，我这里为你准备了一些劲爆的摇滚乐。<br>
        一定能让你在这场战斗中热血沸腾的。”——红暮<br><br></span>
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        $clbpara['event_bgmbook'] = $event_bgm['crimsontracks'];
        $clbpara['BGMBrand'] = 'crimson';
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】蓝凝') {
        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了音乐播放器的启动！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        $log .= "你打开了手上的音乐播放器，里面传出了这样的声音：<br>
        <span class=\"ltazure\">”姐姐似乎给你准备了摇滚乐，但我觉得还是我的更好一点。<br>
        这些歌曲都是上个年代的流行曲风，梦幻般的人声和幻境也更相称吧？<br>
        欸？你说这不就仅仅是音乐，没有人声么？为什么会这样呢？”——蓝凝<br><br></span>
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        if ($clbpara['randver1'] < 64) {
            $clbpara['event_bgmbook'] = $event_bgm['altazuretracks'];
        } else {
            $clbpara['event_bgmbook'] = $event_bgm['azuretracks'];
        }
        $clbpara['BGMBrand'] = 'azure';
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】芙蓉') {
        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了音乐播放器的启动！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        $log .= "你打开了手上的音乐播放器，里面传出了这样的声音：<br>
        <span class=\"tmagenta\">”干我们这行的，得时刻保持冷静优雅。<br>
        所以我给你准备了古典音乐，确切地说，是李斯特的《巡礼之年》第一部。<br>
        这可是被人称作是李斯特的大成之作的作品，Enjoy~”——芙蓉<br><br></span>
        <span class=\"ltcrimson\">”……做好身份隔离，芙蓉。”——红暮<br><br></span>
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        $clbpara['event_bgmbook'] = $event_bgm['fleurtracks'];
        $clbpara['BGMBrand'] = 'fleur';
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】丁香') {
        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了音乐播放器的启动！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        $log .= "你打开了手上的音乐播放器，里面传出了这样的声音：<br>
        <span class=\"clan\">”欸？我也要提交一批歌单吗……？<br>
        那么我就尽量尝试一下……<br>
        就这些如何？虽然我觉得这可能不适合这个游戏吧……”——丁香<br><br></span>
        <span class=\"sienna\">”适合不适合另说，但这起名太差劲了——就地丢弃，请。”——芙蓉<br><br></span>
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        $clbpara['event_bgmbook'] = $event_bgm['lilatracks'];
        $clbpara['BGMBrand'] = 'lila';
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】冰炎') {
        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了音乐播放器的启动！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        $log .= "你打开了手上的音乐播放器，里面传出了这样的声音：<br>
        <span class=\"orange\">”虚拟幻境我自然是知道的。高速动作PVP对吧？<br>
        要为这里提供一点音乐……吗。<br>
        那么就来点听起来很像某驰名游戏系列的配乐的曲子吧！”——冰炎<br><br></span>
        <span class=\"ltcrimson\">”微妙。”——红暮<br><br></span>
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        $clbpara['event_bgmbook'] = $event_bgm['rimefiretracks'];
        $clbpara['BGMBrand'] = 'rimefire';
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】瑞克·拉玛尔') {
        $log .= "你打开了手上的音乐播放器，里面传出了这样的声音：<br>
        <span class=\"orange\">”哦，你是想反叛随机数大神吧！<br>
        我知道的，摇骰子总是会让人心潮澎湃，那么就让我这位大英雄帮你一把吧！<br>
        音乐是其次，欢迎来到骰子的反叛世界！”——瑞克·拉玛尔<br><br></span>
        <span class=\"ltcrimson\">”这……这个不是都市传说么？快去查一查。”——红暮<br><br></span>
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        $clbpara['event_bgmbook'] = $event_bgm['rixolamaltracks'];
        $clbpara['BGMBrand'] = 'rixolamal';
        // Some init...
        $clbpara['traitorRoll'] = 0;
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】小兔子警报！') {
        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了音乐播放器的启动！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        if ($clbpara['touchedByBunny'] == 0) {
            $rp -= 120;
        }
        $log .= "你打开了手上的奇怪物品，里面传出了这样的声音：<br>
        <span class=\"lime\">”为什么突然会给游戏加入歌单这种东西……？<br>
        那么为了更好地伪装，我也注入个歌单进来。<br>
        毕竟我平时码代码就是听这些的。顺路啦。”——？？？？<br><br></span>
        
        <span class=\"yellow\">你的音乐播放列表被替换了！<br></span>";
        if ($clbpara['randver3'] < 512) {
            $clbpara['event_bgmbook'] = $event_bgm['christracks'];
        } else {
            $log .= "<span class=\"tmagenta\">”哈，抓到你了。<br>顺便……这个啊……要用我喜欢的语言来唱。”——芙蓉<br></span>";
            $clbpara['event_bgmbook'] = $event_bgm['altchristracks'];
        }
        $clbpara['BGMBrand'] = 'christine';
        $clbpara['touchedByBunny'] += 1;
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '【歌单】林无月') {
        if ($clbpara['BGMBrand'] == 'rixolamal') {
            $log .= "一种神奇的力量阻止了你按下按钮！<br>";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }

        $log .= "你按下了手中遥控器的按钮。<br>
        <span class=\"yellow\">你重置了你的音乐播放列表！<br></span>";
        unset($clbpara['event_bgmbook']);
        unset($clbpara['BGMBrand']);
        // Destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '人生重来炮') {
        // detect if you are actually able to use this.
        if ($pls > 100) {
            $log .= "你点燃了这门炮的引线，然后尝试将头伸进炮筒之中。<br>
            <span class=\"yellow\">但是大炮突然就这么消失了！这是怎么回事呢？<br></span>";
            // destroy this item.
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;    
        }
        if ($mhp <= 200) {
            $log .= "你点燃了这门炮的引线，然后尝试将头伸进炮筒之中。<br>
            <span class=\"yellow\">但是你体能已经太弱，在成功将头伸进去之前，大炮就在你面前发射了！<br></span>
            <span class=\"red\">你被炮弹射了一脸，受到了巨大的伤害！<br>";
            $hp = 1;
            // destroy this item.
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;                
        }
        $log .= "你点燃了这门炮的引线，然后迅速将头伸进了炮筒之中！<br>
        <span class=\"yellow\">只听轰地一声，你被炮弹击出了千米之外，你感觉身体内的什么东西焕然一新了……<br></span>";
        // Reset... some values...
        $clbpara['randver1'] = rand(1, 128);
        $clbpara['randver2'] = rand(1, 256);
        $clbpara['randver3'] = rand(1, 1024);
        // process damage
        $mhp -= 200;
        $hp = $mhp;
        $msp -= 200;
        $sp = $msp;
        $log .= "<span class=\"red\">你受到了相当的伤害，龇牙咧嘴地站了起来。<br></span>";
        // process area change
        $pls = rand(1, count($plsinfo) - 2);
        // destroy this item.
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
    } elseif ($itm == '善良之刃') {
        // fake a death message.
        $log .= "你觉得这个幻境太过危险，真的呆不下去了！<br>
            <span class=\"yellow\">于是你将这把匕首对着自己，噗叽一声就刺了下去！<br></span>";
        // it will require 200+ rage.
        if ($rage <= 200) {
            $log .= "匕首的刀刃却被弹开了！<br>
            从匕首中传来了恶意的嘲笑：<br>
            <span class=\"yellow\">”桀桀桀，连自裁的决心都没有，你还真是个软蛋！”<br></span>
            你出离愤怒，一脚将匕首踩碎了。<br>
            <br>
            你被整蛊物品嘲讽，非常生气！<br>";
            $rage = 200;
            // destroy this item.
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        } else {
            $log .= "白刀子进，白刀子出！<br>
            你被中刀的冲击击飞，落在了地上。<br>
            好疼。<br>
            <span class=\"yellow\">等下……白刀子……出？<br></span>
            你听到了你的死亡报告，但还是毫发无伤地站了起来。<br>
            想死而不能，这可是太逊了……<br>
            你不禁叹出一口气。<br>";

            $rage = 0;
            // add fake death news - Event Death.
            addnews($now, 'death13', $name, 0);
            // add fake death chat.
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('3','$now','$name','$pls','我觉得我还可以抢救一下……')");
            // destroy this item.
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        }
    }elseif($itm == '😂我太酷啦！😂') {
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
        include_once GAME_ROOT . './include/gamectl/state.func.php';
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
    }
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
