<?php
declare(strict_types=1);

/**
 * 子任务 2C.1：敌人发现与战斗边界测试
 *
 * 覆盖 F-E6-Combat 框架的关键不变量：
 *   - 敌人发现状态（discovered 字段语义）
 *   - 玩家先发现敌人（导航中断 + 合并发现 + 注意力等级）
 *   - 已发现敌人与自动导航（占位校验 + BFS 避让）
 *   - force_combat 中断（检测条件 + 优先级 + details 结构）
 *   - 战斗移动与区域位置（配置预留 + 不自动开战）
 *
 * 依赖 region_1.php 图格数据：
 *   tile 1: passable=true, neighbors=[24,17,5,4]
 *   tile 2: passable=true, neighbors=[23,4,22,21,26]
 *   tile 4: passable=true, neighbors=[27,28,29,23,5,1,2]
 *   tile 5: passable=false, neighbors=[28,29,30,1,4]
 *   tile 24: passable=true, neighbors=[17,18,25,1]
 *   tile 25: passable=true, neighbors=[24,20,18,19,26]
 *   tile 26: passable=true, neighbors=[22,21,20,25,2]
 *
 * 1→2 最短路径：1→4→2（2步）
 * 1→2 替代路线：1→24→25→26→2（4步，绕开 tile 4）
 *
 * @module E 游戏逻辑
 * @framework E-3 基于图的移动系统
 * @framework E-6 视野与感知系统
 */

