<?php
/**
 * @module B 命令系统
 * @framework B-3 命令总线执行管道
 */
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
            // E-10 三档判定：先按 iaid 查 POI 实例 + 位置校验，再调用新签名 obl_search_poi($pdata, $poi, $tool_id, $skill_id)
            $iaid = (int)$payload['iaid'];
            $tool_id = isset($payload['tool_id']) ? (string)$payload['tool_id'] : null;
            $skill_id = isset($payload['skill_id']) ? (string)$payload['skill_id'] : null;
            $poi = obl_lookup_poi_for_search($iaid, $pdata);
            if ($poi === null) {
                // lookup 函数已 emit 错误日志（not_found / not_adjacent）
                break;
            }
            obl_search_poi($pdata, $poi, $tool_id, $skill_id);
            break;
        case 'poi.interact':
            // F-6 道具交互：复用 obl_lookup_poi_for_search 做位置校验，再调用 poi_interact 主流程
            obl_command_handler_poi_interact($payload, $pdata);
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
        case 'item.equip':
            obl_command_handler_item_equip($payload, $pdata);
            break;
        case 'item.unequip':
            obl_command_handler_item_unequip($payload, $pdata);
            break;
        case 'item.swap_weapon':
            obl_command_handler_item_swap_weapon($payload, $pdata);
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
            $qid = (int)$payload['qid'];
            if ($qid !== (int)($pdata['bid'] ?? 0)) return array('ok' => false, 'code' => 'STALE_TURN');
            $claim = battle_turn_claim_player(
                $qid,
                (int)$pdata['pid'],
                (int)$payload['expected_turn_seq']
            );
            if (empty($claim['ok'])) return $claim;
            return combat_dispatch('player_turn', $pdata, $payload['actions'], array('turn' => $claim['turn']));
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

/**
 * poi.interact 命令 handler
 *
 * 流程：
 *   1. itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已拦截）
 *   2. 复用 obl_lookup_poi_for_search 做 POI 实例查询 + 位置校验
 *   3. 调用 poi_interact($slot, $poi, $pdata) 主流程
 *
 * @param array $payload {slot, iaid}
 * @param array &$pdata
 * @return void
 */
function obl_command_handler_poi_interact($payload, &$pdata) {
    $slot = isset($payload['slot']) ? (int)$payload['slot'] : 0;
    $iaid = isset($payload['iaid']) ? (int)$payload['iaid'] : 0;

    // itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已在 gate 层拦截）
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }

    // 复用 poi.search 的位置校验：SELECT oblmappoi + pgroup/pls 一致性
    $poi = obl_lookup_poi_for_search($iaid, $pdata);
    if ($poi === null) {
        // lookup 函数已 emit 错误日志（not_found / not_adjacent）
        return;
    }

    poi_interact($slot, $poi, $pdata);
}

function obl_command_handler_item_equip($payload, &$pdata) {
    $slot = isset($payload['slot']) ? (int)$payload['slot'] : 0;
    $equip_slot = isset($payload['equip_slot']) ? (string)$payload['equip_slot'] : '';
    if ($equip_slot === '') $equip_slot = null;
    // itm0_pending 防御性检查：item.equip 合约 itm0_allowed=false，bus 已在 gate 层拦截，
    // 此处保留与 item.use 一致的防御性日志，避免任何绕过 gate 的路径静默执行。
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    item_equip($slot, $equip_slot, $pdata);
}

function obl_command_handler_item_unequip($payload, &$pdata) {
    $equip_slot = isset($payload['equip_slot']) ? (string)$payload['equip_slot'] : '';
    if ($equip_slot === '') {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('unequip.invalid_slot', 'unequip');
        return;
    }
    item_unequip($equip_slot, $pdata);
}

function obl_command_handler_item_swap_weapon($payload, &$pdata) {
    // itm0_pending 防御性检查：item.swap_weapon 合约 itm0_allowed=false
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    item_swap_weapon($pdata);
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

/**
 * 查询 POI 实例并校验玩家位置（poi.search 命令路由辅助）
 *
 * 流程：
 *   1. SELECT * FROM oblmappoi WHERE iaid=X
 *   2. 不存在 → emit search.not_found 并返回 null
 *   3. pgroup/pls 与玩家不一致 → emit search.not_adjacent 并返回 null
 *   4. 返回 POI 实例行
 *
 * 由 poi.search 命令分支调用，调用方拿到 POI 实例后传给 E-10 的 obl_search_poi($pdata, $poi, $tool_id, $skill_id)。
 *
 * @param int   $iaid  POI 实例 ID
 * @param array $pdata 玩家数据（用于读 pgroup/pls）
 * @return array|null POI 实例行或 null（找不到/位置不匹配）
 */
function obl_lookup_poi_for_search($iaid, $pdata) {
    global $db, $tablepre, $obl_log;

    $iaid = (int)$iaid;
    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    $result = $db->query("SELECT * FROM {$tablepre}oblmappoi WHERE iaid='$iaid'");
    if (!$result || !$db->num_rows($result)) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('search.not_found', 'search');
        return null;
    }
    $poi = $db->fetch_array($result);

    if ((int)$poi['pgroup'] != $cur_pgroup || (int)$poi['pls'] != $cur_pls) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('search.not_adjacent', 'search');
        return null;
    }

    return $poi;
}
