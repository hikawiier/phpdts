<?php
/**
 * @module D 战斗系统（Combat）
 */
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

// 初始化计划状态：将当前 actor 的数据写入 _planned_players 缓存
// 用于 dry-run/verify/preview 阶段的"幕前"状态覆盖
function combat_planned_state_init(array &$actor_data, array &$battle_cache): void {
    if (!isset($battle_cache['_planned_players']) || !is_array($battle_cache['_planned_players'])) {
        $battle_cache['_planned_players'] = [];
    }

    $pid = (int)($actor_data['pid'] ?? 0);
    if ($pid > 0) {
        $battle_cache['_planned_players'][$pid] = $actor_data;
    }
}

// 从计划状态中读取指定 pid 的玩家数据（优先于 DB 读取）
function combat_planned_state_get_player(array $battle_cache, int $pid): ?array {
    if ($pid <= 0) return null;
    $planned = $battle_cache['_planned_players'][$pid] ?? null;
    return is_array($planned) ? $planned : null;
}

// 将玩家数据写回计划状态缓存，供后续 action 读取计划后的状态
function combat_planned_state_put_player(array &$battle_cache, array $player_data): void {
    $pid = (int)($player_data['pid'] ?? 0);
    if ($pid <= 0) return;
    if (!isset($battle_cache['_planned_players']) || !is_array($battle_cache['_planned_players'])) {
        $battle_cache['_planned_players'] = [];
    }
    $battle_cache['_planned_players'][$pid] = $player_data;
}

// 同步 actor 数据到计划状态：将当前 actor 的最新状态写入缓存
function combat_planned_state_sync_actor(array &$actor_data, array &$battle_cache): void {
    combat_planned_state_put_player($battle_cache, $actor_data);
}

// 在计划状态下消耗 AP：扣除 actor_data 中的 AP 并同步到计划状态
// 实际结算阶段由真实 AP 扣除替代此值
function combat_planned_state_spend_ap(array &$actor_data, array &$battle_cache, int $ap_cost): void {
    $actor_data['ap'] = max(0, (int)($actor_data['ap'] ?? 0) - max(0, $ap_cost));
    combat_planned_state_sync_actor($actor_data, $battle_cache);
}
