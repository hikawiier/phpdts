<?php
declare(strict_types=1);

/**
 * F-E3-Map §三 不变量单测：地图认知三态（currently_visible / revealed / explored）
 *
 * 覆盖：
 *   - explored 写入唯一性（唯一入口 obl_mark_explored，仅落点写）
 *   - 三态独立性（revealed 不蕴含 explored；explored 蕴含 revealed 但反向不成立）
 *   - explored 持久性（不因再次清除迷雾而回退）
 *
 * currently_visible 是运行时计算态（obl_calc_vision_range），不持久化，
 * 故本文件不直接断言该字段，而是通过 revealed/explored 的独立性间接验证三态分离。
 */

return static function (TestRoom $room): array {
    // 读取 oblmapstates 行的 fog（revealed）与 explored 字段；行不存在视为双 0
    $mapstate = static function (int $pls) use ($room): array {
        global $db;
        $result = $db->query("SELECT fog, explored FROM {$room->prefix}oblmapstates WHERE pgroup=1 AND pls={$pls} LIMIT 1");
        $row = $db->fetch_array($result);
        return $row
            ? ['revealed' => (int)$row['fog'], 'explored' => (int)$row['explored']]
            : ['revealed' => 0, 'explored' => 0];
    };

    return test_run_cases('info_acquire', [
        // ===== explored 写入唯一性（F-E3-Map §三.1）=====

        'obl_mark_explored_sets_explored_and_revealed_on_landing_tile' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // 玩家真实站上 tile 4 → explored=1，且因站上必揭示 fog=1
            obl_mark_explored(1, 4);
            $state = $mapstate(4);
            test_same(1, $state['explored'], 'explored=1 after standing on tile');
            test_same(1, $state['revealed'], 'revealed=1 after standing (standing reveals tile)');
        },

        'obl_mark_explored_is_idempotent' => static function () use ($room, $mapstate): void {
            $room->resetData();
            obl_mark_explored(1, 4);
            obl_mark_explored(1, 4);
            obl_mark_explored(1, 4);
            $state = $mapstate(4);
            test_same(1, $state['explored'], 'explored stays 1 after repeated idempotent calls');
            test_same(1, $state['revealed'], 'revealed stays 1');
        },

        'clear_fog_does_not_write_explored' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // 点亮迷雾（远程观察等价）但玩家未站上 → revealed=1, explored=0
            obl_clear_fog(1, [4 => ['distance' => 1], 10 => ['distance' => 2]]);
            $s4 = $mapstate(4);
            $s10 = $mapstate(10);
            test_same(1, $s4['revealed'], 'tile 4 revealed after clear_fog');
            test_same(0, $s4['explored'], 'tile 4 explored stays 0 (clear_fog must not write explored)');
            test_same(1, $s10['revealed'], 'tile 10 revealed');
            test_same(0, $s10['explored'], 'tile 10 explored stays 0');
        },

        'reveal_without_standing_keeps_explored_zero' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // TestRoom::reveal 直接写 fog=1，不经过 obl_mark_explored
            $room->reveal(24, 17);
            test_same(1, $mapstate(24)['revealed'], 'tile 24 revealed');
            test_same(0, $mapstate(24)['explored'], 'tile 24 not explored (revealed without standing)');
            test_same(0, $mapstate(17)['explored'], 'tile 17 not explored');
        },

        'obl_mark_explored_preserves_existing_refresh_metadata' => static function () use ($room, $mapstate): void {
            $room->resetData();
            global $db;
            // 预置一条带野生道具刷新元数据的记录
            $db->query("INSERT INTO {$room->prefix}oblmapstates(pgroup,pls,fog,damaged,flags,explored,last_refresh_day,refresh_count)
                        VALUES (1,4,1,0,'',0,7,3)");
            // 站上 tile 4：应只更新 explored=1（fog 已是 1），不重置刷新元数据
            obl_mark_explored(1, 4);
            $result = $db->query("SELECT fog,explored,last_refresh_day,refresh_count FROM {$room->prefix}oblmapstates WHERE pgroup=1 AND pls=4 LIMIT 1");
            $row = $db->fetch_array($result);
            test_same(1, (int)$row['explored'], 'explored=1');
            test_same(1, (int)$row['fog'], 'fog stays 1');
            test_same(7, (int)$row['last_refresh_day'], 'refresh metadata preserved (not reset by obl_mark_explored)');
            test_same(3, (int)$row['refresh_count'], 'refresh_count preserved');
        },

        // ===== 三态独立性（F-E3-Map §三.2）=====

        'revealed_does_not_imply_explored' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // revealed=true, explored=0：清除迷雾但未站上
            obl_clear_fog(1, [4 => ['distance' => 1]]);
            $state = $mapstate(4);
            test_same(1, $state['revealed'], 'revealed=true');
            test_same(0, $state['explored'], 'explored=false (revealed independent of explored)');
        },

        'explored_implies_revealed_but_not_vice_versa' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // 站上 tile 4 → explored=1 且 revealed=1（站上必揭示）
            obl_mark_explored(1, 4);
            $s4 = $mapstate(4);
            test_same(1, $s4['explored'], 'explored=true');
            test_same(1, $s4['revealed'], 'revealed=true (standing reveals)');
            // 反向不成立：揭示不蕴含探索
            obl_clear_fog(1, [10 => ['distance' => 1]]);
            $s10 = $mapstate(10);
            test_same(1, $s10['revealed'], 'tile 10 revealed');
            test_same(0, $s10['explored'], 'tile 10 not explored (revealed does not imply explored)');
        },

        'explored_is_persistent_across_fog_operations' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // 站上 tile 4
            obl_mark_explored(1, 4);
            test_same(1, $mapstate(4)['explored'], 'explored=1 after standing');
            // 再次清除迷雾（模拟后续视野刷新）—— explored 不应回退
            obl_clear_fog(1, [4 => ['distance' => 1]]);
            test_same(1, $mapstate(4)['explored'], 'explored stays 1 after re-clearing fog (persistent)');
            // 多次清除仍保持
            obl_clear_fog(1, [4 => ['distance' => 1], 10 => ['distance' => 2]]);
            test_same(1, $mapstate(4)['explored'], 'explored stays 1 after repeated fog clears');
        },

        'independent_tiles_do_not_cross_contaminate' => static function () use ($room, $mapstate): void {
            $room->resetData();
            // 站上 tile 4，清除 tile 10 的迷雾——两者互不影响
            obl_mark_explored(1, 4);
            obl_clear_fog(1, [10 => ['distance' => 1]]);
            test_same(1, $mapstate(4)['explored'], 'tile 4 explored (only standing tile)');
            test_same(0, $mapstate(10)['explored'], 'tile 10 not explored (independent)');
            test_same(1, $mapstate(10)['revealed'], 'tile 10 revealed (fog cleared)');
            test_assert($mapstate(4)['explored'] === 1 && $mapstate(10)['explored'] === 0, 'states are per-tile independent');
        },
    ]);
};
