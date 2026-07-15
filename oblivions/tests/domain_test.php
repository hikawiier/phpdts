<?php
declare(strict_types=1);

return static function (TestRoom $room): array {
    return test_run_cases('domain', [
        'aim_capture_direct_and_tile_order' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('actor');
            $member = $room->player('member', 1, ['pls' => 1]);
            $joinB = $room->player('join-b', 1, ['pls' => 1]);
            $joinA = $room->player('join-a', 1, ['pls' => 1]);
            $room->queue($actor, 11, 1);
            $room->queue($member, 11, 2);
            $cache = combat_cache_create($actor, false);
            $log = new BattleLogCollector();
            $config = combat_skill_get_config('grenade');
            $config = combat_action_config_with_target($config, ['target' => ['type' => 'tile', 'id' => 1]]);
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache);
            combat_aim_resolve($ctx);
            combat_capture_resolution_targets($ctx);
            test_same('tile', $ctx->resolved_aim['kind'], 'tile aim kind');
            test_same([(int)$actor['pid'], (int)$member['pid'], (int)$joinB['pid'], (int)$joinA['pid']], array_column($ctx->targets, 'pid'), 'queue members precede joinables, then pid');
        },
        'delivery_config_requires_ordered_types_array' => static function (): void {
            $config = combat_skill_get_config('move');
            test_same([], $config['delivery']['types'], 'no-delivery action uses an empty ordered list');
            $legacy = $config;
            $legacy['delivery'] = ['type' => 'none'];
            $thrown = false;
            try { combat_skill_validate_config('legacy-delivery', $legacy); }
            catch (UnexpectedValueException $e) { $thrown = true; }
            test_assert($thrown, 'singular delivery.type is rejected');
        },
        'preview_has_no_db_or_file_side_effects' => static function () use ($room): void {
            global $obl_battle_log, $gamevars;
            $room->resetData();
            $actor = $room->player('preview-actor');
            $target = $room->player('preview-target', 1, ['pls' => 1]);
            $beforeDb = serialize([$room->tableRows('oblplayers'), $room->tableRows('oblqueue'), $room->tableRows('oblbattle_state')]);
            $beforeFiles = $room->fileSnapshot();
            $beforeCollector = serialize($obl_battle_log->getEntries());
            $beforeGamevars = serialize($gamevars);
            $beforeRequestUid = $GLOBALS['obl_request_uid'] ?? null;
            $uidBefore = combat_log_v3_next_event_uid('preview_probe');
            preg_match('/-(\d+)$/', $uidBefore, $beforeMatch);
            mt_srand(24680);
            $expectedFirst = mt_rand(); $expectedSecond = mt_rand();
            mt_srand(24680);
            $actualFirst = mt_rand();
            $result = combat_preview_chain($actor, [['act_id' => 'unarmed_strike', 'target' => ['type' => 'pid', 'id' => $target['pid']]]], combat_cache_create($actor, false));
            $actualSecond = mt_rand();
            $uidAfter = combat_log_v3_next_event_uid('preview_probe');
            preg_match('/-(\d+)$/', $uidAfter, $afterMatch);
            test_assert(!empty($result['actions'][0]['success']), 'preview action succeeds');
            test_same($beforeDb, serialize([$room->tableRows('oblplayers'), $room->tableRows('oblqueue'), $room->tableRows('oblbattle_state')]), 'preview DB unchanged');
            test_same($beforeFiles, $room->fileSnapshot(), 'preview files unchanged');
            test_same($beforeCollector, serialize($obl_battle_log->getEntries()), 'preview real collector unchanged');
            test_same($beforeGamevars, serialize($gamevars), 'preview global gamevars unchanged');
            test_same($beforeRequestUid, $GLOBALS['obl_request_uid'] ?? null, 'preview request UID unchanged');
            test_same((int)$beforeMatch[1] + 1, (int)$afterMatch[1], 'preview does not consume event UID sequence');
            test_same([$expectedFirst, $expectedSecond], [$actualFirst, $actualSecond], 'preview does not consume RNG state');
        },
        'aim_capture_provenance_freeze_and_snapshot' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('capture-actor', 0, ['pls' => 1]);
            $target = $room->player('capture-target', 1, ['pls' => 1]);
            $cache = combat_cache_create($actor, false);
            $log = new BattleLogCollector();

            $badConfig = combat_action_config_with_target(
                combat_skill_get_config('grenade'),
                ['target' => ['type' => 'pid', 'id' => $target['pid']]]
            );
            $badCtx = new CombatContext($actor, 'grenade', $badConfig, $log, $cache);
            combat_aim_resolve($badCtx);
            test_same('AIM_TYPE_MISMATCH', $badCtx->failure_reason, 'tile skill rejects pid intent');

            $duplicate = combat_target_capture_character($target, ['captured_in_tile' => true]);
            test_same(null, combat_target_capture_validate_structure([$duplicate, $duplicate]), 'duplicate pid is rejected');

            $config = combat_action_config_with_target(
                combat_skill_get_config('grenade'),
                ['target' => ['type' => 'tile', 'id' => 1], '_action_index' => 2]
            );
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache);
            combat_aim_resolve($ctx);
            combat_capture_resolution_targets($ctx);
            test_assert($ctx->success, 'valid tile capture succeeds');
            test_same(2, (int)$ctx->captured_target_set['captured_at']['action_index'], 'capture records action index');
            $capturedBefore = serialize($ctx->captured_target_set);
            $targetPidsBefore = array_column($ctx->targets, 'pid');

            $room->player('late-occupant', 1, ['pls' => 1]);
            combat_capture_resolution_targets($ctx);
            test_same($targetPidsBefore, array_column($ctx->targets, 'pid'), 'captured target set is generated once');

            $ctx->current_target_index = 0;
            $ctx->snapshotTargetState();
            test_same($capturedBefore, serialize($ctx->captured_target_set), 'snapshot does not mutate captured set');

            $forged = combat_target_capture_character($target, ['captured_in_tile' => true, 'pgroup' => 1, 'pls' => 2]);
            test_same(null, combat_target_capture_validate_builtin($ctx, 'tile_characters', [$forged]), 'non-authoritative tile occupant is rejected');
        },
        'readonly_command_bus_does_not_touch_player_or_game' => static function () use ($room): void {
            global $db, $gtablepre, $cuser, $cpass, $groomid, $obl_runtime_ctx;
            $room->resetData();
            $userResult = $db->query("SELECT username,password FROM {$gtablepre}users WHERE username<>'' LIMIT 1");
            $user = $db->fetch_array($userResult);
            test_assert(is_array($user), 'global auth fixture exists');
            $actor = $room->player((string)$user['username'], 0, ['action' => 'battle', 'bid' => 41]);
            $target = $room->player('readonly-target', 1, ['action' => 'battle', 'bid' => 41, 'pls' => 1]);
            $room->queue($actor, 41, 1);
            $room->queue($target, 41, 2);
            $before = serialize([$room->tableRows('oblplayers'), $room->tableRows('oblqueue'), $room->tableRows('oblgame')]);
            $beforeFiles = $room->fileSnapshot();
            $beforeDebug = $GLOBALS['obl_combat_debug_entries'] ?? [];
            $cuser = (string)$user['username'];
            $cpass = (string)$user['password'];
            $groomid = 99991;
            $obl_runtime_ctx = ['is_oblivions' => true];
            $response = obl_command_api_handle([
                'command' => 'combat.preview_single',
                'payload' => ['act_id' => 'unarmed_strike', 'aim_intent' => ['type' => 'pid', 'id' => (int)$target['pid']]],
                'request_id' => 'readonly-test',
                'expected' => [],
            ]);
            test_same('success', (string)($response['status'] ?? ''), 'readonly preview command succeeds');
            test_same($before, serialize([$room->tableRows('oblplayers'), $room->tableRows('oblqueue'), $room->tableRows('oblgame')]), 'readonly command leaves DB unchanged');
            test_same($beforeFiles, $room->fileSnapshot(), 'readonly command leaves files unchanged');
            test_same($beforeDebug, $GLOBALS['obl_combat_debug_entries'] ?? [], 'readonly command leaves debug collector unchanged');
        },
        'observation_is_actor_aware_and_request_cached' => static function () use ($room): void {
            global $db;
            $room->resetData();
            $player = $room->player('observation-player', 0, ['pls' => 1, 'ap' => 5]);
            $npc = $room->player('observation-npc', 1, ['pls' => 1, 'ap' => 5]);
            $hidden = $room->player('observation-hidden', 1, ['pls' => 1, 'discovered' => 0]);

            $fogged = combat_preview_single($player, 'move', ['type' => 'tile', 'id' => 2]);
            test_same('target_resolve_failed:AIM_RULE_FAILED:tile_unrevealed', (string)$fogged['reason'], 'player tile aim requires controller knowledge');
            $npcMove = combat_preview_single($npc, 'move', ['type' => 'tile', 'id' => 2]);
            test_assert(!empty($npcMove['pass']), 'NPC tile aim ignores player room fog');
            $hiddenAim = combat_preview_single($player, 'unarmed_strike', ['type' => 'pid', 'id' => (int)$hidden['pid']]);
            test_same('target_resolve_failed:AIM_RULE_FAILED:TARGET_NOT_VISIBLE', (string)$hiddenAim['reason'], 'hidden PID has generic failure');

            $room->queue($player, 73, 1); $room->queue($hidden, 73, 2);
            $player = $room->fetch((int)$player['pid']);
            $memberAim = combat_preview_single($player, 'unarmed_strike', ['type' => 'pid', 'id' => (int)$hidden['pid']]);
            test_assert(!empty($memberAim['pass']), 'active same-battle member remains targetable');

            $room->reveal(2);
            $cache = [];
            $first = combat_observation_preload_revealed_tiles($cache, 1);
            $db->query("DELETE FROM {$room->prefix}oblmapstates WHERE pgroup=1 AND pls=2");
            $second = combat_observation_preload_revealed_tiles($cache, 1);
            $fresh = [];
            $third = combat_observation_preload_revealed_tiles($fresh, 1);
            test_assert(!empty($first[2]) && !empty($second[2]) && empty($third[2]), 'revealed tiles cache is request-local, not static');
        },
        'can_engage_does_not_expose_pid_existence' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('engage-observer');
            $hidden = $room->player('engage-hidden', 1, ['discovered' => 0]);
            $missing = obl_command_handler_dispatch('combat.can_engage', ['target_pid' => 99999999], $actor);
            $undetected = obl_command_handler_dispatch('combat.can_engage', ['target_pid' => (int)$hidden['pid']], $actor);
            test_same($missing, $undetected, 'missing and undetected PID responses are indistinguishable');
            test_same('TARGET_NOT_VISIBLE', (string)$missing['data']['reason'], 'generic observation reason');
            test_same(-1, (int)$missing['data']['distance'], 'generic response leaks no distance');
        },
    ]);
};
