<?php
/**
 * @module C 核心运行时
 * @framework C-5 Tick 编排器
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions Tick Orchestrator
//
// 当前职责：集中管理 Oblivions 的刻推进策略。
// 底层 tick engine 仍复用 tick.func.php；本文件只负责决定“何时推进/解析/恢复”。
// ================================================================

function obl_tick_orchestrator_now() {
    return isset($GLOBALS['now']) ? (int)$GLOBALS['now'] : time();
}

function obl_tick_orchestrator_persist($extra = array()) {
    if (function_exists('obl_runtime_save_tick_globals')) {
        obl_runtime_save_tick_globals($extra);
        return;
    }
    if (function_exists('obl_gamevars_sync_from_globals')) {
        obl_gamevars_sync_from_globals($extra);
    }
}

function obl_tick_orchestrator_reload() {
    if (function_exists('obl_runtime_reload_tick_globals')) {
        obl_runtime_reload_tick_globals();
        return;
    }
    if (function_exists('obl_gamevars_sync_to_globals')) {
        obl_gamevars_sync_to_globals(true, false);
    }
}

function obl_tick_orchestrator_status($ctx = null) {
    global $gamevars;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
    $tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $processed_tick = isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;

    $status = array(
        'tick' => $tick,
        'processed_tick' => $processed_tick,
        'pending_tick' => $processed_tick < $tick,
    );

    if (function_exists('obl_game_load')) {
        $pure_read = is_array($ctx) && isset($ctx['kind']) && $ctx['kind'] === 'state';
        $row = obl_game_load(!$pure_read);
        if (is_array($row)) {
            $status['state'] = isset($row['state']) ? (string)$row['state'] : '';
            $status['phase'] = isset($row['phase']) ? (string)$row['phase'] : '';
            $status['run_id'] = isset($row['run_id']) ? (string)$row['run_id'] : '';
            $status['last_command_at'] = isset($row['last_command_at']) ? (int)$row['last_command_at'] : 0;
            $status['heartbeat_at'] = isset($row['heartbeat_at']) ? (int)$row['heartbeat_at'] : 0;
        }
    }

    return $status;
}

function obl_tick_orchestrator_after_command($ctx, $command, $contract, &$pdata, $dispatched) {
    global $gamevars;

    // 设计案 §3.4：internal_tick_advances 命令的 tick 已在 handler 内逐次推进，
    // 此处仅做最终保存（跳过 tick 推进 + 清理临时状态）
    if (!empty($contract['internal_tick_advances'])) {
        return obl_tick_orchestrator_finalize_after_internal_advances($ctx, $command, $contract, $pdata, $dispatched);
    }

    obl_save_player($pdata);

    $should_advance_tick = $dispatched && !empty($contract['advances_tick']);
    $command_time = obl_tick_orchestrator_now();

    if ($dispatched) {
        if ($should_advance_tick) {
            $GLOBALS['obl_last_command_at'] = $command_time;
        } elseif (function_exists('obl_game_note_command')) {
            obl_game_note_command($command_time);
        }
    }

    if ($should_advance_tick) {
        if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
        $gamevars['obl_pending_tick_actor_behavior'] = array(
            'pid' => isset($pdata['pid']) ? (int)$pdata['pid'] : 0,
            'domain' => strpos((string)$command, 'battle.') === 0 ? 'combat' : 'world',
            'behavior' => (string)$command,
        );

        obl_tick_advance();

        obl_tick_orchestrator_persist();
    } elseif (isset($gamevars) && is_array($gamevars)) {
        unset($gamevars['obl_pending_tick_actor_behavior']);
        unset($gamevars['obl_pending_tick_battle_actor_scope']);
    }

    $status = obl_tick_orchestrator_status($ctx);
    $status['advanced'] = $should_advance_tick;
    return $status;
}

/**
 * 导航器原子移动后的 tick 推进入口（设计案 §3.4 方案 A）
 *
 * 与 obl_tick_orchestrator_after_command 的差异：
 *   - 本入口用于 map.navigate handler 内部，每原子移动推进一次 tick
 *   - 不保存玩家数据（handler 控制 pdata 状态，最终保存由 save_and_tick 完成）
 *   - 标记 pending_tick_actor_behavior 为 world 域 map.navigate.step + seq
 *   - 多次调用安全（每次完整推进一个 tick，含 day_advance_hook 等内部钩子）
 *
 * 设计案 §3.4 关键约束：
 *   - 每原子移动的 tick 提交必须原子，保证已完成移动不回滚
 *   - 每次完成一个完整 tick 结算（含敌人行动、地图变化、拦截事件）
 *
 * @param array &$pdata 玩家数据（读取 pid）
 * @param array $step   当前原子移动步骤 ['to_pls', 'from_pls', 'seq']
 * @return array 推进状态（含 tick 号供 handler 收集）
 *   [
 *     'tick' => int,           // 推进后的游戏刻
 *     'processed_tick' => int,
 *     'advanced' => true,      // 标识本次推进成功
 *   ]
 */
