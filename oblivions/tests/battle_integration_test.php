<?php
declare(strict_types=1);

function skill_test_actor_termination_execute(CombatContext $ctx): void {
    $ctx->declareEffect('damage', ['value' => 1]);
    $ctx->declareEffect('damage', ['value' => 999, 'scope' => 'actor']);
}

return static function (TestRoom $room): array {
    return test_run_cases('battle', [
        'escaped_actor_skips_first_post_battle_world_tick' => static function () use ($room): void {
            global $gamevars;
            $original_gamevars = $gamevars;
            $room->resetData();
            try {
                $survivor = $room->player('escape-survivor', 0, ['pls' => 1]);
                $actor = $room->player('escape-handoff', 1, ['pls' => 3]);
                $room->queue($survivor, 61, 1);
                $room->queue($actor, 61, 2);
                $cache = [
                    'combatants' => [(int)$survivor['pid'] => 1, (int)$actor['pid'] => 1],
                    'tag_mutations' => [],
                ];
                $gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
                skill_effect_apply($actor, 'flustered', [
                    'kind' => 'skill',
                    'skill_id' => 'escape',
                    'action_uid' => 'escape-handoff-action',
                ], [
                    'boundary' => 'battle_disband',
                    'boundary_id' => 61,
                    'delay_ticks' => 1,
                ], 'fx-escape-handoff');
                combat_state_clear((int)$actor['pid'], 'escaped', $actor, $cache, new BattleLogCollector());
                $pending = $actor['skillpara']['flustered']['effect_instances']['fx-escape-handoff'] ?? null;
                test_same('pending', (string)($pending['state'] ?? ''), 'escape records pending flustered');
                test_same(61, (int)($pending['activation']['boundary_id'] ?? 0), 'pending flustered remains bound to source qid');

                // 战斗继续多个 tick；绝对时间不能让交接冷却提前过期。
                $gamevars['obl_tick'] = 13;
                $log = new BattleLogCollector();
                battle_disband_cleanup(61, $survivor, $log);
                $actor = $room->fetch((int)$actor['pid']);
                $active = $actor['skillpara']['flustered']['effect_instances']['fx-escape-handoff'] ?? null;
                test_same('active', (string)($active['state'] ?? ''), 'disband activates matching flustered');
                test_same(14, (int)($active['starts_at_tick'] ?? 0), 'disband anchors first post-battle frame');
                test_same(15, (int)($active['expires_at_tick'] ?? 0), 'flustered uses exclusive one-tick expiry');

                $ctx = ['battle_actor_scope' => [], 'actor_behaviors' => []];
                $gamevars['obl_tick'] = 14;
                test_same('capability:status_blocked', obl_actor_world_ai_block_reason($actor, $ctx), 'first post-battle frame is blocked by capability');
                $gamevars['obl_tick'] = 15;
                test_same('', obl_actor_world_ai_block_reason($actor, $ctx), 'actor resumes world AI on later frame');
                test_assert(skill_effect_gc($actor, 15), 'expired flustered is collected');
                obl_save_player($actor);
                test_assert(!isset($room->fetch((int)$actor['pid'])['skillpara']['flustered']), 'expired flustered is persisted away');
            } finally {
                $gamevars = $original_gamevars;
            }
        },
        'escape_selects_and_emits_authoritative_retreat_target' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('retreat-actor', 1, ['action' => 'battle', 'bid' => 51, 'pgroup' => 1, 'pls' => 1]);
            $threat = $room->player('retreat-threat', 0, ['action' => 'battle', 'bid' => 51, 'pgroup' => 1, 'pls' => 4]);
            $cache = [
                'combatants' => [(int)$actor['pid'] => 1, (int)$threat['pid'] => 1],
                'tag_mutations' => [],
            ];
            $log = new BattleLogCollector();
            $config = combat_skill_get_config('escape');
            $ctx = new CombatContext($actor, 'escape', $config, $log, $cache);
            $ctx->action_uid = 'retreat-action';
            test_assert(combat_effect_escape($ctx, []), 'escape effect succeeds');
            test_assert(combat_effect_skill_effect_apply($ctx, [
                'payload' => [
                    'skill_id' => 'flustered',
                    'scope' => 'actor',
                    'activation' => [
                        'boundary' => 'battle_disband',
                        'boundary_id' => 51,
                        'delay_ticks' => 1,
                    ],
                ],
            ]), 'escape applies pending flustered');
            test_same(17, (int)$actor['pls'], 'retreat chooses deterministic farthest free neighbor');

            $ctx->targets = [['target_data' => []]];
            $ctx->targets[0]['target_data'] = &$actor;
            combat_target_unit_clear_current_if_needed($ctx);

            $events = $log->getEntries();
            $effects = array_values(array_filter($events, static fn(array $event): bool => ($event['event_type'] ?? '') === 'effect_applied'));
            $effect = $effects[0];
            $statusEffect = $effects[1];
            $cleared = current(array_values(array_filter($events, static fn(array $event): bool => ($event['event_type'] ?? '') === 'combatant_cleared')));
            test_same(1, (int)$effect['payload']['delta']['pls_before'], 'escape effect records origin');
            test_same(17, (int)$effect['payload']['delta']['pls_after'], 'escape effect records authoritative target');
            test_same('retreat', (string)$effect['payload']['detail']['visual_policy'], 'escape effect selects retreat visual policy');
            test_same(17, (int)$cleared['payload']['detail']['retreat_target']['pls'], 'clear event forwards retreat target to presentation');
            test_same('retreat', (string)$cleared['payload']['detail']['visual_policy'], 'clear event forwards retreat visual policy');
            test_same('status', (string)$statusEffect['effect_type'], 'status effect is emitted after escape effect');
            test_same((string)$effect['effect_uid'], (string)$cleared['payload']['by_effect_uid'], 'clear event remains linked to escape effect uid');
        },
        'active_flustered_blocks_dynamic_participation_and_pipeline_actor' => static function () use ($room): void {
            global $gamevars;
            $original_gamevars = $gamevars;
            $room->resetData();
            try {
                $gamevars = ['obl_tick' => 20, 'obl_pretick' => 20];
                $attacker = $room->player('capability-attacker', 0, ['action' => 'battle', 'bid' => 70, 'pls' => 1]);
                $member = $room->player('capability-member', 1, ['action' => 'battle', 'bid' => 70, 'pls' => 1]);
                $joinable = $room->player('capability-joinable', 1, ['pls' => 1]);
                $room->queue($attacker, 70, 1);
                $room->queue($member, 70, 2);
                skill_effect_apply($joinable, 'flustered', ['kind' => 'test'], [
                    'boundary' => 'immediate',
                    'boundary_id' => 0,
                    'delay_ticks' => 0,
                    'evaluation_tick' => 20,
                ], 'fx-joinable-blocked');

                $cache = combat_cache_create($attacker, false);
                $config = combat_action_config_with_target(
                    combat_skill_get_config('unarmed_strike'),
                    ['target' => ['type' => 'pid', 'id' => (int)$joinable['pid']]]
                );
                $ctx = new CombatContext($attacker, 'unarmed_strike', $config, new BattleLogCollector(), $cache);
                $target = combat_target_capture_character($joinable);
                $decision = combat_participation_classify($ctx, $target);
                test_same('blocked', (string)$decision['state'], 'active flustered target cannot dynamically participate');
                test_same('TARGET_CAPABILITY_BLOCKED', (string)$decision['reason'], 'participation exposes structured capability reason');

                skill_effect_apply($attacker, 'flustered', ['kind' => 'test'], [
                    'boundary' => 'immediate',
                    'boundary_id' => 0,
                    'delay_ticks' => 0,
                    'evaluation_tick' => 20,
                ], 'fx-actor-blocked');
                $pipeline = new CombatContext($attacker, 'unarmed_strike', $config, new BattleLogCollector(), $cache);
                combat_pipeline_run($pipeline);
                test_assert(!$pipeline->success, 'pipeline rejects anomalous active flustered actor');
                test_same('CAPABILITY_BLOCKED:combat_action', (string)$pipeline->failure_reason, 'pipeline reports combat_action capability');
            } finally {
                $gamevars = $original_gamevars;
            }
        },
        'dead_a_and_skipped_b_do_not_block_c' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('continue-actor', 0, ['pls' => 1, 'att' => 30, 'ap' => 10]);
            $a = $room->player('continue-a', 1, ['pls' => 1, 'hp' => 1]);
            $b = $room->player('continue-b-friendly', 0, ['pls' => 1, 'hp' => 100]);
            $c = $room->player('continue-c', 1, ['pls' => 1, 'hp' => 100]);
            $room->reveal(1);
            $room->queue($actor, 8, 1); $room->queue($a, 8, 2); $room->queue($b, 8, 3); $room->queue($c, 8, 4);
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $config = combat_action_config_with_target(combat_skill_get_config('grenade'), ['target' => ['type' => 'tile', 'id' => 1]]);
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache); $ctx->ap_cost = 2; $ctx->action_uid = 'continue-grenade';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                $byPid = []; foreach ($ctx->target_results as $result) $byPid[(int)$result['pid']] = $result;
                test_same('resolved', $byPid[(int)$a['pid']]['status'], 'A resolves before death');
                test_same('skipped', $byPid[(int)$b['pid']]['status'], 'B is skipped independently');
                test_same('resolved', $byPid[(int)$c['pid']]['status'], 'C continues after A death and B skip');
                test_same(0, (int)$room->fetch((int)$a['pid'])['hp'], 'A died');
                test_assert((int)$room->fetch((int)$c['pid'])['hp'] < 100, 'C still took damage');
                test_same(8, (int)$actor['ap'], 'multi-target action spends AP once');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'actor_termination_after_a_stops_b_and_c' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('terminated-actor', 0, ['pls' => 1, 'hp' => 50]);
            $a = $room->player('terminated-a', 1, ['pls' => 1, 'hp' => 100]);
            $b = $room->player('terminated-b', 1, ['pls' => 1, 'hp' => 100]);
            $c = $room->player('terminated-c', 1, ['pls' => 1, 'hp' => 100]);
            $room->queue($actor, 6, 1); $room->queue($a, 6, 2); $room->queue($b, 6, 3); $room->queue($c, 6, 4);
            $config = [
                'pipeline' => 'attack', 'aim' => ['resolver' => 'tile', 'rules' => []],
                'capture' => ['resolver' => 'tile_characters', 'relation' => 'hostile', 'participation' => 'join_if_unengaged', 'order' => 'queue_then_pid', 'rules' => ['self']],
                'execution' => ['empty_policy' => 'fail'], 'delivery' => ['types' => []], 'cd' => 0,
                'target_intent' => ['type' => 'tile', 'id' => 1],
            ];
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $ctx = new CombatContext($actor, 'test_actor_termination', $config, $log, $cache); $ctx->ap_cost = 0; $ctx->action_uid = 'terminated-action';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                $resolved = array_values(array_filter($ctx->target_results, static fn(array $r): bool => ($r['status'] ?? '') === 'resolved'));
                test_same([(int)$a['pid']], array_column($resolved, 'pid'), 'only A resolves before actor termination');
                test_same(0, (int)$room->fetch((int)$actor['pid'])['hp'], 'A unit terminates actor');
                test_same(99, (int)$room->fetch((int)$a['pid'])['hp'], 'A effect persists');
                test_same(100, (int)$room->fetch((int)$b['pid'])['hp'], 'B is not executed');
                test_same(100, (int)$room->fetch((int)$c['pid'])['hp'], 'C is not executed');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'member_is_idempotent_and_left_cannot_reenter' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('membership-actor'); $member = $room->player('membership-member', 1); $left = $room->player('membership-left', 1);
            $room->queue($actor, 7, 1); $room->queue($member, 7, 2); $room->queue($left, 7, 3, 0);
            $run = static function (array &$actorData, int $pid) use ($room): array {
                $cache = combat_cache_create($actorData, false); $log = new BattleLogCollector();
                $config = combat_action_config_with_target(combat_skill_get_config('unarmed_strike'), ['target' => ['type' => 'pid', 'id' => $pid]]);
                $ctx = new CombatContext($actorData, 'unarmed_strike', $config, $log, $cache); $ctx->ap_cost = 1; $ctx->action_uid = 'membership-' . $pid;
                combat_pipeline_run($ctx); return [$ctx, $log];
            };
            obl_runtime_transaction_begin();
            try {
                [$memberCtx, $memberLog] = $run($actor, (int)$member['pid']);
                test_same('member', $memberCtx->target_results[0]['participation'], 'existing member remains member');
                test_same(0, count(array_filter($memberLog->getEntries(), static fn(array $e): bool => ($e['event_type'] ?? '') === 'combatant_joined')), 'member emits no joined event');
                [$leftCtx] = $run($actor, (int)$left['pid']);
                test_same('TARGET_LEFT_BATTLE', $leftCtx->target_results[0]['reason'], 'left member rejected');
                test_same(0, (int)obl_fetch_queue_by_pid((int)$left['pid'])['active'], 'left row stays inactive');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'aoe_joins_in_order_and_skips_each_invalid_target_independently' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('aoe-classify-actor', 0, ['pls' => 1, 'att' => 8]);
            $member = $room->player('aoe-classify-member', 1, ['pls' => 1, 'hp' => 100]);
            $joinB = $room->player('aoe-classify-join-b', 1, ['pls' => 1, 'hp' => 100]);
            $joinC = $room->player('aoe-classify-join-c', 1, ['pls' => 1, 'hp' => 100]);
            $friendly = $room->player('aoe-classify-friendly', 0, ['pls' => 1, 'hp' => 100]);
            $dead = $room->player('aoe-classify-dead', 1, ['pls' => 1, 'hp' => 0, 'state' => 1]);
            $other = $room->player('aoe-classify-other', 1, ['pls' => 1, 'hp' => 100]);
            $room->reveal(1);
            $room->queue($actor, 8, 1); $room->queue($member, 8, 2); $room->queue($other, 88, 1);
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $config = combat_action_config_with_target(combat_skill_get_config('grenade'), ['target' => ['type' => 'tile', 'id' => 1]]);
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache); $ctx->ap_cost = 2; $ctx->action_uid = 'aoe-classify';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                $byPid = [];
                foreach ($ctx->target_results as $result) $byPid[(int)$result['pid']] = $result;
                test_same('member', (string)$byPid[$member['pid']]['participation'], 'member remains idempotent');
                test_same('joined', (string)$byPid[$joinB['pid']]['participation'], 'first joinable joins');
                test_same('joined', (string)$byPid[$joinC['pid']]['participation'], 'second joinable joins');
                test_same('TARGET_RELATION_BLOCKED', (string)$byPid[$friendly['pid']]['reason'], 'friendly target is skipped');
                test_same('TARGET_DEAD', (string)$byPid[$dead['pid']]['reason'], 'dead target is skipped');
                test_same('TARGET_IN_OTHER_BATTLE', (string)$byPid[$other['pid']]['reason'], 'other-qid target is skipped');
                $joinBQueue = obl_fetch_queue_by_pid((int)$joinB['pid']);
                $joinCQueue = obl_fetch_queue_by_pid((int)$joinC['pid']);
                test_assert((int)$joinBQueue['myorder'] < (int)$joinCQueue['myorder'], 'multiple joins follow target processing order');
                test_same(0, (int)$joinBQueue['done'], 'first joined target can act this round');
                test_same(0, (int)$joinCQueue['done'], 'second joined target can act this round');
                $joinedEvents = array_values(array_filter($log->getEntries(), static fn(array $e): bool => ($e['event_type'] ?? '') === 'combatant_joined'));
                test_same([(int)$joinB['pid'], (int)$joinC['pid']], array_map(static fn(array $e): int => (int)$e['payload']['combatant']['pid'], $joinedEvents), 'joined events follow target order');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'joined_target_can_die_in_same_unit' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('join-death-actor', 0, ['att' => 30]); $member = $room->player('join-death-member', 1); $target = $room->player('join-death-target', 1, ['hp' => 1]);
            $room->queue($actor, 6, 1); $room->queue($member, 6, 2);
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $config = combat_action_config_with_target(combat_skill_get_config('unarmed_strike'), ['target' => ['type' => 'pid', 'id' => $target['pid']]]);
            $ctx = new CombatContext($actor, 'unarmed_strike', $config, $log, $cache); $ctx->ap_cost = 1; $ctx->action_uid = 'join-death';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                test_same('joined', $ctx->target_results[0]['participation'], 'target joined before resolution');
                $row = obl_fetch_queue_by_pid((int)$target['pid']); $saved = $room->fetch((int)$target['pid']);
                test_same(0, (int)$row['active'], 'dead joiner is inactive');
                test_same('', (string)$saved['action'], 'dead joiner action cleared');
                test_same(1, (int)$saved['state'], 'dead joiner persisted dead state');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'multi_target_resolution_follows_queue_order' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('ordered-actor', 0, ['pls' => 1, 'att' => 8]);
            $room->reveal(1);
            $late = $room->player('ordered-late', 1, ['pls' => 1, 'hp' => 100]);
            $early = $room->player('ordered-early', 1, ['pls' => 1, 'hp' => 100]);
            $room->queue($actor, 9, 1); $room->queue($early, 9, 2); $room->queue($late, 9, 3);
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $config = combat_action_config_with_target(combat_skill_get_config('grenade'), ['target' => ['type' => 'tile', 'id' => 1]]);
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache); $ctx->ap_cost = 2; $ctx->action_uid = 'ordered-grenade';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                $resolvedPids = array_column(array_values(array_filter(
                    $ctx->target_results,
                    static fn(array $result): bool => ($result['status'] ?? '') === 'resolved'
                )), 'pid');
                test_same([(int)$early['pid'], (int)$late['pid']], $resolvedPids, 'resolved target units use queue order');
                $damagePids = [];
                foreach ($log->getEntries() as $entry) {
                    if (($entry['event_type'] ?? '') === 'effect_applied' && ($entry['effect_type'] ?? '') === 'damage') {
                        $damagePids[] = (int)($entry['target_pid'] ?? 0);
                    }
                }
                test_same([(int)$early['pid'], (int)$late['pid']], $damagePids, 'damage events preserve target order');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'multi_target_commits_resources_once_and_all_failed_commits_nothing' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('resource-actor', 0, ['pls' => 1, 'ap' => 20, 'att' => 8]);
            $room->reveal(1);
            $a = $room->player('resource-a', 1, ['pls' => 1, 'hp' => 100]);
            $b = $room->player('resource-b', 1, ['pls' => 1, 'hp' => 100]);
            $room->queue($actor, 12, 1); $room->queue($a, 12, 2); $room->queue($b, 12, 3);
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $config = combat_action_config_with_target(combat_skill_get_config('grenade'), ['target' => ['type' => 'tile', 'id' => 1]]);
            $config['cd'] = 5;
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache); $ctx->ap_cost = 2; $ctx->action_uid = 'resource-multi';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                $saved = $room->fetch((int)$actor['pid']);
                test_same(18, (int)$saved['ap'], 'multi-target action spends AP once');
                test_same(10, (int)$saved['skillpara']['grenade']['lstact'], 'multi-target action records cooldown once');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }

            $room->resetData();
            $actor = $room->player('resource-fail-actor', 0, ['ap' => 20, 'att' => 8]);
            $dead = $room->player('resource-dead-target', 1, ['hp' => 0, 'state' => 1]);
            $config = combat_action_config_with_target(combat_skill_get_config('unarmed_strike'), ['target' => ['type' => 'pid', 'id' => $dead['pid']]]);
            $config['cd'] = 5;
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $ctx = new CombatContext($actor, 'unarmed_strike', $config, $log, $cache); $ctx->ap_cost = 1; $ctx->action_uid = 'resource-fail';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                test_assert(!$ctx->success, 'all-invalid fail-policy action fails');
                $saved = $room->fetch((int)$actor['pid']);
                test_same(20, (int)$saved['ap'], 'all-invalid action does not spend AP');
                test_same(0, (int)$saved['skillpara']['unarmed_strike']['lstact'], 'all-invalid action does not record cooldown');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'initial_roster_then_dynamic_join_and_target_order' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('battle-actor', 0, ['att' => 8]);
            $a = $room->player('initial-a', 1, ['hp' => 100, 'pls' => 1]);
            $b = $room->player('later-b', 1, ['hp' => 100, 'pls' => 1]);
            obl_runtime_transaction_begin();
            try {
                $result = combat_start_battle($actor, [
                    ['act_id' => 'unarmed_strike', 'target' => ['type' => 'pid', 'id' => $a['pid']]],
                    ['act_id' => 'unarmed_strike', 'target' => ['type' => 'pid', 'id' => $b['pid']]],
                ]);
                test_assert(!empty($result['ok']), 'battle starts');
                $actions = $result['data']['actions'];
                test_same((int)$a['pid'], (int)$actions[0]['targets'][0]['pid'], 'first action resolves initial target');
                test_same((int)$b['pid'], (int)$actions[1]['targets'][0]['pid'], 'second action resolves dynamic target');
                test_same('member', (string)$actions[0]['targets'][0]['participation'], 'initial target is an initial member');
                test_same('joined', (string)$actions[1]['targets'][0]['participation'], 'later target joins dynamically');
                $rows = $room->tableRows('oblqueue');
                $orders = [];
                foreach ($rows as $row) $orders[(int)$row['pid']] = (int)$row['myorder'];
                test_assert(isset($orders[$a['pid']], $orders[$b['pid']]), 'both targets have queue rows');
                test_assert($orders[$b['pid']] > $orders[$a['pid']] || $orders[$b['pid']] > $orders[$actor['pid']], 'dynamic member appended at tail');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) {
                obl_runtime_transaction_rollback();
                throw $e;
            }
        },
        'initial_grenade_filters_other_qid_without_blocking_roster' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('initial-aoe-actor', 0, ['pls' => 1, 'att' => 8]);
            $room->reveal(1);
            $a = $room->player('initial-aoe-a', 1, ['pls' => 1, 'hp' => 100]);
            $b = $room->player('initial-aoe-b', 1, ['pls' => 1, 'hp' => 100]);
            $c = $room->player('initial-aoe-c', 1, ['pls' => 1, 'hp' => 100]);
            $other = $room->player('initial-aoe-other', 1, ['pls' => 1, 'hp' => 100]);
            $room->queue($other, 99, 1);
            obl_runtime_transaction_begin();
            try {
                $result = combat_start_battle($actor, [
                    ['act_id' => 'grenade', 'target' => ['type' => 'tile', 'id' => 1]],
                ]);
                test_assert(!empty($result['ok']), 'eligible AOE targets start battle');
                $action = $result['data']['actions'][0];
                $resolved = [];
                foreach ($action['targets'] as $targetResult) {
                    if (($targetResult['status'] ?? '') === 'resolved') $resolved[] = (int)$targetResult['pid'];
                }
                sort($resolved);
                $expected = [(int)$a['pid'], (int)$b['pid'], (int)$c['pid']]; sort($expected);
                test_same($expected, $resolved, 'only eligible A/B/C resolve');
                $otherQueue = obl_fetch_queue_by_pid((int)$other['pid']);
                test_same(99, (int)$otherQueue['qid'], 'other-qid row remains in source battle');
                test_same(100, (int)$room->fetch((int)$other['pid'])['hp'], 'other-qid target takes no damage');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) {
                obl_runtime_transaction_rollback();
                throw $e;
            }
        },
        'battle_start_reports_failed_utility_before_hostile_action' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('utility-report-actor', 0, ['pls' => 1, 'att' => 8]);
            $target = $room->player('utility-report-target', 1, ['pls' => 2, 'hp' => 100]);
            $room->reveal(2);
            obl_runtime_transaction_begin();
            try {
                $result = combat_start_battle($actor, [
                    ['act_id' => 'move', 'target' => ['type' => 'tile', 'id' => 2]],
                    ['act_id' => 'grenade', 'target' => ['type' => 'tile', 'id' => 2]],
                ]);
                test_assert(!empty($result['ok']), 'later hostile action starts battle');
                $actions = $result['data']['actions'];
                test_same(2, count($actions), 'response preserves failed utility and hostile action');
                test_same('move', (string)$actions[0]['actId'], 'failed utility retains action identity');
                test_same('failed', (string)$actions[0]['status'], 'occupied move is reported as failed');
                test_same('target_resolve_failed:AIM_RULE_FAILED:tile_occupied', (string)$actions[0]['reason'], 'failed utility exposes verification reason');
                test_same('grenade', (string)$actions[1]['actId'], 'hostile action follows failed utility');
                test_same('resolved', (string)$actions[1]['status'], 'hostile action still resolves');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) {
                obl_runtime_transaction_rollback();
                throw $e;
            }
        },
        'move_before_grenade_uses_updated_actor_position' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('move-overlay-actor', 0, ['pls' => 1, 'att' => 8]);
            $target = $room->player('move-overlay-target', 1, ['pls' => 6, 'hp' => 100]);
            $room->reveal(3, 6);
            test_same(5, obl_get_distance(1, 1, 6), 'target starts outside grenade range');
            test_same(2, obl_get_distance(1, 3, 6), 'move destination brings target into grenade range');
            obl_runtime_transaction_begin();
            try {
                $result = combat_start_battle($actor, [
                    ['act_id' => 'move', 'target' => ['type' => 'tile', 'id' => 3]],
                    ['act_id' => 'grenade', 'target' => ['type' => 'tile', 'id' => 6]],
                ]);
                test_assert(!empty($result['ok']), 'move makes later hostile action valid');
                $actions = $result['data']['actions'];
                test_same(['move', 'grenade'], array_column($actions, 'actId'), 'both actions are returned in execution order');
                test_same(['resolved', 'resolved'], array_column($actions, 'status'), 'move and grenade both resolve');
                test_same(3, (int)$room->fetch((int)$actor['pid'])['pls'], 'actor persists at moved position');
                test_same((int)$target['pid'], (int)$actions[1]['targets'][0]['pid'], 'grenade captures target after movement');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) {
                obl_runtime_transaction_rollback();
                throw $e;
            }
        },
        'empty_grenade_emits_two_delivery_events' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('grenadier', 0, ['pls' => 1]);
            $room->reveal(4);
            $cache = combat_cache_create($actor, false);
            $log = new BattleLogCollector();
            $config = combat_skill_get_config('grenade');
            $config = combat_action_config_with_target($config, ['target' => ['type' => 'tile', 'id' => 4]]);
            $ctx = new CombatContext($actor, 'grenade', $config, $log, $cache);
            $ctx->ap_cost = 2;
            $ctx->action_uid = 'empty-grenade';
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                test_assert($ctx->success, 'empty grenade executes');
                $deliveries = array_values(array_filter($log->getEntries(), static fn(array $e): bool => ($e['event_type'] ?? '') === 'action_delivery'));
                test_same(2, count($deliveries), 'grenade emits projectile and explosion delivery');
                test_same(['projectile_to_tile', 'explosion_at_tile'], array_column(array_column($deliveries, 'payload'), 'delivery_type'), 'delivery order');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
        'other_qid_target_is_not_stolen' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('qid-actor');
            $member = $room->player('qid-member', 1);
            $other = $room->player('qid-other', 1);
            $room->queue($actor, 21, 1); $room->queue($member, 21, 2); $room->queue($other, 22, 1);
            $cache = combat_cache_create($actor, false); $log = new BattleLogCollector();
            $config = combat_action_config_with_target(combat_skill_get_config('unarmed_strike'), ['target' => ['type' => 'pid', 'id' => $other['pid']]]);
            $ctx = new CombatContext($actor, 'unarmed_strike', $config, $log, $cache); $ctx->ap_cost = 1;
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                test_same('TARGET_IN_OTHER_BATTLE', $ctx->target_results[0]['reason'], 'other qid rejected');
                $row = obl_fetch_queue_by_pid($other['pid']);
                test_same(22, (int)$row['qid'], 'source qid unchanged');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) { obl_runtime_transaction_rollback(); throw $e; }
        },
    ]);
};
