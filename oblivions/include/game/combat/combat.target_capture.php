<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

if (!isset($GLOBALS['combat_target_capturers'])) {
    $GLOBALS['combat_target_capturers'] = [];
}
if (!isset($GLOBALS['combat_target_capturer_validators'])) {
    $GLOBALS['combat_target_capturer_validators'] = [];
}

function combat_target_capture_register(string $name, callable $capturer, callable $validator): void {
    $GLOBALS['combat_target_capturers'][$name] = $capturer;
    $GLOBALS['combat_target_capturer_validators'][$name] = $validator;
}

function combat_target_capture_player(CombatContext $ctx, int $pid): ?array {
    if ($pid <= 0) return null;
    if ((int)($ctx->actor_data['pid'] ?? 0) === $pid) return $ctx->actor_data;
    $runtime = $ctx->battle_cache['_runtime_players'][$pid] ?? null;
    if (is_array($runtime)) return $runtime;
    $planned = combat_planned_state_get_player($ctx->battle_cache, $pid);
    if (is_array($planned)) return $planned;
    $data = obl_fetch_playerdata_by_pid($pid);
    return is_array($data) ? $data : null;
}

function combat_target_capture_character(array $data, array $facts = []): array {
    $pid = (int)($data['pid'] ?? 0);
    return [
        'kind' => 'character',
        'pid' => $pid,
        'entity_ref' => ['pid' => $pid],
        'capture_facts' => array_merge([
            'pgroup' => (int)($data['pgroup'] ?? 0),
            'pls' => (int)($data['pls'] ?? 0),
        ], $facts),
        'target_data' => $data,
        'tags' => [],
        'effects' => [],
        'snapshot_target_state' => null,
        'skip' => false,
    ];
}

function combat_target_capture_direct_character(CombatContext $ctx, array $aim): array {
    $data = combat_target_capture_player($ctx, (int)($aim['pid'] ?? 0));
    return $data ? [combat_target_capture_character($data)] : [];
}

function combat_target_capture_queue_order(CombatContext $ctx): array {
    $order = [];
    if (isset($ctx->battle_cache['_queue_order']) && is_array($ctx->battle_cache['_queue_order'])) {
        return $ctx->battle_cache['_queue_order'];
    }
    $qid = (int)($ctx->actor_data['bid'] ?? 0);
    if ($qid > 0) {
        foreach (obl_fetch_queue_all_by_qid($qid) as $row) {
            $order[(int)$row['pid']] = (int)$row['myorder'];
        }
    }
    return $order;
}

function combat_target_capture_battle_hostiles(CombatContext $ctx, array $aim): array {
    $actor_pid = (int)($ctx->actor_data['pid'] ?? 0);
    $order = combat_target_capture_queue_order($ctx);
    $targets = [];
    foreach (($ctx->battle_cache['combatants'] ?? []) as $pid => $active) {
        $pid = (int)$pid;
        if ($pid <= 0 || $pid === $actor_pid || (int)$active !== 1) continue;
        $data = combat_target_capture_player($ctx, $pid);
        if (!$data) continue;
        $target = combat_target_capture_character($data);
        $target['order_key'] = [(int)($order[$pid] ?? PHP_INT_MAX), $pid];
        $targets[] = $target;
    }
    return $targets;
}

function combat_target_capture_tile_characters(CombatContext $ctx, array $aim): array {
    $pgroup = (int)($aim['pgroup'] ?? 0);
    $pls = (int)($aim['pls'] ?? 0);
    $pids = [];
    foreach (obl_get_pids_in_tile($pgroup, $pls, 0) as $pid) $pids[(int)$pid] = true;
    foreach (($ctx->battle_cache['_planned_players'] ?? []) as $pid => $data) {
        if (!is_array($data)) continue;
        if ((int)($data['pgroup'] ?? 0) === $pgroup && (int)($data['pls'] ?? 0) === $pls) $pids[(int)$pid] = true;
        else unset($pids[(int)$pid]);
    }
    foreach (($ctx->battle_cache['_runtime_players'] ?? []) as $pid => $data) {
        if (!is_array($data)) continue;
        if ((int)($data['pgroup'] ?? 0) === $pgroup && (int)($data['pls'] ?? 0) === $pls) $pids[(int)$pid] = true;
        else unset($pids[(int)$pid]);
    }
    $order = combat_target_capture_queue_order($ctx);
    $targets = [];
    foreach (array_keys($pids) as $pid) {
        $data = combat_target_capture_player($ctx, (int)$pid);
        if (!$data || (int)($data['pgroup'] ?? 0) !== $pgroup || (int)($data['pls'] ?? 0) !== $pls) continue;
        $target = combat_target_capture_character($data, ['captured_in_tile' => true]);
        $target['order_key'] = [isset($order[$pid]) ? 0 : 1, (int)($order[$pid] ?? $pid), (int)$pid];
        $targets[] = $target;
    }
    return $targets;
}

function combat_target_capture_identity(CombatContext $ctx, array $aim): array {
    if (($aim['kind'] ?? '') === 'self') {
        $target = combat_target_capture_character($ctx->actor_data);
        $target['kind'] = 'self';
        return [$target];
    }
    return [[
        'kind' => (string)($aim['kind'] ?? 'none'),
        'pid' => 0,
        'entity_ref' => $aim,
        'capture_facts' => ['pgroup' => (int)($aim['pgroup'] ?? 0), 'pls' => (int)($aim['pls'] ?? 0)],
        'target_data' => ($aim['kind'] ?? '') === 'tile' ? $aim : null,
        'tags' => [], 'effects' => [], 'snapshot_target_state' => null, 'skip' => false,
    ]];
}

