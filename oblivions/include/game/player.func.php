<?php
/**
 * Oblivions 玩家系统：认证、数据抓取、格式化、保存
 *
 * 设计原则：
 * - 完全独立于 bra_players，所有读写均针对 oblplayers 表
 * - 玩家(type=0)与 NPC 敌人(type>0)共用本模块
 * - JSON 字段（itempara/tacpara/skillpara/oblpara）在 format 时解码为数组，save 时编码回字符串
 *
 * @package oblivions
 */

if (!defined('GAME_ROOT')) exit('Direct access not permitted');

/**
 * 模块 1：user 表对比信息检验
 *
 * 校验用户名密码（与 user 表双重校验），返回 oblplayers.pid 或 false。
 * 与旧 auth_game_player() 的差异：仅校验 user 表，不直接读 oblplayers。
 *
 * @param string $username 用户名
 * @param string $password 密码（明文，与 cookie 中 $cpass 一致）
 * @return int|false 返回 oblplayers.pid；用户名密码不匹配返回 false
 */
function obl_auth_player($username, $password) {
	global $db, $tablepre, $gtablepre;
	if (!$username || !$password) return false;

	// 从 user 表校验
	$result = $db->query("SELECT * FROM {$gtablepre}users WHERE username = '" . $db->escape_string($username) . "' LIMIT 1");
	$udata = $db->fetch_array($result);
	if (!$udata) return false;

	// 密码校验（user.password 为 md5）
	if ($udata['password'] !== $password) return false;

	// 查找 oblplayers 中对应记录（玩家 type=0）
	$result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE name = '" . $db->escape_string($username) . "' AND type = 0 LIMIT 1");
	$pdata = $db->fetch_array($result);
	if (!$pdata) return false;

	return (int)$pdata['pid'];
}

/**
 * 模块 2：从 oblplayers 抓取原始数据（玩家和 NPC 共用）
 *
 * @param int $pid
 * @return array|false 原始数据数组（JSON 字段未解码），找不到返回 false
 */
function obl_fetch_playerdata_by_pid($pid) {
	global $db, $tablepre;
	$result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE pid = " . (int)$pid . " LIMIT 1");
	$pdata = $db->fetch_array($result);
	if (!$pdata) return false;
	return $pdata;
}

/**
 * 通过 name 抓取玩家数据（type=0）
 *
 * @param string $name
 * @return array|false 已格式化的数据数组，找不到返回 false
 */
function obl_fetch_playerdata_by_name($name) {
	global $db, $tablepre;
	$result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE name = '" . $db->escape_string($name) . "' AND type = 0 LIMIT 1");
	$pdata = $db->fetch_array($result);
	if (!$pdata) return false;
	obl_format_playerdata($pdata);
	return $pdata;
}

/**
 * 批量获取指定区域的敌人（type > 0）
 *
 * @param int $pgroup 区域组号
 * @return array 敌人数据数组（每个元素已格式化）
 */
function obl_fetch_enemies_by_region($pgroup) {
	global $db, $tablepre;
	$enemies = array();
	$result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE type > 0 AND pgroup = " . (int)$pgroup);
	while ($edata = $db->fetch_array($result)) {
		obl_format_playerdata($edata);
		$enemies[] = $edata;
	}
	return $enemies;
}

/**
 * 模块 3：格式化 player 数据（玩家和 NPC 共用）
 *
 * 解码所有 JSON 字段为 PHP 数组，并保证结构合法（防止"怪东西"）：
 * - itempara：道具栏 JSON 数组（7 格，index 0=特殊槽，1-6=普通槽）
 * - tacpara：策略槽 {"slots": [...]}
 * - skillpara：技能数据 {"skills": [...]}
 * - oblpara：杂项数据 {}
 * - 装备 para 字段（weppara/wep2para/arbpara/arhpara/arapara/arfpara/artpara）：JSON 对象
 *
 * @param array &$pdata 引用传递，直接修改
 * @return void
 */
