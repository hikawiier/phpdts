<?php

if (! defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * 处理合成物品
 * 这些物品会触发特殊的合成机制
 * 
 * @param int $itmn 物品在物品栏中的位置
 * @param array &$data 玩家数据
 */
function item_synthesis($itmn, &$data) {
    global $log, $db, $tablepre, $now, $plsinfo;
    extract($data, EXTR_REFS);
    
    $itm = & ${'itm' . $itmn};
    $itmk = & ${'itmk' . $itmn};
    $itme = & ${'itme' . $itmn};
    $itms = & ${'itms' . $itmn};
    $itmsk = & ${'itmsk' . $itmn};
    
    if ($itmk == 'ZA') {
        if ($itm == '→【单兵撤退按钮】←') {
            $log .= "你按下了这个按钮。<br>但似乎什么都没有发生。<br>按钮就这样消失了。<br>在你觉得你买到了假冒伪劣产品时，你听到了来自红暮的广播。<br>";
            // 销毁物品
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','如果你们发现了什么带有异样颜色的代码断片，千万别合成它们，老实带过来给我就行。')");
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','大家请注意，虚拟幻境系统似乎遭到了来自不明人士的入侵。')");
            // 播撒合成用物品
            $kitm1 = "［ＩＮＮＯＣＥＮＣＥ］";
            $kitm2 = "［ＤＩＬＩＧＥＮＣＥ］";
            $kitm3 = "［ＣＯＮＳＣＩＥＮＣＥ］";
            $rndpls1 = rand(1, count($plsinfo) - 2);
            $rndpls2 = rand(1, count($plsinfo) - 2);
            $rndpls3 = rand(1, count($plsinfo) - 2);
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm1', 'XA', '1', '1', '', '$rndpls1')");
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm2', 'XA', '1', '1', '', '$rndpls2')");
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm3', 'XA', '1', '1', '', '$rndpls3')");
            $plsname1 = $plsinfo[$rndpls1];
            $plsname2 = $plsinfo[$rndpls2];
            $plsname3 = $plsinfo[$rndpls3];
            $log .= "然后，你听到了来自蓝凝的私聊——<br><span class=\"clan\">【蓝凝】就给你一些提示吧，你需要找到三个代码断片进行合成：{$kitm1}，{$kitm2}与{$kitm3}，它们分别位于{$plsname1}，{$plsname2}与{$plsname3}。<br>【蓝凝】别谢我，问就是我免贵姓雷了。祝你好运！</span>";
            $log .= "<br>看起来，在脱出幻境之前，你需要玩一把寻宝游戏了……";
        } elseif ($itm == '→【神器任意门】←') {
            $log .= "你将这个门扉种在了地上。<br>但门扉突然消失了。<br>在你觉得你捡到了个笑话时，你听到了来自红暮的广播。<br>";
            // 销毁物品
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','如果你们发现了什么带有异样颜色的代码断片，千万别合成它们，老实带过来给我就行。')");
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','大家请注意，虚拟幻境系统似乎遭到了来自不明人士的入侵。')");
            // 播撒合成用物品
            $kitm1 = "［ΨТОВХ］";
            $kitm2 = "［ЫΑИЙВХΨ］";
            $kitm3 = "［ΩЙΑТΨ］";
            $rndpls1 = rand(1, count($plsinfo) - 2);
            $rndpls2 = rand(1, count($plsinfo) - 2);
            $rndpls3 = rand(1, count($plsinfo) - 2);
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm1', 'XB', '1', '1', '', '$rndpls1')");
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm2', 'XB', '1', '1', '', '$rndpls2')");
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm3', 'XB', '1', '1', '', '$rndpls3')");
            $plsname1 = $plsinfo[$rndpls1];
            $plsname2 = $plsinfo[$rndpls2];
            $plsname3 = $plsinfo[$rndpls3];
            $log .= "然后，你听到了来自不明人士的私聊——<br><span class=\"lime\">【？？？】就给你一些提示吧，你需要找到三个代码断片进行合成：{$kitm1}，{$kitm2}与{$kitm3}，它们分别位于{$plsname1}，{$plsname2}与{$plsname3}。<br>【？？？】祝你好运！</span>";
            $log .= "<br>看起来，在脱出幻境之前，你需要玩一把寻宝游戏了……";
        } else {
            $log .= "你启动了单人脱出机构。<br>";
            // 销毁物品
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','如果你们发现了什么带有异样颜色的代码断片，千万别合成它们，老实带过来给我就行。')");
            $db->query("INSERT INTO {$tablepre}chat (type,`time`,send,recv,msg) VALUES ('2','$now','【红暮】','','大家请注意，虚拟幻境系统似乎遭到了来自不明人士的入侵。')");
            // 播撒合成用物品
            $kitm1 = "［ｒｍ］";
            $kitm2 = "［－ｒ］";
            $kitm3 = "［－ｆ］";
            $rndpls1 = rand(1, count($plsinfo) - 2);
            $rndpls2 = rand(1, count($plsinfo) - 2);
            $rndpls3 = rand(1, count($plsinfo) - 2);
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm1', 'XC', '1', '1', '', '$rndpls1')");
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm2', 'XC', '1', '1', '', '$rndpls2')");
            $db->query("INSERT INTO {$tablepre}mapitem (itm, itmk, itme, itms, itmsk, pls) VALUES ('$kitm3', 'XC', '1', '1', '', '$rndpls3')");
            $plsname1 = $plsinfo[$rndpls1];
            $plsname2 = $plsinfo[$rndpls2];
            $plsname3 = $plsinfo[$rndpls3];
            $log .= "然后，你听到了来自不明人士的私聊——<br><span class=\"lime\">【？？？】就给你一些提示吧，你需要找到三个代码断片进行合成：{$kitm1}，{$kitm2}与{$kitm3}，它们分别位于{$plsname1}，{$plsname2}与{$plsname3}。<br>【？？？】祝你好运！</span>";
            $log .= "<br>看起来，在脱出幻境之前，你需要玩一把寻宝游戏了……";
        }
    }
}
