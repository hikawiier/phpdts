<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// vampiric_bite 技能钩子
//
// 验收点：多效果组合 + FIFO + 效果间数据共享
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_vampiric_bite_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        $ctx->success = false;
        $ctx->failure_reason = 'vampiric_bite_target_missing';
        return;
    }

    $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);
    $heal = (int)ceil($damage * (float)($ctx->config['heal_ratio'] ?? 0.5));

    $ctx->declareEffect('damage', [
        'value'      => $damage,
    ]);
    $ctx->declareEffect('heal', [
        'value'      => $heal,
        'scope'      => 'actor',
    ]);
}
