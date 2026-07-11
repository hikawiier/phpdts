<?php
declare(strict_types=1);

return static function (TestRoom $room): array {
    return test_run_cases('range', [
        'five_modes_share_one_resolver_and_unknown_fails_closed' => static function (): void {
            $actor = ['ap' => 3];
            $base = ['apcost' => 1, 'ap_calc' => 'fixed'];
            $cases = [
                'fixed' => [['mode' => 'fixed', 'max' => 4, 'bonus' => 0], 4],
                'inherit' => [['mode' => 'inherit', 'max' => 9, 'bonus' => 0], 1],
                'additive' => [['mode' => 'additive', 'max' => 9, 'bonus' => 2], 3],
                'capped_additive' => [['mode' => 'capped_additive', 'max' => 2, 'bonus' => 5], 2],
                'move_power' => [['mode' => 'move_power', 'max' => 0, 'bonus' => 0], 3],
            ];
            foreach ($cases as $mode => [$range, $expected]) {
                $result = combat_range_resolve_config($actor, array_merge($base, ['range' => $range]), 'test-' . $mode);
                test_assert(!empty($result['ok']), $mode . ' resolves');
                test_same($expected, (int)$result['base_range'], $mode . ' base range');
            }
            $invalid = combat_range_resolve_config($actor, array_merge($base, ['range' => ['mode' => 'typo', 'max' => 3, 'bonus' => 0]]), 'test-invalid');
            test_assert(empty($invalid['ok']), 'unknown mode fails closed');
            test_same('unknown_range_mode', $invalid['reason'], 'unknown mode has explicit reason');
        },
        'move_budget_projection_matches_real_quote' => static function (): void {
            $actor = ['pid' => 1, 'pgroup' => 1, 'pls' => 1, 'ap' => 3];
            $config = [
                'apcost' => 2,
                'ap_calc' => 'move_distance',
                'range' => ['mode' => 'move_power', 'max' => 0, 'bonus' => 0],
            ];
            $profile = combat_range_resolve_config($actor, $config, 'test-move-budget');
            test_same(9, (int)$profile['effective_range'], 'AP3 projects nine tiles even with base apcost two');
            $cache = ['combatants' => [1 => 1], 'tag_mutations' => []];
            $log = null;
            $ctx = new CombatContext($actor, 'test-move-budget', $config, $log, $cache);
            $ctx->targets = [[
                'kind' => 'tile', 'pid' => 0,
                'target_data' => ['pgroup' => 1, 'pls' => 6],
                'effects' => [], 'tags' => [], 'snapshot_target_state' => null,
            ]];
            $decision = combat_spatial_decide($ctx);
            test_same(5, (int)$decision['distance'], 'fixture distance');
            test_same(2, (int)$decision['target_ap_cost'], 'real calculator quotes base AP for distance five');
            test_assert(!empty($decision['allowed']), 'budget projection and quote agree');
        },
        'long_move_preview_projector_and_effect_agree' => static function () use ($room): void {
            global $db;
            $room->resetData();
            $actor = $room->player('long-move-actor', 0, ['pls' => 1, 'ap' => 2, 'max_ap' => 2]);
            $db->query("INSERT INTO {$room->prefix}oblmapstates(pgroup,pls,fog,damaged,flags) VALUES (1,6,1,0,'')");
            test_same(5, obl_get_distance(1, 1, 6), 'long move fixture distance');
            $preview = combat_preview_single($actor, 'move', ['type' => 'tile', 'id' => 6]);
            test_assert(!empty($preview['pass']), 'preview accepts affordable long move');
            test_same(2, (int)$preview['ap_cost'], 'preview quotes two AP');

            $config = combat_action_config_with_target(combat_skill_get_config('move'), ['target' => ['type' => 'tile', 'id' => 6]]);
            $cache = combat_cache_create($actor, false);
            $log = new BattleLogCollector();
            $ctx = new CombatContext($actor, 'move', $config, $log, $cache);
            $ctx->ap_cost = 2;
            $ctx->action_uid = 'long-move-execute';
            combat_action_reserve_resources($ctx);
            obl_runtime_transaction_begin();
            try {
                combat_pipeline_run($ctx);
                test_assert($ctx->success, 'real pipeline accepts same long move');
                test_same(6, (int)$actor['pls'], 'effect persists projected destination');
                test_same(0, (int)$actor['ap'], 'effect keeps frozen AP quote');
                obl_runtime_transaction_commit();
            } catch (Throwable $e) {
                obl_runtime_transaction_rollback();
                throw $e;
            }
        },
        'skill_list_projects_base_and_effective_range' => static function () use ($room): void {
            $room->resetData();
            $actor = $room->player('range-list-actor', 0, ['ap' => 2]);
            $byId = [];
            foreach (skill_get_available_list($actor) as $skill) $byId[(string)$skill['act_id']] = $skill;
            test_same(3, (int)$byId['move']['range']['base'], 'move base range is move power');
            test_same(6, (int)$byId['move']['range']['effective'], 'move effective range uses current wallet');
            test_same(3, (int)$byId['move']['action_range'], 'legacy action_range keeps base-range semantics');
        },
    ]);
};
