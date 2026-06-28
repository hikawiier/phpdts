<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗入口 / Oblivions battle entry
//
// battle_entry_dispatch 是唯一战斗入口，与 battle.main.php（执行）+ battle.queue.*.php（队列）三层分离。
//
// 3 种触发模式：
//   - 'ambush'      突袭（玩家/NPC），后补票建队列
//   - 'player_turn' 玩家在已有队列中的回合
//   - 'npc_turn'    NPC 在已有队列中的回合
//
// 设计原则：
//   - 所有触发源不做任何合法性判断，只传 raw $actions
//   - actions 解析/校验统一由 dispatch 内部调用 battle_entry_parse_actions 完成
//   - 队列管理由 battle_manage_queue 完成
//
// 关联设计文档：oblivions/docs/战斗入口彻底清理设计案.md
// ================================================================

/**
 * 统一战斗入口调度
 *
 * 调用方：
 *   cmd_handle_obl_battle_start  → mode='ambush'      玩家突袭 NPC，由前端提交玩家动作，后补票建队列
 *   cmd_handle_obl_battle_action → mode='player_turn'  玩家在已有队列中的回合，由前端提交玩家动作
 *   obl_tick_phase_battle_npc    → mode='npc_turn'     NPC 在已有队列中的回合，由 obl_ai_select_combat_action 生成动作后传入
 *
 * @param string     $mode    入口模式：'ambush' | 'player_turn' | 'npc_turn'
 * @param array     &$actor   发起者数据
 * @param array|null $actions 动作数组 [{act_id, target}, ...]
 * @param array      $extra   扩展参数（预留）
 * @return array|void 仅 npc_turn 模式返回 battle_manage_queue 结果，其余无返回值
 */
function battle_entry_dispatch($mode, &$actor, $actions = null, $extra = []) {
    global $obl_battle_log;

    // ── 0. 统一初始化 battle_log ──
    battle_entry_ensure_battle_log();

    if ($mode === 'ambush') {
        // ── 突袭（玩家/NPC），后补票建队列 ──
        $atk_act = battle_entry_parse_actions($actions, $actor['pid'], $mode, false);
        if (empty($atk_act)) return;

        $battle_cache = battle_cache_create($actor, true);

        $actor['oblpara']['ambush_flag'] = true;
        battle_state_init($actor);

        battle_main($actor, $atk_act, $obl_battle_log, $battle_cache);

        $queue_online = battle_queue_setup($actor, $obl_battle_log, $battle_cache['combatants']);
        if ($queue_online) {
            battle_manage_queue($actor, $obl_battle_log, $battle_cache);
        } else {
            battle_state_clear($actor, $obl_battle_log, $battle_cache);
        }
        return;
    }

    if ($mode === 'player_turn') {
        // ── 玩家在已有队列中的回合 ──
        $atk_act = battle_entry_parse_actions($actions, $actor['pid'], $mode, false);
        if (empty($atk_act)) return;

        $battle_cache = battle_cache_create($actor, false);

        battle_main($actor, $atk_act, $obl_battle_log, $battle_cache);
        battle_manage_queue($actor, $obl_battle_log, $battle_cache);
        return;
    }

    if ($mode === 'npc_turn') {
        // ── NPC 在已有队列中的回合（允许空动作） ──
        $atk_act = battle_entry_parse_actions($actions, $actor['pid'], $mode, true);

        $battle_cache = battle_cache_create($actor, false);

        battle_main($actor, $atk_act, $obl_battle_log, $battle_cache);
        $result = battle_manage_queue($actor, $obl_battle_log, $battle_cache);
        return $result;
    }
}

// ── 辅助函数 ──

/**
 * 确保 battle_log 已初始化
 *
 * 由 battle_entry_dispatch 统一调用。
 */
function battle_entry_ensure_battle_log(): void {
    global $obl_battle_log;
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }
}

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
 * 空动作时（$allow_empty=false）内部 emit 错误日志，调用方只需 if(empty) return。
 *
 * @param array|null $actions      原始 actions
 * @param int        $actor_pid    行动者 pid（用于日志记录）
 * @param string     $entry        入口名（用于日志记录）
 * @param bool       $allow_empty  是否允许空动作（true=不 emit 错误日志）
 * @return array
 */
function battle_entry_parse_actions($actions, $actor_pid, $entry, $allow_empty = false) {
    $atk_act = array();
    if (!is_array($actions)) {
        return $atk_act;
    }

    foreach ($actions as $act) {
        $act_id = isset($act['act_id']) ? $act['act_id'] : '';
        $target = isset($act['target']) ? (int)$act['target'] : 0;
        if (empty($act_id) || $target <= 0) continue;
        $atk_act[] = array('act_id' => $act_id, 'target' => $target);
    }

    if (empty($atk_act) && !$allow_empty) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_entry.empty_actions', [
                'pid'   => (int)$actor_pid,
                'entry' => $entry,
            ], 'battle');
        }
    }

    return $atk_act;
}
