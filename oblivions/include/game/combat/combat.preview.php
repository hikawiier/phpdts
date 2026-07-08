<?php
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
//       * combat_get_max_attack_range(&$actor_data)
//           — actor 最大攻击射程（遍历 target=enemy 技能）
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
 * 复制 combat_tag_compute_range 的 5 种 mode 逻辑（不直接调它，因为它需要
 * CombatContext 参数，本函数在 L0 预判阶段尚无 ctx）：
 *   - fixed           ：固定 range_max
 *   - inherit         ：继承 actor 基础射程（obl_get_range）
 *   - additive        ：actor 基础射程 + range_bonus
 *   - capped_additive ：min(actor 基础射程 + range_bonus, range_max)
 *   - move_power      ：obl_get_move_power(actor)
 *
 * @param array  &$actor_data 行动者数据
 * @param string $act_id      技能 ID
 * @return array ['range' => int, 'mode' => string, 'max' => int, 'bonus' => int]
 *                配置缺失返回 ['range'=>0, 'mode'=>'fixed', 'max'=>0, 'bonus'=>0]
 */
function combat_get_action_range_meta(&$actor_data, string $act_id): array {
    $config = combat_skill_get_config($act_id);
    if ($config === null) {
        return ['range' => 0, 'mode' => 'fixed', 'max' => 0, 'bonus' => 0];
    }

    $range_cfg = $config['range'] ?? ['mode' => 'fixed', 'max' => 1, 'bonus' => 0];
    $mode  = (string)($range_cfg['mode'] ?? 'fixed');
    $max   = (int)($range_cfg['max'] ?? 1);
    $bonus = (int)($range_cfg['bonus'] ?? 0);

    switch ($mode) {
        case 'inherit':
            $range = obl_get_range($actor_data);
            break;
        case 'additive':
            $range = obl_get_range($actor_data) + $bonus;
            break;
        case 'capped_additive':
            $range = min(obl_get_range($actor_data) + $bonus, $max);
            break;
        case 'move_power':
            $range = obl_get_move_power($actor_data);
            break;
        case 'fixed':
        default:
            $range = $max;
            break;
    }

    return ['range' => (int)$range, 'mode' => $mode, 'max' => $max, 'bonus' => $bonus];
}

/**
 * 获取 actor 的最大攻击射程
 *
 * 遍历所有技能配置中 target=enemy 的技能，取 action_range 最大值。
 *
 * v1 简化：不实现"装备满足"过滤（技能配置表中无装备需求字段），
 *          所有非 hidden 的 enemy 技能都算可用。
 *          target='all' 的范围技能（whirlwind）不纳入（spec Task 5.2
 *          明确只统计 target=enemy）。
 *
 * @param array &$actor_data 行动者数据
 * @return int 最大攻击射程（BFS 跳数），无可用攻击技能时返回 0
 */
