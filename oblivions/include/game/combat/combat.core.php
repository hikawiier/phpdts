<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * 新 combat 观测日志桩子。
 *
 * 请求内收集开发诊断，事务提交后才由 runtime 持久化。
 */
function combat_debug_log(string $tag, array $data = []): void {
    if (!isset($GLOBALS['obl_combat_debug_entries']) || !is_array($GLOBALS['obl_combat_debug_entries'])) {
        $GLOBALS['obl_combat_debug_entries'] = [];
    }
    $GLOBALS['obl_combat_debug_entries'][] = [
        'ts' => date('Y-m-d H:i:s'),
        'tag' => $tag,
        'data' => $data,
    ];
}

function combat_debug_persist(): bool {
    $entries = $GLOBALS['obl_combat_debug_entries'] ?? [];
    if (!is_array($entries) || empty($entries)) return true;
    $lines = '';
    foreach ($entries as $entry) {
        $lines .= '[' . (string)($entry['ts'] ?? date('Y-m-d H:i:s')) . '] ' . (string)($entry['tag'] ?? 'DEBUG');
        if (!empty($entry['data'])) $lines .= ' ' . json_encode($entry['data'], JSON_UNESCAPED_UNICODE);
        $lines .= "\n";
    }
    $path = GAME_ROOT . './oblivions/cache/battles/combat_debug.log';
    $ok = @file_put_contents($path, $lines, FILE_APPEND | LOCK_EX) !== false;
    if ($ok) $GLOBALS['obl_combat_debug_entries'] = [];
    return $ok;
}

/**
 * 按技能配置归一化 action target，保留 pid/tile/self/none/all 的语义。
 *
 * 兼容旧 target:number：
 *   enemy => pid, tiles => tile, self/none/all => 忽略数字转语义目标。
 */
function combat_action_normalize_target($raw_target, ?array $config, int $actor_pid): ?array {
    $config_target = (string)($config['aim']['resolver'] ?? 'none');

    if (is_array($raw_target)) {
        $type = isset($raw_target['type']) ? (string)$raw_target['type'] : '';
        if ($type === 'enemy') $type = 'pid';
        if ($type === 'tiles') $type = 'tile';

        if ($type === 'pid') {
            $id = (int)($raw_target['id'] ?? ($raw_target['pid'] ?? ($raw_target['target_id'] ?? 0)));
            return $id > 0 ? ['type' => 'pid', 'id' => $id] : null;
        }
        if ($type === 'tile') {
            $id = (int)($raw_target['id'] ?? ($raw_target['pls'] ?? ($raw_target['target_id'] ?? 0)));
            return $id > 0 ? ['type' => 'tile', 'id' => $id] : null;
        }
        if ($type === 'self') return ['type' => 'self'];
        if ($type === 'none') return ['type' => 'none'];
        if ($type === 'all' && $config_target === 'none') return ['type' => 'none'];

        return null;
    }

    if ($config_target === 'pid') {
        $pid = (int)$raw_target;
        return $pid > 0 ? ['type' => 'pid', 'id' => $pid] : null;
    }
    if ($config_target === 'tile') {
        $pls = (int)$raw_target;
        return $pls > 0 ? ['type' => 'tile', 'id' => $pls] : null;
    }
    if ($config_target === 'self') return ['type' => 'self'];
    if ($config_target === 'none') return ['type' => 'none'];

    return null;
}

function combat_action_normalize_all($actions, int $actor_pid, string $entry, bool $allow_empty = false): array {
    $normalized = [];
    if (!is_array($actions)) return $normalized;

    foreach ($actions as $act) {
        if (!is_array($act)) continue;

        $act_id = isset($act['act_id']) ? (string)$act['act_id'] : '';
        if ($act_id === '') continue;

        $config = combat_skill_get_config($act_id);
        $raw_target = array_key_exists('target', $act) ? $act['target'] : null;
        $target = combat_action_normalize_target($raw_target, $config, $actor_pid);
        if ($target === null) continue;

        $params = isset($act['params']) && is_array($act['params']) ? $act['params'] : [];
        $normalized[] = ['act_id' => $act_id, 'target' => $target, 'params' => $params];
    }

    if (empty($normalized) && !$allow_empty) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('combat_entry.empty_actions', [
                'pid'   => $actor_pid,
                'entry' => $entry,
            ], 'battle');
        }
    }

    return $normalized;
}

