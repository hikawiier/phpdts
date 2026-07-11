<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 按 boundary 激活 pending 状态的 effect：在指定边界触发时转为 active
function skill_effect_activate_boundary(
    array &$actor,
    string $boundary,
    int $boundary_id,
    int $current_tick
): array {
    $activated = array();
    if (!isset($actor['skillpara']) || !is_array($actor['skillpara'])) return $activated;
    foreach ($actor['skillpara'] as $skill_id => &$skill_state) {
        if (!is_array($skill_state) || !skill_effect_definition((string)$skill_id)) continue;
        skill_effect_format_skill_state((string)$skill_id, $skill_state);
        foreach ($skill_state['effect_instances'] as $uid => &$instance) {
            if (($instance['state'] ?? '') !== 'pending') continue;
            $activation = $instance['activation'] ?? array();
            if (($activation['boundary'] ?? '') !== $boundary || (int)($activation['boundary_id'] ?? 0) !== $boundary_id) continue;
            $starts = $current_tick + max(0, (int)($activation['delay_ticks'] ?? 0));
            $instance['state'] = 'active';
            $instance['starts_at_tick'] = $starts;
            $instance['expires_at_tick'] = $starts + max(1, (int)($instance['duration_ticks'] ?? 1));
            $activated[] = $instance;
        }
        unset($instance);
    }
    unset($skill_state);
    return $activated;
}

// GC 回收已过期的 active effect 实例，清除空 skillpara 记录
function skill_effect_gc(array &$actor, int $current_tick): bool {
    $changed = false;
    if (!isset($actor['skillpara']) || !is_array($actor['skillpara'])) return false;
    foreach ($actor['skillpara'] as $skill_id => &$skill_state) {
        $definition = skill_effect_definition((string)$skill_id);
        if (!$definition || !is_array($skill_state)) continue;
        $before_format = serialize($skill_state);
        skill_effect_format_skill_state((string)$skill_id, $skill_state);
        if ($before_format !== serialize($skill_state)) $changed = true;
        foreach ($skill_state['effect_instances'] as $uid => $instance) {
            if (($instance['state'] ?? '') !== 'active') continue;
            $expires = isset($instance['expires_at_tick']) ? (int)$instance['expires_at_tick'] : PHP_INT_MAX;
            if ($current_tick >= $expires) {
                unset($skill_state['effect_instances'][$uid]);
                $changed = true;
            }
        }
        if (empty($skill_state['effect_instances'])) {
            unset($actor['skillpara'][$skill_id]);
        }
    }
    unset($skill_state);
    return $changed;
}

// 计算下一个可行动 tick（用于 capability 评估 + 命令门控）
function skill_effect_next_action_tick(): int {
    $tick = function_exists('obl_tick_get') ? (int)obl_tick_get() : 0;
    $pretick = function_exists('obl_tick_get_pretick') ? (int)obl_tick_get_pretick() : $tick;
    return max($tick, $pretick + 1);
}

// tick post 监听器：在每个 tick 结束后对玩家+敌人执行 GC 回收过期效果
function skill_effect_tick_post_listener($delta, &$ctx): void {
    $tick = function_exists('obl_tick_get') ? (int)obl_tick_get() : 0;
    $player = &$ctx['player'];
    if (is_array($player) && skill_effect_gc($player, $tick)) {
        obl_save_player($player);
        if (function_exists('obl_tick_ctx_add_changed_scopes')) {
            obl_tick_ctx_add_changed_scopes($ctx, array('player_info', 'combat_targets'));
        }
    }
    $region = is_array($player) ? (int)($player['pgroup'] ?? 0) : 0;
    if ($region <= 0 || !function_exists('obl_fetch_enemies_by_region')) return;
    foreach (obl_fetch_enemies_by_region($region) as $enemy) {
        if (!skill_effect_gc($enemy, $tick)) continue;
        obl_save_player($enemy);
        if (function_exists('obl_tick_ctx_add_changed_scopes')) {
            obl_tick_ctx_add_changed_scopes($ctx, array('enemies', 'combat_targets'));
        }
    }
}

// 向 tick 系统注册 post 监听器（幂等，避免重复注册）
function skill_effect_register_tick_listener(): void {
    if (!function_exists('obl_tick_register_listener')) return;
    foreach (obl_tick_get_listeners('post') as $listener) {
        if ($listener === 'skill_effect_tick_post_listener') return;
    }
    obl_tick_register_listener('post', 'skill_effect_tick_post_listener');
}