function obl_tick_orchestrator_advance_for_navigation_step(&$pdata, $step) {
    global $gamevars;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();

    // 1. 标记 pending_tick_actor_behavior（world 域，map.navigate.step + seq）
    $gamevars['obl_pending_tick_actor_behavior'] = array(
        'pid'      => isset($pdata['pid']) ? (int)$pdata['pid'] : 0,
        'domain'   => 'world',
        'behavior' => 'map.navigate.step',
        'seq'      => isset($step['seq']) ? (int)$step['seq'] : 0,
    );

    // 1.5 持久化玩家新位置到 DB（修复 tick 时序 BUG：1格1单位约束依赖 DB 查询）
    // 与 obl_tick_orchestrator_after_command 行 77 时序保持一致
    // 若不先保存，敌人 NPC AI 通过 DB 查询看到玩家旧位置，可"合法"移动到玩家新位置所在图格
    // 导致玩家与敌人同格冲突（违背 1 格 1 单位核心原则）
    obl_save_player($pdata);

    // 2. 推进 tick（含 day_advance_hook 等内部钩子）
    obl_tick_advance();

    // 3. 同步 pretick = tick（新增，必须！否则下次心跳 resolve_pending 会重复结算）
    obl_tick_synchronize();

    // 4. 结算 tick 事件（新增，执行三阶段监听器）
    //    设计案 §4.1：时间调度器按权威顺序完成本游戏刻
    $tick_frame = obl_resolve_tick_events(1);

    // 5. 重新加载 $pdata 关键字段（新增，保证 handler 持有最新副本）
    //    obl_resolve_tick_events 内部抓取新副本，监听器可能修改玩家数据（如被突袭后 action='battle'）
    //    只同步可能被监听器修改的字段，不替换整个数组（避免破坏 handler 的引用）
    $fresh = obl_fetch_playerdata_by_pid($pdata['pid']);
    if ($fresh) {
        obl_format_playerdata($fresh);
        $pdata['action'] = $fresh['action'];
        $pdata['bid'] = $fresh['bid'];
        $pdata['hp'] = $fresh['hp'];
        $pdata['state'] = $fresh['state'];
        $pdata['sp'] = $fresh['sp'];
        // 注意：不同步 pls（pls 由 handler 的 perform_move_core 控制，监听器不应修改玩家位置）
        // 注意：不同步背包/装备（监听器不应修改这些）
        $old_pls = (int)$pdata['pls'];
        $old_pgroup = (int)$pdata['pgroup'];
        $new_pls = (int)$fresh['pls'];
        $new_pgroup = (int)$fresh['pgroup'];
        if ($old_pls !== $new_pls || $old_pgroup !== $new_pgroup) {
            error_log("[NAV_DEBUG] tick_drift_detected! old_pgroup=$old_pgroup old_pls=$old_pls new_pgroup=$new_pgroup new_pls=$new_pls action=" . ($fresh['action'] ?? 'null') . " bid=" . ($fresh['bid'] ?? 'null') . " — 监听器修改了玩家位置，但 handler 未同步！");
        }
    }

    // 6. 持久化（保证已完成移动不回滚）
    obl_tick_orchestrator_persist();

    // 7. 返回状态 + tick_frame（新增 tick_frame 供 handler 收集领域事件）
    $status = obl_tick_orchestrator_status();
    $status['advanced'] = true;
    $status['tick_frame'] = $tick_frame;
    return $status;
}

/**
 * internal_tick_advances 命令的最终保存入口（设计案 §3.4）
 *
 * 与 obl_tick_orchestrator_after_command 的差异：
 *   - 不推进 tick（已在 handler 内通过 advance_for_navigation_step 逐次推进）
 *   - 仅执行最终保存（玩家数据 + gamevars）
 *   - 清理 pending_tick_actor_behavior（避免遗留状态影响下次心跳）
 *   - last_command_at 仍更新（命令已成功结束）
 *
 * @param mixed  $ctx        运行时上下文
 * @param string $command    命令名
 * @param array  $contract   命令合约
 * @param array  &$pdata     玩家数据
 * @param bool   $dispatched 是否成功分发
 * @return array 状态
 */
function obl_tick_orchestrator_finalize_after_internal_advances($ctx, $command, $contract, &$pdata, $dispatched) {
    global $gamevars;

    // 1. 最终保存玩家数据
    obl_save_player($pdata);

    // 2. 更新 last_command_at（命令已成功结束）
    if ($dispatched) {
        $GLOBALS['obl_last_command_at'] = obl_tick_orchestrator_now();
    }

    // 3. 清理 pending_tick_actor_behavior（handler 内已逐次推进 tick）
    if (isset($gamevars) && is_array($gamevars)) {
        unset($gamevars['obl_pending_tick_actor_behavior']);
        unset($gamevars['obl_pending_tick_battle_actor_scope']);
    }

    // 4. 持久化 gamevars（清理后状态）
    obl_tick_orchestrator_persist();

    // 5. 返回状态（advanced=false，因 tick 推进已在 handler 内完成；
    //    internal_tick_advances=true 供 bus 响应构建识别）
    $status = obl_tick_orchestrator_status($ctx);
    $status['advanced'] = false;
    $status['internal_tick_advances'] = true;
    return $status;
}

