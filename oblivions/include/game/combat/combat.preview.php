<?php
/**
 * @module D 战斗系统（Combat）
 * @framework D-2 四层预览/预演系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 预校验系统
//
// 职责：三层预校验（dry_run 模式，不修改真实状态）。
//   - L0 可达性：目标是否可达（距离/视野/同区域）
//   - L1 即时：单次 action 是否合法（AP/CD/拥有）
//   - L2 动作链模拟（v2）：模拟整条动作链的连锁效果
//
// L0 分两层：
//   (a) 独立 L0 函数（无 CombatContext 依赖，供前端"点击敌人发起战斗"
//       预判调用，actor_data 入参即可）：
//       * combat_get_action_range_meta(&$actor_data, $act_id)
//           — 单技能射程元信息
//       * combat_can_engage(&$actor_data, &$target_data)
//           — actor 能否对 target 发起战斗（前端 toast 数据源）
//   (b) 旧 L0 stub（接受 CombatContext，后续与 pipeline 整合时再启用）：
//       * combat_preview_l0_reachability(CombatContext $ctx)
//
// 与旧系统边界：旧系统无预校验，提交即执行。
//   新系统支持 dry_run，前端可预演（$ctx->dry_run = true 时 pipeline 不写真实状态）。
//
// 依赖（由 obl_bootstrap.php 在本文件之前加载）：
//   - combat.skill.php   ：combat_skill_get_config / combat_skill_get_all_configs
//   - battle.calc.php    ：obl_get_range（actor 基础射程）
//   - move.func.php      ：obl_get_move_power / obl_get_distance
// ================================================================

// ================================================================
// L0 独立函数（actor_data 入参，无 CombatContext 依赖）
// ================================================================

/**
 * 获取单个技能的射程元信息
 *
 * 基于 combat_skill_get_config 读取新配置结构
 * $config['range'] = ['mode' => ..., 'max' => int, 'bonus' => int]。
 *
 * 射程由 combat_range_resolve_base 统一解析，支持 5 种 mode：
 *   - fixed           ：固定 range_max
 *   - inherit         ：继承 actor 基础射程（obl_get_range）
 *   - additive        ：actor 基础射程 + range_bonus
 *   - capped_additive ：min(actor 基础射程 + range_bonus, range_max)
 *   - move_power      ：基础值为 obl_get_move_power(actor)，有效值由 AP 预算投影
 *
 * @param array  &$actor_data 行动者数据
 * @param string $act_id      技能 ID
 * @return array ['range' => int, 'mode' => string, 'max' => int, 'bonus' => int]
 *                配置缺失返回 ['range'=>0, 'mode'=>'fixed', 'max'=>0, 'bonus'=>0]
 */
function combat_get_action_range_meta(&$actor_data, string $act_id): array {
    $resolved = combat_range_resolve_base($actor_data, $act_id);
    return array(
        'range' => (int)$resolved['base_range'],
        'effective_range' => $resolved['effective_range'],
        'mode' => $resolved['mode'],
        'max' => (int)$resolved['max'],
        'bonus' => (int)$resolved['bonus'],
        'ok' => !empty($resolved['ok']),
        'reason' => $resolved['reason'],
    );
}

/**
 * 判断 actor 是否能对 target 发起战斗
 *
 * 供前端"点击敌人发起战斗"时调用，判断目标是否可达。
 *
 * 判断逻辑：
 *   1. 跨区域检查：actor.pgroup !== target.pgroup
 *      → reachable=false, reason='cross_zone'
 *   2. 算距离：obl_get_distance(actor.pgroup, actor.pls, target.pls)
 *      不可达（-1）→ reachable=false, reason='unreachable'
 *   3. 取 max_attack_range + move_power，
 *      判断 distance ≤ max_attack_range + move_power
 *      不满足 → reachable=false, reason='out_of_range'
 *
 * 返回结构含 max_attack_range / move_power / distance 数值，
 * 供前端 toast 显示"超出射程 X 格"等提示。
 *
 * @param array &$actor_data  行动者数据
 * @param array &$target_data 目标数据
 * @return array ['reachable' => bool, 'max_attack_range' => int,
 *                'move_power' => int, 'distance' => int,
 *                'reason' => string|null]
 */
