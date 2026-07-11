<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — ActionChain projector
//
// 职责：
//   - 统一 verify 与 preview_chain 的动作链 dry-run 语义
//   - 按动作顺序维护 planned state
//   - 通过技能钩子声明 effects，再用 projector 投影到 planned state
// ================================================================

// 构建动作链单步失败结果，含 act_id / reason / ap_cost
function combat_chain_failure_result(string $act_id, string $reason, int $ap_cost = 0): array {
    return [
        'act_id' => $act_id,
        'success' => false,
        'reason' => $reason,
        'ap_cost' => $ap_cost,
        'effects' => [],
    ];
}

// 构建动作链单步成功结果，含 act_id / ap_cost / effects 及额外元数据
function combat_chain_success_result(string $act_id, int $ap_cost, array $effects, array $extra = []): array {
    return array_merge([
        'act_id' => $act_id,
        'success' => true,
        'reason' => null,
        'ap_cost' => $ap_cost,
        'effects' => $effects,
    ], $extra);
}

// 条件发射失败日志：仅在 options.emit_failures = true 时输出 battlelog 失败事件
function combat_chain_emit_failure_if_needed(array $options, &$log, array $actor_data, string $act_id, string $reason, array $extra = []): void {
    if (empty($options['emit_failures'])) return;
    combat_emit_action_failure($log, $actor_data, $act_id, $reason, $extra);
}

// 收集当前 action 对所有 target 产生的全部 effect，用于 preview 返回
function combat_chain_collect_effects(CombatContext $ctx): array {
    $effects = [];
    foreach ($ctx->targets as $target) {
        foreach (($target['effects'] ?? []) as $effect) {
            $effects[] = $effect;
        }
    }
    return $effects;
}

// 执行 skills 的 execute 钩子并对所有 target 运行 effect projector（dry-run 投影阶段）
function combat_chain_execute_and_project(CombatContext $ctx): void {
    combat_skill_load_module($ctx->act_id);

    $func = "skill_{$ctx->act_id}_execute";
    if (!function_exists($func)) {
        $ctx->success = false;
        $ctx->failure_reason = "execute_hook_missing:{$func}";
        return;
    }

    $count = count($ctx->targets);
    for ($i = 0; $i < $count; $i++) {
        if (!empty($ctx->targets[$i]['skip'])) continue;
        $ctx->current_target_index = $i;
        $ctx->invalidateTagsCache();

        $func($ctx);
        if (!$ctx->success) return;

        combat_effect_project_all($ctx);
        if (!$ctx->success) return;
    }
}

/**
 * Project a sorted action chain against planned state.
 *
 * @param array $actor_data
 * @param array $actions
 * @param array $battle_cache
 * @param mixed $log
 * @param array $options
 * @return array
 */
