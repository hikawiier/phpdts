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
            battle_entry_dispatch('ambush', $pdata, $payload['actions']);
            break;
        case 'battle.submit_turn':
            battle_entry_dispatch('player_turn', $pdata, $payload['actions']);
            break;
        default:
            return array('ok' => false, 'code' => 'UNKNOWN_COMMAND', 'message' => '未知命令');
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
