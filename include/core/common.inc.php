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

// CSRF Token 保护 / CSRF Token protection
// 为 HTML 渲染页面生成 CSRF Token，AJAX 请求通过 cookie 中携带的 token 验证
$csrf_exempt_scripts = array('chat', 'login', 'register', 'install');
if (!in_array(CURSCRIPT, $csrf_exempt_scripts)) {
	// 从 Cookie 读取或生成新的 CSRF Token
	$csrf_cookie_key = $gtablepre . 'csrf_token';
	if (!empty($_COOKIE[$csrf_cookie_key])) {
		$csrf_token = $_COOKIE[$csrf_cookie_key];
	} else {
		$csrf_token = bin2hex(random_bytes(32));
		gsetcookie('csrf_token', $csrf_token, 86400 * 30, 0); // 30天有效期
	}
	// POST 请求验证 CSRF Token（宽松模式：无 token 时放行以保持向后兼容）
	if ($_SERVER['REQUEST_METHOD'] === 'POST') {
		$client_token = '';
		if (!empty($_POST['csrf_token'])) {
			$client_token = $_POST['csrf_token'];
		} elseif (!empty($_SERVER['HTTP_X_CSRF_TOKEN'])) {
			$client_token = $_SERVER['HTTP_X_CSRF_TOKEN'];
		}
		// 只有当客户端发送了 token 时才验证；未发送 token 的旧前端请求放行
		if ($client_token !== '' && !hash_equals($csrf_token, $client_token)) {
			gexit('CSRF token validation failed', __file__, __line__);
		}
	}
}

// 请求速率限制 / Request rate limiting
// 基于 IP + 用户名的文件级速率限制，防止自动化脚本暴力请求
// 暂时不需要这样的功能
/*
if (!in_array(CURSCRIPT, array('chat', 'install'))) {
	$rate_cfg = array(
		'max_requests' => 300,  // 每分钟最大请求数
		'window'       => 60,   // 时间窗口（秒）
	);
	$client_ip = isset($cuser) ? $cuser : (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0.0.0.0');
	$rate_key = md5($client_ip);
	$rate_dir = GAME_ROOT . './gamedata/cache/rate_limit/';
	$rate_file = $rate_dir . $rate_key . '.json';

	if (!is_dir($rate_dir)) {
		mkdir($rate_dir, 0777, true);
	}

	$rate_data = array('requests' => array());
	if (file_exists($rate_file)) {
		$raw = file_get_contents($rate_file);
		$decoded = json_decode($raw, true);
		if (is_array($decoded)) {
			$rate_data = $decoded;
		}
	}

	// 清理过期记录
	$cutoff = time() - $rate_cfg['window'];
	$rate_data['requests'] = array_values(array_filter($rate_data['requests'], function($t) use ($cutoff) {
		return $t > $cutoff;
	}));

	if (count($rate_data['requests']) >= $rate_cfg['max_requests']) {
		if (CURSCRIPT === 'command' || isset($_GET['is_new']) || isset($_GET['vex_api'])) {
			ob_clean();
			echo compatible_json_encode(array('error' => 'Rate limit exceeded'));
			exit();
		} else {
			gexit('请求过于频繁，请稍后再试。', __file__, __line__);
		}
	}

	$rate_data['requests'][] = time();
	file_put_contents($rate_file, json_encode($rate_data));
}*/

require GAME_ROOT.'./gamedata/system.php';
require GAME_ROOT.'./include/room/roommng.func.php';
$all_requires = array(
	'./include/gamectl/init.func.php',
	'./include/gamectl/news.func.php',
	'./include/gamectl/resources.func.php',
	'./include/game/club/revclubskills.func.php',
	'./include/game/dice.func.php',
	'./include/pregame/titles.func.php',
);
// 遗忘模式
if (function_exists('oblivions_is_active') && oblivions_is_active()) 
	{
	/*define('REQUIRED_REQUIRES', [
			'./include/gamectl/init.func.php',
			'./include/gamectl/news.func.php',
			'./include/gamectl/resources.func.php',
		]);*/
	}
if (!defined('REQUIRED_REQUIRES')) {
	$required_requires = $all_requires; // 默认加载全部，保持向后兼容
} else {
	$required_requires = REQUIRED_REQUIRES;
}
foreach ($all_requires as $requires_dir) {
	if (in_array($requires_dir, $required_requires)) {
		require GAME_ROOT . $requires_dir;
	}
}

// $gtablepre 已在数据库连接时设置，这里不再重新赋值
if(!isset($gtablepre)) {
	$gtablepre = $tablepre;
}

ob_start();

$cuser = & ${$gtablepre.'user'};
$cpass = & ${$gtablepre.'pass'};

// 调试自动登录：无 Cookie 时从本地配置文件读取凭据 / Debug auto-login: read credentials from local config when no Cookie
if ((!$cuser || !$cpass) && file_exists(GAME_ROOT.'debug_autologin.php')) {
	$debug_autologin_user = '';
	$debug_autologin_pass = '';
	include GAME_ROOT.'debug_autologin.php';
	if (!empty($debug_autologin_user) && !empty($debug_autologin_pass)) {
		$cuser = $debug_autologin_user;
		$cpass = md5($debug_autologin_pass);
		// 同步写入 Cookie 使后续请求也保持登录 / Set cookie so subsequent requests stay logged in
		gsetcookie('user', $cuser);
		gsetcookie('pass', $cpass);
	}
	unset($debug_autologin_user, $debug_autologin_pass);
}

