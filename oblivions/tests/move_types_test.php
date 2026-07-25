<?php
declare(strict_types=1);

/**
 * 子任务 2B.2：移动方式与轨迹拦截框架测试
 *
 * 覆盖 F-E2-Move 设计案验收要点：
 *   1. 普通移动遇到墙体/连接阻挡时改路或失败
 *   2. 玩家点选移动范围内格直接精确移动（不受一格步幅限制）
 *   3. 玩家点选迷雾格作为导航锚点（系统寻找附近合法落点）
 *   4. 移动方式注册表可扩展性（新增配置不破坏现有逻辑）
 *   5. 轨迹拦截接口存在但首期不触发
 *   6. 信息获取空间足迹：普通移动合并路径沿途观察范围
 *   7. 目标超出范围 → 远程导航（现有 obl_navigation_begin 已支持，验证）
 *
 * 依赖 region_1.php 图格数据：
 *   tile 1:  passable=true,  neighbors=[24,17,5,4]
 *   tile 2:  passable=true,  neighbors=[23,4,22,21,26]
 *   tile 4:  passable=true,  neighbors=[27,28,29,23,5,1,2]
 *   tile 5:  passable=false（背景墙"高耸的废铁山"）, neighbors=[28,29,30,1,4]
 *
 * @module E 游戏逻辑
 * @framework E-13 移动方式与轨迹拦截框架
 */