return static function (TestRoom $room): array {
    return array_merge(
        // ================================================================
        // 1. 敌人发现状态单元测试
        // ================================================================
        test_run_cases('enemy_discovery_unit', [

            // --- discovered=1 表示当前在认知中 ---

            'discovered_one_means_in_cognition' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('disc-player', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建敌人 discovered=0
                $enemy = $room->player('disc-enemy', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 0]);
                test_same(0, (int)$enemy['discovered'], 'enemy initially undiscovered');

                // 发现敌人（玩家在 tile 1，敌人在 tile 4，距离 1，视野范围 3）
                obl_discover_enemies(1, 1, 3);

                // 验证 discovered=1（当前在认知中）
                $enemy_after = $room->fetch((int)$enemy['pid']);
                test_same(1, (int)$enemy_after['discovered'], 'enemy discovered=1 after discovery (in cognition)');
            },

            // --- 敌人离开视野后变回 0 ---

            'enemy_leaves_vision_becomes_undiscovered' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('disc-player2', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建敌人 discovered=1, pgroup=2（不同区域 = 离开视野）
                $enemy = $room->player('disc-enemy2', 1, ['pgroup' => 2, 'pls' => 1, 'discovered' => 1]);
                test_same(1, (int)$enemy['discovered'], 'enemy initially discovered');

                // 更新发现状态（敌人在不同区域 → 离开视野）
                obl_update_enemy_discovered($enemy, $player);

                // 验证 discovered=0（离开视野后变回 0）
                test_same(0, (int)$enemy['discovered'], 'enemy discovered=0 after leaving vision (different region)');
            },

            // --- 已死亡敌人保留发现状态 ---

            'dead_enemy_keeps_discovered_state' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('disc-player3', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建死亡敌人 discovered=1, state=1
                $enemy = $room->player('disc-enemy3', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 1, 'state' => 1]);
                test_same(1, (int)$enemy['discovered'], 'dead enemy initially discovered');

                // 更新发现状态（死亡敌人不更新）
                obl_update_enemy_discovered($enemy, $player);

                // 验证 discovered=1（死亡敌人保留发现状态，方便搜刮）
                test_same(1, (int)$enemy['discovered'], 'dead enemy keeps discovered=1');
            },

            // --- discovered=0 的敌人不被发现时不点亮 ---

            'undiscovered_enemy_stays_zero_outside_vision' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('disc-player4', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建敌人在视野外（tile 100 不存在，距离 -1）
                $enemy = $room->player('disc-enemy4', 1, ['pgroup' => 1, 'pls' => 100, 'discovered' => 0]);

                // 尝试发现敌人（玩家在 tile 1，敌人在 tile 100，不可达）
                obl_discover_enemies(1, 1, 3);

                // 验证 discovered=0（视野外的敌人不被发现）
                $enemy_after = $room->fetch((int)$enemy['pid']);
                test_same(0, (int)$enemy_after['discovered'], 'enemy outside vision stays undiscovered');
            },
        ]),

        // ================================================================
        // 2. 玩家先发现敌人
        // ================================================================
        test_run_cases('player_discovers_enemy', [

            // --- 导航中断（enemy_discovered）---

            'navigation_interrupts_on_enemy_discovered' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('pde-interrupt', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $info = ['enemies_discovered' => [['pid' => 99, 'name' => 'test_enemy']]];
                $result = obl_navigation_check_interrupt($nav, $player, $info);
                test_same('enemy_discovered', $result['reason'], 'enemy discovered triggers interrupt');
                test_same('interrupted', $nav['outcome'], 'outcome=interrupted');
                test_same('enemy_discovered', $nav['outcome_reason'], 'outcome_reason=enemy_discovered');
                test_same(true, $nav['finished'], 'navigation finished');
            },

            // --- 合并发现（同一次信息获取发现多个敌人）---

            'acquire_info_merges_multiple_enemies' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('pde-merge', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建两个敌人在视野内（tile 4 距离 1，tile 2 距离 2，视野范围 3）
                $enemy1 = $room->player('pde-enemy-a', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 0]);
                $enemy2 = $room->player('pde-enemy-b', 1, ['pgroup' => 1, 'pls' => 2, 'discovered' => 0]);

                // 调用 obl_acquire_information（move 配置）
                $config = obl_get_info_config('move');
                $info = obl_acquire_information(1, 1, $player, $config);

                // 验证 enemies_discovered 包含两个敌人（合并发现）
                test_same(2, count($info['enemies_discovered']), 'merged 2 enemies discovered in one acquire');
            },

            // --- 注意力等级为 important ---

            'attention_level_important_on_enemy_discovery' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('pde-attention', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建敌人在视野内
                $enemy = $room->player('pde-enemy-att', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 0]);

                // 调用 obl_acquire_information
                $config = obl_get_info_config('move');
                $info = obl_acquire_information(1, 1, $player, $config);

                // 验证 attention='important'（F-E4-Info §5.5：发现敌人 → important）
                test_same('important', $info['attention'], 'attention level is important on enemy discovery');
                test_assert(!empty($info['enemies_discovered']), 'enemies discovered non-empty');
            },

            // --- 无敌人发现时注意力为 normal ---

            'attention_level_normal_without_enemy' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('pde-normal', 0, ['pgroup' => 1, 'pls' => 1]);
                // 无敌人

                // 调用 obl_acquire_information
                $config = obl_get_info_config('move');
                $info = obl_acquire_information(1, 1, $player, $config);

                // 验证 attention='normal'（无敌人发现）
                test_same('normal', $info['attention'], 'attention level is normal without enemy discovery');
                test_same(0, count($info['enemies_discovered']), 'no enemies discovered');
            },
        ]),

        // ================================================================
        // 3. 已发现敌人与自动导航
        // ================================================================
        test_run_cases('navigation_avoids_enemy', [

            // --- 不进入敌人占据的图格（占位校验）---

            'move_core_rejects_enemy_occupied_tile' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nae-occupied', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建已发现敌人在 tile 4
                $enemy = $room->player('nae-enemy-occ', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 1, 'state' => 0]);

                // 尝试移动到 tile 4（被敌人占据）
                $result = obl_perform_move_core($player, 4, 1);

                // 验证移动失败（occupied）
                test_same(false, $result['success'], 'move to enemy-occupied tile fails');
                test_same('occupied', $result['reason'], 'reason=occupied');
            },

            // --- 有替代路线时避开敌人 ---

            'bfs_avoids_discovered_enemy_middle_tile' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nae-avoid', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建已发现敌人在 tile 4（1→4→2 最短路径的中间格）
                $enemy = $room->player('nae-enemy-mid', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 1, 'state' => 0]);

                // BFS 寻路 1→2，应该避开 tile 4，走替代路线 1→24→25→26→2
                $next = obl_navigation_find_next_step(1, 1, 2, $player, 'steady');

                // 验证返回值不是 4（避开敌人占据的中间格）
                test_assert($next !== null, 'BFS found alternative route (not null)');
                test_assert($next !== 4, 'BFS avoids enemy-occupied tile 4');
                // 替代路线第一步应该是 24（1→24→25→26→2）
                test_same(24, $next, 'BFS returns alternative route via tile 24');
            },

            // --- 目标格有敌人时 BFS 仍返回目标格（由占位校验兜底）---

            'bfs_allows_target_tile_with_enemy' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nae-target', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建已发现敌人在 tile 4（目标格）
                $enemy = $room->player('nae-enemy-tgt', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 1, 'state' => 0]);

                // BFS 寻路 1→4，目标格有敌人，BFS 应该返回 4（目标格除外）
                $next = obl_navigation_find_next_step(1, 1, 4, $player, 'steady');

                // 验证返回值是 4（目标格除外，由 perform_move_core 占位校验兜底）
                test_same(4, $next, 'BFS returns target tile even if enemy occupies it (fallback to occupancy check)');
            },

            // --- 未发现敌人不阻挡 BFS（隐藏信息）---

            'bfs_ignores_undiscovered_enemy' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nae-hidden', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建未发现敌人在 tile 4（discovered=0，隐藏信息）
                $enemy = $room->player('nae-enemy-hidden', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 0, 'state' => 0]);

                // BFS 寻路 1→2，未发现敌人不阻挡（导航器无法预知隐藏敌人）
                $next = obl_navigation_find_next_step(1, 1, 2, $player, 'steady');

                // 验证返回值是 4（最短路径，未发现敌人不阻挡）
                test_same(4, $next, 'BFS ignores undiscovered enemy (hidden info)');
            },

            // --- 死亡敌人不阻挡 BFS ---

            'bfs_ignores_dead_enemy' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('nae-dead', 0, ['pgroup' => 1, 'pls' => 1]);
                // 创建死亡敌人在 tile 4（discovered=1, state=1）
                $enemy = $room->player('nae-enemy-dead', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 1, 'state' => 1]);

                // BFS 寻路 1→2，死亡敌人不阻挡（与 obl_perform_move_core 的 alive_only=true 一致）
                $next = obl_navigation_find_next_step(1, 1, 2, $player, 'steady');

                // 验证返回值是 4（最短路径，死亡敌人不阻挡）
                test_same(4, $next, 'BFS ignores dead enemy');
            },
        ]),

        // ================================================================
        // 4. force_combat 中断验证
        // ================================================================
        test_run_cases('force_combat_interrupt', [

            // --- action='battle' 触发中断 ---

            'force_combat_triggered_by_action_battle' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('fc-action', 0, ['pgroup' => 1, 'pls' => 1, 'action' => 'battle', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('force_combat', $result['reason'], 'action=battle triggers force_combat');
                test_same('force_combat', $nav['outcome_reason'], 'outcome_reason=force_combat');
                test_same(true, $nav['finished'], 'navigation finished');
            },

            // --- bid>0 触发中断 ---

            'force_combat_triggered_by_bid_positive' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('fc-bid', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 42]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('force_combat', $result['reason'], 'bid>0 triggers force_combat');
                test_same(42, $result['details']['bid'], 'details.bid=42');
            },

            // --- 优先级高于 arrived ---

            'force_combat_priority_over_arrived' => static function () use ($room): void {
                // 即使已抵达目标（pls == target_pls），force_combat 也优先中断
                $room->resetData();
                $player = $room->player('fc-priority', 0, ['pgroup' => 1, 'pls' => 4, 'action' => 'battle', 'bid' => 99]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same('force_combat', $result['reason'], 'force_combat fires before arrived');
                test_same('interrupted', $nav['outcome'], 'outcome=interrupted (not arrived)');
            },

            // --- details 包含 bid 和 action ---

            'force_combat_details_contains_bid_and_action' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('fc-details', 0, ['pgroup' => 1, 'pls' => 1, 'action' => 'battle', 'bid' => 555]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_assert(isset($result['details']['bid']), 'details contains bid');
                test_assert(isset($result['details']['action']), 'details contains action');
                test_same(555, $result['details']['bid'], 'details.bid=555');
                test_same('battle', $result['details']['action'], 'details.action=battle');
            },

            // --- 无战斗状态时不触发 force_combat ---

            'force_combat_not_triggered_when_no_battle' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('fc-clean', 0, ['pgroup' => 1, 'pls' => 1, 'action' => '', 'bid' => 0]);
                $nav = ['target_pls' => 4, 'finished' => false, 'outcome' => null, 'outcome_reason' => null];
                $result = obl_navigation_check_interrupt($nav, $player, []);
                test_same(null, $result, 'no force_combat when action="" and bid=0');
            },
        ]),

        // ================================================================
        // 5. 源码审计测试：战斗移动与区域位置 + 不变量验证
        // ================================================================
        test_run_cases('combat_boundary_source', [

            // --- combat_move 配置预留（F-E6-Combat §5.6）---

            'combat_move_config_reserved_in_info_acquire' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/info_acquire.func.php');
                test_assert(strpos($source, 'combat_move') !== false, 'combat_move config reserved in info_acquire source');
            },

            // --- 导航器不自动开战（F-E6-Combat §5.3）---

            'navigation_does_not_auto_start_combat' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                test_assert(strpos($source, 'combat_start_battle') === false, 'navigation does not call combat_start_battle');
                test_assert(strpos($source, 'battle_state_init') === false, 'navigation does not call battle_state_init');
            },

            'navigate_handler_does_not_auto_start_combat' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                test_assert(strpos($handlerBody, 'combat_start_battle') === false, 'navigate handler does not call combat_start_battle');
                test_assert(strpos($handlerBody, 'battle_state_init') === false, 'navigate handler does not call battle_state_init');
            },

            // --- force_combat 检查在 arrived 之前（优先级验证）---

            'force_combat_check_before_arrived_in_source' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_check_interrupt');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                $forceCheckPos = strpos($funcBody, "'battle'");
                $arrivedCheckPos = strpos($funcBody, '$cur_pls === $target_pls');
                test_assert($forceCheckPos !== false, 'force_combat check present');
                test_assert($arrivedCheckPos !== false, 'arrived check present');
                test_assert($forceCheckPos < $arrivedCheckPos, 'force_combat check before arrived check');
            },

            // --- BFS 避开已发现敌人（补全验证）---

            'bfs_avoids_discovered_enemy_in_source' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_find_next_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'blocked_tiles') !== false, 'BFS uses blocked_tiles');
                test_assert(strpos($funcBody, 'obl_navigation_get_enemy_occupied_tiles') !== false, 'BFS calls obl_navigation_get_enemy_occupied_tiles');
            },

            'navigation_has_enemy_occupied_tiles_helper' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                test_assert(strpos($source, 'function obl_navigation_get_enemy_occupied_tiles') !== false, 'obl_navigation_get_enemy_occupied_tiles helper exists');
                // 验证只收集 discovered=1 且 state=0 的敌人
                $funcStart = strpos($source, 'function obl_navigation_get_enemy_occupied_tiles');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'discovered = 1') !== false, 'helper filters discovered=1');
                test_assert(strpos($funcBody, 'state = 0') !== false, 'helper filters state=0 (alive only)');
            },

            // --- 敌人发现保留死亡敌人状态（F-E6-Combat §5.1）---

            'discover_enemies_skips_dead_enemies' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/vision.func.php');
                $funcStart = strpos($source, 'function obl_discover_enemies');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, "state'] > 0") !== false, 'discover_enemies skips dead enemies (state>0)');
            },

            'update_enemy_discovered_skips_dead_enemies' => static function (): void {
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/vision.func.php');
                $funcStart = strpos($source, 'function obl_update_enemy_discovered');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, "state'] > 0") !== false, 'update_enemy_discovered skips dead enemies (state>0)');
            },
        ])
    );
};
