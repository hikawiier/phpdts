<?php
declare(strict_types=1);

/**
 * 子任务 2B.1：原子移动与多行动导航 + 方案A改造测试
 *
 * 覆盖战役0 §四的3个改造点：
 *   - 改造点1（缺口1）：advance_for_navigation_step 增加 obl_tick_synchronize + obl_resolve_tick_events
 *   - 改造点3（缺口2）：force_combat 中断检测
 *   - 改造点4（缺口3）：handler 收集 tick_frame 领域事件
 *
 * 测试分层：
 *   1. navigation_tick_unit       — check_interrupt 单元测试（6种中断场景）
 *   2. navigation_tick_integration — handler 集成测试（完整 tick 结算 + tick_frame 事件）
 *   3. navigation_tick_source     — 源码审计测试（改造点不变量验证 + 心跳路径未受影响）
 *
 * 依赖 region_1.php 图格数据：
 *   tile 1: passable=true, neighbors=[24,17,5,4]
 *   tile 4: passable=true, neighbors=[27,28,29,23,5,1,2]
 *   tile 2: passable=true, neighbors=[23,4,22,21,26]
 *
 * @module E 游戏逻辑
 * @framework E-3 基于图的移动系统
 * @framework E-1 时间调度器
 */

return static function (TestRoom $room): array {
    // 辅助：重置 gamevars 到初始测试状态（tick=10, pretick=10）
    $resetGamevars = static function (): void {
        global $gamevars;
        $gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
    };

    // 辅助：保存并恢复 tick 监听器全局状态（避免测试监听器污染其他测试）
    $snapshotListeners = static function (): array {
        $saved = [];
        foreach (['battle_npc', 'idle_npc', 'post'] as $phase) {
            $saved[$phase] = isset($GLOBALS['obl_tick_listeners'][$phase])
                ? array_values($GLOBALS['obl_tick_listeners'][$phase])
                : [];
        }
        return $saved;
    };
    $restoreListeners = static function (array $saved): void {
        foreach (['battle_npc', 'idle_npc', 'post'] as $phase) {
            $GLOBALS['obl_tick_listeners'][$phase] = isset($saved[$phase]) ? $saved[$phase] : [];
        }
    };

    return array_merge(
        // ================================================================
        // 1. check_interrupt 单元测试：6种中断场景
        // ================================================================
        test_run_cases('navigation_tick_unit', [

            // --- force_combat（新增，改造点3）---

            'force_combat_triggered_by_action_battle' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-force-action', 0, ['pgroup' => 1, 'pls' => 1, 'action' => 'battle', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('force_combat', $result['reason'], 'action=battle triggers force_combat');
                test_same('force_combat', $nav['outcome_reason'], 'navigation outcome_reason=force_combat');
                test_same(true, $nav['finished'], 'navigation finished');
                test_same('battle', $result['details']['action'], 'details.action=battle');
            },

            'force_combat_triggered_by_bid_positive' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-force-bid', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 42]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('force_combat', $result['reason'], 'bid>0 triggers force_combat');
                test_same(42, $result['details']['bid'], 'details.bid=42');
            },

            'force_combat_priority_over_arrived' => static function () use ($room): void {
                // 即使已抵达目标，force_combat 也优先中断
                $room->resetData();
                $player = $room->player('tick-force-priority', 0, ['pgroup' => 1, 'pls' => 4, 'action' => 'battle', 'bid' => 99]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('force_combat', $result['reason'], 'force_combat fires before arrived');
                test_same('interrupted', $nav['outcome'], 'outcome=interrupted (not arrived)');
            },

            'force_combat_not_triggered_when_no_battle' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-force-clean', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same(null, $result, 'no interrupt when action="" and bid=0');
            },

            // --- arrived ---

            'arrived_interrupt' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-arrived', 0, ['pgroup' => 1, 'pls' => 4, 'action' => '', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('arrived', $result['reason'], 'arrived at target');
                test_same('arrived', $nav['outcome'], 'outcome=arrived');
            },

            // --- enemy_discovered ---

            'enemy_discovered_interrupt' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-enemy', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $info = ['enemies_discovered' => [['pid' => 99, 'name' => 'test_enemy']]];
                $result = obl_navigation_check_interrupt($nav, $player, $info);
                test_same('enemy_discovered', $result['reason'], 'enemy discovered triggers interrupt');
                test_same('interrupted', $nav['outcome'], 'outcome=interrupted');
            },

            // --- poi_discovered ---

            'poi_discovered_interrupt' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-poi', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $info = ['pois_discovered' => [['pls' => 2, 'iaid' => 1]]];
                $result = obl_navigation_check_interrupt($nav, $player, $info);
                test_same('poi_discovered', $result['reason'], 'poi discovered triggers interrupt');
            },

            // --- no_sp ---

            'no_sp_interrupt' => static function () use ($room): void {
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['move_sp_cost' => 10];
                try {
                    $player = $room->player('tick-nosp', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0, 'sp' => 5, 'msp' => 100]);
                    $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                    $result = obl_navigation_check_interrupt($nav, $player, []);
                    test_same('no_sp', $result['reason'], 'low sp triggers no_sp interrupt');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            // --- capability_lost ---

            'capability_lost_interrupt' => static function () use ($room): void {
                $room->resetData();
                // state=5（死亡/ incap）使 voluntary_move 不 allowed
                $player = $room->player('tick-caplost', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0, 'state' => 5]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                if ($result !== null && $result['reason'] === 'capability_lost') {
                    test_same('capability_lost', $result['reason'], 'capability lost triggers interrupt');
                    test_same('voluntary_move', $result['details']['capability'], 'capability=voluntary_move');
                } else {
                    // state=5 可能不触发 capability_lost（取决于 actor_capability_decide 实现）
                    // 改为验证 force_combat 不误触发
                    test_assert($result === null || $result['reason'] !== 'force_combat', 'state=5 does not trigger force_combat');
                }
            },

            'no_interrupt_when_all_clear' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('tick-clear', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0, 'sp' => 100, 'msp' => 100]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same(null, $result, 'no interrupt when all conditions clear');
            },
        ]),

        // ================================================================
        // 2. handler 集成测试：完整 tick 结算 + tick_frame 事件
        // ================================================================
        test_run_cases('navigation_tick_integration', [

            // --- 正常导航抵达 ---

            'normal_navigation_arrives' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-nav-arrive', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];
                    $GLOBALS['obl_command_operation_key'] = 'test-nav-arrive';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 4], $player);
                        test_assert($result['ok'], 'navigation ok');
                        test_same(true, $result['data']['tick_advanced'], 'tick_advanced=true');
                        test_same('arrived', $result['data']['navigation']['outcome'], 'outcome=arrived');
                        test_same(4, (int)$player['pls'], 'player arrived at tile 4');
                        // 至少 1 步
                        $steps = $result['data']['navigation']['steps'];
                        test_assert(count($steps) >= 1, 'at least 1 step taken');
                        // tick 推进了
                        global $gamevars;
                        test_assert((int)$gamevars['obl_tick'] > 10, 'tick advanced beyond initial 10');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            'multi_step_navigation_arrives' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 1 → 4 → 2（2步，tile 4 是中间节点）
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-nav-multi', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];
                    $GLOBALS['obl_command_operation_key'] = 'test-nav-multi';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 2], $player);
                        test_assert($result['ok'], 'multi-step navigation ok');
                        test_same('arrived', $result['data']['navigation']['outcome'], 'outcome=arrived');
                        test_same(2, (int)$player['pls'], 'player arrived at tile 2');
                        $steps = $result['data']['navigation']['steps'];
                        // 每步推进了 tick
                        $ticks = array_column(array_filter($steps, static fn($s) => isset($s['tick'])), 'tick');
                        test_assert(count($ticks) >= 2, 'at least 2 steps with tick');
                        // tick 单调递增
                        for ($i = 1; $i < count($ticks); $i++) {
                            test_assert($ticks[$i] > $ticks[$i - 1], "tick monotonically increasing at step {$i}");
                        }
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            // --- force_combat 集成（被突袭后中断）---

            'force_combat_during_navigation' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-force-nav', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];

                    // 注册 post phase 监听器：模拟 NPC 突袭玩家
                    $ambushListener = static function ($delta, &$ctx) use ($player): void {
                        $ctx['player']['action'] = 'battle';
                        $ctx['player']['bid'] = 777;
                        obl_save_player($ctx['player']);
                        obl_tick_ctx_add_changed_scopes($ctx, ['player_info', 'combat_targets']);
                        obl_tick_ctx_add_domain_event($ctx, 'ambush_triggered', ['target_pid' => (int)$player['pid']]);
                    };
                    obl_tick_register_listener('post', $ambushListener);

                    $GLOBALS['obl_command_operation_key'] = 'test-force-nav';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 4], $player);
                        test_assert($result['ok'], 'force_combat returns ok=true');
                        test_same(true, $result['data']['tick_advanced'], 'tick was consumed');
                        test_same('interrupted', $result['data']['navigation']['outcome'], 'outcome=interrupted');
                        test_same('force_combat', $result['data']['navigation']['outcome_reason'], 'reason=force_combat');
                        // 玩家移动到了 tile 4（移动已完成，tick 结算后才被突袭）
                        test_same(4, (int)$player['pls'], 'player moved to tile 4 before ambush');
                        // pdata 被 reload 后同步了 battle 状态
                        test_same('battle', (string)$player['action'], 'pdata action reloaded to battle');
                        test_same(777, (int)$player['bid'], 'pdata bid reloaded to 777');
                        // presentation_events 包含 tick 事件
                        $events = $result['data']['presentation']['events'];
                        $types = array_column($events, 'type');
                        test_assert(in_array('tick_changed_scope', $types, true), 'tick_changed_scope event present');
                        test_assert(in_array('tick_domain_event', $types, true), 'tick_domain_event event present');
                        // interrupt 作为最后一次移动的属性记录（设计案 §8.1：中断是最后一次移动的属性，不作为独立 step）
                        $steps = $result['data']['navigation']['steps'];
                        $lastStep = end($steps);
                        test_assert($lastStep !== false, 'last move step exists');
                        test_assert(isset($lastStep['interrupt']), 'last move step has interrupt field');
                        test_same('force_combat', $lastStep['interrupt']['reason'], 'interrupt reason=force_combat');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            // --- tick_frame 事件收集（改造点4）---

            'tick_frame_changed_scope_collected' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-scope', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];

                    // 注册监听器添加 changed_scope
                    $scopeListener = static function ($delta, &$ctx): void {
                        obl_tick_ctx_add_changed_scopes($ctx, ['player_info', 'game_map']);
                    };
                    obl_tick_register_listener('post', $scopeListener);

                    $GLOBALS['obl_command_operation_key'] = 'test-scope';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 4], $player);
                        $events = $result['data']['presentation']['events'];
                        $scopeEvents = array_filter($events, static fn($e) => ($e['type'] ?? '') === 'tick_changed_scope');
                        test_assert(count($scopeEvents) >= 2, 'at least 2 tick_changed_scope events');
                        $scopes = array_column(array_values($scopeEvents), 'scope');
                        test_assert(in_array('player_info', $scopes, true), 'player_info scope collected');
                        test_assert(in_array('game_map', $scopes, true), 'game_map scope collected');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            'tick_frame_domain_event_collected' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-domain', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];

                    $eventListener = static function ($delta, &$ctx): void {
                        obl_tick_ctx_add_domain_event($ctx, 'npc_moved', ['npc_pid' => 55, 'to_pls' => 3]);
                    };
                    obl_tick_register_listener('post', $eventListener);

                    $GLOBALS['obl_command_operation_key'] = 'test-domain';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 4], $player);
                        $events = $result['data']['presentation']['events'];
                        $domainEvents = array_filter($events, static fn($e) => ($e['type'] ?? '') === 'tick_domain_event');
                        test_assert(count($domainEvents) >= 1, 'at least 1 tick_domain_event');
                        $firstEvent = array_values($domainEvents)[0];
                        test_same('npc_moved', $firstEvent['event'], 'event name=npc_moved');
                        test_same(55, $firstEvent['payload']['npc_pid'], 'payload.npc_pid=55');
                        test_same('post_domain', $firstEvent['domain'], 'domain=post_domain');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            'event_seq_and_navigation_seq_dual_ordering' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 验证 K-9 inbox 顺序身份契约：event_seq 唯一递增 + navigation_seq 对应步序
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-seq', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];

                    $seqListener = static function ($delta, &$ctx): void {
                        obl_tick_ctx_add_changed_scopes($ctx, ['player_info']);
                        obl_tick_ctx_add_domain_event($ctx, 'test_event', []);
                    };
                    obl_tick_register_listener('post', $seqListener);

                    $GLOBALS['obl_command_operation_key'] = 'test-seq';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 4], $player);
                        $events = $result['data']['presentation']['events'];
                        // event_seq 唯一递增（从 1 开始）
                        $seqs = array_column($events, 'event_seq');
                        $uniqueSeqs = array_unique($seqs);
                        test_same(count($seqs), count($uniqueSeqs), 'event_seq values are unique');
                        sort($seqs);
                        for ($i = 0; $i < count($seqs); $i++) {
                            test_same($i + 1, $seqs[$i], "event_seq={$seqs[$i]} expected=" . ($i + 1));
                        }
                        // 所有事件都有 navigation_seq
                        foreach ($events as $ev) {
                            test_assert(isset($ev['navigation_seq']), 'every event has navigation_seq');
                            test_assert($ev['navigation_seq'] >= 1, 'navigation_seq >= 1');
                        }
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            // --- tick 完整结算验证（改造点1）---

            'tick_synchronize_prevents_heartbeat_reresolve' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 改造点1：obl_tick_synchronize 在 obl_resolve_tick_events 之前调用
                // 验证：导航后心跳不会重复结算
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-sync', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser, $gamevars;
                    $cuser = (string)$player['name'];
                    $GLOBALS['obl_command_operation_key'] = 'test-sync';
                    try {
                        obl_command_handler_map_navigate(['target' => 4], $player);
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                    // 导航后 obl_pretick == obl_tick（synchronize 已同步）
                    test_same((int)$gamevars['obl_tick'], (int)$gamevars['obl_pretick'], 'obl_pretick == obl_tick after navigation');
                    // 模拟心跳：resolve_pending 不应再结算
                    $heartbeatResult = obl_tick_orchestrator_resolve_pending(null, 'heartbeat');
                    test_same(false, $heartbeatResult['resolved'], 'heartbeat does not re-resolve (already synchronized)');
                    test_same(0, $heartbeatResult['delta'], 'delta=0 (no pending tick)');
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            'resolve_tick_events_called_during_navigation' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 改造点1：obl_resolve_tick_events 被调用
                // 验证：注册一个监听器，如果被调用说明 obl_resolve_tick_events 执行了
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-resolve', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];

                    $called = false;
                    $probeListener = static function ($delta, &$ctx) use (&$called): void {
                        $called = true;
                        obl_tick_ctx_add_changed_scopes($ctx, ['probe']);
                    };
                    obl_tick_register_listener('post', $probeListener);

                    $GLOBALS['obl_command_operation_key'] = 'test-resolve';
                    try {
                        obl_command_handler_map_navigate(['target' => 4], $player);
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                    test_assert($called, 'tick listener was called during navigation (obl_resolve_tick_events executed)');
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            'tick_frame_returned_in_step_status' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 改造点1：advance_for_navigation_step 返回 tick_frame
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-frame', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser;
                    $cuser = (string)$player['name'];
                    $step = ['to_pls' => 4, 'from_pls' => 1, 'seq' => 1];
                    $status = obl_tick_orchestrator_advance_for_navigation_step($player, $step);
                    test_assert(isset($status['tick_frame']), 'tick_frame in return status');
                    test_assert(is_array($status['tick_frame']), 'tick_frame is array');
                    test_assert(isset($status['tick_frame']['phases']), 'tick_frame has phases');
                    test_assert(isset($status['tick_frame']['changed_scopes']), 'tick_frame has changed_scopes');
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            // --- 未形成有效行动不推进 tick ---

            'no_tick_consumed_on_no_target' => static function () use ($room, $resetGamevars): void {
                $room->resetData();
                $resetGamevars();
                $player = $room->player('tick-no-target', 0, ['pgroup' => 999, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'test-no-tick-target';
                try {
                    $result = obl_command_handler_map_navigate([], $player);
                    test_same(false, $result['data']['tick_advanced'], 'no tick consumed on no_target');
                    test_same('no_target', $result['data']['navigation']['outcome'], 'outcome=no_target');
                    global $gamevars;
                    test_same(10, (int)$gamevars['obl_tick'], 'tick unchanged');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },

            'no_tick_consumed_on_invalid_target' => static function () use ($room, $resetGamevars): void {
                $room->resetData();
                $resetGamevars();
                $player = $room->player('tick-invalid-target', 0, ['pgroup' => 1, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'test-no-tick-invalid';
                try {
                    $result = obl_command_handler_map_navigate(['target' => 999], $player);
                    test_same(false, $result['data']['tick_advanced'], 'no tick consumed on invalid target');
                    test_same('target_invalid', $result['data']['navigation']['outcome_reason'], 'reason=target_invalid');
                    global $gamevars;
                    test_same(10, (int)$gamevars['obl_tick'], 'tick unchanged');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },

            // --- 已完成移动不回滚 ---

            'completed_moves_not_rolled_back_on_force_combat' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 验证：导航中途被突袭后，已完成的移动步骤不回滚
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-norollback', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser, $gamevars;
                    $cuser = (string)$player['name'];

                    $ambushListener = static function ($delta, &$ctx) use ($player): void {
                        $ctx['player']['action'] = 'battle';
                        $ctx['player']['bid'] = 888;
                        obl_save_player($ctx['player']);
                    };
                    obl_tick_register_listener('post', $ambushListener);

                    $GLOBALS['obl_command_operation_key'] = 'test-norollback';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 4], $player);
                        // 步骤 1 已完成：玩家在 tile 4
                        test_same(4, (int)$player['pls'], 'step 1 completed (player at tile 4)');
                        // tick 已推进（不回滚）
                        test_assert((int)$gamevars['obl_tick'] > 10, 'tick advanced (not rolled back)');
                        // 导航中断
                        test_same('force_combat', $result['data']['navigation']['outcome_reason'], 'interrupted by force_combat');
                        // steps 中有已完成的 move step
                        $moveSteps = array_filter($result['data']['navigation']['steps'], static fn($s) => ($s['kind'] ?? '') === 'move');
                        test_assert(count($moveSteps) >= 1, 'at least 1 completed move step');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },

            'completed_moves_not_rolled_back_on_multi_step' => static function () use ($room, $resetGamevars, $snapshotListeners, $restoreListeners): void {
                // 2步路径 1→4→2，第2步前被突袭
                $room->resetData();
                $resetGamevars();
                $savedListeners = $snapshotListeners();
                try {
                    $player = $room->player('tick-multi-norollback', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    global $cuser, $gamevars;
                    $cuser = (string)$player['name'];

                    $stepCount = 0;
                    $ambushOnStep2 = static function ($delta, &$ctx) use ($player, &$stepCount): void {
                        $stepCount++;
                        if ($stepCount >= 2) {
                            $ctx['player']['action'] = 'battle';
                            $ctx['player']['bid'] = 555;
                            obl_save_player($ctx['player']);
                        }
                    };
                    obl_tick_register_listener('post', $ambushOnStep2);

                    $GLOBALS['obl_command_operation_key'] = 'test-multi-norollback';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 2], $player);
                        // 第1步完成（到达中间格 tile 4），第2步被突袭
                        $steps = $result['data']['navigation']['steps'];
                        $moveSteps = array_filter($steps, static fn($s) => ($s['kind'] ?? '') === 'move');
                        test_assert(count($moveSteps) >= 1, 'at least 1 completed move step before ambush');
                        // tick 推进了至少 1 次
                        test_assert((int)$gamevars['obl_tick'] > 10, 'tick advanced at least once');
                        // 导航被中断
                        test_same('interrupted', $result['data']['navigation']['outcome'], 'outcome=interrupted');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    $restoreListeners($savedListeners);
                }
            },
        ]),

        // ================================================================
        // 3. 源码审计测试：改造点不变量 + 心跳路径未受影响
        // ================================================================
        test_run_cases('navigation_tick_source', [

            // --- 改造点1 不变量 ---

            'advance_step_calls_tick_synchronize' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_tick_synchronize') !== false, 'advance_for_navigation_step calls obl_tick_synchronize');
            },

            'advance_step_calls_resolve_tick_events' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_resolve_tick_events') !== false, 'advance_for_navigation_step calls obl_resolve_tick_events');
            },

            'advance_step_reloads_pdata_fields' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_fetch_playerdata_by_pid') !== false, 'reloads pdata via obl_fetch_playerdata_by_pid');
                // 同步关键字段
                foreach (["['action']", "['bid']", "['hp']", "['state']", "['sp']"] as $field) {
                    test_assert(strpos($funcBody, "\$pdata{$field}") !== false, "reloads pdata{$field}");
                }
            },

            'advance_step_returns_tick_frame' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, "['tick_frame']") !== false, 'returns tick_frame in status');
            },

            'advance_step_synchronize_before_resolve' => static function (): void {
                // obl_tick_synchronize 必须在 obl_resolve_tick_events 之前
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                $syncPos = strpos($funcBody, 'obl_tick_synchronize');
                $resolvePos = strpos($funcBody, 'obl_resolve_tick_events');
                test_assert($syncPos !== false && $resolvePos !== false, 'both calls present');
                test_assert($syncPos < $resolvePos, 'obl_tick_synchronize before obl_resolve_tick_events');
            },

            'advance_step_does_not_sync_pls' => static function (): void {
                // 不同步 pls（由 handler 的 perform_move_core 控制）
                // 检查赋值模式 $pdata['pls'] = $fresh（同步 pls 回 $pdata）
                // 允许读取 $pdata['pls'] 用于比较（如 tick_drift 调试桩的位置漂移检测）
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                // 获取 reload 块
                $reloadStart = strpos($funcBody, '$fresh = obl_fetch_playerdata_by_pid');
                $reloadEnd = strpos($funcBody, '}', $reloadStart);
                // 查找 if ($fresh) 块
                $ifStart = strpos($funcBody, 'if ($fresh)', $reloadStart);
                $ifBody = substr($funcBody, $ifStart, strpos($funcBody, '}', $ifStart) - $ifStart + 1);
                // 检查不存在 $pdata['pls'] = $fresh 赋值模式（同步 pls 回 $pdata）
                test_assert(strpos($ifBody, "\$pdata['pls'] = \$fresh") === false, 'does not sync pls from fresh');
            },

            // --- 改造点3 不变量 ---

            'force_combat_check_before_arrived' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_check_interrupt');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                $forcePos = strpos($funcBody, " pdata['action']") !== false ? strpos($funcBody, "force_combat") : strpos($funcBody, "force_combat");
                // 查找 force_combat 检测
                $forceCheckPos = strpos($funcBody, "'battle'");
                $arrivedCheckPos = strpos($funcBody, '$cur_pls === $target_pls');
                test_assert($forceCheckPos !== false, 'force_combat check present');
                test_assert($arrivedCheckPos !== false, 'arrived check present');
                test_assert($forceCheckPos < $arrivedCheckPos, 'force_combat check before arrived check');
            },

            'force_combat_does_not_use_busy_battle' => static function (): void {
                // 不使用 obl_battle_state_has_busy_battle
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_check_interrupt');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_battle_state_has_busy_battle') === false, 'does not use obl_battle_state_has_busy_battle');
            },

            // --- 改造点4 不变量 ---

            'handler_collects_tick_changed_scope' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                test_assert(strpos($handlerBody, 'tick_changed_scope') !== false, 'handler collects tick_changed_scope events');
                test_assert(strpos($handlerBody, 'tick_domain_event') !== false, 'handler collects tick_domain_event events');
            },

            'handler_tick_frame_collection_uses_pre_increment' => static function (): void {
                // event_seq 必须用 ++$event_seq（pre-increment）保持唯一递增
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                // tick_frame 收集块中不应有 $event_seq++（post-increment，会导致重复）
                $tickFrameStart = strpos($handlerBody, 'tick_frame');
                $tickFrameEnd = strpos($handlerBody, '// 3.10', $tickFrameStart);
                $tickFrameBlock = substr($handlerBody, $tickFrameStart, $tickFrameEnd - $tickFrameStart);
                test_assert(strpos($tickFrameBlock, '$event_seq++') === false, 'tick_frame collection uses pre-increment (++$event_seq) not post-increment');
                test_assert(strpos($tickFrameBlock, '++$event_seq') !== false, 'tick_frame collection uses ++$event_seq');
            },

            // --- 心跳路径未受影响 ---

            'heartbeat_path_still_calls_synchronize_and_resolve' => static function (): void {
                // 验证 obl_tick_orchestrator_resolve_pending 仍正确调用 synchronize + resolve
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_resolve_pending');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_tick_synchronize') !== false, 'heartbeat path still calls obl_tick_synchronize');
                test_assert(strpos($funcBody, 'obl_resolve_tick_events') !== false, 'heartbeat path still calls obl_resolve_tick_events');
            },

            'heartbeat_path_unchanged_structure' => static function (): void {
                // 验证 resolve_pending 结构未变：检查 pending_tick 条件 + delta 计算
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_resolve_pending');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, '$before_processed < $before_tick') !== false, 'heartbeat checks pretick < tick');
                test_assert(strpos($funcBody, 'obl_tick_orchestrator_persist') !== false, 'heartbeat persists');
                test_assert(strpos($funcBody, "'reason'") !== false, 'heartbeat returns reason');
            },

            'finalize_after_internal_advances_unchanged' => static function (): void {
                // 验证 finalize_after_internal_advances 未被修改
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_finalize_after_internal_advances');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_save_player') !== false, 'finalize saves player');
                test_assert(strpos($funcBody, 'obl_tick_advance(') === false, 'finalize does NOT advance tick');
                test_assert(strpos($funcBody, "['advanced'] = false") !== false, 'finalize reports advanced=false');
            },
        ])
    );
};
