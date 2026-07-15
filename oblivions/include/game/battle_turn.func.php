<?php
/**
 * @module E 游戏逻辑
 * @framework E-5 权威战斗与回合生命周期状态机
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function battle_turn_key($qid, $turn_seq) {
    return (int)$qid . ':' . (int)$turn_seq;
}

function battle_turn_coordinates(array $record) {
    return array(
        'qid' => (int)$record['qid'],
        'round_num' => (int)$record['round_num'] + 1,
        'turn_seq' => (int)$record['turn_seq'],
        'turn_key' => battle_turn_key($record['qid'], $record['turn_seq']),
    );
}

function battle_turn_set_event_context(?array $record) {
    if ($record === null) {
        unset($GLOBALS['obl_active_battle_turn']);
        return;
    }
    $GLOBALS['obl_active_battle_turn'] = battle_turn_coordinates($record);
}

function battle_turn_get_event_context() {
    return isset($GLOBALS['obl_active_battle_turn']) && is_array($GLOBALS['obl_active_battle_turn'])
        ? $GLOBALS['obl_active_battle_turn']
        : null;
}

function battle_turn_current_tick() {
    return function_exists('obl_tick_get') ? (int)obl_tick_get() : 0;
}

function battle_turn_apply_start_rules(array &$actor, array &$battle_cache, $log, $turn_seq) {
    $recovered = battle_ap_recover($actor, $battle_cache, $log);
    $activated = skill_effect_activate_boundary(
        $actor,
        'battle_turn_open',
        (int)$turn_seq,
        battle_turn_current_tick()
    );
    if (!empty($activated) && function_exists('obl_authority_mark_actor_changed')) {
        obl_authority_mark_actor_changed($actor, true);
    }
    obl_save_player($actor);
    return array('ap_recovered' => (int)$recovered, 'activated_effects' => $activated);
}

function battle_turn_actor_is_eligible(array &$actor, array &$battle_cache, $log) {
    if (!battle_actor_can_act($actor, $log, $battle_cache)) return false;
    $decision = actor_capability_decide(
        $actor,
        'combat_action',
        array('source' => 'battle_turn_open'),
        combat_next_action_evaluation_tick()
    );
    return !empty($decision['allowed']);
}

function battle_turn_queue_status($qid) {
    $rows = obl_fetch_queue_all_by_qid($qid);
    $active_count = 0;
    $has_player = false;
    foreach ($rows as $row) {
        if ((int)$row['active'] !== 1) continue;
        $active_count++;
        if ((int)$row['type'] === 0) $has_player = true;
    }
    return array(
        'rows' => $rows,
        'active_count' => $active_count,
        'has_player' => $has_player,
        'ended' => empty($rows) || $active_count <= 1 || !$has_player,
        'reason' => empty($rows) ? 'queue_empty' : 'disband',
    );
}

function battle_turn_collect_survivors(array $queue_rows) {
    $survivors = array();
    foreach ($queue_rows as $row) {
        if ((int)$row['active'] !== 1) continue;
        $data = obl_fetch_playerdata_by_pid((int)$row['pid']);
        $snapshot = function_exists('combat_log_v3_combatant_snapshot')
            ? combat_log_v3_combatant_snapshot($data)
            : null;
        if ($snapshot !== null) $survivors[] = $snapshot;
    }
    return $survivors;
}

function battle_turn_end_battle($qid, $reason, $winner_pid, $log, ?array &$actor = null) {
    $record = obl_battle_state_get_record($qid, true);
    if ($record && $record['state'] === OBL_BS_EXECUTING) {
        if (!obl_battle_state_close_atomic(
            $qid,
            (int)$record['active_pid'],
            (int)$record['turn_seq']
        )) {
            return array('ok' => false, 'code' => 'STALE_TURN');
        }
    } elseif ($record && $record['state'] !== OBL_BS_IDLE) {
        return array('ok' => false, 'code' => 'TURN_STATE_CONFLICT');
    }

    $status = battle_turn_queue_status($qid);
    $survivors = battle_turn_collect_survivors($status['rows']);
    $resolved_winner_pid = count($survivors) === 1
        ? (int)$survivors[0]['pid']
        : (int)$winner_pid;
    if ($log && function_exists('combat_log_v3_battle_end')) {
        combat_log_v3_battle_end($log, (string)$reason, $resolved_winner_pid, $survivors, (int)$qid);
    }

    if (!empty($status['rows'])) {
        if ($actor !== null) {
            battle_disband_cleanup($qid, $actor, $log);
        } else {
            $first = null;
            foreach ($status['rows'] as $row) {
                $first = obl_fetch_playerdata_by_pid((int)$row['pid']);
                if ($first) break;
            }
            if ($first) battle_disband_cleanup($qid, $first, $log);
        }
    } else {
        foreach (obl_fetch_pids_by_bid($qid) as $pid) {
            $data = obl_fetch_playerdata_by_pid((int)$pid);
            if ($data) battle_disband_cleanup_actor($qid, $data, $log);
        }
    }

    obl_queue_delete_by_qid($qid);
    obl_battle_state_destroy($qid);
    battle_turn_set_event_context(null);
    return array('ended' => true, 'reason' => (string)$reason);
}

function battle_turn_next_candidate($qid, array &$actor, $log) {
    $status = battle_turn_queue_status($qid);
    if ($status['ended']) return array('ended' => true, 'status' => $status, 'candidate' => null, 'rebuilt' => false);

    $candidate = obl_fetch_queue_current_initiator($qid);
    if ($candidate) return array('ended' => false, 'candidate' => $candidate, 'rebuilt' => false, 'status' => $status);

    battle_queue_rebuild($qid, $actor, $log);
    obl_battle_state_increment_round($qid);
    $candidate = obl_fetch_queue_current_initiator($qid);
    return array(
        'ended' => $candidate === false,
        'candidate' => $candidate ?: null,
        'rebuilt' => true,
        'status' => battle_turn_queue_status($qid),
    );
}

function battle_turn_open($qid, $opening_kind = 'turn') {
    global $obl_battle_log;
    $opening_kind = $opening_kind === 'battle_start' ? 'battle_start' : 'turn';

    for ($attempt = 0; $attempt < 128; $attempt++) {
        $placeholder = array('pid' => 0);
        $selection = battle_turn_next_candidate($qid, $placeholder, $obl_battle_log);
        if (!empty($selection['ended']) || empty($selection['candidate'])) {
            $actor = null;
            return battle_turn_end_battle(
                $qid,
                $selection['status']['reason'] ?? 'no_candidate',
                0,
                $obl_battle_log,
                $actor
            );
        }

        $candidate = $selection['candidate'];
        $record = obl_battle_state_get_record($qid, true);
        if (!$record || $record['state'] !== OBL_BS_IDLE) {
            return array('ok' => false, 'code' => 'TURN_STATE_CONFLICT');
        }

        $opened_at_tick = battle_turn_current_tick();
        if (!obl_battle_state_open_identity_atomic($qid, $record, (int)$candidate['pid'], $opened_at_tick)) {
            return array('ok' => false, 'code' => 'TURN_STATE_CONFLICT');
        }

        $opened = obl_battle_state_get_record($qid, true);
        if (!$opened) return array('ok' => false, 'code' => 'TURN_STATE_MISSING');
        battle_turn_set_event_context($opened);

        $actor = obl_fetch_playerdata_by_pid_for_update((int)$candidate['pid']);
        if (!$actor) {
            obl_update_queue_done((int)$candidate['pid'], $qid, 1);
            if (!obl_battle_state_close_atomic($qid, (int)$candidate['pid'], (int)$opened['turn_seq'])) {
                return array('ok' => false, 'code' => 'TURN_STATE_CONFLICT');
            }
            continue;
        }

        $battle_cache = combat_cache_create($actor, false);
        $start = battle_turn_apply_start_rules($actor, $battle_cache, $obl_battle_log, (int)$opened['turn_seq']);
        if (!battle_turn_actor_is_eligible($actor, $battle_cache, $obl_battle_log)) {
            obl_update_queue_done((int)$candidate['pid'], $qid, 1);
            if (!obl_battle_state_close_atomic($qid, (int)$candidate['pid'], (int)$opened['turn_seq'])) {
                return array('ok' => false, 'code' => 'TURN_STATE_CONFLICT');
            }
            continue;
        }

        $controller = (int)$candidate['type'] === 0 ? 'player' : 'system';
        $published_state = $controller === 'player' ? OBL_BS_AWAITING_INPUT : OBL_BS_AUTO_PENDING;
        if (!obl_battle_state_publish_open_atomic(
            $qid,
            (int)$candidate['pid'],
            (int)$opened['turn_seq'],
            $published_state
        )) {
            return array('ok' => false, 'code' => 'TURN_STATE_CONFLICT');
        }

        $published = obl_battle_state_get_record($qid, true);
        battle_turn_set_event_context($published);
        if ($obl_battle_log && function_exists('combat_log_v3_turn_opened')) {
            combat_log_v3_turn_opened(
                $obl_battle_log,
                $published,
                $actor,
                $controller,
                $opening_kind,
                (int)$start['ap_recovered']
            );
        }

        return array('ok' => true, 'turn' => $published, 'actor' => $actor);
    }

    throw new RuntimeException('Battle turn open exceeded candidate limit');
}

function battle_turn_claim_player($qid, $pid, $expected_turn_seq) {
    if (!obl_battle_state_claim_atomic($qid, OBL_BS_AWAITING_INPUT, $pid, $expected_turn_seq)) {
        return array('ok' => false, 'code' => 'STALE_TURN');
    }
    $record = obl_battle_state_get_record($qid, true);
    battle_turn_set_event_context($record);
    return array('ok' => true, 'turn' => $record);
}

function battle_turn_claim_system($qid, $pid) {
    $record = obl_battle_state_get_record($qid, true);
    if (!$record || (int)$record['active_pid'] !== (int)$pid) {
        return array('ok' => false, 'code' => 'STALE_TURN');
    }
    if (!obl_battle_state_claim_atomic($qid, OBL_BS_AUTO_PENDING, $pid, (int)$record['turn_seq'])) {
        return array('ok' => false, 'code' => 'STALE_TURN');
    }
    $claimed = obl_battle_state_get_record($qid, true);
    battle_turn_set_event_context($claimed);
    return array('ok' => true, 'turn' => $claimed);
}

function battle_turn_assert_executing(array $turn, array $actor) {
    $record = obl_battle_state_get_record((int)$turn['qid'], true);
    return $record
        && $record['state'] === OBL_BS_EXECUTING
        && (int)$record['active_pid'] === (int)$actor['pid']
        && (int)$record['turn_seq'] === (int)$turn['turn_seq'];
}

function battle_turn_complete_and_open_next(array &$actor, $log, array &$battle_cache, array $turn) {
    $qid = (int)$turn['qid'];
    if (!battle_turn_assert_executing($turn, $actor)) {
        return array('ok' => false, 'code' => 'STALE_TURN');
    }

    $queue = battle_manage_queue($actor, $log, $battle_cache);
    if (!empty($queue['ended'])) {
        return battle_turn_end_battle($qid, $queue['reason'] ?? 'disband', (int)$actor['pid'], $log, $actor);
    }

    if (!empty($queue['rebuilt'])) {
        obl_battle_state_increment_round($qid);
    }
    if (!obl_battle_state_close_atomic($qid, (int)$actor['pid'], (int)$turn['turn_seq'])) {
        return array('ok' => false, 'code' => 'STALE_TURN');
    }
    return battle_turn_open($qid, 'turn');
}