// 房间列表缓存 / Room list cache (TTL=60s)
$roomlist_cache_file = GAME_ROOT.'./gamedata/bak/roomlist.php';
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

// RuleSet缓存：一次查询gruleset，下游函数统一读取，避免每次config()调用重复查询DB
// RuleSet cache: query gruleset once, downstream functions read from this global
global $gruleset;
$gruleset = '';
if (!empty($groomid) && $groomid > 0) {
    $result = $db->query("SELECT gruleset FROM {$gtablepre}game WHERE groomid = {$groomid}");
    if ($db->num_rows($result)) {
        $room_data = $db->fetch_array($result);
        $gruleset = $room_data['gruleset'];
    }
}

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
	// 遗忘模式
	/*if (function_exists('oblivions_is_active') && oblivions_is_active()) 
	{
		define('REQUIRED_CONFIGS', [
			'resources', 'gamecfg',
			'combatcfg',
		]);
	}*/
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
	$lock_result = $db->query("SELECT GET_LOCK('$lock_name', 5) AS lock_acquired");
	$lock_row = $db->fetch_array($lock_result);
	$lock_acquired = ($lock_row && $lock_row['lock_acquired'] == 1);
	
	load_gameinfo();
	$lostfocus = false;
	$ginfochange = false;

	if ($lock_acquired) {
		// 游戏状态机 / Game state machine
		// Oblivions 模式走自己的状态机，完全与旧模式解耦
		if (function_exists('oblivions_is_active') && oblivions_is_active()) {
			require_once GAME_ROOT.'./oblivions/include/gamectl/state.func.php';
			$transitions = array(
				'obl_gamestate_try_prepare',
				'obl_gamestate_try_start',
			);
		} else {
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
		}
		foreach ($transitions as $func) {
			if ($func()) $ginfochange = true;
		}

		// Oblivions 子系统引导 + 日志收集器初始化
	// 一次性加载所有 Oblivions 函数库（替代散落的条件 include）
	// tick 解析、防呆、命令处理都会 emit 日志到 $obl_log，请求结束时统一持久化
	if (function_exists('oblivions_is_active') && oblivions_is_active()) {
		require_once GAME_ROOT.'./oblivions/include/core/obl_bootstrap.php';
		if (!isset($obl_log)) {
			$obl_log = new OblivionsLogger();
		}
		// 错误日志收集器初始化（与 $obl_log 物理隔离，独立持久化）
		// 后端异常捕获时 emit 到 $obl_error_log，前端通过 api_v2.php ?action=obl_error 拉取
		if (!isset($obl_error_log)) {
			$obl_error_log = new OblivionsErrorLogger();
		}
		// 战斗日志收集器初始化（与 $obl_log 分离，存战斗细节动作）
		// 遭遇战（tick 结算）和 obl_battle_action 都会 emit 到 $obl_battle_log
		if (!isset($obl_battle_log)) {
			$obl_battle_log = new BattleLogCollector();
		}
	}

		// Oblivions 游戏刻事件处理（在锁内，确保原子性）
	// 模型：obl_tick_synchronize() 同步 obl_pretick = obl_tick（标记已处理），
	// 再执行 tick 事件处理。tick 事件处理内部如果 NPC 先攻轮执行了，
	// 会通过 obl_tick_advance() 推进 obl_tick++（产生新的未处理游戏刻），
	// 下次请求 obl_pretick < obl_tick 仍成立，前端自动刷新循环。
	// obl_tick 唯两处增加：NPC 先攻轮（obl_tick_dispatch 末尾）/ 玩家先攻轮（obl_command [F] 段），互斥。
	// tick.func.php 已由 obl_bootstrap.php 加载，无需条件 include
	if (function_exists('oblivions_is_active') && oblivions_is_active()
		&& isset($gamevars['obl_tick']) && isset($gamevars['obl_pretick'])
		&& $gamevars['obl_pretick'] < $gamevars['obl_tick'])
	{
		$delta = (int)$gamevars['obl_tick'] - (int)$gamevars['obl_pretick'];
		// 先同步 obl_pretick（标记已处理的游戏刻）
		obl_tick_synchronize();
		// 再执行 tick 事件处理（内部可能推进 obl_tick，产生新的未处理游戏刻）
		obl_resolve_tick_events($delta);

		// 战斗状态机超时恢复：检测卡在 NPC_ACTING 状态超过 30 秒的战场
		// 场景：NPC 行动已完成但状态未更新（如异常退出、逻辑遗漏）
		// 恢复策略：降级到 WAITING_PLAYER（假设 NPC 行动已完成）
		if (function_exists('obl_battle_state_find_stale')) {
			$stale_qids = obl_battle_state_find_stale(30, OBL_BS_NPC_ACTING);
			foreach ($stale_qids as $stale_qid) {
				if (function_exists('obl_battle_state_reset')) {
					obl_battle_state_reset($stale_qid, OBL_BS_WAITING_PLAYER);
				}
			}
		}

		$ginfochange = true;  // 触发 save_gameinfo() 持久化 obl_tick/obl_pretick
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
