<?php

define('IN_GAME', TRUE);
define('GAME_ROOT', dirname(__DIR__, 2) . '/');
define('GAMENAME', 'bra');

require GAME_ROOT.'./include/core/global.func.php';
require GAME_ROOT.'./include/auth/user.func.php';
error_reporting(E_ALL);
set_error_handler('gameerrorhandler');
extract(gstrfilter($_COOKIE));
extract(gstrfilter($_POST), EXTR_SKIP);
extract(gstrfilter($_GET), EXTR_SKIP);
$_REQUEST = gstrfilter($_REQUEST);
$_FILES = gstrfilter($_FILES);

require GAME_ROOT.'./config.inc.php';

date_default_timezone_set('Etc/GMT');
$now = time() + $moveut*3600 + $moveutmin*60;   
list($sec,$min,$hour,$day,$month,$year,$wday) = explode(',',date("s,i,H,j,n,Y,w",$now));

require GAME_ROOT.'./include/db/db_'.$database.'.class.php';
$db = new dbstuff;

// 检查是否直接使用主数据库 (slave_level = 3)
if(isset($slave_level) && $slave_level == 3 && !empty($master_dbhost) && !empty($master_dbuser) && !empty($master_dbname)) {
	$db->connect($master_dbhost, $master_dbuser, $master_dbpw, $master_dbname, $pconnect);
	$gtablepre = $master_tablepre;
} else {
	$db->connect($dbhost, $dbuser, $dbpw, $dbname, $pconnect);
	$gtablepre = $tablepre;
}
unset($dbhost, $dbuser, $dbpw, $dbname, $pconnect);

require GAME_ROOT.'./gamedata/system.php';
require GAME_ROOT.'./include/gamectl/init.func.php';
require GAME_ROOT.'./include/gamectl/news.func.php';
require GAME_ROOT.'./include/gamectl/resources.func.php';
require GAME_ROOT.'./include/room/roommng.func.php';
require GAME_ROOT.'./include/game/club/revclubskills.func.php';
require GAME_ROOT.'./include/game/dice.func.php';
require GAME_ROOT.'./include/pregame/titles.func.php';

// $gtablepre 已在数据库连接时设置，这里不再重新赋值
if(!isset($gtablepre)) {
	$gtablepre = $tablepre;
}

ob_start();

$cuser = & ${$gtablepre.'user'};
$cpass = & ${$gtablepre.'pass'};

$roomlist = Array();
$result = $db->query("SELECT * FROM {$gtablepre}game WHERE groomid>0");
while($roominfo = $db->fetch_array($result))
{
	$roomlist[$roominfo['groomid']] = $roominfo;
}

if($cuser) $udata = fetch_userdata_by_username($cuser);

// 在用户数据加载后重新设置模板
// Reload template after user data is loaded
if(isset($udata) && $udata && isset($udata['u_templateid'])) {
    $user_templateid = intval($udata['u_templateid']);

    // 模板映射表 / Template mapping table
    $template_map = array(
        1 => './templates/luluxia',
        2 => './templates/nouveau',
    );

    // 由于PHP常量不能重新定义，我们需要使用全局变量来覆盖
    global $TEMPLATEID_OVERRIDE, $TPLDIR_OVERRIDE;

    if (isset($template_map[$user_templateid])) {
        $dir = $template_map[$user_templateid];
        $TEMPLATEID_OVERRIDE = $user_templateid;
        $TPLDIR_OVERRIDE = file_exists(GAME_ROOT . $dir) ? $dir : './templates/default';
    } else {
        $TEMPLATEID_OVERRIDE = null;
        $TPLDIR_OVERRIDE = null;
    }
}

$groomid = isset($udata['roomid']) ? $udata['roomid'] : 0;

if(!empty($groomid))
{
	$result = $db->query("SELECT * FROM {$gtablepre}game WHERE groomid='$groomid'");
	if(!$db->num_rows($result))
	{
		roommng_create_new_room($udata);
	}
}

$tablepre = !empty($groomid) ? $tablepre.'s'.$groomid.'_' : $tablepre;

// 现在$groomid已经设置，可以正确加载RuleSet资源文件
require config('resources',$gamecfg);
require config('gamecfg',$gamecfg);
require config('combatcfg',$gamecfg);
require config('clubskills',$gamecfg);
require config('dialogue',$gamecfg);
require config('audio',$gamecfg);
require config('tooltip',$gamecfg);
require config('titles',$gamecfg);

// 初始化RuleSet覆盖系统
include_once GAME_ROOT.'./include/room/ruleset_override.func.php';
init_ruleset_override();

// 加载RuleSet覆盖函数
load_ruleset_override_functions();

// 现在加载system.func.php
require GAME_ROOT.'./include/gamectl/system.func.php';
// 加载禁区系统统一函数库
require GAME_ROOT.'./include/gamectl/deatharea.func.php';

// 检查数据库结构更新（在配置文件加载后执行）
if(isset($need_update_db_structrue) && $need_update_db_structrue) {
	roommng_verify_db_game_structure();
}

if(CURSCRIPT !== 'chat')
{
	$plock=fopen(GAME_ROOT.'./gamedata/process.lock','ab');
	flock($plock,LOCK_EX);
	load_gameinfo();
	$lostfocus = false;
	$ginfochange = false;

	// 游戏状态机 / Game state machine
	require GAME_ROOT.'./include/gamectl/gamestate.func.php';
	$transitions = array(
		'gamestate_try_prepare',
		'gamestate_try_start',
		'gamestate_try_add_area',
		'gamestate_try_stop_valid',
		'gamestate_try_combo',
		'gamestate_try_anti_afk',
		'gamestate_try_gameover',
	);
	foreach ($transitions as $func) {
		if ($func()) $ginfochange = true;
	}

	if($ginfochange || $lostfocus){
		save_gameinfo();
	}
	
	//除拉取聊天以外的访问都判定一下是否有新的站内信。
	include_once GAME_ROOT.'./include/gamectl/messages.func.php';
	$new_messages = message_check_new($cuser);
	
	fclose($plock); 
}
?>