function combat_action_config_with_target(array $config, array $action): array {
    $config['target_intent'] = $action['target'] ?? ['type' => 'none'];
    $intent = $config['target_intent'];
    $type = is_array($intent) ? (string)($intent['type'] ?? '') : '';
    $config['target_id'] = ($type === 'pid' || $type === 'tile')
        ? (int)($intent['id'] ?? 0)
        : 0;
    $config['action_index'] = (int)($action['_action_index'] ?? 0);
    return $config;
}

function combat_skill_actor_owns(array $actor_data, string $act_id, array $config): bool {
    if (!empty($config['system']) || !empty($config['always_available'])) return true;
    return isset($actor_data['skillpara']) && is_array($actor_data['skillpara'])
        && isset($actor_data['skillpara'][$act_id]);
}

function combat_skill_cd_check(array $actor_data, string $act_id, array $config): array {
    global $gamevars;
    $cd = (int)($config['cd'] ?? 0);
    if ($cd <= 0) return ['pass' => true, 'reason' => null];

    $current_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $lstact = isset($actor_data['skillpara'][$act_id]['lstact'])
        ? (int)$actor_data['skillpara'][$act_id]['lstact']
        : 0;

    if (($current_tick - $lstact) < $cd) {
        return ['pass' => false, 'reason' => 'cooldown', 'cd' => $cd, 'lstact' => $lstact, 'current_tick' => $current_tick];
    }
    return ['pass' => true, 'reason' => null];
}

function combat_emit_action_failure(&$log, array $actor_data, string $act_id, string $reason, array $extra = []): void {
    if (!$log) return;
    combat_log_v2_action_failed($log, $actor_data, $act_id, $reason, $extra);
}

// ================================================================
// 新战斗系统 / New combat system — 核心调度
//
// 职责：dispatch / main / sort → verify → execute 的核心调度入口。
//   - combat_start_battle():     new engine 下 battle.start 的唯一入口，先建队列再执行首轮
//   - combat_dispatch():         入口分发，2 种模式（player_turn/npc_turn），
//                                签名沿用旧入口形状，复用共享队列出口
//                                battle_log/battle_cache/queue 基础设施
//   - combat_main():             单回合主函数（sort → verify → execute）
//   - combat_sort_actions():     终结技排序（sort 在 verify 前，保证计划状态
//                                按最终执行顺序推进）
//   - combat_verify():           遍历校验 + 计划状态投影（wallet 模型 v2）
//   - combat_execute():          遍历执行 + 强校验兜底（管道内 check_rules 阶段）
//   - combat_main_end():         集中 cleanup（调 combat_state_clear 清理退出者）
//   - combat_actor_terminated(): actor 级终止检测（5 个终止条件）
//
// 与旧系统边界：
//   - 入口层完全替代旧 battle entry，复用共享的
//     battle_state_init / battle_manage_queue
//   - 状态机推进由 battle_manage_queue 接管，本模块不直接调 obl_battle_state_*
//   - tick 编排由外部处理，本模块不调 obl_tick_advance / obl_tick_request_advance
//
// 关键设计约束（spec §不可违反约束）：
//   1. persist 从 ctx.ap_cost 读，不重算：execute 阶段把 action._ap_cost
//      同步到 ctx.ap_cost，persist 不改
//   2. sort 在 verify 前：保证计划 AP/位置按最终执行顺序投影
//   3. 普通失败只跳过自己，actor 级终止中断后续全部
//   4. combat_dispatch 签名沿用旧入口形状，便于调用方迁移
//   5. 出口调 battle_manage_queue：状态机推进由它接管
//   6. 不调 obl_tick_advance / obl_tick_request_advance
// ================================================================

/**
 * 新战斗系统入口分发
 *
 * 新 combat 入口分发，2 种模式：
 *   - 'player_turn' 玩家在已有队列中的回合
 *   - 'npc_turn'    NPC 在已有队列中的回合
 *
 * 签名沿用旧入口形状：($mode, &$actor, $actions = null, $extra = [])。
 * 复用共享队列出口：battle_manage_queue。
 *
 * @param string     $mode    入口模式：'player_turn' | 'npc_turn'
 * @param array     &$actor   发起者数据
 * @param array|null $actions 动作数组 [{act_id, target}, ...]
 * @param array      $extra   扩展参数（预留，与旧系统兼容）
 * @return array|void 仅 npc_turn 模式返回 battle_manage_queue 结果，其余无返回值
 */
