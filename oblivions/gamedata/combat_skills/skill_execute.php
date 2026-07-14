<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// execute 技能钩子
//
// 验收点：finisher 排序 + 低血量目标伤害倍率
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_execute_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        $ctx->success = false;
        $ctx->failure_reason = 'execute_target_missing';
        return;
    }

    $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);
    $hp = (int)($target_data['hp'] ?? 0);
    $mhp = max(1, (int)($target_data['mhp'] ?? 1));
    $threshold = (float)($ctx->config['execute_threshold'] ?? 0.3);

    if (($hp / $mhp) < $threshold) {
        $damage = (int)ceil($damage * (float)($ctx->config['execute_multiplier'] ?? 2.0));
    }

    $ctx->declareEffect('damage', [
        'value'      => $damage,
    ]);
}
