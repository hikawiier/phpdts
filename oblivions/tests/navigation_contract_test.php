<?php
declare(strict_types=1);

/**
 * 子任务 2D.1：高层导航命令合约与一致性测试
 *
 * 覆盖 M-B-Module §三核心不变量：
 *   1. 高层导航命令是单一命令（合约字段 + handler 内循环）
 *   2. 每次原子移动独立推进游戏刻（internal_tick_advances=true）
 *   3. 未形成有效行动不推进游戏刻（begin/next_step/move_failed 路径）
 *   4. 现有 15 命令执行管道不被污染（合约 + dispatch 隔离）
 *   5. 探索降级等待（explore_outcome=degraded_wait）
 *   6. 幂等协议（operation_key 标识 + 单步原子事务）
 *
 * 标注：涉及完整 tick 结算/事务回滚的端到端验证属集成环境范畴
 *      （见 navigation_integration_test.php，由其他子任务负责）
 *
 * @module B 命令系统
 * @framework B-1 声明式命令合约
 * @framework B-3 命令总线执行管道
 */

return static function (TestRoom $room): array {
    return array_merge(
        test_run_cases('navigate_contract', [
            'contract_exists_and_fields_match_design' => static function (): void {
                $contract = obl_command_contract('map.navigate');
                test_assert($contract !== null, 'map.navigate contract must exist');
                test_same('obl_navigate', $contract['legacy'], 'legacy handler name');
                test_same('explore', $contract['ui_mode'], 'ui_mode is explore');
                test_same(true, $contract['advances_tick'], 'advances_tick=true (each atomic move advances tick)');
                test_same(false, $contract['itm0_allowed'], 'itm0_allowed=false');
                test_same(['voluntary_move'], $contract['required_capabilities'], 'required capabilities');
                // 设计案 §3.4：handler 内多次推进 tick，B-3 save_and_tick 跳过 tick 推进
                test_same(true, !empty($contract['internal_tick_advances']), 'internal_tick_advances=true (handler drives tick)');
                // payload_schema 三字段
                test_assert(isset($contract['payload_schema']['target']), 'target field in schema');
                test_assert(isset($contract['payload_schema']['tendency']), 'tendency field in schema');
                test_assert(isset($contract['payload_schema']['max_steps']), 'max_steps field in schema');
            },

            'payload_valid_with_all_fields_passes' => static function (): void {
                $contract = obl_command_contract('map.navigate');
                $result = obl_command_validate_payload(
                    ['target' => 5, 'tendency' => 'nearby', 'max_steps' => 10],
                    $contract['payload_schema']
                );
                test_assert($result['ok'], 'valid payload must pass');
                test_same(5, $result['payload']['target'], 'target normalized to int');
                test_same('nearby', $result['payload']['tendency'], 'tendency kept as string');
                test_same(10, $result['payload']['max_steps'], 'max_steps normalized to int');
            },

            'payload_empty_passes_all_fields_optional' => static function (): void {
                // 设计案 §5.2：target 省略=后端自动选目标；所有字段 required=false
                $contract = obl_command_contract('map.navigate');
                $result = obl_command_validate_payload([], $contract['payload_schema']);
                test_assert($result['ok'], 'empty payload must pass (all fields optional)');
            },

            'payload_max_steps_above_limit_rejected' => static function (): void {
                // 设计案 §6.2.1 max_steps 上限 50（防 PHP 超时）
                $contract = obl_command_contract('map.navigate');
                $result = obl_command_validate_payload(['max_steps' => 51], $contract['payload_schema']);
                test_assert(!$result['ok'], 'max_steps=51 must be rejected');
                test_same('INVALID_PAYLOAD', $result['code'], 'rejection code');
                test_same('above_max', $result['details']['reason'], 'rejection reason');
                test_same(50, $result['details']['max'], 'limit is 50');
            },

            'payload_max_steps_at_limit_passes' => static function (): void {
                $contract = obl_command_contract('map.navigate');
                $result = obl_command_validate_payload(['max_steps' => 50], $contract['payload_schema']);
                test_assert($result['ok'], 'max_steps=50 (at limit) must pass');
            },

            'payload_max_steps_zero_rejected' => static function (): void {
                $contract = obl_command_contract('map.navigate');
                $result = obl_command_validate_payload(['max_steps' => 0], $contract['payload_schema']);
                test_assert(!$result['ok'], 'max_steps=0 must be rejected (min=1)');
                test_same('below_min', $result['details']['reason'], 'rejection reason');
            },

            'payload_target_negative_rejected' => static function (): void {
                $contract = obl_command_contract('map.navigate');
                $result = obl_command_validate_payload(['target' => -1], $contract['payload_schema']);
                test_assert(!$result['ok'], 'target=-1 must be rejected (min=0)');
                test_same('below_min', $result['details']['reason'], 'rejection reason');
            },

            'tendency_unknown_falls_back_to_steady' => static function (): void {
                // 合约层 tendency 是 string 不校验枚举（首期简化）；
                // navigation_begin 通过 obl_navigation_normalize_tendency 将未知值回退 steady
                test_same('steady', obl_navigation_normalize_tendency('unknown_value'), 'unknown tendency falls back to steady');
                test_same('steady', obl_navigation_normalize_tendency(''), 'empty tendency falls back to steady');
                test_same('steady', obl_navigation_normalize_tendency(null), 'null tendency falls back to steady');
            },

            'tendency_known_values_preserved' => static function (): void {
                foreach (['steady', 'nearby', 'deep', 'efficient'] as $t) {
                    test_same($t, obl_navigation_normalize_tendency($t), "known tendency {$t} preserved");
                }
            },
        ]),

        test_run_cases('command_isolation', [
            // M-B-Module §三.7 / B3-Consistency §三.7：现有 15 命令执行管道不被污染
            'move_contract_unchanged_single_precise_move' => static function (): void {
                $move = obl_command_contract('map.move');
                test_assert($move !== null, 'map.move contract exists');
                test_same('move', $move['legacy'], 'map.move legacy name unchanged');
                // map.move 是单次精确移动：to 必填
                test_same(true, $move['payload_schema']['to']['required'], 'map.move requires to field');
                test_same('int', $move['payload_schema']['to']['type'], 'map.move to is int');
                // map.move 不含 internal_tick_advances（单次 tick 由 B-3 save_and_tick 推进）
                test_assert(empty($move['internal_tick_advances']), 'map.move has no internal_tick_advances flag');
            },

            'explore_contract_unchanged_with_outcome_extension' => static function (): void {
                $explore = obl_command_contract('map.explore');
                test_assert($explore !== null, 'map.explore contract exists');
                test_same('obl_explore', $explore['legacy'], 'map.explore legacy unchanged');
                // 设计案 §6.2.2：response_extensions 携带 explore_outcome
                test_assert(in_array('explore_outcome', $explore['response_extensions'], true), 'explore response_extensions has explore_outcome');
                test_assert(empty($explore['internal_tick_advances']), 'map.explore has no internal_tick_advances flag');
            },

            'navigate_contract_does_not_inherit_move_required_to' => static function (): void {
                // map.navigate 与 map.move 合约完全独立，不复用 to 字段
                $nav = obl_command_contract('map.navigate');
                test_assert(!isset($nav['payload_schema']['to']), 'map.navigate must not use "to" field (uses target)');
                $move = obl_command_contract('map.move');
                test_assert(!isset($move['payload_schema']['target']), 'map.move must not use "target" field (uses to)');
                // 两者 legacy handler 不同，分发路径独立
                test_assert($nav['legacy'] !== $move['legacy'], 'legacy handlers are distinct');
            },

            'dispatch_switch_has_isolated_branches' => static function (): void {
                // 验证 handler dispatch 中 map.move / map.explore / map.navigate 是独立 case 分支
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                test_assert(strpos($source, "case 'map.move':") !== false, 'map.move case exists');
                test_assert(strpos($source, "case 'map.explore':") !== false, 'map.explore case exists');
                test_assert(strpos($source, "case 'map.navigate':") !== false, 'map.navigate case exists');
                // map.navigate case 调用专用 handler，不与 map.move 共用 obl_move
                $navCasePos = strpos($source, "case 'map.navigate':");
                $moveCasePos = strpos($source, "case 'map.move':");
                test_assert($navCasePos !== false && $moveCasePos !== false, 'both cases present');
                // 验证 map.navigate 分支调用 obl_command_handler_map_navigate
                $navBlock = substr($source, $navCasePos, strpos($source, 'case ', $navCasePos + 1) - $navCasePos);
                test_assert(strpos($navBlock, 'obl_command_handler_map_navigate') !== false, 'navigate case dispatches to dedicated handler');
                // 验证 map.move 分支调用 obl_move（单次精确移动）
                $moveBlock = substr($source, $moveCasePos, strpos($source, 'case ', $moveCasePos + 1) - $moveCasePos);
                test_assert(strpos($moveBlock, 'obl_move(') !== false, 'move case dispatches to obl_move');
                test_assert(strpos($moveBlock, 'obl_command_handler_map_navigate') === false, 'move case must NOT call navigate handler');
            },

            'existing_command_count_not_reduced' => static function (): void {
                // 现有 15 命令 + map.navigate 不减少现有命令
                $contracts = obl_command_contracts();
                $required = ['map.move', 'map.explore', 'map.navigate', 'poi.search', 'poi.interact',
                             'poi.dismantle', 'item.pickup', 'item.discard', 'item.use', 'item.equip',
                             'item.unequip', 'item.swap_weapon', 'inventory.organize', 'craft.execute',
                             'battle.start', 'battle.submit_turn', 'combat.can_engage', 'world.wait',
                             'combat.preview_single', 'combat.preview_targets', 'combat.preview_chain'];
                foreach ($required as $cmd) {
                    test_assert(isset($contracts[$cmd]), "existing command {$cmd} must not be removed");
                }
            },
        ]),

        test_run_cases('navigation_begin', [
            // 设计案 §3.4 handler 第一步：obl_navigation_begin 选目标
            'begin_target_invalid_when_tile_missing' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-target-invalid', 0, ['pgroup' => 1, 'pls' => 1]);
                // 目标格 999 在 region_1 不存在
                $nav = obl_navigation_begin(['target' => 999], $player);
                test_same(true, $nav['finished'], 'begin finishes when target tile missing');
                test_same('interrupted', $nav['outcome'], 'outcome=interrupted');
                test_same('target_invalid', $nav['outcome_reason'], 'outcome_reason=target_invalid');
            },

            'begin_arrived_when_already_at_target' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-arrived', 0, ['pgroup' => 1, 'pls' => 1]);
                // 玩家已在目标格 1
                $nav = obl_navigation_begin(['target' => 1], $player);
                test_same(true, $nav['finished'], 'begin finishes when already at target');
                test_same('arrived', $nav['outcome'], 'outcome=arrived');
                test_same('arrived', $nav['outcome_reason'], 'outcome_reason=arrived');
            },

            'begin_preserves_impassable_anchor_adjustment' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-anchor-impassable', 0, ['pgroup' => 1, 'pls' => 1]);
                $nav = obl_navigation_begin(['target' => 5], $player);
                test_same(5, $nav['requested_target_pls'], 'requested target preserves player anchor');
                test_assert((int)$nav['target_pls'] !== 5, 'impassable anchor resolves to nearby landing');
                test_same([
                    'from_pls' => 5,
                    'to_pls' => (int)$nav['target_pls'],
                    'reasons' => ['impassable'],
                ], $nav['target_adjustment'], 'impassable adjustment is structured');

                $result = obl_command_build_navigation_result($nav, $player, [], []);
                test_same(5, $result['requested_target_pls'], 'response preserves requested target');
                test_same($nav['target_adjustment'], $result['target_adjustment'], 'response exposes adjustment metadata');
            },

            'begin_preserves_occupied_anchor_without_identity_leak' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-anchor-occupied', 0, ['pgroup' => 1, 'pls' => 1]);
                $room->player('nav-anchor-blocker', 1, ['pgroup' => 1, 'pls' => 4]);
                $nav = obl_navigation_begin(['target' => 4], $player);
                test_same(4, $nav['requested_target_pls'], 'occupied anchor preserves requested target');
                test_assert((int)$nav['target_pls'] !== 4, 'occupied anchor resolves to nearby landing');
                test_same(['occupied'], $nav['target_adjustment']['reasons'], 'occupancy reason does not expose actor identity');
            },

            'begin_combines_anchor_adjustment_reasons' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-anchor-combined', 0, ['pgroup' => 1, 'pls' => 1]);
                $room->player('nav-anchor-hidden-blocker', 1, ['pgroup' => 1, 'pls' => 5, 'discovered' => 0]);
                $nav = obl_navigation_begin(['target' => 5], $player);
                test_same(['impassable', 'occupied'], $nav['target_adjustment']['reasons'], 'all public adjustment reasons are preserved');
            },

            'begin_no_target_when_auto_select_finds_nothing' => static function () use ($room): void {
                $room->resetData();
                // pgroup=999 无地图文件，select_target 找不到任何目标
                $player = $room->player('nav-no-target', 0, ['pgroup' => 999, 'pls' => 1]);
                $nav = obl_navigation_begin([], $player);
                test_same(true, $nav['finished'], 'begin finishes when no auto target available');
                test_same('no_target', $nav['outcome'], 'outcome=no_target');
                test_same('no_target', $nav['outcome_reason'], 'outcome_reason=no_target');
                test_same(null, $nav['target_pls'], 'target_pls stays null');
            },

            'begin_normalizes_unknown_tendency_to_steady' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-tendency', 0, ['pgroup' => 999, 'pls' => 1]);
                $nav = obl_navigation_begin(['tendency' => 'bogus'], $player);
                test_same('steady', $nav['tendency'], 'unknown tendency normalized to steady');
            },

            'begin_clamps_max_steps_to_limit' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-clamp', 0, ['pgroup' => 999, 'pls' => 1]);
                // begin 内部钳制 max_steps 到 limit=50（合约层已拦截 51，此处验证防御性钳制）
                $nav = obl_navigation_begin(['max_steps' => 9999], $player);
                test_same(50, $nav['max_steps'], 'max_steps clamped to limit 50');
            },

            'begin_default_max_steps_from_config' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-default-steps', 0, ['pgroup' => 999, 'pls' => 1]);
                $nav = obl_navigation_begin([], $player);
                test_same(20, $nav['max_steps'], 'default max_steps=20 (navigation_max_steps_default)');
            },
        ]),

        test_run_cases('no_tick_advance_on_invalid_action', [
            // M-B-Module §三.3：未形成有效行动不推进游戏刻
            // handler 在 begin finished 时直接 return，不调用 advance_for_navigation_step
            'handler_no_target_returns_tick_advanced_false' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-handler-no-target', 0, ['pgroup' => 999, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'test-no-target';
                try {
                    $result = obl_command_handler_map_navigate([], $player);
                    test_assert($result['ok'], 'no_target returns ok=true (structured result, not error)');
                    test_same(false, $result['data']['tick_advanced'], 'tick_advanced=false (no tick consumed)');
                    test_same('no_target', $result['data']['navigation']['outcome'], 'outcome=no_target');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },

            'handler_target_invalid_returns_tick_advanced_false' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-handler-invalid', 0, ['pgroup' => 1, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'test-target-invalid';
                try {
                    $result = obl_command_handler_map_navigate(['target' => 999], $player);
                    test_assert($result['ok'], 'target_invalid returns ok=true');
                    test_same(false, $result['data']['tick_advanced'], 'tick_advanced=false (no tick consumed)');
                    test_same('interrupted', $result['data']['navigation']['outcome'], 'outcome=interrupted');
                    test_same('target_invalid', $result['data']['navigation']['outcome_reason'], 'reason=target_invalid');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },

            'handler_arrived_returns_tick_advanced_false' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-handler-arrived', 0, ['pgroup' => 1, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'test-arrived';
                try {
                    $result = obl_command_handler_map_navigate(['target' => 1], $player);
                    test_assert($result['ok'], 'arrived returns ok=true');
                    test_same(false, $result['data']['tick_advanced'], 'tick_advanced=false (no tick consumed)');
                    test_same('arrived', $result['data']['navigation']['outcome'], 'outcome=arrived');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },

            'handler_no_sp_at_start_returns_error_without_tick' => static function () use ($room): void {
                // 设计案 §6.6：NO_SP 在"无法启动"时 ok=false, code=NO_SP（不消耗 tick）
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['move_sp_cost' => 10];
                try {
                    // sp=5 < move_sp_cost=10，且需要一个有效目标避免先在 begin 阶段 finished
                    $player = $room->player('nav-no-sp', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 5, 'msp' => 100]);
                    $GLOBALS['obl_command_operation_key'] = 'test-no-sp';
                    try {
                        $result = obl_command_handler_map_navigate(['target' => 2], $player);
                        test_assert(!$result['ok'], 'NO_SP must return ok=false');
                        test_same('NO_SP', $result['code'], 'code=NO_SP');
                    } finally {
                        unset($GLOBALS['obl_command_operation_key']);
                    }
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            'tick_advanced_flag_only_true_after_loop_advance' => static function (): void {
                // 结构性验证：tick_advanced 初始 false，仅在 handler L298 advance 后置 true
                // 通过源码审计确认 begin finished / move_failed / route_invalid 路径均不设置 true
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                // tick_advanced = true 仅在 advance_for_navigation_step 之后
                test_assert(strpos($handlerBody, '$tick_advanced = true;') !== false, 'tick_advanced set true after advance');
                // begin finished return 在 tick_advanced=true 之前
                $beginReturnPos = strpos($handlerBody, "if (!empty(\$navigation['finished']))");
                $advanceTruePos = strpos($handlerBody, '$tick_advanced = true;');
                test_assert($beginReturnPos !== false && $advanceTruePos !== false, 'both anchors found');
                test_assert($beginReturnPos < $advanceTruePos, 'begin-finished return path precedes tick advance (no tick on invalid action)');
                // 初始化 $tick_advanced = false 在循环前
                $initPos = strpos($handlerBody, '$tick_advanced = false;');
                test_assert($initPos !== false && $initPos < $advanceTruePos, 'tick_advanced initialized false before loop');
            },
        ]),

        test_run_cases('idempotency_contract', [
            // M-B-Module §三.4 / B3-Consistency §三.6：幂等协议
            // operation_key 用作 navigation_id 标识；文件锁阻塞同一玩家并发请求
            'operation_key_used_as_navigation_id' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-opkey', 0, ['pgroup' => 999, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'req-abc-123';
                try {
                    $result = obl_command_handler_map_navigate([], $player);
                    test_same('req-abc-123', $result['data']['navigation']['navigation_id'], 'navigation_id equals operation_key');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },

            'different_operation_key_yields_different_navigation_id' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nav-opkey2', 0, ['pgroup' => 999, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'req-first';
                $r1 = obl_command_handler_map_navigate([], $player);
                $GLOBALS['obl_command_operation_key'] = 'req-second';
                $r2 = obl_command_handler_map_navigate([], $player);
                unset($GLOBALS['obl_command_operation_key']);
                test_same('req-first', $r1['data']['navigation']['navigation_id'], 'first navigation_id');
                test_same('req-second', $r2['data']['navigation']['navigation_id'], 'second navigation_id differs');
            },

            'file_lock_blocks_concurrent_same_player' => static function (): void {
                // 设计案 §3.2 / B-6 文件锁：同一玩家并发请求被阻塞返回 COMMAND_IN_PROGRESS
                // 通过源码审计确认 bus 中 acquire_lock 在 dispatch 之前
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_bus.php');
                $lockPos = strpos($source, 'obl_command_acquire_lock(');
                $dispatchPos = strpos($source, 'obl_command_handler_dispatch(');
                test_assert($lockPos !== false && $dispatchPos !== false, 'lock and dispatch both present');
                test_assert($lockPos < $dispatchPos, 'lock acquired before dispatch (concurrent same-player requests blocked)');
                // COMMAND_IN_PROGRESS 错误码存在
                test_assert(strpos($source, "'COMMAND_IN_PROGRESS'") !== false, 'COMMAND_IN_PROGRESS error code present');
            },

            'explored_write_is_idempotent' => static function (): void {
                // 设计案 §4.6：obl_mark_explored 用 WHERE discovered=0 保证幂等
                // 重复标记同一格不会重复触发（SQL 幂等）
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/info_acquire.func.php');
                test_assert(strpos($source, 'function obl_mark_explored') !== false, 'obl_mark_explored exists');
                // 验证使用幂等 SQL（ON DUPLICATE KEY UPDATE 或 WHERE discovered=0）
                $funcStart = strpos($source, 'function obl_mark_explored');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(
                    strpos($funcBody, 'ON DUPLICATE KEY UPDATE') !== false
                    || strpos($funcBody, "discovered=0") !== false
                    || strpos($funcBody, "discovered = 0") !== false,
                    'obl_mark_explored uses idempotent SQL (ON DUPLICATE KEY or WHERE discovered=0)'
                );
            },
        ]),

        test_run_cases('explore_degraded_wait', [
            // M-B-Module §三.5 / F-E1-Nav §5.4：探索降级等待
            'explore_degrades_to_wait_when_sp_insufficient' => static function () use ($room): void {
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['explore_sp_cost' => 10];
                try {
                    $player = $room->player('explore-degrade', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 5, 'msp' => 100]);
                    $result = obl_explore($player);
                    test_same('degraded_wait', $result['explore_outcome'], 'explore_outcome=degraded_wait');
                    test_same('no_sp', $result['reason'], 'reason=no_sp');
                    test_same(null, $result['info_result'], 'info_result=null (no exploration performed)');
                    // 降级不消耗探索体力（§5.6）；DB 取回的 sp 是字符串，转 int 比较
                    test_same(5, (int)$player['sp'], 'sp unchanged (degraded wait does not consume explore sp)');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            'explore_degraded_wait_emits_wait_log' => static function () use ($room): void {
                global $obl_log;
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['explore_sp_cost' => 10];
                try {
                    $player = $room->player('explore-log', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 5, 'msp' => 100]);
                    obl_explore($player);
                    $entries = $obl_log->getEntries();
                    $ids = array_column($entries, 'id');
                    test_assert(in_array('wait.success', $ids, true), 'wait.success log emitted');
                    test_assert(in_array('explore.degraded_to_wait', $ids, true), 'explore.degraded_to_wait log emitted');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            'explore_handler_injects_outcome_into_response' => static function (): void {
                // map.explore handler 通过 dispatch['data']['explore_outcome'] 注入响应
                // bus L99-104 将 dispatch data merge 到 response_data
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $exploreCase = strpos($source, "case 'map.explore':");
                $nextCase = strpos($source, 'case ', $exploreCase + 1);
                $block = substr($source, $exploreCase, $nextCase - $exploreCase);
                test_assert(strpos($block, 'explore_outcome') !== false, 'explore handler returns explore_outcome in data');
                test_assert(strpos($block, 'obl_explore') !== false, 'explore handler calls obl_explore');
            },
        ]),

        test_run_cases('infrastructure_exception_isolation', [
            // M-B-Module §三.6 / B3-Consistency §三.2：基础设施异常 ≠ 游戏规则中断
            'each_atomic_move_persists_independently' => static function (): void {
                // 设计案 §4.1 方案 A：每原子移动原子提交
                // advance_for_navigation_step 内部调用 obl_tick_orchestrator_persist 保证不回滚
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_advance_for_navigation_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_tick_advance') !== false, 'advances tick');
                test_assert(strpos($funcBody, 'obl_tick_orchestrator_persist') !== false, 'persists atomically (no rollback of completed moves)');
            },

            'bus_rethrows_infrastructure_exception_not_as_game_rule' => static function (): void {
                // bus L123-131：Throwable 捕获后重新抛出，不伪装成游戏规则中断
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_bus.php');
                test_assert(strpos($source, 'catch (Throwable $e)') !== false, 'bus catches Throwable');
                test_assert(strpos($source, 'throw $e;') !== false, 'bus rethrows infrastructure exception');
            },

            'bus_finally_releases_lock_on_exception' => static function (): void {
                // finally 块保证锁释放，避免异常导致死锁
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_bus.php');
                test_assert(strpos($source, 'finally {') !== false, 'bus has finally block');
                test_assert(strpos($source, 'obl_command_release_lock') !== false, 'bus releases lock in finally');
            },

            'finalize_after_internal_advances_skips_tick_advance' => static function (): void {
                // internal_tick_advances=true 时，finalize_after_internal_advances 不推进 tick
                // （tick 推进已在 handler 内逐次完成），仅做最终保存
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_tick_orchestrator.php');
                $funcStart = strpos($source, 'function obl_tick_orchestrator_finalize_after_internal_advances');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, "obl_save_player") !== false, 'finalize saves player data');
                // 代码用 $status['advanced'] = false 赋值形式（非数组字面量）
                test_assert(strpos($funcBody, "['advanced'] = false") !== false, 'finalize reports advanced=false');
                test_assert(strpos($funcBody, "['internal_tick_advances'] = true") !== false, 'finalize marks internal_tick_advances=true');
                // 不调用 obl_tick_advance（已由 handler 内循环推进）
                test_assert(strpos($funcBody, 'obl_tick_advance(') === false, 'finalize does NOT advance tick (already done in handler loop)');
            },
        ])
    );
};