// 动作链投影主入口：按顺序 dry-run 多个 action，校验合法性 + 模拟效果 + 累积消耗
// 返回 verified_actions（通过校验的 action 列表）/ actions（逐步结果）/ total_ap_cost / actor_final_state
function combat_chain_project(array $actor_data, array $actions, array $battle_cache, &$log = null, array $options = []): array {
    combat_sort_actions($actions);

    $sim_actor = $actor_data;
    $sim_battle_cache = $battle_cache;
    combat_planned_state_init($sim_actor, $sim_battle_cache);

    $verified_actions = [];
    $results = [];
    $total_ap_cost = 0;
    $pending_cd_usage = [];

    foreach ($actions as $action_index => $action) {
        $action['_action_index'] = (int)$action_index;
        $act_id = (string)($action['act_id'] ?? '');
        if ($act_id === '') {
            $results[] = combat_chain_failure_result('', 'invalid_action');
            continue;
        }

        if (combat_actor_terminated($sim_actor, $sim_battle_cache)) {
            $results[] = combat_chain_failure_result($act_id, 'actor_terminated');
            break;
        }

        $config = combat_skill_get_config($act_id);
        if ($config === null) {
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, "skill_not_found:{$act_id}");
            $results[] = combat_chain_failure_result($act_id, 'skill_not_found');
            continue;
        }

        if (!empty($options['check_ownership']) && !combat_skill_actor_owns($actor_data, $act_id, $config)) {
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, 'skill_not_owned');
            $results[] = combat_chain_failure_result($act_id, 'skill_not_owned');
            continue;
        }

        $cd = (int)($config['cd'] ?? 0);
        if (!empty($options['check_cd'])) {
            if ($cd > 0 && !empty($pending_cd_usage[$act_id])) {
                combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, 'cooldown_pending');
                $results[] = combat_chain_failure_result($act_id, 'cooldown_pending');
                continue;
            }

            $cd_result = combat_skill_cd_check($actor_data, $act_id, $config);
            if (empty($cd_result['pass'])) {
                combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, 'cooldown', $cd_result);
                $results[] = combat_chain_failure_result($act_id, 'cooldown');
                continue;
            }
        }

        $target_intent = combat_action_normalize_target(
            array_key_exists('target', $action) ? $action['target'] : null,
            $config,
            (int)($sim_actor['pid'] ?? 0)
        );
        if ($target_intent === null) {
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, 'invalid_target');
            $results[] = combat_chain_failure_result($act_id, 'invalid_target');
            continue;
        }
        $action['target'] = $target_intent;

        $ctx = new CombatContext($sim_actor, $act_id, combat_action_config_with_target($config, $action), $log, $sim_battle_cache);
        $ctx->dry_run = true;
        $ctx->action_uid = 'preview-q' . (int)($sim_actor['bid'] ?? 0)
            . '-p' . (int)($sim_actor['pid'] ?? 0)
            . '-a' . (int)$action_index
            . '-' . preg_replace('/[^a-zA-Z0-9_:-]/', '_', $act_id);

        combat_skill_load_module($act_id);
        combat_aim_resolve($ctx);
        if ($ctx->success) {
            $aim_rules = combat_aim_check_rules($ctx);
            if (empty($aim_rules['pass'])) {
                $ctx->success = false;
                $ctx->failure_reason = 'AIM_RULE_FAILED:' . ($aim_rules['reason'] ?? 'unknown');
            }
        }
        if ($ctx->success) combat_capture_resolution_targets($ctx);
        if (!$ctx->success) {
            $reason = 'target_resolve_failed:' . ($ctx->failure_reason ?? 'unknown');
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, $reason);
            $results[] = combat_chain_failure_result($act_id, $reason);
            continue;
        }

        $ap_cost = combat_ap_calculate($ctx);
        $actor_ap = (int)($sim_actor['ap'] ?? 0);
        if ($actor_ap - $ap_cost < 0) {
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, 'ap_insufficient', [
                'ap_have' => $actor_ap,
                'ap_cost' => $ap_cost,
            ]);
            $results[] = combat_chain_failure_result($act_id, 'ap_insufficient', $ap_cost);
            continue;
        }

        $actor_before_action = $sim_actor;
        $cache_before_action = $sim_battle_cache;
        $ctx->ap_cost = $ap_cost;
        combat_action_reserve_resources($ctx);

        combat_target_units_run($ctx);
        if (!$ctx->success) {
            $reason = $ctx->failure_reason ?? 'project_failed';
            $sim_actor = $actor_before_action;
            $sim_battle_cache = $cache_before_action;
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, $reason);
            $results[] = combat_chain_failure_result($act_id, $reason, $ap_cost);
            continue;
        }

        $sim_actor = $ctx->actor_data;
        $sim_battle_cache = $ctx->battle_cache;
        $action['_ap_cost'] = $ap_cost;
        $verified_actions[] = $action;
        $total_ap_cost += $ap_cost;
        if ($cd > 0) {
            $pending_cd_usage[$act_id] = true;
        }

        $results[] = combat_chain_success_result($act_id, $ap_cost, combat_chain_collect_effects($ctx), [
            'resolved_aim' => $ctx->resolved_aim,
            'captured_target_count' => count($ctx->targets),
            'target_results' => $ctx->target_results,
        ]);
    }

    return [
        'verified_actions' => $verified_actions,
        'actions' => $results,
        'total_ap_cost' => $total_ap_cost,
        'actor_final_state' => [
            'ap' => (int)($sim_actor['ap'] ?? 0),
            'hp' => (int)($sim_actor['hp'] ?? 0),
            'pgroup' => (int)($sim_actor['pgroup'] ?? 0),
            'pls' => (int)($sim_actor['pls'] ?? 0),
            'state' => (int)($sim_actor['state'] ?? 0),
        ],
        'battle_cache' => $sim_battle_cache,
    ];
}
