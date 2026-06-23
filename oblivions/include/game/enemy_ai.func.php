<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions NPC 敌人系统：生成 + AI 行为
//
// 设计原则：
// - NPC AI 独立实现，不调用旧模式 bot_acts，参考其逻辑但用 Oblivions 兼容的函数
// - NPC 数据与玩家同构，统一存 bra_oblplayers 表，通过 type 字段区分
// - NPC AI 通过 tick 监听器机制接入，玩家数据从调度上下文 $ctx['player'] 获取
// - NPC 可以在雾中自由移动（不受 fog 限制）
// - MVP 只结算当前玩家所在区域的敌人
//
// 模块结构：
// - 模块 1：NPC 生成（obl_init_enemies 等）
// - 模块 2：Tick 事件监听器（obl_tick_phase_battle_npc / obl_tick_phase_idle_npc）
// - 模块 3：移动逻辑（obl_enemy_move / obl_enemy_patrol / obl_enemy_hunt）
// - 模块 4：discovered 状态管理
// - 模块 5：占用检查与辅助函数
//
// 依赖：
// - move.func.php（obl_get_map_data / obl_get_distance）
// - player.func.php（obl_fetch_enemies_by_region / obl_fetch_playerdata_by_pid /
//                   obl_format_playerdata / obl_save_player）
// - tick.func.php（obl_tick_request_advance，仅监听器需要）
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
	global $db, $tablepre, $obl_enemies_config, $obl_error_log;

	// 载入敌人配置（按需）
	if (!isset($obl_enemies_config)) {
		include GAME_ROOT . './oblivions/gamedata/enemies_config.php';
	}

	$config = isset($obl_enemies_config[$enemy_type]) ? $obl_enemies_config[$enemy_type] : null;
	if (!$config) {
		// 敌人配置缺失属于系统级异常（敌人 NPC 已生成但配置被删），
		// 记录到错误日志，前端可通过 ?action=obl_error 感知
		if (isset($obl_error_log) && $obl_error_log) {
			$obl_error_log->emit('enemy_ai.config_missing', array(
				'enemy_type' => $enemy_type,
				'pgroup'     => $pgroup,
				'pls'        => $pls,
			), 'api');
		}
		return false;
	}

	$itemmaxslots = 6;
	$empty_itempara = array_fill(0, $itemmaxslots + 1, null);  // index 0=特殊槽，1-6=普通槽

	# 构造 skillpara 新格式：{"skill_id": {"lstact": 0}, ...}
	$skillpara_init = array();
	foreach ($config['skills'] as $skill_id) {
		$skillpara_init[$skill_id] = array('lstact' => 0);
	}

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
		'ap'     => 10,
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
		'skillpara' => json_encode($skillpara_init, JSON_UNESCAPED_UNICODE),
		'oblpara'   => json_encode(array(
			'ai_type'       => $config['ai_type'],
			'vision_range'  => $config['vision_range'],
			'action_chance' => $config['action_chance'],
			'combat_skills' => isset($config['combat_skills']) ? $config['combat_skills'] : array('unarmed_strike'),
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
// 模块 2：Tick 事件监听器
// ================================================================
// 两个内置监听器，由 tick.func.php 末尾集中注册：
//   - obl_tick_phase_battle_npc：battle_npc phase，战斗中 NPC 先攻轮
//   - obl_tick_phase_idle_npc  ：idle_npc phase，非战斗 NPC AI 行为
//
// 监听器签名：function(int $delta, array &$ctx): void
//   $ctx = ['player' => &$pdata, 'advanced' => bool]

/**
 * 监听器：战斗中 NPC 先攻轮（battle_npc phase）
 *
 * 查询所有活跃先攻队列，若当前顺位者是 NPC，执行 NPC 先攻轮。
 * 执行后调用 obl_tick_request_advance() 请求推进 tick。
 * 最多处理 1 个 NPC 先攻轮（串行语义，由调度器 break 保证）。
 *
 * 循环模型：
 *   - NPC 先攻轮执行 → 请求推进 → 调度器末尾 obl_tick++ → 下次请求继续循环
 *   - 当前顺位者是玩家 → 不执行 → 不推进 → 循环终止
 *
 * @param int   $delta 待处理的 tick 差值
 * @param array &$ctx  调度上下文
 * @return void
 */
function obl_tick_phase_battle_npc($delta, &$ctx) {
	global $db, $tablepre, $obl_battle_log;

	# 加载战斗系统主文件
	if (!function_exists('battle_main')) {
		include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
	}

	# 载入所有活跃的先攻队列 qid（DISTINCT 去重，避免同队列多记录重复处理）
	$result = $db->query("SELECT DISTINCT qid FROM {$tablepre}oblqueue WHERE qid > 0");

	while ($qdata = $db->fetch_array($result)) {
		$qid = (int)$qdata['qid'];
		if ($qid <= 0) continue;

		# 获取当前顺位者（myorder 最小且 done=0）
		$current = obl_fetch_queue_current_initiator($qid);
		if (!$current) continue;

		# 当前顺位者是玩家 → 不执行 NPC 先攻轮（等待玩家提交 obl_battle_action）
		if ($current['type'] == 0) continue;

		# 当前顺位者是 NPC → 执行 NPC 先攻轮
		$npc_data = obl_fetch_playerdata_by_pid($current['pid']);
		if (!$npc_data) continue;

		# 初始化 battle_log（入口处局部初始化）
		if (!$obl_battle_log) {
			include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
			$obl_battle_log = new BattleLogCollector();
		}

		# 构造 NPC 动作（从 oblpara['combat_skills'] 中选择可用技能）
		$atk_act = obl_ai_select_combat_action($npc_data, $ctx['player']['pid']);

		# 调用 battle_main（内部会更新先攻队列）
		battle_main($npc_data, $atk_act, $obl_battle_log);

		# 请求推进 tick（由调度器末尾统一推进，替代旧的 $obl_tick_advanced 引用传递）
		obl_tick_request_advance();
		break;  # 最多处理 1 个 NPC 先攻轮
	}
}

/**
 * 监听器：非战斗 NPC AI 行为（idle_npc phase）
 *
 * 结算当前玩家所在区域的非战斗敌人 AI（移动/巡逻）。
 * 战斗中的敌人跳过（由战斗系统接管）。
 *
 * 注意：obl_enemy_tick 内部通过 obl_enemy_move 自行保存敌人数据，
 * 此处不再重复调用 obl_save_player。
 *
 * @param int   $delta 待处理的 tick 差值
 * @param array &$ctx  调度上下文
 * @return void
 */
function obl_tick_phase_idle_npc($delta, &$ctx) {
	$player = &$ctx['player'];
	$group = (int)$player['pgroup'];
	$enemies = obl_fetch_enemies_by_region($group);
	if (empty($enemies)) return;

	foreach ($enemies as &$enemy) {
		# 战斗中的敌人跳过（由战斗系统接管）
		if ($enemy['bid']) continue;
		# 结算非战斗敌人 AI
		obl_enemy_tick($enemy, $player);
	}
}
/**
 * 单个敌人的 AI 决策和行动
 *
 * 行动流程：
 *   1. 死亡/战斗中 → 跳过
 *   2. 行动意愿门控（action_chance 随机判定）
 *   3. 根据 ai_type 执行行为（patrol/aggressive/idle）
 *
 * TODO（待重新实现）：
 *   - 追击（chase）：玩家进入视野时主动靠近
 *   - 突袭（ambush）：未被发现时偷袭玩家
 *   - 碰撞战斗（collision）：移动到玩家格触发遭遇战
 * 这些机制依赖 tick 框架重构后的新设计，当前仅保留巡逻/发呆。
 *
 * @param array &$enemy  敌人数据（已格式化）
 * @param array &$player 当前玩家数据
 * @return void
 */
function obl_enemy_tick(&$enemy, &$player)
{
	// 死亡敌人不行动
	if ($enemy['state'] > 0) return;

	// 战斗中的敌人不参与 tick 结算（由战斗系统接管行动）
	if ($enemy['action'] == 'battle') return;

	// 行动意愿门控：随机数决定这个 tick 要不要行动
	$action_chance = isset($enemy['oblpara']['action_chance'])
		? (float)$enemy['oblpara']['action_chance'] : 0.5;
	if (mt_rand() / mt_getrandmax() > $action_chance) return;

	// 根据 AI 类型行动
	// TODO: 追击/突袭/碰撞战斗机制待 tick 框架重构后重新实现
	$ai_type = isset($enemy['oblpara']['ai_type']) ? $enemy['oblpara']['ai_type'] : 'idle';
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

/**
 * AI 战斗技能选择
 *
 * 从 oblpara['combat_skills'] 中选择第一个可用技能（CD 未锁定、AP 足够）。
 * 根据技能配置的 target 字段决定目标：self → NPC 自身 pid，其他 → 传入的 target_pid。
 * 若无可用技能，回退到 unarmed_strike。
 *
 * @param array &$npc_data   NPC 数据
 * @param int   $target_pid  默认目标 pid（玩家）
 * @return array 动作数组 [['act_id' => skill_id, 'target' => pid], ...]
 */
function obl_ai_select_combat_action(&$npc_data, $target_pid) {
	include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';

	# 读取战斗技能偏好列表
	$combat_skills = isset($npc_data['oblpara']['combat_skills'])
		? $npc_data['oblpara']['combat_skills']
		: array('unarmed_strike');
	if (!is_array($combat_skills) || empty($combat_skills)) {
		$combat_skills = array('unarmed_strike');
	}

	# 遍历偏好列表，选择第一个可用技能
	$selected_skill = null;
	foreach ($combat_skills as $skill_id) {
		if (skill_is_usable($npc_data, $skill_id)) {
			$selected_skill = $skill_id;
			break;
		}
	}

	# 无可用技能时回退到 unarmed_strike
	if ($selected_skill === null) {
		$selected_skill = 'unarmed_strike';
	}

	# 根据技能配置决定目标
	$config = skill_get_config($selected_skill);
	$target = ($config && isset($config['target']) && $config['target'] === 'self')
		? (int)$npc_data['pid']
		: (int)$target_pid;

	return array(
		array('act_id' => $selected_skill, 'target' => $target),
	);
}

// ================================================================
// 模块 3：移动逻辑
// ================================================================

/**
 * 敌人移动（参考 obl_move 但适配敌人）
 *
 * NPC 可以在雾中自由移动（不受 fog 限制）。
 *
 * @param array &$enemy     敌人数据
 * @param int   $target_pls 目标格 pls
 * @param array &$player    当前玩家数据
 * @return bool 移动是否成功
 */
function obl_enemy_move(&$enemy, $target_pls, &$player) {
	// 校验目标格 passable
	$map = obl_get_map_data($enemy['pgroup']);
	$tiles = $map['tiles'][$enemy['pgroup']];
	if (!isset($tiles[$target_pls]) || empty($tiles[$target_pls]['passable'])) {
		return false;
	}

	// 目标格是玩家所在格 → 不移动
	// TODO: 碰撞战斗机制待 tick 框架重构后重新实现
	if ($player['pgroup'] == $enemy['pgroup'] && $player['pls'] == $target_pls) {
		return false;
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
// 模块 4：discovered 状态管理
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
// 模块 5：占用检查与辅助函数
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