function obl_format_playerdata(&$pdata) {
	if (!is_array($pdata)) return;

	// 道具栏：JSON 数组，index 0=特殊槽，1~itemmaxslots=普通槽
	$itempara = $pdata['itempara'];
	if (empty($itempara) || !is_array($itempara)) {
		$itempara = is_string($itempara) ? json_decode($itempara, true) : array();
	}
	if (!is_array($itempara)) $itempara = array();
	// 保证槽位完整（0~itemmaxslots），不足补 null
	$maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
	for ($i = 0; $i <= $maxslots; $i++) {
		if (!isset($itempara[$i])) $itempara[$i] = null;
	}
	$pdata['itempara'] = $itempara;

	// 策略槽：{"slots": [null, null, null, null]}
	$tacpara = $pdata['tacpara'];
	if (empty($tacpara) || !is_array($tacpara)) {
		$tacpara = is_string($tacpara) ? json_decode($tacpara, true) : array();
	}
	if (!is_array($tacpara)) $tacpara = array();
	if (!isset($tacpara['slots']) || !is_array($tacpara['slots'])) {
		$tacpara['slots'] = array(null, null, null, null);
	}
	$pdata['tacpara'] = $tacpara;

	// 技能数据：{"skills": []}
	$skillpara = $pdata['skillpara'];
	if (empty($skillpara) || !is_array($skillpara)) {
		$skillpara = is_string($skillpara) ? json_decode($skillpara, true) : array();
	}
	if (!is_array($skillpara)) $skillpara = array();
	if (!isset($skillpara['skills']) || !is_array($skillpara['skills'])) {
		$skillpara['skills'] = array();
	}
	$pdata['skillpara'] = $skillpara;

	// 杂项数据：{}
	$oblpara = $pdata['oblpara'];
	if (empty($oblpara) || !is_array($oblpara)) {
		$oblpara = is_string($oblpara) ? json_decode($oblpara, true) : array();
	}
	if (!is_array($oblpara)) $oblpara = array();
	$pdata['oblpara'] = $oblpara;

	// 装备 para 字段（7 槽）：解码为数组，空值返回空数组
	$equip_para_keys = array('weppara', 'wep2para', 'arbpara', 'arhpara', 'arapara', 'arfpara', 'artpara');
	foreach ($equip_para_keys as $key) {
		$para = isset($pdata[$key]) ? $pdata[$key] : '';
		if (empty($para)) {
			$pdata[$key] = array();
		} elseif (is_string($para)) {
			$decoded = json_decode($para, true);
			$pdata[$key] = is_array($decoded) ? $decoded : array();
		} elseif (!is_array($para)) {
			$pdata[$key] = array();
		}
	}
}

/**
 * 保存玩家数据到 oblplayers
 *
 * 编码所有 JSON 字段，执行 UPDATE。
 *
 * @param array &$pdata 引用传递（JSON 字段会被临时编码为字符串，但函数返回后恢复为数组）
 * @return void
 */
function obl_save_player(&$pdata) {
	global $db, $tablepre;
	if (!isset($pdata['pid'])) return;

	// JSON 字段编码（临时替换，保存后恢复）
	$json_keys = array('itempara', 'tacpara', 'skillpara', 'oblpara');
	$json_backup = array();
	foreach ($json_keys as $key) {
		$json_backup[$key] = isset($pdata[$key]) ? $pdata[$key] : null;
		$pdata[$key] = is_array($pdata[$key]) ? json_encode($pdata[$key], JSON_UNESCAPED_UNICODE) : (string)$pdata[$key];
	}
	// 装备 para 字段编码
	$equip_para_keys = array('weppara', 'wep2para', 'arbpara', 'arhpara', 'arapara', 'arfpara', 'artpara');
	foreach ($equip_para_keys as $key) {
		$json_backup[$key] = isset($pdata[$key]) ? $pdata[$key] : null;
		$pdata[$key] = is_array($pdata[$key]) ? json_encode($pdata[$key], JSON_UNESCAPED_UNICODE) : (string)$pdata[$key];
	}

	// 构建 UPDATE 数据（排除 pid 主键）
	$update_fields = array(
		'type', 'name', 'pass', 'gd', 'icon',
		'action', 'bid',
		'hp', 'mhp', 'sp', 'msp', 'att', 'def',
		'ap', 'max_ap',
		'pgroup', 'pls',
		'lvl', 'exp', 'state',
		'wep', 'wepk', 'wepe', 'weps', 'wepsk', 'weppara',
		'wep2', 'wep2k', 'wep2e', 'wep2s', 'wep2sk', 'wep2para',
		'arb', 'arbk', 'arbe', 'arbs', 'arbsk', 'arbpara',
		'arh', 'arhk', 'arhe', 'arhs', 'arhsk', 'arhpara',
		'ara', 'arak', 'arae', 'aras', 'arask', 'arapara',
		'arf', 'arfk', 'arfe', 'arfs', 'arfsk', 'arfpara',
		'art', 'artk', 'arte', 'arts', 'artsk', 'artpara',
		'itempara', 'itemmaxslots',
		'tacpara', 'skillpara', 'oblpara', 'discovered',
	);

	$ndata = array();
	foreach ($update_fields as $key) {
		$ndata[$key] = isset($pdata[$key]) ? $pdata[$key] : '';
	}

	$db->array_update("{$tablepre}oblplayers", $ndata, "pid = " . (int)$pdata['pid']);

	// 恢复 JSON 字段为数组（保持 $pdata 在内存中的格式一致）
	foreach ($json_backup as $key => $val) {
		$pdata[$key] = $val;
	}
}