function combat_start_battle(&$actor, $actions): array {
    global $obl_battle_log;
    combat_debug_log('START_BATTLE_ENTRY', ['pid'=>(int)($actor['pid']??0), 'actions_count'=>is_array($actions)?count($actions):0, 'actions'=>$actions]);

    combat_ensure_battle_log();

    $actor_pid = (int)($actor['pid'] ?? 0);
    $actor_queue_row = $actor_pid > 0 ? obl_fetch_queue_by_pid_for_update($actor_pid) : false;
    if ((int)($actor['bid'] ?? 0) > 0 || (string)($actor['action'] ?? '') === 'battle' || $actor_queue_row) {
        return ['ok' => false, 'code' => 'ACTOR_MEMBERSHIP_INCONSISTENT', 'rollback' => true];
    }

    $atk_act = combat_action_normalize_all($actions, (int)($actor['pid'] ?? 0), 'battle.start', false);
    if (empty($atk_act)) {
        $has_raw_actions = is_array($actions) && !empty($actions);
        return ['ok' => false, 'code' => $has_raw_actions ? 'INVALID_ACTIONS' : 'NO_ACTIONS'];
    }

    combat_sort_actions($atk_act);
    $prebattle_cache = combat_cache_create($actor, false);
    $prebattle_results = [];
    $remaining_actions = [];
    $initial_target_pids = [];

    foreach ($atk_act as $index => $action) {
        $config = combat_skill_get_config((string)$action['act_id']);
        if (!$config) continue;
        $projection = combat_chain_project($actor, [$action], $prebattle_cache, $obl_battle_log, [
            'emit_failures' => false,
            'check_ownership' => true,
            'check_cd' => true,
        ]);
        $projected = $projection['actions'][0] ?? ['success' => false];
        $is_hostile = (string)($config['capture']['participation'] ?? 'none') !== 'none';
        $candidate_pids = [];
        foreach (($projected['target_results'] ?? []) as $target_result) {
            if (($target_result['status'] ?? '') === 'resolved' && (int)($target_result['pid'] ?? 0) > 0) {
                $candidate_pids[(int)$target_result['pid']] = true;
            }
        }

        if ($is_hostile && !empty($projected['success']) && !empty($candidate_pids)) {
            $initial_target_pids = array_keys($candidate_pids);
            $remaining_actions = array_slice($atk_act, $index);
            break;
        }

        $single = [$action];
        $single_results = combat_main($actor, $single, $obl_battle_log, $prebattle_cache);
        if (empty($single_results)) {
            $prebattle_results[] = [
                'index' => count($prebattle_results),
                'actId' => (string)$action['act_id'],
                'status' => 'failed',
                'reason' => (string)($projected['reason'] ?? 'verification_failed'),
                'apCost' => 0,
                'resolvedAim' => $projected['resolved_aim'] ?? null,
                'capturedTargetCount' => (int)($projected['captured_target_count'] ?? 0),
                'targets' => $projected['target_results'] ?? [],
            ];
        } else {
            foreach ($single_results as $result) $prebattle_results[] = $result;
        }
        if (combat_actor_terminated($actor, $prebattle_cache)) break;
    }

    if (empty($initial_target_pids)) {
        return ['ok' => false, 'code' => 'NO_BATTLE_STARTED', 'rollback' => true];
    }

    if (obl_fetch_queue_by_pid($actor_pid)) {
        return ['ok' => false, 'code' => 'ACTOR_MEMBERSHIP_INCONSISTENT', 'rollback' => true];
    }
    foreach ($initial_target_pids as $pid) {
        if (obl_fetch_queue_by_pid((int)$pid)) return ['ok' => false, 'code' => 'TARGET_MEMBERSHIP_INCONSISTENT', 'rollback' => true];
    }

    $pids = array_values(array_unique(array_merge([$actor_pid], array_map('intval', $initial_target_pids))));
    $actor['oblpara']['ambush_flag'] = true;
    battle_state_init($actor);
    $qid = battle_queue_create_and_init($actor, $pids, $obl_battle_log);
    if ($qid <= 0) return ['ok' => false, 'code' => 'QUEUE_CREATE_FAILED', 'rollback' => true];

    foreach ($initial_target_pids as $pid) {
        $target_data = obl_fetch_playerdata_by_pid_for_update((int)$pid);
        if (!$target_data) throw new RuntimeException('Initial combatant disappeared: ' . (int)$pid);
        battle_state_init($target_data);
        $target_data['bid'] = $qid;
        obl_save_player($target_data);
    }

    $battle = combat_dispatch('player_turn', $actor, $remaining_actions);
    $battle_results = is_array($battle['data']['actions'] ?? null) ? $battle['data']['actions'] : [];
    $first_resolved = [];
    foreach (($battle_results[0]['targets'] ?? []) as $target_result) {
        if (($target_result['status'] ?? '') === 'resolved') $first_resolved[(int)($target_result['pid'] ?? 0)] = true;
    }
    foreach ($initial_target_pids as $pid) {
        if (empty($first_resolved[(int)$pid])) throw new RuntimeException('INITIAL_ROSTER_DIVERGED:' . (int)$pid);
    }
    $all_results = array_values(array_merge($prebattle_results, $battle_results));
    foreach ($all_results as $index => &$result) $result['index'] = $index;
    unset($result);
    return ['ok' => true, 'data' => ['actions' => $all_results]];
}