function combat_engagement_available_actions(array $actor_data): array {
    $actions = [];
    foreach (combat_skill_get_all_configs() as $act_id => $config) {
        if (!empty($config['hidden'])
            || (string)($config['pipeline'] ?? '') !== 'attack'
            || (string)($config['aim']['resolver'] ?? 'none') !== 'pid'
            || (string)($config['capture']['relation'] ?? 'any') !== 'hostile'
            || !combat_skill_actor_owns($actor_data, (string)$act_id, $config)
            || empty(combat_skill_cd_check($actor_data, (string)$act_id, $config)['pass'])) {
            continue;
        }
        $actions[(string)$act_id] = $config;
    }
    ksort($actions, SORT_STRING);
    return $actions;
}

function combat_engagement_plan(array $actor_data, array $target_data): array {
    $attack_configs = combat_engagement_available_actions($actor_data);
    $max_attack_range = 0;
    foreach ($attack_configs as $act_id => $_config) {
        $range = combat_range_resolve_base($actor_data, $act_id);
        if (!empty($range['ok'])) $max_attack_range = max($max_attack_range, (int)($range['base_range'] ?? 0));
    }

    $move_config = combat_skill_get_config('move');
    $move_available = is_array($move_config)
        && combat_skill_actor_owns($actor_data, 'move', $move_config)
        && !empty(combat_skill_cd_check($actor_data, 'move', $move_config)['pass']);
    $move_power = $move_available ? obl_get_move_power($actor_data) : 0;
    $plans = [];
    $target_pid = (int)($target_data['pid'] ?? 0);
    $base_cache = combat_cache_create($actor_data, false);
    if ($move_available && (int)($actor_data['type'] ?? 0) === 0) {
        combat_observation_preload_revealed_tiles($base_cache, (int)($actor_data['pgroup'] ?? 0));
    }

    foreach ($attack_configs as $act_id => $_config) {
        $plans[] = [[
            'act_id' => $act_id,
            'target' => ['type' => 'pid', 'id' => $target_pid],
            'params' => [],
        ]];
    }

    if ($move_available) {
        $pgroup = (int)($actor_data['pgroup'] ?? 0);
        $map = obl_get_map_data($pgroup);
        $tiles = $map['tiles'][$pgroup] ?? [];
        ksort($tiles, SORT_NUMERIC);
        foreach ($tiles as $pls => $tile) {
            $pls = (int)$pls;
            if ($pls === (int)($actor_data['pls'] ?? 0) || empty($tile['passable'])) continue;
            foreach ($attack_configs as $act_id => $_config) {
                $plans[] = [
                    ['act_id' => 'move', 'target' => ['type' => 'tile', 'id' => $pls], 'params' => []],
                    ['act_id' => $act_id, 'target' => ['type' => 'pid', 'id' => $target_pid], 'params' => []],
                ];
            }
        }
    }

    $candidates = [];
    foreach ($plans as $actions) {
        $null_log = null;
        $projection = combat_chain_project($actor_data, $actions, $base_cache, $null_log, [
            'emit_failures' => false,
            'check_ownership' => true,
            'check_cd' => true,
        ]);
        $results = $projection['actions'] ?? [];
        if (count($results) !== count($actions) || count(array_filter($results, static fn(array $result): bool => !empty($result['success']))) !== count($actions)) {
            continue;
        }
        $approach_pls = count($actions) > 1 ? (int)($actions[0]['target']['id'] ?? 0) : (int)($actor_data['pls'] ?? 0);
        $candidates[] = [
            'actions' => $actions,
            'total_ap_cost' => (int)($projection['total_ap_cost'] ?? 0),
            'approach_pls' => $approach_pls,
            'attack_act_id' => (string)($actions[count($actions) - 1]['act_id'] ?? ''),
        ];
    }

    usort($candidates, static function (array $a, array $b): int {
        return [$a['total_ap_cost'], count($a['actions']), $a['approach_pls'], $a['attack_act_id']]
            <=> [$b['total_ap_cost'], count($b['actions']), $b['approach_pls'], $b['attack_act_id']];
    });

    return [
        'plan' => $candidates[0] ?? null,
        'max_attack_range' => $max_attack_range,
        'move_power' => $move_power,
    ];
}

