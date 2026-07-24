<?php
declare(strict_types=1);

/**
 * 子任务 2A.2：统一信息获取框架单测（F-E4-Info）
 *
 * 覆盖 F-E4-Info §三 不变量 + §5 设计要求：
 *   1. 移动后基础信息获取（迷雾清除 + 概率性道具/敌人发现）— §三.1, §5.1
 *   2. 探索后强化信息获取（更高概率/更大预算）— §三.3, §5.3
 *   3. POI 100% 发现（进入信息范围即发现，不受概率/预算限制）— §三.4, §5.4
 *   4. 注意力等级（normal/item/important/force 4 级）— §5.5
 *   5. 发现合并（同一次信息获取 = 一个发现批次）— §三.9, §5.5
 *   6. 战斗场景移动过滤（combat_move 只点亮迷雾，不弹 POI/道具/敌人）— §5.3
 *   7. 信息显著度保底（最终落脚格基础地图信息和迷雾必定获得）— §三.10, §5.4
 *   8. 探索降级等待与统一信息获取的关系 — §六.5
 *
 * 依赖 region_1.php 图格数据：
 *   tile 1 (passable, neighbors=[24,17,5,4], entrance)
 *   tile 4 (passable, neighbors=[...,1,2])
 *   tile 5 (impassable, neighbor of 1)
 *   tile 24 (passable, neighbor of 1)
 *   vision_range=1 → visible_tiles from tile 1 = {1:0, 24:1, 17:1, 5:1, 4:1}
 *
 * @module E 游戏逻辑
 * @framework E-7 探索与交互管道
 */

