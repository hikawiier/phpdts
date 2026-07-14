<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * 执行单个 action 的完整管道：Aim（瞄准解析）→ Capture（捕获目标数据）→ TargetResolutionUnit（逐目标结算）
 *
 * 管道路径：
 * 1. Capability 检查——当前 actor 是否有 combat_action 资格
 * 2. combat_aim_resolve——将前端意图解析为领域目标
 * 3. combat_aim_check_rules——验证 Aim 是否符合技能配置的规则（观察、遮挡等）
 * 4. combat_capture_resolution_targets——捕获目标的全量数据快照
 * 5. combat_target_units_run——按顺序逐个 target 执行完整 resolution
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
 * 持久化 action 的 CD/use 标记：确认资源扣除后写入 lstact（last action tick）
 * 仅在技能配置了 cd > 0 或 record_usage = true 时执行
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