/**
 * Oblivions 游戏入口：封装认证流程
 *
 * 流程：cookie 取 $cuser/$cpass → obl_auth_player 校验 → obl_fetch_playerdata_by_pid → obl_format_playerdata
 * 镜像 game_entrypoint()，但完全使用 oblplayers 表。
 *
 * @param string $entry_type 入口类型（'command'/'game'），用于错误处理
 * @return array 格式化后的 $pdata
 */
function obl_game_entrypoint($entry_type = 'game') {
	global $cuser, $cpass, $gamestate;
	// 1. 检查登录态
	if (!$cuser || !$cpass) {
		obl_entrypoint_handle_failure('no_login', $entry_type);
	}

	// 2. 校验 user 表 + 获取 oblplayers.pid
	$pid = obl_auth_player($cuser, $cpass);
	if ($pid === false) {
		// 区分：用户名密码错误 vs oblplayers 记录不存在
		// 两者都视为认证失败，玩家需重新激活
		obl_entrypoint_handle_failure('no_player', $entry_type);
	}

	// 3. 抓取 oblplayers 数据
	$pdata = obl_fetch_playerdata_by_pid($pid);
	if (!$pdata) {
		obl_entrypoint_handle_failure('no_player', $entry_type);
	}

	// 4. 格式化 JSON 字段
	obl_format_playerdata($pdata);

	// 5. gamestate 检查（与旧逻辑一致：gamestate==0 时仍返回数据，由调用方处理）
	return $pdata;
}

/**
 * battle 状态防呆校验
 *
 * 检测玩家 action='battle' 时战斗关系是否合法，不合法则清除双方 action/bid。
 * 覆盖场景：战斗系统未实装的过渡期、异常中断、数据库脏数据、未来战斗系统变更。
 *
 * 合法性校验（任一不满足即判定为脏状态）：
 *  - bid 非空且为有效 pid
 *  - bid 指向的单位存在
 *  - 该单位 state==0（活着）
 *  - 双向关联完整：该单位 action=='battle' 且其 bid 指回自己
 *  - 双方在同一 pgroup（同一区域）
 *
 * @param array &$pdata 玩家数据（引用传递，可能被清除 action/bid）
 * @return void
 */
function obl_validate_battle_state(&$pdata) {
	// 只检查 action='battle' 的单位
	if ($pdata['action'] !== 'battle') return;

	$pid = (int)$pdata['pid'];
	$bid = (int)$pdata['bid'];

	// 校验 1：bid 非空
	if ($bid <= 0) {
		obl_clear_invalid_battle_state($pdata, null, 'empty_bid');
		return;
	}

	// 加载战斗对象
	$opponent = obl_fetch_playerdata_by_pid($bid);
	if (!$opponent) {
		// 校验 2：战斗对象不存在
		obl_clear_invalid_battle_state($pdata, null, 'opponent_not_found');
		return;
	}
	obl_format_playerdata($opponent);

	// 校验 3：战斗对象已死亡
	if ((int)$opponent['state'] !== 0) {
		obl_clear_invalid_battle_state($pdata, $opponent, 'opponent_dead');
		return;
	}

	// 校验 4：双向关联完整（对方也处于 battle 状态且 bid 指回自己）
	if ($opponent['action'] !== 'battle' || (int)$opponent['bid'] !== $pid) {
		obl_clear_invalid_battle_state($pdata, $opponent, 'broken_link');
		return;
	}

	// 校验 5：双方在同一区域
	if ((int)$opponent['pgroup'] !== (int)$pdata['pgroup']) {
		obl_clear_invalid_battle_state($pdata, $opponent, 'cross_region');
		return;
	}

	// 所有校验通过，battle 状态合法，保留
}

