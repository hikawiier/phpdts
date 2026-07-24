<?php
declare(strict_types=1);

/**
 * 子任务 2B.3：自动目标解析与四种移动倾向单测（F-E5-Target）
 *
 * 覆盖 F-E5-Target §三 不变量 + §5.2 目标优先级 + §5.6 四种倾向：
 *   1. 目标优先级（§5.2）：可达未探索格 > 未发现 POI > 无目标
 *   2. 已发现 POI 永久退出目标池（§三.3，不论是否已经互动）
 *   3. 已发现敌人不是自动移动目标（§三.4）
 *   4. 不静默改选目标（§三.9）：目标失效/路线不可达时中断
 *   5. 内容搜索不自动追加主动探索（§三.8）
 *   6. 普通地面道具不进入自动探索目标池（§三.2）
 *   7. 四种移动倾向（§5.6）：steady/nearby/deep/efficient 都能选目标；未知值回退 steady
 *
 * 已知缺口（首期决策保持简化，本测试不要求实现）：
 *   - 优先级 2 隐藏敌人搜索位置（§5.4，navigation.func.php L431 TODO）
 *   - 四种倾向差异化算法（首期所有倾向共用 BFS 最短路径）
 *
 * 依赖 region_1.php 图格数据：
 *   tile 1: passable=true, neighbors=[24,17,5,4]
 *   tile 4: passable=true, neighbors=[27,28,29,23,5,1,2]
 *   tile 5: passable=false（背景墙"高耸的废铁山"）
 *   tile 24: passable=true, neighbors=[17,18,25,1]
 *
 * @module E 游戏逻辑
 * @framework E-3 基于图的移动系统
 * @framework E-5 自动目标解析与移动倾向框架
 */

