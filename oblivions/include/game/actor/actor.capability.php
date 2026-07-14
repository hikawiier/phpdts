<?php
/**
 * @module H 技能效果系统
 * @framework H-2 能力封锁桥接
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// Capability 注册表 + 提供者系统：定义角色能做什么、不能做什么
// 能力（capability）如 world_ai / combat_action / participate_combat 等由 skill_effect 提供
// 默认注册 7 种能力，所有能力默认允许，由 passive effect 通过 provider 进行禁止
$GLOBALS['actor_capability_registry'] = array(
    'world_ai' => true,
    'voluntary_move' => true,
    'enter_combat' => true,
    'participate_combat' => true,
    'combat_action' => true,
    'free_mutation' => true,
    'time_pass' => true,
);
$GLOBALS['actor_capability_providers'] = array();

// 检查能力名称是否已注册（不在注册表中的视为 unknown，fail closed）
function actor_capability_is_known(string $capability): bool {
    return isset($GLOBALS['actor_capability_registry'][$capability]);
}

// 返回所有注册的能力名称列表
function actor_capability_all(): array {
    return array_keys($GLOBALS['actor_capability_registry']);
}

// 注册能力提供者：provider 负责在特定条件下禁止能力（返回 blocked sources）
// 多个 provider 的 blocked results 取并集，空 sources = 允许
function actor_capability_register_provider(string $provider_id, callable $provider): void {
    if ($provider_id === '') throw new InvalidArgumentException('Capability provider id is required');
    $GLOBALS['actor_capability_providers'][$provider_id] = $provider;
}

// 生成 provider source 的唯一 key（用于去重同一 effect 的重复 blocked 来源）
function actor_capability_source_key(array $source): string {
    return implode(':', array(
        (string)($source['kind'] ?? ''),
        (string)($source['skill_id'] ?? ''),
        (string)($source['instance_uid'] ?? ''),
        (string)($source['provider_id'] ?? ''),
    ));
}

// 记录 provider 异常日志（不影响能力判定，仅诊断用途）
function actor_capability_provider_error(string $provider_id, Throwable $error): void {
    global $obl_error_log;
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit('capability.provider_error', array(
            'provider_id' => $provider_id,
            'message' => $error->getMessage(),
        ), 'domain');
    } else {
        error_log('[actor_capability] provider error: ' . $provider_id . ': ' . $error->getMessage());
    }
}

// 能力判定主入口：遍历所有 provider，收集被禁止的来源
// 返回 { allowed: bool, capability: string, reason: ?string, sources: array }
// allowed = true 表示能力未被任何 provider 禁止
function actor_capability_decide(
    array &$actor,
    string $capability,
    ?array $context = null,
    ?int $evaluation_tick = null
): array {
    $context = is_array($context) ? $context : array();
    if ($evaluation_tick !== null) $context['evaluation_tick'] = $evaluation_tick;
    if (!actor_capability_is_known($capability)) {
        return array(
            'allowed' => false,
            'capability' => $capability,
            'reason' => 'unknown_capability',
            'sources' => array(),
        );
    }

    $sources = array();
    foreach ($GLOBALS['actor_capability_providers'] as $provider_id => $provider) {
        try {
            // Providers receive an isolated actor view. Capability evaluation is read-only.
            $actor_view = $actor;
            $result = call_user_func_array($provider, array(&$actor_view, $capability, $context));
            if (!is_array($result) || !empty($result['allowed'])) continue;
            $provider_sources = isset($result['sources']) && is_array($result['sources'])
                ? $result['sources']
                : array();
            if (empty($provider_sources)) $provider_sources[] = array('provider_id' => $provider_id);
            foreach ($provider_sources as $source) {
                if (!is_array($source)) continue;
                $source['provider_id'] = $source['provider_id'] ?? $provider_id;
                $sources[actor_capability_source_key($source)] = $source;
            }
        } catch (Throwable $error) {
            actor_capability_provider_error((string)$provider_id, $error);
            $source = array('provider_id' => (string)$provider_id, 'kind' => 'provider_error');
            $sources[actor_capability_source_key($source)] = $source;
        }
    }

    return array(
        'allowed' => empty($sources),
        'capability' => $capability,
        'reason' => empty($sources) ? null : 'status_blocked',
        'sources' => array_values($sources),
    );
}
