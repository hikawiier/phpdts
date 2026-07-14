<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// escape 技能钩子
//
// 验收点：none 目标不查 DB + escape 效果 + 状态清理
//
// 钩子只声明 escape 效果，实际状态修改由 combat_effect_escape 应用器完成：
//   - 写 tag_mutations[pid]['escaped']=true（逃离只在当前 battle_cache 中表达）
//   - combatants[pid]=0
// 后续 cleanup 由 combat_state_clear 处理（退队列 + 恢复 AP + 保存）
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_escape_execute(CombatContext $ctx): void {
    $ctx->declareEffect('escape', []);
    $ctx->declareEffect('skill_effect_apply', [
        'skill_id' => 'flustered',
        'scope' => 'actor',
        'activation' => [
            'boundary' => 'battle_disband',
            'boundary_id' => (int)($ctx->actor_data['bid'] ?? 0),
            'delay_ticks' => 1,
        ],
    ]);
}
