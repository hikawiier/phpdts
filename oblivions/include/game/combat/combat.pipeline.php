<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 管道阶段
//
// 职责：管道阶段函数 + 管道配置注册表。
//   - 管道配置注册表 $GLOBALS['combat_pipelines']：pipeline 名 => 阶段列表
//   - 阶段函数签名：function(CombatContext $ctx): void（无 &，spec §4）
//   - 入口函数 combat_pipeline_run：按 $ctx->config['pipeline'] 查表，顺序调用阶段
//
// 管道类型（spec §Pipeline）：
//   attack  : resolve_target → check_rules → snapshot → execute → resolve_effects
//             → react → post_check → persist
//             （伤害类技能，pid 目标 + damage 效果，含 post_check 死亡检测）
//   utility : resolve_target → check_rules → snapshot → execute → resolve_effects
//             → react → persist
//             （工具类技能，tile/self 目标，跳过 post_check）
//   passive : execute
//             （被动技能，最小流程）
//
// 迭代规则：
//   - resolve_target / react / persist：turn 级阶段（不迭代，直接调用一次）
//   - check_rules / snapshot / execute / resolve_effects / post_check：per-target 迭代
//     （阶段函数内部遍历 $ctx->targets，per-target 短路）
//
// 短路机制：
//   - check_rules 失败：标 targets[i]['skip']=true，该 target 的后续阶段全跳过
//   - 致命错误（$ctx->success=false）：pipeline_run 整体 break，不再执行后续阶段
//
// 与旧系统边界：完全独立，旧系统无管道概念（verify/execute 内联在 battle_main）。
// ================================================================

/** @var array 管道配置注册表（pipeline 名 => 阶段名数组） */
if (!isset($GLOBALS['combat_pipelines'])) {
    $GLOBALS['combat_pipelines'] = [
        'attack'  => ['resolve_target', 'check_rules', 'action_start', 'snapshot', 'execute', 'resolve_effects', 'react', 'post_check', 'persist'],
        'utility' => ['resolve_target', 'check_rules', 'action_start', 'snapshot', 'execute', 'resolve_effects', 'react', 'persist'],
        'passive' => ['execute'],
    ];
}

// ================================================================
// 阶段函数
// ================================================================

/**
 * resolve_target 阶段：解析所有 targets（turn 级，不迭代）
 *
 * 调 combat_target_resolve_all 一次性解析全部 targets，构建每个 target 的
 * target_data + 空 tags/effects/snapshot。
 * tags 在 check_rules 阶段才懒构建（getCurrentTags），此处仅初始化空数组。
 *
 * @param CombatContext $ctx
 */
function combat_stage_resolve_target(CombatContext $ctx): void {
    combat_target_resolve_all($ctx);
}

/**
 * check_rules 阶段：per-target 规则匹配（per-target 迭代）
 *
 * 遍历 $ctx->targets，对每个 target：
 *   - 设 current_target_index + invalidateTagsCache
 *   - 调 combat_check_target_rules($ctx->config, $ctx->getCurrentTags())
 *   - 失败时标 targets[i]['skip']=true + 记录 skip_reason
 * 失败的 target 在后续阶段被跳过（per-target 短路）。
 *
 * @param CombatContext $ctx
 */
function combat_stage_check_rules(CombatContext $ctx): void {
    $count = count($ctx->targets);
    $valid = 0;
    $first_reason = null;
    for ($i = 0; $i < $count; $i++) {
        $ctx->current_target_index = $i;
        $ctx->invalidateTagsCache();

        $tags = $ctx->getCurrentTags();
        $result = combat_check_target_rules($ctx->config, $tags);
        if (!$result['pass']) {
            $ctx->targets[$i]['skip'] = true;
            $ctx->targets[$i]['skip_reason'] = $result['reason'];
            if ($first_reason === null) $first_reason = $result['reason'] ?? 'rule_failed';
        } else {
            $valid++;
        }
    }
    if ($count > 0 && $valid === 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'all_targets_skipped:' . ($first_reason ?? 'no_valid_targets');
    }
}

/**
 * action_start 阶段：发射 battlelog v2 action_start。
 *
 * 位于 check_rules 后、snapshot 前，只记录至少有一个有效 target 的 action。
 *
 * @param CombatContext $ctx
 */
function combat_stage_action_start(CombatContext $ctx): void {
    combat_log_v2_action_start($ctx);
}

