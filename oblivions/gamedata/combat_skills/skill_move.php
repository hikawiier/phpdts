<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// move 技能钩子
//
// 验收点：utility 管道 + tile 目标 + 动态 AP + move 特例副作用
//
// move 在真实 execute 阶段调 obl_perform_move_core 原子化改 actor.pls。
// dry_run / verify 阶段只声明 move effect，由 effect projector 投影 planned state。
// ================================================================

/**
 * @param CombatContext $ctx
 */
function skill_move_execute(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_target_missing';
        return;
    }

    $to_pls = (int)($target_data['pls'] ?? 0);
    $from_pls = (int)($ctx->actor_data['pls'] ?? 0);

    $decision = combat_spatial_decide($ctx, $target_data);
    if (empty($decision['allowed'])) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_spatial_rejected:' . (string)($decision['reason'] ?? 'unknown');
        return;
    }
    if ($ctx->ap_cost > 0 && (int)$decision['target_ap_cost'] !== (int)$ctx->ap_cost) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_ap_quote_changed';
        return;
    }

    $ctx->declareEffect('move', [
        'from_pls' => $from_pls,
        'to_pls'   => $to_pls,
        'distance' => (int)$decision['distance'],
        'spatial_decision' => $decision,
    ]);
}
