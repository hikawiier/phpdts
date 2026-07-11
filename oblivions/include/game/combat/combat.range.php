<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function combat_range_log_error(string $reason, string $act_id, array $extra = array()): void {
    global $obl_error_log;
    $params = array_merge(array('reason' => $reason, 'act_id' => $act_id), $extra);
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('combat.range_error', $params, 'battle');
    } else {
        error_log('[combat_range] ' . $reason . ': ' . $act_id);
    }
}

function combat_range_resolve_config(array $actor_data, array $config, string $act_id = ''): array {
    $range_config = isset($config['range']) && is_array($config['range'])
        ? $config['range']
        : array();
    $mode = (string)($range_config['mode'] ?? '');
    $max = (int)($range_config['max'] ?? 0);
    $bonus = (int)($range_config['bonus'] ?? 0);
    $base_actor_range = function_exists('obl_get_range') ? (int)obl_get_range($actor_data) : 0;
    switch ($mode) {
        case 'fixed':
            $base_range = $max;
            break;
        case 'inherit':
            $base_range = $base_actor_range;
            break;
        case 'additive':
            $base_range = $base_actor_range + $bonus;
            break;
        case 'capped_additive':
            $base_range = min($base_actor_range + $bonus, $max);
            break;
        case 'move_power':
            $base_range = function_exists('obl_get_move_power') ? (int)obl_get_move_power($actor_data) : 0;
            break;
        default:
            combat_range_log_error('unknown_range_mode', $act_id, array('mode' => $mode));
            return array(
                'ok' => false,
                'reason' => 'unknown_range_mode',
                'mode' => $mode,
                'base_range' => 0,
                'effective_range' => null,
                'available_ap' => max(0, (int)($actor_data['ap'] ?? 0)),
                'base_apcost' => max(0, (int)($config['apcost'] ?? 0)),
                'max' => $max,
                'bonus' => $bonus,
            );
    }

    $available_ap = max(0, (int)($actor_data['ap'] ?? 0));
    $budget = function_exists('combat_ap_project_budget')
        ? combat_ap_project_budget($actor_data, $config, $available_ap)
        : null;
    return array(
        'ok' => true,
        'reason' => null,
        'mode' => $mode,
        'base_range' => max(0, (int)$base_range),
        'effective_range' => is_array($budget) && array_key_exists('effective_range', $budget)
            ? max(0, (int)$budget['effective_range'])
            : null,
        'available_ap' => $available_ap,
        'base_apcost' => max(0, (int)($config['apcost'] ?? 0)),
        'max' => $max,
        'bonus' => $bonus,
    );
}

function combat_range_resolve_base(array $actor_data, string $act_id): array {
    $config = function_exists('combat_skill_get_config') ? combat_skill_get_config($act_id) : null;
    if (!is_array($config)) {
        combat_range_log_error('skill_not_found', $act_id);
        return array(
            'ok' => false,
            'reason' => 'skill_not_found',
            'mode' => null,
            'base_range' => 0,
            'effective_range' => null,
            'available_ap' => max(0, (int)($actor_data['ap'] ?? 0)),
            'base_apcost' => 0,
            'max' => 0,
            'bonus' => 0,
        );
    }
    return combat_range_resolve_config($actor_data, $config, $act_id);
}

function combat_spatial_available_ap(CombatContext $ctx): int {
    if ($ctx->resources_reserved) return max(0, (int)$ctx->ap_before);
    return max(0, (int)($ctx->actor_data['ap'] ?? 0));
}

function combat_spatial_target_data(CombatContext $ctx, ?array $resolved_target = null): ?array {
    if (is_array($resolved_target)) return $resolved_target;
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    return is_array($target_data) ? $target_data : null;
}

function combat_spatial_decide(CombatContext $ctx, ?array $resolved_target = null): array {
    $target_data = combat_spatial_target_data($ctx, $resolved_target);
    $available_ap = combat_spatial_available_ap($ctx);
    $actor_for_range = $ctx->actor_data;
    $actor_for_range['ap'] = $available_ap;
    $range = combat_range_resolve_config($actor_for_range, $ctx->config, $ctx->act_id);
    if (!$range['ok']) {
        return array_merge($range, array(
            'distance' => -1,
            'reachable' => false,
            'target_ap_cost' => 0,
            'affordable' => false,
            'within_range' => false,
            'allowed' => false,
        ));
    }
    if ($target_data === null) {
        return array_merge($range, array(
            'distance' => -1,
            'reachable' => false,
            'target_ap_cost' => 0,
            'affordable' => false,
            'within_range' => false,
            'allowed' => false,
            'reason' => 'target_missing',
        ));
    }

    $actor_group = (int)($ctx->actor_data['pgroup'] ?? 0);
    $target_group = (int)($target_data['pgroup'] ?? $actor_group);
    $actor_pls = (int)($ctx->actor_data['pls'] ?? 0);
    $target_pls = (int)($target_data['pls'] ?? 0);
    $distance = $actor_group > 0 && $actor_group === $target_group && $actor_pls > 0 && $target_pls > 0
        ? (int)obl_get_distance($actor_group, $actor_pls, $target_pls)
        : -1;
    $reachable = $distance >= 0;
    $target_ap_cost = $reachable ? max(0, (int)combat_ap_calculate($ctx)) : 0;
    $affordable = $reachable && $target_ap_cost <= $available_ap;
    $range_limit = $range['effective_range'] !== null
        ? (int)$range['effective_range']
        : (int)$range['base_range'];
    $within_range = $reachable && $distance <= $range_limit;
    $reason = null;
    if (!$reachable) $reason = $actor_group !== $target_group ? 'cross_zone' : 'unreachable';
    elseif (!$within_range) $reason = 'out_of_range';
    elseif (!$affordable) $reason = 'ap_insufficient';
    return array_merge($range, array(
        'distance' => $distance,
        'reachable' => $reachable,
        'target_ap_cost' => $target_ap_cost,
        'affordable' => $affordable,
        'within_range' => $within_range,
        'allowed' => $reachable && $within_range && $affordable,
        'reason' => $reason,
        'origin' => array('pgroup' => $actor_group, 'pls' => $actor_pls),
        'target' => array('pgroup' => $target_group, 'pls' => $target_pls),
    ));
}
