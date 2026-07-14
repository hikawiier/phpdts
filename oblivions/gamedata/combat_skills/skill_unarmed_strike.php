<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// unarmed_strike 技能钩子
//
// 验收点：attack 管道完整 8 阶段 + pid 目标 + 死亡检测
//
// 钩子职责：
//   - 调 obl_calc_damage_value 算伤害
//   - 声明 damage 效果到当前 target
//
// 禁止：直接改 actor_data / battle_cache / tag_mutations / 调 obl_save_player
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_unarmed_strike_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        $ctx->success = false;
        $ctx->failure_reason = 'unarmed_strike_target_missing';
        return;
    }

    $damage = obl_calc_damage_value($ctx->actor_data, $target_data, $ctx->config);

    $ctx->declareEffect('damage', [
        'value'      => $damage,
    ]);
}
