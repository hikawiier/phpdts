<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗入口 / Oblivions battle entry
//
// 4 种战斗入口的统一入口函数，与 battle.main.php（执行）+ battle.func.php（队列）三层分离。
//
// 入口定义：
//   1. battle_entry_player_ambush       玩家突袭 NPC（命令触发，后补票建队列）
//   2. battle_entry_npc_ambush          NPC 突袭玩家（AI 决策，后补票建队列）
//   3. battle_entry_encounter           遭遇战（移动目的地重叠，先建队列 + 先攻判定）
//   4. battle_entry_npc_prepare_actions NPC 先攻准备（入口 3 分支 / 已有队列下一轮 NPC 先攻）
//
// 设计原则：
//   - 命令层校验（HTTP 输入校验：存在/未死亡/同区域/射程内）由调用方完成
//   - 入口层只负责：设置标记 + 初始化状态 + 调用战斗主流程
//   - 队列管理由 battle_manage_queue（或当前 battle_main + battle_queue_check）完成
//
// 关联设计文档：oblivions/docs/战斗入口设计案.md
// ================================================================

/**
 * 入口 1：玩家突袭 NPC
 *
 * 由 cmd_handle_obl_battle_start 调用（命令层校验已通过）。
 * 流程：设置 ambush_flag → battle_state_init → 调用 battle_main（后补票建队列）。
 *
 * @param array     &$pdata   玩家数据
 * @param array|null $actions  预装填动作数组 [{act_id, target}, ...]
 * @return void
 */
function battle_entry_player_ambush(&$pdata, $actions) {
    global $obl_battle_log, $obl_error_log;

    # 1. 初始化 battle_log（入口处局部初始化）
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 2. 解析 actions -> $atk_act
    $atk_act = battle_entry_parse_actions($actions, $pdata['pid'], 'player_ambush');
    if (empty($atk_act)) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_entry.empty_actions', array(
                'pid' => (int)$pdata['pid'],
                'entry' => 'player_ambush',
            ), 'battle');
        }
        return;
    }

    # 3. 战斗上下文（外部传入，执行中填充 combatants）
    $battle_cache = battle_cache_create($pdata['pid'], true);

    # 4. 设置 ambush_flag（一次性，battle_queue_create 中清除）
    $pdata['oblpara']['ambush_flag'] = true;

    # 5. 玩家进入战斗状态
    battle_state_init($pdata);

    # 6. 执行动作 + 队列管理分离调用
    battle_main($pdata, $atk_act, $obl_battle_log, $battle_cache);
    battle_manage_queue($pdata, $obl_battle_log, $battle_cache);
}

/**
 * 入口 2：NPC 突袭玩家
 *
 * 由 enemy_ai.func.php 的 AI 决策层调用。
 * NPC AI 判断选择突袭时,生成 actions 合集后调用本函数。
 * 流程：设置 ambush_flag → battle_state_init → 调用 battle_main（后补票建队列）。
 *
 * @param array &$npc    NPC 数据（actor）
 * @param array $actions AI 生成的动作数组 [{act_id, target}, ...]
 * @return void
 */
function battle_entry_npc_ambush(&$npc, $actions) {
    global $obl_battle_log, $obl_error_log;

    # 1. 初始化 battle_log
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 2. 解析 actions
    $atk_act = battle_entry_parse_actions($actions, $npc['pid'], 'npc_ambush');
    if (empty($atk_act)) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_entry.empty_actions', array(
                'pid' => (int)$npc['pid'],
                'entry' => 'npc_ambush',
            ), 'battle');
        }
        return;
    }

    # 3. 战斗上下文
    $battle_cache = battle_cache_create($npc['pid'], true);

    # 4. 设置 ambush_flag（一次性，battle_queue_create 中清除）
    $npc['oblpara']['ambush_flag'] = true;

    # 5. NPC 进入战斗状态
    battle_state_init($npc);

    # 6. 执行动作 + 队列管理分离调用
    battle_main($npc, $atk_act, $obl_battle_log, $battle_cache);
    battle_manage_queue($npc, $obl_battle_log, $battle_cache);
}

/**
 * 入口 3：遭遇战
 *
 * 由 move.func.php 检测到移动目的地与对手重叠时调用。
 * 不执行动作，只建队列 + 先攻判定，然后按先攻结果分支：
 *   - 玩家先攻 → 状态机 reset 为 WAITING_PLAYER（等玩家下个命令）
 *   - NPC 先攻 → 调用入口 4（NPC 先攻准备）
 *
 * 状态初始记录由 battle_queue_create 内部调用 obl_battle_state_create 创建（初始 PLAYER_DONE），
 * 本函数按先攻结果用 obl_battle_state_reset 校正到正确状态。
 *
 * @param array &$actor     触发者（玩家或 NPC,谁移动到此格）
 * @param array $combatants 显式参战者列表 [pid, pid, ...]
 * @return void
 */
