<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_command_handler_dispatch($command, $payload, &$pdata) {
    switch ($command) {
        case 'map.move':
            obl_move($payload['to'], $pdata);
            break;
        case 'map.explore':
            obl_explore($pdata);
            break;
        case 'poi.search':
            obl_search_poi($payload['iaid'], $pdata);
            break;
        case 'world.wait':
            global $obl_log;
            if (isset($obl_log) && $obl_log) $obl_log->emit('wait.success', 'world');
            break;
        case 'item.pickup':
            obl_pickup_item($payload['iid'], $pdata);
            break;
        case 'item.discard':
            obl_discard_item($payload['slot'], $pdata);
            break;
        case 'item.use':
            obl_command_handler_item_use($payload, $pdata);
            break;
        case 'inventory.organize':
            obl_command_handler_inventory_organize($pdata);
            break;
        case 'craft.execute':
            $slots = isset($payload['slots']) ? $payload['slots'] : array();
            $workbench_materials = isset($payload['workbench_materials']) ? $payload['workbench_materials'] : array();
            item_craft($slots, $pdata, $workbench_materials);
            break;
        case 'battle.start':
            error_log("[combat_engine] routed to new system: battle.start (pid={$pdata['pid']})");
            $latest = obl_fetch_playerdata_by_pid_for_update((int)$pdata['pid']);
            if (!$latest) return array('ok' => false, 'code' => 'ACTOR_NOT_FOUND');
            obl_format_playerdata($latest);
            $pdata = $latest;
            return combat_start_battle($pdata, $payload['actions']);
        case 'battle.submit_turn':
            error_log("[combat_engine] routed to new system: battle.submit_turn (pid={$pdata['pid']})");
            $latest = obl_fetch_playerdata_by_pid_for_update((int)$pdata['pid']);
            if (!$latest) return array('ok' => false, 'code' => 'ACTOR_NOT_FOUND');
            obl_format_playerdata($latest);
            $pdata = $latest;
            return combat_dispatch('player_turn', $pdata, $payload['actions']);
        case 'combat.can_engage':
            // L0 可达性查询：前端"点击敌人发起战斗"前的预判
            // 返回 reachable / max_attack_range / move_power / distance / reason
            $target_pid = (int)($payload['target_pid'] ?? 0);
            if ($target_pid <= 0) {
                return array('ok' => false, 'code' => 'INVALID_TARGET');
            }
            $target_data = obl_fetch_playerdata_by_pid($target_pid);
            if (!$target_data) {
                return array('ok' => true, 'data' => combat_engagement_not_visible_result());
            }
            $result = combat_can_engage($pdata, $target_data);
            return array('ok' => true, 'data' => $result);

        case 'combat.preview_single':
            // L1 即时校验：单次 action 合法性预判
            $act_id = (string)($payload['act_id'] ?? '');
            $aim_intent = $payload['aim_intent'] ?? ($payload['target_pid'] ?? null);
            if ($act_id === '' || $aim_intent === null) {
                return array('ok' => false, 'code' => 'INVALID_PARAMS');
            }
            $result = combat_preview_single($pdata, $act_id, $aim_intent);
            return array('ok' => true, 'data' => $result);

        case 'combat.preview_targets':
            $act_id = trim((string)($payload['act_id'] ?? ''));
            $prefix_actions = isset($payload['prefix_actions']) && is_array($payload['prefix_actions'])
                ? $payload['prefix_actions']
                : array();
            if (!empty($prefix_actions)) {
                $prefix_check = obl_command_validate_actions($prefix_actions);
                if (empty($prefix_check['ok'])) return array('ok' => false, 'code' => 'INVALID_ACTIONS');
                $prefix_actions = $prefix_check['value'];
            }
            $candidate_ids = isset($payload['candidate_ids']) && is_array($payload['candidate_ids'])
                ? $payload['candidate_ids']
                : array();
            return array('ok' => true, 'data' => combat_preview_targets($pdata, $act_id, $prefix_actions, $candidate_ids));

        case 'combat.preview_chain':
            // L2 动作链模拟：整条动作链预校验
            $actions = $payload['actions'] ?? [];
            $battle_cache = $payload['battle_cache'] ?? ['combatants' => [], 'tag_mutations' => []];
            if (!is_array($actions) || empty($actions)) {
                return array('ok' => false, 'code' => 'INVALID_ACTIONS');
            }
            $result = combat_preview_chain($pdata, $actions, $battle_cache);
            return array('ok' => true, 'data' => $result);

        default:
            return array('ok' => false, 'code' => 'UNKNOWN_COMMAND');
    }
    return array('ok' => true);
}

function obl_command_handler_item_use($payload, &$pdata) {
    global $obl_log;
    $slot = isset($payload['slot']) ? (int)$payload['slot'] : 0;
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending && $slot !== 0) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    item_use($slot, $pdata);
}

function obl_command_handler_inventory_organize(&$pdata) {
    global $obl_log;
    $item_id = isset($pdata['itempara'][0]['itmid']) ? (string)$pdata['itempara'][0]['itmid'] : '';
    $success = obl_organize_inventory($pdata);
    if (isset($obl_log) && $obl_log) {
        if ($success) {
            $obl_log->emit('item.to_bag', 'system', array('item_id' => $item_id));
        } else {
            $obl_log->emit('organize.fail', 'system', array('item_id' => $item_id));
        }
    }
}
