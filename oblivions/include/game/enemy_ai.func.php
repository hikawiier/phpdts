<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions NPC 敌人系统：生成 + AI 行为
//
// 设计原则：
// - NPC AI 独立实现，不调用旧模式 bot_acts，参考其逻辑但用 Oblivions 兼容的函数
// - NPC 数据与玩家同构，统一存 bra_oblplayers 表，通过 type 字段区分
// - NPC AI 不依赖"当前请求的玩家"，在 tick 结算入口从数据库查询玩家数据
// - NPC 可以在雾中自由移动（不受 fog 限制）
// - MVP 只结算当前区域的敌人
//
// 依赖：
// - move.func.php（obl_get_map_data / obl_get_distance）
// - player.func.php（obl_fetch_enemies_by_region / obl_fetch_playerdata_by_pid /
//                   obl_format_playerdata / obl_save_player）
// - explore.func.php（obl_clear_fog，仅 obl_discover_enemies 需要）
// ================================================================

if (!function_exists('obl_get_map_data')) {
	include_once GAME_ROOT . './oblivions/include/game/move.func.php';
}
if (!function_exists('obl_fetch_enemies_by_region')) {
	include_once GAME_ROOT . './oblivions/include/game/player.func.php';
}

// ================================================================
// 模块 1：NPC 生成
// ================================================================

/**
 * 生成所有区域的 NPC 敌人（在 rs_init_oblivions 中调用）
 *
 * 按 enemy_pool.php 配置，在每个区域的对应潮汐区格上生成敌人。
 * 生成规则：
 * - 只选 passable=1 的格
 * - 排除区域出入口（entrance_pls / exit_pls）
 * - 排除已被其他单位占用的格（一个格一个单位）
 * - 敌人只生成在对应潮汐区的格上
 *
 * @return void
 */
function obl_init_enemies() {
	global $db, $tablepre;

	// 载入敌人配置和生成池
	$enemy_pool = require GAME_ROOT . './oblivions/gamedata/enemy_pool.php';

	// 获取所有区域
	$map = obl_get_map_data();
	$regions = $map['regions'];

	foreach ($regions as $pgroup => $region) {
		$pgroup = (int)$pgroup;

		// 加载该区域的 tiles（含 tide 字段）
		$map_data = obl_get_map_data($pgroup);
		$tiles = $map_data['tiles'][$pgroup];

		// 统计该区域各潮汐区的格数，按潮汐区分组
		$tide_tiles = array('shallow' => array(), 'deep' => array(), 'abyss' => array());
		foreach ($tiles as $pls => $tile) {
			$tide = isset($tile['tide']) ? $tile['tide'] : 'shallow';
			if (!empty($tile['passable']) && isset($tide_tiles[$tide])) {
				$tide_tiles[$tide][] = (int)$pls;
			}
		}

		// 查询该区域已占用的位置（玩家初始位置 + 已生成的 NPC）
		$occupied = obl_get_occupied_positions($pgroup);

		// 排除出入口
		$occupied[(int)$region['entrance_pls']] = true;
		$occupied[(int)$region['exit_pls']] = true;

		// 按潮汐区生成敌人
		foreach ($tide_tiles as $tide => $available_pls) {
			if (!isset($enemy_pool[$tide]) || empty($available_pls)) continue;

			foreach ($enemy_pool[$tide] as $entry) {
				$enemy_type = (int)$entry['enemy_type'];
				$count = is_array($entry['count'])
					? rand($entry['count'][0], $entry['count'][1])
					: (int)$entry['count'];

				for ($i = 0; $i < $count; $i++) {
					// 从可用格中随机选一个未被占用的
					$pls = obl_pick_available_tile($available_pls, $occupied);
					if ($pls === false) break;  // 该潮汐区格不够

					obl_create_enemy_record($enemy_type, $pgroup, $pls);
					$occupied[$pls] = true;  // 标记占用
				}
			}
		}
	}
}

/**
 * 创建敌人记录（参考 obl_create_player_record 的实现模式）
 *
 * @param int $enemy_type 敌人类型 ID（对应 enemies_config.php 的 key）
 * @param int $pgroup     区域 ID
 * @param int $pls        格子 ID
 * @return int|false 返回新创建的 pid，失败返回 false
 */