function combat_target_capture_validate_structure(array $targets): ?array {
    $seen = [];
    $validated = [];
    foreach ($targets as $target) {
        if (!is_array($target)) return null;
        $kind = (string)($target['kind'] ?? '');
        if (!in_array($kind, ['character', 'tile', 'self', 'none'], true)) return null;
        $pid = (int)($target['pid'] ?? 0);
        if ($kind === 'character') {
            if ($pid <= 0 || isset($seen[$pid])) return null;
            $data = $target['target_data'] ?? null;
            $entity_pid = (int)($target['entity_ref']['pid'] ?? 0);
            if (!is_array($data) || (int)($data['pid'] ?? 0) !== $pid || $entity_pid !== $pid) return null;
            $seen[$pid] = true;
        }
        $validated[] = $target;
    }

    return $validated;
}

function combat_target_capture_validate_builtin(CombatContext $ctx, string $resolver, array $validated): ?array {
    if ($resolver === 'direct_character') {
        if (count($validated) !== 1 || ($validated[0]['kind'] ?? '') !== 'character') return null;
        if ((int)$validated[0]['pid'] !== (int)($ctx->resolved_aim['pid'] ?? 0)) return null;
    } elseif ($resolver === 'battle_hostiles') {
        foreach ($validated as $target) {
            $pid = (int)($target['pid'] ?? 0);
            if (($target['kind'] ?? '') !== 'character' || (int)($ctx->battle_cache['combatants'][$pid] ?? 0) !== 1) return null;
            if (!combat_participation_relation_allowed($ctx, $target['target_data'])) return null;
        }
    } elseif ($resolver === 'tile_characters') {
        $pgroup = (int)($ctx->resolved_aim['pgroup'] ?? 0);
        $pls = (int)($ctx->resolved_aim['pls'] ?? 0);
        foreach ($validated as $target) {
            $facts = is_array($target['capture_facts'] ?? null) ? $target['capture_facts'] : [];
            $data = $target['target_data'];
            if (($target['kind'] ?? '') !== 'character' || empty($facts['captured_in_tile'])) return null;
            if ((int)($facts['pgroup'] ?? 0) !== $pgroup || (int)($facts['pls'] ?? 0) !== $pls) return null;
            if ((int)($data['pgroup'] ?? 0) !== $pgroup || (int)($data['pls'] ?? 0) !== $pls) return null;
        }
    } elseif ($resolver === 'identity') {
        if (count($validated) !== 1) return null;
        $aim_kind = (string)($ctx->resolved_aim['kind'] ?? 'none');
        if (($validated[0]['kind'] ?? '') !== $aim_kind) return null;
    }

    return $validated;
}

function combat_target_capture_order(CombatContext $ctx, array $targets): ?array {
    $order = (string)($ctx->config['capture']['order'] ?? 'single');
    if ($order === 'single' && count($targets) > 1) return null;
    if (in_array($order, ['queue', 'queue_then_pid'], true)) {
        foreach ($targets as $target) {
            if (!isset($target['order_key']) || !is_array($target['order_key'])) return null;
        }
    }
    if ($order === 'pid') {
        foreach ($targets as &$target) $target['order_key'] = [(int)($target['pid'] ?? 0)];
        unset($target);
    }
    usort($targets, static function ($a, $b) {
        return ($a['order_key'] ?? [0]) <=> ($b['order_key'] ?? [0]);
    });
    return $targets;
}

function combat_capture_resolution_targets(CombatContext $ctx): void {
    if (!empty($ctx->captured_target_set)) return;
    $capture = is_array($ctx->config['capture'] ?? null) ? $ctx->config['capture'] : [];
    $name = (string)($capture['resolver'] ?? 'identity');
    $capturer = $GLOBALS['combat_target_capturers'][$name] ?? null;
    $validator = $GLOBALS['combat_target_capturer_validators'][$name] ?? null;
    if (!$capturer || !$validator) {
        $ctx->success = false;
        $ctx->failure_reason = 'CAPTURE_RESOLVER_NOT_FOUND';
        return;
    }
    $raw = call_user_func($capturer, $ctx, $ctx->resolved_aim);
    $targets = is_array($raw) ? combat_target_capture_validate_structure($raw) : null;
    if ($targets !== null) $targets = call_user_func($validator, $ctx, $name, $targets);
    if ($targets !== null) $targets = combat_target_capture_order($ctx, $targets);
    if ($targets === null) {
        $ctx->success = false;
        $ctx->failure_reason = 'CAPTURE_INVALID_OUTPUT';
        return;
    }
    $ctx->captured_target_set = [
        'resolved_aim' => $ctx->resolved_aim,
        'captured_at' => [
            'tick' => (int)($GLOBALS['gamevars']['obl_tick'] ?? 0),
            'action_index' => (int)($ctx->config['action_index'] ?? 0),
        ],
        'targets' => $targets,
        'empty' => empty($targets),
    ];
    $ctx->targets = $targets;
    $ctx->resolution_targets = $targets;
}

combat_target_capture_register('direct_character', 'combat_target_capture_direct_character', 'combat_target_capture_validate_builtin');
combat_target_capture_register('battle_hostiles', 'combat_target_capture_battle_hostiles', 'combat_target_capture_validate_builtin');
combat_target_capture_register('tile_characters', 'combat_target_capture_tile_characters', 'combat_target_capture_validate_builtin');
combat_target_capture_register('identity', 'combat_target_capture_identity', 'combat_target_capture_validate_builtin');
