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

function combat_chain_failure_result(string $act_id, string $reason, int $ap_cost = 0): array {
    return [
        'act_id' => $act_id,
        'success' => false,
        'reason' => $reason,
        'ap_cost' => $ap_cost,
        'effects' => [],
    ];
}

function combat_chain_success_result(string $act_id, int $ap_cost, array $effects): array {
    return [
        'act_id' => $act_id,
        'success' => true,
        'reason' => null,
        'ap_cost' => $ap_cost,
        'effects' => $effects,
    ];
}

function combat_chain_emit_failure_if_needed(array $options, &$log, array $actor_data, string $act_id, string $reason, array $extra = []): void {
    if (empty($options['emit_failures'])) return;
    combat_emit_action_failure($log, $actor_data, $act_id, $reason, $extra);
}

function combat_chain_collect_effects(CombatContext $ctx): array {
    $effects = [];
    foreach ($ctx->targets as $target) {
        foreach (($target['effects'] ?? []) as $effect) {
            $effects[] = $effect;
        }
    }
    return $effects;
}

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
function combat_chain_project(array $actor_data, array $actions, array $battle_cache, &$log = null, array $options = []): array {
    combat_sort_actions($actions);

    $sim_actor = $actor_data;
    $sim_battle_cache = $battle_cache;
    combat_planned_state_init($sim_actor, $sim_battle_cache);

    $verified_actions = [];
    $results = [];
    $total_ap_cost = 0;
    $pending_cd_usage = [];

    foreach ($actions as $action) {
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

        combat_skill_load_module($act_id);
        combat_target_resolve_all($ctx);
        combat_debug_log('CHAIN_TARGET', ['act_id'=>$act_id, 'success'=>$ctx->success, 'failure_reason'=>$ctx->failure_reason, 'targets_count'=>count($ctx->targets), 'sim_pls'=>(int)($sim_actor['pls'] ?? 0)]);
        if (!$ctx->success) {
            $reason = 'target_resolve_failed:' . ($ctx->failure_reason ?? 'unknown');
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, $reason);
            $results[] = combat_chain_failure_result($act_id, $reason);
            continue;
        }

        combat_stage_check_rules($ctx);
        $rules_result = [
            'pass' => $ctx->success,
            'reason' => $ctx->failure_reason,
            'valid_target_count' => combat_context_valid_target_count($ctx),
            'total_target_count' => count($ctx->targets),
        ];
        combat_debug_log('CHAIN_RULES', ['act_id'=>$act_id, 'rules'=>$rules_result]);
        if (empty($rules_result['pass'])) {
            $raw_reason = (string)($rules_result['reason'] ?? 'unknown');
            if (strpos($raw_reason, 'all_targets_skipped:') === 0) {
                $raw_reason = substr($raw_reason, strlen('all_targets_skipped:'));
            }
            $reason = 'rule_failed:' . ($raw_reason !== '' ? $raw_reason : 'unknown');
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, $reason, $rules_result);
            $results[] = combat_chain_failure_result($act_id, $reason);
            continue;
        }

        $ap_cost = combat_ap_calculate($ctx);
        $actor_ap = (int)($sim_actor['ap'] ?? 0);
        combat_debug_log('CHAIN_AP', ['act_id'=>$act_id, 'ap_cost'=>$ap_cost, 'actor_ap'=>$actor_ap, 'sim_pls'=>(int)($sim_actor['pls'] ?? 0)]);
        if ($actor_ap - $ap_cost < 0) {
            combat_chain_emit_failure_if_needed($options, $log, $actor_data, $act_id, 'ap_insufficient', [
                'ap_have' => $actor_ap,
                'ap_cost' => $ap_cost,
            ]);
            $results[] = combat_chain_failure_result($act_id, 'ap_insufficient', $ap_cost);
            continue;
        }

        $ctx->ap_cost = $ap_cost;
        combat_planned_state_spend_ap($ctx->actor_data, $ctx->battle_cache, $ap_cost);

        combat_chain_execute_and_project($ctx);
        if (!$ctx->success) {
            $reason = $ctx->failure_reason ?? 'project_failed';
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

        $results[] = combat_chain_success_result($act_id, $ap_cost, combat_chain_collect_effects($ctx));
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
