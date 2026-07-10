<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 效果系统（声明 + 应用器注册表）
//
// 职责：
//   - 应用器注册表 $combat_effect_appliers：效果 type => 应用器
//   - 应用器签名：function(CombatContext $ctx, array $effect): bool（无 &）
//     返回 true=成功，false=非致命失败（记录日志，继续后续效果）
//   - 入口函数 combat_effect_apply_all：遍历当前 target 的 effects，按声明顺序应用
//
// 应用规则（spec）：
//   - 按**声明顺序应用**（FIFO）——技能模块控制顺序（如吸血：先 damage 后 heal）
//   - **不回滚**——失败的效果记录日志，不中断后续效果
//   - 致命错误（target 不存在）短路整个 action：应用器设 $ctx->success=false
//     + $ctx->failure_reason，入口函数检测后立即返回
//
// 关键约束：
//   - 应用器**不调** obl_save_player（persist 阶段统一保存）
//   - effects 是 per-target 的：combat_effect_apply_all 对每个 target 调用一次
//   - target_data 修改通过 getCurrentTarget() 的 & 返回 + 引用链路生效
//     （pid 目标改 targets[i].target_data，self 目标改回流到 actor_data）
//
// move 效果是特例：位置已在 execute 阶段更新（obl_perform_move_core），
//   应用器只 emit 日志，不改位置。
//
// 历史旧系统效果曾散落在 battle_once_execute 内联逻辑中。
// 当前新系统集中到 effect 应用器注册表，便于扩展 + 测试。
// ================================================================

/** @var array 效果应用器注册表（效果 type => callable） */
if (!isset($GLOBALS['combat_effect_appliers'])) {
    $GLOBALS['combat_effect_appliers'] = [];
}

/**
 * 注册效果应用器
 *
 * @param string   $type    效果类型（damage / heal / move / escape / ap_change / 自定义）
 * @param callable $applier 应用器签名：function(CombatContext $ctx, array $effect): bool
 */
function combat_effect_register(string $type, callable $applier): void {
    $GLOBALS['combat_effect_appliers'][$type] = $applier;
}

/**
 * 按 effect.target_pid / payload.target_pid 解析真正受影响的数据引用。
 *
 * 默认效果作用于当前 target；若 payload 指定 target_pid，则允许作用到 actor、
 * 其他已解析 target，或按需 fetch 后挂到当前 target.effect_targets，供后续
 * post_check / persist 在内存中找到并保存。
 *
 * @param CombatContext $ctx
 * @param array         $effect
 * @return array
 */
function &combat_effect_resolve_target_data(CombatContext $ctx, array $effect): array {
    static $missing_target = [];
    $missing_target = [];

    $payload = isset($effect['payload']) && is_array($effect['payload']) ? $effect['payload'] : [];
    $scope = (string)($payload['scope'] ?? ($effect['scope'] ?? 'target'));
    if ($scope === 'actor') {
        return $ctx->actor_data;
    }
    if (isset($payload['target_pid']) || isset($effect['target_pid'])) return $missing_target;
    $target = &$ctx->getCurrentTarget();
    if (isset($target['target_data']) && is_array($target['target_data'])) return $target['target_data'];
    return $missing_target;
}

function combat_effect_target_ref(CombatContext $ctx, array $target_data): array {
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid > 0 && $pid === (int)($ctx->actor_data['pid'] ?? 0)) {
        return [
            'kind' => 'self',
            'pid' => $pid,
            'snapshot' => combat_log_v2_combatant_snapshot($ctx->actor_data),
        ];
    }
    if ($pid > 0) {
        return [
            'kind' => 'pid',
            'pid' => $pid,
            'snapshot' => combat_log_v2_combatant_snapshot($target_data),
        ];
    }
    return ['kind' => 'none'];
}

// ================================================================
// 内置应用器
// ================================================================

/**
 * damage 应用器：扣 target HP（不低于 0）+ emit damage 日志
 *
 * target 从 $ctx->getCurrentTarget()['target_data'] 取（引用，修改生效）。
 * $effect['payload']['value'] 是伤害值。
 * 读取 $effect['is_counter'] 字段（反击预留，v1 不实现反击检查）。
 * target_data 为 null 时视为致命错误，短路整个 action。
 *
 * @param CombatContext $ctx
 * @param array         $effect
 * @return bool
 */
