<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * Execute one action through Aim -> Capture -> ordered TargetResolutionUnit.
 */
function combat_pipeline_run(CombatContext $ctx): void {
    $actor_capability = actor_capability_decide(
        $ctx->actor_data,
        'combat_action',
        array('qid' => (int)($ctx->actor_data['bid'] ?? 0), 'dry_run' => $ctx->dry_run),
        combat_current_evaluation_tick()
    );
    if (empty($actor_capability['allowed'])) {
        $ctx->success = false;
        $ctx->failure_reason = 'CAPABILITY_BLOCKED:combat_action';
        return;
    }
    combat_aim_resolve($ctx);
    if (!$ctx->success) return;

    $aim_rules = combat_aim_check_rules($ctx);
    if (empty($aim_rules['pass'])) {
        $ctx->success = false;
        $ctx->failure_reason = 'AIM_RULE_FAILED:' . ($aim_rules['reason'] ?? 'unknown');
        return;
    }

    combat_capture_resolution_targets($ctx);
    if (!$ctx->success) return;

    combat_target_units_run($ctx);
}

/**
 * Commit the action-level cooldown/usage marker once resources are accepted.
 */
function combat_stage_persist_lstact(CombatContext $ctx): void {
    global $gamevars;

    $cd = (int)($ctx->config['cd'] ?? 0);
    $record_usage = !empty($ctx->config['record_usage']);
    if ($cd <= 0 && !$record_usage) return;

    if (!isset($ctx->actor_data['skillpara']) || !is_array($ctx->actor_data['skillpara'])) {
        $ctx->actor_data['skillpara'] = [];
    }
    if (!isset($ctx->actor_data['skillpara'][$ctx->act_id]) || !is_array($ctx->actor_data['skillpara'][$ctx->act_id])) {
        $ctx->actor_data['skillpara'][$ctx->act_id] = [];
    }

    $ctx->actor_data['skillpara'][$ctx->act_id]['lstact'] = (int)($gamevars['obl_tick'] ?? 0);
}
