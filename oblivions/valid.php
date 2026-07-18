<?php
/**
 * @module C 核心运行时
 */

// ================================================================
// Oblivions 入场逻辑 / Oblivions player entry logic
//
// 完全与旧模式 valid.php 解耦：Oblivions 模式下由 valid.php 开头
// 模式分发直接 require 本文件后 exit，不再执行旧模式入场逻辑。
//
// 与旧模式入场的差异：
// - 不需要 IP 限制（单人模式）
// - 不需要称号系统（t1/t2_list / club / nick）
// - 不需要初始装备随机生成（weplist / stitemlist）
// - 不需要 RuleSet 初始化 / 头衔入场效果 / 曲集 / 套装 / 称号技能
// - 不需要成就数据转化
// - 不需要 bra_players 表插入（独立数据层 oblplayers）
// - 不需要 validover 模板（前端 SPA 用 JSON 响应）
//
// 入场流程：
//   1. 用户认证（common.inc.php 已加载 $udata + $cuser/$cpass）
//   2. 游戏状态校验（gamestate >= 20 才允许入场）
//   3. 玩家记录查重（bra_oblplayers 表）
//   4. 创建 oblplayers 记录（含初始道具）
//   5. 出生点确定（pgroup=1, pls=出生格）
//   6. 出生时点亮视野（obl_update_vision）
//   7. 返回 JSON 响应
// ================================================================
// 依赖：common.inc.php（$udata / $cuser / $cpass / $db / $tablepre / $gamestate）
//       player.func.php（obl_create_player_record）
//       vision.func.php（obl_update_vision）

// 前置校验：登录状态
if (!$cuser || !$cpass) {
    gexit($_ERROR['no_login'], __file__, __line__);
}

// 前置校验：游戏状态
if ($gamestate < 20) {
    gexit($_ERROR['no_start'], __file__, __line__);
}

// 前置校验：用户数据
if (!$udata) {
    gexit($_ERROR['login_check'], __file__, __line__);
}
if ($udata['password'] != $cpass) {
    gexit($_ERROR['wrong_pw'], __file__, __line__);
}
if ($udata['groupid'] <= 0) {
    gexit($_ERROR['user_ban'], __file__, __line__);
}

// 加载 Oblivions 子系统函数库
require_once GAME_ROOT . './oblivions/include/core/obl_bootstrap.php';

// ================================================================
// 入场表单展示（mode != 'enter'）
// ================================================================
if ($mode !== 'enter') {
    // 检查是否已入场（oblplayers 表查重）
    $result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE name = '$cuser' AND type = 0");
    if ($db->num_rows($result)) {
        // 已入场，直接跳转游戏页面
        header("Location: game.php");
        exit;
    }

    // SPA 前端模式：返回 JSON 入场表单数据
    if (isset($_GET['is_new'])) {
        echo compatible_json_encode(array(
            'page'   => 'valid',
            'name'   => $cuser,
            'avatar' => isset($udata['icon']) ? $udata['icon'] : '0',
            'gender' => isset($udata['gender']) ? $udata['gender'] : 'm',
        ));
    } else {
        // 非 SPA 模式回退到旧模板（理论上 Oblivions 都是 SPA，此处防御性保留）
        include template('valid');
    }
    exit;
}

// ================================================================
// 入场提交（mode == 'enter'）
// ================================================================

// 1. 玩家记录查重（oblplayers 表）
$result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE name = '$cuser' AND type = 0");
if ($db->num_rows($result)) {
    gexit($_ERROR['player_exist'], __file__, __line__);
}

// 2. 性别校验
$gender = isset($gender) ? $gender : 'm';
if ($gender !== 'm' && $gender !== 'f') {
    $gender = 'm';
}

// 3. 更新用户基础信息（性别/头像/签名等，与旧模式保持一致）
$nick = isset($nick) ? $nick : '';
$icon = isset($icon) ? $icon : rand(1, $iconlimit);
$motto = isset($motto) ? $motto : '';
$killmsg = isset($killmsg) ? $killmsg : '';
$lastword = isset($lastword) ? $lastword : '';
$db->query("UPDATE {$gtablepre}users SET gender='$gender', nick='$nick', icon='$icon', motto='$motto', killmsg='$killmsg', lastword='$lastword' WHERE username='" . $udata['username'] . "'");

// 4. 构建 Oblivions 玩家初始数据（不走旧模式 update_db_player_structure）
//    Oblivions 独立数据层，字段结构由 obl_create_player_record 内部映射
$hp = $mhp = isset($hplimit) ? (int)$hplimit : 200;
$sp = $msp = isset($splimit) ? (int)$splimit : 200;
$rand = rand(0, 15);
$att = 95 + $rand;
$def = 105 - $rand;

// 出生点：区域 1 的入口格（由 map.php 配置决定）
$map_data = obl_get_map_data();
$birth_pgroup = 1;
$birth_pls = isset($map_data['regions'][$birth_pgroup]['entrance_pls'])
    ? (int)$map_data['regions'][$birth_pgroup]['entrance_pls'] : 1;

