<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — PlannedState helpers
//
// 职责：
//   - 在 dry-run / verify / preview 的动作链中保存计划状态
//   - 为 target resolver 提供 pid -> planned player 覆盖读取
//   - 为 effect projector 提供统一写回入口
//
// planned state 存在于 battle_cache['_planned_players']，不会写 DB。
// ================================================================

function combat_planned_state_init(array &$actor_data, array &$battle_cache): void {
    if (!isset($battle_cache['_planned_players']) || !is_array($battle_cache['_planned_players'])) {
        $battle_cache['_planned_players'] = [];
    }

    $pid = (int)($actor_data['pid'] ?? 0);
    if ($pid > 0) {
        $battle_cache['_planned_players'][$pid] = $actor_data;
    }
}

function combat_planned_state_get_player(array $battle_cache, int $pid): ?array {
    if ($pid <= 0) return null;
    $planned = $battle_cache['_planned_players'][$pid] ?? null;
    return is_array($planned) ? $planned : null;
}

function combat_planned_state_put_player(array &$battle_cache, array $player_data): void {
    $pid = (int)($player_data['pid'] ?? 0);
    if ($pid <= 0) return;
    if (!isset($battle_cache['_planned_players']) || !is_array($battle_cache['_planned_players'])) {
        $battle_cache['_planned_players'] = [];
    }
    $battle_cache['_planned_players'][$pid] = $player_data;
}

function combat_planned_state_sync_actor(array &$actor_data, array &$battle_cache): void {
    combat_planned_state_put_player($battle_cache, $actor_data);
}

function combat_planned_state_spend_ap(array &$actor_data, array &$battle_cache, int $ap_cost): void {
    $actor_data['ap'] = max(0, (int)($actor_data['ap'] ?? 0) - max(0, $ap_cost));
    combat_planned_state_sync_actor($actor_data, $battle_cache);
}