function combat_engagement_not_visible_result(): array {
    return [
        'reachable' => false,
        'max_attack_range' => 0,
        'move_power' => 0,
        'distance' => -1,
        'reason' => 'TARGET_NOT_VISIBLE',
        'plan' => null,
    ];
}

function combat_can_engage(&$actor_data, &$target_data): array {
    $evaluation_tick = combat_next_action_evaluation_tick();
    $actor_capability = actor_capability_decide($actor_data, 'enter_combat', null, $evaluation_tick);
    if (empty($actor_capability['allowed'])) {
        return [
            'reachable' => false,
            'max_attack_range' => 0,
            'move_power' => 0,
            'distance' => -1,
            'reason' => 'actor_capability_blocked',
            'capability_failure' => skill_effect_project_capability_decision(
                $actor_data,
                'enter_combat',
                $evaluation_tick,
                true
            ),
            'plan' => null,
        ];
    }
    if (!combat_observation_character_detected($actor_data, $target_data)) {
        return combat_engagement_not_visible_result();
    }
    $target_capability = actor_capability_decide($target_data, 'participate_combat', null, $evaluation_tick);
    if (empty($target_capability['allowed'])) {
        return [
            'reachable' => false,
            'max_attack_range' => 0,
            'move_power' => 0,
            'distance' => -1,
            'reason' => 'target_capability_blocked',
            'capability_failure' => skill_effect_project_capability_decision(
                $target_data,
                'participate_combat',
                $evaluation_tick,
                true
            ),
            'plan' => null,
        ];
    }
    $actor_pgroup  = (int)($actor_data['pgroup'] ?? 0);
    $target_pgroup = (int)($target_data['pgroup'] ?? 0);

    // 1. 跨区域检查
    if ($actor_pgroup !== $target_pgroup) {
        return [
            'reachable'        => false,
            'max_attack_range' => 0,
            'move_power'       => 0,
            'distance'         => -1,
            'reason'           => 'cross_zone',
            'plan'             => null,
        ];
    }

    // 2. 距离计算（同区域内 BFS 跳数）
    $distance = obl_get_distance(
        $actor_pgroup,
        (int)($actor_data['pls'] ?? 0),
        (int)($target_data['pls'] ?? 0)
    );

    $move_power = obl_get_move_power($actor_data);

    if ($distance < 0) {
        return [
            'reachable'        => false,
            'max_attack_range' => 0,
            'move_power'       => $move_power,
            'distance'         => -1,
            'reason'           => 'unreachable',
            'plan'             => null,
        ];
    }

    $engagement = combat_engagement_plan($actor_data, $target_data);
    $max_attack_range = (int)$engagement['max_attack_range'];
    $move_power = (int)$engagement['move_power'];
    $plan = $engagement['plan'];
    $reachable = is_array($plan);

    return [
        'reachable'        => $reachable,
        'max_attack_range' => $max_attack_range,
        'move_power'       => $move_power,
        'distance'         => $distance,
        'reason'           => $reachable ? null : 'out_of_range',
        'plan'             => $plan,
    ];
}

// ================================================================
// L1 即时校验（单次 action 合法性，dry_run 不修改真实状态）
// ================================================================

/**
 * L1 即时预校验：单次 action 是否合法
 *
 * 构建临时 ctx（dry_run=true，不引用真实 battle_cache），跑 resolve_target +
 * check_rules + AP 校验。不跑 execute / resolve_effects（不模拟效果应用）。
 *
 * 用途：前端在战斗 UI 中选择技能 + 目标后，提交前调本函数预判合法性，
 * 失败时 toast 提示原因（AP 不够 / 射程不够 / 规则禁止等）。
 *
 * @param array  $actor_data 行动者数据（值传递，不污染外部）
 * @param string $act_id     技能 ID
 * @param int    $target_pid 目标 PID（enemy 类技能用；self/none 类技能忽略）
 * @return array ['pass' => bool, 'reason' => string|null, 'ap_cost' => int]
 */