function combat_dispatch($mode, &$actor, $actions = null, $extra = []) {
    global $obl_battle_log;
    combat_debug_log('DISPATCH_ENTRY', ['mode'=>$mode, 'pid'=>(int)($actor['pid']??0), 'name'=>$actor['name']??'', 'actions_count'=>is_array($actions)?count($actions):0, 'actions'=>$actions]);

    combat_ensure_battle_log();

    if ($mode !== 'player_turn' && $mode !== 'npc_turn') {
        combat_debug_log('DISPATCH_INVALID_MODE', ['mode' => $mode]);
        return ['ok' => false, 'code' => 'INVALID_MODE'];
    }

    $is_npc = ($mode === 'npc_turn');

    // ── 1. 动作解析（new combat 专用，保留结构化 target intent） ──
    $atk_act = combat_action_normalize_all($actions, (int)$actor['pid'], $mode, $is_npc);
    combat_debug_log('DISPATCH_PARSE', ['atk_act_count'=>count($atk_act), 'atk_act'=>$atk_act]);
    // 非 NPC 模式空动作直接返回（玩家/突袭者必须提交动作）
    if (!$is_npc && empty($atk_act)) return;

    // ── 2. 构建战斗缓存（已有队列中的标准回合） ──
    $battle_cache = combat_cache_create($actor, false);
    combat_debug_log('DISPATCH_CACHE', ['combatants'=>$battle_cache['combatants']??[], 'is_ambush'=>$battle_cache['is_ambush']??false, 'actor_bid'=>(int)($actor['bid']??0)]);

    // ── 3. 同步 roundNum 到 battle_log ──
    //    保证 battle_main 中 emit 的内容条目携带正确的 bl_round_num，
    //    供前端区分 Phase 0（突袭）/ Phase 1（标准战斗）。
    $qid = (int)($actor['bid'] ?? 0);
    if ($qid > 0 && $obl_battle_log) {
        $obl_battle_log->setRoundNum(obl_battle_state_get_round_num($qid));
    }

    // ── 4. 单回合主函数（sort → verify → execute） ──
    //    combat_main 会修改 $atk_act（移除校验失败的 action）
    combat_debug_log('DISPATCH_MAIN_BEFORE', ['atk_act_count'=>count($atk_act)]);
    $action_results = combat_main($actor, $atk_act, $obl_battle_log, $battle_cache);
    combat_debug_log('DISPATCH_MAIN_AFTER', ['atk_act_count'=>count($atk_act), 'atk_act'=>$atk_act]);

    // ── 5. 集中 cleanup（统一清理退出者） ──
    combat_main_end($actor, $atk_act, $obl_battle_log, $battle_cache);
    combat_debug_log('DISPATCH_MAIN_END', ['combatants'=>$battle_cache['combatants']??[], 'actor_hp'=>(int)($actor['hp']??0), 'actor_state'=>(int)($actor['state']??0)]);

    // ── 6. 队列管理（状态机推进由 battle_manage_queue 接管） ──
    //    spec §1：battle_manage_queue 是适配层，新旧系统共用
    $result = battle_manage_queue($actor, $obl_battle_log, $battle_cache);

    // ── 7. 返回（仅 npc_turn 需要结果，供 tick 编排使用） ──
    if ($is_npc) {
        if (is_array($result)) $result['actions'] = $action_results;
        return $result;
    }
    return ['ok' => true, 'data' => ['actions' => $action_results]];
}