function obl_tick_orchestrator_resolve_pending($ctx = null, $reason = 'heartbeat') {
    global $gamevars, $ginfochange;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
    if (!isset($gamevars['obl_tick'])) $gamevars['obl_tick'] = 0;
    if (!isset($gamevars['obl_pretick'])) $gamevars['obl_pretick'] = 0;

    $before_tick = (int)$gamevars['obl_tick'];
    $before_processed = (int)$gamevars['obl_pretick'];
    $resolved = false;
    $delta = 0;
    $tick_frame = null;

    if ($before_processed < $before_tick) {
        $delta = $before_tick - $before_processed;
        obl_tick_synchronize();
        $tick_frame = obl_resolve_tick_events($delta);
        $resolved = true;
        $ginfochange = true;
    }

    $after_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $after_processed = isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;
    $advanced = ($after_tick > $before_tick);
    $changed_scopes = array();

    if (is_array($tick_frame)) {
        $tick_frame['tick'] = $before_tick;
        $tick_frame['processed_tick'] = $after_processed;
        $tick_frame['next_tick'] = $after_tick;
        $changed_scopes = isset($tick_frame['changed_scopes']) && is_array($tick_frame['changed_scopes'])
            ? array_values($tick_frame['changed_scopes'])
            : array();
    }

    if ($resolved || $advanced) {
        obl_tick_orchestrator_persist();
    }

    return array(
        'resolved' => $resolved,
        'advanced' => $advanced,
        'delta' => $delta,
        'tick' => $after_tick,
        'processed_tick' => $after_processed,
        'pending_tick' => $after_processed < $after_tick,
        'reason' => $reason,
        'tick_frame' => $tick_frame,
        'changed_scopes' => $changed_scopes,
    );
}

function obl_tick_orchestrator_recover_stale_battles($ctx = null, $ttl = 30) {
    global $gamevars, $obl_error_log;

    $recovered = array();
    if (!function_exists('obl_battle_state_find_stale')) {
        return $recovered;
    }

    $executing = defined('OBL_BS_EXECUTING') ? OBL_BS_EXECUTING : 'EXECUTING';
    $awaiting = defined('OBL_BS_AWAITING_INPUT') ? OBL_BS_AWAITING_INPUT : 'AWAITING_INPUT';
    $auto_pending = defined('OBL_BS_AUTO_PENDING') ? OBL_BS_AUTO_PENDING : 'AUTO_PENDING';
    $stale_qids = obl_battle_state_find_stale((int)$ttl, $executing);
    foreach ($stale_qids as $stale_qid) {
        $record = function_exists('obl_battle_state_get_record')
            ? obl_battle_state_get_record((int)$stale_qid)
            : null;
        $current = $record && (int)$record['active_pid'] > 0
            ? obl_fetch_queue_by_pid((int)$record['active_pid'])
            : false;

        if ($current && (int)$current['type'] === 0 && function_exists('obl_battle_state_reset')) {
            obl_battle_state_reset($stale_qid, $awaiting);
            $recovered[] = (int)$stale_qid;
            continue;
        }

        if ($current && (int)$current['type'] > 0) {
            if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
            $tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
            $processed_tick = isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;
            if ($processed_tick >= $tick && function_exists('obl_tick_advance')) {
                obl_tick_advance();
            }
            obl_battle_state_reset($stale_qid, $auto_pending);
            if (isset($obl_error_log) && $obl_error_log) {
                $obl_error_log->emit('battle_state.recover_npc_pending_tick', array(
                    'qid' => (int)$stale_qid,
                    'current_pid' => (int)$current['pid'],
                ), 'battle');
            }
            $recovered[] = (int)$stale_qid;
            continue;
        }

        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('battle_state.recover_no_current_actor', array(
                'qid' => (int)$stale_qid,
            ), 'battle');
        }
    }

    return $recovered;
}

function obl_tick_orchestrator_heartbeat($ctx = null) {
    obl_tick_orchestrator_reload();

    $result = obl_tick_orchestrator_resolve_pending($ctx, 'heartbeat');
    $recovered = obl_tick_orchestrator_recover_stale_battles($ctx, 30);
    if (!empty($recovered)) {
        $result['recovered_battles'] = $recovered;
        if (!isset($result['changed_scopes']) || !is_array($result['changed_scopes'])) {
            $result['changed_scopes'] = array();
        }
        foreach (array('player_info', 'combat_targets') as $scope) {
            if (!in_array($scope, $result['changed_scopes'], true)) {
                $result['changed_scopes'][] = $scope;
            }
        }
        obl_tick_orchestrator_persist();
    } else {
        $result['recovered_battles'] = array();
    }

    if (function_exists('obl_game_note_heartbeat') && empty($result['resolved']) && empty($result['advanced'])) {
        obl_game_note_heartbeat();
    }

    $status = obl_tick_orchestrator_status($ctx);
    foreach ($status as $key => $value) {
        $result[$key] = $value;
    }

    return $result;
}
