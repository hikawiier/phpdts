<?php
/**
 * @module E 游戏逻辑
 * @framework E-8 NPC AI 行为系统
 */
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
// 依赖：move.func.php + player.func.php + combat.core.php + explore.func.php（由 obl_bootstrap.php 统一加载）

// ================================================================
// 模块 1：NPC 生成
// 已迁移至 init.func.php（obl_init_enemies + obl_create_enemy_record +
// obl_get_occupied_positions + obl_pick_available_tile），属于"游戏初始化"而非"AI 行为"
// ================================================================

// ================================================================
// 模块 2：Tick 事件监听器
// ================================================================
// 两个内置监听器，由 tick.func.php 末尾集中注册：
//   - obl_tick_phase_battle_npc：battle_npc phase，战斗中 NPC 回合
//   - obl_tick_phase_idle_npc  ：idle_npc phase，非战斗 NPC AI 行为
//
// 监听器签名：function(int $delta, array &$ctx): void
//   $ctx = ['player' => &$pdata, 'advanced' => bool]

/**
 * 监听器：战斗中 NPC 回合（battle_npc phase）
 *
 * 查询所有活跃先攻队列，若当前顺位者是 NPC，执行 NPC 回合。
 * 执行后调用 obl_tick_request_advance() 请求推进 tick。
 * 最多处理 1 个 NPC 回合（串行语义，由调度器 break 保证）。
 *
 * 循环模型：
 *   - NPC 回合执行 → 请求推进 → 调度器末尾 obl_tick++ → 下次请求继续循环
 *   - 当前顺位者是玩家 → 不执行 → 不推进 → 循环终止
 *
 * @param int   $delta 待处理的 tick 差值
 * @param array &$ctx  调度上下文
 * @return void
 */