/**
 * 清除脏的 battle 状态（obl_validate_battle_state 的辅助函数）
 *
 * @param array     &$pdata   玩家数据（引用传递）
 * @param array|null &$opponent 战斗对象数据（引用传递，null 表示不存在/无需清除）
 * @param string    $reason   失效原因（用于日志排查）
 * @return void
 */
function obl_clear_invalid_battle_state(&$pdata, &$opponent, $reason) {
	global $obl_log;

	// 清除玩家的 battle 状态
	$pdata['action'] = '';
	$pdata['bid']    = 0;
	obl_save_player($pdata);

	// 如果对方也存在脏的 battle 状态，一并清除
	if ($opponent !== null && $opponent['action'] === 'battle') {
		$opponent['action'] = '';
		$opponent['bid']    = 0;
		obl_save_player($opponent);
	}

	// emit 结构化日志（如果 $obl_log 已初始化）
	if ($obl_log) {
		$obl_log->emit('battle.invalid', 'battle', array(
			'pid'    => $pdata['pid'],
			'name'   => $pdata['name'],
			'bid'    => $pdata['bid'],
			'reason' => $reason,
		));
	}
}

/**
 * 根据玩家 action 状态过滤命令
 *
 * 防止前端在战斗状态下提交非战斗命令（move/explore/search 等），
 * 或在非战斗状态下提交战斗命令，造成状态混乱。
 *
 * 规则：
 * - action='battle'：只允许 obl_battle_action
 * - action=''（正常）：允许所有非战斗命令 + obl_battle_start（发起战斗）
 *
 * @param string $command 命令名
 * @param string $action  玩家当前 action 状态
 * @return bool true=允许执行，false=拒绝
 */
function obl_command_allowed_by_state($command, $action) {
	if ($action === 'battle') {
		// 战斗中：只允许战斗动作
		return in_array($command, array('obl_battle_action'), true);
	}
	// 正常状态：不允许战斗中命令（obl_battle_action），
	// 但允许 obl_battle_start（发起战斗）和所有探索命令
	if (in_array($command, array('obl_battle_action'), true)) {
		return false;
	}
	return true;
}

/**
 * 入口认证失败处理
 *
 * @param string $status 失败状态（no_login/no_player/wrong_pw）
 * @param string $entry_type 入口类型
 * @return void（会 exit）
 */
function obl_entrypoint_handle_failure($status, $entry_type) {
	// 与旧 _entrypoint_handle_auth_failure() 行为对齐：
	// command 入口返回 JSON 错误，game 入口跳转登录页
	if ($entry_type === 'command') {
		// AJAX 请求：返回 JSON 错误，前端处理跳转
		$gamedata = array(
			'innerHTML' => array(),
			'msg' => '认证失败，请重新登录',
			'relogin' => 1,
		);
		// 兼容旧响应格式
		if (function_exists('compatible_json_encode')) {
			echo compatible_json_encode($gamedata);
		} else {
			echo json_encode($gamedata);
		}
		exit;
	}
	// game 入口：跳转登录页
	header('Location: login.php');
	exit;
}

#=============================================================================
# 道具栏辅助函数（itempara JSON 读写）
#=============================================================================

/**
 * 获取道具栏数组
 *
 * @param array &$pdata 已格式化的玩家数据
 * @return array 道具栏数组（index 0=特殊槽，1~itemmaxslots=普通槽）
 */
function obl_get_items(&$pdata) {
	return $pdata['itempara'];
}

/**
 * 获取指定槽位的道具
 *
 * @param array &$pdata
 * @param int $slot 槽位索引（0=特殊，1~itemmaxslots=普通）
 * @return array|null 道具对象数组，空槽返回 null
 */
function obl_get_item(&$pdata, $slot) {
	return isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
}

/**
 * 设置指定槽位的道具
 *
 * @param array &$pdata
 * @param int $slot
 * @param array|null $item 道具对象数组，或 null（清空）
 * @return void
 */
function obl_set_item(&$pdata, $slot, $item) {
	$pdata['itempara'][$slot] = $item;
}