return static function (TestRoom $room): array {
    // 辅助：标记 region_1 全部图格为 explored（让 select_unexplored_tile 返回 null）
    $markAllRegionExplored = static function (): void {
        $map = obl_get_map_data(1);
        $tiles = $map['tiles'][1] ?? [];
        foreach (array_keys($tiles) as $pls) {
            obl_mark_explored(1, (int)$pls);
        }
    };

    // 辅助：插入 POI（最小字段集）
    $insertPoi = static function (int $pls, string $poi_id, int $discovered, string $state = 'idle') use ($room): int {
        global $db;
        $db->query("INSERT INTO {$room->prefix}oblmappoi (pgroup, pls, poi_id, discovered, state)
                    VALUES (1, {$pls}, '" . $db->escape_string($poi_id) . "', {$discovered}, '" . $db->escape_string($state) . "')");
        $result = $db->query("SELECT LAST_INSERT_ID() AS iaid");
        return (int)$db->fetch_array($result)['iaid'];
    };

    // 辅助：插入地面道具（最小字段集）
    $insertItem = static function (int $pls, string $item_id, int $discovered = 0) use ($room): int {
        global $db;
        $db->query("INSERT INTO {$room->prefix}oblmapitem (pgroup, pls, item_id, discovered)
                    VALUES (1, {$pls}, '" . $db->escape_string($item_id) . "', {$discovered})");
        $result = $db->query("SELECT LAST_INSERT_ID() AS iid");
        return (int)$db->fetch_array($result)['iid'];
    };

    // 辅助：插入敌人（最小字段集）
    $insertEnemy = static function (string $name, int $pls, int $discovered, int $state = 0) use ($room): int {
        global $db;
        $db->query("INSERT INTO {$room->prefix}oblplayers
                    (type, name, gd, icon, action, bid, hp, mhp, sp, msp, att, def, ap, max_ap,
                     pgroup, pls, lvl, exp, state, itempara, itemmaxslots, tacpara, skillpara, oblpara, discovered,
                     weppara, wep2para, arbpara, arhpara, arapara, arfpara, artpara)
                    VALUES (1, '" . $db->escape_string($name) . "', 'm', '0', '', 0, 100, 100, 100, 100, 20, 0, 20, 20,
                            1, {$pls}, 1, 0, {$state}, '[]', 6, '{\"slots\":[]}', '{}', '{}', {$discovered},
                            '{}', '{}', '{}', '{}', '{}', '{}', '{}')");
        $result = $db->query("SELECT LAST_INSERT_ID() AS pid");
        return (int)$db->fetch_array($result)['pid'];
    };

    // 辅助：读取 region_1 tile 的 passable 与 neighbors
    $tileInfo = static function (int $pls): array {
        $map = obl_get_map_data(1);
        $tile = $map['tiles'][1][$pls] ?? null;
        return $tile
            ? ['passable' => !empty($tile['passable']), 'neighbors' => $tile['neighbors'] ?? []]
            : ['passable' => false, 'neighbors' => []];
    };

    return array_merge(
        // ================================================================
        // 1. 目标优先级（F-E5-Target §5.2）
        // ================================================================
        test_run_cases('target_priority', [

            'select_target_returns_unexplored_tile_when_available' => static function () use ($room, $tileInfo): void {
                // 优先级 1：可达未探索格
                // 玩家在 tile 1，没有任何 explored 标记 → BFS 找到第一个 passable+explored=0 的邻居
                $room->resetData();
                $player = $room->player('prio-unexplored', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_assert($target !== null, 'target selected when unexplored tiles available');
                $target = (int)$target;
                // 目标必须是 region_1 中真实存在的可通行图格
                $info = $tileInfo($target);
                test_assert(!empty($info['passable']), 'selected target is passable');
                // 目标必须是 tile 1 的直接邻居（BFS 第一层找到的）
                $neighbors = $tileInfo(1)['neighbors'];
                test_assert(in_array($target, $neighbors, true), 'selected target is direct neighbor of tile 1');
            },

            'select_target_falls_back_to_poi_when_no_unexplored_tile' => static function () use ($room, $markAllRegionExplored, $insertPoi): void {
                // 优先级 2：无可达未探索格时，转 POI 搜索
                // 标记 region_1 全部 explored → select_unexplored_tile 返回 null
                // 插入 discovered=0 的 POI 在 tile 4 → select_undiscovered_poi 返回 tile 4
                $room->resetData();
                $markAllRegionExplored();
                $insertPoi(4, 'poi_test', 0);
                $player = $room->player('prio-poi', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(4, (int)$target, 'target falls back to undiscovered POI at tile 4');
            },

            'select_target_returns_null_when_no_unexplored_and_no_poi' => static function () use ($room, $markAllRegionExplored): void {
                // 无可达未探索格且无 POI → 返回 null
                $room->resetData();
                $markAllRegionExplored();
                $player = $room->player('prio-null', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'no target when no unexplored tile and no POI');
            },

            'select_target_prefers_unexplored_over_poi' => static function () use ($room, $insertPoi, $tileInfo): void {
                // 优先级顺序：未探索格 > POI
                // 同时存在未探索格和未发现 POI，应优先选未探索格
                // 玩家在 tile 1，不标记任何 explored；在 tile 4 插入未发现 POI
                // tile 1 的直接邻居 24/17/4 都未探索 → 应返回其中之一（优先级 1）
                $room->resetData();
                $insertPoi(4, 'poi_alongside', 0);
                $player = $room->player('prio-mixed', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = (int)obl_navigation_select_target(1, 1, 'steady', $player);
                test_assert($target !== 0, 'target selected when both unexplored and POI available');
                $neighbors = $tileInfo(1)['neighbors'];
                test_assert(in_array($target, $neighbors, true), 'priority 1 (unexplored tile) preferred over priority 2 (POI)');
            },

            'select_target_unexplored_skips_impassable' => static function () use ($room, $tileInfo): void {
                // 不可通行格不作为目标（与 navigation_integration_test 一致的不变量复测）
                // tile 5 是不可通行格，是 tile 1 的直连邻居
                $room->resetData();
                $player = $room->player('prio-impassable', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = (int)obl_navigation_select_target(1, 1, 'steady', $player);
                test_assert($target !== 5, 'impassable tile 5 never selected as priority 1 target');
                $info = $tileInfo($target);
                test_assert(!empty($info['passable']), 'selected target is passable');
            },
        ]),

        // ================================================================
        // 2. 已发现 POI 永久退出目标池（F-E5-Target §三.3）
        // ================================================================
        test_run_cases('poi_pool_exclusion', [

            'discovered_poi_not_selected_as_target' => static function () use ($room, $markAllRegionExplored, $insertPoi): void {
                // 已发现 POI（discovered=1）不应被 select_undiscovered_poi 选中
                // §三.3：已发现 POI 永久退出自动探索目标池
                $room->resetData();
                $markAllRegionExplored();
                $iaid = $insertPoi(4, 'poi_discovered', 1);  // discovered=1
                $player = $room->player('poi-disc', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'discovered POI exits target pool');
                // 直接验证 select_undiscovered_poi 返回 null
                $direct = obl_navigation_select_undiscovered_poi(1, 1, 'steady', $player);
                test_same(null, $direct, 'select_undiscovered_poi returns null for discovered POI');
            },

            'discovered_poi_with_state_searched_still_excluded' => static function () use ($room, $markAllRegionExplored, $insertPoi): void {
                // §三.3：不论是否已经互动
                // discovered=1 + state='searched'（已搜索但可能未拾取）仍被排除
                $room->resetData();
                $markAllRegionExplored();
                $insertPoi(4, 'poi_searched', 1, 'searched');
                $player = $room->player('poi-searched', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'discovered POI with state=searched still excluded');
            },

            'discovered_poi_with_state_exhausted_still_excluded' => static function () use ($room, $markAllRegionExplored, $insertPoi): void {
                // discovered=1 + state='exhausted'（次数耗尽）仍被排除
                $room->resetData();
                $markAllRegionExplored();
                $insertPoi(4, 'poi_exhausted', 1, 'exhausted');
                $player = $room->player('poi-exhausted', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'discovered POI with state=exhausted still excluded');
            },

            'undiscovered_poi_with_state_idle_selected' => static function () use ($room, $markAllRegionExplored, $insertPoi): void {
                // 反向验证：discovered=0 + state='idle' 的 POI 应被选中（对照实验）
                $room->resetData();
                $markAllRegionExplored();
                $insertPoi(4, 'poi_undiscovered', 0, 'idle');
                $player = $room->player('poi-undisc', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(4, (int)$target, 'undiscovered POI with state=idle is selected');
            },

            'discovered_poi_does_not_silently_reenter_pool' => static function () use ($room, $markAllRegionExplored, $insertPoi): void {
                // 持久性：discovered=1 的 POI 不会因为再次调用而重新进入目标池
                $room->resetData();
                $markAllRegionExplored();
                $insertPoi(4, 'poi_persistent', 1);
                $player = $room->player('poi-persist', 0, ['pgroup' => 1, 'pls' => 1]);
                // 多次调用，均应返回 null（不会"复活"）
                for ($i = 0; $i < 3; $i++) {
                    $target = obl_navigation_select_target(1, 1, 'steady', $player);
                    test_same(null, $target, "discovered POI stays excluded on call #{$i}");
                }
            },
        ]),

        // ================================================================
        // 3. 已发现敌人不是自动移动目标（F-E5-Target §三.4）
        // ================================================================
        test_run_cases('enemy_not_target', [

            'discovered_enemy_not_selected_as_target' => static function () use ($room, $markAllRegionExplored, $insertEnemy): void {
                // §三.4：已发现敌人不是自动移动目标
                // 标记全部图格 explored，在 tile 4 插入 discovered=1 的敌人，无 POI
                // select_target 不应把敌人位置作为目标
                $room->resetData();
                $markAllRegionExplored();
                $insertEnemy('enemy_disc', 4, 1);  // discovered=1
                $player = $room->player('enemy-test', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'discovered enemy not selected as auto move target');
            },

            'hidden_enemy_not_selected_as_target' => static function () use ($room, $markAllRegionExplored, $insertEnemy): void {
                // 隐藏敌人（discovered=0）也不是自动移动目标
                // 已知缺口：优先级 2 的"隐藏敌人搜索位置"未实现（L431 TODO）
                // 当前行为：select_target 在无未探索格 + 无未发现 POI 时返回 null
                // 即使存在 discovered=0 的敌人，也不会被选为目标（因为 L431 TODO 未实现）
                $room->resetData();
                $markAllRegionExplored();
                $insertEnemy('enemy_hidden', 4, 0);  // discovered=0
                $player = $room->player('enemy-hidden', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'hidden enemy not selected (priority 3 TODO not implemented)');
            },

            'enemy_does_not_block_poi_fallback' => static function () use ($room, $markAllRegionExplored, $insertPoi, $insertEnemy): void {
                // 敌人存在不影响 POI 目标选择
                $room->resetData();
                $markAllRegionExplored();
                $insertEnemy('enemy_adjacent', 4, 1);
                $insertPoi(2, 'poi_with_enemy', 0);  // POI 在 tile 2，与敌人在 tile 4 不同
                $player = $room->player('enemy-poi', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                // 应返回 POI 位置 tile 2，而不是敌人位置 tile 4
                test_same(2, (int)$target, 'POI selected, enemy position ignored');
            },
        ]),

        // ================================================================
        // 4. 不静默改选目标（F-E5-Target §三.9 / F-E1-Nav §5.3）
        // ================================================================
        test_run_cases('no_silent_reswitch', [

            'begin_with_invalid_target_does_not_auto_select' => static function () use ($room): void {
                // 玩家指定 target=999（不存在）→ 返回 target_invalid
                // 不静默改选另一个目标（不调用 select_target 作为 fallback）
                $room->resetData();
                $player = $room->player('reswitch-invalid', 0, ['pgroup' => 1, 'pls' => 1]);
                $nav = obl_navigation_begin(['target' => 999], $player);
                test_same(true, $nav['finished'], 'begin finishes on invalid target');
                test_same('interrupted', $nav['outcome'], 'outcome=interrupted');
                test_same('target_invalid', $nav['outcome_reason'], 'reason=target_invalid');
                test_same(null, $nav['target_pls'], 'target_pls stays null (no fallback)');
                test_same(false, $nav['target_is_auto'], 'target_is_auto=false (no auto-select fallback)');
            },

            'begin_with_valid_target_does_not_call_auto_select' => static function (): void {
                // 源码审计：obl_navigation_begin 在 target_pls 有效时直接使用，不调用 select_target
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_begin');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                // 玩家指定 target 分支：直接设置 target_pls，不调用 select_target
                $autoSelectCallPos = strpos($funcBody, 'obl_navigation_select_target(');
                $specifiedTargetPos = strpos($funcBody, "target_pls !== null");
                test_assert($autoSelectCallPos !== false, 'select_target is referenced in begin');
                test_assert($specifiedTargetPos !== false, 'specified-target branch present');
                // select_target 调用位于 else 分支（target_pls === null 时）
                test_assert($autoSelectCallPos > $specifiedTargetPos, 'select_target only called when target not specified (else branch)');
            },

            'next_step_returns_null_on_unreachable_target' => static function (): void {
                // 源码审计：obl_navigation_next_step 在 find_next_step 返回 null 时
                // 返回 null（不重新选目标）
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_next_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                // next_step 函数体不应调用 select_target
                test_assert(strpos($funcBody, 'obl_navigation_select_target') === false,
                    'next_step must not call select_target (no silent reswitch)');
            },

            'check_interrupt_does_not_reswitch_target' => static function (): void {
                // 源码审计：obl_navigation_check_interrupt 在中断时不重新选目标
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_check_interrupt');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_navigation_select_target') === false,
                    'check_interrupt must not call select_target (no silent reswitch)');
            },

            'handler_breaks_on_route_invalid_without_reswitch' => static function (): void {
                // 源码审计：handler 在 next_step 返回 null 时标记 route_invalid 并 break
                // 不调用 select_target 重新选目标
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                // route_invalid 标记存在
                test_assert(strpos($handlerBody, "'route_invalid'") !== false, 'handler marks route_invalid');
                // handler 不调用 select_target（begin 之后不再选目标）
                test_assert(strpos($handlerBody, 'obl_navigation_select_target') === false,
                    'handler must not call select_target after begin (no silent reswitch)');
            },

            'handler_no_target_outcome_does_not_pick_alternative' => static function () use ($room): void {
                // 集成验证：begin 返回 no_target 时 handler 直接返回，不静默改选
                // 使用 pgroup=999（无地图），select_target 返回 null
                $room->resetData();
                $player = $room->player('reswitch-no-target', 0, ['pgroup' => 999, 'pls' => 1]);
                $GLOBALS['obl_command_operation_key'] = 'test-reswitch-no-target';
                try {
                    $result = obl_command_handler_map_navigate([], $player);
                    test_assert($result['ok'], 'no_target returns ok=true');
                    test_same('no_target', $result['data']['navigation']['outcome'], 'outcome=no_target');
                    test_same(null, $result['data']['navigation']['target_pls'], 'target_pls=null (no alternative picked)');
                    test_same(false, $result['data']['tick_advanced'], 'no tick consumed');
                } finally {
                    unset($GLOBALS['obl_command_operation_key']);
                }
            },
        ]),

        // ================================================================
        // 5. 内容搜索不自动追加主动探索（F-E5-Target §三.8）
        // ================================================================
        test_run_cases('no_auto_explore', [

            'handler_does_not_call_obl_explore' => static function (): void {
                // 源码审计：map.navigate handler 不调用 obl_explore
                // §三.8：内容搜索不自动追加一次主动探索行动
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                test_assert(strpos($handlerBody, 'obl_explore(') === false,
                    'navigate handler must not call obl_explore (no auto explore)');
                test_assert(strpos($handlerBody, 'obl_acquire_information') !== false,
                    'navigate handler uses obl_acquire_information (move config, not explore)');
            },

            'handler_uses_move_config_not_explore_config' => static function (): void {
                // 源码审计：handler 调用 obl_acquire_information 时传入 'move' 配置
                // 不应使用 'explore' 配置（explore 配置有更高预算/概率，属于主动探索）
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/command/obl_command_handlers.php');
                $handlerStart = strpos($source, 'function obl_command_handler_map_navigate');
                $handlerEnd = strpos($source, "\nfunction ", $handlerStart + 1);
                $handlerBody = substr($source, $handlerStart, $handlerEnd - $handlerStart);
                test_assert(strpos($handlerBody, "obl_get_info_config('move')") !== false,
                    'handler uses move config for info acquisition');
                test_assert(strpos($handlerBody, "obl_get_info_config('explore')") === false,
                    'handler must not use explore config (no auto explore)');
            },
        ]),

        // ================================================================
        // 6. 普通地面道具不进入自动探索目标池（F-E5-Target §三.2）
        // ================================================================
        test_run_cases('ground_item_not_target', [

            'ground_item_not_selected_as_target' => static function () use ($room, $markAllRegionExplored, $insertItem): void {
                // §三.2：普通地面道具不进入自动探索目标池
                // 标记全部 explored，在 tile 4 插入地面道具（discovered=1），无 POI
                // select_target 不应把道具位置作为目标
                $room->resetData();
                $markAllRegionExplored();
                $insertItem(4, 'item_ground', 1);  // 已发现的地面道具
                $player = $room->player('item-test', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'ground item not selected as auto target');
            },

            'undiscovered_ground_item_not_selected_as_target' => static function () use ($room, $markAllRegionExplored, $insertItem): void {
                // 未发现的地面道具也不应被选为目标
                $room->resetData();
                $markAllRegionExplored();
                $insertItem(4, 'item_hidden', 0);  // 未发现的地面道具
                $player = $room->player('item-hidden', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(null, $target, 'undiscovered ground item not selected as auto target');
            },

            'navigation_func_does_not_query_oblmapitem' => static function (): void {
                // 源码审计：navigation.func.php 不查询 oblmapitem 表
                // 普通道具不进入目标池的根本保证：目标选择函数不读取道具表
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                test_assert(strpos($source, 'oblmapitem') === false,
                    'navigation.func.php must not query oblmapitem (ground items never targeted)');
            },
        ]),

        // ================================================================
        // 7. 四种移动倾向（F-E5-Target §5.6）
        // ================================================================
        test_run_cases('tendencies', [

            'steady_tendency_selects_target' => static function () use ($room, $tileInfo): void {
                // steady（稳健，默认）能正常选择目标
                $room->resetData();
                $player = $room->player('tend-steady', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_assert($target !== null, 'steady tendency selects a target');
                $neighbors = $tileInfo(1)['neighbors'];
                test_assert(in_array((int)$target, $neighbors, true), 'steady target is a neighbor of tile 1');
            },

            'nearby_tendency_selects_target' => static function () use ($room, $tileInfo): void {
                // nearby（就近）能正常选择目标
                $room->resetData();
                $player = $room->player('tend-nearby', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'nearby', $player);
                test_assert($target !== null, 'nearby tendency selects a target');
                $neighbors = $tileInfo(1)['neighbors'];
                test_assert(in_array((int)$target, $neighbors, true), 'nearby target is a neighbor of tile 1');
            },

            'deep_tendency_selects_target' => static function () use ($room): void {
                // deep（深入险境）能正常选择目标
                $room->resetData();
                $player = $room->player('tend-deep', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'deep', $player);
                test_assert($target !== null, 'deep tendency selects a target');
            },

            'efficient_tendency_selects_target' => static function () use ($room): void {
                // efficient（效率优先）能正常选择目标
                $room->resetData();
                $player = $room->player('tend-efficient', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'efficient', $player);
                test_assert($target !== null, 'efficient tendency selects a target');
            },

            'unknown_tendency_falls_back_to_steady' => static function (): void {
                // 未知倾向回退到 steady（合约层不校验枚举，begin 归一化）
                test_same('steady', obl_navigation_normalize_tendency('unknown_value'), 'unknown tendency falls back to steady');
                test_same('steady', obl_navigation_normalize_tendency(''), 'empty tendency falls back to steady');
                test_same('steady', obl_navigation_normalize_tendency(null), 'null tendency falls back to steady');
                test_same('steady', obl_navigation_normalize_tendency(123), 'non-string tendency falls back to steady');
            },

            'all_four_tendencies_listed_in_enum' => static function (): void {
                // 四种倾向枚举完整：steady/nearby/deep/efficient
                $tendencies = obl_navigation_tendencies();
                test_same(4, count($tendencies), 'exactly 4 tendencies');
                test_assert(isset($tendencies['steady']), 'steady tendency exists');
                test_assert(isset($tendencies['nearby']), 'nearby tendency exists');
                test_assert(isset($tendencies['deep']), 'deep tendency exists');
                test_assert(isset($tendencies['efficient']), 'efficient tendency exists');
            },

            'known_tendencies_preserved_by_normalize' => static function (): void {
                // 已知倾向值被保留（不回退）
                foreach (['steady', 'nearby', 'deep', 'efficient'] as $t) {
                    test_same($t, obl_navigation_normalize_tendency($t), "known tendency {$t} preserved");
                }
            },

            'begin_normalizes_tendency_in_payload' => static function () use ($room): void {
                // begin 通过 obl_navigation_normalize_tendency 归一化 payload 中的 tendency
                $room->resetData();
                $player = $room->player('tend-normalize', 0, ['pgroup' => 999, 'pls' => 1]);
                $nav = obl_navigation_begin(['tendency' => 'bogus'], $player);
                test_same('steady', $nav['tendency'], 'unknown tendency in payload normalized to steady');
                $nav2 = obl_navigation_begin(['tendency' => 'deep'], $player);
                test_same('deep', $nav2['tendency'], 'known tendency preserved');
            },

            // ── 7.1 差异化：目标选择阶段（F-E5-Target §5.6） ──
            // region_1 tile 1 邻居：24(shallow,passable)/17(shallow,passable)/5(impassable)/4(shallow,passable)
            // 玩家在 tile 1，未探索任何格 → 候选包含所有可达未探索格

            'steady_selects_nearest_shallow_target' => static function () use ($room): void {
                // steady：BFS 距离升序 → tide_weight 升序（低潮汐优先）
                // 玩家在 tile 1，未探索任何格
                // 距离 1 的 shallow 候选：4/17/24（按 pls 升序回退 → 选 4）
                $room->resetData();
                $player = $room->player('tend-steady-target', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'steady', $player);
                test_same(4, (int)$target, 'steady selects nearest shallow tile (tile 4 by pls tiebreak)');
            },

            'deep_prefers_high_tide_target_over_shallow' => static function () use ($room): void {
                // deep：tide_weight 降序（高潮汐优先） → 距离升序
                // 玩家在 tile 1，未探索任何格
                // 候选中 abyss 格（w=3）优先于 deep（w=2）优先于 shallow（w=1）
                // 最近的 abyss 格：tile 9（距离 4：1→4→27→14→9 或 1→4→27→10→9）
                // 验证 deep 不会选 shallow 邻居（4/17/24），而是选 abyss 目标
                $room->resetData();
                $player = $room->player('tend-deep-target', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = (int)obl_navigation_select_target(1, 1, 'deep', $player);
                test_assert($target !== 0, 'deep selects a target');
                // 验证选中的不是 shallow 邻居（4/17/24）
                test_assert(!in_array($target, [4, 17, 24], true),
                    'deep must prefer high-tide target over shallow neighbors (target=' . $target . ')');
                // 验证选中的是 abyss 格（tide=abyss）
                $map = obl_get_map_data(1);
                $tile = $map['tiles'][1][$target] ?? [];
                $tide = $tile['tide'] ?? 'shallow';
                test_same('abyss', $tide, 'deep selects abyss-tier target (target=' . $target . ')');
            },

            'nearby_selects_min_action_count_target' => static function () use ($room): void {
                // nearby：行动次数升序 → BFS 距离升序
                // 玩家在 tile 1，未探索任何格
                // 距离 1 的格 → action_count = ceil(1/3) = 1（最少）
                // 距离 2-3 的格 → action_count = 1
                // 距离 4-6 的格 → action_count = 2
                // 在所有 action_count=1 候选中按距离升序，距离 1 优先
                // 距离 1 候选：4/17/24，按 pls 升序回退 → 选 4
                $room->resetData();
                $player = $room->player('tend-nearby-target', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = obl_navigation_select_target(1, 1, 'nearby', $player);
                test_same(4, (int)$target, 'nearby selects tile with minimum action count (distance 1, tiebreak by pls)');
            },

            'efficient_selects_farthest_target' => static function () use ($room): void {
                // efficient：BFS 距离降序（最远优先） → tide_weight 升序
                // 玩家在 tile 1，未探索任何格
                // 验证 efficient 选中的目标距离 > 1（远离起始格）
                $room->resetData();
                $player = $room->player('tend-efficient-target', 0, ['pgroup' => 1, 'pls' => 1]);
                $target = (int)obl_navigation_select_target(1, 1, 'efficient', $player);
                test_assert($target !== 0, 'efficient selects a target');
                $distance = obl_get_distance(1, 1, $target);
                test_assert($distance > 1, 'efficient selects far target (distance=' . $distance . ' > 1)');
                // 验证 efficient 与 steady 选不同目标
                $steady_target = (int)obl_navigation_select_target(1, 1, 'steady', $player);
                test_assert($target !== $steady_target,
                    'efficient selects different target from steady (efficient=' . $target . ', steady=' . $steady_target . ')');
            },

            'steady_and_nearby_select_same_target_when_only_shallow_nearby' => static function () use ($room): void {
                // 当所有近邻候选都是 shallow 时，steady 和 nearby 在距离 1 候选中
                // 都通过 pls 升序回退选同一个目标（tile 4）
                $room->resetData();
                $player = $room->player('tend-steady-vs-nearby', 0, ['pgroup' => 1, 'pls' => 1]);
                $steady_target = (int)obl_navigation_select_target(1, 1, 'steady', $player);
                $nearby_target = (int)obl_navigation_select_target(1, 1, 'nearby', $player);
                test_same($steady_target, $nearby_target, 'steady and nearby select same target when only shallow nearby');
            },

            'deep_selects_different_target_from_steady' => static function () use ($room): void {
                // deep 与 steady 选不同目标——验证差异化生效
                $room->resetData();
                $player = $room->player('tend-deep-vs-steady', 0, ['pgroup' => 1, 'pls' => 1]);
                $steady_target = (int)obl_navigation_select_target(1, 1, 'steady', $player);
                $deep_target = (int)obl_navigation_select_target(1, 1, 'deep', $player);
                test_assert($steady_target !== $deep_target,
                    "deep selects different target from steady (steady={$steady_target}, deep={$deep_target})");
            },

            // ── 7.2 差异化：路径选择阶段（F-E5-Target §5.6） ──

            'find_next_step_branches_on_tendency' => static function (): void {
                // 源码审计：obl_navigation_find_next_step 按 tendency 分支
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_find_next_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, '$tendency') !== false, 'tendency parameter accepted');
                // 验证四个倾向分支都存在
                foreach (["'steady'", "'nearby'", "'deep'", "'efficient'"] as $t) {
                    test_assert(strpos($funcBody, $t) !== false,
                        "find_next_step has branch for {$t}");
                }
            },

            'steady_find_next_step_returns_valid_neighbor' => static function () use ($room): void {
                // steady 路径选择：从 tile 1 到 tile 4（距离 1，shallow 路径）
                $room->resetData();
                $player = $room->player('path-steady', 0, ['pgroup' => 1, 'pls' => 1]);
                $next = obl_navigation_find_next_step(1, 1, 4, $player, 'steady');
                test_same(4, $next, 'steady path from 1 to 4 returns 4 as next step');
            },

            'nearby_find_next_step_returns_valid_neighbor' => static function () use ($room): void {
                // nearby 路径选择：从 tile 1 到 tile 4（距离 1，在 max_distance 内）
                $room->resetData();
                $player = $room->player('path-nearby', 0, ['pgroup' => 1, 'pls' => 1]);
                $next = obl_navigation_find_next_step(1, 1, 4, $player, 'nearby');
                test_same(4, $next, 'nearby path from 1 to 4 returns 4 as next step');
            },

            'deep_find_next_step_returns_valid_neighbor' => static function () use ($room): void {
                // deep 路径选择：从 tile 1 到 tile 30（距离 3+，路径上可能有 deep 中间格）
                // 验证 deep 倾向能正常返回下一格（不卡死）
                $room->resetData();
                $player = $room->player('path-deep', 0, ['pgroup' => 1, 'pls' => 1]);
                $next = obl_navigation_find_next_step(1, 1, 30, $player, 'deep');
                test_assert($next !== null, 'deep path from 1 to 30 returns a valid next step');
                // 验证 next 是 tile 1 的直接邻居
                $map = obl_get_map_data(1);
                $neighbors = $map['tiles'][1][1]['neighbors'] ?? [];
                test_assert(in_array((int)$next, $neighbors, true), 'deep next step is neighbor of tile 1');
            },

            'efficient_find_next_step_returns_multi_step_target' => static function () use ($room): void {
                // efficient 路径选择：从 tile 1 到 tile 30（距离 3+，沿最短路径走 move_power 格）
                // tile 1 → 4 → 27 → 30：距离 3，正好 move_power=3 → efficient 应返回 tile 30
                // 但实际 BFS 可能找到不同距离 3 路径
                $room->resetData();
                $player = $room->player('path-efficient', 0, ['pgroup' => 1, 'pls' => 1]);
                $next = obl_navigation_find_next_step(1, 1, 30, $player, 'efficient');
                test_assert($next !== null, 'efficient path from 1 to 30 returns a next step');
                // 验证 efficient 返回的格距 from 的距离 = move_power（3）或更近（如果路径不足）
                $distance = obl_get_distance(1, 1, (int)$next);
                test_assert($distance >= 1 && $distance <= 3,
                    'efficient next step distance in [1, move_power=3] (distance=' . $distance . ')');
                // 关键：efficient 应返回距离 = move_power 的格（如果路径长度 ≥ move_power）
                // tile 1 → tile 30 距离 = 3，正好等于 move_power，应返回 tile 30
                test_same(30, (int)$next, 'efficient returns target tile directly when distance equals move_power');
            },

            'efficient_find_next_step_returns_path_midpoint_when_far' => static function () use ($room): void {
                // efficient 路径选择：从 tile 1 到较远目标，验证返回沿路径走 move_power 格
                // tile 1 → tile 33 (deep) 距离约 4-5；move_power=3 → efficient 应返回距离 3 的格
                $room->resetData();
                $player = $room->player('path-efficient-far', 0, ['pgroup' => 1, 'pls' => 1]);
                // 找一个距离 > move_power 的目标
                $target_candidates = [33, 31, 32, 34, 41];
                $target_pls = null;
                foreach ($target_candidates as $cand) {
                    $dist = obl_get_distance(1, 1, $cand);
                    if ($dist > 3) { $target_pls = $cand; break; }
                }
                test_assert($target_pls !== null, 'found a target with distance > move_power');
                $next = obl_navigation_find_next_step(1, 1, $target_pls, $player, 'efficient');
                test_assert($next !== null, 'efficient returns a next step for far target');
                $next_distance = obl_get_distance(1, 1, (int)$next);
                test_same(3, $next_distance, 'efficient next step distance = move_power for far target (distance=' . $next_distance . ')');
            },

            // ── 7.3 边界案例 ──

            'nearby_returns_null_when_target_too_far' => static function (): void {
                // 源码审计：nearby 在路径长度超 max_distance 时返回 null
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_find_next_step');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                // nearby 分支必须有距离上限检查 + 返回 null
                $nearby_start = strpos($funcBody, "case 'nearby':");
                $nearby_end = strpos($funcBody, "case 'deep':", $nearby_start);
                $nearby_body = substr($funcBody, $nearby_start, $nearby_end - $nearby_start);
                test_assert(strpos($nearby_body, 'max_distance') !== false, 'nearby branch has max_distance check');
                test_assert(strpos($nearby_body, 'return null') !== false, 'nearby branch returns null when too far');
            },

            'tendency_config_has_required_keys' => static function (): void {
                // 验证倾向配置包含所有必需字段
                $cfg = obl_navigation_tendency_config();
                test_assert(isset($cfg['steady_max_detour']), 'config has steady_max_detour');
                test_assert(isset($cfg['steady_max_target_distance']), 'config has steady_max_target_distance');
                test_assert(isset($cfg['tendency_nearby_max_actions']), 'config has tendency_nearby_max_actions');
                test_assert(isset($cfg['tendency_deep_max_distance']), 'config has tendency_deep_max_distance');
                test_assert(isset($cfg['tendency_deep_max_detour']), 'config has tendency_deep_max_detour');
                test_assert(isset($cfg['tendency_efficient_max_actions']), 'config has tendency_efficient_max_actions');
                test_assert(isset($cfg['tide_weight_map']), 'config has tide_weight_map');
                // 验证 tide_weight_map 包含三种潮汐
                test_assert(isset($cfg['tide_weight_map']['shallow']), 'tide_weight_map has shallow');
                test_assert(isset($cfg['tide_weight_map']['deep']), 'tide_weight_map has deep');
                test_assert(isset($cfg['tide_weight_map']['abyss']), 'tide_weight_map has abyss');
            },

            'tide_weight_helper_returns_correct_values' => static function (): void {
                // 验证潮汐权重辅助函数
                $cfg = obl_navigation_tendency_config();
                $weight_map = $cfg['tide_weight_map'];
                test_same($weight_map['shallow'], obl_navigation_tide_weight('shallow', $weight_map), 'shallow weight');
                test_same($weight_map['deep'], obl_navigation_tide_weight('deep', $weight_map), 'deep weight');
                test_same($weight_map['abyss'], obl_navigation_tide_weight('abyss', $weight_map), 'abyss weight');
                // 未知潮汐回退 1（与 shallow 同级）
                test_same(1, obl_navigation_tide_weight('unknown_tide', $weight_map), 'unknown tide falls back to weight 1');
                test_same(1, obl_navigation_tide_weight('', $weight_map), 'empty tide falls back to weight 1');
            },

            'action_count_helper_calculates_correctly' => static function (): void {
                // 验证行动次数辅助函数
                test_same(0, obl_navigation_action_count(0, 3), 'distance 0 → 0 actions');
                test_same(1, obl_navigation_action_count(1, 3), 'distance 1 → 1 action');
                test_same(1, obl_navigation_action_count(3, 3), 'distance 3 → 1 action');
                test_same(2, obl_navigation_action_count(4, 3), 'distance 4 → 2 actions');
                test_same(2, obl_navigation_action_count(6, 3), 'distance 6 → 2 actions');
                test_same(3, obl_navigation_action_count(7, 3), 'distance 7 → 3 actions');
                // move_power=1 防御
                test_same(5, obl_navigation_action_count(5, 1), 'distance 5 with move_power=1 → 5 actions');
            },

            'score_candidates_returns_first_by_tendency' => static function (): void {
                // 验证候选排序函数：四种倾向对同一候选集选不同目标
                $candidates = [
                    ['pls' => 4,  'distance' => 1, 'tide' => 'shallow', 'tide_weight' => 1],
                    ['pls' => 17, 'distance' => 1, 'tide' => 'shallow', 'tide_weight' => 1],
                    ['pls' => 24, 'distance' => 1, 'tide' => 'shallow', 'tide_weight' => 1],
                    ['pls' => 27, 'distance' => 2, 'tide' => 'deep',    'tide_weight' => 2],
                    ['pls' => 23, 'distance' => 2, 'tide' => 'deep',    'tide_weight' => 2],
                    ['pls' => 9,  'distance' => 4, 'tide' => 'abyss',   'tide_weight' => 3],
                ];
                // steady：distance 升序 → tide_weight 升序 → pls 升序 → 选 4
                $steady = obl_navigation_score_tendency_candidates($candidates, 'steady', 3);
                test_same(4, (int)$steady['pls'], 'steady selects nearest shallow (pls=4)');

                // nearby：action_count 升序 → distance 升序 → pls 升序 → 选 4
                $nearby = obl_navigation_score_tendency_candidates($candidates, 'nearby', 3);
                test_same(4, (int)$nearby['pls'], 'nearby selects min action count (pls=4)');

                // deep：tide_weight 降序 → distance 升序 → pls 升序 → 选 9（abyss, w=3）
                $deep = obl_navigation_score_tendency_candidates($candidates, 'deep', 3);
                test_same(9, (int)$deep['pls'], 'deep selects highest tide weight (pls=9 abyss)');

                // efficient：distance 降序 → tide_weight 升序 → 选 9（distance 4 最远）
                $efficient = obl_navigation_score_tendency_candidates($candidates, 'efficient', 3);
                test_same(9, (int)$efficient['pls'], 'efficient selects farthest (pls=9 distance 4)');
            },

            'score_candidates_returns_null_on_empty' => static function (): void {
                // 空候选集返回 null
                $result = obl_navigation_score_tendency_candidates([], 'steady', 3);
                test_same(null, $result, 'empty candidates returns null');
            },
        ]),

        // ================================================================
        // 8. 已知缺口审计（首期决策保持简化，本节记录现状）
        // ================================================================
        test_run_cases('known_gaps_audit', [

            'priority_3_hidden_enemy_search_todo_documented' => static function (): void {
                // 已知缺口：优先级 3 隐藏敌人搜索位置未实现（§5.4）
                // navigation.func.php select_target 函数体中 TODO 占位
                // 决策：保持简化，待敌人 AI 系统稳定后实现
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_select_target');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                // TODO 占位存在（说明优先级 3 是已记录的已知缺口）
                test_assert(strpos($funcBody, 'TODO') !== false, 'hidden enemy search TODO placeholder present');
                // 优先级 3 函数未被调用：TODO 注释中提到函数名，但函数体中无实际调用
                test_assert(strpos($funcBody, 'obl_navigation_select_hidden_enemy_search_position(') === false,
                    'priority 3 function not called (deferred, only mentioned in TODO comment)');
                // 函数返回 null（不静默选其他目标）
                test_assert(strpos($funcBody, 'return null') !== false, 'returns null when no priority matches');
            },

            'priority_3_isolated_unexplored_tile_no_separate_function' => static function (): void {
                // 已知缺口：优先级 3 "暂时被隔绝的未探索格" 无单独实现
                // 语义等价：优先级 1 BFS 不可达时降级到优先级 2
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_select_target');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'obl_navigation_select_unexplored_tile') !== false,
                    'priority 1: unexplored_tile selector');
                test_assert(strpos($funcBody, 'obl_navigation_select_undiscovered_poi') !== false,
                    'priority 2: undiscovered_poi selector');
                test_assert(strpos($funcBody, 'obl_navigation_select_isolated_unexplored') === false,
                    'no separate selector for isolated unexplored tiles (semantically equivalent to BFS unreachable)');
            },

            'select_unexplored_tile_returns_null_when_unreachable' => static function () use ($room): void {
                // 验证优先级 1 不可达时的语义：BFS 在无可达未探索格时返回 null
                // 使用 pgroup=999（无地图），$pls 不在 tiles 中
                $room->resetData();
                $player = $room->player('prio-unreachable', 0, ['pgroup' => 999, 'pls' => 1]);
                $target = obl_navigation_select_unexplored_tile(999, 1, 'steady', $player);
                test_same(null, $target, 'select_unexplored_tile returns null when no map data (unreachable)');
            },

            'select_unexplored_tile_returns_null_when_all_within_distance_filtered' => static function () use ($room): void {
                // 边界案例：候选全部超过倾向距离上限时返回 null
                // 通过源码审计验证：select_unexplored_tile 在 filtered 为空时返回 null
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/navigation.func.php');
                $funcStart = strpos($source, 'function obl_navigation_select_unexplored_tile');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                test_assert(strpos($funcBody, 'empty($filtered)') !== false, 'filtered empty check exists');
                test_assert(strpos($funcBody, "return null") !== false, 'returns null when filtered candidates empty');
            },
        ])
    );
};