function combat_effect_damage(CombatContext $ctx, array $effect): bool {
    $target_data = &combat_effect_resolve_target_data($ctx, $effect);

    if ((int)($target_data['pid'] ?? 0) <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'damage_target_missing';
        combat_debug_log('EFFECT_DAMAGE_FAIL', ['reason'=>'target_missing', 'act_id'=>$ctx->act_id]);
        return false;
    }

    $value = (int)($effect['payload']['value'] ?? 0);
    $hp_before = (int)($target_data['hp'] ?? 0);
    $target_data['hp'] = max(0, $hp_before - $value);
    $hp_after = (int)$target_data['hp'];
    combat_debug_log('EFFECT_DAMAGE', ['act_id'=>$ctx->act_id, 'target_pid'=>(int)($target_data['pid']??0), 'value'=>$value, 'hp_before'=>$hp_before, 'hp_after'=>(int)$target_data['hp']]);

    // 反击预留：当前不实现反击检查，仅读取字段以备未来扩展
    $is_counter = !empty($effect['is_counter']);

    combat_log_v2_effect_applied($ctx, 'damage', [
        'target' => combat_effect_target_ref($ctx, $target_data),
        'value' => $value,
        'delta' => [
            'hp_before' => $hp_before,
            'hp_after' => $hp_after,
        ],
        'flags' => [
            'counter' => $is_counter,
        ],
    ]);

    return true;
}

/**
 * heal 应用器：加 HP 且不超过 mhp + emit heal 日志
 *
 * @param CombatContext $ctx
 * @param array         $effect
 * @return bool
 */
function combat_effect_heal(CombatContext $ctx, array $effect): bool {
    $target_data = &combat_effect_resolve_target_data($ctx, $effect);

    if ((int)($target_data['pid'] ?? 0) <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'heal_target_missing';
        return false;
    }

    $value = (int)($effect['payload']['value'] ?? 0);
    $mhp   = (int)($target_data['mhp'] ?? 0);
    $hp_before = (int)($target_data['hp'] ?? 0);
    $target_data['hp'] = min($mhp, $hp_before + $value);
    $hp_after = (int)$target_data['hp'];

    combat_log_v2_effect_applied($ctx, 'heal', [
        'target' => combat_effect_target_ref($ctx, $target_data),
        'value' => $value,
        'delta' => [
            'hp_before' => $hp_before,
            'hp_after' => $hp_after,
        ],
    ]);

    return true;
}

/**
 * move 应用器：只 emit move 日志（位置已在 execute 阶段更新）
 *
 * move 是特例：obl_perform_move_core 在 execute 阶段已改 actor.pls（原子化避免并发占用），
 * resolve_effects 阶段本应用器只补 emit 日志。
 *
 * @param CombatContext $ctx
 * @param array         $effect
 * @return bool
 */
function combat_effect_move(CombatContext $ctx, array $effect): bool {
    $to_pls = (int)($effect['payload']['to_pls'] ?? 0);
    $result = obl_perform_move_core($ctx->actor_data, $to_pls);
    if (empty($result['success'])) {
        $ctx->success = false;
        $ctx->failure_reason = 'move_failed:' . ($result['reason'] ?? 'unknown');
        return false;
    }
    $target = &$ctx->getCurrentTarget();
    combat_log_v2_effect_applied($ctx, 'move', [
        'target' => combat_log_v2_target_ref($ctx, $target),
        'delta' => [
            'pls_before' => (int)($effect['payload']['from_pls'] ?? 0),
            'pls_after' => (int)($effect['payload']['to_pls'] ?? 0),
        ],
    ]);
    return true;
}

/**
 * 为 escape 选择确定性的相邻世界退避落点。
 * 优先最大化与其他活跃战斗成员的最短距离，同分取较小 pls。
 */
