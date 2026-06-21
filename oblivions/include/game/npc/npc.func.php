<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions NPC系统 功能组件
// ================================================================

include_once GAME_ROOT . './oblivions/include/game/ncp/npc.calc.php';

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
	if ($player['pgroup'] == $enemy['pgroup'] && $player['pls'] == $target_pls) 
	{
		//$enemy['oblpara']['collision_flag'] = true;
		//obl_resolve_collision_battle($enemy, $player);
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
// 模块 4：碰撞战斗（遭遇战 3C 入口）
// ================================================================

/**
 * 遭遇战 3C 入口（碰撞战斗）
 *
 * 两个单位因移动目标格冲突而碰撞，进入战斗状态。
 * 核心机制：1 格 1 单位 → 双方留在原地，不实际移动。
 *
 * 根据双方 bid 状态分支处理：
 *  - 双方都不在队列中（bid=0）：创建新先攻队列
 *  - 一方已在队列中（bid>0）：另一方加入该队列，排入末尾（done=0）
 *  - 双方在同一队列中（bid 相同）：无需操作（兜底）
 *  - 双方在不同队列中（bid 不同且都>0）：$a 退出原队列加入 $b 的队列（兜底，正常不应发生）
 *
 * 不调用 battle_main，不推进 tick。
 * 下次请求时，obl_resolve_all_enemy_ai 阶段 1 会检测先攻队列：
 *   - 当前顺位者是 NPC → 执行 NPC 先攻轮
 *   - 当前顺位者是玩家 → 等待玩家提交 obl_battle_action
 *
 * @param array &$a 单位 A（玩家或敌人，引用传递）
 * @param array &$b 单位 B（玩家或敌人，引用传递）
 * @return void
 */
function obl_resolve_collision_battle(&$a, &$b) {
	global $obl_battle_log;

	# 包含战斗系统功能文件（需要 battle_state_init / battle_queue_create / battle_queue_join / battle_queue_exit）
	if (!function_exists('battle_state_init')) {
		include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
	}

	# 双方进入战斗状态
	battle_state_init($a);
	battle_state_init($b);

	# 交火后互相可见
	$a['discovered'] = 1;
	$b['discovered'] = 1;

	$a_bid = (int)$a['bid'];
	$b_bid = (int)$b['bid'];

	if ($a_bid > 0 && $b_bid > 0 && $a_bid === $b_bid) {
		# 场景 1：双方已在同一队列中（兜底，正常不应触发碰撞），只保存状态
		obl_save_player($a);
		obl_save_player($b);
	} elseif ($a_bid > 0 && $b_bid > 0) {
		# 场景 2：双方在不同队列中（兜底，正常不应发生）
		# $a 退出原队列，加入 $b 的队列
		$battle_cache = [];
		battle_queue_exit($a, $obl_battle_log, $battle_cache);
		battle_queue_join($a, $b_bid, $obl_battle_log);
		obl_save_player($b);
	} elseif ($a_bid > 0) {
		# 场景 3：$a 已在队列中，$b 加入 $a 的队列（排入末尾，done=0）
		battle_queue_join($b, $a_bid, $obl_battle_log);
		obl_save_player($a);
	} elseif ($b_bid > 0) {
		# 场景 4：$b 已在队列中，$a 加入 $b 的队列（排入末尾，done=0）
		battle_queue_join($a, $b_bid, $obl_battle_log);
		obl_save_player($b);
	} else {
		# 场景 5：双方都不在队列中，创建新先攻队列
		$combatants = array($a['pid'], $b['pid']);
		battle_queue_create($a, $combatants, $obl_battle_log);
		# 同步 $b 的 bid（battle_queue_create 内部已更新数据库，但 $b 内存中的 bid 需要同步）
		$b['bid'] = $a['bid'];
		obl_save_player($b);
	}
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