// Test starter weapon: throwing spear.
// Read from item_table so template changes are reflected automatically.
$item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
$starter_weapon_id = 'throwing_spear';
$starter_weapon = isset($item_table[$starter_weapon_id]) ? $item_table[$starter_weapon_id] : array();

$ndata = array(
    'type'   => 0,
    'name'   => $cuser,
    'pass'   => $cpass,
    'gd'     => 'f',
    'icon'   => 9,
    'action' => '',
    'bid'    => 0,
    'hp'     => $hp,
    'mhp'    => $mhp,
    'sp'     => $sp,
    'msp'    => $msp,
    'att'    => $att,
    'def'    => $def,
    'pgroup' => $birth_pgroup,
    'pls'    => $birth_pls,
    'lvl'    => 0,
    'exp'    => 0,
    'state'  => 0,
    // Test starter weapon: throwing spear (range / throwing skill verification).
    'wepid' => $starter_weapon_id,
    'wep' => isset($starter_weapon['itm']) ? (string)$starter_weapon['itm'] : $starter_weapon_id,
    'wepk' => isset($starter_weapon['itmk']) ? (string)$starter_weapon['itmk'] : 'WC',
    'wepe' => isset($starter_weapon['itme']) ? (int)$starter_weapon['itme'] : 12,
    'weps' => isset($starter_weapon['itms']) ? (string)$starter_weapon['itms'] : '10',
    'wepsk' => isset($starter_weapon['itmsk']) ? (string)$starter_weapon['itmsk'] : '',
    'weppara' => isset($starter_weapon['itmpara']) ? (string)$starter_weapon['itmpara'] : '',
    'wep2id' => '', 'wep2' => '', 'wep2k' => '', 'wep2e' => 0, 'wep2s' => '0', 'wep2sk' => '', 'wep2para' => '',
    'dbid' => '', 'db' => '', 'dbk' => '', 'dbe' => 0, 'dbs' => '0', 'dbsk' => '', 'dbpara' => '',
    'dhid' => '', 'dh' => '', 'dhk' => '', 'dhe' => 0, 'dhs' => '0', 'dhsk' => '', 'dhpara' => '',
    'daid' => '', 'da' => '', 'dak' => '', 'dae' => 0, 'das' => '0', 'dask' => '', 'dapara' => '',
    'dfid' => '', 'df' => '', 'dfk' => '', 'dfe' => 0, 'dfs' => '0', 'dfsk' => '', 'dfpara' => '',
    'acid' => '', 'ac' => '', 'ack' => '', 'ace' => 0, 'acs' => '0', 'acsk' => '', 'acpara' => '',
    // 初始道具：用模板 ID 初始化，itm 留空表示由前端 locale 渲染名称
    'itmid1' => 'bread', 'itm1' => '', 'itmk1' => '', 'itme1' => 0, 'itms1' => '0', 'itmsk1' => '', 'itmpara1' => '',
    'itmid2' => 'mineral_water', 'itm2' => '', 'itmk2' => '', 'itme2' => 0, 'itms2' => '0', 'itmsk2' => '', 'itmpara2' => '',
    'itm3' => '', 'itmk3' => '', 'itme3' => 0, 'itms3' => '0', 'itmsk3' => '', 'itmpara3' => '',
    'itm4' => '', 'itmk4' => '', 'itme4' => 0, 'itms4' => '0', 'itmsk4' => '', 'itmpara4' => '',
    'itm5' => '', 'itmk5' => '', 'itme5' => 0, 'itms5' => '0', 'itmsk5' => '', 'itmpara5' => '',
    'itm6' => '', 'itmk6' => '', 'itme6' => 0, 'itms6' => '0', 'itmsk6' => '', 'itmpara6' => '',
);

// 5. 创建 oblplayers 记录（独立数据层，不同步 bra_players）
$pid = obl_create_player_record($ndata);
if (!$pid) {
    gexit('Failed to create Oblivions player record', __file__, __line__);
}

// 6. 出生时点亮视野（pgroup/pls 已确定）
$ndata['pid'] = $pid;
obl_update_vision($birth_pgroup, $birth_pls, $ndata);

// 7. 更新用户 lastgame 标记
$db->query("UPDATE {$gtablepre}users SET lastgame='$gamenum' WHERE username='$cuser'");

// 8. 发布入场新闻（单人房间用 newroomgame）
addnews($now, 'newroomgame', $cuser, $groomid);

// 9. 返回 JSON 响应（SPA 前端不需要 validover 模板）
if (isset($_GET['is_new'])) {
    echo compatible_json_encode(array(
        'page'   => 'validOver',
        'name'   => $cuser,
        'avatar' => $gender . '_' . $icon . '.gif',
        'nowHp'  => $hp,
        'maxHp'  => $mhp,
        'nowMp'  => $sp,
        'maxMp'  => $msp,
        'attack' => $att,
        'defense'=> $def,
    ));
} else {
    // 非 SPA 模式回退（防御性保留）
    include template('validover');
}
exit;
