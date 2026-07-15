<?php
declare(strict_types=1);

function skill_test_effect_failure_execute(CombatContext $ctx): void { $ctx->declareEffect('test_failure', ['value' => 1]); }
combat_effect_register('test_failure', static function (CombatContext $ctx, array $effect): bool {
    $target = &$ctx->getCurrentTarget();
    $target['target_data']['hp']--;
    $ctx->success = false;
    $ctx->failure_reason = 'TEST_EFFECT_FAILURE';
    return false;
});

$GLOBALS['test_ap_views'] = [];
combat_tag_register('test_ap_probe', static function (CombatContext $ctx): bool {
    $GLOBALS['test_ap_views'][] = ['phase' => 'rule', 'dry' => $ctx->dry_run, 'ap' => (int)$ctx->actor_data['ap']];
    return false;
});
function skill_test_ap_view_execute(CombatContext $ctx): void {
    $GLOBALS['test_ap_views'][] = ['phase' => 'hook', 'dry' => $ctx->dry_run, 'ap' => (int)$ctx->actor_data['ap']];
    $ctx->declareEffect('damage', ['value' => 1]);
}

return static function (TestRoom $room): array {
    return test_run_cases('transaction', [
        'queue_insert_failure_leaves_no_player_membership' => static function () use ($room): void {
            global $db;
            $room->resetData(); $actor = $room->player('queue-fault-actor'); $member = $room->player('queue-fault-member', 1); $target = $room->player('queue-fault-target', 1);
            $room->queue($actor, 41, 1); $room->queue($member, 41, 2);
            $trigger = $room->prefix . 'fail_queue_insert';
            $db->query("CREATE TRIGGER {$trigger} BEFORE INSERT ON {$room->prefix}oblqueue FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test queue insert failure'");
            try {
                $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
                $config = combat_action_config_with_target(combat_skill_get_config('unarmed_strike'), ['target' => ['type' => 'pid', 'id' => $target['pid']]]);
                $ctx = new CombatContext($actor, 'unarmed_strike', $config, $log, $cache); $ctx->ap_cost = 1; $ctx->action_uid = 'queue-fault';
                $thrown = false; obl_runtime_transaction_begin();
                try { combat_pipeline_run($ctx); obl_runtime_transaction_commit(); }
                catch (Throwable $e) { $thrown = true; obl_runtime_transaction_rollback(); }
                test_assert($thrown, 'queue insert failure throws');
                $saved = $room->fetch((int)$target['pid']);
                test_same('', (string)$saved['action'], 'target action unchanged'); test_same(0, (int)$saved['bid'], 'target bid unchanged');
                test_assert(!obl_fetch_queue_by_pid((int)$target['pid']), 'no target queue row remains');
            } finally { $db->query("DROP TRIGGER IF EXISTS {$trigger}", 'SILENT'); }
        },
        'player_save_failure_removes_inserted_queue_row' => static function () use ($room): void {
            global $db;
            $room->resetData(); $actor = $room->player('player-fault-actor'); $member = $room->player('player-fault-member', 1); $target = $room->player('player-fault-target', 1);
            $room->queue($actor, 42, 1); $room->queue($member, 42, 2);
            $trigger = $room->prefix . 'fail_player_update'; $pid = (int)$target['pid'];
            $db->query("CREATE TRIGGER {$trigger} BEFORE UPDATE ON {$room->prefix}oblplayers FOR EACH ROW BEGIN IF NEW.pid={$pid} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test player save failure'; END IF; END");
            try {
                $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
                $config = combat_action_config_with_target(combat_skill_get_config('unarmed_strike'), ['target' => ['type' => 'pid', 'id' => $target['pid']]]);
                $ctx = new CombatContext($actor, 'unarmed_strike', $config, $log, $cache); $ctx->ap_cost = 1; $ctx->action_uid = 'player-fault';
                $thrown = false; obl_runtime_transaction_begin();
                try { combat_pipeline_run($ctx); obl_runtime_transaction_commit(); }
                catch (Throwable $e) { $thrown = true; obl_runtime_transaction_rollback(); }
                test_assert($thrown, 'player save failure throws');
                test_assert(!obl_fetch_queue_by_pid($pid), 'queue insert rolled back');
                $saved = $room->fetch($pid); test_same('', (string)$saved['action'], 'player action rolled back'); test_same(0, (int)$saved['bid'], 'player bid rolled back');
            } finally { $db->query("DROP TRIGGER IF EXISTS {$trigger}", 'SILENT'); }
        },
        'third_target_sql_failure_rolls_back_prior_targets' => static function () use ($room): void {
            global $db;
            $room->resetData(); $actor = $room->player('third-fault-actor', 0, ['pls' => 1, 'att' => 8]);
            $room->reveal(1);
            $a = $room->player('third-fault-a', 1, ['pls' => 1]); $b = $room->player('third-fault-b', 1, ['pls' => 1]); $c = $room->player('third-fault-c', 1, ['pls' => 1]);
            $room->queue($actor, 43, 1); $room->queue($a, 43, 2); $room->queue($b, 43, 3); $room->queue($c, 43, 4);
            $beforeFiles = $room->fileSnapshot();
            $trigger = $room->prefix . 'fail_third_target'; $pid = (int)$c['pid'];
            $db->query("CREATE TRIGGER {$trigger} BEFORE UPDATE ON {$room->prefix}oblplayers FOR EACH ROW BEGIN IF NEW.pid={$pid} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test third target failure'; END IF; END");
            try {
                $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
                $config = combat_action_config_with_target(combat_skill_get_config('grenade'), ['target' => ['type' => 'tile', 'id' => 1]]);
                $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache); $ctx->ap_cost = 2; $ctx->action_uid = 'third-fault';
                $thrown = false; obl_runtime_transaction_begin();
                try { combat_pipeline_run($ctx); obl_runtime_transaction_commit(); }
                catch (Throwable $e) { $thrown = true; obl_runtime_transaction_rollback(); }
                test_assert($thrown, 'third target SQL failure throws');
                foreach ([$a, $b, $c] as $target) test_same(100, (int)$room->fetch((int)$target['pid'])['hp'], 'all target HP rolled back');
                test_same(20, (int)$room->fetch((int)$actor['pid'])['ap'], 'actor AP rolled back');
                test_assert(!empty($log->getEntries()), 'request collector contains uncommitted entries before discard');
                test_same($beforeFiles, $room->fileSnapshot(), 'rolled-back request collector is not persisted');
            } finally { $db->query("DROP TRIGGER IF EXISTS {$trigger}", 'SILENT'); }
        },
        'npc_turn_dynamic_join_fault_rolls_back_membership' => static function () use ($room): void {
            global $db;
            $room->resetData(); $npc = $room->player('heartbeat-npc', 1); $member = $room->player('heartbeat-member', 0); $joinable = $room->player('heartbeat-joinable', 0);
            $room->queue($npc, 44, 1); $room->queue($member, 44, 2);
            $trigger = $room->prefix . 'fail_heartbeat_join';
            $db->query("CREATE TRIGGER {$trigger} BEFORE INSERT ON {$room->prefix}oblqueue FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test heartbeat join failure'");
            try {
                $thrown = false; obl_runtime_transaction_begin();
                try {
                    $turn = obl_battle_state_get_record(44);
                    combat_dispatch('npc_turn', $npc, [['act_id' => 'unarmed_strike', 'target' => ['type' => 'pid', 'id' => $joinable['pid']]]], ['turn' => $turn]);
                    obl_runtime_transaction_commit();
                } catch (Throwable $e) { $thrown = true; obl_runtime_transaction_rollback(); }
                test_assert($thrown, 'NPC heartbeat turn propagates infrastructure fault');
                test_assert(!obl_fetch_queue_by_pid((int)$joinable['pid']), 'heartbeat dynamic join rolled back');
                $saved = $room->fetch((int)$joinable['pid']); test_same('', (string)$saved['action'], 'heartbeat target action rolled back'); test_same(0, (int)$saved['bid'], 'heartbeat target bid rolled back');
            } finally { $db->query("DROP TRIGGER IF EXISTS {$trigger}", 'SILENT'); }
        },
        'heartbeat_orchestrator_fault_rolls_back_npc_turn_and_tick' => static function () use ($room): void {
            global $db, $cuser, $gamevars;
            $room->resetData();
            $npc = $room->player('heartbeat-orchestrator-npc', 1, [
                'oblpara' => '{"combat_skills":["unarmed_strike"]}',
                'pls' => 1,
            ]);
            $player = $room->player('heartbeat-orchestrator-player', 0, ['hp' => 77, 'pls' => 1]);
            $room->queue($npc, 45, 1); $room->queue($player, 45, 2);
            $db->query("UPDATE {$room->prefix}oblbattle_state SET state='AUTO_PENDING', active_pid=" . (int)$npc['pid'] . ", turn_seq=1 WHERE qid=45");
            $db->query("UPDATE {$room->prefix}oblgame SET tick=11, processed_tick=10, vars_json='{\"obl_tick\":11,\"obl_pretick\":10}' WHERE id=1");
            $cuser = (string)$player['name'];
            $gamevars = ['obl_tick' => 11, 'obl_pretick' => 10];
            $trigger = $room->prefix . 'fail_heartbeat_player_update'; $pid = (int)$player['pid'];
            $db->query("CREATE TRIGGER {$trigger} BEFORE UPDATE ON {$room->prefix}oblplayers FOR EACH ROW BEGIN IF NEW.pid={$pid} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test heartbeat player failure'; END IF; END");
            try {
                $thrown = false; obl_runtime_transaction_begin();
                try {
                    obl_tick_orchestrator_heartbeat(['kind' => 'heartbeat']);
                    obl_runtime_transaction_commit();
                } catch (Throwable $e) { $thrown = true; obl_runtime_transaction_rollback(); }
                test_assert($thrown, 'heartbeat orchestrator propagates NPC persistence fault');
                test_same(77, (int)$room->fetch($pid)['hp'], 'heartbeat rollback restores player HP');
                $npcQueue = obl_fetch_queue_by_pid((int)$npc['pid']);
                test_same(0, (int)$npcQueue['done'], 'heartbeat rollback restores NPC turn state');
                $game = $room->tableRows('oblgame')[0];
                test_same(10, (int)$game['processed_tick'], 'heartbeat rollback restores processed tick');
            } finally { $db->query("DROP TRIGGER IF EXISTS {$trigger}", 'SILENT'); }
        },
        'ap_reservation_is_visible_to_rules_and_hooks' => static function () use ($room): void {
            $room->resetData(); $GLOBALS['test_ap_views'] = [];
            $actor = $room->player('ap-view-actor', 0, ['ap' => 10]); $target = $room->player('ap-view-target', 1);
            $config = [
                'pipeline' => 'attack', 'aim' => ['resolver' => 'pid', 'rules' => []],
                'capture' => ['resolver' => 'direct_character', 'relation' => 'hostile', 'participation' => 'join_if_unengaged', 'order' => 'single', 'rules' => ['test_ap_probe']],
                'execution' => ['empty_policy' => 'fail'], 'delivery' => ['types' => []], 'cd' => 0,
                'target_intent' => ['type' => 'pid', 'id' => $target['pid']],
            ];
            foreach ([true, false] as $dry) {
                $actorRun = $room->fetch((int)$actor['pid']); $cache = combat_cache_create($actorRun, false); $log = new BattleLogCollector();
                $ctx = new CombatContext($actorRun, 'test_ap_view', $config, $log, $cache); $ctx->dry_run = $dry; $ctx->ap_cost = 3; $ctx->action_uid = $dry ? 'ap-dry' : 'ap-exec';
                if (!$dry) obl_runtime_transaction_begin();
                try { combat_pipeline_run($ctx); if (!$dry) obl_runtime_transaction_rollback(); }
                catch (Throwable $e) { if (!$dry) obl_runtime_transaction_rollback(); throw $e; }
            }
            $views = $GLOBALS['test_ap_views'];
            test_same([7, 7], array_values(array_map(static fn(array $v): int => $v['ap'], array_filter($views, static fn(array $v): bool => $v['phase'] === 'rule'))), 'rules see reserved AP in dry-run and execute');
            test_same([7, 7], array_values(array_map(static fn(array $v): int => $v['ap'], array_filter($views, static fn(array $v): bool => $v['phase'] === 'hook'))), 'hooks see reserved AP in dry-run and execute');
        },
        'target_effect_failure_rolls_back_savepoint_and_join' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('fail-actor'); $member = $room->player('fail-member', 1); $target = $room->player('fail-target', 1);
            $room->queue($actor, 31, 1); $room->queue($member, 31, 2);
            $beforeAp = (int)$actor['ap']; $beforeHp = (int)$target['hp'];
            $config = [
                'pipeline' => 'attack', 'aim' => ['resolver' => 'pid', 'rules' => []],
                'capture' => ['resolver' => 'direct_character', 'relation' => 'hostile', 'participation' => 'join_if_unengaged', 'order' => 'single', 'rules' => []],
                'execution' => ['empty_policy' => 'fail'], 'delivery' => ['types' => []], 'cd' => 0,
                'target_intent' => ['type' => 'pid', 'id' => $target['pid']],
            ];
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $ctx = new CombatContext($actor, 'test_effect_failure', $config, $log, $cache); $ctx->ap_cost = 3; $ctx->action_uid = 'test-failure';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                test_assert(!$ctx->success, 'action fails when only target effect fails');
                test_same($beforeAp, (int)$room->fetch((int)$actor['pid'])['ap'], 'AP not consumed');
                test_same($beforeHp, (int)$room->fetch((int)$target['pid'])['hp'], 'target mutation rolled back');
                test_assert(!obl_fetch_queue_by_pid($target['pid']), 'dynamic join rolled back');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'schema_engines_and_queue_index' => static function () use ($room): void {
            global $db, $dbname;
            foreach (['oblplayers','oblqueue','oblbattle_state','oblmapstates','oblmappoi','oblmapitem','oblgame'] as $table) {
                $result = $db->query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='" . $db->escape_string($dbname) . "' AND TABLE_NAME='" . $db->escape_string($room->prefix . $table) . "'");
                test_same('InnoDB', (string)$db->fetch_array($result)['ENGINE'], "{$table} engine");
            }
            $result = $db->query("SHOW INDEX FROM {$room->prefix}oblqueue WHERE Key_name='idx_qid_turn_order'");
            $columns = []; while ($row = $db->fetch_array($result)) $columns[(int)$row['Seq_in_index']] = $row['Column_name']; ksort($columns);
            test_same(['qid','active','done','myorder'], array_values($columns), 'queue composite index');
        },
        'sql_exception_rolls_back_transaction' => static function () use ($room): void {
            global $db;
            $room->resetData(); $player = $room->player('sql-rollback', 0, ['hp' => 77]);
            $thrown = false;
            obl_runtime_transaction_begin();
            try {
                $db->query("UPDATE {$room->prefix}oblplayers SET hp=1 WHERE pid=" . (int)$player['pid']);
                $db->query("UPDATE {$room->prefix}missing_table SET hp=0");
                obl_runtime_transaction_commit();
            } catch (Throwable $e) {
                $thrown = true; obl_runtime_transaction_rollback();
            }
            test_assert($thrown, 'SQL failure throws');
            test_same(77, (int)$room->fetch((int)$player['pid'])['hp'], 'transaction rollback restores row');
        },
        'fatal_shutdown_rolls_back_and_releases_room_lock' => static function () use ($room): void {
            $room->resetData();
            $player = $room->player('fatal-shutdown', 0, ['hp' => 77]);
            $groomid = random_int(200000, 900000);
            $resultFile = tempnam(sys_get_temp_dir(), 'obl_fatal_');
            if ($resultFile === false) throw new RuntimeException('Cannot allocate fatal test result file');
            @unlink($resultFile);
            $command = escapeshellarg(PHP_BINARY)
                . ' ' . escapeshellarg(__DIR__ . '/fatal_transaction_child.php')
                . ' ' . escapeshellarg($room->prefix)
                . ' ' . escapeshellarg((string)$groomid)
                . ' ' . escapeshellarg((string)$player['pid'])
                . ' ' . escapeshellarg($resultFile);
            $output = [];
            $exitCode = 0;
            exec($command . ' 2>&1', $output, $exitCode);
            try {
                test_assert($exitCode !== 0, 'fatal child exits unsuccessfully');
                test_assert(is_file($resultFile), 'fatal shutdown callback writes evidence');
                $evidence = json_decode((string)file_get_contents($resultFile), true);
                test_assert(is_array($evidence), 'fatal evidence is valid JSON');
                test_same(E_USER_ERROR, (int)$evidence['fatal_type'], 'shared guard observes fatal error');
                test_same(false, (bool)$evidence['transaction_active'], 'shared guard clears transaction state');
                test_same(77, (int)$evidence['hp'], 'shared guard rolls back database mutation');
                test_same(1, (int)$evidence['lock_free'], 'shared guard releases room lock');
            } finally {
                @unlink($resultFile);
            }
        },
        'commit_failure_cleanup_clears_runtime_state' => static function (): void {
            global $db;
            $realDb = $db;
            $db = new class {
                public function query($sql, $type = '') { throw new RuntimeException('simulated connection failure'); }
            };
            $GLOBALS['obl_transaction_active'] = true;
            $GLOBALS['obl_db_throw_on_error'] = true;
            $thrown = false;
            try {
                try { obl_runtime_transaction_commit(); }
                catch (Throwable $e) { $thrown = true; }
                test_assert($thrown, 'commit failure propagates');
                test_assert(obl_runtime_transaction_is_active(), 'failed commit remains rollback-eligible');
                obl_runtime_transaction_rollback();
                test_same(false, obl_runtime_transaction_is_active(), 'rollback cleanup clears active state despite broken connection');
                test_same(false, !empty($GLOBALS['obl_db_throw_on_error']), 'rollback cleanup clears throw mode');
                obl_runtime_release_room_lock('simulated-lock');
            } finally {
                $db = $realDb;
                $GLOBALS['obl_transaction_active'] = false;
                $GLOBALS['obl_db_throw_on_error'] = true;
            }
        },
        'post_commit_battlelog_failure_returns_warning_and_keeps_state' => static function () use ($room): void {
            global $obl_battle_log, $obl_log, $obl_error_log;
            $room->resetData();
            $player = $room->player('persist-warning', 0, ['hp' => 77]);
            obl_runtime_transaction_begin();
            $saved = $room->fetch((int)$player['pid']);
            $saved['hp'] = 66;
            obl_save_player($saved);
            obl_runtime_transaction_commit();
            $obl_log = new OblivionsLogger();
            $obl_error_log = new OblivionsErrorLogger();
            $obl_battle_log = new BattleLogCollector();
            $obl_battle_log->setPhase('test');
            $obl_battle_log->emit(['event_type' => 'test'], false);
            $persist = obl_runtime_persist_logs(
                ['pid' => (int)$player['pid']],
                'test',
                [
                    'battle' => static fn($logger, $groomid, $pid): bool => false,
                    'debug' => static fn(): bool => true,
                ]
            );
            test_same(['BATTLELOG_PERSIST_FAILED'], $persist['warnings'], 'post-commit log failure returns warning');
            test_same(66, (int)$room->fetch((int)$player['pid'])['hp'], 'post-commit warning does not roll back domain state');
        },
        'presentation_batch_sequence_commits_and_rolls_back_with_domain_transaction' => static function () use ($room): void {
            global $db, $gamevars, $obl_battle_log;
            $room->resetData();
            $player = $room->player('presentation-player', 0, ['pls' => 7, 'hp' => 88, 'ap' => 9]);
            $gamevars = ['obl_tick' => 12, 'obl_pretick' => 12, 'obl_presentation_head_seq' => 4];
            obl_gamevars_sync_from_globals();

            $obl_battle_log = new BattleLogCollector();
            $obl_battle_log->setPhase('battlelog_v3');
            $obl_battle_log->emit([
                'schema' => 'battlelog.v3',
                'event_type' => 'notice',
                'channel' => 'render',
                'event_uid' => 'presentation-render-1',
                'payload' => ['qid' => 44, 'message' => 'render'],
            ], false);
            $obl_battle_log->emit([
                'schema' => 'battlelog.v3',
                'event_type' => 'notice',
                'channel' => 'debug',
                'event_uid' => 'presentation-debug-1',
                'payload' => ['message' => 'debug'],
            ], true);

            obl_runtime_transaction_begin();
            $prepared = obl_runtime_prepare_presentation($player, 'request-1');
            test_same(5, (int)$prepared['head_seq'], 'render batch increments head once');
            test_same(1, count($prepared['batch']['events']), 'debug event excluded from live presentation');
            test_same(1, (int)$prepared['batch']['events'][0]['event_seq'], 'batch-local event order assigned');
            test_same(44, (int)$prepared['batch']['qid'], 'batch retains the completed combat qid');
            test_same(0, (int)$prepared['batch']['state_after']['bid'], 'state_after retains authoritative cleared player bid');
            test_same('IDLE', (string)$prepared['batch']['state_after']['battle_state'], 'state_after battle state follows player bid');
            obl_runtime_transaction_commit();

            $row = obl_game_load(false);
            $vars = obl_game_json_decode((string)$row['vars_json']);
            test_same(5, (int)$vars['obl_presentation_head_seq'], 'committed head persisted in oblgame');
            $attached = obl_runtime_attach_presentation(['status' => 'success'], $prepared);
            test_same(5, (int)$attached['presentation_head_seq'], 'response exposes committed head');
            test_same('presentation.v1', (string)$attached['presentation']['schema'], 'response exposes immutable batch');

            $obl_battle_log = new BattleLogCollector();
            $obl_battle_log->setPhase('battlelog_v3');
            $obl_battle_log->emit([
                'schema' => 'battlelog.v3',
                'event_type' => 'notice',
                'channel' => 'render',
                'event_uid' => 'presentation-render-rollback',
                'payload' => ['message' => 'rollback'],
            ], false);
            $gamevars['obl_presentation_head_seq'] = 5;
            obl_runtime_transaction_begin();
            $rolled = obl_runtime_prepare_presentation($player, 'request-rollback');
            test_same(6, (int)$rolled['head_seq'], 'tentative batch advances in transaction');
            obl_runtime_transaction_rollback();
            $row = obl_game_load(false);
            $vars = obl_game_json_decode((string)$row['vars_json']);
            test_same(5, (int)$vars['obl_presentation_head_seq'], 'rollback does not consume presentation sequence');
        },
    ]);
};
