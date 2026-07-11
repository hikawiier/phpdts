<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — battlelog v2 日志适配层
//
// 职责：复用 BattleLogCollector，提供新系统专用便捷方法。
//   - 输出 battlelog.v2 typed events
//   - 复用 battle log 文件持久化和 played 标记机制
//
// 与旧系统边界：复用 BattleLogCollector 实例 + obl_battle_log_persist /
//   obl_battle_log_load / obl_battle_log_mark_played，不重写持久化逻辑。
// ================================================================

BattleLogCollector::registerPhase('battlelog_v2', false);

function combat_log_v2_mode(): string {
    return 'v2';
}

function combat_log_v2_enabled(): bool {
    return true;
}

function combat_log_v2_next_event_uid(string $event_type): string {
    static $seq = 0;
    $seq++;
    $request_uid = (string)($GLOBALS['obl_request_uid'] ?? 'request-unknown');
    return 'blv2-' . $request_uid . '-' . $event_type . '-' . $seq;
}

function combat_log_v2_make_action_uid(array $actor_data, string $act_id, int $seq): string {
    $qid = (int)($actor_data['bid'] ?? 0);
    $pid = (int)($actor_data['pid'] ?? 0);
    $operation_key = (string)($GLOBALS['obl_command_operation_key'] ?? ($GLOBALS['obl_request_uid'] ?? 'request-unknown'));
    $operation_key = preg_replace('/[^a-zA-Z0-9_.:-]/', '_', $operation_key);
    return $operation_key . '-q' . $qid . '-p' . $pid . '-a' . $seq . '-' . preg_replace('/[^a-zA-Z0-9_:-]/', '_', $act_id);
}

function combat_log_v2_combatant_snapshot($data): ?array {
    if (!is_array($data)) return null;
    $pid = (int)($data['pid'] ?? 0);
    if ($pid <= 0) return null;

    return [
        'pid'     => $pid,
        'type'    => (int)($data['type'] ?? 0),
        'name'    => (string)($data['name'] ?? ''),
        'hp'      => (int)($data['hp'] ?? 0),
        'mhp'     => (int)($data['mhp'] ?? 0),
        'ap'      => (int)($data['ap'] ?? 0),
        'max_ap'  => (int)($data['max_ap'] ?? 0),
        'pgroup'  => (int)($data['pgroup'] ?? 0),
        'pls'     => (int)($data['pls'] ?? 0),
        'state'   => (int)($data['state'] ?? 0),
    ];
}

function combat_log_v2_target_ref(CombatContext $ctx, array $target): array {
    $target_data = $target['target_data'] ?? null;
    if ($ctx->target_type === 'self') {
        return [
            'kind' => 'self',
            'pid' => (int)($ctx->actor_data['pid'] ?? 0),
            'snapshot' => combat_log_v2_combatant_snapshot($ctx->actor_data),
        ];
    }
    if ($ctx->target_type === 'tile') {
        return [
            'kind' => 'tile',
            'pgroup' => (int)($target_data['pgroup'] ?? ($ctx->actor_data['pgroup'] ?? 0)),
            'pls' => (int)($target_data['pls'] ?? 0),
            'name' => (string)($target_data['name'] ?? ''),
        ];
    }
    if (is_array($target_data) && (int)($target_data['pid'] ?? 0) > 0) {
        return [
            'kind' => 'pid',
            'pid' => (int)$target_data['pid'],
            'snapshot' => combat_log_v2_combatant_snapshot($target_data),
        ];
    }
    return ['kind' => 'none'];
}

function combat_log_v2_actor_target_ref(CombatContext $ctx): array {
    return [
        'kind' => 'self',
        'pid' => (int)($ctx->actor_data['pid'] ?? 0),
        'snapshot' => combat_log_v2_combatant_snapshot($ctx->actor_data),
    ];
}

function combat_log_v2_round_start($log, int $qid, array $rolls, int $ambush_pid = 0): void {
    if (!$log || !combat_log_v2_enabled()) return;
    combat_log_v2_emit($log, [
        'event_type' => 'round_start',
        'qid' => $qid,
        'payload' => [
            'qid' => $qid,
            'rolls' => array_values($rolls),
            'ambush_pid' => $ambush_pid > 0 ? $ambush_pid : null,
        ],
    ]);
}

function combat_log_v2_turn_start($log, array $actor_data, int $ap_recovered = 0): void {
    if (!$log || !combat_log_v2_enabled()) return;
    combat_log_v2_emit($log, [
        'event_type' => 'turn_start',
        'qid' => (int)($actor_data['bid'] ?? 0),
        'actor_pid' => (int)($actor_data['pid'] ?? 0),
        'payload' => [
            'qid' => (int)($actor_data['bid'] ?? 0),
            'actor' => combat_log_v2_combatant_snapshot($actor_data),
            'ap_recovered' => $ap_recovered,
        ],
    ]);
}