function battle_entry_encounter(&$actor, $combatants) {
    global $obl_battle_log;

    # 1. 初始化 battle_log
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 2. 战斗上下文（显式参战者列表，不执行动作）
    $battle_cache = battle_cache_create($actor['pid'], false, array_fill_keys($combatants, 1));

    # 3. 触发者进入战斗状态
    battle_state_init($actor);

    # 4. 通过队列管理建队列 + 先攻判定
    #    battle_manage_queue 内部 battle_queue_create 会调用 obl_battle_state_create
    battle_manage_queue($actor, $obl_battle_log, $battle_cache);

    # 5. 按先攻结果校正状态机
    $qid = (int)$actor['bid'];
    if ($qid <= 0) return;

    $first = obl_fetch_queue_current_initiator($qid);
    if (!$first) return;

    if ($first['type'] == 0) {
        # 玩家先攻 → WAITING_PLAYER（绕过转换表直接定态，避免污染）
        obl_battle_state_reset($qid, OBL_BS_WAITING_PLAYER);
    } else {
        # NPC 先攻 → NPC_ACTING，然后进入入口 4
        obl_battle_state_reset($qid, OBL_BS_NPC_ACTING);
        $npc_data = obl_fetch_playerdata_by_pid($first['pid']);
        if ($npc_data) {
            obl_format_playerdata($npc_data);
            # NPC AI 生成动作合集
            # 注意：target_pid 应当是玩家 pid，这里取 $actor['pid'] 作为默认目标
            $ai_actions = obl_ai_select_combat_action($npc_data, $actor['pid']);
            battle_entry_npc_prepare_actions($npc_data, $ai_actions);
        }
    }
}

/**
 * 入口 4：NPC 先攻准备
 *
 * 由入口 3 走 NPC 先攻的后续分支，或已有队列下一轮 NPC 先攻（tick 系统通过
 * obl_tick_phase_battle_npc 触发）调用。
 * 流程：NPC AI 已生成 actions 合集 → 调用 battle_main。
 *
 * 注意：即使 $actions 为空也必须调用 battle_main，由 battle_main 内部
 * battle_verify/battle_execute 处理空动作情况，并推进队列 done 状态。
 * 否则 NPC 会卡在当前先攻顺位导致死循环。
 *
 * @param array &$npc    NPC 数据
 * @param array $actions AI 生成的动作数组 [{act_id, target}, ...]
 * @return void
 */
function battle_entry_npc_prepare_actions(&$npc, $actions) {
    global $obl_battle_log;

    # 1. 初始化 battle_log
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 2. 解析 actions（空也允许，由 battle_main 内部处理）
    $atk_act = battle_entry_parse_actions($actions, $npc['pid'], 'npc_prepare');

    # 3. 战斗上下文
    $battle_cache = battle_cache_create($npc['pid'], false);

    # 4. 执行动作 + 队列管理分离调用
    battle_main($npc, $atk_act, $obl_battle_log, $battle_cache);
    battle_manage_queue($npc, $obl_battle_log, $battle_cache);
}

// ── 辅助函数 ──

/**
 * 统一构建战斗上下文
 *
 * 消除 5 处重复的 $battle_cache 内联赋值。
 * $combatants 为 null 时默认初始化为仅含发起者（后补票模型）。
 *
 * @param int      $initiator_pid 发起者 pid
 * @param bool     $is_ambush     是否突袭
 * @param array|null $combatants  显式参战者列表 [pid => 1, ...]
 * @return array
 */
function battle_cache_create($initiator_pid, $is_ambush = false, $combatants = null) {
    if ($combatants === null) {
        $combatants = [$initiator_pid => 1];
    }
    return [
        'combatants' => $combatants,
        'last_qid'   => 0,
        'is_ambush'  => $is_ambush,
    ];
}

/**
 * 解析 actions 合集为 battle_main 接收的 $atk_act 格式
 *
 * 输入：[[act_id, target], ...] 或 [{act_id, target}, ...]
 * 输出：[array('act_id' => ..., 'target' => ...), ...]
 *
 * @param array|null $actions   原始 actions
 * @param int        $actor_pid 行动者 pid（用于日志记录）
 * @param string     $entry     入口名（用于日志记录）
 * @return array
 */
function battle_entry_parse_actions($actions, $actor_pid, $entry) {
    $atk_act = array();
    if (!is_array($actions)) return $atk_act;

    foreach ($actions as $act) {
        $act_id = isset($act['act_id']) ? $act['act_id'] : '';
        $target = isset($act['target']) ? (int)$act['target'] : 0;
        if (empty($act_id) || $target <= 0) continue;
        $atk_act[] = array('act_id' => $act_id, 'target' => $target);
    }
    return $atk_act;
}