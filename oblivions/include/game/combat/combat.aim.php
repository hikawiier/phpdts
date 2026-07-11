<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// AimResolver 注册表：将前端意图（intent）解析为领域目标（resolved_aim）
// 支持四种解析器：pid（角色）、tile（格子）、self（自身）、none（无目标）
if (!isset($GLOBALS['combat_aim_resolvers'])) {
    $GLOBALS['combat_aim_resolvers'] = [];
}

// 注册 Aim 解析器到全局注册表
function combat_aim_register(string $name, callable $resolver): void {
    $GLOBALS['combat_aim_resolvers'][$name] = $resolver;
}

// 角色目标解析：从 intent.id 读取 pid，优先从 planned_state 取，fallback 到 DB
function combat_aim_resolve_pid(CombatContext $ctx, array $intent): ?array {
    $pid = (int)($intent['id'] ?? 0);
    if ($pid <= 0) return null;
    $target = combat_planned_state_get_player($ctx->battle_cache, $pid);
    if (!$target) $target = obl_fetch_playerdata_by_pid($pid);
    if (!$target) return null;
    return [
        'kind' => 'character',
        'pid' => $pid,
        'pgroup' => (int)($target['pgroup'] ?? 0),
        'pls' => (int)($target['pls'] ?? 0),
        'source_intent' => $intent,
    ];
}

// 格子目标解析：从 intent.id 读取 pls，验证格子存在于地图数据中
function combat_aim_resolve_tile(CombatContext $ctx, array $intent): ?array {
    $pls = (int)($intent['id'] ?? 0);
    $pgroup = (int)($ctx->actor_data['pgroup'] ?? 0);
    if ($pgroup <= 0 || $pls <= 0) return null;
    $map = obl_get_map_data($pgroup);
    if (!isset($map['tiles'][$pgroup][$pls])) return null;
    return [
        'kind' => 'tile',
        'pid' => 0,
        'pgroup' => $pgroup,
        'pls' => $pls,
        'source_intent' => $intent,
    ];
}

// 自身目标解析：返回当前 actor 自身
function combat_aim_resolve_self(CombatContext $ctx, array $intent): ?array {
    return [
        'kind' => 'self',
        'pid' => (int)($ctx->actor_data['pid'] ?? 0),
        'pgroup' => (int)($ctx->actor_data['pgroup'] ?? 0),
        'pls' => (int)($ctx->actor_data['pls'] ?? 0),
        'source_intent' => $intent,
    ];
}

// 无目标解析：用于不需要瞄准的技能（如 heal / world.wait）
function combat_aim_resolve_none(CombatContext $ctx, array $intent): ?array {
    return ['kind' => 'none', 'pid' => 0, 'pgroup' => 0, 'pls' => 0, 'source_intent' => $intent];
}

// Aim 解析主入口：按 skill config 中定义的 resolver，将前端意图解析为领域目标
// 步骤：取 resolver 名 → 校验 intent type 匹配 → 调用 resolver → 写回 resolved_aim
function combat_aim_resolve(CombatContext $ctx): void {
    $aim = is_array($ctx->config['aim'] ?? null) ? $ctx->config['aim'] : [];
    $resolver_name = (string)($aim['resolver'] ?? 'none');
    $intent = is_array($ctx->config['target_intent'] ?? null)
        ? $ctx->config['target_intent']
        : ['type' => 'none'];
    $intent_type = (string)($intent['type'] ?? '');
    $expected_type = $resolver_name === 'pid' ? 'pid' : $resolver_name;
    if ($intent_type !== $expected_type) {
        $ctx->success = false;
        $ctx->failure_reason = 'AIM_TYPE_MISMATCH';
        return;
    }
    $resolver = $GLOBALS['combat_aim_resolvers'][$resolver_name] ?? null;
    if (!$resolver) {
        $ctx->success = false;
        $ctx->failure_reason = 'AIM_RESOLVER_NOT_FOUND';
        return;
    }
    $resolved = call_user_func($resolver, $ctx, $intent);
    if (!is_array($resolved)) {
        $ctx->success = false;
        $observation = (string)($ctx->config['aim']['observation'] ?? 'none');
        $ctx->failure_reason = in_array($observation, array('revealed', 'detected', 'visible'), true)
            ? 'TARGET_NOT_VISIBLE'
            : 'AIM_NOT_FOUND';
        return;
    }
    $ctx->resolved_aim = $resolved;
    $ctx->aim_kind = (string)$resolved['kind'];
}

// Aim 规则检查：先做 observation 判定（目标是否可见），再对已解析目标执行技能配置的额外规则
function combat_aim_check_rules(CombatContext $ctx): array {
    $observation = combat_observation_decide($ctx, $ctx->resolved_aim);
    if (empty($observation['allowed'])) {
        return array('pass' => false, 'reason' => (string)($observation['reason'] ?? 'TARGET_NOT_VISIBLE'));
    }
    $rules = array_values($ctx->config['aim']['rules'] ?? []);
    if (empty($rules)) return ['pass' => true, 'reason' => null];
    $saved_targets = $ctx->targets;
    $saved_index = $ctx->current_target_index;
    $saved_type = $ctx->target_type;
    $aim = $ctx->resolved_aim;
    $target_data = null;
    if (($aim['kind'] ?? '') === 'character') $target_data = combat_target_capture_player($ctx, (int)($aim['pid'] ?? 0));
    elseif (($aim['kind'] ?? '') === 'tile') $target_data = $aim;
    elseif (($aim['kind'] ?? '') === 'self') $target_data = $ctx->actor_data;
    $ctx->targets = [[
        'kind' => (string)($aim['kind'] ?? 'none'),
        'pid' => (int)($aim['pid'] ?? 0),
        'target_data' => $target_data,
        'effects' => [], 'tags' => [], 'snapshot_target_state' => null,
    ]];
    $ctx->current_target_index = 0;
    $ctx->target_type = ($aim['kind'] ?? '') === 'character' ? 'pid' : (string)($aim['kind'] ?? 'none');
    $old_rules = $ctx->config['rules'] ?? ['forbid' => []];
    $ctx->config['rules'] = ['forbid' => $rules];
    $ctx->invalidateTagsCache();
    $result = combat_check_target_rules($ctx->config, $ctx->getCurrentTags());
    $ctx->config['rules'] = $old_rules;
    $ctx->targets = $saved_targets;
    $ctx->current_target_index = $saved_index;
    $ctx->target_type = $saved_type;
    $ctx->invalidateTagsCache();
    return $result;
}

combat_aim_register('pid', 'combat_aim_resolve_pid');
combat_aim_register('tile', 'combat_aim_resolve_tile');
combat_aim_register('self', 'combat_aim_resolve_self');
combat_aim_register('none', 'combat_aim_resolve_none');