return static function (TestRoom $room): array {
    // 插入道具到 oblmapitem（最小字段集，其余走 schema 默认值）
    $insertItem = static function (int $pls, string $item_id = 'test_item', int $discovered = 0) use ($room): int {
        global $db;
        $db->query("INSERT INTO {$room->prefix}oblmapitem (pgroup, pls, item_id, discovered)
                    VALUES (1, {$pls}, '" . $db->escape_string($item_id) . "', {$discovered})");
        $result = $db->query("SELECT LAST_INSERT_ID() AS iid");
        return (int)$db->fetch_array($result)['iid'];
    };

    // 插入 POI 到 oblmappoi（最小字段集）
    $insertPoi = static function (int $pls, string $poi_id = 'test_poi', int $discovered = 0) use ($room): int {
        global $db;
        $db->query("INSERT INTO {$room->prefix}oblmappoi (pgroup, pls, poi_id, discovered)
                    VALUES (1, {$pls}, '" . $db->escape_string($poi_id) . "', {$discovered})");
        $result = $db->query("SELECT LAST_INSERT_ID() AS iaid");
        return (int)$db->fetch_array($result)['iaid'];
    };

    // 读取 POI discovered 状态
    $poiDiscovered = static function (int $iaid) use ($room): int {
        global $db;
        $result = $db->query("SELECT discovered FROM {$room->prefix}oblmappoi WHERE iaid={$iaid} LIMIT 1");
        $row = $db->fetch_array($result);
        return $row ? (int)$row['discovered'] : -1;
    };

    // 读取道具 discovered 状态
    $itemDiscovered = static function (int $iid) use ($room): int {
        global $db;
        $result = $db->query("SELECT discovered FROM {$room->prefix}oblmapitem WHERE iid={$iid} LIMIT 1");
        $row = $db->fetch_array($result);
        return $row ? (int)$row['discovered'] : -1;
    };

    // 读取图格 fog 状态
    $fogState = static function (int $pls) use ($room): int {
        global $db;
        $result = $db->query("SELECT fog FROM {$room->prefix}oblmapstates WHERE pgroup=1 AND pls={$pls} LIMIT 1");
        $row = $db->fetch_array($result);
        return $row ? (int)$row['fog'] : 0;
    };

    return array_merge(
        // ===================================================================
        // 1. 三档配置差异（F-E4-Info §5.3 / 设计案 §4.7）
        // ===================================================================
        test_run_cases('info_config', [
            'move_config_base_budget_full_filter' => static function (): void {
                $cfg = obl_get_info_config('move');
                test_same('move', $cfg['action_type'], 'action_type=move');
                test_same(1, $cfg['info_budget'], 'move info_budget=1 (base)');
                test_same(1.0, $cfg['discover_prob_modifier'], 'move prob_modifier=1.0');
                test_same(['fog', 'map', 'items', 'enemies', 'poi'], $cfg['scene_filter'], 'move filter=full set');
            },

            'explore_config_stronger_budget_full_filter' => static function (): void {
                $cfg = obl_get_info_config('explore');
                test_same('explore', $cfg['action_type'], 'action_type=explore');
                // null 表示技能化上限（>=discover_base=3），强化于 move 的 1
                test_same(null, $cfg['info_budget'], 'explore info_budget=null (skill-based)');
                test_same(1.5, $cfg['discover_prob_modifier'], 'explore prob_modifier=1.5 (stronger)');
                test_same(['fog', 'map', 'items', 'enemies', 'poi'], $cfg['scene_filter'], 'explore filter=full set');
            },

            'combat_move_config_fog_map_only' => static function (): void {
                $cfg = obl_get_info_config('combat_move');
                test_same('combat_move', $cfg['action_type'], 'action_type=combat_move');
                test_same(0, $cfg['info_budget'], 'combat_move info_budget=0 (no items)');
                test_same(0.0, $cfg['discover_prob_modifier'], 'combat_move prob_modifier=0');
                test_same(['fog', 'map'], $cfg['scene_filter'], 'combat_move filter=fog+map only');
                // 关键：combat_move 排除 items/enemies/poi
                test_assert(!in_array('items', $cfg['scene_filter'], true), 'combat_move excludes items');
                test_assert(!in_array('enemies', $cfg['scene_filter'], true), 'combat_move excludes enemies');
                test_assert(!in_array('poi', $cfg['scene_filter'], true), 'combat_move excludes poi');
            },

            'unknown_action_falls_back_to_move' => static function (): void {
                $cfg = obl_get_info_config('bogus_action');
                test_same('move', $cfg['action_type'], 'unknown action falls back to move');
                test_same(1, $cfg['info_budget'], 'fallback uses move budget');
            },

            'explore_stronger_than_move' => static function (): void {
                // 设计案 §4.7：探索通常拥有更高发现概率、信息预算或范围补正
                $move = obl_get_info_config('move');
                $explore = obl_get_info_config('explore');
                // 概率补正：explore > move
                test_assert(
                    (float)$explore['discover_prob_modifier'] > (float)$move['discover_prob_modifier'],
                    'explore prob_modifier > move'
                );
                // 预算：explore=null 解析为 obl_get_discovery_limit（>=3）> move=1
                $pdata = ['skillpara' => []];
                $explore_budget = obl_get_discovery_limit($pdata);
                test_assert($explore_budget > $move['info_budget'], 'explore effective budget > move budget');
            },
        ]),

        // ===================================================================
        // 2. 移动后基础信息获取（F-E4-Info §三.1, §5.1）
        // ===================================================================
        test_run_cases('move_basic', [
            'move_clears_fog_for_visible_tiles' => static function () use ($room, $fogState): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                // 落脚格 1 必定清除迷雾（§5.4 保底）
                test_assert(in_array(1, $result['fog_cleared'], true), 'landing tile 1 fog cleared');
                // 视野内邻居也清除
                test_assert(in_array(4, $result['fog_cleared'], true), 'tile 4 fog cleared');
                test_assert(in_array(24, $result['fog_cleared'], true), 'tile 24 fog cleared');
                test_assert(in_array(17, $result['fog_cleared'], true), 'tile 17 fog cleared');
                // 不可通行格 5 仍可见（迷雾清除），但视野不扩展
                test_assert(in_array(5, $result['fog_cleared'], true), 'tile 5 (impassable) still revealed');
                // DB 验证
                foreach ([1, 4, 24, 17, 5] as $pls) {
                    test_same(1, $fogState($pls), "tile {$pls} fog=1 in DB");
                }
            },

            'move_normal_attention_when_nothing_discovered' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                // 空场景：仅迷雾清除，注意力=normal
                test_same('normal', $result['attention'], 'attention=normal (no discoveries)');
                test_same([], $result['items_discovered'], 'no items');
                test_same([], $result['enemies_discovered'], 'no enemies');
                test_same([], $result['pois_discovered'], 'no pois');
            },

            'post_move_hook_returns_structured_result' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_post_move_hook($player);
                test_assert(is_array($result), 'post_move_hook returns structured result');
                test_same('move', $result['action_type'], 'uses move config');
                test_assert(in_array(1, $result['fog_cleared'], true), 'fog cleared');
                // 同时标记 explored（§4.6 仅落点写）
                global $db;
                $r = $db->query("SELECT explored FROM {$room->prefix}oblmapstates WHERE pgroup=1 AND pls=1 LIMIT 1");
                test_same(1, (int)$db->fetch_array($r)['explored'], 'explored=1 (landing tile)');
            },
        ]),

        // ===================================================================
        // 3. 探索后强化信息获取（F-E4-Info §三.3, §5.3）
        // ===================================================================
        test_run_cases('explore_stronger', [
            'move_budget_limits_items_to_one' => static function () use ($room, $insertItem, $itemDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                // 在视野内（tile 4）放置 5 个未发现道具
                $iids = [];
                for ($i = 0; $i < 5; $i++) {
                    $iids[] = $insertItem(4, 'scrap_' . $i);
                }
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                // move info_budget=1 → 最多发现 1 个
                $discovered_count = 0;
                foreach ($iids as $iid) {
                    if ($itemDiscovered($iid) > 0) $discovered_count++;
                }
                test_same(1, $discovered_count, 'move budget=1 → exactly 1 item discovered');
                test_same(1, count($result['items_discovered']), '1 item in result');
            },

            'explore_budget_discovers_more_than_move' => static function () use ($room, $insertItem, $itemDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                // 放置 5 个未发现道具
                $iids = [];
                for ($i = 0; $i < 5; $i++) {
                    $iids[] = $insertItem(4, 'scrap_' . $i);
                }
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('explore'));
                // explore info_budget=null → 解析为 obl_get_discovery_limit = 3（scavenge Lv0）
                $discovered_count = 0;
                foreach ($iids as $iid) {
                    if ($itemDiscovered($iid) > 0) $discovered_count++;
                }
                test_same(3, $discovered_count, 'explore budget=3 → exactly 3 items discovered (more than move=1)');
                test_same(3, count($result['items_discovered']), '3 items in result');
            },

            'explore_attention_item_when_only_items' => static function () use ($room, $insertItem): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertItem(4, 'scrap');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('explore'));
                test_assert(!empty($result['items_discovered']), 'items discovered');
                test_same('item', $result['attention'], 'items only → attention=item');
            },
        ]),

        // ===================================================================
        // 4. POI 100% 发现（F-E4-Info §三.4, §5.4）
        // ===================================================================
        test_run_cases('poi_discovery', [
            'poi_within_range_always_discovered' => static function () use ($room, $insertPoi, $poiDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $iaid = $insertPoi(4, 'chest');
                test_same(0, $poiDiscovered($iaid), 'POI initially undiscovered');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same(1, $poiDiscovered($iaid), 'POI 100% discovered within range');
                test_same(1, count($result['pois_discovered']), '1 POI in result');
                test_same($iaid, $result['pois_discovered'][0]['iaid'], 'iaid matches');
                test_same(4, $result['pois_discovered'][0]['pls'], 'pls matches');
                test_same('chest', $result['pois_discovered'][0]['poi_id'], 'poi_id matches');
            },

            'poi_discovery_upgrades_attention_to_important' => static function () use ($room, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertPoi(4, 'chest');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same('important', $result['attention'], 'POI → attention=important');
            },

            'poi_outside_range_not_discovered' => static function () use ($room, $insertPoi, $poiDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                // tile 2 不在 tile 1 的 neighbors 中（不是直连邻居）
                $iaid = $insertPoi(2, 'far_chest');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same(0, $poiDiscovered($iaid), 'POI outside range stays undiscovered');
                test_same([], $result['pois_discovered'], 'no POI in result');
            },

            'poi_already_discovered_idempotent' => static function () use ($room, $insertPoi, $poiDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $iaid = $insertPoi(4, 'chest', 1); // already discovered
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same(1, $poiDiscovered($iaid), 'POI stays discovered');
                test_same([], $result['pois_discovered'], 'no new POI (idempotent)');
            },

            'multiple_pois_all_discovered' => static function () use ($room, $insertPoi, $poiDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $iaid1 = $insertPoi(4, 'chest_a');
                $iaid2 = $insertPoi(24, 'chest_b');
                $iaid3 = $insertPoi(17, 'chest_c');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same(1, $poiDiscovered($iaid1), 'POI 1 discovered');
                test_same(1, $poiDiscovered($iaid2), 'POI 2 discovered');
                test_same(1, $poiDiscovered($iaid3), 'POI 3 discovered');
                test_same(3, count($result['pois_discovered']), '3 POIs discovered (100% within range)');
            },
        ]),

        // ===================================================================
        // 5. 注意力等级（F-E4-Info §5.5）
        // ===================================================================
        test_run_cases('attention_levels', [
            'normal_when_only_fog_cleared' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same('normal', $result['attention'], 'no discoveries → normal');
            },

            'item_when_only_items_discovered' => static function () use ($room, $insertItem): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertItem(4, 'scrap');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same('item', $result['attention'], 'items only → item (does not interrupt navigation)');
            },

            'important_when_enemy_discovered' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                // type=1 敌人，discovered=0，在视野内（tile 4, distance=1）
                $room->player('enemy1', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 0]);
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_assert(!empty($result['enemies_discovered']), 'enemy discovered');
                test_same('important', $result['attention'], 'enemy → important (interrupts navigation)');
            },

            'important_when_poi_discovered' => static function () use ($room, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertPoi(4, 'chest');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same('important', $result['attention'], 'POI → important');
            },

            'important_overrides_item' => static function () use ($room, $insertItem, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertItem(4, 'scrap');
                $insertPoi(4, 'chest');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_assert(!empty($result['items_discovered']), 'items discovered');
                test_assert(!empty($result['pois_discovered']), 'pois discovered');
                test_same('important', $result['attention'], 'both → important overrides item');
            },

            'force_level_set_externally_not_internally' => static function (): void {
                // F-E4-Info §5.5：force 等级由外部事件触发器设置（陷阱/突袭/战斗）
                // obl_acquire_information 内部不设置 force（只设置 normal/item/important）
                $source = file_get_contents(GAME_ROOT . 'oblivions/include/game/info_acquire.func.php');
                $funcStart = strpos($source, 'function obl_acquire_information');
                $funcEnd = strpos($source, "\n}", $funcStart);
                $funcBody = substr($source, $funcStart, $funcEnd - $funcStart);
                // 内部只设置 normal/item/important
                test_assert(strpos($funcBody, "'normal'") !== false, 'normal set internally');
                test_assert(strpos($funcBody, "'item'") !== false, 'item set internally');
                test_assert(strpos($funcBody, "'important'") !== false, 'important set internally');
                // force 不在内部赋值（保留给外部事件触发器）
                test_assert(
                    strpos($funcBody, "attention'] = 'force'") === false,
                    'force not assigned internally (reserved for external: traps/ambush/combat)'
                );
                // 4 级枚举在函数前的文档注释中声明（phpdoc 位于 function 关键字之前）
                // 提取函数声明前的 phpdoc 块（从最近的 /** 到 function 之间）
                $docEnd = $funcStart;
                $docStart = strrpos(substr($source, 0, $docEnd), '/**');
                $phpdoc = $docStart !== false ? substr($source, $docStart, $docEnd - $docStart) : '';
                test_assert(strpos($phpdoc, 'force') !== false, 'force documented in phpdoc');
                test_assert(strpos($phpdoc, 'normal') !== false, 'normal documented in phpdoc');
                test_assert(strpos($phpdoc, 'item') !== false, 'item documented in phpdoc');
                test_assert(strpos($phpdoc, 'important') !== false, 'important documented in phpdoc');
            },
        ]),

        // ===================================================================
        // 6. 发现合并（F-E4-Info §三.9, §5.5 / 设计案 §4.12）
        // ===================================================================
        test_run_cases('discovery_batch', [
            'multiple_discoveries_one_batch' => static function () use ($room, $insertItem, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertItem(4, 'scrap_1');
                $insertItem(4, 'scrap_2');
                $insertPoi(4, 'chest_1');
                $insertPoi(24, 'chest_2');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                // 一次调用 = 一个发现批次：所有发现合并在单一 result 结构中
                test_assert(is_array($result), 'single structured result (one batch)');
                test_assert(!empty($result['items_discovered']), 'items in batch');
                test_assert(!empty($result['pois_discovered']), 'pois in batch');
                test_same('important', $result['attention'], 'batch attention=highest (important)');
            },

            'all_categories_in_one_batch' => static function () use ($room, $insertItem, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertItem(4, 'scrap');
                $insertPoi(4, 'chest');
                $room->player('enemy1', 1, ['pgroup' => 1, 'pls' => 24, 'discovered' => 0]);
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                // 三类发现在同一个 result 中（不连续弹出多个模态框）
                test_assert(!empty($result['items_discovered']), 'items in batch');
                test_assert(!empty($result['enemies_discovered']), 'enemies in batch');
                test_assert(!empty($result['pois_discovered']), 'pois in batch');
                test_same('important', $result['attention'], 'batch attention=important');
            },
        ]),

        // ===================================================================
        // 7. 战斗场景移动过滤（F-E4-Info §5.3）
        // ===================================================================
        test_run_cases('combat_move_filter', [
            'combat_move_clears_fog_no_items' => static function () use ($room, $insertItem, $itemDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $iid = $insertItem(4, 'scrap');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('combat_move'));
                test_assert(in_array(1, $result['fog_cleared'], true), 'combat_move still clears fog');
                test_same([], $result['items_discovered'], 'combat_move does not discover items');
                test_same(0, $itemDiscovered($iid), 'item stays undiscovered');
            },

            'combat_move_no_poi' => static function () use ($room, $insertPoi, $poiDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $iaid = $insertPoi(4, 'chest');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('combat_move'));
                test_same([], $result['pois_discovered'], 'combat_move does not discover POI');
                test_same(0, $poiDiscovered($iaid), 'POI stays undiscovered');
            },

            'combat_move_no_enemies' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $enemy = $room->player('enemy1', 1, ['pgroup' => 1, 'pls' => 4, 'discovered' => 0]);
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('combat_move'));
                test_same([], $result['enemies_discovered'], 'combat_move does not discover enemies');
                global $db;
                $r = $db->query("SELECT discovered FROM {$room->prefix}oblplayers WHERE pid=" . (int)$enemy['pid'] . " LIMIT 1");
                test_same(0, (int)$db->fetch_array($r)['discovered'], 'enemy stays undiscovered');
            },

            'combat_move_attention_normal_with_full_scene' => static function () use ($room, $insertItem, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                $insertPoi(4, 'chest');
                $insertItem(4, 'scrap');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('combat_move'));
                // 即使视野内有 POI 和道具，combat_move 也不发现 → normal
                test_same('normal', $result['attention'], 'combat_move → normal (no discoveries)');
            },
        ]),

        // ===================================================================
        // 8. 信息显著度保底（F-E4-Info §三.10, §5.4）
        // ===================================================================
        test_run_cases('info_guarantees', [
            'landing_tile_fog_always_cleared' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 4]);
                $result = obl_acquire_information(1, 4, $player, obl_get_info_config('move'));
                test_assert(in_array(4, $result['fog_cleared'], true), 'landing tile 4 fog cleared (§5.4 保底)');
            },

            'landing_tile_fog_cleared_in_combat_move' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 4]);
                $result = obl_acquire_information(1, 4, $player, obl_get_info_config('combat_move'));
                // §5.3：战斗场景移动仍点亮迷雾
                test_assert(in_array(4, $result['fog_cleared'], true), 'landing fog cleared even in combat_move');
            },

            'items_not_guaranteed_at_feet' => static function () use ($room, $insertItem, $itemDiscovered): void {
                $room->resetData();
                // §5.4 不变量 5：普通道具即使位于脚下也不保证全部发现
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                // 脚下（tile 1）放 5 个未发现道具
                $iids = [];
                for ($i = 0; $i < 5; $i++) {
                    $iids[] = $insertItem(1, 'scrap_' . $i);
                }
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                // move info_budget=1，最多发现 1 个（即使脚下也不保证全部发现）
                $discovered_count = 0;
                foreach ($iids as $iid) {
                    if ($itemDiscovered($iid) > 0) $discovered_count++;
                }
                test_same(1, $discovered_count, 'only 1 item discovered at feet (budget=1, not guaranteed)');
            },

            'poi_guaranteed_at_visible_distance' => static function () use ($room, $insertPoi, $poiDiscovered): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1]);
                // POI 在视野内（tile 4, distance=1）→ 100% 发现
                $iaid = $insertPoi(4, 'chest');
                $result = obl_acquire_information(1, 1, $player, obl_get_info_config('move'));
                test_same(1, $poiDiscovered($iaid), 'POI 100% discovered (not subject to budget/probability)');
            },

            'empty_visible_tiles_returns_normal' => static function () use ($room): void {
                $room->resetData();
                // 玩家在不存在的格上 → visible_tiles 为空
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 999]);
                $result = obl_acquire_information(1, 999, $player, obl_get_info_config('move'));
                test_same([], $result['visible_tiles'], 'empty visible_tiles');
                test_same([], $result['fog_cleared'], 'no fog cleared');
                test_same('normal', $result['attention'], 'normal (no discoveries possible)');
            },
        ]),

        // ===================================================================
        // 9. 探索降级等待与统一信息获取的关系（F-E4-Info §六.5）
        // ===================================================================
        test_run_cases('explore_outcome', [
            'explore_normal_calls_acquire_with_explore_config' => static function () use ($room): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                $result = obl_explore($player);
                // 正常探索：调用 obl_acquire_information（explore 配置）
                test_same('no_discovery', $result['explore_outcome'], 'no_discovery (executed, nothing found)');
                test_assert(is_array($result['info_result']), 'info_result is array');
                test_same('explore', $result['info_result']['action_type'], 'uses explore config');
            },

            'explore_with_discovery_returns_normal' => static function () use ($room, $insertPoi): void {
                $room->resetData();
                $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                $insertPoi(4, 'chest');
                $result = obl_explore($player);
                // 探索执行 + 有发现 → normal（注意：explore_outcome=normal 表示"正常执行且有发现"）
                test_same('normal', $result['explore_outcome'], 'normal (executed with discovery)');
                test_same('important', $result['info_result']['attention'], 'attention=important (POI found)');
                test_assert(!empty($result['info_result']['pois_discovered']), 'POI discovered');
            },

            'explore_degraded_wait_returns_null_info_result' => static function () use ($room): void {
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['explore_sp_cost' => 10];
                try {
                    $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 5, 'msp' => 100]);
                    $result = obl_explore($player);
                    // 降级等待：info_result=null（未执行信息获取）
                    test_same('degraded_wait', $result['explore_outcome'], 'degraded_wait');
                    test_same(null, $result['info_result'], 'info_result=null (no acquisition)');
                    test_same('no_sp', $result['reason'], 'reason=no_sp');
                    // 降级不消耗探索体力
                    test_same(5, (int)$player['sp'], 'sp unchanged (degraded wait does not consume sp)');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            'degraded_wait_vs_no_discovery_distinct' => static function () use ($room): void {
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['explore_sp_cost' => 10];
                try {
                    // degraded_wait：探索不可执行（体力不足）
                    $p1 = $room->player('waiter', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 5, 'msp' => 100]);
                    $r1 = obl_explore($p1);
                    // no_discovery：探索正常执行但无发现
                    $p2 = $room->player('explorer', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 100, 'msp' => 100]);
                    $r2 = obl_explore($p2);
                    // 两种结果清晰区分
                    test_assert($r1['explore_outcome'] !== $r2['explore_outcome'], 'outcomes are distinct');
                    test_same('degraded_wait', $r1['explore_outcome'], 'r1=degraded_wait');
                    test_same('no_discovery', $r2['explore_outcome'], 'r2=no_discovery');
                    test_same(null, $r1['info_result'], 'degraded_wait: info_result=null');
                    test_assert(is_array($r2['info_result']), 'no_discovery: info_result=array');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },

            'degraded_wait_emits_wait_log' => static function () use ($room): void {
                global $obl_log;
                $room->resetData();
                $GLOBALS['obl_test_config_override'] = ['explore_sp_cost' => 10];
                try {
                    $player = $room->player('p', 0, ['pgroup' => 1, 'pls' => 1, 'sp' => 5, 'msp' => 100]);
                    obl_explore($player);
                    $ids = array_column($obl_log->getEntries(), 'id');
                    test_assert(in_array('wait.success', $ids, true), 'wait.success emitted');
                    test_assert(in_array('explore.degraded_to_wait', $ids, true), 'explore.degraded_to_wait emitted');
                } finally {
                    unset($GLOBALS['obl_test_config_override']);
                }
            },
        ])
    );
};