/**
 * snapshot 阶段：per-target HP/AP/位置前值快照（per-target 迭代）
 *
 * 遍历未 skip 的 target，调 $ctx->snapshotHp() 记录前值。
 * 供回滚 / 日志 / 前端导演系统对比前后值。
 *
 * @param CombatContext $ctx
 */
function combat_stage_snapshot(CombatContext $ctx): void {
    $count = count($ctx->targets);
    for ($i = 0; $i < $count; $i++) {
        if (!empty($ctx->targets[$i]['skip'])) continue;
        $ctx->current_target_index = $i;
        $ctx->invalidateTagsCache();
        $ctx->snapshotHp();
    }
}

/**
 * execute 阶段：技能执行钩子（per-target 迭代）
 *
 * 遍历未 skip 的 target：
 *   - 加载技能模块（combat_skill_load_module，require_once 幂等）
 *   - 调钩子 skill_{act_id}_execute($ctx)
 *     钩子内调 $ctx->declareEffect(...) 声明效果到 getCurrentTarget()['effects']
 *
 * move 是特例：execute 阶段调 obl_perform_move_core 有副作用（改位置）。
 *
 * 致命错误（$ctx->success=false）时短路返回，不再处理后续 target。
 *
 * @param CombatContext $ctx
 */
function combat_stage_execute(CombatContext $ctx): void {
    combat_skill_load_module($ctx->act_id);

    $func = "skill_{$ctx->act_id}_execute";
    if (!function_exists($func)) {
        error_log("[combat_pipeline] Execute hook missing: {$func}");
        combat_debug_log('STAGE_EXECUTE_HOOK_MISSING', ['func'=>$func]);
        return;
    }

    $count = count($ctx->targets);
    for ($i = 0; $i < $count; $i++) {
        if (!empty($ctx->targets[$i]['skip'])) continue;
        $ctx->current_target_index = $i;
        $ctx->invalidateTagsCache();

        $func($ctx);
        combat_debug_log('STAGE_EXECUTE_HOOK', ['act_id'=>$ctx->act_id, 'target_index'=>$i, 'success'=>$ctx->success, 'effects_count'=>count($ctx->targets[$i]['effects']??[])]);

        if (!$ctx->success) return;
    }
}

/**
 * resolve_effects 阶段：应用声明效果（per-target 迭代）
 *
 * 遍历未 skip 的 target，调 combat_effect_apply_all($ctx) 应用该 target 的 effects。
 * 每个 target 独立应用（per-target 设计，避免多目标技能重复应用）。
 *
 * 致命错误（$ctx->success=false）时短路返回。
 *
 * @param CombatContext $ctx
 */
function combat_stage_resolve_effects(CombatContext $ctx): void {
    $count = count($ctx->targets);
    for ($i = 0; $i < $count; $i++) {
        if (!empty($ctx->targets[$i]['skip'])) continue;
        $ctx->current_target_index = $i;
        $ctx->invalidateTagsCache();

        combat_effect_apply_all($ctx);
        if (!$ctx->success) return;
    }
}

/**
 * react 阶段：反应效果处理（turn 级，不迭代）
 *
 * v1 空实现：react_queue 为空时直接 return。
 * v1 不引入反击检查逻辑（spec §Pipeline react 阶段反击机制预留）。
 *
 * v2 启用反击时：处理 react_queue 中的反应效果，应用后移到 applied_reacts。
 *
 * @param CombatContext $ctx
 */
function combat_stage_react(CombatContext $ctx): void {
    if (empty($ctx->react_queue)) return;
    // v1 不实现反击处理逻辑
}

/**
 * post_check 阶段：伤害结算后死亡检测（per-target 迭代，attack 管道专有）
 *
 * 遍历未 skip 的 target：
 *   - 调 combat_state_post_check($ctx) 处理当前 target 的 pid（三分支逻辑）
 *   - 遍历该 target 的 effects 的 target_pid + applied_reacts 的 target_pid
 *     做额外死亡检测（去重，排除当前 target 的 pid）
 *
 * 额外 pid 检测理由（spec §Queue/State）：effects 是 per-target 的，
 * grenade 的 tile target 无 HP，需遍历其 effects 的 target_pid 才能找到
 * 真正受影响的 pid。v1 effects 无 target_pid 字段，此循环为前向兼容空转。
 *
 * @param CombatContext $ctx
 */
