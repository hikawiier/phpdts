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
//   4. battle_entry_npc_prepare_actions NPC 回合准备（入口 3 分支 / 已有队列下一轮 NPC 回合）
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
    $battle_cache = battle_cache_create($pdata, true);

    # 4. 设置 ambush_flag（一次性，battle_queue_create 中清除）
    $pdata['oblpara']['ambush_flag'] = true;

    # 5. 玩家进入战斗状态
    battle_state_init($pdata);

    # 6. 执行动作 + 队列管理分离调用
    battle_main($pdata, $atk_act, $obl_battle_log, $battle_cache);
    # 状态转换和 next_pid 已在 battle_manage_queue 内部完成
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
    $battle_cache = battle_cache_create($npc, true);

    # 4. 设置 ambush_flag（一次性，battle_queue_create 中清除）
    $npc['oblpara']['ambush_flag'] = true;

    # 5. NPC 进入战斗状态
    battle_state_init($npc);

    # 6. 执行动作 + 队列管理分离调用
    battle_main($npc, $atk_act, $obl_battle_log, $battle_cache);
    # 状态转换和 next_pid 已在 battle_manage_queue 内部完成
    battle_manage_queue($npc, $obl_battle_log, $battle_cache);
}

/**
 * 入口 3：遭遇战
 *
 * 由 move.func.php 检测到移动目的地与对手重叠时调用。
 * 不执行动作，只建队列 + 先攻判定，然后按先攻结果分支：
 *   - 玩家先攻 → 状态机 set 为 PLAYER_TURN（等玩家下个命令）
 *   - NPC 先攻 → 调用入口 4（NPC 回合准备）
 *
 * 状态初始记录由 battle_queue_create 内部调用 obl_battle_state_create 创建（初始 PROCESSING），
 * 本函数按先攻结果校正到正确状态。
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
    $battle_cache = battle_cache_create($actor, false, array_fill_keys($combatants, 1));

    # 3. 触发者进入战斗状态
    battle_state_init($actor);

    # 4. 通过队列管理建队列 + 先攻判定 + 状态转换
    #    battle_manage_queue 内部完成：queue_create → advance → 确定 next + 状态转换 + try_end
    #    调用方不再需要手动查队列或 set 状态
    $result = battle_manage_queue($actor, $obl_battle_log, $battle_cache);

    # 5. 如果下一顺位是 NPC，立即触发其回合
    #    （入口 3 的特殊性：遭遇战需要在一个请求内完成队列创建 + NPC 先攻）
    if ($result['next'] && $result['next']['type'] != 0) {
        $npc_data = obl_fetch_playerdata_by_pid($result['next']['pid']);
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
 * 入口 4：NPC 回合准备
 *
 * 由入口 3 走 NPC 回合的后续分支，或已有队列下一轮 NPC 回合（tick 系统通过
 * obl_tick_phase_battle_npc 触发）调用。
 * 流程：NPC AI 已生成 actions 合集 → 调用 battle_main。
 *
 * 注意：即使 $actions 为空也必须调用 battle_main，由 battle_main 内部
 * battle_verify/battle_execute 处理空动作情况，并推进队列 done 状态。
 * 否则 NPC 会卡在当前先攻顺位导致死循环。
 *
 * @param array &$npc    NPC 数据
 * @param array $actions AI 生成的动作数组 [{act_id, target}, ...]
 * @return array battle_manage_queue 的结果 ['disbanded', 'rebuilt', 'next']
 */
function battle_entry_npc_prepare_actions(&$npc, $actions): array {
    global $obl_battle_log;

    # 1. 初始化 battle_log
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }

    # 2. 解析 actions（空也允许，由 battle_main 内部处理）
    $atk_act = battle_entry_parse_actions($actions, $npc['pid'], 'npc_prepare');

    # 3. 战斗上下文
    $battle_cache = battle_cache_create($npc, false);

    # 4. 执行动作 + 队列管理分离调用
    battle_main($npc, $atk_act, $obl_battle_log, $battle_cache);
    # 返回 battle_manage_queue 结果供调用方（tick handler）使用
    return battle_manage_queue($npc, $obl_battle_log, $battle_cache);
}

// ── 辅助函数 ──

/**
 * 统一构建战斗上下文
 *
 * $combatants 为 null 时默认按发起者是否已关联先攻队列决定初始化范围：
 *   - 发起者 bid > 0 → 载入整个队列内所有 pid（代表一次 battle_main 生命周期后还能继续战斗的目标合集）
 *   - 发起者无队列   → 仅自己（后补票模型）
 *
 * 初始化 tag_mutations 为空数组，由 battle_build_target_tags 在 verify 阶段首次构建后填充。
 *
 * @param array      $initiator_data 发起者完整数据
 * @param bool       $is_ambush     是否突袭
 * @param array|null $combatants    显式参战者列表 [pid => 1, ...]
 * @return array
 */
function battle_cache_create(&$initiator_data, $is_ambush = false, $combatants = null) {
    $initiator_pid = (int)$initiator_data['pid'];

    if ($combatants === null) {
        // 发起者有战斗队列 → 载入队列内其他人
        $qid = (int)($initiator_data['bid'] ?? 0);
        if ($qid > 0) {
            $all_pids = obl_fetch_queue_pids_by_qid($qid);
            $combatants = [];
            foreach ($all_pids as $pid) {
                $combatants[(int)$pid] = 1;
            }
        } else {
            // 无队列 → 仅自己
            $combatants = [$initiator_pid => 1];
        }
    }
    return [
        'combatants'    => $combatants,
        'last_qid'      => 0,
        'is_ambush'     => $is_ambush,
        'tag_mutations' => [],
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