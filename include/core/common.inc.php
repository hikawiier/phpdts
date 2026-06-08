<?php

define('IN_GAME', TRUE);
define('GAME_ROOT', dirname(__DIR__, 2) . '/');
define('GAMENAME', 'bra');

require GAME_ROOT.'./include/core/global.func.php';
require GAME_ROOT.'./include/auth/user.func.php';
error_reporting(E_ALL);
set_error_handler('gameerrorhandler');
extract(gstrfilter($_COOKIE), EXTR_SKIP);
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

// 房间列表缓存 / Room list cache (TTL=60s)
$roomlist_cache_file = GAME_ROOT.'./gamedata/cache/roomlist.php';
$roomlist_cache_ttl = 60;
if (file_exists($roomlist_cache_file) && (time() - filemtime($roomlist_cache_file)) < $roomlist_cache_ttl) {
	$roomlist = include $roomlist_cache_file;
	if (!is_array($roomlist)) $roomlist = Array();
} else {
	$roomlist = Array();
	$result = $db->query("SELECT * FROM {$gtablepre}game WHERE groomid>0");
	while($roominfo = $db->fetch_array($result))
	{
		$roomlist[$roominfo['groomid']] = $roominfo;
	}
	// 写入缓存 / Write cache
	$cache_content = '<?php return ' . var_export($roomlist, true) . '; ?>';
	writeover($roomlist_cache_file, $cache_content);
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

// chat.php 仅需上述最小初始化，跳过后续所有游戏逻辑和配置加载
// chat.php only needs minimal init above; skip game logic and config loading below
if(CURSCRIPT !== 'chat')
{
	// 现在$groomid已经设置，可以正确加载RuleSet资源文件
	// 配置延迟加载 / Config lazy loading: 入口文件可通过 REQUIRED_CONFIGS 常量按需加载
	$all_configs = array(
		'resources', 'gamecfg', 'combatcfg', 'clubskills',
		'dialogue', 'audio', 'tooltip', 'titles',
	);
	if (!defined('REQUIRED_CONFIGS')) {
		$required_configs = $all_configs; // 默认加载全部，保持向后兼容
	} else {
		$required_configs = REQUIRED_CONFIGS;
	}
	foreach ($all_configs as $cfg_name) {
		if (in_array($cfg_name, $required_configs)) {
			require config($cfg_name, $gamecfg);
		}
	}

	// 初始化RuleSet覆盖系统
	include_once GAME_ROOT.'./include/room/ruleset_override.func.php';
	init_ruleset_override();

	// 加载RuleSet覆盖函数
	load_ruleset_override_functions();

	// 现在加载system.func.php
	require GAME_ROOT.'./include/gamectl/system.func.php';
	// 加载禁区系统统一函数库
	require GAME_ROOT.'./include/gamectl/deatharea.func.php';

	// 按房间粒度的数据库行锁，替代进程级文件锁 / Room-level DB row lock replacing process-level file lock
	$lock_name = 'game_state_' . intval($groomid);
	$lock_result = $db->query("SELECT GET_LOCK('$lock_name', 5)");
	$lock_row = $db->fetch_array($lock_result);
	$lock_acquired = ($lock_row && $lock_row[0] == 1);
	
	load_gameinfo();
	$lostfocus = false;
	$ginfochange = false;

	if ($lock_acquired) {
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
		
		$db->query("SELECT RELEASE_LOCK('$lock_name')");
	}
	
	//除拉取聊天以外的访问都判定一下是否有新的站内信。
	include_once GAME_ROOT.'./include/gamectl/messages.func.php';
	$new_messages = message_check_new($cuser); 
}
?>