function obl_create_enemy_record($enemy_type, $pgroup, $pls) {
	global $db, $tablepre, $obl_enemies_config;

	// 载入敌人配置（按需）
	if (!isset($obl_enemies_config)) {
		include GAME_ROOT . './oblivions/gamedata/enemies_config.php';
	}

	$config = isset($obl_enemies_config[$enemy_type]) ? $obl_enemies_config[$enemy_type] : null;
	if (!$config) return false;

	$itemmaxslots = 6;
	$empty_itempara = array_fill(0, $itemmaxslots + 1, null);  // index 0=特殊槽，1-6=普通槽

	$enemy = array(
		'type'   => $enemy_type,
		'name'   => $config['name'],
		'pass'   => '',
		'gd'     => $config['gd'],
		'icon'   => $config['icon'],
		'action' => '',
		'bid'    => 0,
		'hp'     => $config['hp'],
		'mhp'    => $config['mhp'],
		'sp'     => $config['sp'],
		'msp'    => $config['msp'],
		'att'    => $config['att'],
		'def'    => $config['def'],
		'ap'     => 0,
		'max_ap' => 10,
		'pgroup' => $pgroup,
		'pls'    => $pls,
		'lvl'    => $config['lvl'],
		'exp'    => 0,
		'state'  => 0,
		// 装备字段（7 槽 × 6 字段，初始全空）
		'wep' => '', 'wepk' => '', 'wepe' => 0, 'weps' => '0', 'wepsk' => '', 'weppara' => '',
		'wep2' => '', 'wep2k' => '', 'wep2e' => 0, 'wep2s' => '0', 'wep2sk' => '', 'wep2para' => '',
		'arb' => '', 'arbk' => '', 'arbe' => 0, 'arbs' => '0', 'arbsk' => '', 'arbpara' => '',
		'arh' => '', 'arhk' => '', 'arhe' => 0, 'arhs' => '0', 'arhsk' => '', 'arhpara' => '',
		'ara' => '', 'arak' => '', 'arae' => 0, 'aras' => '0', 'arask' => '', 'arapara' => '',
		'arf' => '', 'arfk' => '', 'arfe' => 0, 'arfs' => '0', 'arfsk' => '', 'arfpara' => '',
		'art' => '', 'artk' => '', 'arte' => 0, 'arts' => '0', 'artsk' => '', 'artpara' => '',
		// 道具栏
		'itempara'     => json_encode($empty_itempara, JSON_UNESCAPED_UNICODE),
		'itemmaxslots' => $itemmaxslots,
		// Oblivions 专属 JSON 字段
		'tacpara'   => json_encode(array('slots' => $config['strategy_slots']), JSON_UNESCAPED_UNICODE),
		'skillpara' => json_encode(array('skills' => $config['skills']), JSON_UNESCAPED_UNICODE),
		'oblpara'   => json_encode(array(
			'ai_type'       => $config['ai_type'],
			'vision_range'  => $config['vision_range'],
			'action_chance' => $config['action_chance'],
		), JSON_UNESCAPED_UNICODE),
		'discovered' => 0,
	);

	$db->array_insert("{$tablepre}oblplayers", $enemy);

	// 获取插入的 pid
	$result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE type='{$enemy_type}' AND pgroup='{$pgroup}' AND pls='{$pls}' ORDER BY pid DESC LIMIT 1");
	$row = $db->fetch_array($result);
	return $row ? (int)$row['pid'] : false;
}

/**
 * 获取指定区域所有已占用的 pls（玩家 + NPC）
 *
 * @param int $pgroup 区域 ID
 * @return array {pls => true} 已占用的格集合
 */
function obl_get_occupied_positions($pgroup) {
	global $db, $tablepre;
	$occupied = array();
	$result = $db->query("SELECT pls FROM {$tablepre}oblplayers WHERE pgroup='{$pgroup}' AND state=0");
	while ($row = $db->fetch_array($result)) {
		$occupied[(int)$row['pls']] = true;
	}
	return $occupied;
}

/**
 * 从可用格列表中随机选一个未被占用的
 *
 * @param array $available_pls 可用格 pls 列表
 * @param array &$occupied     已占用格集合（引用传递，选中后会被标记）
 * @return int|false 选中的 pls，无可用格返回 false
 */
function obl_pick_available_tile($available_pls, &$occupied) {
	$candidates = array();
	foreach ($available_pls as $pls) {
		if (!isset($occupied[$pls])) {
			$candidates[] = $pls;
		}
	}
	if (empty($candidates)) return false;
	return $candidates[array_rand($candidates)];
}

// ================================================================
// 模块 2：NPC AI 结算
// ================================================================

