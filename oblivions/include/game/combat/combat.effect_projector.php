<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — Effect Projector（dry-run / planned-state）
//
// 职责：
//   - 在 verify / preview 动作链中消费 declared effects
//   - 修改 planned actor / targets / battle_cache，不写 DB，不发 battlelog
//   - 与 combat.effect.php 的真实 applier 保持 effect 语义一致
// ================================================================

if (!isset($GLOBALS['combat_effect_projectors'])) {
    $GLOBALS['combat_effect_projectors'] = [];
}

function combat_effect_projector_register(string $type, callable $projector): void {
    $GLOBALS['combat_effect_projectors'][$type] = $projector;
}

function combat_effect_project_store_target(CombatContext $ctx, array $target_data): void {
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return;

    combat_planned_state_put_player($ctx->battle_cache, $target_data);
}

function combat_effect_project_damage(CombatContext $ctx, array $effect): bool {
    $target_data = &combat_effect_resolve_target_data($ctx, $effect);
    if ((int)($target_data['pid'] ?? 0) <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'damage_target_missing';
        return false;
    }

    $value = (int)($effect['payload']['value'] ?? 0);
    $hp_before = (int)($target_data['hp'] ?? 0);
    $target_data['hp'] = max(0, $hp_before - $value);
    combat_effect_project_store_target($ctx, $target_data);

    if ((int)$target_data['hp'] <= 0) {
        combat_state_mark_dead((int)$target_data['pid'], $ctx->battle_cache);
    }

    return true;
}

function combat_effect_project_heal(CombatContext $ctx, array $effect): bool {
    $target_data = &combat_effect_resolve_target_data($ctx, $effect);
    if ((int)($target_data['pid'] ?? 0) <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'heal_target_missing';
        return false;
    }

    $value = (int)($effect['payload']['value'] ?? 0);
    $mhp = (int)($target_data['mhp'] ?? 0);
    $hp_before = (int)($target_data['hp'] ?? 0);
    $target_data['hp'] = min($mhp, $hp_before + $value);
    combat_effect_project_store_target($ctx, $target_data);

    return true;
}

function combat_effect_project_move(CombatContext $ctx, array $effect): bool {
    $payload = isset($effect['payload']) && is_array($effect['payload']) ? $effect['payload'] : [];
    $to_pls = (int)($payload['to_pls'] ?? 0);
    if ($to_pls <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_target_missing';
        return false;
    }

    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    $decision = is_array($target_data) ? combat_spatial_decide($ctx, $target_data) : array('allowed' => false, 'reason' => 'target_missing');
    $quoted = (int)($payload['spatial_decision']['target_ap_cost'] ?? -1);
    if (empty($decision['allowed']) || $quoted < 0 || $quoted !== (int)$decision['target_ap_cost'] || $quoted !== (int)$ctx->ap_cost) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_spatial_changed:' . (string)($decision['reason'] ?? 'quote_mismatch');
        return false;
    }
    if (is_array($target_data) && (int)($target_data['pgroup'] ?? 0) > 0) {
        $ctx->actor_data['pgroup'] = (int)$target_data['pgroup'];
    }
    $ctx->actor_data['pls'] = $to_pls;
    combat_planned_state_sync_actor($ctx->actor_data, $ctx->battle_cache);

    return true;
}

function combat_effect_project_escape(CombatContext $ctx, array $effect): bool {
    $actor_pid = (int)($ctx->actor_data['pid'] ?? 0);
    if ($actor_pid <= 0) return false;

    combat_state_mark_escaped($actor_pid, $ctx->battle_cache);
    combat_planned_state_sync_actor($ctx->actor_data, $ctx->battle_cache);
    return true;
}

function combat_effect_project_skill_effect_apply(CombatContext $ctx, array $effect): bool {
    $payload = isset($effect['payload']) && is_array($effect['payload']) ? $effect['payload'] : [];
    $skill_id = trim((string)($payload['skill_id'] ?? ''));
    $activation = isset($payload['activation']) && is_array($payload['activation']) ? $payload['activation'] : [];
    if ($skill_id === '' || (string)($payload['scope'] ?? 'actor') !== 'actor' || empty($activation)) {
        $ctx->success = false;
        $ctx->failure_reason = 'skill_effect_apply_invalid_payload';
        return false;
    }

    try {
        skill_effect_apply(
            $ctx->actor_data,
            $skill_id,
            [
                'kind' => 'skill',
                'skill_id' => $ctx->act_id,
                'action_uid' => $ctx->action_uid,
            ],
            $activation,
            combat_effect_actor_operation_uid($ctx, $skill_id)
        );
    } catch (Throwable $e) {
        $ctx->success = false;
        $ctx->failure_reason = 'skill_effect_apply_failed:' . $e->getMessage();
        return false;
    }
    combat_planned_state_sync_actor($ctx->actor_data, $ctx->battle_cache);
    return true;
}

function combat_effect_project_ap_change(CombatContext $ctx, array $effect): bool {
    $delta = (int)($effect['payload']['delta'] ?? 0);
    $ctx->actor_data['ap'] = max(0, (int)($ctx->actor_data['ap'] ?? 0) + $delta);
    combat_planned_state_sync_actor($ctx->actor_data, $ctx->battle_cache);
    return true;
}

function combat_effect_project_all(CombatContext $ctx): void {
    $effects = $ctx->getCurrentEffects();
    if (empty($effects)) return;

    foreach ($effects as $effect) {
        if (!$ctx->success) return;

        $type = $effect['type'] ?? '';
        if ($type === '') continue;

        $projector = $GLOBALS['combat_effect_projectors'][$type] ?? null;
        if (!$projector) continue;

        $result = call_user_func($projector, $ctx, $effect);
        if ($result === false && !$ctx->success) return;
    }
}

combat_effect_projector_register('damage',    'combat_effect_project_damage');
combat_effect_projector_register('heal',      'combat_effect_project_heal');
combat_effect_projector_register('move',      'combat_effect_project_move');
combat_effect_projector_register('escape',    'combat_effect_project_escape');
combat_effect_projector_register('skill_effect_apply', 'combat_effect_project_skill_effect_apply');
combat_effect_projector_register('ap_change', 'combat_effect_project_ap_change');
