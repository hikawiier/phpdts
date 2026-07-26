<?php
declare(strict_types=1);

/**
 * @module A API 层
 */

return static function (TestRoom $room): array {
    return test_run_cases('debug_console', [
        'debug_contract_bypasses_gameplay_gates_only' => static function () use ($room): void {
            $_GET['debug'] = 'all';
            $room->resetData();
            $actor = $room->player('debug-gate', 0, [
                'action' => 'battle',
                'hp' => 0,
                'itempara' => json_encode([['itmid' => 'occupied']]),
            ]);
            obl_format_playerdata($actor);

            $debugContract = obl_command_contract('debug.mechanism.reset');
            $debugGate = obl_command_gate('debug.mechanism.reset', $debugContract, ['mechanism' => 'battle'], [], $actor);
            test_assert(!empty($debugGate['ok']), 'debug command bypasses gameplay action/itm0/capability gates');

            $normalContract = obl_command_contract('map.move');
            $normalGate = obl_command_gate('map.move', $normalContract, ['to' => 2], [], $actor);
            test_assert(empty($normalGate['ok']), 'normal command still obeys gameplay gates');
        },

        'room_snapshot_restores_all_authoritative_tables' => static function () use ($room): void {
            global $db, $gamevars, $groomid;
            $_GET['debug'] = 'all';
            $groomid = 9001;
            $room->resetData();
            $actor = $room->player('snapshot-player', 0, ['pls' => 1, 'hp' => 73]);
            $enemy = $room->player('snapshot-enemy', 1, ['pls' => 2, 'discovered' => 1]);
            $room->reveal(1, 2);
            $room->queue($actor, 91, 1);
            $room->queue($enemy, 91, 2);
            $db->query("INSERT INTO {$room->prefix}oblmapitem(pgroup,pls,item_id,itm,itmk,itme,itms,itmsk,itmpara) VALUES (1,1,'debug_item','x','x',1,'1','','')");
            $db->query("INSERT INTO {$room->prefix}oblmappoi(poi_id,pgroup,pls,state) VALUES ('debug_poi',1,1,'idle')");
            $gamevars['obl_tick'] = 37;
            obl_runtime_save_tick_globals();

            $before = [];
            foreach (obl_debug_snapshot_tables() as $table) $before[$table] = $room->tableRows($table);
            $saved = obl_debug_snapshot_save($actor);
            test_assert(!empty($saved['ok']), 'snapshot save succeeds');

            foreach (['oblqueue', 'oblbattle_state', 'oblmapitem', 'oblmappoi', 'oblmapstates', 'oblplayers'] as $table) {
                $db->query("DELETE FROM {$room->prefix}{$table}");
            }
            $db->query("UPDATE {$room->prefix}oblgame SET vars_json='{}'");

            $restored = obl_debug_snapshot_restore($actor);
            test_assert(!empty($restored['ok']), 'snapshot restore succeeds');
            foreach (obl_debug_snapshot_tables() as $table) {
                test_same(serialize($before[$table]), serialize($room->tableRows($table)), "{$table} restored exactly");
            }
            test_same('snapshot-player', $actor['name'], 'command player context reloaded from restored row');
            test_same(37, (int)($GLOBALS['gamevars']['obl_tick'] ?? 0), 'tick globals reloaded from restored oblgame');
            obl_debug_snapshot_clear();
        },

        'adjacent_enemy_scenario_is_repeatable' => static function () use ($room): void {
            $_GET['debug'] = 'all';
            $room->resetData();
            $actor = $room->player('scenario-player', 0, ['pgroup' => 1, 'pls' => 1, 'hp' => 40, 'ap' => 0]);
            obl_format_playerdata($actor);

            $first = obl_debug_scenario_prepare(['scenario' => 'adjacent_enemy', 'enemy_type' => 1], $actor);
            test_assert(!empty($first['ok']), 'scenario preparation succeeds');
            $enemy = $first['data']['enemy'];
            test_same(1, (int)$enemy['discovered'], 'scenario enemy is visible');
            test_assert(in_array((int)$enemy['pls'], array_map('intval', obl_get_tile_neighbors(1, 1)), true), 'scenario enemy is adjacent');
            $map = obl_get_map_data(1);
            test_assert(!empty($map['tiles'][1][(int)$enemy['pls']]['passable']), 'scenario enemy tile is passable');
            test_same(100, (int)$actor['hp'], 'scenario restores player vitals');
            test_same(20, (int)$actor['ap'], 'scenario restores player AP');

            $second = obl_debug_scenario_prepare(['scenario' => 'adjacent_enemy', 'enemy_type' => 1], $actor);
            test_assert(!empty($second['ok']), 'scenario can be prepared repeatedly');
            test_same((int)$enemy['pid'], (int)$second['data']['enemy']['pid'], 'existing enemy is reused');
            test_same(1, count(array_filter($room->tableRows('oblplayers'), static fn(array $row): bool => (int)$row['type'] === 1)), 'repeat does not create duplicate enemies');
            test_same([], $room->tableRows('oblqueue'), 'scenario clears combat queue');
            test_same([], $room->tableRows('oblbattle_state'), 'scenario clears battle state');
        },

        'scenario_preflight_failure_does_not_reset_room' => static function () use ($room): void {
            $_GET['debug'] = 'all';
            $room->resetData();
            $actor = $room->player('blocked-scenario-player', 0, ['pgroup' => 1, 'pls' => 1, 'hp' => 31, 'ap' => 2]);
            foreach ([24, 17, 4] as $index => $pls) {
                $room->player('blocker-' . $index, 1, ['pgroup' => 1, 'pls' => $pls]);
            }
            obl_format_playerdata($actor);
            $before = serialize($room->tableRows('oblplayers'));

            $result = obl_debug_scenario_prepare(['scenario' => 'adjacent_enemy', 'enemy_type' => 2], $actor);
            test_assert(empty($result['ok']), 'scenario reports unavailable tile');
            test_same('DEBUG_NO_AVAILABLE_TILE', $result['code'], 'preflight failure code');
            test_same($before, serialize($room->tableRows('oblplayers')), 'preflight failure leaves actors unchanged');
        },
    ]);
};