function combat_log_v2_emit($log, array $event): void {
    if (!$log || !combat_log_v2_enabled()) return;

    $event_type = (string)($event['event_type'] ?? '');
    if ($event_type === '') return;

    $channel = (string)($event['channel'] ?? 'render');
    $payload = is_array($event['payload'] ?? null) ? $event['payload'] : [];
    $debug = $channel !== 'render';

    $log->setPhase('battlelog_v2');
    $log->emit([
        'schema'     => 'battlelog.v2',
        'event_type' => $event_type,
        'channel'    => $channel,
        'event_uid'  => (string)($event['event_uid'] ?? combat_log_v2_next_event_uid($event_type)),
        'action_uid' => $event['action_uid'] ?? ($payload['action_uid'] ?? null),
        'effect_uid' => $event['effect_uid'] ?? ($payload['effect_uid'] ?? null),
        'payload'    => $payload,
        'qid'        => $event['qid'] ?? ($payload['qid'] ?? null),
        'actor_pid'  => $event['actor_pid'] ?? ($payload['actor']['pid'] ?? null),
        'action_id'  => $event['action_id'] ?? ($payload['action_id'] ?? null),
        'target_pid' => $event['target_pid'] ?? ($payload['target']['pid'] ?? null),
        'effect_type' => $event['effect_type'] ?? ($payload['effect_type'] ?? null),
        'effect_value' => $event['effect_value'] ?? ($payload['value'] ?? null),
        'reason'     => $event['reason'] ?? ($payload['reason'] ?? null),
        'winner_pid' => $event['winner_pid'] ?? ($payload['winner_pid'] ?? null),
        'cleared_pid' => $event['cleared_pid'] ?? ($payload['combatant']['pid'] ?? null),
        'cleared_name' => $event['cleared_name'] ?? ($payload['combatant']['name'] ?? null),
        'success'    => $event['success'] ?? ($payload['success'] ?? null),
    ], $debug);
}

function combat_log_v2_action_start(CombatContext $ctx): void {
    if (!$ctx->log || !combat_log_v2_enabled()) return;
    if ($ctx->v2_action_started) return;
    $ctx->v2_action_started = true;

    $targets = [];
    foreach ($ctx->targets as $target) {
        if (!empty($target['skip'])) continue;
        $targets[] = combat_log_v2_target_ref($ctx, $target);
    }

    combat_log_v2_emit($ctx->log, [
        'event_type' => 'action_start',
        'action_uid' => $ctx->action_uid,
        'action_id' => $ctx->act_id,
        'payload' => [
            'qid' => (int)($ctx->actor_data['bid'] ?? 0),
            'action_uid' => $ctx->action_uid,
            'action_id' => $ctx->act_id,
            'actor' => combat_log_v2_combatant_snapshot($ctx->actor_data),
            'resolved_aim' => $ctx->resolved_aim,
            'targets' => $targets,
            'ap_cost' => (int)$ctx->ap_cost,
            'tags' => $ctx->config['tags'] ?? [],
        ],
    ]);
}

function combat_log_v2_action_delivery(CombatContext $ctx, string $delivery_type, array $resolved_aim): void {
    if (!$ctx->log || !combat_log_v2_enabled()) return;
    combat_log_v2_emit($ctx->log, [
        'event_type' => 'action_delivery',
        'action_uid' => $ctx->action_uid,
        'action_id' => $ctx->act_id,
        'payload' => [
            'qid' => (int)($ctx->actor_data['bid'] ?? 0),
            'action_uid' => $ctx->action_uid,
            'action_id' => $ctx->act_id,
            'delivery_type' => $delivery_type,
            'resolved_aim' => $resolved_aim,
            'actor' => combat_log_v2_combatant_snapshot($ctx->actor_data),
        ],
    ]);
}

function combat_log_v2_combatant_joined(CombatContext $ctx, array $target_data, int $myorder): void {
    if (!$ctx->log || !combat_log_v2_enabled()) return;
    combat_log_v2_emit($ctx->log, [
        'event_type' => 'combatant_joined',
        'action_uid' => $ctx->action_uid,
        'target_pid' => (int)($target_data['pid'] ?? 0),
        'payload' => [
            'qid' => (int)($ctx->actor_data['bid'] ?? 0),
            'combatant' => combat_log_v2_combatant_snapshot($target_data),
            'source_actor_pid' => (int)($ctx->actor_data['pid'] ?? 0),
            'source_action_uid' => $ctx->action_uid,
            'myorder' => $myorder,
            'done' => 0,
        ],
    ]);
}