return static function (TestRoom $room): array {
    // 辅助：动态查找距离 > move_power（3）的格作为"超出范围"目标
    $findFarTile = static function (): ?int {
        for ($t = 2; $t <= 60; $t++) {
            $d = obl_get_distance(1, 1, $t);
            if ($d > 3) return $t;
        }
        return null;
    };

    return array_merge(
        // ================================================================
        // 1. 移动方式注册表基础
        // ================================================================
        test_run_cases('move_types_registry', [

            'normal_move_type_exists_and_enabled' => static function (): void {
                $types = obl_move_types();
                test_assert(isset($types['normal']), 'normal move type registered');
                test_assert(!empty($types['normal']['enabled']), 'normal is enabled');
                test_same('walk', $types['normal']['presentation_type'], 'normal presentation=walk');
                test_same('bfs', $types['normal']['distance_calc'], 'normal distance_calc=bfs');
                test_same(true, !empty($types['normal']['requires_real_path']), 'normal requires real path');
                test_same(true, !empty($types['normal']['trajectory_interceptable']), 'normal trajectory interceptable');
                test_same('merge_path_observation', $types['normal']['info_footprint'], 'normal info footprint=merge_path_observation');
            },

            'reserved_slots_present_but_disabled' => static function (): void {
                $types = obl_move_types();
                // 预留槽位存在但首期不启用
                foreach (['fly', 'jump', 'teleport'] as $reserved) {
                    test_assert(isset($types[$reserved]), "{$reserved} slot reserved");
                    test_assert(empty($types[$reserved]['enabled']), "{$reserved} disabled in first phase");
                }
                // 各预留槽位的 7 项属性齐全
                foreach (['fly', 'jump', 'teleport'] as $reserved) {
                    $cfg = $types[$reserved];
                    foreach (['label', 'max_range', 'distance_calc', 'requires_real_path',
                             'blocking', 'landing_rules', 'trajectory_interceptable',
                             'info_footprint', 'presentation_type'] as $field) {
                        test_assert(array_key_exists($field, $cfg), "{$reserved} has field {$field}");
                    }
                }
                // 传送特殊语义：轨迹不可拦截 + 只用最终落点观察
                test_same(false, !empty($types['teleport']['trajectory_interceptable']), 'teleport not interceptable');
                test_same('landing_only', $types['teleport']['info_footprint'], 'teleport info footprint=landing_only');
                test_same('none', $types['teleport']['distance_calc'], 'teleport distance_calc=none');
            },

            'default_id_is_normal' => static function (): void {
                test_same('normal', obl_move_type_default_id(), 'default move type id=normal');
            },

            'unknown_type_falls_back_to_normal' => static function (): void {
                $cfg = obl_move_type_get('nonexistent_type');
                test_same('普通移动', $cfg['label'], 'unknown type falls back to normal config');
                test_same('walk', $cfg['presentation_type'], 'fallback config is normal');
            },

            'is_enabled_correct_for_all_types' => static function (): void {
                test_same(true, obl_move_type_is_enabled('normal'), 'normal enabled');
                test_same(false, obl_move_type_is_enabled('fly'), 'fly disabled');
                test_same(false, obl_move_type_is_enabled('jump'), 'jump disabled');
                test_same(false, obl_move_type_is_enabled('teleport'), 'teleport disabled');
            },
        ]),

        // ================================================================
        // 2. 普通移动遇墙体阻挡时改路或失败
        // ================================================================
        test_run_cases('move_types_blocking', [

            'find_path_reroutes_around_impassable_wall' => static function () use ($room): void {
                // tile 1 → tile 2：tile 5 是不可通行墙（neighbors of 1 含 5），
                // BFS 必须绕开 tile 5，经由 tile 4 到达 tile 2
                $room->resetData();
                $player = $room->player('reroute-actor', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = obl_move_type_find_path('normal', 1, 1, 2, $player);
                test_assert($path !== null, 'path found from 1 to 2');
                test_same(1, (int)$path[0], 'path starts at 1');
                test_same(2, (int)end($path), 'path ends at 2');
                // 路径不得包含不可通行的 tile 5（中间节点）
                test_assert(!in_array(5, $path, true), 'path reroutes around impassable tile 5');
                // 路径经由 tile 4（绕行）
                test_assert(in_array(4, $path, true), 'path goes through tile 4 (reroute)');
                // 路径长度 = 2（1→4→2）
                test_same(3, count($path), 'path has 3 nodes [1,4,2]');
            },

            'perform_move_core_blocked_by_impassable_wall' => static function () use ($room): void {
                // 直接移动到不可通行格 → 失败
                $room->resetData();
                $player = $room->player('blocked-actor', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_perform_move_core($player, 5, 3);
                test_assert(empty($result['success']), 'move to impassable tile fails');
                test_same('blocked', $result['reason'], 'reason=blocked');
                test_same(1, (int)$player['pls'], 'player stays at tile 1');
            },

            'check_landing_rejects_impassable_tile' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('landing-check', 0, ['pgroup' => 1, 'pls' => 1]);
                $check = obl_move_type_check_landing('normal', 1, 5, $player, (int)$player['pid']);
                test_assert(empty($check['legal']), 'impassable tile not legal landing');
                test_same('blocked', $check['reason'], 'reason=blocked');
            },

            'check_landing_rejects_occupied_tile' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('landing-self', 0, ['pgroup' => 1, 'pls' => 1]);
                $occupier = $room->player('landing-occupier', 0, ['pgroup' => 1, 'pls' => 4]);
                $check = obl_move_type_check_landing('normal', 1, 4, $player, (int)$player['pid']);
                test_assert(empty($check['legal']), 'occupied tile not legal landing');
                test_same('occupied', $check['reason'], 'reason=occupied');
            },

            'check_landing_accepts_passable_unoccupied_tile' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('landing-ok', 0, ['pgroup' => 1, 'pls' => 1]);
                $check = obl_move_type_check_landing('normal', 1, 4, $player, (int)$player['pid']);
                test_assert(!empty($check['legal']), 'passable unoccupied tile is legal');
                test_same('ok', $check['reason'], 'reason=ok');
            },

            'find_path_to_unreachable_returns_null' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('unreachable-actor', 0, ['pgroup' => 1, 'pls' => 1]);
                // 不存在的格 → 路径不可达
                $path = obl_move_type_find_path('normal', 1, 1, 9999, $player);
                test_same(null, $path, 'path to nonexistent tile is null');
            },

            'move_type_execute_fails_on_impassable_target' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('exec-blocked', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_move_type_execute('normal', $player, 5);
                test_assert(empty($result['success']), 'execute to impassable tile fails');
                // obl_perform_move_core 会返回 blocked
                test_assert($result['reason'] === 'blocked' || $result['reason'] === 'too_far', 'fails with blocked or too_far');
                test_same(1, (int)$player['pls'], 'player stays at tile 1');
            },
        ]),

        // ================================================================
        // 3. 玩家点选移动范围内格直接精确移动
        // ================================================================
        test_run_cases('move_types_direct_precise', [

            'target_in_range_identified' => static function () use ($room): void {
                // tile 2 距离 tile 1 为 2（经 tile 4），move_power=3 → 在范围内
                $room->resetData();
                $player = $room->player('inrange-check', 0, ['pgroup' => 1, 'pls' => 1]);
                $in_range = obl_move_type_is_target_in_range('normal', 1, 1, 2, $player);
                test_same(true, $in_range, 'tile 2 is in range of tile 1 (distance 2 <= move_power 3)');
            },

            'direct_precise_move_single_atomic_operation' => static function () use ($room): void {
                // 玩家点选 tile 2（距离 2，在范围内）→ 单次原子移动直达
                // 不受"一格步幅"限制：不是 1→4→2 两次移动，而是一次 obl_perform_move_core
                $room->resetData();
                $player = $room->player('direct-move', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_move_type_execute('normal', $player, 2);
                test_assert(!empty($result['success']), 'direct precise move succeeds');
                test_same(2, (int)$player['pls'], 'player arrived at tile 2');
                test_same(2, $result['distance'], 'distance=2 (multi-cell single move)');
                // 路径记录 [1, 4, 2]
                test_same(3, count($result['path']), 'path has 3 nodes');
                test_same(1, (int)$result['path'][0], 'path starts at 1');
                test_same(2, (int)end($result['path']), 'path ends at 2');
                // 未被拦截
                test_same(false, $result['intercepted'], 'not intercepted (first phase)');
            },

            'direct_neighbor_move_distance_1' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('neighbor-move', 0, ['pgroup' => 1, 'pls' => 1]);
                // tile 4 是 tile 1 的直连邻居，距离 1
                $result = obl_move_type_execute('normal', $player, 4);
                test_assert(!empty($result['success']), 'direct neighbor move succeeds');
                test_same(4, (int)$player['pls'], 'player at tile 4');
                test_same(1, $result['distance'], 'distance=1');
            },

            'max_range_uses_actor_move_power' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('range-power', 0, ['pgroup' => 1, 'pls' => 1]);
                // normal 的 max_range=null → 使用 obl_get_move_power($pdata)=3
                $max_range = obl_move_type_calc_max_range('normal', $player);
                test_same(3, $max_range, 'normal max_range = move_power = 3');
            },
        ]),

        // ================================================================
        // 4. 目标超出范围 → 远程导航 + 迷雾格作为导航锚点
        // ================================================================
        test_run_cases('move_types_remote_and_fog', [

            'out_of_range_target_identified' => static function () use ($room, $findFarTile): void {
                $room->resetData();
                $player = $room->player('out-range', 0, ['pgroup' => 1, 'pls' => 1]);
                $far_tile = $findFarTile();
                test_assert($far_tile !== null, 'found a far tile (distance > move_power)');
                // 框架正确识别超出范围
                $in_range = obl_move_type_is_target_in_range('normal', 1, 1, $far_tile, $player);
                test_same(false, $in_range, 'far tile is out of range');
            },

            'navigation_begin_accepts_out_of_range_target' => static function () use ($room, $findFarTile): void {
                // 验证现有 obl_navigation_begin 支持超出范围的目标 → 创建远程导航
                $room->resetData();
                $player = $room->player('remote-nav', 0, ['pgroup' => 1, 'pls' => 1]);
                $far_tile = $findFarTile();
                test_assert($far_tile !== null, 'far tile exists for remote nav test');
                $nav = obl_navigation_begin(['target' => $far_tile], $player);
                test_same($far_tile, (int)$nav['target_pls'], 'navigation accepts out-of-range target');
                test_same(false, !empty($nav['finished']), 'navigation not immediately finished (remote nav created)');
                test_same(false, $nav['target_is_auto'], 'target is player-specified');
            },

            'navigation_begin_accepts_impassable_fog_tile_as_anchor' => static function () use ($room): void {
                // 不可通行迷雾格保留为请求锚点，寻路目标解析为附近合法落点。
                $room->resetData();
                $player = $room->player('fog-anchor', 0, ['pgroup' => 1, 'pls' => 1]);
                $nav = obl_navigation_begin(['target' => 5], $player);
                test_same(5, (int)$nav['requested_target_pls'], 'navigation preserves impassable fog tile 5 as requested anchor');
                test_assert((int)$nav['target_pls'] !== 5, 'navigation resolves impassable anchor to a legal landing');
                test_same(['impassable'], $nav['target_adjustment']['reasons'], 'navigation reports why anchor was adjusted');
                test_same(false, $nav['target_is_auto'], 'target is player-specified');
            },

            'resolve_landing_finds_nearby_legal_for_impassable_fog' => static function () use ($room): void {
                // 玩家点选不可落脚的迷雾格（tile 5）→ 系统寻找附近合法落点
                $room->resetData();
                // 玩家放在 tile 2（非 tile 5 的直接邻居），避免 resolve_landing 返回玩家自身格
                $player = $room->player('fog-resolve', 0, ['pgroup' => 1, 'pls' => 2]);
                $result = obl_move_type_resolve_landing('normal', 1, 5, $player);
                test_assert(!empty($result['landing_pls']), 'found a nearby legal landing');
                test_same(true, $result['resolved'], 'resolved=true (landing != original target)');
                test_same('nearby_legal', $result['reason'], 'reason=nearby_legal');
                $landing = (int)$result['landing_pls'];
                test_assert($landing !== 5, 'landing is not the impassable target');
                // 落点必须是可通行的
                $map = obl_get_map_data(1);
                test_assert(!empty($map['tiles'][1][$landing]['passable']), 'landing tile is passable');
            },

            'resolve_landing_returns_target_when_already_legal' => static function () use ($room): void {
                // 目标本身可落脚 → 直接返回目标，不寻找附近
                $room->resetData();
                $player = $room->player('fog-ok', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_move_type_resolve_landing('normal', 1, 4, $player);
                test_same(4, (int)$result['landing_pls'], 'landing = target (already legal)');
                test_same(false, $result['resolved'], 'resolved=false');
                test_same('ok', $result['reason'], 'reason=ok');
            },
        ]),

        // ================================================================
        // 5. 移动方式注册表可扩展性
        // ================================================================
        test_run_cases('move_types_extensibility', [

            'add_custom_move_type_via_config_override' => static function (): void {
                // 通过配置覆盖新增一种移动方式，不破坏现有 normal
                $GLOBALS['obl_test_config_override'] = [
                    'move_types' => [
                        'normal' => [
                            'label' => '普通移动', 'enabled' => true,
                            'max_range' => null, 'distance_calc' => 'bfs',
                            'requires_real_path' => true,
                            'blocking' => ['impassable_tiles', 'occupied_tiles'],
                            'landing_rules' => ['passable', 'unoccupied'],
                            'trajectory_interceptable' => true,
                            'info_footprint' => 'merge_path_observation',
                            'presentation_type' => 'walk',
                        ],
                        // 新增自定义移动方式（测试可扩展性）
                        'custom_test' => [
                            'label' => '测试位移', 'enabled' => true,
                            'max_range' => 5, 'distance_calc' => 'bfs',
                            'requires_real_path' => false,
                            'blocking' => [],
                            'landing_rules' => ['passable'],
                            'trajectory_interceptable' => false,
                            'info_footprint' => 'landing_only',
                            'presentation_type' => 'custom_effect',
                        ],
                    ],
                ];
                try {
                    $types = obl_move_types();
                    test_assert(isset($types['normal']), 'normal still present after override');
                    test_assert(isset($types['custom_test']), 'custom_test type registered');
                    test_same('walk', $types['normal']['presentation_type'], 'normal config intact');
                    $custom = obl_move_type_get('custom_test');
                    test_same('测试位移', $custom['label'], 'custom label');
                    test_same(5, $custom['max_range'], 'custom max_range=5');
                    test_same('custom_effect', $custom['presentation_type'], 'custom presentation');
                    test_same(false, !empty($custom['requires_real_path']), 'custom does not require real path');
                    test_same(true, obl_move_type_is_enabled('custom_test'), 'custom enabled');
                    // normal 仍然可用
                    test_same(true, obl_move_type_is_enabled('normal'), 'normal still enabled');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            'custom_max_range_overrides_move_power' => static function (): void {
                // 自定义移动方式的 max_range=5 不依赖 move_power
                $GLOBALS['obl_test_config_override'] = [
                    'move_types' => [
                        'normal' => [
                            'label' => '普通移动', 'enabled' => true,
                            'max_range' => null, 'distance_calc' => 'bfs',
                            'requires_real_path' => true,
                            'blocking' => ['impassable_tiles', 'occupied_tiles'],
                            'landing_rules' => ['passable', 'unoccupied'],
                            'trajectory_interceptable' => true,
                            'info_footprint' => 'merge_path_observation',
                            'presentation_type' => 'walk',
                        ],
                        'custom_range' => [
                            'label' => '定程位移', 'enabled' => true,
                            'max_range' => 5, 'distance_calc' => 'bfs',
                            'requires_real_path' => false,
                            'blocking' => [],
                            'landing_rules' => ['passable'],
                            'trajectory_interceptable' => false,
                            'info_footprint' => 'landing_only',
                            'presentation_type' => 'custom',
                        ],
                    ],
                ];
                try {
                    $dummy = ['pid' => 0];
                    test_same(3, obl_move_type_calc_max_range('normal', $dummy), 'normal uses move_power=3');
                    test_same(5, obl_move_type_calc_max_range('custom_range', $dummy), 'custom uses max_range=5');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },
        ]),

        // ================================================================
        // 6. 轨迹拦截接口（首期不触发）
        // ================================================================
        test_run_cases('move_types_trajectory_intercept', [

            'intercept_rules_empty_in_first_phase' => static function (): void {
                obl_trajectory_intercept_clear_rules();
                $rules = obl_trajectory_intercept_rules();
                test_same([], $rules, 'no intercept rules registered in first phase');
            },

            'intercept_check_returns_not_intercepted_for_normal' => static function () use ($room): void {
                $room->resetData();
                obl_trajectory_intercept_clear_rules();
                $player = $room->player('intercept-noop', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = [1, 4, 2];
                $result = obl_trajectory_intercept_check('normal', 1, 1, 2, $path, $player);
                test_same(false, $result['intercepted'], 'not intercepted (no rules)');
                test_same(2, $result['landing_pls'], 'landing = original target');
                test_same(null, $result['intercept_at'], 'no intercept position');
                test_same(null, $result['rule_id'], 'no rule id');
                test_same(null, $result['event'], 'no event');
            },

            'intercept_check_skipped_for_non_interceptable_type' => static function () use ($room): void {
                // 传送（teleport）trajectory_interceptable=false → 即使有规则也不拦截
                $room->resetData();
                $player = $room->player('intercept-teleport', 0, ['pgroup' => 1, 'pls' => 1]);
                // 临时注册一个会拦截的规则
                obl_trajectory_intercept_register_rule('test_force_intercept', 0, static function (): array {
                    return ['intercept_at' => 4, 'event' => 'test_event'];
                });
                try {
                    $path = [1, 4, 2];
                    $result = obl_trajectory_intercept_check('teleport', 1, 1, 2, $path, $player);
                    test_same(false, $result['intercepted'], 'teleport not intercepted even with rules');
                    test_same(2, $result['landing_pls'], 'teleport landing = original target');
                } finally {
                    obl_trajectory_intercept_clear_rules();
                }
            },

            'intercept_register_and_trigger_extension_point' => static function () use ($room): void {
                // 验证拦截接口扩展点：注册规则后能触发拦截改写落点
                $room->resetData();
                $player = $room->player('intercept-trigger', 0, ['pgroup' => 1, 'pls' => 1]);
                obl_trajectory_intercept_register_rule(
                    'test_ambush_at_4',
                    10,
                    static function (int $pgroup, int $from, int $to, array $path, array &$pdata): ?array {
                        // 模拟在 tile 4 拦截
                        if (in_array(4, $path, true)) {
                            return ['intercept_at' => 4, 'event' => 'ambush'];
                        }
                        return null;
                    }
                );
                try {
                    $path = [1, 4, 2];
                    $result = obl_trajectory_intercept_check('normal', 1, 1, 2, $path, $player);
                    test_same(true, $result['intercepted'], 'intercept triggered at tile 4');
                    test_same(4, $result['landing_pls'], 'landing rewritten to intercept position 4');
                    test_same(4, $result['intercept_at'], 'intercept_at=4');
                    test_same('test_ambush_at_4', $result['rule_id'], 'rule_id recorded');
                    test_same('ambush', $result['event'], 'event recorded');
                } finally {
                    obl_trajectory_intercept_clear_rules();
                }
            },

            'intercept_priority_ordering' => static function () use ($room): void {
                // priority 数值越小越先判定
                $room->resetData();
                $player = $room->player('intercept-priority', 0, ['pgroup' => 1, 'pls' => 1]);
                obl_trajectory_intercept_register_rule('low_priority', 100, static function (): ?array {
                    return ['intercept_at' => 99, 'event' => 'low'];
                });
                obl_trajectory_intercept_register_rule('high_priority', 1, static function (): ?array {
                    return ['intercept_at' => 4, 'event' => 'high'];
                });
                try {
                    $path = [1, 4, 2];
                    $result = obl_trajectory_intercept_check('normal', 1, 1, 2, $path, $player);
                    test_same(true, $result['intercepted'], 'intercept triggered');
                    test_same('high_priority', $result['rule_id'], 'high priority rule fires first');
                    test_same(4, $result['intercept_at'], 'high priority intercept position');
                } finally {
                    obl_trajectory_intercept_clear_rules();
                }
            },

            'execute_with_intercept_rewrites_landing' => static function () use ($room): void {
                // 端到端：obl_move_type_execute 在拦截发生时改写落点
                $room->resetData();
                $player = $room->player('exec-intercept', 0, ['pgroup' => 1, 'pls' => 1]);
                obl_trajectory_intercept_register_rule('intercept_at_4', 10, static function (int $pgroup, int $from, int $to, array $path, array &$pdata): ?array {
                    if (in_array(4, $path, true)) {
                        return ['intercept_at' => 4, 'event' => 'ambush_at_4'];
                    }
                    return null;
                });
                try {
                    // 计划移动到 tile 2，但路径在 tile 4 被拦截 → 落点改写为 tile 4
                    $result = obl_move_type_execute('normal', $player, 2);
                    test_same(true, $result['intercepted'], 'execute reports intercepted');
                    test_same(4, (int)$player['pls'], 'player landed at intercept position 4');
                    test_same(4, $result['landing_pls'], 'landing_pls=4 (intercept position)');
                    test_same('intercept_at_4', $result['rule_id'], 'rule_id recorded');
                    test_same(1, $result['distance'], 'distance=1 (from 1 to intercept at 4)');
                } finally {
                    obl_trajectory_intercept_clear_rules();
                }
            },
        ]),

        // ================================================================
        // 7. 信息获取空间足迹
        // ================================================================
        test_run_cases('move_types_info_footprint', [

            'normal_merges_path_observation' => static function () use ($room): void {
                // 普通移动：合并路径 [1,4,2] 沿途观察范围
                $room->resetData();
                $player = $room->player('footprint-merge', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = [1, 4, 2];
                $footprint = obl_move_type_calc_info_footprint('normal', 1, $path, $player);
                // 包含路径起点 tile 1 的视野（含 tile 24，仅 tile 1 可见）
                test_assert(isset($footprint[24]), 'footprint includes tile 24 (visible only from tile 1)');
                // 包含路径中间 tile 4 的视野（含 tile 27，仅 tile 4 可见）
                test_assert(isset($footprint[27]), 'footprint includes tile 27 (visible only from tile 4)');
                // 包含路径终点 tile 2 的视野（含 tile 22，仅 tile 2 可见）
                test_assert(isset($footprint[22]), 'footprint includes tile 22 (visible only from tile 2)');
                // 包含路径本身
                test_assert(isset($footprint[1]), 'footprint includes tile 1');
                test_assert(isset($footprint[4]), 'footprint includes tile 4');
                test_assert(isset($footprint[2]), 'footprint includes tile 2');
            },

            'normal_footprint_larger_than_single_tile_vision' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('footprint-size', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = [1, 4, 2];
                $footprint = obl_move_type_calc_info_footprint('normal', 1, $path, $player);
                // 单格视野
                include_once GAME_ROOT . './oblivions/include/game/vision.func.php';
                $single = obl_calc_vision_range(1, 1, $player);
                test_assert(count($footprint) > count($single), 'merged footprint larger than single tile vision');
            },

            'normal_footprint_single_tile_path' => static function () use ($room): void {
                // 路径仅 1 格 → 足迹 = 该格视野
                $room->resetData();
                $player = $room->player('footprint-single', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = [1];
                $footprint = obl_move_type_calc_info_footprint('normal', 1, $path, $player);
                include_once GAME_ROOT . './oblivions/include/game/vision.func.php';
                $single = obl_calc_vision_range(1, 1, $player);
                test_same(count($single), count($footprint), 'single-tile path footprint = single vision');
            },

            'teleport_landing_only_footprint' => static function () use ($room): void {
                // 传送模式：只使用最终落点的观察范围
                $room->resetData();
                $player = $room->player('footprint-teleport', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = [1, 4, 2];
                $footprint = obl_move_type_calc_info_footprint('teleport', 1, $path, $player);
                include_once GAME_ROOT . './oblivions/include/game/vision.func.php';
                $landing_vision = obl_calc_vision_range(1, 2, $player);
                // 只含最终落点 tile 2 的视野，不含 tile 1/tile 4 独有的可见格
                test_same(count($landing_vision), count($footprint), 'teleport footprint = landing-only vision');
                // 不含 tile 24（仅 tile 1 可见，teleport 不合并路径）
                test_assert(!isset($footprint[24]), 'teleport does not include path-only visible tiles');
                // 含 tile 2 自身
                test_assert(isset($footprint[2]), 'teleport includes landing tile');
            },

            'info_footprint_does_not_mark_explored' => static function () use ($room): void {
                // 信息足迹只是候选观察范围，不写 explored（§4.6：仅落点写 explored）
                $room->resetData();
                $player = $room->player('footprint-noexplored', 0, ['pgroup' => 1, 'pls' => 1]);
                $path = [1, 4, 2];
                $footprint = obl_move_type_calc_info_footprint('normal', 1, $path, $player);
                // 验证 oblmapstates 中间格 tile 4 未被标记 explored（仅落点才写）
                global $db, $tablepre;
                $result = $db->query("SELECT explored FROM {$tablepre}oblmapstates WHERE pgroup=1 AND pls=4 LIMIT 1");
                $row = $db->fetch_array($result);
                $explored_4 = $row ? (int)$row['explored'] : 0;
                test_same(0, $explored_4, 'path intermediate tile 4 not marked explored by footprint calc');
            },
        ]),

        // ================================================================
        // 8. 不变量校验：纯净基础操作契约 + 轨迹经过不触发中间格事件
        // ================================================================
        test_run_cases('move_types_invariants', [

            'execute_does_not_write_db_or_log' => static function () use ($room): void {
                // obl_move_type_execute 保持 E-3 纯净基础操作契约：
                // 不写库、不写日志、不触发钩子（仅修改 $pdata['pls']）
                $room->resetData();
                $player = $room->player('pure-exec', 0, ['pgroup' => 1, 'pls' => 1]);
                global $obl_log;
                $log_before = $obl_log ? count($obl_log->getEntries()) : 0;
                $result = obl_move_type_execute('normal', $player, 4);
                test_assert(!empty($result['success']), 'execute succeeded');
                $log_after = $obl_log ? count($obl_log->getEntries()) : 0;
                test_same($log_before, $log_after, 'no log entries written by execute');
            },

            'trajectory_pass_does_not_trigger_intermediate_events' => static function () use ($room): void {
                // 不变量 #4：轨迹经过不触发中间格事件
                // 普通移动 1→4→2，中间格 tile 4 不形成权威位置、不触发落点规则
                // 验证：路径中间格的 explored 未被 obl_move_type_execute 写入
                $room->resetData();
                $player = $room->player('no-intermediate', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_move_type_execute('normal', $player, 2);
                test_assert(!empty($result['success']), 'move succeeded to tile 2');
                test_same(2, (int)$player['pls'], 'player at tile 2');
                // 中间格 tile 4 的 explored 应为 0（execute 不写 explored）
                global $db, $tablepre;
                $res = $db->query("SELECT explored FROM {$tablepre}oblmapstates WHERE pgroup=1 AND pls=4 LIMIT 1");
                $row = $db->fetch_array($res);
                $explored_4 = $row ? (int)$row['explored'] : 0;
                test_same(0, $explored_4, 'intermediate tile 4 not marked explored (trajectory passthrough)');
            },

            'source_audit_move_types_file_exists' => static function (): void {
                $path = GAME_ROOT . 'oblivions/include/game/move_types.func.php';
                test_assert(file_exists($path), 'move_types.func.php exists');
            },

            'source_audit_config_has_move_types' => static function (): void {
                $cfg = obl_get_config();
                test_assert(isset($cfg['move_types']) && is_array($cfg['move_types']), 'config has move_types section');
                test_assert(isset($cfg['move_types']['normal']), 'config has normal move type');
                test_assert(isset($cfg['move_types']['fly']), 'config has fly slot');
                test_assert(isset($cfg['move_types']['jump']), 'config has jump slot');
                test_assert(isset($cfg['move_types']['teleport']), 'config has teleport slot');
            },

            'source_audit_bootstrap_loads_move_types' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/core/obl_bootstrap.php');
                test_assert(strpos($source, 'move_types.func.php') !== false, 'bootstrap loads move_types.func.php');
            },
        ])
    );
};
