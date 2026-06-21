<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions NPC系统 主流程
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
include_once GAME_ROOT . './oblivions/include/game/ncp/npc.func.php';

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

// ================================================================
// 模块 2：NPC AI 结算
// ================================================================

/**
 * 全局结算敌人 AI（在 obl_resolve_tick_events 中调用）
 *
 * 两阶段处理（详见 游戏刻机制设计案.md 第四节）：
 *   阶段 1：战斗中 NPC 先攻轮（串行，最多 1 个）
 *     - 查询所有战斗中的玩家，检查先攻队列当前顺位者
 *     - 如果当前顺位者是 NPC，调用 battle_main 执行 NPC 先攻轮
 *     - 设置 $obl_tick_advanced = true，由 obl_resolve_tick_events 末尾推进 tick
 *   阶段 2：非战斗 NPC AI 行为（并行）
 *     - 只在阶段 1 没有执行 NPC 先攻轮时执行
 *     - 查询所有玩家，结算其所在区域的非战斗敌人 AI
 *
 * 循环模型：
 *   - NPC 先攻轮执行 → 末尾 obl_tick++ → 下次请求继续循环
 *   - 当前顺位者是玩家 → 不执行 NPC 先攻轮 → 不推进 obl_tick → 循环终止
 *
 * @return void
 */
function obl_resolve_all_enemy_ai() 
{
	global $db, $tablepre,$cuser;

	# 包含战斗系统主文件（阶段 1 会调用 battle_main）
	if (!function_exists('battle_main')) {
		include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
	}
	# 需要载入先攻队列
	//include_once GAME_ROOT . './oblivions/include/game/sql.func.php';

	$obl_tick_advanced = false;

	# NPC行为需要玩家数据
	$pdata = obl_fetch_playerdata_by_name($cuser);

	# 阶段 1：战斗中 NPC 先攻轮（串行，最多 1 个）

	# 载入先攻队列
	$result = $db->query("SELECT * FROM {$tablepre}oblqueue");
	$qdata = $db->fetch_array($result);

	# 存在先攻队列的情况下
	if($qdata)
	{
		$npc_battle_flag = false;
		while($qdata = $db->fetch_array($result))
		{
			//obl_format_playerdata($pdata);

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

			# 初始化 battle_log（入口处局部初始化，设置入口标识）
			if (!$obl_battle_log) {
				include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
				$obl_battle_log = new BattleLogCollector();
			}
			$obl_battle_log->setEntryType('npc_turn');

			# 构造 NPC 动作（MVP 固定 unarmed_strike，目标为玩家）
			$atk_act = array(
				array('act_id' => 'unarmed_strike', 'target' => $pdata['pid']),
			);

			# 调用 battle_main（内部会更新先攻队列）
			battle_main($npc_data, $atk_act, $obl_battle_log);

			$obl_tick_advanced = true;
			break;  # 最多处理 1 个 NPC 先攻轮
		}
	}

	# 阶段 2：非战斗 NPC AI 行为（并行）
	//$result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE type=0 AND state=0");
	$group = (int)$pdata['pgroup'];
	$enemies = obl_fetch_enemies_by_region($group);
	if (!empty($enemies))
	{
		foreach ($enemies as &$enemy) 
		{
			# 不处理在先攻队列内的敌人
			if($enemies['bid']) continue;
			# 处理其他敌人事件
			obl_enemy_tick($enemy, $pdata);
			# 敌人事件是否会推进tick
			if(isset($enemy['oblpara']['ambush_flag']))
			{
				//$obl_tick_advanced = true;
				unset($enemy['oblpara']['ambush_flag']);
				obl_save_player($enemy);
			}
			if(isset($enemy['oblpara']['collision_flag']))
			{
				$obl_tick_advanced = true;
				unset($enemy['oblpara']['collision_flag']);
				obl_save_player($enemy);
			}
		}
	}
	return $obl_tick_advanced;
}

/**
 * 单个敌人的 AI 决策和行动
 *
 * @param array &$enemy  敌人数据（已格式化）
 * @param array &$player 当前玩家数据（引用传递，突袭时会修改）
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

	$ai_type = isset($enemy['oblpara']['ai_type']) ? $enemy['oblpara']['ai_type'] : 'idle';
	$vision_range = isset($enemy['oblpara']['vision_range'])
		? (int)$enemy['oblpara']['vision_range'] : 3;

	// 检查与玩家距离（同区域才有意义）
	$should_chase = false;
	$distance = -1;
	if ($enemy['pgroup'] == $player['pgroup']) {
		$distance = obl_get_distance($enemy['pgroup'], $enemy['pls'], $player['pls']);
		if ($distance >= 0 && $distance <= $vision_range) {
			$should_chase = true;
		}
	}

	# NPC 突袭逻辑：未被发现 + 有偷袭倾向 + 在突袭范围内（distance <= 1，近战范围）
	//if ($should_chase && $distance <= 1 && empty($enemy['discovered'])) {
	if ($should_chase && $distance <= 1) {
		if (in_array($ai_type, array('aggressive', 'ambush'))) {
			obl_enemy_ambush_player($enemy, $player);
			return;
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

/**
 * NPC 突袭玩家（战斗入口2）
 *
 * NPC 未被发现 + 有偷袭倾向 → 突袭玩家。
 * 流程：设置突袭标记 → battle_state_init → 构造动作 → battle_main。
 * 突袭不创建先攻队列，直接动手打一次，由 battle_main 尾部的 battle_queue_check 后补票创建队列。
 * NPC 先攻轮不推进 tick（由 obl_resolve_tick_events 末尾推进）。
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 玩家数据
 * @return void
 */
function obl_enemy_ambush_player(&$enemy, &$player)
{
	global $obl_battle_log;

	# 初始化 battle_log（入口处局部初始化，设置入口标识）
	if (!$obl_battle_log) {
		include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
		$obl_battle_log = new BattleLogCollector();
	}
	$obl_battle_log->setEntryType('npc_ambush');

	# 设置突袭标记
	$enemy['oblpara']['ambush_flag'] = true;

	# NPC 进入战斗状态
	battle_state_init($enemy);

	# 构造动作（unarmed_strike，目标为玩家 pid）
	$atk_act = array(
		array('act_id' => 'unarmed_strike', 'target' => $player['pid']),
	);

	# 调用 battle_main（内部会完成后补票创建先攻队列）
	battle_main($enemy, $atk_act, $obl_battle_log);
}

/**
 * 追击玩家：计算向玩家移动的下一步
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据
 * @return void
 */
function obl_enemy_chase_player(&$enemy, &$player)
{
	$next_pls = obl_calc_next_step_towards($enemy['pgroup'], $enemy['pls'], $player['pls']);
	if ($next_pls !== false) {
		obl_enemy_move($enemy, $next_pls, $player);
		// 如果移动失败且玩家在目标格，obl_enemy_move 内部已处理突袭
	}
}
