<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// grenade 技能钩子
//
// 验收点：tile 目标 + damage 多 pid 展开
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_grenade_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $tile = $target['target_data'] ?? null;
    if (!is_array($tile)) {
        $ctx->success = false;
        $ctx->failure_reason = 'grenade_target_missing';
        return;
    }

    $pgroup = (int)($tile['pgroup'] ?? 0);
    $pls = (int)($tile['pls'] ?? 0);
    if ($pgroup <= 0 || $pls <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'grenade_tile_invalid';
        return;
    }

    $victim_pids = obl_get_pids_in_tile($pgroup, $pls, (int)($ctx->actor_data['pid'] ?? 0));
    foreach ($victim_pids as $pid) {
        $target_data = function_exists('combat_planned_state_get_player')
            ? combat_planned_state_get_player($ctx->battle_cache, (int)$pid)
            : null;
        if (!$target_data) {
            $target_data = obl_fetch_playerdata_by_pid((int)$pid);
        }
        if (!is_array($target_data)) continue;

        $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);
        $ctx->declareEffect('damage', [
            'value'      => $damage,
            'target_pid' => (int)$pid,
        ]);
    }
}
