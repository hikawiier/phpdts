<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 初始化玩家互动日志 / Initialize player interaction log
// 读取未处理的互动日志并标记为已处理
// 返回拼接好的日志 HTML 字符串
function init_player_log() {
    global $db, $tablepre, $pid;
    $log = '';
    $result = $db->query("SELECT lid,time,log FROM {$tablepre}log WHERE toid = '$pid' AND prcsd = 0 ORDER BY time,lid");
    $llist = '';
    while ($logtemp = $db->fetch_array($result)) {
        $log .= date("H:i:s", $logtemp['time']) . '，' . $logtemp['log'] . '<br />';
        $llist .= $logtemp['lid'] . ',';
    }
    if (!empty($llist)) {
        $llist = '(' . substr($llist, 0, -1) . ')';
        $db->query("UPDATE {$tablepre}log SET prcsd=1 WHERE toid = '$pid' AND lid IN $llist");
    }
    return $log;
}

// 生成枪声显示信息 / Generate noise (gunshot) display info
// 返回枪声提示 HTML，无枪声时返回空字符串
function init_noise_display() {
    global $now, $noisetime, $noiselimit, $noisemode, $noiseid, $noiseid2, $pid, $plsinfo, $noisepls, $noiseinfo;
    if (($now <= $noisetime + $noiselimit) && $noisemode && ($noiseid != $pid) && ($noiseid2 != $pid)) {
        if (($now - $noisetime) < 60) {
            $noisesec = $now - $noisetime;
            return "<span class=\"yellow\">{$noisesec}秒前，{$plsinfo[$noisepls]}传来了{$noiseinfo[$noisemode]}。</span><br>";
        } else {
            $noisemin = floor(($now - $noisetime) / 60);
            return "<span class=\"yellow\">{$noisemin}分钟前，{$plsinfo[$noisepls]}传来了{$noiseinfo[$noisemode]}。</span><br>";
        }
    }
    return '';
}

// 计算冷却剩余时间 / Calculate cooldown remaining time (ms)
// 返回 0 表示冷却已结束
function init_cooldown() {
    global $coldtimeon, $cdsec, $cdmsec, $cdtime;
    if ($coldtimeon) {
        $cdover = $cdsec * 1000 + $cdmsec + $cdtime;
        $nowmtime = floor(getmicrotime() * 1000);
        return $nowmtime >= $cdover ? 0 : $cdover - $nowmtime;
    }
    return 0;
}

// 眩晕状态检查 / Check dizzy status
// 返回眩晕提示 HTML，未眩晕时返回空字符串
function init_dizzy_check() {
    global $clbpara, $now;
    if (!empty($clbpara['skill']) && in_array('inf_dizzy', $clbpara['skill'])) {
        $dizzy_times = (($clbpara['starttimes']['inf_dizzy'] + $clbpara['lasttimes']['inf_dizzy']) - $now) * 1000;
        return '<span class="yellow">你现在处于眩晕状态，什么都做不了！</span><br>眩晕状态持续时间还剩：<span id="timer" class="yellow">' . $dizzy_times . '</span>秒<br><script type="text/javascript">demiSecTimerStarter(' . $dizzy_times . ');</script>';
    }
    return '';
}

// 社团选择检查 / Club selection check
// 未选择社团时计算可用社团，设置全局 $clubavl
function init_club_check() {
    global $club, $clubavl, $name, $cuser;
    if ($club == 0 && !isset($clubavl)) {
        include_once GAME_ROOT . './include/pregame/clubslct.func.php';
        getclub($name, $c1, $c2, $c3);
        $clubavl[0] = 0;
        $clubavl[1] = $c1;
        $clubavl[2] = $c2;
        $clubavl[3] = $c3;
    }
}