function combat_stage_post_check(CombatContext $ctx): void {
    $count = count($ctx->targets);
    for ($i = 0; $i < $count; $i++) {
        if (!empty($ctx->targets[$i]['skip'])) continue;
        $ctx->current_target_index = $i;
        $ctx->invalidateTagsCache();

        // 1. 当前 target 的 pid 死亡检测
        combat_state_post_check($ctx);

        // 2. effects / applied_reacts 的 target_pid 额外死亡检测（去重）
        $target = &$ctx->getCurrentTarget();
        $current_pid = (int)($target['target_data']['pid'] ?? 0);
        $extra_pids = [];

        foreach ($target['effects'] ?? [] as $effect) {
            $ep = (int)($effect['target_pid'] ?? ($effect['payload']['target_pid'] ?? 0));
            if ($ep > 0 && $ep !== $current_pid) {
                $extra_pids[$ep] = true;
            }
        }

        foreach ($ctx->applied_reacts as $react) {
            $rp = (int)($react['target_pid'] ?? ($react['payload']['target_pid'] ?? 0));
            if ($rp > 0 && $rp !== $current_pid) {
                $extra_pids[$rp] = true;
            }
        }

        foreach (array_keys($extra_pids) as $ep) {
            combat_state_check_pid_in_memory($ctx, (int)$ep);
        }
    }
}

/**
 * persist 阶段：持久化（turn 级，不迭代）
 *
 * dry_run=true 时跳过（spec §3 预校验/执行分离）。
 *
 * 流程：
 *   1. 扣 AP：$ctx->actor_data['ap'] -= $ctx->ap_cost
 *      wallet 链路：verify 写 action._ap_cost → execute 同步到 ctx.ap_cost → persist 读 ctx.ap_cost 扣除（不重算）
 *   2. 收集需保存的 pid（四源去重）：
 *      - actor pid
 *      - targets 的 target_data pid（>0）
 *      - 所有 target 的 effects 的 target_pid（>0，前向兼容）
 *      - applied_reacts 的 target_pid（>0，v1 恒空）
 *   3. 按顺序 obl_save_player（保存内存引用，禁止重新 fetch，spec §4）
 *
 * 引用硬约束（spec §4）：保存的必须是内存中已修改的 actor_data / target_data，
 * 禁止 obl_save_player(obl_fetch_playerdata_by_pid($pid)) 这种重新 fetch 的写法
 * （会丢失刚改的内存状态）。未在内存中找到的 pid 跳过并记录日志。
 *
 * @param CombatContext $ctx
 */
function combat_stage_persist(CombatContext $ctx): void {
    if ($ctx->dry_run) return;
    if (!$ctx->success) return;
    if (combat_context_valid_target_count($ctx) <= 0) {
        $ctx->success = false;
        $ctx->failure_reason = 'all_targets_skipped';
        return;
    }

    // 1. 扣 AP（wallet 模型：ctx.ap_cost 已由 execute 从 action._ap_cost 同步，此处直接读不重算）
    $ctx->actor_data['ap'] = (int)$ctx->actor_data['ap'] - $ctx->ap_cost;
    combat_stage_persist_lstact($ctx);

    // 2. 收集需保存的 pid（去重，保序）
    $pids_to_save = [];

    $actor_pid = (int)($ctx->actor_data['pid'] ?? 0);
    if ($actor_pid > 0) {
        $pids_to_save[$actor_pid] = true;
    }

    foreach ($ctx->targets as $target) {
        $target_data = $target['target_data'] ?? null;
        if (!is_array($target_data)) continue;
        $pid = (int)($target_data['pid'] ?? 0);
        if ($pid > 0) {
            $pids_to_save[$pid] = true;
        }

        foreach (($target['effect_targets'] ?? []) as $effect_target) {
            if (!is_array($effect_target)) continue;
            $ep = (int)($effect_target['pid'] ?? 0);
            if ($ep > 0) {
                $pids_to_save[$ep] = true;
            }
        }
    }

    foreach ($ctx->targets as $target) {
        foreach ($target['effects'] ?? [] as $effect) {
            $ep = (int)($effect['target_pid'] ?? ($effect['payload']['target_pid'] ?? 0));
            if ($ep > 0) {
                $pids_to_save[$ep] = true;
            }
        }
    }

    foreach ($ctx->applied_reacts as $react) {
        $rp = (int)($react['target_pid'] ?? ($react['payload']['target_pid'] ?? 0));
        if ($rp > 0) {
            $pids_to_save[$rp] = true;
        }
    }

    // 3. 按顺序保存（保存内存引用，禁止重新 fetch）
    foreach (array_keys($pids_to_save) as $pid) {
        $data = combat_persist_find_data_in_memory($ctx, (int)$pid);
        if ($data !== null) {
            obl_save_player($data);
        } else {
            error_log("[combat_persist] pid {$pid} not in memory, skipped (no-fetch constraint)");
        }
    }
}