/**
 * 全局结算敌人 AI（在 obl_resolve_tick_events 中调用）
 *
 * MVP 只结算有玩家存在的区域。从数据库查询所有玩家（type=0），
 * 逐个结算其所在区域的敌人。玩家进入战斗状态后中断该区域的循环。
 *
 * 注意：tick 结算在 common.inc.php 中执行，此时无 $pdata 上下文，
 * 因此本函数自行从数据库查询玩家数据，不依赖请求参数。
 *
 * @return void
 */
function obl_resolve_all_enemy_ai() {
	global $db, $tablepre;

	// 查询所有玩家（type=0），结算其所在区域的敌人 AI
	$result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE type=0 AND state=0");
	while ($pdata = $db->fetch_array($result)) {
		obl_format_playerdata($pdata);
		$pgroup = (int)$pdata['pgroup'];

		// 获取该区域所有敌人
		$enemies = obl_fetch_enemies_by_region($pgroup);
		if (empty($enemies)) continue;

		foreach ($enemies as &$enemy) {
			// 玩家已进入战斗状态 → 中断循环
			// TODO: 未来引入先攻队列系统后，对多个目标的行动顺序排序后依序结算
			if ($pdata['action'] == 'battle') break;

			obl_enemy_tick($enemy, $pdata);
		}
	}
}

/**
 * 单个敌人的 AI 决策和行动
 *
 * @param array &$enemy  敌人数据（已格式化）
 * @param array &$player 当前玩家数据（引用传递，突袭时会修改）
 * @return void
 */
function obl_enemy_tick(&$enemy, &$player) {
	// 死亡敌人不行动
	if ($enemy['state'] > 0) return;

	// 行动意愿门控：随机数决定这个 tick 要不要行动
	$action_chance = isset($enemy['oblpara']['action_chance'])
		? (float)$enemy['oblpara']['action_chance'] : 0.5;
	if (mt_rand() / mt_getrandmax() > $action_chance) return;

	$ai_type = isset($enemy['oblpara']['ai_type']) ? $enemy['oblpara']['ai_type'] : 'idle';
	$vision_range = isset($enemy['oblpara']['vision_range'])
		? (int)$enemy['oblpara']['vision_range'] : 3;

	// 检查与玩家距离（同区域才有意义）
	$should_chase = false;
	if ($enemy['pgroup'] == $player['pgroup']) {
		$distance = obl_get_distance($enemy['pgroup'], $enemy['pls'], $player['pls']);
		if ($distance > 0 && $distance <= $vision_range) {
			// 玩家在感知范围内 → 追击
			$should_chase = true;
		}
	}

	if ($should_chase) {
		obl_enemy_chase_player($enemy, $player);
		return;
	}

	// 玩家不在感知范围 → 根据 AI 类型行动
	switch ($ai_type) {
		case 'patrol':
			obl_enemy_patrol($enemy, $player);
			break;
		case 'aggressive':
			obl_enemy_hunt($enemy, $player);  // MVP 简化为巡逻
			break;
		case 'idle':
		default:
			// 发呆，不行动
			break;
	}
}

// ================================================================
// 模块 3：移动逻辑
// ================================================================

/**
 * 敌人移动（参考 obl_move 但适配敌人）
 *
 * NPC 可以在雾中自由移动（不受 fog 限制）。
 * 移动到玩家所在格时触发突袭。
 *
 * @param array &$enemy     敌人数据
 * @param int   $target_pls 目标格 pls
 * @param array &$player    当前玩家数据（引用传递，突袭时会修改）
 * @return bool 移动是否成功（突袭不算成功移动）
 */
function obl_enemy_move(&$enemy, $target_pls, &$player) {
	// 校验目标格 passable
	$map = obl_get_map_data($enemy['pgroup']);
	$tiles = $map['tiles'][$enemy['pgroup']];
	if (!isset($tiles[$target_pls]) || empty($tiles[$target_pls]['passable'])) {
		return false;
	}

	// 校验目标格是否是玩家所在格 → 碰撞战斗
	if ($player['pgroup'] == $enemy['pgroup'] && $player['pls'] == $target_pls) {
		obl_resolve_collision_battle($enemy, $player);
		return false;  // 碰撞：双方留在原地，敌人不移动
	}

	// 校验目标格未被其他单位占用（一个格一个单位）
	if (obl_is_tile_occupied_by_others($enemy['pgroup'], $target_pls, $enemy['pid'])) {
		return false;
	}

	// 正常移动
	$enemy['pls'] = $target_pls;

	// 更新 discovered 状态
	obl_update_enemy_discovered($enemy, $player);

	// 保存到数据库
	obl_save_player($enemy);

	// 如果敌人在玩家视野内，emit 移动日志（迷雾中的移动不对玩家可见）
	if ($enemy['discovered'] == 1) {
		global $obl_log;
		$obl_log->emit('enemy.move', 'enemy', array(
			'enemy_name' => $enemy['name'],
			'enemy_pid'  => $enemy['pid'],
			'to_pls'     => $target_pls,
		));
	}

	return true;
}