/**
 * 单回合主函数（sort → verify → execute）
 *
 * 流程顺序（spec §2 不可违反约束）：
 *   sort → verify → execute
 *
 * 为什么 sort 在 verify 前（不是原 verify → sort → execute）：
 *   verify 的计划状态必须按最终执行顺序推进。如果先 verify 再 sort，
 *   finisher 可能被排到末尾，但其 AP/位置影响已在中间位置投影，导致中间动作
 *   被错误移除。sort 在 verify 前保证 finisher 按"最后动作"占用计划状态。
 *
 * @param array  &$actor_data
 * @param array  &$atk_act     动作数组（引用，verify 会移除失败 action）
 * @param mixed  &$log         BattleLogCollector
 * @param array  &$battle_cache
 */
function combat_main(&$actor_data, &$atk_act, &$log, &$battle_cache): array {
    $log->setPhase('sort');
    combat_sort_actions($atk_act);

    $log->setPhase('verify');
    combat_verify($actor_data, $atk_act, $log, $battle_cache);

    $log->setPhase('execute');
    return combat_execute($actor_data, $atk_act, $log, $battle_cache);
}

/**
 * 终结技排序（sort 在 verify 前）
 *
 * 规则：normal 在前，finisher 在后，多个 finisher 只保留最后一个（后提交覆盖前面的）。
 *
 * 为什么 sort 在 verify 前：
 *   verify 维护计划 AP/位置并按最终执行顺序推进。finisher 排末尾后，
 *   其 AP 占用最后计算，不会挤占前面 normal 动作的计划 AP 额度。
 *
 * 为什么不信任前端顺序：
 *   前端可能因 bug/作弊提交错误顺序（如 finisher 在前），后端必须兜底。
 *
 * @param array &$atk_act
 */
function combat_sort_actions(&$atk_act): void {
    $normal    = [];
    $finishers = [];

    foreach ($atk_act as $act) {
        // 用新系统 combat_skill_get_config 查 finisher 标记（不调旧 skill_is_finisher）
        $config      = combat_skill_get_config($act['act_id']);
        $is_finisher = $config !== null && !empty($config['finisher']);
        if ($is_finisher) {
            $finishers[] = $act;
        } else {
            $normal[] = $act;
        }
    }

    // 多个 finisher 只保留最后一个（后提交覆盖前面的，与旧 battle_sort_actions 一致）
    if (count($finishers) > 1) {
        $finishers = [array_pop($finishers)];
    }

    // 合并：normal + finisher（finisher 在后），重建数字索引
    $atk_act = array_values(array_merge($normal, $finishers));
}

/**
 * 遍历校验 + 计划状态投影（wallet 模型 v2）
 *
 * 维护 sim_actor，按排序后顺序遍历 action：
 *   - actor 级终止 → 停止验证，清空后续所有 action（已验证的保留）
 *   - 技能不存在 → 普通失败，跳过自己（continue）
 *   - 计划 AP 不足 → 普通失败，跳过自己（continue）
 *
 * 通过的 action 写入 _ap_cost 字段（wallet），execute 阶段读取；同时投影到
 * sim_actor，供后续 action 的目标/规则/AP 校验使用。
 *
 * 为什么不直接调 combat_skill_verify：
 *   combat_skill_verify 检查单 action AP（actor.ap >= ap_cost），但队列验证需要
 *   后续 action 读取前序 action 已投影后的 AP/位置等计划状态。所以手动调
 *   combat_ap_calculate + 手动推进 sim_actor。
 *
 * 为什么不在 verify 做规则匹配（forbid 标签）：
 *   规则匹配需要 target 已解析（combat_check_target_rules 需要 tags，tags 依赖
 *   target_data）。但 verify 阶段是 dry_run，不解析真实 target（避免副作用）。
 *   规则匹配留到 execute 阶段的管道 check_rules 阶段（强校验兜底）。
 *
 * @param array  &$actor_data
 * @param array  &$atk_act     引用，校验失败的 action 会被移除
 * @param mixed  &$log
 * @param array  &$battle_cache
 */
