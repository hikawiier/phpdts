<?php
/**
 * @module D 战斗系统（Combat）
 * @framework D-5 目标结算单元
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 构建单个 target 的结算结果，包含 pid / status / participation / effects
function combat_target_unit_result(array $target, string $status, ?string $reason, string $participation, array $effects = []): array {
    return [
        'pid' => (int)($target['pid'] ?? 0),
        'status' => $status,
        'reason' => $reason,
        'participation' => $participation,
        'effects' => $effects,
    ];
}

// 绑定最新数据：在 per-target resolution 执行前，重新读取目标的当前状态
// 实际结算阶段使用 FOR UPDATE 锁定行，dry-run 只从计划状态读取
function combat_target_unit_bind_latest(CombatContext $ctx, int $index): ?array {
    $target = &$ctx->targets[$index];
    $kind = (string)($target['kind'] ?? 'none');
    if ($kind === 'self') {
        $target['target_data'] = &$ctx->actor_data;
        return null;
    }
    if ($kind !== 'character') return null;
    $pid = (int)($target['pid'] ?? 0);
    if ($ctx->dry_run) {
        $latest = combat_target_capture_player($ctx, $pid);
        if (!$latest) return null;
        $target['target_data'] = $latest;
        return null;
    }
    $latest = obl_fetch_playerdata_by_pid_for_update($pid);
    if (!$latest) return null;
    $target['target_data'] = $latest;
    $row = obl_fetch_queue_by_pid_for_update($pid);
    return $row ?: null;
}

// 对当前 target 执行技能 capture 阶段配置的规则校验
function combat_target_unit_check_rules(CombatContext $ctx): array {
    $original = $ctx->config['rules'] ?? ['forbid' => []];
    $ctx->config['rules'] = ['forbid' => array_values($ctx->config['capture']['rules'] ?? [])];
    $ctx->invalidateTagsCache();
    $result = combat_check_target_rules($ctx->config, $ctx->getCurrentTags());
    $ctx->config['rules'] = $original;
    return $result;
}

// 预扣资源（AP）：在 action 执行前保留 actor 的 AP，确保消耗一致性
// 仅执行一次，幂等保护
function combat_action_reserve_resources(CombatContext $ctx): void {
    if ($ctx->resources_reserved) return;
    $ctx->resources_reserved = true;
    $ctx->ap_before = (int)($ctx->actor_data['ap'] ?? 0);
    $ctx->ap_after = max(0, $ctx->ap_before - max(0, $ctx->ap_cost));
    $ctx->actor_data['ap'] = $ctx->ap_after;
    $ctx->storeRuntimePlayer($ctx->actor_data);
}

// 恢复未提交的预扣资源：当 action 失败时回滚 AP 到预扣前的状态
function combat_action_restore_uncommitted_resources(CombatContext $ctx): void {
    if (!$ctx->resources_reserved || $ctx->resources_committed) return;
    $ctx->actor_data['ap'] = $ctx->ap_before;
    $ctx->ap_after = $ctx->ap_before;
    $ctx->storeRuntimePlayer($ctx->actor_data);
}

// 提交资源：将预扣的 AP 正式写入 DB（仅实际结算阶段，dry-run 跳过）
function combat_action_commit_resources(CombatContext $ctx): void {
    if ($ctx->resources_committed) return;
    combat_action_reserve_resources($ctx);
    $ctx->resources_committed = true;
    if ($ctx->dry_run) return;
    combat_stage_persist_lstact($ctx);
    $ctx->storeRuntimePlayer($ctx->actor_data);
    obl_save_player($ctx->actor_data);
}

// Action 开始：发射 action_start 日志事件（仅实际结算阶段）
function combat_action_begin(CombatContext $ctx): void {
    if (!$ctx->event_action_started && !$ctx->dry_run) combat_log_v3_action_start($ctx);
}

// Action 交付：调用技能 execute 钩子执行实际效果（dry-run 跳过）
// 每个 action 仅执行一次，幂等保护
function combat_action_delivery(CombatContext $ctx): void {
    if ($ctx->delivery_executed) return;
    $ctx->delivery_executed = true;
    if ($ctx->dry_run) return;
    $delivery_config = is_array($ctx->config['delivery'] ?? null) ? $ctx->config['delivery'] : [];
    $deliveries = isset($delivery_config['types']) && is_array($delivery_config['types'])
        ? array_values($delivery_config['types'])
        : [];
    if (!function_exists('combat_log_v3_action_delivery')) return;
    foreach ($deliveries as $delivery) {
        $delivery = (string)$delivery;
        if ($delivery === '') continue;
        combat_log_v3_action_delivery($ctx, $delivery, $ctx->resolved_aim);
    }
}

// 声明当前 target 的 effects：调用技能 execute 钩子，检查是否成功声明了 effect
function combat_target_unit_declare_effects(CombatContext $ctx): bool {
    combat_skill_load_module($ctx->act_id);
    $func = "skill_{$ctx->act_id}_execute";
    if (!function_exists($func)) {
        $ctx->failure_reason = "execute_hook_missing:{$func}";
        return false;
    }
    $ctx->success = true;
    $ctx->failure_reason = null;
    $func($ctx);
    return $ctx->success && !empty($ctx->getCurrentEffects());
}

// 持久化 target 与 actor 的最新状态到 runtime 缓存和 DB（dry-run 跳过 DB 写入）
function combat_target_unit_persist(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $data = $target['target_data'] ?? null;
    if (is_array($data) && (int)($data['pid'] ?? 0) > 0) {
        $ctx->storeRuntimePlayer($data);
        if (!$ctx->dry_run && (int)$data['pid'] !== (int)($ctx->actor_data['pid'] ?? 0)) obl_save_player($data);
    }
    $ctx->storeRuntimePlayer($ctx->actor_data);
    if (!$ctx->dry_run) obl_save_player($ctx->actor_data);
}

// 当目标 combatant 标记为 terminated（dead/escaped）时，根据 tag_mutations 中的原因发射清场日志并清理状态
function combat_target_unit_clear_current_if_needed(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $data = &$target['target_data'];
    if (!is_array($data)) return;
    $pid = (int)($data['pid'] ?? 0);
    if ($pid <= 0 || (int)($ctx->battle_cache['combatants'][$pid] ?? 1) !== 0) return;

    $mutations = $ctx->battle_cache['tag_mutations'][$pid] ?? [];
    $reason = !empty($mutations['escaped']) ? 'escaped'
        : (!empty($mutations['dead']) ? 'dead' : 'unknown');
    if (!$ctx->dry_run) {
        $extra = [];
        if ($reason === 'escaped' && isset($mutations['retreat_target'])) {
            $extra = [
                'delta' => [
                    'pls_before' => (int)($mutations['retreat_from_pls'] ?? $data['pls'] ?? 0),
                    'pls_after' => (int)($mutations['retreat_target']['pls'] ?? $data['pls'] ?? 0),
                ],
                'detail' => [
                    'retreat_target' => $mutations['retreat_target'],
                    'visual_policy' => (string)($mutations['retreat_visual_policy'] ?? 'settle-in-place'),
                ],
            ];
        }
        $escape_effect_uids = $ctx->event_effect_uids_by_type['escape'] ?? [];
        $effect_uid = !empty($escape_effect_uids) ? end($escape_effect_uids) : null;
        combat_log_v3_combatant_cleared($ctx->log, $data, $reason, $ctx->action_uid, $effect_uid, $extra);
        combat_state_clear($pid, $reason, $data, $ctx->battle_cache, $ctx->log);
    } else {
        if ($reason === 'dead') $data['state'] = 1;
        $data['action'] = '';
        $data['ap'] = $data['max_ap'] ?? $data['ap'] ?? 0;
        $ctx->storeRuntimePlayer($data);
    }
}

// 开启 DB SAVEPOINT：为 per-target 结算设置回滚点，业务失败时可回滚到此点
function combat_target_unit_savepoint_begin(CombatContext $ctx, int $index): ?string {
    if ($ctx->dry_run) return null;
    global $db;
    $name = 'obl_target_' . max(0, $index);
    $db->query("SAVEPOINT {$name}");
    return $name;
}

// 回滚到指定 SAVEPOINT（业务失败时，撤销当前 target 的 DB 变更）
function combat_target_unit_savepoint_rollback(?string $name): void {
    if ($name === null) return;
    global $db;
    $db->query("ROLLBACK TO SAVEPOINT {$name}");
    $db->query("RELEASE SAVEPOINT {$name}");
}

// 释放 SAVEPOINT（当前 target 成功结算后，不再需要保留回滚点）
function combat_target_unit_savepoint_release(?string $name): void {
    if ($name === null) return;
    global $db;
    $db->query("RELEASE SAVEPOINT {$name}");
}

// 单 target 完整结算：绑定最新数据 → 规则校验 → 参与状态分类 → 声明 effect → delivery → enlist → 应用效果 → persist
// 使用 SAVEPOINT 保证原子性：业务失败时回滚到结算前状态，actor 继续执行后续 target
function combat_resolve_target_unit(CombatContext $ctx, int $index): array {
    $ctx->current_target_index = $index;
    $target = &$ctx->targets[$index];
    $queue_row = combat_target_unit_bind_latest($ctx, $index);
    if (($target['kind'] ?? '') === 'character' && !is_array($target['target_data'] ?? null)) {
        return combat_target_unit_result($target, 'skipped', 'TARGET_NOT_FOUND', 'rejected');
    }

    $rules = combat_target_unit_check_rules($ctx);
    if (empty($rules['pass'])) return combat_target_unit_result($target, 'skipped', $rules['reason'] ?? 'TARGET_RULE_FAILED', 'rejected');

    $decision = ($target['kind'] ?? '') === 'character'
        ? ($ctx->dry_run ? combat_participation_classify($ctx, $target) : combat_participation_classify_data($ctx, $target['target_data'], $queue_row))
        : combat_participation_result('not_applicable');
    if (in_array($decision['state'], ['left', 'other_battle', 'blocked'], true)) {
        return combat_target_unit_result($target, 'skipped', $decision['reason'] ?? 'TARGET_REJECTED', 'rejected');
    }

    if (!combat_target_unit_declare_effects($ctx)) {
        $reason = $ctx->failure_reason ?? 'NO_EXECUTABLE_EFFECT';
        $ctx->success = true;
        $ctx->failure_reason = null;
        return combat_target_unit_result($target, 'skipped', $reason, $decision['state']);
    }

    $actor_before = $ctx->actor_data;
    $cache_before = $ctx->battle_cache;
    $target_before = $target;
    $resources_before = $ctx->resources_committed;
    $action_started_before = $ctx->event_action_started;
    $delivery_before = $ctx->delivery_executed;
    $effect_uids_before = $ctx->event_effect_uids;
    $effect_uids_by_type_before = $ctx->event_effect_uids_by_type;
    $log_checkpoint = is_object($ctx->log) && method_exists($ctx->log, 'checkpoint')
        ? $ctx->log->checkpoint()
        : null;
    $savepoint = combat_target_unit_savepoint_begin($ctx, $index);

    combat_action_begin($ctx);
    combat_action_delivery($ctx);
    $enlist = combat_participation_enlist($ctx, $target, $decision);
    if (empty($enlist['ok'])) {
        combat_target_unit_savepoint_rollback($savepoint);
        $ctx->actor_data = $actor_before;
        $ctx->battle_cache = $cache_before;
        $ctx->targets[$index] = $target_before;
        $ctx->resources_committed = $resources_before;
        $ctx->event_action_started = $action_started_before;
        $ctx->delivery_executed = $delivery_before;
        $ctx->event_effect_uids = $effect_uids_before;
        $ctx->event_effect_uids_by_type = $effect_uids_by_type_before;
        if ($log_checkpoint !== null) $ctx->log->rollbackTo($log_checkpoint);
        return combat_target_unit_result($target, 'skipped', $enlist['code'] ?? 'TARGET_REJECTED', 'rejected');
    }

    $ctx->snapshotTargetState();
    if ($ctx->dry_run) combat_effect_project_all($ctx);
    else combat_effect_apply_all($ctx);
    if (!$ctx->success) {
        $reason = $ctx->failure_reason ?? 'EFFECT_FAILED';
        combat_target_unit_savepoint_rollback($savepoint);
        $ctx->actor_data = $actor_before;
        $ctx->battle_cache = $cache_before;
        $ctx->targets[$index] = $target_before;
        $ctx->resources_committed = $resources_before;
        $ctx->event_action_started = $action_started_before;
        $ctx->delivery_executed = $delivery_before;
        $ctx->event_effect_uids = $effect_uids_before;
        $ctx->event_effect_uids_by_type = $effect_uids_by_type_before;
        if ($log_checkpoint !== null) $ctx->log->rollbackTo($log_checkpoint);
        $ctx->success = true;
        $ctx->failure_reason = null;
        return combat_target_unit_result($target, 'skipped', $reason, $enlist['participation'] ?? $decision['state']);
    }
    combat_action_commit_resources($ctx);
    if (($ctx->config['pipeline'] ?? 'attack') === 'attack') combat_state_post_check($ctx);
    combat_target_unit_clear_current_if_needed($ctx);
    combat_target_unit_persist($ctx);
    combat_target_unit_savepoint_release($savepoint);
    $ctx->any_target_resolved = true;
    return combat_target_unit_result($target, 'resolved', null, $enlist['participation'] ?? $decision['state'], $target['effects'] ?? []);
}

// 逐目标结算循环：遍历 ctx.targets，每个 target 调用 combat_resolve_target_unit
// 支持 empty_policy='execute'（无 target 时仍执行 delivery）/ empty_policy='fail'（无 target 时失败回滚）
function combat_target_units_run(CombatContext $ctx): void {
    $empty_policy = (string)($ctx->config['execution']['empty_policy'] ?? 'fail');
    combat_action_reserve_resources($ctx);
    if ($empty_policy === 'execute') {
        combat_action_begin($ctx);
        combat_action_delivery($ctx);
        combat_action_commit_resources($ctx);
    }

    $count = count($ctx->targets);
    for ($i = 0; $i < $count; $i++) {
        $result = combat_resolve_target_unit($ctx, $i);
        $ctx->target_results[] = $result;
        $ctx->targets[$i]['result'] = $result;
        if (combat_actor_terminated($ctx->actor_data, $ctx->battle_cache)) break;
    }

    if (!$ctx->any_target_resolved && $empty_policy === 'fail') {
        combat_action_restore_uncommitted_resources($ctx);
        $ctx->success = false;
        $ctx->failure_reason = 'NO_VALID_TARGET';
        return;
    }
    if ($ctx->any_target_resolved) combat_action_delivery($ctx);
    $ctx->success = true;
}
