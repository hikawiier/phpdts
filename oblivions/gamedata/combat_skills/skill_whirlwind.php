<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// whirlwind 技能钩子
//
// 验收点：多目标迭代 + effects per-target 不重复
//
// target='all' 时管道对每个 combatant 迭代：
//   check_rules → snapshot → execute → resolve_effects → post_check
//
// 钩子只声明 damage 到当前 target（getCurrentTarget），管道保证每个 target
// 的 effects 独立应用 1 次（不重复）—— 这是 phase2 修复的核心 bug。
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_whirlwind_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        $ctx->success = false;
        $ctx->failure_reason = 'whirlwind_target_missing';
        return;
    }

    $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);

    $ctx->declareEffect('damage', [
        'value'      => $damage,
        'target_pid' => (int)($target_data['pid'] ?? 0),
    ]);
}
