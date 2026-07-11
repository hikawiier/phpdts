<?php
declare(strict_types=1);

return static function (TestRoom $room): array {
    return test_run_cases('skill_effect', [
        'definition_and_active_skill_truth_sources' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('skill-truth');
            test_same('effect', (string)skill_get_definition('flustered')['lifetime'], 'flustered is an effect definition');
            test_same(1, (int)combat_skill_get_config('unarmed_strike')['apcost'], 'combat config owns AP');
            $actor['skillpara']['flustered'] = ['lstact' => 0, 'effect_instances' => []];
            $ids = array_column(skill_get_available_list($actor), 'act_id');
            test_assert(!in_array('flustered', $ids, true), 'passive effect is not preloadable');
            test_assert(in_array('unarmed_strike', $ids, true), 'active combat skill remains available');
        },
        'pending_active_expired_roundtrip_and_refresh' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('effect-roundtrip');
            $first = skill_effect_apply($actor, 'flustered', ['kind' => 'skill', 'skill_id' => 'escape'], [
                'boundary' => 'battle_disband', 'boundary_id' => 61, 'delay_ticks' => 1, 'evaluation_tick' => 10,
            ], 'fx-first');
            test_same('pending', $first['state'], 'effect starts pending');
            skill_effect_apply($actor, 'flustered', ['kind' => 'skill', 'skill_id' => 'escape'], [
                'boundary' => 'battle_disband', 'boundary_id' => 61, 'delay_ticks' => 1, 'evaluation_tick' => 11,
            ], 'fx-refresh');
            test_same(['fx-refresh'], array_keys($actor['skillpara']['flustered']['effect_instances']), 'pending refresh replaces prior pending');
            obl_save_player($actor);
            $actor = $room->fetch((int)$actor['pid']);
            test_same('pending', $actor['skillpara']['flustered']['effect_instances']['fx-refresh']['state'], 'pending survives DB roundtrip');
            test_same([], skill_effect_activate_boundary($actor, 'battle_disband', 99, 13), 'wrong boundary id does not activate');
            $activated = skill_effect_activate_boundary($actor, 'battle_disband', 61, 13);
            test_same(1, count($activated), 'matching boundary activates one instance');
            test_same(14, (int)$activated[0]['starts_at_tick'], 'activation delay anchors next tick');
            test_same(15, (int)$activated[0]['expires_at_tick'], 'expiry is exclusive upper bound');
            test_assert(!skill_effect_is_active($activated[0], 13), 'not active before start');
            test_assert(skill_effect_is_active($activated[0], 14), 'active at start tick');
            test_assert(!skill_effect_is_active($activated[0], 15), 'expired at exclusive boundary');
            test_assert(skill_effect_gc($actor, 15), 'GC removes expired instance');
            test_assert(!isset($actor['skillpara']['flustered']), 'empty effect skill state is removed');
        },
        'format_rejects_unbounded_active_instance' => static function (): void {
            $state = ['effect_instances' => [
                'broken' => [
                    'instance_uid' => 'broken',
                    'state' => 'active',
                    'activation' => ['boundary' => 'immediate', 'boundary_id' => 0, 'delay_ticks' => 0],
                    'starts_at_tick' => null,
                    'expires_at_tick' => null,
                ],
            ]];
            skill_effect_format_skill_state('flustered', $state);
            test_same([], $state['effect_instances'], 'active instance without tick bounds is rejected');
        },
        'active_to_pending_preserves_current_restriction' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('effect-overlap');
            skill_effect_apply($actor, 'flustered', ['kind' => 'test'], [
                'boundary' => 'immediate', 'boundary_id' => 0, 'delay_ticks' => 0, 'evaluation_tick' => 14,
            ], 'fx-active');
            skill_effect_apply($actor, 'flustered', ['kind' => 'test'], [
                'boundary' => 'battle_disband', 'boundary_id' => 72, 'delay_ticks' => 1, 'evaluation_tick' => 14,
            ], 'fx-pending');
            $instances = $actor['skillpara']['flustered']['effect_instances'];
            test_same(2, count($instances), 'active and next pending coexist');
            $decision = actor_capability_decide($actor, 'voluntary_move', null, 14);
            test_assert(empty($decision['allowed']), 'pending refresh does not cancel active restriction');
            test_same(1, count($decision['sources']), 'only active instance contributes capability denial');
        },
        'capability_registry_projection_and_expired_ignore' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('capability-projection');
            skill_effect_apply($actor, 'flustered', ['kind' => 'test'], [
                'boundary' => 'immediate', 'boundary_id' => 0, 'delay_ticks' => 0, 'evaluation_tick' => 14,
            ], 'fx-capability');
            test_assert(empty(actor_capability_decide($actor, 'unknown_typo', null, 14)['allowed']), 'unknown capability fails closed');
            $caps = skill_effect_project_capabilities($actor, actor_capability_all(), 14, true);
            test_assert(empty($caps['enter_combat']['allowed']), 'denied capability is projected');
            test_assert(!empty($caps['time_pass']['allowed']), 'allowed capability is projected');
            test_same(['flustered'], $caps['enter_combat']['source_status_ids'], 'public status source is preserved');
            test_assert(!empty(actor_capability_decide($actor, 'enter_combat', null, 15)['allowed']), 'expired status is ignored before GC');
            test_same([], skill_effect_project_statuses($actor, 15, true), 'expired status is omitted before GC');
        },
        'command_gate_blocks_mutation_and_wait_bypasses_itm0' => static function () use ($room): void {
            global $db, $gtablepre, $cuser, $cpass, $groomid, $obl_runtime_ctx, $gamevars;
            $room->resetData();
            $gamevars = ['obl_tick' => 13, 'obl_pretick' => 13];
            $actor = $room->player('command-capability');
            skill_effect_apply($actor, 'flustered', ['kind' => 'test'], [
                'boundary' => 'immediate', 'boundary_id' => 0, 'delay_ticks' => 1, 'evaluation_tick' => 13,
            ], 'fx-command');
            $move = obl_command_gate('map.move', obl_command_contract('map.move'), ['to' => 2], [], $actor);
            test_same('CAPABILITY_BLOCKED', $move['code'], 'mutation command is blocked at next actionable tick');
            test_same(['player_info'], $move['data']['changed_scopes'], 'capability rejection requests authoritative refresh');
            test_same('flustered', $move['data']['feedback']['params']['status_id'], 'feedback identifies public blocking status');
            $actor['itempara'][0] = ['itmid' => 'held-item'];
            $wait = obl_command_gate('world.wait', obl_command_contract('world.wait'), [], [], $actor);
            test_assert(!empty($wait['ok']), 'world.wait remains available with itm0 pending');
            test_assert(!empty(obl_command_contract('combat.can_engage')['itm0_allowed']), 'read-only can-engage remains available with itm0 pending');
            $actor['itempara'][0] = array();

            $gamevars = ['obl_tick' => 14, 'obl_pretick' => 13];
            test_same(14, skill_effect_next_action_tick(), 'unprocessed tick remains the next capability frame');
            $pending_frame_move = obl_command_gate('map.move', obl_command_contract('map.move'), ['to' => 2], [], $actor);
            test_same('CAPABILITY_BLOCKED', $pending_frame_move['code'], 'pending heartbeat frame cannot skip the active restriction');

            $gamevars = ['obl_tick' => 14, 'obl_pretick' => 14];
            test_same(15, skill_effect_next_action_tick(), 'processed tick advances evaluation to the next frame');
            test_assert(!empty(obl_command_gate('map.move', obl_command_contract('map.move'), ['to' => 2], [], $actor)['ok']), 'restriction expires after its active frame is processed');

            $gamevars = ['obl_tick' => 13, 'obl_pretick' => 13];

            $userResult = $db->query("SELECT username,password FROM {$gtablepre}users WHERE username<>'' LIMIT 1");
            $user = $db->fetch_array($userResult);
            test_assert(is_array($user), 'global auth fixture exists');
            $apiActor = $room->player((string)$user['username']);
            skill_effect_apply($apiActor, 'flustered', ['kind' => 'test'], [
                'boundary' => 'immediate', 'boundary_id' => 0, 'delay_ticks' => 1, 'evaluation_tick' => 13,
            ], 'fx-api-command');
            obl_save_player($apiActor);
            $cuser = (string)$user['username'];
            $cpass = (string)$user['password'];
            $groomid = 99992;
            $obl_runtime_ctx = ['is_oblivions' => true];
            $response = obl_command_api_handle([
                'command' => 'map.move',
                'payload' => ['to' => 2],
                'request_id' => 'capability-blocked-test',
                'expected' => [],
            ]);
            test_same('CAPABILITY_BLOCKED', $response['code'], 'Command Bus exposes capability error code');
            test_same(['player_info'], $response['data']['changed_scopes'], 'Command Bus preserves changed scopes on gate failure');
            test_same('status.capability_blocked', $response['data']['feedback']['id'], 'Command Bus preserves structured feedback');
            test_assert(!isset($GLOBALS['obl_command_operation_key']), 'Command Bus restores request-local operation key after response');
            $gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
        },
        'bootstrap_registers_post_gc_listener_once' => static function (): void {
            $listeners = obl_tick_get_listeners('post');
            test_same(1, count(array_filter($listeners, static fn($listener): bool => $listener === 'skill_effect_tick_post_listener')), 'post listener is registered exactly once');
            skill_effect_register_tick_listener();
            $listeners = obl_tick_get_listeners('post');
            test_same(1, count(array_filter($listeners, static fn($listener): bool => $listener === 'skill_effect_tick_post_listener')), 'post listener registration is idempotent');
        },
        'command_response_merges_boundary_invalidation' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('changed-scopes');
            obl_authority_mark_changed_scopes(array('combat_targets'));
            $data = obl_command_build_response_data('world.wait', obl_command_contract('world.wait'), $actor);
            test_assert(in_array('player_info', $data['changed_scopes'], true), 'static command refresh is exposed as changed scope');
            test_assert(in_array('combat_targets', $data['changed_scopes'], true), 'boundary invalidation is merged into command response');
            test_same(array(), obl_authority_take_changed_scopes(), 'command response consumes merged authority scopes');
        },
        'action_uid_prefers_stable_command_operation_key' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('stable-operation-key');
            $GLOBALS['obl_request_uid'] = 'random-request-a';
            $GLOBALS['obl_command_operation_key'] = 'client-request-42';
            $first = combat_log_v2_make_action_uid($actor, 'escape', 1);
            $GLOBALS['obl_request_uid'] = 'random-request-b';
            $second = combat_log_v2_make_action_uid($actor, 'escape', 1);
            test_same($first, $second, 'client request id stabilizes action uid across request retries');
            $GLOBALS['obl_command_operation_key'] = 'client-request-43';
            test_assert($first !== combat_log_v2_make_action_uid($actor, 'escape', 1), 'different operation keys produce different action uids');
            unset($GLOBALS['obl_command_operation_key']);
        },
    ]);
};