/**
 * 找空槽位（仅普通槽 1~itemmaxslots，不含特殊槽 0）
 *
 * @param array &$pdata
 * @return int|false 空槽位索引，无空位返回 false
 */
function obl_find_empty_slot(&$pdata) {
	$maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
	for ($i = 1; $i <= $maxslots; $i++) {
		if (!isset($pdata['itempara'][$i]) || $pdata['itempara'][$i] === null) {
			return $i;
		}
	}
	return false;
}

/**
 * 检查背包是否已满
 *
 * @param array &$pdata
 * @return bool
 */
function obl_is_bag_full(&$pdata) {
	return obl_find_empty_slot($pdata) === false;
}

#=============================================================================
# 玩家记录创建（valid.php 激活时调用）
#=============================================================================

/**
 * 在 oblplayers 中创建玩家记录（valid.php 激活时调用）
 *
 * 从 valid.php 构建的 $ndata（bra_players 格式）提取通用字段，
 * 添加 Oblivions 专属字段（ap/max_ap/itempara/tacpara/skillpara/oblpara），
 * 插入 oblplayers 表。
 *
 * 注意：bra_players 仍由 valid.php 原逻辑插入（开发阶段防御性保留），
 * 但 Oblivions 模式不依赖 bra_players，obl_save_player() 不同步任何数据到 bra_players。
 *
 * @param array $ndata valid.php 构建的玩家数据（bra_players 格式）
 * @return int|false 插入的 pid，失败返回 false
 */
