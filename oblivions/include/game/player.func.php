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
	obl_format_playerdata($pdata);
	return $pdata;
}

function obl_fetch_playerdata_by_pid_for_update($pid) {
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE pid = " . (int)$pid . " LIMIT 1 FOR UPDATE");
    $pdata = $db->fetch_array($result);
    if (!$pdata) return false;
    obl_format_playerdata($pdata);
    return $pdata;
}

/**
 * 批量获取玩家数据
 *
 * @param int[] $pids PID 数组
 * @return array [pid => data, ...] 已格式化的数据映射，不存在的 pid 不会出现在结果中
 */
function obl_fetch_playerdata_batch(array $pids): array {
    if (empty($pids)) return [];
    global $db, $tablepre;
    $ids = implode(',', array_map('intval', $pids));
    $result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE pid IN ({$ids})");
    $map = [];
    while ($row = $db->fetch_array($result)) {
        obl_format_playerdata($row);
        $map[(int)$row['pid']] = $row;
    }
    return $map;
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
 * 查询指定图格内的所有玩家 PID
 * 从 obl_move 占用检查的裸 SQL 抽出的共享原语，供移动/战斗等子系统复用
 * 纯读取，无副作用
 *
 * @param int $pgroup      区域组号
 * @param int $pls         图格 ID
 * @param int $exclude_pid 排除的 PID（如 actor 自己），0 表示不排除
 * @return int[] PID 列表
 */
function obl_get_pids_in_tile($pgroup, $pls, $exclude_pid = 0): array {
	global $db, $tablepre;
	$pgroup = (int)$pgroup;
	$pls = (int)$pls;
	$exclude_pid = (int)$exclude_pid;

	$sql = "SELECT pid FROM {$tablepre}oblplayers WHERE pgroup = {$pgroup} AND pls = {$pls}";
	if ($exclude_pid > 0) {
		$sql .= " AND pid != {$exclude_pid}";
	}

	$result = $db->query($sql);
	$pids = array();
	while ($row = $db->fetch_array($result)) {
		$pids[] = (int)$row['pid'];
	}
	return $pids;
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

	// 技能数据：由 skill_format_skillpara 统一处理（迁移旧格式 + 注入默认技能）
	$skillpara = $pdata['skillpara'];
	if (empty($skillpara) || !is_array($skillpara)) {
		$skillpara = is_string($skillpara) ? json_decode($skillpara, true) : array();
	}
	if (!is_array($skillpara)) $skillpara = array();
	include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
	skill_format_skillpara($skillpara);
	if (function_exists('skill_inject_equipment')) {
		skill_inject_equipment($skillpara, $pdata);
	}
	# NPC 专属默认技能注入（type>0 为敌人类型 ID）
	if ((int)$pdata['type'] > 0) {
		skill_ensure_npc_defaults($skillpara);
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
 * 编码所有 JSON 字段，执行 UPDATE。值传递，不修改外部数据。
 *
 * @param array $pdata 玩家数据（值拷贝，函数内编码不影响调用方）
 * @return void
 */
function obl_save_player($pdata) {
	global $db, $tablepre;
	if (!isset($pdata['pid'])) return;

	// 剥离临时技能（equipment 类）后再编码（只影响值拷贝）
	include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
	skill_strip_temporary($pdata['skillpara']);

	// JSON 字段编码
	$json_keys = array('itempara', 'tacpara', 'skillpara', 'oblpara');
	foreach ($json_keys as $key) {
		$pdata[$key] = is_array($pdata[$key]) ? json_encode($pdata[$key], JSON_UNESCAPED_UNICODE) : (string)$pdata[$key];
	}
	// 装备 para 字段编码
	$equip_para_keys = array('weppara', 'wep2para', 'arbpara', 'arhpara', 'arapara', 'arfpara', 'artpara');
	foreach ($equip_para_keys as $key) {
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
		'wepid', 'wep', 'wepk', 'wepe', 'weps', 'wepsk', 'weppara',
		'wep2id', 'wep2', 'wep2k', 'wep2e', 'wep2s', 'wep2sk', 'wep2para',
		'arbid', 'arb', 'arbk', 'arbe', 'arbs', 'arbsk', 'arbpara',
		'arhid', 'arh', 'arhk', 'arhe', 'arhs', 'arhsk', 'arhpara',
		'araid', 'ara', 'arak', 'arae', 'aras', 'arask', 'arapara',
		'arfid', 'arf', 'arfk', 'arfe', 'arfs', 'arfsk', 'arfpara',
		'artid', 'art', 'artk', 'arte', 'arts', 'artsk', 'artpara',
		'itempara', 'itemmaxslots',
		'tacpara', 'skillpara', 'oblpara', 'discovered',
	);

	$ndata = array();
	foreach ($update_fields as $key) {
		$ndata[$key] = isset($pdata[$key]) ? $pdata[$key] : '';
	}

	$db->array_update("{$tablepre}oblplayers", $ndata, "pid = " . (int)$pdata['pid']);
	// 函数返回，$pdata 拷贝丢弃，外部数据不受影响
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

	// 构建 itempara：从 $ndata 的 itmid1~itmid6 / itm1~itm6 字段转换（index 0=特殊槽，1~6=普通槽）
	$item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
	$itempara = array(null); // index 0 = 特殊槽
	for ($i = 1; $i <= 6; $i++) {
		$itm_key = 'itm' . $i;
		$itmid = isset($ndata['itmid' . $i]) ? (string)$ndata['itmid' . $i] : '';
		if ($itmid !== '' && isset($item_table[$itmid])) {
			$tpl = $item_table[$itmid];
			$itmpara_raw = isset($ndata['itmpara' . $i]) ? $ndata['itmpara' . $i] : (string)$tpl['itmpara'];
			$itmpara_arr = !empty($itmpara_raw) ? json_decode($itmpara_raw, true) : array();
			if (!is_array($itmpara_arr)) $itmpara_arr = array();
			$itempara[$i] = array(
				'itm'     => isset($ndata[$itm_key]) ? $ndata[$itm_key] : '',
				'itmk'    => isset($ndata['itmk' . $i]) && $ndata['itmk' . $i] !== '' ? $ndata['itmk' . $i] : (string)$tpl['itmk'],
				'itme'    => isset($ndata['itme' . $i]) && (int)$ndata['itme' . $i] > 0 ? (int)$ndata['itme' . $i] : (int)$tpl['itme'],
				'itms'    => isset($ndata['itms' . $i]) && $ndata['itms' . $i] !== '0' ? $ndata['itms' . $i] : (string)$tpl['itms'],
				'itmsk'   => isset($ndata['itmsk' . $i]) && $ndata['itmsk' . $i] !== '' ? $ndata['itmsk' . $i] : (string)$tpl['itmsk'],
				'itmpara' => $itmpara_arr,
				'itmid'   => $itmid,
			);
		} elseif (!empty($ndata[$itm_key])) {
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
				'itmid'   => $itmid,
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
		'ap'           => 10,
		'max_ap'       => 10,
		'pgroup'       => isset($ndata['pgroup']) ? (int)$ndata['pgroup'] : 0,
		'pls'          => isset($ndata['pls']) ? (int)$ndata['pls'] : 0,
		'lvl'          => isset($ndata['lvl']) ? (int)$ndata['lvl'] : 0,
		'exp'          => isset($ndata['exp']) ? (int)$ndata['exp'] : 0,
		'state'        => isset($ndata['state']) ? (int)$ndata['state'] : 0,
		// 装备字段（7 槽 × ID + 6 运行时字段）
		'wepid'        => isset($ndata['wepid']) ? $ndata['wepid'] : '',
		'wep'          => isset($ndata['wep']) ? $ndata['wep'] : '',
		'wepk'         => isset($ndata['wepk']) ? $ndata['wepk'] : '',
		'wepe'         => isset($ndata['wepe']) ? (int)$ndata['wepe'] : 0,
		'weps'         => isset($ndata['weps']) ? $ndata['weps'] : '0',
		'wepsk'        => isset($ndata['wepsk']) ? $ndata['wepsk'] : '',
		'weppara'      => isset($ndata['weppara']) ? $ndata['weppara'] : '',
		'wep2id'       => isset($ndata['wep2id']) ? $ndata['wep2id'] : '',
		'wep2'         => isset($ndata['wep2']) ? $ndata['wep2'] : '',
		'wep2k'        => isset($ndata['wep2k']) ? $ndata['wep2k'] : '',
		'wep2e'        => isset($ndata['wep2e']) ? (int)$ndata['wep2e'] : 0,
		'wep2s'        => isset($ndata['wep2s']) ? $ndata['wep2s'] : '0',
		'wep2sk'       => isset($ndata['wep2sk']) ? $ndata['wep2sk'] : '',
		'wep2para'     => isset($ndata['wep2para']) ? $ndata['wep2para'] : '',
		'arbid'        => isset($ndata['arbid']) ? $ndata['arbid'] : '',
		'arb'          => isset($ndata['arb']) ? $ndata['arb'] : '',
		'arbk'         => isset($ndata['arbk']) ? $ndata['arbk'] : '',
		'arbe'         => isset($ndata['arbe']) ? (int)$ndata['arbe'] : 0,
		'arbs'         => isset($ndata['arbs']) ? $ndata['arbs'] : '0',
		'arbsk'        => isset($ndata['arbsk']) ? $ndata['arbsk'] : '',
		'arbpara'      => isset($ndata['arbpara']) ? $ndata['arbpara'] : '',
		'arhid'        => isset($ndata['arhid']) ? $ndata['arhid'] : '',
		'arh'          => isset($ndata['arh']) ? $ndata['arh'] : '',
		'arhk'         => isset($ndata['arhk']) ? $ndata['arhk'] : '',
		'arhe'         => isset($ndata['arhe']) ? (int)$ndata['arhe'] : 0,
		'arhs'         => isset($ndata['arhs']) ? $ndata['arhs'] : '0',
		'arhsk'        => isset($ndata['arhsk']) ? $ndata['arhsk'] : '',
		'arhpara'      => isset($ndata['arhpara']) ? $ndata['arhpara'] : '',
		'araid'        => isset($ndata['araid']) ? $ndata['araid'] : '',
		'ara'          => isset($ndata['ara']) ? $ndata['ara'] : '',
		'arak'         => isset($ndata['arak']) ? $ndata['arak'] : '',
		'arae'         => isset($ndata['arae']) ? (int)$ndata['arae'] : 0,
		'aras'         => isset($ndata['aras']) ? $ndata['aras'] : '0',
		'arask'        => isset($ndata['arask']) ? $ndata['arask'] : '',
		'arapara'      => isset($ndata['arapara']) ? $ndata['arapara'] : '',
		'arfid'        => isset($ndata['arfid']) ? $ndata['arfid'] : '',
		'arf'          => isset($ndata['arf']) ? $ndata['arf'] : '',
		'arfk'         => isset($ndata['arfk']) ? $ndata['arfk'] : '',
		'arfe'         => isset($ndata['arfe']) ? (int)$ndata['arfe'] : 0,
		'arfs'         => isset($ndata['arfs']) ? $ndata['arfs'] : '0',
		'arfsk'        => isset($ndata['arfsk']) ? $ndata['arfsk'] : '',
		'arfpara'      => isset($ndata['arfpara']) ? $ndata['arfpara'] : '',
		'artid'        => isset($ndata['artid']) ? $ndata['artid'] : '',
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
		'skillpara'    => json_encode(array(
			'unarmed_strike' => array('lstact' => 0),
			'escape'         => array('lstact' => 0),
			'move'           => array('lstact' => 0),
			'heal'           => array('lstact' => 0),
			'whirlwind'      => array('lstact' => 0),
			'execute'        => array('lstact' => 0),
			'vampiric_bite'  => array('lstact' => 0),
			'grenade'        => array('lstact' => 0),
		), JSON_UNESCAPED_UNICODE),
		'oblpara'      => json_encode(array(), JSON_UNESCAPED_UNICODE),
		'discovered'   => 0,
	);

	$db->array_insert("{$tablepre}oblplayers", $obl_ndata);

	// 获取插入的 pid
	$result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE name = '" . $db->escape_string($obl_ndata['name']) . "' AND type = 0 ORDER BY pid DESC LIMIT 1");
	$row = $db->fetch_array($result);
	return $row ? (int)$row['pid'] : false;
}