function combat_verify(&$actor_data, &$atk_act, &$log, &$battle_cache): void {
    combat_debug_log('VERIFY_ENTRY', [
        'atk_act_count'=>count($atk_act),
        'actor_ap'=>(int)($actor_data['ap']??0),
        'actor_pls'=>(int)($actor_data['pls']??0),
    ]);

    $projection = combat_chain_project($actor_data, $atk_act, $battle_cache, $log, [
        'emit_failures' => true,
        'check_ownership' => true,
        'check_cd' => true,
    ]);

    // 替换为已验证的（通过引用修改调用方的 $atk_act）
    combat_debug_log('VERIFY_END', [
        'verified_count'=>count($projection['verified_actions'] ?? []),
        'sim_ap'=>(int)($projection['actor_final_state']['ap'] ?? 0),
        'sim_pls'=>(int)($projection['actor_final_state']['pls'] ?? 0),
    ]);
    $atk_act = $projection['verified_actions'] ?? [];
}

/**
 * 遍历执行 + 强校验兜底
 *
 * 按排序后顺序遍历（已通过 verify 的）：
 *   - actor 级终止 → 中断后续全部（break）
 *   - 管道失败（$ctx->success=false）→ 普通失败，跳过自己，继续下一个
 *
 * AP 扣除（wallet 模型核心）：
 *   从 action._ap_cost 同步到 ctx.ap_cost，persist 阶段读取 ctx.ap_cost 扣除（不重算）。
 *   链路：verify 算出 → 写入 action._ap_cost → execute 读到 ctx.ap_cost → persist 扣 ctx.ap_cost
 *   **不要修改 combat.pipeline.php 的 combat_stage_persist**，它已从 ctx.ap_cost 读取。
 *
 * 强校验兜底：
 *   管道内 check_rules 阶段（per-target）会做规则匹配（forbid 标签），基于当前内存状态。
 *   如果 target 已死/超距/不可通行，标 skip 跳过该 target。
 *   如果所有 target 都 skip，persist 仍会执行（扣 AP），但无效果——这是可接受的
 *   （AP 已预扣，actor 浪费了行动，符合"不信任前端 + 强校验兜底"语义）。
 *
 * @param array  &$actor_data
 * @param array  &$atk_act
 * @param mixed  &$log
 * @param array  &$battle_cache
 */
