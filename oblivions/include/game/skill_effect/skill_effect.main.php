<?php
/**
 * @module H 技能效果系统
 * @framework H-1 实例化效果生命周期
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 记录无效 effect 实例日志（诊断用途）
function skill_effect_log_invalid(string $skill_id, string $reason): void {
    global $obl_error_log;
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('skill_effect.invalid_instance', array(
            'skill_id' => $skill_id,
            'reason' => $reason,
        ), 'domain');
    } else {
        error_log('[skill_effect] invalid instance: ' . $skill_id . ': ' . $reason);
    }
}

// 获取效果技能定义：从 skill_definition_config 读取并验证 lifetime=effect
function skill_effect_definition(string $skill_id): ?array {
    $definition = function_exists('skill_get_definition') ? skill_get_definition($skill_id) : null;
    if (!$definition || ($definition['lifetime'] ?? '') !== 'effect') return null;
    return $definition;
}

// 格式化 effect 实例：校验结构、标准化字段、计算起止 tick
function skill_effect_format_instance(string $skill_id, $instance): ?array {
    if (!is_array($instance)) {
        skill_effect_log_invalid($skill_id, 'not_array');
        return null;
    }
    $uid = trim((string)($instance['instance_uid'] ?? ''));
    $state = (string)($instance['state'] ?? '');
    if ($uid === '' || !in_array($state, array('pending', 'active'), true)) {
        skill_effect_log_invalid($skill_id, 'identity_or_state');
        return null;
    }
    $activation = isset($instance['activation']) && is_array($instance['activation'])
        ? $instance['activation']
        : array();
    $boundary = trim((string)($activation['boundary'] ?? ''));
    if ($state === 'pending' && $boundary === '') {
        skill_effect_log_invalid($skill_id, 'pending_boundary');
        return null;
    }
    $starts_at_tick = isset($instance['starts_at_tick']) && $instance['starts_at_tick'] !== null
        ? max(0, (int)$instance['starts_at_tick'])
        : null;
    $expires_at_tick = isset($instance['expires_at_tick']) && $instance['expires_at_tick'] !== null
        ? max(0, (int)$instance['expires_at_tick'])
        : null;
    if ($state === 'active' && ($starts_at_tick === null || $expires_at_tick === null || $expires_at_tick <= $starts_at_tick)) {
        skill_effect_log_invalid($skill_id, 'active_tick_bounds');
        return null;
    }
    if ($state === 'pending') {
        $starts_at_tick = null;
        $expires_at_tick = null;
    }
    return array(
        'instance_uid' => $uid,
        'state' => $state,
        'source' => isset($instance['source']) && is_array($instance['source']) ? $instance['source'] : array(),
        'activation' => array(
            'boundary' => $boundary,
            'boundary_id' => max(0, (int)($activation['boundary_id'] ?? 0)),
            'delay_ticks' => max(0, (int)($activation['delay_ticks'] ?? 0)),
        ),
        'duration_ticks' => max(1, (int)($instance['duration_ticks'] ?? 1)),
        'applied_tick' => max(0, (int)($instance['applied_tick'] ?? 0)),
        'starts_at_tick' => $starts_at_tick,
        'expires_at_tick' => $expires_at_tick,
        'stacks' => max(1, (int)($instance['stacks'] ?? 1)),
    );
}

// 格式化技能状态中的 effect_instances：标准化 + 计算 expires_at_tick
function skill_effect_format_skill_state(string $skill_id, array &$state): void {
    $definition = skill_effect_definition($skill_id);
    if (!$definition) {
        unset($state['effect_instances']);
        return;
    }
    $raw = isset($state['effect_instances']) && is_array($state['effect_instances'])
        ? $state['effect_instances']
        : array();
    $formatted = array();
    foreach ($raw as $key => $instance) {
        $normalized = skill_effect_format_instance($skill_id, $instance);
        if ($normalized === null) continue;
        $normalized['duration_ticks'] = max(1, (int)($definition['duration_ticks'] ?? 1));
        if ($normalized['state'] === 'active') {
            $normalized['expires_at_tick'] = (int)$normalized['starts_at_tick'] + $normalized['duration_ticks'];
        }
        $formatted[$normalized['instance_uid']] = $normalized;
    }
    $state['effect_instances'] = $formatted;
    if (!isset($state['lstact'])) $state['lstact'] = 0;
}

// 验证 activation 配置：boundary 格式 + boundary_id/delay_ticks 范围
function skill_effect_validate_activation(array $activation): array {
    $boundary = trim((string)($activation['boundary'] ?? ''));
    if ($boundary === '' || !preg_match('/^[a-z][a-z0-9_]{0,63}$/', $boundary)) {
        throw new InvalidArgumentException('Invalid effect activation boundary');
    }
    $boundary_id = (int)($activation['boundary_id'] ?? 0);
    $delay_ticks = (int)($activation['delay_ticks'] ?? 0);
    if ($boundary_id < 0 || $delay_ticks < 0) throw new InvalidArgumentException('Invalid effect activation values');
    return array(
        'boundary' => $boundary,
        'boundary_id' => $boundary_id,
        'delay_ticks' => $delay_ticks,
    );
}

// 获取当前游戏刻（用于 effect 生命周期判断）
function skill_effect_current_tick(): int {
    return function_exists('obl_tick_get') ? (int)obl_tick_get() : 0;
}

// 应用持久效果：创建或替换 effect instance（当前仅支持 refresh stacking）
// 在 actor.skillpara 中写入 effect_instances 记录
function skill_effect_apply(
    array &$actor,
    string $skill_id,
    array $source,
    array $activation,
    ?string $instance_uid = null
): array {
    $definition = skill_effect_definition($skill_id);
    if (!$definition) throw new InvalidArgumentException('Unknown effect skill: ' . $skill_id);
    if (($definition['stacking'] ?? '') !== 'refresh') {
        throw new InvalidArgumentException('Unsupported effect stacking: ' . $skill_id);
    }
    $applied_tick = isset($activation['evaluation_tick'])
        ? max(0, (int)$activation['evaluation_tick'])
        : skill_effect_current_tick();
    $activation = skill_effect_validate_activation($activation);
    $uid = trim((string)$instance_uid);
    if ($uid === '') throw new InvalidArgumentException('Effect instance uid is required');
    if (!isset($actor['skillpara']) || !is_array($actor['skillpara'])) $actor['skillpara'] = array();
    if (!isset($actor['skillpara'][$skill_id]) || !is_array($actor['skillpara'][$skill_id])) {
        $actor['skillpara'][$skill_id] = array('lstact' => 0, 'effect_instances' => array());
    }
    skill_effect_format_skill_state($skill_id, $actor['skillpara'][$skill_id]);
    $instances = &$actor['skillpara'][$skill_id]['effect_instances'];
    if (isset($instances[$uid])) {
        return $instances[$uid];
    }
    $duration = max(1, (int)($definition['duration_ticks'] ?? 1));
    $is_immediate = $activation['boundary'] === 'immediate';
    $instance = array(
        'instance_uid' => $uid,
        'state' => $is_immediate ? 'active' : 'pending',
        'source' => $source,
        'activation' => $activation,
        'duration_ticks' => $duration,
        'applied_tick' => $applied_tick,
        'starts_at_tick' => $is_immediate ? $applied_tick + $activation['delay_ticks'] : null,
        'expires_at_tick' => $is_immediate ? $applied_tick + $activation['delay_ticks'] + $duration : null,
        'stacks' => 1,
    );

    $replace_states = $is_immediate ? array('active') : array('pending');
    foreach ($instances as $old_uid => $old) {
        if (in_array((string)($old['state'] ?? ''), $replace_states, true)) unset($instances[$old_uid]);
    }
    $instances[$uid] = $instance;
    return $instance;
}

// 检查 effect instance 在指定 tick 是否处于 active 状态
function skill_effect_is_active(array $instance, int $evaluation_tick): bool {
    if (($instance['state'] ?? '') !== 'active') return false;
    $starts = isset($instance['starts_at_tick']) ? (int)$instance['starts_at_tick'] : PHP_INT_MAX;
    $expires = isset($instance['expires_at_tick']) ? (int)$instance['expires_at_tick'] : 0;
    return $starts <= $evaluation_tick && $evaluation_tick < $expires;
}
