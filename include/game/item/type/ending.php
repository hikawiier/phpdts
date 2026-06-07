<?php

if (! defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * 处理结局物品
 * 这些物品会触发游戏结束
 *
 * @param int $itmn 物品在物品栏中的位置
 * @param array &$data 玩家数据
 */
function item_ending($itmn, &$data) {
    global $log, $url, $state, $now;
    extract($data, EXTR_REFS);

    $itm = & ${'itm' . $itmn};
    $itmk = & ${'itmk' . $itmn};
    $itme = & ${'itme' . $itmn};
    $itms = & ${'itms' . $itmn};
    $itmsk = & ${'itmsk' . $itmn};

    if ($itm == '游戏解除钥匙') {
        $state = 6;
        $url = 'end.php';
        include_once GAME_ROOT . './include/gamectl/system.func.php';
        gameover($now, 'end3', $name);
    } elseif ($itm == '『G.A.M.E.O.V.E.R』') {
        $state = 6;
        $url = 'end.php';
        include_once GAME_ROOT . './include/gamectl/system.func.php';
        gameover($now, 'end7', $name);
    } elseif ($itm == '奇怪的按钮') {
        $button_dice = rand(1, 10);
        if ($button_dice < 5) {
            $log .= "你按下了<span class=\"yellow\">$itm</span>，不过好像什么都没有发生！";
            $itm = $itmk = $itmsk = '';
            $itme = $itms = 0;
        } elseif ($button_dice < 8) {
            $state = 6;
            $url = 'end.php';
            include_once GAME_ROOT . './include/gamectl/system.func.php';
            gameover($now, 'end5', $name);
        } else {
            $log .= '好像什么也没发生嘛？<br>咦，按钮上的标签写着什么？"危险，勿触"……？<br>';
            include_once GAME_ROOT . './include/gamectl/state.func.php';
            $log .= '呜哇，按钮爆炸了！<br>';
            death('button', '', 0, $itm);
        }
    } elseif ($itm == '【E.S.C.A.P.E】') {
        // 这实际上是个死法，但是会给成就，称号，并加积分与胜场
        include_once GAME_ROOT . './include/gamectl/state.func.php';
        // 成就检查该物品本身的使用，逻辑不写在这里
        $log .= '万事俱备，只欠逃离！<br>';
        // 销毁物品
        $itm = $itmk = $itmsk = '';
        $itme = $itms = 0;
        death('s_escape', '', 0, $itm);
    }
}