function combat_effect_select_retreat_target(CombatContext $ctx): int {
    $actor_pid = (int)($ctx->actor_data['pid'] ?? 0);
    $pgroup = (int)($ctx->actor_data['pgroup'] ?? 0);
    $from_pls = (int)($ctx->actor_data['pls'] ?? 0);
    if ($actor_pid <= 0 || $pgroup <= 0 || $from_pls <= 0) return $from_pls;

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? [];
    $neighbors = isset($tiles[$from_pls]['neighbors']) && is_array($tiles[$from_pls]['neighbors'])
        ? array_map('intval', $tiles[$from_pls]['neighbors'])
        : [];
    sort($neighbors, SORT_NUMERIC);

    $threat_tiles = [];
    foreach (($ctx->battle_cache['combatants'] ?? []) as $pid => $active) {
        $pid = (int)$pid;
        if (!$active || $pid <= 0 || $pid === $actor_pid) continue;
        $threat = obl_fetch_playerdata_by_pid($pid);
        if (!$threat || (int)($threat['state'] ?? 0) > 0 || (int)($threat['pgroup'] ?? 0) !== $pgroup) continue;
        $threat_tiles[] = (int)$threat['pls'];
    }

    $best_pls = $from_pls;
    $best_score = -1;
    foreach ($neighbors as $candidate) {
        if (!isset($tiles[$candidate]) || empty($tiles[$candidate]['passable'])) continue;
        if (!empty(obl_get_pids_in_tile($pgroup, $candidate, $actor_pid))) continue;

        $score = empty($threat_tiles) ? 0 : PHP_INT_MAX;
        foreach ($threat_tiles as $threat_pls) {
            $distance = obl_get_distance($pgroup, $candidate, $threat_pls);
            if ($distance < 0) continue 2;
            $score = min($score, $distance);
        }
        if ($score > $best_score) {
            $best_score = $score;
            $best_pls = $candidate;
        }
    }
    return $best_pls;
}

/**
 * escape 应用器：确定世界退避落点、写 tag_mutations.escaped + emit
 *
 * 副作用：
 *   - $ctx->battle_cache['tag_mutations'][actor_pid]['escaped'] = true
 *   - $ctx->battle_cache['combatants'][actor_pid] = 0（不再活跃）
 *
 * @param CombatContext $ctx
 * @param array         $effect
 * @return bool
 */
function combat_effect_escape(CombatContext $ctx, array $effect): bool {
    $actor_pid = (int)($ctx->actor_data['pid'] ?? 0);
    $state_before = (int)($ctx->actor_data['state'] ?? 0);
    $pls_before = (int)($ctx->actor_data['pls'] ?? 0);
    $retreat_target = combat_effect_select_retreat_target($ctx);
    if ($retreat_target > 0) {
        $ctx->actor_data['pls'] = $retreat_target;
        if ((int)($ctx->actor_data['type'] ?? 0) > 0 && function_exists('obl_update_enemy_discovered')) {
            foreach (($ctx->battle_cache['combatants'] ?? []) as $pid => $active) {
                if (!$active || (int)$pid === $actor_pid) continue;
                $player = obl_fetch_playerdata_by_pid((int)$pid);
                if ($player && (int)($player['type'] ?? -1) === 0) {
                    obl_update_enemy_discovered($ctx->actor_data, $player);
                    break;
                }
            }
        }
    }

    // 写 tag_mutations.escaped（当前战斗内跨 action 可见；不污染持久 player state）
    if (!isset($ctx->battle_cache['tag_mutations'][$actor_pid])) {
        $ctx->battle_cache['tag_mutations'][$actor_pid] = [
            'dead'    => false,
            'escaped' => false,
            'hidden'  => false,
        ];
    }
    $ctx->battle_cache['tag_mutations'][$actor_pid]['escaped'] = true;
    $ctx->battle_cache['tag_mutations'][$actor_pid]['retreat_from_pls'] = $pls_before;
    $ctx->battle_cache['tag_mutations'][$actor_pid]['retreat_target'] = [
        'pgroup' => (int)($ctx->actor_data['pgroup'] ?? 0),
        'pls' => (int)($ctx->actor_data['pls'] ?? $pls_before),
    ];
    $ctx->battle_cache['tag_mutations'][$actor_pid]['retreat_visual_policy'] = $retreat_target !== $pls_before
        ? 'retreat'
        : 'settle-in-place';

    // combatants 标记为 0（不再活跃，main_end 流程集中 cleanup）
    $ctx->battle_cache['combatants'][$actor_pid] = 0;

    combat_log_v2_effect_applied($ctx, 'escape', [
        'target' => combat_log_v2_actor_target_ref($ctx),
        'delta' => [
            'state_before' => $state_before,
            'state_after' => (int)($ctx->actor_data['state'] ?? 0),
            'pls_before' => $pls_before,
            'pls_after' => (int)($ctx->actor_data['pls'] ?? $pls_before),
        ],
        'detail' => [
            'retreat_target' => $ctx->battle_cache['tag_mutations'][$actor_pid]['retreat_target'],
            'visual_policy' => $ctx->battle_cache['tag_mutations'][$actor_pid]['retreat_visual_policy'],
        ],
    ]);

    return true;
}

