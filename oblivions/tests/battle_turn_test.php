<?php
declare(strict_types=1);

return static function (TestRoom $room): array {
    return test_run_cases('battle_turn', [
        'authoritative_turn_sequence_claims_and_round_rebuild' => static function () use ($room): void {
            global $db, $obl_battle_log;
            $room->resetData();
            $player = $room->player('turn-player', 0, ['ap' => 1, 'max_ap' => 20]);
            $npc = $room->player('turn-npc', 1, ['ap' => 2, 'max_ap' => 10]);
            $room->queue($player, 71, 1);
            $room->queue($npc, 71, 2);
            $db->query("UPDATE {$room->prefix}oblbattle_state SET state='IDLE', round_num=0, turn_seq=0, active_pid=0, opened_at_tick=0 WHERE qid=71");

            $opened1 = battle_turn_open(71, 'battle_start');
            test_assert(!empty($opened1['ok']), 'first turn opens');
            test_same(1, (int)$opened1['turn']['turn_seq'], 'first authoritative turn seq');
            test_same('AWAITING_INPUT', (string)$opened1['turn']['state'], 'player turn awaits input');
            test_same(20, (int)$opened1['actor']['ap'], 'AP recovers before input opens');
            $openedEvent1 = current(array_values(array_filter(
                $obl_battle_log->getEntries(),
                static fn(array $event): bool => ($event['event_type'] ?? '') === 'turn_opened'
            )));
            test_same('battle_start', (string)$openedEvent1['payload']['opening_kind'], 'first opening is explicit battle_start');
            test_same(20, (int)$openedEvent1['payload']['actor']['ap'], 'turn event sees recovered AP snapshot');
            test_same(19, (int)$openedEvent1['payload']['ap_recovered'], 'turn event reports AP recovery');

            $wrong = battle_turn_claim_player(71, (int)$npc['pid'], 1);
            test_same('STALE_TURN', (string)$wrong['code'], 'wrong actor cannot claim player turn');
            $claim1 = battle_turn_claim_player(71, (int)$player['pid'], 1);
            test_assert(!empty($claim1['ok']), 'matching player claim succeeds');
            $duplicate = battle_turn_claim_player(71, (int)$player['pid'], 1);
            test_same('STALE_TURN', (string)$duplicate['code'], 'same turn can only be claimed once');

            $playerRun = $room->fetch((int)$player['pid']);
            $cache = combat_cache_create($playerRun, false);
            $next = battle_turn_complete_and_open_next($playerRun, $obl_battle_log, $cache, $claim1['turn']);
            test_assert(!empty($next['ok']), 'closing player turn opens next turn');
            test_same(2, (int)$next['turn']['turn_seq'], 'turn seq persists across lifecycle operation');
            test_same('AUTO_PENDING', (string)$next['turn']['state'], 'NPC turn waits for system claim');
            test_same((int)$npc['pid'], (int)$next['turn']['active_pid'], 'NPC becomes authoritative actor');

            // 模拟下一 HTTP 请求：请求级 collector 重建，但 DB turn_seq 不重置。
            $obl_battle_log = new BattleLogCollector();
            $claim2 = battle_turn_claim_system(71, (int)$npc['pid']);
            test_assert(!empty($claim2['ok']), 'NPC claims AUTO_PENDING turn');
            test_same('EXECUTING', (string)$claim2['turn']['state'], 'NPC claim enters EXECUTING');
            $npcRun = $room->fetch((int)$npc['pid']);
            $npcCache = combat_cache_create($npcRun, false);
            $round2 = battle_turn_complete_and_open_next($npcRun, $obl_battle_log, $npcCache, $claim2['turn']);
            test_assert(!empty($round2['ok']), 'round rebuild opens next player turn');
            test_same(3, (int)$round2['turn']['turn_seq'], 'turn seq remains monotonic after rebuild');
            test_same(1, (int)$round2['turn']['round_num'], 'database round increments after rebuild');
            test_same('AWAITING_INPUT', (string)$round2['turn']['state'], 'rebuilt round opens player input');
            $roundEvent = current(array_values(array_filter(
                $obl_battle_log->getEntries(),
                static fn(array $event): bool => ($event['event_type'] ?? '') === 'turn_opened'
            )));
            test_same('turn', (string)$roundEvent['payload']['opening_kind'], 'later opening is ordinary turn');
            test_same(2, (int)$roundEvent['round_num'], 'event round is external 1-indexed');
            test_same('71:3', (string)$roundEvent['turn_key'], 'event uses stable turn key');
        },

        'transaction_rollback_removes_opened_turn_and_event' => static function () use ($room): void {
            global $db, $obl_battle_log;
            $room->resetData();
            $player = $room->player('rollback-turn-player', 0, ['ap' => 1]);
            $npc = $room->player('rollback-turn-npc', 1);
            $room->queue($player, 72, 1);
            $room->queue($npc, 72, 2);
            $db->query("UPDATE {$room->prefix}oblbattle_state SET state='IDLE', round_num=0, turn_seq=0, active_pid=0, opened_at_tick=0 WHERE qid=72");
            $before = $obl_battle_log->checkpoint();

            obl_runtime_transaction_begin();
            try {
                $opened = battle_turn_open(72, 'battle_start');
                test_assert(!empty($opened['ok']), 'turn opens inside transaction');
                test_same(1, (int)obl_battle_state_get_record(72)['turn_seq'], 'uncommitted turn identity is visible in transaction');
                test_assert($obl_battle_log->checkpoint() > $before, 'turn_opened buffered before rollback');
            } finally {
                obl_runtime_transaction_rollback();
            }

            $record = obl_battle_state_get_record(72);
            test_same('IDLE', (string)$record['state'], 'rollback restores battle state');
            test_same(0, (int)$record['turn_seq'], 'rollback restores turn sequence');
            test_same(0, (int)$record['active_pid'], 'rollback clears uncommitted actor');
            test_same($before, $obl_battle_log->checkpoint(), 'rollback removes uncommitted turn event');
            test_same(1, (int)$room->fetch((int)$player['pid'])['ap'], 'rollback restores pre-open AP');
        },
    ]);
};
