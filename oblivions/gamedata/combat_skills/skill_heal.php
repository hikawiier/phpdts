<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// heal 技能钩子
//
// 验收点：self 目标引用 + heal 效果上限 mhp
//
// self 解析器令 target_data = &$actor_data（引用），修改 target_data 等于
// 修改 actor_data（引用硬约束见 spec §4）。heal 应用器读 mhp 做上限裁剪。
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_heal_execute(CombatContext $ctx): void {
    $heal_value = (int)($ctx->config['heal_value'] ?? 20);

    $ctx->declareEffect('heal', [
        'value'      => $heal_value,
    ]);
}