function obl_create_player_record($ndata) {
	global $db, $tablepre;

	// 构建 itempara：从 $ndata 的 itm1~itm6 字段转换（index 0=特殊槽，1~6=普通槽）
	$itempara = array(null); // index 0 = 特殊槽
	for ($i = 1; $i <= 6; $i++) {
		$itm_key = 'itm' . $i;
		if (!empty($ndata[$itm_key])) {
			$itmpara_raw = isset($ndata['itmpara' . $i]) ? $ndata['itmpara' . $i] : '';
			$itmpara_arr = !empty($itmpara_raw) ? json_decode($itmpara_raw, true) : array();
			if (!is_array($itmpara_arr)) $itmpara_arr = array();
			$itempara[$i] = array(
				'itm'     => $ndata[$itm_key],
				'itmk'    => isset($ndata['itmk' . $i]) ? $ndata['itmk' . $i] : '',
				'itme'    => isset($ndata['itme' . $i]) ? (int)$ndata['itme' . $i] : 0,
				'itms'    => isset($ndata['itms' . $i]) ? $ndata['itms' . $i] : '0',
				'itmsk'   => isset($ndata['itmsk' . $i]) ? $ndata['itmsk' . $i] : '',
				'itmpara' => $itmpara_arr,
				'itmid'   => '',
			);
		} else {
			$itempara[$i] = null;
		}
	}

	// 映射 bra_players 字段到 oblplayers 字段（通用字段同名）
	$obl_ndata = array(
		'type'         => isset($ndata['type']) ? (int)$ndata['type'] : 0,
		'name'         => isset($ndata['name']) ? $ndata['name'] : '',
		'pass'         => isset($ndata['pass']) ? $ndata['pass'] : '',
		'gd'           => isset($ndata['gd']) ? $ndata['gd'] : 'm',
		'icon'         => isset($ndata['icon']) ? $ndata['icon'] : '0',
		'action'       => isset($ndata['action']) ? $ndata['action'] : '',
		'bid'          => isset($ndata['bid']) ? (int)$ndata['bid'] : 0,
		'hp'           => isset($ndata['hp']) ? (int)$ndata['hp'] : 0,
		'mhp'          => isset($ndata['mhp']) ? (int)$ndata['mhp'] : 0,
		'sp'           => isset($ndata['sp']) ? (int)$ndata['sp'] : 0,
		'msp'          => isset($ndata['msp']) ? (int)$ndata['msp'] : 0,
		'att'          => isset($ndata['att']) ? (int)$ndata['att'] : 0,
		'def'          => isset($ndata['def']) ? (int)$ndata['def'] : 0,
		'ap'           => 0,
		'max_ap'       => 10,
		'pgroup'       => isset($ndata['pgroup']) ? (int)$ndata['pgroup'] : 0,
		'pls'          => isset($ndata['pls']) ? (int)$ndata['pls'] : 0,
		'lvl'          => isset($ndata['lvl']) ? (int)$ndata['lvl'] : 0,
		'exp'          => isset($ndata['exp']) ? (int)$ndata['exp'] : 0,
		'state'        => isset($ndata['state']) ? (int)$ndata['state'] : 0,
		// 装备字段（7 槽 × 6 字段）
		'wep'          => isset($ndata['wep']) ? $ndata['wep'] : '',
		'wepk'         => isset($ndata['wepk']) ? $ndata['wepk'] : '',
		'wepe'         => isset($ndata['wepe']) ? (int)$ndata['wepe'] : 0,
		'weps'         => isset($ndata['weps']) ? $ndata['weps'] : '0',
		'wepsk'        => isset($ndata['wepsk']) ? $ndata['wepsk'] : '',
		'weppara'      => isset($ndata['weppara']) ? $ndata['weppara'] : '',
		'wep2'         => isset($ndata['wep2']) ? $ndata['wep2'] : '',
		'wep2k'        => isset($ndata['wep2k']) ? $ndata['wep2k'] : '',
		'wep2e'        => isset($ndata['wep2e']) ? (int)$ndata['wep2e'] : 0,
		'wep2s'        => isset($ndata['wep2s']) ? $ndata['wep2s'] : '0',
		'wep2sk'       => isset($ndata['wep2sk']) ? $ndata['wep2sk'] : '',
		'wep2para'     => isset($ndata['wep2para']) ? $ndata['wep2para'] : '',
		'arb'          => isset($ndata['arb']) ? $ndata['arb'] : '',
		'arbk'         => isset($ndata['arbk']) ? $ndata['arbk'] : '',
		'arbe'         => isset($ndata['arbe']) ? (int)$ndata['arbe'] : 0,
		'arbs'         => isset($ndata['arbs']) ? $ndata['arbs'] : '0',
		'arbsk'        => isset($ndata['arbsk']) ? $ndata['arbsk'] : '',
		'arbpara'      => isset($ndata['arbpara']) ? $ndata['arbpara'] : '',
		'arh'          => isset($ndata['arh']) ? $ndata['arh'] : '',
		'arhk'         => isset($ndata['arhk']) ? $ndata['arhk'] : '',
		'arhe'         => isset($ndata['arhe']) ? (int)$ndata['arhe'] : 0,
		'arhs'         => isset($ndata['arhs']) ? $ndata['arhs'] : '0',
		'arhsk'        => isset($ndata['arhsk']) ? $ndata['arhsk'] : '',
		'arhpara'      => isset($ndata['arhpara']) ? $ndata['arhpara'] : '',
		'ara'          => isset($ndata['ara']) ? $ndata['ara'] : '',
		'arak'         => isset($ndata['arak']) ? $ndata['arak'] : '',
		'arae'         => isset($ndata['arae']) ? (int)$ndata['arae'] : 0,
		'aras'         => isset($ndata['aras']) ? $ndata['aras'] : '0',
		'arask'        => isset($ndata['arask']) ? $ndata['arask'] : '',
		'arapara'      => isset($ndata['arapara']) ? $ndata['arapara'] : '',
		'arf'          => isset($ndata['arf']) ? $ndata['arf'] : '',
		'arfk'         => isset($ndata['arfk']) ? $ndata['arfk'] : '',
		'arfe'         => isset($ndata['arfe']) ? (int)$ndata['arfe'] : 0,
		'arfs'         => isset($ndata['arfs']) ? $ndata['arfs'] : '0',
		'arfsk'        => isset($ndata['arfsk']) ? $ndata['arfsk'] : '',
		'arfpara'      => isset($ndata['arfpara']) ? $ndata['arfpara'] : '',
		'art'          => isset($ndata['art']) ? $ndata['art'] : '',
		'artk'         => isset($ndata['artk']) ? $ndata['artk'] : '',
		'arte'         => isset($ndata['arte']) ? (int)$ndata['arte'] : 0,
		'arts'         => isset($ndata['arts']) ? $ndata['arts'] : '0',
		'artsk'        => isset($ndata['artsk']) ? $ndata['artsk'] : '',
		'artpara'      => isset($ndata['artpara']) ? $ndata['artpara'] : '',
		// Oblivions 专属字段
		'itempara'     => json_encode($itempara, JSON_UNESCAPED_UNICODE),
		'itemmaxslots' => 6,
		'tacpara'      => json_encode(array('slots' => array(null, null, null, null)), JSON_UNESCAPED_UNICODE),
		'skillpara'    => json_encode(array('skills' => array()), JSON_UNESCAPED_UNICODE),
		'oblpara'      => json_encode(array(), JSON_UNESCAPED_UNICODE),
		'discovered'   => 0,
	);

	$db->array_insert("{$tablepre}oblplayers", $obl_ndata);

	// 获取插入的 pid
	$result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE name = '" . $db->escape_string($obl_ndata['name']) . "' AND type = 0 ORDER BY pid DESC LIMIT 1");
	$row = $db->fetch_array($result);
	return $row ? (int)$row['pid'] : false;
}

