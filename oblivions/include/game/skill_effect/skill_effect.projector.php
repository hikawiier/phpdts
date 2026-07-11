<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// Capability 提供者（注册为 effect_skills）：遍历所有 active effect，
// 检查其 definition 中的 capability_denies 列表，若匹配则返回 blocked sources
function skill_effect_capability_provider(array &$actor, string $capability, array $context): array {
    $tick = isset($context['evaluation_tick']) ? (int)$context['evaluation_tick'] : 0;
    $sources = array();
    foreach (($actor['skillpara'] ?? array()) as $skill_id => $skill_state) {
        $definition = skill_effect_definition((string)$skill_id);
        if (!$definition || !in_array($capability, $definition['capability_denies'] ?? array(), true)) continue;
        foreach (($skill_state['effect_instances'] ?? array()) as $instance) {
            if (!is_array($instance) || !skill_effect_is_active($instance, $tick)) continue;
            $sources[] = array(
                'kind' => 'status',
                'skill_id' => (string)$skill_id,
                'instance_uid' => (string)($instance['instance_uid'] ?? ''),
                'expires_at_tick' => (int)($instance['expires_at_tick'] ?? 0),
                'hidden' => !empty($definition['hidden']),
            );
        }
    }
    return array('allowed' => empty($sources), 'sources' => $sources);
}

// 注册效果技能的能力提供者到 actor_capability 系统
function skill_effect_register_capability_provider(): void {
    actor_capability_register_provider('effect_skills', 'skill_effect_capability_provider');
}

// 投影角色当前效果状态列表：供 API 返回给前端展示
function skill_effect_project_statuses(array &$actor, int $evaluation_tick, bool $public = true): array {
    $statuses = array();
    foreach (($actor['skillpara'] ?? array()) as $skill_id => $skill_state) {
        $definition = skill_effect_definition((string)$skill_id);
        if (!$definition || ($public && !empty($definition['hidden']))) continue;
        foreach (($skill_state['effect_instances'] ?? array()) as $instance) {
            if (!is_array($instance)) continue;
            $phase = (string)($instance['state'] ?? '');
            if ($phase === 'active' && !skill_effect_is_active($instance, $evaluation_tick)) {
                $expires = (int)($instance['expires_at_tick'] ?? 0);
                $starts = (int)($instance['starts_at_tick'] ?? PHP_INT_MAX);
                if ($evaluation_tick >= $expires) continue;
                if ($evaluation_tick < $starts) $phase = 'pending';
            }
            if (!in_array($phase, array('pending', 'active'), true)) continue;
            $source = isset($instance['source']) && is_array($instance['source']) ? $instance['source'] : array();
            if ($public) {
                $source = array_filter(array(
                    'kind' => isset($source['kind']) ? (string)$source['kind'] : null,
                    'skill_id' => isset($source['skill_id']) ? (string)$source['skill_id'] : null,
                ), static fn($value): bool => $value !== null && $value !== '');
            }
            $statuses[] = array(
                'instance_uid' => (string)($instance['instance_uid'] ?? ''),
                'status_id' => (string)$skill_id,
                'phase' => $phase,
                'stacks' => max(1, (int)($instance['stacks'] ?? 1)),
                'starts_at_tick' => $instance['starts_at_tick'] ?? null,
                'expires_at_tick' => $instance['expires_at_tick'] ?? null,
                'remaining_ticks' => $phase === 'active'
                    ? max(0, (int)$instance['expires_at_tick'] - $evaluation_tick)
                    : null,
                'source' => $source,
            );
        }
    }
    return $statuses;
}

// 投影单能力的判定结果：allowed + 来源 status_ids + 最早过期 tick
function skill_effect_project_capability_decision(
    array &$actor,
    string $capability,
    int $evaluation_tick,
    bool $public = true
): array {
    $decision = actor_capability_decide($actor, $capability, null, $evaluation_tick);
    $ids = array();
    $expires = 0;
    foreach ($decision['sources'] as $source) {
        if ($public && !empty($source['hidden'])) continue;
        if (($source['kind'] ?? '') === 'status' && !empty($source['skill_id'])) $ids[(string)$source['skill_id']] = true;
        $expires = max($expires, (int)($source['expires_at_tick'] ?? 0));
    }
    $projected = array(
        'allowed' => !empty($decision['allowed']),
        'reason' => $decision['reason'],
        'source_status_ids' => array_keys($ids),
    );
    if ($expires > 0) $projected['expires_at_tick'] = $expires;
    return $projected;
}

// 批量投影多个能力的判定结果（用于 player_info API 中 status 字段）
function skill_effect_project_capabilities(
    array &$actor,
    array $capabilities,
    int $evaluation_tick,
    bool $public = true
): array {
    $result = array();
    foreach ($capabilities as $capability) {
        $capability = (string)$capability;
        $result[$capability] = skill_effect_project_capability_decision($actor, $capability, $evaluation_tick, $public);
    }
    return $result;
}
