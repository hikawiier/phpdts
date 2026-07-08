<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// move 技能钩子
//
// 验收点：utility 管道 + tile 目标 + 动态 AP + move 特例副作用
//
// move 是特例：execute 阶段调 obl_perform_move_core 有副作用（改 actor.pls）。
// 原因：位置必须原子化更新，避免并发占用（resolve_effects 阶段才改太晚）。
// 效果只声明 move 日志（from_pls / to_pls / distance），不改位置。
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

    $result = obl_perform_move_core($ctx->actor_data, $to_pls);
    if (!$result['success']) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_failed:' . $result['reason'];
        return;
    }

    $ctx->declareEffect('move', [
        'from_pls' => $from_pls,
        'to_pls'   => $to_pls,
        'distance' => $result['distance'],
    ]);
}