#=============================================================================
# 游戏刻机制（tick mechanism）
#=============================================================================

/**
 * 判断命令是否推进游戏刻（白名单机制）
 *
 * 规则：只有白名单内的命令才推进 tick。
 * 白名单 = 明确消耗时间/影响世界状态的行为。
 *
 * 当前白名单：
 * - move              玩家移动
 * - obl_explore       玩家原地探索（点亮迷雾+发现道具）
 * - obl_search        玩家搜索建筑物 POI
 * - obl_battle_start  玩家发起战斗（含玩家先攻轮，详见游戏刻机制设计案 6.1）
 * - obl_battle_action 玩家先攻轮完成
 *
 * 设计原则：只有"玩家主动行动结束"才推进 tick。
 * NPC 先攻轮由 obl_resolve_tick_events() 末尾推进 tick（与玩家命令互斥）。
 *
 * @param string $command 命令名
 * @return bool true=推进 tick，false=不推进
 */
function obl_command_advances_tick($command) {
	// 白名单：推进 tick 的命令
	$tick_commands = array(
		'move',             // 玩家移动
		'obl_explore',      // 玩家探索
		'obl_search',       // 玩家搜索建筑物
		'obl_battle_start',  // 玩家发起战斗（含玩家先攻轮）
		'obl_battle_action', // 玩家先攻轮完成
	);
	return in_array($command, $tick_commands);
}

/**
 * 处理游戏刻事件（tick event resolution）
 *
 * 由 common.inc.php 在检测到 obl_pretick < obl_tick 时调用（调用前已同步 obl_pretick = obl_tick）。
 * 采用两阶段处理（详见 游戏刻机制设计案.md 第四节）：
 *   阶段 1：战斗中 NPC 先攻轮（串行，检测标记，最多 1 个）
 *   阶段 2：非战斗 NPC AI 行为（并行）
 * 末尾：如果阶段 1 执行了 NPC 先攻轮（设置了 $obl_tick_advanced 标记），推进 obl_tick++。
 *
 * 循环模型：
 *   - NPC 先攻轮执行 → 末尾 obl_tick++ → 下次请求 obl_pretick < obl_tick → 继续循环
 *   - 玩家先攻轮（当前先攻者是玩家）→ 不执行 NPC 先攻轮 → 不推进 obl_tick → 循环终止
 *
 * @param int $delta 需要处理的刻数差（保留参数兼容，实际最多处理 1 个 NPC 先攻轮）
 * @return void
 */
function obl_resolve_tick_events($delta) {
	global $gamevars, $obl_tick_advanced;

	// 清除"游戏刻已推进"标记（同一请求内有效）
	$obl_tick_advanced = false;

	// 加载敌人 AI（含两阶段处理：战斗中 NPC 先攻轮 + 非战斗 NPC AI 行为）
	if (!function_exists('obl_resolve_all_enemy_ai')) {
		include_once GAME_ROOT . './oblivions/include/game/enemy_ai.func.php';
	}

	// 两阶段处理（阶段 1：战斗中 NPC 先攻轮；阶段 2：非战斗 NPC AI 行为）
	// obl_resolve_all_enemy_ai 内部检测 $obl_tick_advanced 标记，阶段 1 最多处理 1 个 NPC 先攻轮
	obl_resolve_all_enemy_ai();

	// 末尾：统一游戏刻推进
	// 如果 NPC 先攻轮执行了（设置了标记），推进 1 游戏刻
	// 这会产生新的未处理游戏刻（obl_pretick < obl_tick），下次请求继续循环
	if ($obl_tick_advanced) {
		if (!isset($gamevars['obl_tick'])) $gamevars['obl_tick'] = 0;
		$gamevars['obl_tick']++;
	}
}