function combat_preview_single(array $actor_data, string $act_id, $aim_intent): array {
    $config = combat_skill_get_config($act_id);
    if ($config === null) {
        return ['pass' => false, 'reason' => 'skill_not_found', 'ap_cost' => 0];
    }

    if (!is_array($aim_intent)) {
        $resolver = (string)($config['aim']['resolver'] ?? 'none');
        $aim_intent = in_array($resolver, ['pid', 'tile'], true)
            ? ['type' => $resolver, 'id' => (int)$aim_intent]
            : ['type' => $resolver];
    }
    $projection = combat_chain_project($actor_data, [[
        'act_id' => $act_id,
        'target' => $aim_intent,
        'params' => [],
    ]], combat_cache_create($actor_data, false));
    $result = $projection['actions'][0] ?? ['success' => false, 'reason' => 'preview_failed', 'ap_cost' => 0];
    return [
        'pass' => !empty($result['success']),
        'reason' => $result['reason'] ?? null,
        'ap_cost' => (int)($result['ap_cost'] ?? 0),
        'resolved_aim' => $result['resolved_aim'] ?? null,
        'targets' => $result['target_results'] ?? [],
    ];
}

function combat_preview_reason_public(?string $reason): ?string {
    if ($reason === null || $reason === '') return null;
    foreach (array('target_resolve_failed:', 'AIM_RULE_FAILED:', 'rule_forbid:') as $prefix) {
        if (strpos($reason, $prefix) === 0) return substr($reason, strlen($prefix));
    }
    return $reason;
}

function combat_preview_targets(array $actor_data, string $act_id, array $prefix_actions, array $candidate_ids): array {
    $config = combat_skill_get_config($act_id);
    if ($config === null) {
        return array('origin_pls' => (int)($actor_data['pls'] ?? 0), 'range' => array(), 'targets' => array(), 'reason' => 'skill_not_found');
    }
    $resolver = (string)($config['aim']['resolver'] ?? 'none');
    if (!in_array($resolver, array('pid', 'tile'), true)) {
        return array('origin_pls' => (int)($actor_data['pls'] ?? 0), 'range' => array(), 'targets' => array(), 'reason' => 'unsupported_aim_resolver');
    }

    $planned_actor = $actor_data;
    $planned_cache = combat_cache_create($planned_actor, false);
    $prefix_failed = false;
    if (!empty($prefix_actions)) {
        $null_log = null;
        $prefix = combat_chain_project($planned_actor, $prefix_actions, $planned_cache, $null_log, array(
            'emit_failures' => false,
            'check_ownership' => true,
            'check_cd' => true,
        ));
        foreach (($prefix['actions'] ?? array()) as $result) {
            if (empty($result['success'])) { $prefix_failed = true; break; }
        }
        $planned_cache = isset($prefix['battle_cache']) && is_array($prefix['battle_cache']) ? $prefix['battle_cache'] : $planned_cache;
        $planned_from_cache = combat_planned_state_get_player($planned_cache, (int)($actor_data['pid'] ?? 0));
        if (is_array($planned_from_cache)) $planned_actor = $planned_from_cache;
        elseif (isset($prefix['actor_final_state']) && is_array($prefix['actor_final_state'])) $planned_actor = array_merge($planned_actor, $prefix['actor_final_state']);
    }

    $range_profile = function_exists('combat_range_resolve_base')
        ? combat_range_resolve_base($planned_actor, $act_id)
        : array('ok' => false, 'reason' => 'range_service_unavailable');
    $range = array();
    if (!empty($range_profile['ok'])) {
        $range = array(
            'mode' => (string)($range_profile['mode'] ?? 'fixed'),
            'base' => (int)($range_profile['base_range'] ?? 0),
            'available_ap' => (int)($range_profile['available_ap'] ?? ($planned_actor['ap'] ?? 0)),
            'base_apcost' => (int)($range_profile['base_apcost'] ?? ($config['apcost'] ?? 0)),
        );
        if (($range_profile['effective_range'] ?? null) !== null) $range['effective'] = (int)$range_profile['effective_range'];
    }

    if (in_array((string)($config['aim']['observation'] ?? 'none'), array('revealed', 'controller_known'), true)
        && (int)($planned_actor['type'] ?? 0) === 0) {
        combat_observation_preload_revealed_tiles($planned_cache, (int)($planned_actor['pgroup'] ?? 0));
    }

    $targets = array();
    foreach ($candidate_ids as $candidate_id) {
        $candidate_id = (int)$candidate_id;
        $key = (string)$candidate_id;
        if ($prefix_failed) {
            $targets[$key] = array('selectable' => false, 'distance' => null, 'reason' => 'prefix_invalid');
            continue;
        }
        $action = array(
            'act_id' => $act_id,
            'target' => array('type' => $resolver, 'id' => $candidate_id),
            'params' => array(),
        );
        $null_log = null;
        $projection = combat_chain_project($planned_actor, array($action), $planned_cache, $null_log, array(
            'emit_failures' => false,
            'check_ownership' => true,
            'check_cd' => true,
        ));
        $result = $projection['actions'][0] ?? array('success' => false, 'reason' => 'preview_failed');
        $reason = combat_preview_reason_public(isset($result['reason']) ? (string)$result['reason'] : null);
        $distance = null;
        $resolved = isset($result['resolved_aim']) && is_array($result['resolved_aim']) ? $result['resolved_aim'] : null;
        if (is_array($resolved) && !in_array($reason, array('tile_unrevealed', 'TARGET_NOT_VISIBLE'), true)) {
            $distance_value = obl_get_distance(
                (int)($planned_actor['pgroup'] ?? 0),
                (int)($planned_actor['pls'] ?? 0),
                (int)($resolved['pls'] ?? 0)
            );
            if ($distance_value >= 0) $distance = $distance_value;
        }
        $targets[$key] = array(
            'selectable' => !empty($result['success']),
            'distance' => $distance,
            'reason' => !empty($result['success']) ? null : ($reason ?: 'preview_failed'),
        );
    }
    return array(
        'origin_pls' => (int)($planned_actor['pls'] ?? 0),
        'range' => $range,
        'targets' => $targets,
        'reason' => $prefix_failed ? 'prefix_invalid' : null,
    );
}

