<?php
declare(strict_types=1);

/**
 * F-E3-Map §三 不变量单测：单位占位 + 拓扑通行
 *
 * 覆盖：
 *   - 单位占位校验（§三.8：一格一单位；玩家/敌人不重叠；尸体不占位）
 *   - 拓扑通行（§三.3-§三.5：背景墙非图格、连接状态非假图格、动态通行状态）
 *   - explored 与通行独立性（§三.6/§三.7：不可通行格不被伪造为已探索）
 *
 * 依赖 region_1.php 图格数据：
 *   tile 1: passable=true, neighbors=[24,17,5,4]
 *   tile 4: passable=true, neighbors=[27,28,29,23,5,1,2]
 *   tile 5: passable=false（背景墙"高耸的废铁山"）
 *   tile 24: passable=true, neighbors=[17,18,25,1]
 */

return static function (TestRoom $room): array {
    // 读取 tile 的 passable 与 explored
    $tileInfo = static function (int $pls): array {
        $map = obl_get_map_data(1);
        $tile = $map['tiles'][1][$pls] ?? null;
        return $tile
            ? ['passable' => !empty($tile['passable']), 'neighbors' => $tile['neighbors'] ?? []]
            : ['passable' => false, 'neighbors' => []];
    };
    $explored = static function (int $pls) use ($room): int {
        global $db;
        $result = $db->query("SELECT explored FROM {$room->prefix}oblmapstates WHERE pgroup=1 AND pls={$pls} LIMIT 1");
        $row = $db->fetch_array($result);
        return $row ? (int)$row['explored'] : 0;
    };

    return test_run_cases('navigation_integration', [
        // ===== 单位占位校验（F-E3-Map §三.8）=====

        'perform_move_core_blocked_by_other_player' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            $room->player('occupier', 0, ['pls' => 4]);
            // tile 1 -> tile 4（直连邻居，距离 1）
            $result = obl_perform_move_core($actor, 4, 3);
            test_assert(empty($result['success']), 'move blocked by other player in target tile');
            test_same('occupied', $result['reason'], 'reason=occupied');
        },

        'perform_move_core_blocked_by_enemy' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            $room->player('enemy', 1, ['pls' => 4]); // type=1 敌人
            $result = obl_perform_move_core($actor, 4, 3);
            test_assert(empty($result['success']), 'move blocked by enemy in target tile');
            test_same('occupied', $result['reason'], 'reason=occupied');
        },

        'perform_move_core_allows_tile_with_corpse' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            // 尸体：state>0 不再是占据图格的单位
            $room->player('corpse', 0, ['pls' => 4, 'state' => 5]);
            $result = obl_perform_move_core($actor, 4, 3);
            test_assert(!empty($result['success']), 'move allowed to tile with corpse (state>0 not a unit)');
            test_same('success', $result['reason'], 'reason=success');
            test_same(4, (int)$actor['pls'], 'actor moved to tile 4');
        },

        'perform_move_core_succeeds_to_empty_tile' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            $result = obl_perform_move_core($actor, 4, 3);
            test_assert(!empty($result['success']), 'move succeeds to empty tile');
            test_same(1, $result['distance'], 'distance=1 (direct neighbor)');
            test_same(4, (int)$actor['pls'], 'actor moved to tile 4');
        },

        'get_pids_in_tile_alive_only_filters_dead_but_default_keeps_them' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('self', 0, ['pls' => 4]);
            $alive = $room->player('alive', 0, ['pls' => 4]);
            $dead = $room->player('dead', 0, ['pls' => 4, 'state' => 3]);
            $actor_pid = (int)$actor['pid'];
            $alive_pid = (int)$alive['pid'];
            $dead_pid = (int)$dead['pid'];
            // 默认 alive_only=false：返回全部（含死体）——为战斗捕获 TARGET_DEAD 跳过保留兼容
            $all = obl_get_pids_in_tile(1, 4, 0);
            sort($all);
            test_same(3, count($all), 'default alive_only=false returns 3 units (corpse kept for battle capture)');
            test_assert(in_array($actor_pid, $all, true), 'actor in default result');
            test_assert(in_array($alive_pid, $all, true), 'alive in default result');
            test_assert(in_array($dead_pid, $all, true), 'corpse kept in default result (battle capture compat)');
            // alive_only=true：仅活单位——移动占位语义（尸体不阻挡移动）
            $living = obl_get_pids_in_tile(1, 4, 0, true);
            sort($living);
            test_same(2, count($living), 'alive_only=true returns 2 living units (corpse filtered)');
            test_assert(!in_array($dead_pid, $living, true), 'corpse absent from alive_only result');
            // 排除 actor 自己 + alive_only=true
            $excluded = obl_get_pids_in_tile(1, 4, $actor_pid, true);
            test_same([$alive_pid], $excluded, 'self excluded + alive_only returns only other living unit');
        },

        // ===== 拓扑通行（F-E3-Map §三.3-§三.5）=====

        'perform_move_core_rejects_impassable_tile' => static function () use ($room, $tileInfo): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            // tile 5 是背景墙（passable=false），是 tile 1 的直连邻居
            $info = $tileInfo(5);
            test_assert(empty($info['passable']), 'tile 5 is impassable (background wall)');
            $result = obl_perform_move_core($actor, 5, 3);
            test_assert(empty($result['success']), 'move to impassable tile rejected');
            test_same('blocked', $result['reason'], 'reason=blocked');
        },

        'perform_move_core_rejects_nonexistent_tile' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            $result = obl_perform_move_core($actor, 999, 3);
            test_assert(empty($result['success']), 'move to nonexistent tile rejected');
            test_same('invalid_target', $result['reason'], 'reason=invalid_target');
        },

        'neighbors_reference_real_tiles_not_fake_wall_tiles' => static function () use ($room): void {
            $room->resetData();
            // §三.5 连接状态 ≠ 假图格：墙是 neighbors 缺失，不是插入假图格
            // 验证：region 1 每个图格的 neighbors 都指向真实存在的图格 ID（无悬挂/虚假引用）
            $map = obl_get_map_data(1);
            $tiles = $map['tiles'][1] ?? [];
            $all_ids = array_keys($tiles);
            $dangling = [];
            foreach ($tiles as $pls => $tile) {
                foreach (($tile['neighbors'] ?? []) as $neighbor) {
                    if (!isset($tiles[(int)$neighbor])) $dangling[] = "tile {$pls} -> dangling {$neighbor}";
                }
            }
            test_same([], $dangling, 'all neighbor references point to real tiles (no fake connector tiles)');
            // 背景墙 tile 5 是真实图格（有内容）但 passable=false，不是"两个图格之间的假图格"
            test_assert(isset($tiles[5]), 'tile 5 exists as a real tile (wall tile, not a fake connector)');
            test_assert(empty($tiles[5]['passable']), 'tile 5 is impassable');
        },

        'select_unexplored_tile_skips_impassable' => static function () use ($room, $tileInfo, $explored): void {
            $room->resetData();
            // 标记 tile 1 的所有可通行邻居为已探索，仅留 tile 5（不可通行）未探索
            // BFS 应跳过 tile 5，返回更远的可通行未探索格
            obl_mark_explored(1, 24);
            obl_mark_explored(1, 17);
            obl_mark_explored(1, 4);
            // tile 5 未探索但不可通行——不应被选为目标
            test_same(0, $explored(5), 'tile 5 unexplored');
            $pdata = ['pgroup' => 1, 'pls' => 1];
            $target = obl_navigation_select_unexplored_tile(1, 1, 'steady', $pdata);
            test_assert($target !== null, 'a passable unexplored target is found');
            test_assert((int)$target !== 5, 'impassable tile 5 never selected as navigation target');
            $targetInfo = $tileInfo((int)$target);
            test_assert(!empty($targetInfo['passable']), 'selected target is passable');
        },

        // ===== explored 与通行独立性（F-E3-Map §三.6/§三.7）=====

        'impassable_tile_never_marked_explored' => static function () use ($room, $explored): void {
            $room->resetData();
            $actor = $room->player('actor', 0, ['pls' => 1]);
            // 尝试移动到不可通行 tile 5（应失败）
            $result = obl_perform_move_core($actor, 5, 3);
            test_assert(empty($result['success']), 'move to impassable fails');
            // 不可通行格不会被站上，因此不会被标记 explored（§三.7）
            test_same(0, $explored(5), 'impassable tile never marked explored');
            // 清除 tile 5 的迷雾也不应写 explored
            obl_clear_fog(1, [5 => ['distance' => 1]]);
            test_same(0, $explored(5), 'impassable tile still not explored after fog clear (revealed != explored)');
        },

        'explored_survives_when_tile_becomes_blocked' => static function () use ($room, $explored): void {
            $room->resetData();
            // §三.6 已探索图格被破坏后仍保持已探索
            // 模拟：先站上 tile 4（explored=1），随后即使该格"被破坏"（passable=false 模拟），
            // explored 字段独立于通行状态，不应回退
            obl_mark_explored(1, 4);
            test_same(1, $explored(4), 'tile 4 explored after standing');
            // 模拟"被破坏为不可通行"——只影响 passable 数据层，不触碰 explored 字段
            // （damaged 字段未启用，此处验证 explored 不被任何现有路径回退）
            // 再次清除迷雾、再次标记 explored（幂等）—— explored 保持 1
            obl_clear_fog(1, [4 => ['distance' => 1]]);
            test_same(1, $explored(4), 'explored stays 1 (independent of通行状态, never reverts)');
            obl_mark_explored(1, 4);
            test_same(1, $explored(4), 'explored stays 1 after re-mark (idempotent, persistent)');
        },
    ]);
};
