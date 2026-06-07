<?php

if(!defined('IN_GAME')) {
    define('IN_GAME', true);
}

include_once './include/core/common.inc.php';
include_once GAME_ROOT.'./include/gamectl/game.func.php';
include_once GAME_ROOT.'./include/game/club/club22.func.php';

// 检查用户是否登录
if(empty($cuser)) {
    echo json_encode(array('error' => 'Not logged in'));
    exit;
}

// 获取玩家数据
$pdata = fetch_playerdata_by_name($cuser);
if(!$pdata) {
    echo json_encode(array('error' => 'Player data not found'));
    exit;
}

// clbpara 已经在 fetch_playerdata_by_name 中通过 check_player_misc_states 处理过了

// 检查是否为枫火歌者
if($pdata['club'] != 22) {
    echo json_encode(array('error' => 'Not a Fireseed Singer'));
    exit;
}

// 获取种火实时数据
$fireseed_realtime_data = array();

if(!empty($pdata['clbpara']['fireseed'])) {
    foreach($pdata['clbpara']['fireseed'] as $fs_id => $fs_data) {
        // 获取种火实时数据
        $realtime_data = getFireseedRealTimeData($fs_id);
        
        if($realtime_data) {
            // 合并管理数据和实时数据
            $fireseed_realtime_data[$fs_id] = array(
                // 管理数据（来自 clbpara）
                'level' => $fs_data['level'],
                'mode' => $fs_data['mode'],
                'horizon' => isset($fs_data['horizon']) ? $fs_data['horizon'] : 0,
                'items' => isset($fs_data['items']) ? $fs_data['items'] : array(),
                'recruited_time' => isset($fs_data['recruited_time']) ? $fs_data['recruited_time'] : 0,
                'pose' => isset($fs_data['pose']) ? $fs_data['pose'] : null,
                
                // 实时数据（来自 players 表）
                'name' => $realtime_data['name'],
                'icon' => $realtime_data['icon'],
                'hp' => $realtime_data['hp'],
                'mhp' => $realtime_data['mhp'],
                'sp' => $realtime_data['sp'],
                'msp' => $realtime_data['msp'],
                'att' => $realtime_data['att'],
                'def' => $realtime_data['def'],
                'pls' => $realtime_data['pls'],
                'wep' => $realtime_data['wep'],
                'wepk' => $realtime_data['wepk'],
                'wepe' => $realtime_data['wepe'],
                'weps' => $realtime_data['weps'],
                'wepsk' => $realtime_data['wepsk'],
                'arb' => $realtime_data['arb'],
                'arbk' => $realtime_data['arbk'],
                'arbe' => $realtime_data['arbe'],
                'arbs' => $realtime_data['arbs'],
                'arbsk' => $realtime_data['arbsk'],
                'skills' => isset($realtime_data['clbpara']['skill']) && is_array($realtime_data['clbpara']['skill']) ? $realtime_data['clbpara']['skill'] : array(),
                'alive' => true
            );
        } else {
            // 种火已死亡或被销毁，但保留基本信息用于显示
            $fireseed_realtime_data[$fs_id] = array(
                'level' => $fs_data['level'],
                'mode' => $fs_data['mode'],
                'horizon' => isset($fs_data['horizon']) ? $fs_data['horizon'] : 0,
                'items' => isset($fs_data['items']) ? $fs_data['items'] : array(),
                'recruited_time' => isset($fs_data['recruited_time']) ? $fs_data['recruited_time'] : 0,
                'pose' => isset($fs_data['pose']) ? $fs_data['pose'] : null,
                'name' => '已死亡的种火',
                'icon' => '',
                'hp' => 0,
                'mhp' => 0,
                'sp' => 0,
                'msp' => 0,
                'att' => 0,
                'def' => 0,
                'pls' => 254,
                'alive' => false
            );
        }
    }
}

// 返回 JSON 数据
header('Content-Type: application/json; charset=utf-8');
echo json_encode($fireseed_realtime_data, JSON_UNESCAPED_UNICODE);

?>