function combat_execute(&$actor_data, &$atk_act, &$log, &$battle_cache): array {
    combat_debug_log('EXECUTE_ENTRY', ['atk_act_count'=>count($atk_act)]);
    $action_seq = 0;
    $action_results = [];
    foreach ($atk_act as $action) {
        $action_seq++;
        $action['_action_index'] = $action_seq - 1;
        // actor 级终止检查：中断后续全部
        // （actor 可能因前序 action 的效果死亡/逃离，如反击/自爆，v1 反击未启用但保留检查）
        if (combat_actor_terminated($actor_data, $battle_cache)) {
            $log->setPhase('actor_state_check');
            $log->emit([
                'actor_pid' => (int)($actor_data['pid'] ?? 0),
                'reason'    => 'actor_terminated',
            ], true);  // debug 级别
            $action_results[] = ['index' => $action_seq - 1, 'actId' => (string)($action['act_id'] ?? ''), 'status' => 'stopped', 'apCost' => 0, 'targets' => []];
            break;
        }

        $act_id = $action['act_id'];
        $config = combat_skill_get_config($act_id);
        if ($config === null) continue;  // 不应发生（verify 已过滤），防御性跳过

        if (!combat_skill_actor_owns($actor_data, $act_id, $config)) {
            combat_emit_action_failure($log, $actor_data, $act_id, 'skill_not_owned');
            continue;
        }

        $cd_result = combat_skill_cd_check($actor_data, $act_id, $config);
        if (empty($cd_result['pass'])) {
            combat_emit_action_failure($log, $actor_data, $act_id, 'cooldown', $cd_result);
            continue;
        }

        // 构造真实执行 ctx（不设 dry_run，执行真实管道）
        // CombatContext 构造函数引用赋值 actor_data / battle_cache，修改回流到调用方
        $ctx = new CombatContext($actor_data, $act_id, combat_action_config_with_target($config, $action), $log, $battle_cache);

        // 从 action 读 _ap_cost（wallet 模型，不重算）
        // persist 阶段会读 $ctx->ap_cost 扣除，无需修改 combat_stage_persist
        $ctx->ap_cost = (int)($action['_ap_cost'] ?? 0);
        $ctx->action_uid = $action['_action_uid'] ?? combat_log_v2_make_action_uid($actor_data, $act_id, $action_seq);
        combat_action_reserve_resources($ctx);

        // 跑管道（内部含强校验：check_rules 阶段做规则匹配，失败标 skip）
        // 管道阶段顺序见 combat.pipeline.php：resolve_target → check_rules → snapshot
        //   → execute → resolve_effects → react → post_check → persist
        combat_pipeline_run($ctx);
        combat_debug_log('EXECUTE_PIPELINE_AFTER', ['act_id'=>$act_id, 'success'=>$ctx->success, 'failure_reason'=>$ctx->failure_reason, 'targets_count'=>count($ctx->targets), 'effects_count'=>array_sum(array_map(function($t){return count($t['effects']??[]);}, $ctx->targets))]);

        // 管道失败（普通失败）→ 记录日志，继续下一个 action
        // 不 break：普通失败只跳过自己，不影响后续 action
        if (!$ctx->success) {
            combat_action_restore_uncommitted_resources($ctx);
            $reason = $ctx->failure_reason ?? 'pipeline_failed';
            combat_log_v2_action_failed_from_context($ctx, $reason);
            $status = 'failed';
        } else {
            combat_log_v2_action_end($ctx);
            $skipped = count(array_filter($ctx->target_results, fn($r) => ($r['status'] ?? '') === 'skipped'));
            $status = $skipped > 0 ? 'partial' : 'resolved';
        }
        $action_results[] = [
            'index' => $action_seq - 1,
            'actId' => $act_id,
            'status' => $status,
            'apCost' => $ctx->resources_committed ? (int)$ctx->ap_cost : 0,
            'resolvedAim' => $ctx->resolved_aim,
            'capturedTargetCount' => count($ctx->targets),
            'targets' => $ctx->target_results,
        ];
    }
    return $action_results;
}

/**
 * 集中 cleanup（参考旧 battle_main_end）
 *
 * 职责：
 *   1. Turn end hook（仅 Phase 1：bid>0 且 action==='battle'）
 *   2. Actor 补充死亡检测（hp<=0 或 state==1 → combatants[pid]=0 + tag_mutations dead）
 *   3. 遍历 combatants，对 status=0 的 pid 调 combat_state_clear 清理退出者
 *   4. 所有退出者走统一 combat_state_clear 清理，状态机交给 battle_manage_queue
 *
 * 实际状态机推进由后续的 battle_manage_queue 完成（在 combat_dispatch 中调用），
 * 本函数只做内存清理。
 *
 * 注意：combat_state_clear 是新系统函数（combat.state.php），签名与旧
 * battle_state_clear 不同：
 *   新：combat_state_clear($pid, $reason, &$actor_data, &$battle_cache, $log)
 *   旧：battle_state_clear(&$actor_data, &$log, &$battle_cache, $reason)
 * reason 取值：'dead' / 'escaped'（新系统用 'dead'，旧系统用 'death'）
 *
 * @param array  &$actor_data
 * @param array  &$atk_act
 * @param mixed  &$log
 * @param array  &$battle_cache
 * @return void
 */