function combat_stage_persist_lstact(CombatContext $ctx): void {
    global $gamevars;

    $cd = (int)($ctx->config['cd'] ?? 0);
    $record_usage = !empty($ctx->config['record_usage']);
    if ($cd <= 0 && !$record_usage) return;

    if (!isset($ctx->actor_data['skillpara']) || !is_array($ctx->actor_data['skillpara'])) {
        $ctx->actor_data['skillpara'] = [];
    }
    if (!isset($ctx->actor_data['skillpara'][$ctx->act_id]) || !is_array($ctx->actor_data['skillpara'][$ctx->act_id])) {
        $ctx->actor_data['skillpara'][$ctx->act_id] = [];
    }

    $current_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $ctx->actor_data['skillpara'][$ctx->act_id]['lstact'] = $current_tick;
}

// ================================================================
// 入口函数
// ================================================================

/**
 * 执行管道（按 $ctx->config['pipeline'] 查表，顺序调用阶段函数）
 *
 * 流程：
 *   - 查 $GLOBALS['combat_pipelines'] 获取阶段列表
 *   - 按顺序调用 combat_stage_{name}($ctx)
 *   - 致命错误（$ctx->success=false）时 break，不再执行后续阶段
 *
 * per-target 阶段在阶段函数内部迭代 targets；turn 级阶段不迭代。
 * check_rules 失败的 target 在后续 per-target 阶段被跳过（per-target 短路）。
 * dry_run=true 时 persist 阶段跳过（在 persist 内部判断）。
 *
 * 未知 pipeline 名时记录日志并按 'attack' 兜底。
 *
 * @param CombatContext $ctx
 */
function combat_pipeline_run(CombatContext $ctx): void {
    $pipeline_name = $ctx->config['pipeline'] ?? 'attack';

    $stages = $GLOBALS['combat_pipelines'][$pipeline_name] ?? null;
    if ($stages === null) {
        error_log("[combat_pipeline] Unknown pipeline: {$pipeline_name}, fallback to attack");
        $stages = $GLOBALS['combat_pipelines']['attack'] ?? [];
    }
    combat_debug_log('PIPELINE_RUN', ['pipeline'=>$pipeline_name, 'stages'=>$stages, 'act_id'=>$ctx->act_id, 'targets_count'=>count($ctx->targets)]);

    foreach ($stages as $stage) {
        if (!$ctx->success) break;

        $func = "combat_stage_{$stage}";
        if (!function_exists($func)) {
            error_log("[combat_pipeline] Stage function missing: {$func}");
            continue;
        }

        $func($ctx);
        combat_debug_log('PIPELINE_STAGE', ['stage'=>$stage, 'success'=>$ctx->success, 'failure_reason'=>$ctx->failure_reason, 'targets_count'=>count($ctx->targets), 'skip_count'=>array_sum(array_map(function($t){return !empty($t['skip'])?1:0;}, $ctx->targets))]);
    }
}

// ================================================================
// 内部辅助函数
// ================================================================

/**
 * 在内存中按 pid 查找玩家数据（persist 阶段使用）
 *
 * 查找顺序：actor_data → targets[i].target_data。
 * 找到返回数据数组（值拷贝，obl_save_player 按值读取不影响调用方）；
 * 未找到返回 null（遵守 spec §4 no-fetch 约束，不重新 fetch）。
 *
 * @param CombatContext $ctx
 * @param int           $pid
 * @return array|null
 */
function combat_persist_find_data_in_memory(CombatContext $ctx, int $pid): ?array {
    if ($pid <= 0) return null;

    if ((int)($ctx->actor_data['pid'] ?? 0) === $pid) {
        return $ctx->actor_data;
    }

    foreach ($ctx->targets as $target) {
        $target_data = $target['target_data'] ?? null;
        if (!is_array($target_data)) continue;
        if ((int)($target_data['pid'] ?? 0) === $pid) {
            return $target_data;
        }

        foreach (($target['effect_targets'] ?? []) as $effect_target) {
            if (!is_array($effect_target)) continue;
            if ((int)($effect_target['pid'] ?? 0) === $pid) {
                return $effect_target;
            }
        }
    }

    return null;
}
