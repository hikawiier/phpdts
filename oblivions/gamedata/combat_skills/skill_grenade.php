<?php
/**
 * @module D 战斗系统（Combat）
 */
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
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data) || (int)($target_data['pid'] ?? 0) <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'grenade_target_missing';
        return;
    }
    $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);
    $ctx->declareEffect('damage', ['value' => $damage]);
}