function combat_main_end(&$actor_data, &$atk_act, &$log, &$battle_cache): void {
    if (empty($battle_cache['combatants'])) return;

    $actor_pid  = (int)($actor_data['pid'] ?? 0);

    // ── 1. Turn end hook（仅 Phase 1：bid>0 排除 Phase 0 突袭，action==='battle' 排除已退出者）──
    if (!empty($actor_data['bid']) && ($actor_data['action'] ?? '') === 'battle') {
        battle_hook_turn_end($actor_data, $log, $battle_cache);
    }

    // ── 2. Actor 补充死亡检测（写缓存，统一由 foreach 处理）──
    //    管道内 post_check 只检测 target 死亡，actor 自身死亡（如自爆/反击）需补充检测
    //    对齐 combat_state_apply_death_check：escaped 优先，已逃离不写 dead（避免状态污染）
    $actor_mutations = $battle_cache['tag_mutations'][$actor_pid] ?? [];
    if (!empty($actor_mutations['escaped'])) {
        $battle_cache['combatants'][$actor_pid] = 0;
    } elseif ((int)($actor_data['hp'] ?? 0) <= 0 || (int)($actor_data['state'] ?? 0) === 1) {
        $battle_cache['combatants'][$actor_pid] = 0;
        if (!isset($battle_cache['tag_mutations'][$actor_pid])) {
            $battle_cache['tag_mutations'][$actor_pid] = ['dead' => false, 'escaped' => false, 'hidden' => false];
        }
        $battle_cache['tag_mutations'][$actor_pid]['dead'] = true;
    }

    // ── 3. 遍历 combatants，清理退出者（status=0） ──
    foreach ($battle_cache['combatants'] as $pid => $status) {
        if ((int)$status !== 0) continue;

        $pid = (int)$pid;

        // 获取退出者数据
        // actor 用引用路径，确保 cleanup 后调用方和 DB 状态一致。
        // 其他 pid 用 obl_fetch_playerdata_by_pid（combat_state_clear 会 save 到 DB）
        if ($pid === $actor_pid) {
            $target_data = &$actor_data;
        } else {
            $target_data = obl_fetch_playerdata_by_pid($pid);
            if (!$target_data) continue;
        }

        $mutations = $battle_cache['tag_mutations'][$pid] ?? [];
        // 新系统 reason 取值：'dead' / 'escaped'（不是旧系统的 'death'）
        $reason = !empty($mutations['escaped']) ? 'escaped'
                : (!empty($mutations['dead']) ? 'dead' : 'unknown');

        // TargetResolutionUnit already performs authoritative per-target cleanup.
        // This loop remains only for actor/reaction fallback paths.
        if (empty($target_data['action'])) {
            unset($target_data);
            continue;
        }

        if ($log) {
            combat_log_v2_combatant_cleared($log, $target_data, $reason);
        }

        // 调新系统 combat_state_clear（签名：$pid, $reason, &$actor_data, &$battle_cache, $log）
        // combat_state_clear 内部：清 action → 退队列 → 恢复 AP → obl_save_player
        combat_state_clear($pid, $reason, $target_data, $battle_cache, $log);
        unset($target_data);
    }
}

/**
 * actor 级终止检测（4 个终止条件）
 *
 * 任一满足即终止后续 action（中断 verify/execute 的遍历）：
 *   1. actor hp <= 0（已死，hp 在管道 effect 应用后可能归零）
 *   2. actor state == 1（死亡；逃离由 tag_mutations.escaped 表示）
 *   3. tag_mutations[pid]['escaped']（已逃离，由 effect applier 写入）
 *   4. tag_mutations[pid]['dead']（已死亡，由 post_check 写入）
 * 与普通失败的区别：
 *   普通失败（AP 不够/目标已死/射程不够）只跳过当前 action，后续可继续。
 *   actor 级终止中断后续全部 action——行动链的执行主体没了/回合没了。
 *
 * @param array &$actor_data
 * @param array &$battle_cache
 * @return bool true=已终止，应中断后续 action
 */
function combat_actor_terminated(&$actor_data, &$battle_cache): bool {
    $pid       = (int)($actor_data['pid'] ?? 0);
    $mutations = $battle_cache['tag_mutations'][$pid] ?? [];

    return (int)($actor_data['hp'] ?? 0) <= 0
        || (int)($actor_data['state'] ?? 0) === 1
        || !empty($mutations['escaped'])
        || !empty($mutations['dead']);
}
