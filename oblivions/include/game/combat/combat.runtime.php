<?php
/**
 * @module D 战斗系统（Combat）
 * @framework D-1 动作生命周期编排
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — runtime helpers
//
// 职责：
//   - 初始化本请求 battle log collector
//   - 构建 combat 执行期间的 battle_cache
//
// 这些 helper 曾暂存在旧 battle.entry.php；迁入 combat/ 后，旧
// battle entry 可以彻底下线。
// ================================================================

function combat_ensure_battle_log(): void {
    global $obl_battle_log;
    if (!$obl_battle_log) {
        include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
        $obl_battle_log = new BattleLogCollector();
    }
}

function combat_current_evaluation_tick(): int {
    return function_exists('obl_tick_get') ? (int)obl_tick_get() : 0;
}

function combat_next_action_evaluation_tick(): int {
    if (function_exists('skill_effect_next_action_tick')) return skill_effect_next_action_tick();
    return combat_current_evaluation_tick() + 1;
}

function combat_cache_create(&$initiator_data, $is_ambush = false, $combatants = null): array {
    $initiator_pid = (int)$initiator_data['pid'];

    if ($combatants === null) {
        $qid = (int)($initiator_data['bid'] ?? 0);
        if ($qid > 0) {
            $all_pids = obl_fetch_queue_pids_by_qid($qid);
            $combatants = [];
            foreach ($all_pids as $pid) {
                $combatants[(int)$pid] = 1;
            }
        } else {
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