// ================================================================
// L2 动作链模拟（整条动作链预校验，不修改真实状态）
// ================================================================

/**
 * L2 动作链模拟：模拟整条动作链的合法性 + AP 累计消耗
 *
 * 拷贝 actor + battle_cache，调用 combat_chain_project 依次为每个 action 跑
 * resolve_target + check_rules + AP 校验 + skill effect 声明 + effect 投影。
 *
 * 用途：提交前过滤失败动作或为前端提供动作链预判。与 combat_verify 共用
 * PlannedState + Effect Projector 语义，前序动作的 HP/AP/位置/tag 变化对后序可见。
 *
 * @param array $actor_data  行动者数据（值传递）
 * @param array $actions     action 数组 [['act_id'=>..., 'target'=>...], ...]
 * @param array $battle_cache 战斗缓存（值拷贝，不引用真实战斗）
 * @return array [
 *     'actions' => [['success'=>bool, 'reason'=>string|null, 'ap_cost'=>int, 'effects'=>[]], ...],
 *     'total_ap_cost' => int,
 *     'predicted_kills' => int,  // v1 始终 0（不模拟伤害）
 *     'actor_final_state' => ['ap'=>int, 'hp'=>int],
 * ]
 */
function combat_preview_chain(array $actor_data, array $actions, array $battle_cache): array {
    $null_log = null;
    $projection = combat_chain_project($actor_data, $actions, $battle_cache, $null_log, [
        'emit_failures' => false,
        'check_ownership' => false,
        'check_cd' => false,
    ]);
    return [
        'actions'          => $projection['actions'] ?? [],
        'total_ap_cost'    => (int)($projection['total_ap_cost'] ?? 0),
        'predicted_kills'  => 0,  // v1 不模拟伤害
        'actor_final_state' => $projection['actor_final_state'] ?? [
            'ap' => (int)($actor_data['ap'] ?? 0),
            'hp' => (int)($actor_data['hp'] ?? 0),
        ],
    ];
}
