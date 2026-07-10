<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// throw 技能钩子
//
// 验收点：自定义 ap_calc 注册 + 远程射程 + L0 可达性
//
// 模块加载时注册 throw_distance AP 计算器（combat_ap_register）。
// combat_ap_calculate 按 calc_id='throw_distance' 分发到本计算器。
// 计算公式：ceil(distance / 2)，最少 1 AP。
// ================================================================

// 注册自定义 AP 计算器（模块加载时执行一次，require_once 保证幂等）
combat_ap_register('throw_distance', function (CombatContext $ctx): int {
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        return (int)($ctx->config['apcost'] ?? 1);
    }

    $distance = obl_get_distance(
        (int)($ctx->actor_data['pgroup'] ?? 0),
        (int)($ctx->actor_data['pls'] ?? 0),
        (int)($target_data['pls'] ?? 0)
    );

    if ($distance <= 0) {
        return (int)($ctx->config['apcost'] ?? 1);
    }

    return max(1, (int)ceil($distance / 2));
});

/**
 * @param CombatContext $ctx
 */
function skill_throw_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        $ctx->success = false;
        $ctx->failure_reason = 'throw_target_missing';
        return;
    }

    $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);

    $ctx->declareEffect('damage', [
        'value'      => $damage,
    ]);
}