function obl_tick_phase_battle_npc($delta, &$ctx) {
	global $db, $tablepre, $obl_battle_log;

	# 共享队列 / combat 运行时已由 obl_bootstrap.php 统一加载

	# 载入所有活跃的先攻队列 qid（DISTINCT 去重，避免同队列多记录重复处理）
	# 加 active=1 过滤，避免扫到全员 active=0 的幽灵队列
	$result = $db->query("SELECT DISTINCT qid FROM {$tablepre}oblqueue WHERE qid > 0 AND active = 1");

	while ($qdata = $db->fetch_array($result)) {
		$qid = (int)$qdata['qid'];
		if ($qid <= 0) continue;

		$processing_state = defined('OBL_BS_PROCESSING') ? OBL_BS_PROCESSING : 'PROCESSING';
		$battle_state = function_exists('obl_battle_state_get') ? obl_battle_state_get($qid) : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
		if ($battle_state !== $processing_state) {
			obl_tick_ctx_add_domain_event($ctx, 'battle_queue_skipped_by_state', array(
				'qid' => $qid,
				'state' => $battle_state,
			));
			continue;
		}

		# 获取当前顺位者（myorder 最小且 done=0）
		$current = obl_fetch_queue_current_initiator($qid);
		if (!$current) continue;

		# 当前顺位者是玩家 → 不执行 NPC 回合（等待玩家提交 obl_battle_action）
		if ($current['type'] == 0) {
			# 战斗状态机：仅当状态为 PROCESSING 时触发 player_turn
			obl_battle_state_transition($qid, 'player_turn');
			obl_tick_ctx_add_changed_scopes($ctx, array('player_info', 'enemies', 'combat_targets', 'game_map'));
			obl_tick_ctx_add_domain_event($ctx, 'player_turn_ready', array(
				'qid' => $qid,
				'pid' => (int)$current['pid'],
			));
			continue;
		}

		# 当前顺位者是 NPC → 执行 NPC 回合
		$npc_data = obl_fetch_playerdata_by_pid($current['pid']);
		if (!$npc_data) {
			continue;
		}

		# 构造 NPC 动作（从 oblpara['combat_skills'] 中选择可用技能）
		$atk_act = obl_ai_select_combat_action($npc_data, $ctx['player']['pid']);
		$behavior = !empty($atk_act[0]['act_id']) ? (string)$atk_act[0]['act_id'] : 'npc_turn';
		if (function_exists('obl_tick_ctx_claim_actor_behavior') && !obl_tick_ctx_claim_actor_behavior($ctx, (int)$npc_data['pid'], 'combat', $behavior, array('qid' => $qid))) {
			obl_tick_ctx_add_domain_event($ctx, 'actor_behavior_claim_failed', array(
				'qid' => $qid,
				'pid' => (int)$npc_data['pid'],
				'domain' => 'combat',
				'behavior' => $behavior,
			));
			continue;
		}

		# 通过新 combat 入口调度 NPC 回合。
		# 内部调用 battle_manage_queue，已包含：done → update → 确定 next + 状态转换 + try_end
		error_log("[combat_engine] routed to new system: npc_turn (pid={$npc_data['pid']})");
		$result = combat_dispatch('npc_turn', $npc_data, $atk_act, [
			'allow_empty_actions' => true,
		]);
		obl_tick_ctx_add_changed_scopes($ctx, array('player_info', 'enemies', 'combat_targets', 'game_map'));
		obl_tick_ctx_add_domain_event($ctx, 'npc_turn_resolved', array(
			'qid' => $qid,
			'pid' => (int)$npc_data['pid'],
		));

		# 请求推进 tick（由调度器末尾统一推进，替代旧的 $obl_tick_advanced 引用传递）
		obl_tick_request_advance();
		break;  # 最多处理 1 个 NPC 回合
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

	if (function_exists('obl_tick_debug_log')) {
		obl_tick_debug_log('WORLD_AI_PHASE_START', array(
			'delta' => (int)$delta,
			'pgroup' => $group,
			'enemy_count' => count($enemies),
			'battle_scope' => function_exists('obl_tick_ctx_battle_actor_scope_values') ? obl_tick_ctx_battle_actor_scope_values($ctx) : array(),
			'actor_behaviors' => isset($ctx['actor_behaviors']) && is_array($ctx['actor_behaviors']) ? array_values($ctx['actor_behaviors']) : array(),
		));
	}

	$moved = 0;
	foreach ($enemies as &$enemy) {
		$block_reason = obl_actor_world_ai_block_reason($enemy, $ctx);
		if (function_exists('obl_tick_debug_log')) {
			obl_tick_debug_log('WORLD_AI_ACTOR_CHECK', array(
				'pid' => (int)($enemy['pid'] ?? 0),
				'name' => (string)($enemy['name'] ?? ''),
				'action' => (string)($enemy['action'] ?? ''),
				'bid' => (int)($enemy['bid'] ?? 0),
				'state' => (int)($enemy['state'] ?? 0),
				'pgroup' => (int)($enemy['pgroup'] ?? 0),
				'pls' => (int)($enemy['pls'] ?? 0),
				'block_reason' => $block_reason,
			));
		}
		if ($block_reason !== '') continue;
		# 结算非战斗敌人 AI
		if (obl_enemy_tick($enemy, $player, $ctx)) {
			$moved++;
		}
	}

	if ($moved > 0) {
		obl_tick_ctx_add_changed_scopes($ctx, array('enemies', 'combat_targets', 'game_map'));
		obl_tick_ctx_add_domain_event($ctx, 'idle_npc_moved', array(
			'count' => $moved,
			'pgroup' => $group,
		));
	}

	if (function_exists('obl_tick_debug_log')) {
		obl_tick_debug_log('WORLD_AI_PHASE_END', array(
			'pgroup' => $group,
			'moved' => $moved,
		));
	}
}

/**
 * 判断 actor 是否可在当前 TickFrame 执行非战斗 AI 行为。
 *
 * 持久状态（action/bid/queue active）只能表达 actor 当前归属，不能替代
 * TickFrame 行为账本；因此这里统一检查本 tick 是否已经执行过主动行为。
 *
 * @param array &$actor
 * @param array &$ctx
 * @return bool
 */
function obl_actor_can_world_ai(&$actor, &$ctx) {
	return obl_actor_world_ai_block_reason($actor, $ctx) === '';
}

function obl_actor_world_ai_block_reason(&$actor, &$ctx) {
	$pid = (int)($actor['pid'] ?? 0);
	if ($pid <= 0) return 'invalid_pid';
	if ((int)($actor['state'] ?? 0) > 0) return 'dead_or_inactive';
	$current_tick = function_exists('obl_tick_get') ? obl_tick_get() : 0;
	$capability = actor_capability_decide($actor, 'world_ai', $ctx, (int)$current_tick);
	if (empty($capability['allowed'])) return 'capability:' . (string)($capability['reason'] ?? 'blocked');
	if (function_exists('obl_tick_ctx_actor_in_battle_scope') && obl_tick_ctx_actor_in_battle_scope($ctx, $pid)) return 'battle_scope';
	if (($actor['action'] ?? '') === 'battle') return 'action_battle';
	if (!empty($actor['bid'])) return 'bid_present';
	if (function_exists('obl_tick_ctx_actor_has_behavior') && obl_tick_ctx_actor_has_behavior($ctx, $pid)) return 'actor_behavior_claimed';
	return '';
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
 * @param array &$ctx    TickFrame 调度上下文
 * @return bool 本 tick 是否移动
 */
function obl_enemy_tick(&$enemy, &$player, &$ctx = null)
{
	if (is_array($ctx) && !obl_actor_can_world_ai($enemy, $ctx)) return false;

	// 死亡敌人不行动
	if ($enemy['state'] > 0) return false;

	// 战斗中的敌人不参与 tick 结算（由战斗系统接管行动）
	if ($enemy['action'] == 'battle') return false;

	// 行动意愿门控：随机数决定这个 tick 要不要行动
	$action_chance = isset($enemy['oblpara']['action_chance'])
		? (float)$enemy['oblpara']['action_chance'] : 0.5;
	$roll = mt_rand() / mt_getrandmax();
	if (function_exists('obl_tick_debug_log')) {
		obl_tick_debug_log('WORLD_AI_ACTION_ROLL', array(
			'pid' => (int)($enemy['pid'] ?? 0),
			'name' => (string)($enemy['name'] ?? ''),
			'ai_type' => (string)(isset($enemy['oblpara']['ai_type']) ? $enemy['oblpara']['ai_type'] : 'idle'),
			'action_chance' => $action_chance,
			'roll' => $roll,
			'passes' => $roll <= $action_chance,
		));
	}
	if ($roll > $action_chance) return false;

	// 根据 AI 类型行动
	// TODO: 追击/突袭/碰撞战斗机制待 tick 框架重构后重新实现
	$ai_type = isset($enemy['oblpara']['ai_type']) ? $enemy['oblpara']['ai_type'] : 'idle';
	switch ($ai_type) {
		case 'patrol':
			if (is_array($ctx) && function_exists('obl_tick_ctx_claim_actor_behavior')
				&& !obl_tick_ctx_claim_actor_behavior($ctx, (int)$enemy['pid'], 'world', 'patrol')) {
				return false;
			}
			return obl_enemy_patrol($enemy, $player, $ctx);
		case 'aggressive':
			if (is_array($ctx) && function_exists('obl_tick_ctx_claim_actor_behavior')
				&& !obl_tick_ctx_claim_actor_behavior($ctx, (int)$enemy['pid'], 'world', 'aggressive')) {
				return false;
			}
			return obl_enemy_hunt($enemy, $player, $ctx);  // MVP 简化为巡逻
		case 'idle':
		default:
			if (function_exists('obl_tick_debug_log')) {
				obl_tick_debug_log('WORLD_AI_IDLE_NOOP', array(
					'pid' => (int)($enemy['pid'] ?? 0),
					'ai_type' => (string)$ai_type,
				));
			}
			// 发呆，不行动
			return false;
	}
}

/**
 * AI 战斗技能选择
 *
 * 从 oblpara['combat_skills'] 中选择第一个可用攻击技能（含射程预判）。
 * 决策链：
 *   1. 尝试 combat_skills 中的攻击技能（传入 target_data 做射程预判）
 *   2. 无可用攻击技能 → 尝试 escape（逃跑兜底）
 *   3. escape 不可用 → 返回 idle（发呆兜底）
 *
 * @param array &$npc_data   NPC 数据
 * @param int   $target_pid  默认目标 pid（玩家）
 * @return array 动作数组 [['act_id' => skill_id, 'target' => pid], ...]
 */
function obl_ai_select_combat_action(&$npc_data, $target_pid) {
	# 读取战斗技能偏好列表（skill.main.php 已由 obl_bootstrap.php 加载）
	$combat_skills = isset($npc_data['oblpara']['combat_skills'])
		? $npc_data['oblpara']['combat_skills']
		: array('unarmed_strike');
	if (!is_array($combat_skills) || empty($combat_skills)) {
		$combat_skills = array('unarmed_strike');
	}

	# fetch target data（射程预判需要）
	$target_data = obl_fetch_playerdata_by_pid($target_pid);
	if (!$target_data) {
		# target 不存在，发呆
		return array(array('act_id' => 'idle', 'target' => (int)$npc_data['pid']));
	}

	# 1. 尝试攻击技能（含射程预判）
	foreach ($combat_skills as $skill_id) {
		if (skill_is_usable($npc_data, $skill_id, $target_data)) {
			return array(array('act_id' => $skill_id, 'target' => (int)$target_pid));
		}
	}

	# 2. 无可用攻击技能 → 逃跑兜底
	if (skill_is_usable($npc_data, 'escape')) {
		return array(array('act_id' => 'escape', 'target' => (int)$npc_data['pid']));
	}

	# 3. escape 也不可用 → 发呆
	return array(array('act_id' => 'idle', 'target' => (int)$npc_data['pid']));
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
function obl_enemy_move(&$enemy, $target_pls, &$player, &$ctx = null, $reason = '') {
	$from_pls = (int)($enemy['pls'] ?? 0);
	$pid = (int)($enemy['pid'] ?? 0);

	// 校验目标格 passable
	$map = obl_get_map_data($enemy['pgroup']);
	$tiles = $map['tiles'][$enemy['pgroup']];
	if (!isset($tiles[$target_pls]) || empty($tiles[$target_pls]['passable'])) {
		if (function_exists('obl_tick_debug_log')) {
			obl_tick_debug_log('WORLD_AI_MOVE_REJECT', array(
				'pid' => $pid,
				'reason' => 'not_passable',
				'from_pls' => $from_pls,
				'target_pls' => (int)$target_pls,
				'behavior' => (string)$reason,
			));
		}
		return false;
	}

	// 目标格是玩家所在格 → 不移动
	// TODO: 碰撞战斗机制待 tick 框架重构后重新实现
	if ($player['pgroup'] == $enemy['pgroup'] && $player['pls'] == $target_pls) {
		if (function_exists('obl_tick_debug_log')) {
			obl_tick_debug_log('WORLD_AI_MOVE_REJECT', array(
				'pid' => $pid,
				'reason' => 'player_occupied',
				'from_pls' => $from_pls,
				'target_pls' => (int)$target_pls,
				'behavior' => (string)$reason,
			));
		}
		return false;
	}

	// 校验目标格未被其他单位占用（一个格一个单位）
	if (obl_is_tile_occupied_by_others($enemy['pgroup'], $target_pls, $enemy['pid'])) {
		if (function_exists('obl_tick_debug_log')) {
			obl_tick_debug_log('WORLD_AI_MOVE_REJECT', array(
				'pid' => $pid,
				'reason' => 'occupied',
				'from_pls' => $from_pls,
				'target_pls' => (int)$target_pls,
				'behavior' => (string)$reason,
			));
		}
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

	if (function_exists('obl_tick_debug_log')) {
		obl_tick_debug_log('WORLD_AI_MOVE_SUCCESS', array(
			'pid' => $pid,
			'name' => (string)($enemy['name'] ?? ''),
			'behavior' => (string)$reason,
			'pgroup' => (int)($enemy['pgroup'] ?? 0),
			'from_pls' => $from_pls,
			'to_pls' => (int)$target_pls,
			'action' => (string)($enemy['action'] ?? ''),
			'bid' => (int)($enemy['bid'] ?? 0),
		));
	}

	return true;
}

/**
 * 巡逻：随机选一个邻居格移动
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据（obl_enemy_move 签名需要）
 * @return bool 是否移动成功
 */
function obl_enemy_patrol(&$enemy, &$player, &$ctx = null) {
	$neighbors = obl_get_tile_neighbors($enemy['pgroup'], $enemy['pls']);
	if (empty($neighbors)) return false;

	$target_pls = $neighbors[array_rand($neighbors)];
	if (function_exists('obl_tick_debug_log')) {
		obl_tick_debug_log('WORLD_AI_PATROL_TARGET', array(
			'pid' => (int)($enemy['pid'] ?? 0),
			'from_pls' => (int)($enemy['pls'] ?? 0),
			'neighbors' => array_values($neighbors),
			'target_pls' => (int)$target_pls,
		));
	}
	return obl_enemy_move($enemy, $target_pls, $player, $ctx, 'patrol');
}

/**
 * 主动搜寻（MVP 简化为巡逻）
 *
 * @param array &$enemy  敌人数据
 * @param array &$player 当前玩家数据
 * @return bool 是否移动成功
 */
function obl_enemy_hunt(&$enemy, &$player, &$ctx = null) {
	return obl_enemy_patrol($enemy, $player, $ctx);
}

// ================================================================
// 模块 4：discovered 状态管理
// 已迁移至 vision.func.php（obl_discover_enemies, obl_update_enemy_discovered,
// obl_get_player_vision_range），打破 explore ↔ enemy_ai 循环依赖
// ================================================================

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