/**
 * ap_change 应用器：改 actor AP + emit（预留注册位 + TODO）
 *
 * 当前不实现实际 AP 修改逻辑（AP 扣减由 planned wallet / persist 统一处理）。
 * 保留注册位以便未来 buff/debuff 修改 AP 时复用本应用器。
 *
 * @param CombatContext $ctx
 * @param array         $effect
 * @return bool
 */
function combat_effect_ap_change(CombatContext $ctx, array $effect): bool {
    // TODO: 实现 AP 修改（buff/debuff 场景）
    // AP 扣减由 planned wallet（combat.chain.php）+ persist 统一处理，不走本应用器
    $delta = (int)($effect['payload']['delta'] ?? 0);
    $target = &$ctx->getCurrentTarget();
    $ap_before = (int)($ctx->actor_data['ap'] ?? 0);

    combat_log_v2_effect_applied($ctx, 'ap_change', [
        'target' => combat_log_v2_target_ref($ctx, $target),
        'value' => $delta,
        'delta' => [
            'ap_before' => $ap_before,
            'ap_after' => (int)($ctx->actor_data['ap'] ?? 0),
        ],
    ]);

    return true;
}

// ================================================================
// 入口函数
// ================================================================

/**
 * 应用当前 target 的所有声明效果
 *
 * 流程：
 *   - 遍历 $ctx->getCurrentEffects()（当前 target 的 effects，FIFO 顺序）
 *   - 按 $effect['type'] 查注册表分发到应用器
 *   - 应用器返回 false 且 $ctx->success 仍为 true → 非致命失败，记录日志后继续
 *   - 应用器设 $ctx->success=false → 致命错误，短路整个 action（立即返回）
 *   - 未注册的 type → 记录日志后跳过（容错）
 *
 * per-target 调用：管道的 resolve_effects 阶段对每个 target 调用本函数一次。
 *
 * @param CombatContext $ctx
 */
function combat_effect_apply_all(CombatContext $ctx): void {
    $effects = $ctx->getCurrentEffects();
    if (empty($effects)) return;

    foreach ($effects as $effect) {
        // 致命错误短路（前一个效果已设 success=false）
        if (!$ctx->success) return;

        $type = $effect['type'] ?? '';
        if ($type === '') {
            error_log('[combat_effect] Effect missing type field, skipped');
            continue;
        }

        $applier = $GLOBALS['combat_effect_appliers'][$type] ?? null;
        if (!$applier) {
            error_log("[combat_effect] Unknown effect type: {$type}, skipped");
            continue;
        }

        $result = call_user_func($applier, $ctx, $effect);

        // 非致命失败：记录日志，继续后续效果（不回滚）
        if ($result === false) {
            if (!$ctx->success) {
                // 致命错误：短路整个 action
                return;
            }
            error_log("[combat_effect] Effect non-fatal failure: type={$type}");
            // 继续下一个效果
        }
    }
}

// ================================================================
// 注册内置应用器
// ================================================================

combat_effect_register('damage',    'combat_effect_damage');
combat_effect_register('heal',      'combat_effect_heal');
combat_effect_register('move',      'combat_effect_move');
combat_effect_register('escape',    'combat_effect_escape');
combat_effect_register('ap_change', 'combat_effect_ap_change');
