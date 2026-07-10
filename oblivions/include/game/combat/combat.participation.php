<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function combat_participation_result(string $state, ?string $reason = null): array {
    return ['state' => $state, 'reason' => $reason];
}

function combat_participation_relation_allowed(CombatContext $ctx, array $target_data): bool {
    $relation = (string)($ctx->config['capture']['relation'] ?? 'any');
    if ($relation === 'any') return true;
    $actor_pid = (int)($ctx->actor_data['pid'] ?? 0);
    $target_pid = (int)($target_data['pid'] ?? 0);
    if ($relation === 'self') return $actor_pid > 0 && $actor_pid === $target_pid;
    $actor_is_player = (int)($ctx->actor_data['type'] ?? 0) === 0;
    $target_is_player = (int)($target_data['type'] ?? 0) === 0;
    if ($relation === 'hostile') return $actor_pid !== $target_pid && $actor_is_player !== $target_is_player;
    if ($relation === 'friendly') return $actor_is_player === $target_is_player;
    return false;
}

function combat_participation_classify_data(CombatContext $ctx, array $target_data, $queue_row = null): array {
    $policy = (string)($ctx->config['capture']['participation'] ?? 'none');
    if ($policy === 'none') return combat_participation_result('not_applicable');
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return combat_participation_result('blocked', 'TARGET_INVALID');
    if ((int)($target_data['hp'] ?? 0) <= 0 || (int)($target_data['state'] ?? 0) !== 0) {
        return combat_participation_result('blocked', 'TARGET_DEAD');
    }
    if ((int)($target_data['pgroup'] ?? 0) !== (int)($ctx->actor_data['pgroup'] ?? 0)) {
        return combat_participation_result('blocked', 'TARGET_OTHER_REGION');
    }
    if (!combat_participation_relation_allowed($ctx, $target_data)) {
        return combat_participation_result('blocked', 'TARGET_RELATION_BLOCKED');
    }

    $qid = (int)($ctx->actor_data['bid'] ?? 0);
    $bid = (int)($target_data['bid'] ?? 0);
    $action = (string)($target_data['action'] ?? '');
    if ($queue_row) {
        $row_qid = (int)$queue_row['qid'];
        $active = (int)$queue_row['active'];
        if ($qid > 0 && $row_qid === $qid && $active === 1 && $bid === $qid && $action === 'battle') {
            return combat_participation_result('member');
        }
        if ($qid > 0 && $row_qid === $qid && $active === 0) return combat_participation_result('left', 'TARGET_LEFT_BATTLE');
        if ($row_qid !== $qid || ($bid > 0 && $bid !== $qid)) return combat_participation_result('other_battle', 'TARGET_IN_OTHER_BATTLE');
        return combat_participation_result('blocked', 'TARGET_MEMBERSHIP_INCONSISTENT');
    }
    if ($bid > 0 || $action === 'battle') {
        return combat_participation_result($bid !== $qid ? 'other_battle' : 'blocked', $bid !== $qid ? 'TARGET_IN_OTHER_BATTLE' : 'TARGET_MEMBERSHIP_INCONSISTENT');
    }
    if ($action !== '') return combat_participation_result('blocked', 'TARGET_BUSY');
    if ($policy !== 'join_if_unengaged') return combat_participation_result('blocked', 'TARGET_NOT_MEMBER');
    return combat_participation_result('joinable');
}

function combat_participation_classify(CombatContext $ctx, array $target): array {
    if (($target['kind'] ?? '') !== 'character') return combat_participation_result('not_applicable');
    $data = $target['target_data'] ?? null;
    if (!is_array($data)) return combat_participation_result('blocked', 'TARGET_NOT_FOUND');
    $pid = (int)($data['pid'] ?? 0);
    if ($ctx->dry_run && ($ctx->battle_cache['_sim_participation'][$pid] ?? '') === 'member') {
        return combat_participation_result('member');
    }
    if ($ctx->dry_run && (int)($ctx->battle_cache['combatants'][$pid] ?? 0) === 1
        && (int)($data['bid'] ?? 0) === (int)($ctx->actor_data['bid'] ?? 0)
        && (string)($data['action'] ?? '') === 'battle') {
        return combat_participation_result('member');
    }
    $row = $ctx->dry_run ? null : obl_fetch_queue_by_pid($pid);
    return combat_participation_classify_data($ctx, $data, $row ?: null);
}

function combat_participation_classify_locked(CombatContext $ctx, array &$target_data): array {
    $pid = (int)($target_data['pid'] ?? 0);
    $locked = obl_fetch_playerdata_by_pid_for_update($pid);
    if (!$locked) return combat_participation_result('blocked', 'TARGET_NOT_FOUND');
    $target_data = $locked;
    $row = obl_fetch_queue_by_pid_for_update($pid);
    return combat_participation_classify_data($ctx, $target_data, $row ?: null);
}

function combat_participation_enlist(CombatContext $ctx, array &$target, array $decision): array {
    $state = (string)($decision['state'] ?? 'blocked');
    if ($state === 'member' || $state === 'not_applicable') {
        return ['ok' => true, 'joined' => false, 'participation' => $state];
    }
    if ($state !== 'joinable') return ['ok' => false, 'joined' => false, 'code' => $decision['reason'] ?? 'TARGET_REJECTED'];
    $target_data = &$target['target_data'];
    if ($ctx->dry_run) {
        $pid = (int)$target_data['pid'];
        $ctx->battle_cache['_sim_participation'][$pid] = 'member';
        $ctx->battle_cache['combatants'][$pid] = 1;
        $target_data['action'] = 'battle';
        $target_data['bid'] = (int)($ctx->actor_data['bid'] ?? 0);
        $ctx->storeRuntimePlayer($target_data);
        return ['ok' => true, 'joined' => true, 'participation' => 'joined'];
    }
    return battle_queue_append_tail($target_data, (int)($ctx->actor_data['bid'] ?? 0), $ctx->battle_cache, $ctx->log, $ctx);
}