function combat_log_v2_effect_applied(CombatContext $ctx, string $effect_type, array $payload): void {
    if (!$ctx->log || !combat_log_v2_enabled()) return;
    $effect_uid = $ctx->action_uid . '-e' . (count($ctx->v2_effect_uids) + 1);
    $ctx->v2_effect_uids[] = $effect_uid;
    if (!isset($ctx->v2_effect_uids_by_type[$effect_type])) {
        $ctx->v2_effect_uids_by_type[$effect_type] = [];
    }
    $ctx->v2_effect_uids_by_type[$effect_type][] = $effect_uid;

    $event_payload = array_merge([
        'qid' => (int)($ctx->actor_data['bid'] ?? 0),
        'action_uid' => $ctx->action_uid,
        'effect_uid' => $effect_uid,
        'effect_type' => $effect_type,
        'source' => combat_log_v2_combatant_snapshot($ctx->actor_data),
    ], $payload);

    combat_log_v2_emit($ctx->log, [
        'event_type' => 'effect_applied',
        'action_uid' => $ctx->action_uid,
        'effect_uid' => $effect_uid,
        'effect_type' => $effect_type,
        'effect_value' => $payload['value'] ?? null,
        'payload' => $event_payload,
    ]);
}

function combat_log_v2_action_end(CombatContext $ctx): void {
    if (!$ctx->log || !combat_log_v2_enabled()) return;
    if ($ctx->v2_action_ended) return;
    $ctx->v2_action_ended = true;

    combat_log_v2_emit($ctx->log, [
        'event_type' => 'action_end',
        'action_uid' => $ctx->action_uid,
        'action_id' => $ctx->act_id,
        'success' => $ctx->success,
        'payload' => [
            'qid' => (int)($ctx->actor_data['bid'] ?? 0),
            'action_uid' => $ctx->action_uid,
            'action_id' => $ctx->act_id,
            'actor' => combat_log_v2_combatant_snapshot($ctx->actor_data),
            'success' => $ctx->success,
            'reason' => $ctx->failure_reason,
            'ap_spent' => $ctx->success ? (int)$ctx->ap_cost : 0,
        ],
    ]);
}

function combat_log_v2_action_failed($log, array $actor_data, string $act_id, string $reason, array $extra = [], ?string $action_uid = null): void {
    if (!$log || !combat_log_v2_enabled()) return;
    combat_log_v2_emit($log, [
        'event_type' => 'action_failed',
        'action_uid' => $action_uid,
        'action_id' => $act_id,
        'reason' => $reason,
        'payload' => [
            'qid' => (int)($actor_data['bid'] ?? 0),
            'action_uid' => $action_uid,
            'action_id' => $act_id,
            'actor' => combat_log_v2_combatant_snapshot($actor_data),
            'reason' => $reason,
            'ap_spent' => 0,
            'detail' => $extra,
        ],
    ]);
}

function combat_log_v2_action_failed_from_context(CombatContext $ctx, string $reason, array $extra = []): void {
    if (!$ctx->log || !combat_log_v2_enabled()) return;

    if ($ctx->failure_reason === null) {
        $ctx->failure_reason = $reason;
    }

    if ($ctx->v2_action_started && !$ctx->v2_action_ended) {
        $ctx->success = false;
        combat_log_v2_action_end($ctx);
    }

    combat_log_v2_action_failed($ctx->log, $ctx->actor_data, $ctx->act_id, $reason, $extra, $ctx->action_uid);
}

function combat_log_v2_combatant_cleared(
    $log,
    array $combatant_data,
    string $reason,
    ?string $action_uid = null,
    ?string $effect_uid = null,
    array $extra = []
): void {
    if (!$log || !combat_log_v2_enabled()) return;
    $contract_reason = $reason === 'dead' ? 'death' : $reason;
    combat_log_v2_emit($log, [
        'event_type' => 'combatant_cleared',
        'action_uid' => $action_uid,
        'cleared_pid' => (int)($combatant_data['pid'] ?? 0),
        'cleared_name' => $combatant_data['name'] ?? '',
        'reason' => $contract_reason,
        'payload' => array_merge([
            'combatant' => combat_log_v2_combatant_snapshot($combatant_data),
            'reason' => $contract_reason,
            'by_action_uid' => $action_uid,
            'by_effect_uid' => $effect_uid,
        ], $extra),
    ]);
}

function combat_log_v2_battle_end($log, string $reason, int $winner_pid = 0, array $survivors = []): void {
    if (!$log || !combat_log_v2_enabled()) return;
    combat_log_v2_emit($log, [
        'event_type' => 'battle_end',
        'reason' => $reason,
        'winner_pid' => $winner_pid > 0 ? $winner_pid : null,
        'payload' => [
            'reason' => $reason,
            'winner_pid' => $winner_pid > 0 ? $winner_pid : null,
            'survivors' => array_values($survivors),
        ],
    ]);
}