function combat_get_max_attack_range(&$actor_data): int {
    $all_configs = combat_skill_get_all_configs();
    if (empty($all_configs)) {
        return 0;
    }

    $max_range = 0;
    foreach ($all_configs as $act_id => $config) {
        // 只看攻击技能（target='enemy'）
        $target = $config['target'] ?? 'none';
        if ($target !== 'enemy') {
            continue;
        }
        // 过滤 hidden=true（NPC 专属如 idle）
        if (!empty($config['hidden'])) {
            continue;
        }

        $meta = combat_get_action_range_meta($actor_data, (string)$act_id);
        if ($meta['range'] > $max_range) {
            $max_range = $meta['range'];
        }
    }

    return $max_range;
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
function combat_can_engage(&$actor_data, &$target_data): array {
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
        ];
    }

    // 3. 取最大攻击射程，判断可达性
    //    reachable 标准：distance ≤ max_attack_range + move_power
    //    （move_power 允许 actor 先移动靠近再攻击）
    $max_attack_range = combat_get_max_attack_range($actor_data);
    $reachable = ($distance <= $max_attack_range + $move_power);

    return [
        'reachable'        => $reachable,
        'max_attack_range' => $max_attack_range,
        'move_power'       => $move_power,
        'distance'         => $distance,
        'reason'           => $reachable ? null : 'out_of_range',
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
function combat_preview_single(array $actor_data, string $act_id, int $target_pid): array {
    $config = combat_skill_get_config($act_id);
    if ($config === null) {
        return ['pass' => false, 'reason' => 'skill_not_found', 'ap_cost' => 0];
    }

    // 局部副本（值拷贝，不污染外部）
    $sim_actor = $actor_data;
    $sim_battle_cache = [
        'combatants'    => [],
        'tag_mutations' => [],
    ];

    $config_with_target = $config;
    $config_with_target['target_id'] = $target_pid;

    $ctx = new CombatContext($sim_actor, $act_id, $config_with_target, null, $sim_battle_cache);
    $ctx->dry_run = true;

    combat_skill_load_module($act_id);

    // 解析 target（只读，无副作用）
    combat_target_resolve_all($ctx);
    if (!$ctx->success) {
        return ['pass' => false, 'reason' => $ctx->failure_reason ?? 'target_resolve_failed', 'ap_cost' => 0];
    }

    // AP 校验
    $ap_cost = combat_ap_calculate($ctx);
    $actor_ap = (int)($sim_actor['ap'] ?? 0);
    if ($actor_ap < $ap_cost) {
        return ['pass' => false, 'reason' => 'ap_insufficient', 'ap_cost' => $ap_cost];
    }

    // 规则匹配（forbid 标签）
    $tags = $ctx->getCurrentTags();
    $rules_result = combat_check_target_rules($config, $tags);
    if (!$rules_result['pass']) {
        return ['pass' => false, 'reason' => 'rule_failed:' . ($rules_result['reason'] ?? 'unknown'), 'ap_cost' => $ap_cost];
    }

    return ['pass' => true, 'reason' => null, 'ap_cost' => $ap_cost];
}

// ================================================================
// L2 动作链模拟（整条动作链预校验，不修改真实状态）
// ================================================================

/**
 * L2 动作链模拟：模拟整条动作链的合法性 + AP 累计消耗
 *
 * 拷贝 $sim_actor + 局部 battle_cache，依次为每个 action 跑 resolve_target +
 * check_rules + AP 校验。不跑 execute / resolve_effects（不模拟效果应用）。
 *
 * v1 用途：提交前过滤失败动作（内部使用，不暴露给玩家可见的"动作预判"功能）。
 * v1 限制：不模拟效果应用，$sim_actor 位置/HP 在遍历中不更新。
 *          move 后的 action（如 throw）用旧位置算距离/AP，可能误判 out_of_range 或 AP 不足（假阴性）。
 * v2 方向：真正模拟效果应用（前序动作的 HP/位置改动对后序可见）。
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
    $sim_actor = $actor_data;
    $sim_battle_cache = $battle_cache;

    $pending_ap_spent = 0;
    $results = [];
    $total_ap_cost = 0;

    foreach ($actions as $action) {
        $act_id = (string)($action['act_id'] ?? '');
        $config = combat_skill_get_config($act_id);
        if ($config === null) {
            $results[] = ['success' => false, 'reason' => 'skill_not_found', 'ap_cost' => 0, 'effects' => []];
            continue;
        }

        $target_intent = combat_action_normalize_target(
            array_key_exists('target', $action) ? $action['target'] : null,
            $config,
            (int)($sim_actor['pid'] ?? 0)
        );
        if ($target_intent === null) {
            $results[] = ['success' => false, 'reason' => 'invalid_target', 'ap_cost' => 0, 'effects' => []];
            continue;
        }

        $config_with_target = combat_action_config_with_target($config, ['target' => $target_intent]);

        $ctx = new CombatContext($sim_actor, $act_id, $config_with_target, null, $sim_battle_cache);
        $ctx->dry_run = true;

        combat_skill_load_module($act_id);

        combat_target_resolve_all($ctx);
        if (!$ctx->success) {
            $results[] = ['success' => false, 'reason' => $ctx->failure_reason ?? 'target_resolve_failed', 'ap_cost' => 0, 'effects' => []];
            continue;
        }

        $ap_cost = combat_ap_calculate($ctx);
        $actor_ap = (int)($sim_actor['ap'] ?? 0);

        if ($actor_ap - $pending_ap_spent - $ap_cost < 0) {
            $results[] = ['success' => false, 'reason' => 'ap_insufficient', 'ap_cost' => $ap_cost, 'effects' => []];
            continue;
        }

        $tags = $ctx->getCurrentTags();
        $rules_result = combat_check_target_rules($config, $tags);
        if (!$rules_result['pass']) {
            $results[] = ['success' => false, 'reason' => 'rule_failed:' . ($rules_result['reason'] ?? 'unknown'), 'ap_cost' => $ap_cost, 'effects' => []];
            continue;
        }

        $pending_ap_spent += $ap_cost;
        $total_ap_cost += $ap_cost;
        $results[] = ['success' => true, 'reason' => null, 'ap_cost' => $ap_cost, 'effects' => []];
    }

    return [
        'actions'          => $results,
        'total_ap_cost'    => $total_ap_cost,
        'predicted_kills'  => 0,  // v1 不模拟伤害
        'actor_final_state' => [
            'ap' => (int)($sim_actor['ap'] ?? 0) - $total_ap_cost,
            'hp' => (int)($sim_actor['hp'] ?? 0),
        ],
    ];
}