/**
 * 追击玩家：计算向玩家移动的下一步
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据
 * @return void
 */
function obl_enemy_chase_player(&$enemy, &$player) {
	$next_pls = obl_calc_next_step_towards($enemy['pgroup'], $enemy['pls'], $player['pls']);
	if ($next_pls !== false) {
		obl_enemy_move($enemy, $next_pls, $player);
		// 如果移动失败且玩家在目标格，obl_enemy_move 内部已处理突袭
	}
}

/**
 * 巡逻：随机选一个邻居格移动
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据（obl_enemy_move 签名需要）
 * @return void
 */
function obl_enemy_patrol(&$enemy, &$player) {
	$neighbors = obl_get_tile_neighbors($enemy['pgroup'], $enemy['pls']);
	if (empty($neighbors)) return;

	$target_pls = $neighbors[array_rand($neighbors)];
	obl_enemy_move($enemy, $target_pls, $player);
}

/**
 * 主动搜寻（MVP 简化为巡逻）
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据
 * @return void
 */
function obl_enemy_hunt(&$enemy, &$player) {
	obl_enemy_patrol($enemy, $player);
}

// ================================================================
// 模块 4：碰撞战斗（过渡实现）
// ================================================================

/**
 * 碰撞战斗结算（过渡实现）
 *
 * 两个单位因移动目标格冲突而碰撞，进入战斗状态。
 * 核心机制：1 格 1 单位 → 双方都留在原地，不实际移动。
 *
 * 当前为过渡实现：设置双方 action='battle' → emit 日志 → 立即清除 action/bid。
 * 战斗系统实装后替换为真正的战斗结算（此处只保留碰撞检测 + 调用入口）。
 *
 * @param array &$a 单位 A（玩家或敌人，引用传递）
 * @param array &$b 单位 B（玩家或敌人，引用传递）
 * @return void
 */
function obl_resolve_collision_battle(&$a, &$b) {
	global $obl_log;

	// 双方进入战斗状态（规范化流程：即使过渡实现也走完整 action 生命周期）
	$a['action'] = 'battle';
	$a['bid']    = $b['pid'];
	$b['action'] = 'battle';
	$b['bid']    = $a['pid'];

	// 交火后互相可见
	$a['discovered'] = 1;
	$b['discovered'] = 1;

	obl_save_player($a);
	obl_save_player($b);

	// emit 结构化日志：碰撞战斗（$a 永远是发起方/移动方，通过 type 判定玩家身份）
	$a_is_player = ($a['type'] == 0);
	$obl_log->emit('battle.skirmish', 'battle', array(
		'enemy_name' => $a_is_player ? $b['name'] : $a['name'],
		'enemy_pid'  => $a_is_player ? $b['pid']  : $a['pid'],
		'initiator'  => $a_is_player ? 'player' : 'enemy',
	));

	// 立即清除战斗状态（过渡实现：战斗瞬间结束，不卡住流程）
	$a['action'] = '';
	$a['bid']    = 0;
	$b['action'] = '';
	$b['bid']    = 0;

	obl_save_player($a);
	obl_save_player($b);
}

// ================================================================
// 模块 5：discovered 状态管理
// ================================================================

/**
 * 玩家探索时发现敌人（在 obl_explore 中调用）
 *
 * 检查玩家视野内的敌人，设 discovered=1，并清除敌人所在格的迷雾。
 * 发现新敌人时 emit 结构化日志。
 *
 * @param int $player_pgroup 玩家所在区域
 * @param int $player_pls    玩家所在格
 * @param int $vision_range  玩家视野范围
 * @return void
 */
function obl_discover_enemies($player_pgroup, $player_pls, $vision_range) {
	global $obl_log;

	$enemies = obl_fetch_enemies_by_region($player_pgroup);
	foreach ($enemies as &$enemy) {
		// 死亡敌人不更新 discovered（保留原状态供搜刮）
		if ($enemy['state'] > 0) continue;

		$distance = obl_get_distance($player_pgroup, $player_pls, $enemy['pls']);
		if ($distance >= 0 && $distance <= $vision_range && $enemy['discovered'] == 0) {
			$enemy['discovered'] = 1;
			obl_save_player($enemy);

			// 发现敌人时清除该格迷雾（玩家"感知"到敌人位置）
			if (function_exists('obl_clear_fog')) {
				obl_clear_fog($player_pgroup, array($enemy['pls'] => array('distance' => $distance)));
			}

			// emit 结构化日志：发现敌人
			$obl_log->emit('enemy.discovered', 'enemy', array(
				'enemy_name' => $enemy['name'],
				'enemy_pid'  => $enemy['pid'],
			));
		}
	}
}

/**
 * 敌人移动后更新 discovered 状态
 *
 * 超出玩家视野 → discovered=0（静默移除，不 emit 日志）
 * 仍在玩家视野内 → 清除该格迷雾（确保前端可见）
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据
 * @return void
 */
function obl_update_enemy_discovered(&$enemy, &$player) {
	// 死亡敌人不更新 discovered
	if ($enemy['state'] > 0) return;

	// 不同区域 → 未发现
	if ($enemy['pgroup'] != $player['pgroup']) {
		$enemy['discovered'] = 0;
		return;
	}

	// 超出玩家视野 → 未发现（静默移除）
	$distance = obl_get_distance($enemy['pgroup'], $enemy['pls'], $player['pls']);
	$player_vision = obl_get_player_vision_range($player);
	if ($distance < 0 || $distance > $player_vision) {
		$enemy['discovered'] = 0;
	} else {
		// 敌人在玩家视野内，清除该格迷雾（确保前端可见）
		if (!function_exists('obl_clear_fog')) {
			include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
		}
		if (function_exists('obl_clear_fog')) {
			obl_clear_fog($enemy['pgroup'], array($enemy['pls'] => array('distance' => $distance)));
		}
	}
}

// ================================================================
// 模块 6：占用检查与辅助函数
// ================================================================

/**
 * 检查地图格是否被其他单位占用
 *
 * @param int $pgroup      区域 ID
 * @param int $pls         格子 ID
 * @param int $exclude_pid 排除的 pid（避免检查自己）
 * @return bool 是否被占用
 */
function obl_is_tile_occupied_by_others($pgroup, $pls, $exclude_pid) {
	global $db, $tablepre;
	$result = $db->query("SELECT pid FROM {$tablepre}oblplayers
	                      WHERE pgroup='{$pgroup}' AND pls='{$pls}' AND state=0
	                      AND pid != '{$exclude_pid}' LIMIT 1");
	return $db->num_rows($result) > 0;
}

/**
 * 计算向目标移动的下一步（选距离目标最近的邻居格）
 *
 * @param int $pgroup   区域 ID
 * @param int $from_pls 起点格
 * @param int $to_pls   终点格
 * @return int|false 下一步的 pls，无可行路径返回 false
 */
function obl_calc_next_step_towards($pgroup, $from_pls, $to_pls) {
	$neighbors = obl_get_tile_neighbors($pgroup, $from_pls);
	if (empty($neighbors)) return false;

	$min_dist = PHP_INT_MAX;
	$best_pls = false;
	foreach ($neighbors as $neighbor_pls) {
		$dist = obl_get_distance($pgroup, $neighbor_pls, $to_pls);
		if ($dist >= 0 && $dist < $min_dist) {
			$min_dist = $dist;
			$best_pls = $neighbor_pls;
		}
	}
	return $best_pls;
}

/**
 * 获取地图格的邻居列表
 *
 * @param int $pgroup 区域 ID
 * @param int $pls    格子 ID
 * @return array 邻居格 pls 列表
 */
function obl_get_tile_neighbors($pgroup, $pls) {
	$map = obl_get_map_data($pgroup);
	$tiles = $map['tiles'][$pgroup];
	if (!isset($tiles[$pls])) return array();
	return isset($tiles[$pls]['neighbors']) ? $tiles[$pls]['neighbors'] : array();
}

/**
 * 获取玩家视野范围（MVP 固定值，未来可基于属性计算）
 *
 * 用于敌人 discovered 状态管理（敌人移动后判断是否仍在玩家视野内）。
 * 注意：此值大于 obl_config.php 的 vision_range（迷雾清除范围），
 * 代表玩家能"感知"到更远处的敌人气息。
 *
 * @param array &$player 玩家数据
 * @return int 视野范围（BFS 跳数）
 */
function obl_get_player_vision_range(&$player) {
	// MVP 阶段固定值，未来可基于属性/装备/技能计算
	return 3;
}
