<?php
/**
 * @module B 命令系统
 * @framework B-1 声明式命令合约
 * @framework B-2 双层负载校验管道
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_command_contracts() {
    return array(
        'map.move' => array(
            'legacy' => 'move',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => false,
            'required_capabilities' => array('voluntary_move'),
            'payload_schema' => array('to' => array('type' => 'int', 'required' => true, 'min' => 0)),
            'refresh' => array('player_info', 'game_map', 'tile_actions', 'player_inventory', 'obl_log'),
        ),
        'map.explore' => array(
            'legacy' => 'obl_explore',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => false,
            'required_capabilities' => array('time_pass'),
            'payload_schema' => array(),
            'refresh' => array('player_info', 'game_map', 'tile_actions', 'player_inventory', 'obl_log'),
        ),
        'poi.search' => array(
            'legacy' => 'obl_search',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => false,
            'required_capabilities' => array('time_pass'),
            'payload_schema' => array('iaid' => array('type' => 'int', 'required' => true, 'min' => 1)),
            'refresh' => array('player_info', 'tile_actions', 'player_inventory', 'obl_log'),
        ),
        'item.pickup' => array(
            'legacy' => 'obl_pickup',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'read_only' => false,
            'advances_tick' => false,
            'itm0_allowed' => false,
            'required_capabilities' => array('free_mutation'),
            'payload_schema' => array('iid' => array('type' => 'int', 'required' => true, 'min' => 1)),
            'refresh' => array('player_inventory', 'tile_actions', 'obl_log'),
        ),
        'item.discard' => array(
            'legacy' => 'obl_discard',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'required_capabilities' => array('free_mutation'),
            'payload_schema' => array('slot' => array('type' => 'int', 'required' => true, 'min' => 0)),
            'refresh' => array('player_inventory', 'tile_actions', 'obl_log'),
        ),
        'item.use' => array(
            'legacy' => 'obl_use_item',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'required_capabilities' => array('free_mutation'),
            'payload_schema' => array('slot' => array('type' => 'int', 'required' => true, 'min' => 0)),
            'refresh' => array('player_info', 'player_inventory', 'tile_actions', 'obl_log'),
        ),
        'inventory.organize' => array(
            'legacy' => 'obl_organize',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'required_capabilities' => array('free_mutation'),
            'payload_schema' => array(),
            'refresh' => array('player_inventory', 'obl_log'),
        ),
        'craft.execute' => array(
            'legacy' => 'obl_craft',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => false,
            'required_capabilities' => array('free_mutation'),
            'payload_schema' => array(
                'slots' => array('type' => 'slot_counts', 'required' => false),
                'workbench_materials' => array('type' => 'string_list', 'required' => false),
            ),
            'refresh' => array('player_inventory', 'tile_actions', 'obl_log'),
        ),
        'battle.start' => array(
            'legacy' => 'obl_battle_start',
            'ui_mode' => 'battle',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => false,
            'required_capabilities' => array('enter_combat'),
            'payload_schema' => array('actions' => array('type' => 'actions', 'required' => true)),
            'refresh' => array('player_info', 'enemies', 'game_map'),
        ),
        'battle.submit_turn' => array(
            'legacy' => 'obl_battle_action',
            'ui_mode' => 'battle',
            'allowed_actions' => array('battle'),
            'battle_state_required' => defined('OBL_BS_PLAYER_TURN') ? OBL_BS_PLAYER_TURN : 'PLAYER_TURN',
            'queue_actor_required' => 'self',
            'advances_tick' => true,
            'itm0_allowed' => false,
            'required_capabilities' => array('combat_action'),
            'payload_schema' => array('actions' => array('type' => 'actions', 'required' => true)),
            'refresh' => array('player_info', 'enemies'),
        ),
        'combat.can_engage' => array(
            // L0 可达性查询（read-only）：前端"点击敌人发起战斗"前的预判
            // 不推进 tick、不修改状态，仅调 combat_can_engage 返回可达性数据
            'legacy' => 'obl_combat_can_engage',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'read_only' => true,
            'advances_tick' => false,
            'itm0_allowed' => true,
            'payload_schema' => array('target_pid' => array('type' => 'int', 'required' => true, 'min' => 1)),
            'refresh' => array(),
        ),

        'world.wait' => array(
            'legacy' => 'obl_wait',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => true,
            'required_capabilities' => array('time_pass'),
            'command_tags' => array('recovery_time_action'),
            'payload_schema' => array(),
            'refresh' => array('player_info', 'enemies', 'game_map', 'obl_log'),
        ),

        'combat.preview_single' => array(
            // L1 即时校验（read-only）：单次 action 合法性预判
            // 不推进 tick、不修改状态，返回 pass/reason/ap_cost
            'legacy' => 'obl_combat_preview_single',
            'ui_mode' => 'battle',
            'allowed_actions' => array('battle'),
            'read_only' => true,
            'advances_tick' => false,
            'itm0_allowed' => false,
            'payload_schema' => array(
                'act_id' => array('type' => 'string', 'required' => true),
                'aim_intent' => array('type' => 'array', 'required' => false),
                'target_pid' => array('type' => 'int', 'required' => false, 'min' => 0),
            ),
            'refresh' => array(),
        ),

        'combat.preview_targets' => array(
            'legacy' => 'obl_combat_preview_targets',
            'ui_mode' => 'battle',
            'allowed_actions' => array('', null, 'battle'),
            'read_only' => true,
            'advances_tick' => false,
            'itm0_allowed' => false,
            'payload_schema' => array(
                'act_id' => array('type' => 'string', 'required' => true),
                'prefix_actions' => array('type' => 'array', 'required' => false),
                'candidate_ids' => array('type' => 'int_list', 'required' => true, 'min' => 1, 'max_items' => 256),
            ),
            'refresh' => array(),
        ),

        'combat.preview_chain' => array(
            // L2 动作链模拟（read-only）：整条动作链预校验
            // 不推进 tick、不修改状态，返回 actions/total_ap_cost/actor_final_state
            'legacy' => 'obl_combat_preview_chain',
            'ui_mode' => 'battle',
            'allowed_actions' => array('battle'),
            'read_only' => true,
            'advances_tick' => false,
            'itm0_allowed' => false,
            'payload_schema' => array(
                'actions' => array('type' => 'array', 'required' => true),
                'battle_cache' => array('type' => 'array', 'required' => false),
            ),
            'refresh' => array(),
        ),
    );
}

function obl_command_contract($command) {
    $contracts = obl_command_contracts();
    static $validated = false;
    if (!$validated) {
        foreach ($contracts as $contract_id => $contract) {
            foreach (($contract['required_capabilities'] ?? array()) as $capability) {
                if (!actor_capability_is_known((string)$capability)) {
                    throw new UnexpectedValueException('Unknown command capability: ' . $contract_id . ':' . $capability);
                }
            }
        }
        $validated = true;
    }
    return isset($contracts[$command]) ? $contracts[$command] : null;
}

function obl_command_validate_envelope($body) {
    if (!is_array($body)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'details' => array('reason' => 'body_not_object'));
    }
    $command = isset($body['command']) ? (string)$body['command'] : '';
    if ($command === '') {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'details' => array('reason' => 'missing_command'));
    }
    if (!preg_match('/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/', $command)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'details' => array('reason' => 'invalid_command_format'));
    }
    $payload = isset($body['payload']) ? $body['payload'] : array();
    if ($payload === null) $payload = array();
    if (!is_array($payload)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'details' => array('reason' => 'payload_not_object'));
    }
    $request_id = isset($body['request_id']) ? (string)$body['request_id'] : '';
    if ($request_id !== '' && !preg_match('/^[a-zA-Z0-9_.:-]{1,128}$/', $request_id)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'details' => array('reason' => 'invalid_request_id'));
    }
    $expected = isset($body['expected']) && is_array($body['expected']) ? $body['expected'] : array();
    return array('ok' => true, 'envelope' => array(
        'command' => $command,
        'payload' => $payload,
        'request_id' => $request_id,
        'expected' => $expected,
    ));
}

function obl_command_validate_payload($payload, $schema) {
    $normalized = array();
    foreach ($schema as $field => $rule) {
        $required = !empty($rule['required']);
        if (!array_key_exists($field, $payload)) {
            if ($required) {
                return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'missing_field', 'field' => $field));
            }
            if (isset($rule['type']) && $rule['type'] === 'slot_counts') $normalized[$field] = array();
            if (isset($rule['type']) && $rule['type'] === 'string_list') $normalized[$field] = array();
            continue;
        }
        $value = $payload[$field];
        $type = isset($rule['type']) ? $rule['type'] : 'string';
        $result = obl_command_normalize_value($value, $type, $field, $rule);
        if (!$result['ok']) return $result;
        $normalized[$field] = $result['value'];
    }
    return array('ok' => true, 'payload' => $normalized);
}

function obl_command_normalize_value($value, $type, $field, $rule = array()) {
    if ($type === 'int') {
        if (!is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_int', 'field' => $field));
        $int = (int)$value;
        if (isset($rule['min']) && $int < (int)$rule['min']) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'below_min', 'field' => $field, 'min' => (int)$rule['min']));
        return array('ok' => true, 'value' => $int);
    }
    if ($type === 'string') {
        if (!is_string($value) && !is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_string', 'field' => $field));
        return array('ok' => true, 'value' => (string)$value);
    }
    if ($type === 'actions') {
        return obl_command_validate_actions($value);
    }
    if ($type === 'slot_counts') {
        return obl_command_validate_slot_counts($value);
    }
    if ($type === 'string_list') {
        return obl_command_validate_string_list($value, $field);
    }
    if ($type === 'int_list') {
        return obl_command_validate_int_list($value, $field, $rule);
    }
    if ($type === 'array') {
        if (!is_array($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_array', 'field' => $field));
        return array('ok' => true, 'value' => $value);
    }
    return array('ok' => true, 'value' => $value);
}

function obl_command_validate_actions($actions) {
    if (!is_array($actions) || empty($actions)) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'actions_empty'));
    }
    $normalized = array();
    foreach ($actions as $idx => $action) {
        if (!is_array($action)) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'action_not_object', 'index' => $idx));
        }
        $act_id = isset($action['act_id']) ? (string)$action['act_id'] : '';
        if ($act_id === '' || !preg_match('/^[a-zA-Z0-9_.:-]{1,64}$/', $act_id)) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_act_id', 'index' => $idx));
        }
        $target_result = obl_command_validate_action_target(
            array_key_exists('target', $action) ? $action['target'] : null,
            $idx
        );
        if (!$target_result['ok']) return $target_result;
        $target = $target_result['value'];
        $params = isset($action['params']) && is_array($action['params']) ? $action['params'] : array();
        $normalized[] = array('act_id' => $act_id, 'target' => $target, 'params' => $params);
    }
    return array('ok' => true, 'value' => $normalized);
}

function obl_command_validate_action_target($target, $idx) {
    if ($target === null) {
        return array('ok' => true, 'value' => null);
    }

    if (is_numeric($target)) {
        $id = (int)$target;
        if ($id < 0) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_target', 'index' => $idx));
        }
        return array('ok' => true, 'value' => $id);
    }

    if (!is_array($target)) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_target', 'index' => $idx));
    }

    $type = isset($target['type']) ? (string)$target['type'] : '';
    if ($type === 'enemy') $type = 'pid';
    if ($type === 'tiles') $type = 'tile';
    if (!in_array($type, array('pid', 'tile', 'self', 'none', 'all'), true)) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_target_type', 'index' => $idx));
    }

    $normalized = array('type' => $type);
    if ($type === 'pid') {
        $id = (int)($target['id'] ?? ($target['pid'] ?? ($target['target_id'] ?? 0)));
        if ($id <= 0) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_target', 'index' => $idx));
        }
        $normalized['id'] = $id;
    } elseif ($type === 'tile') {
        $id = (int)($target['id'] ?? ($target['pls'] ?? ($target['target_id'] ?? 0)));
        if ($id <= 0) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_target', 'index' => $idx));
        }
        $normalized['id'] = $id;
    }

    return array('ok' => true, 'value' => $normalized);
}

function obl_command_validate_slot_counts($slots) {
    if ($slots === null) return array('ok' => true, 'value' => array());
    if (!is_array($slots)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_array', 'field' => 'slots'));
    $normalized = array();
    foreach ($slots as $idx => $entry) {
        if (!is_array($entry)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'slot_entry_not_object', 'index' => $idx));
        $slot = isset($entry['slot']) ? (int)$entry['slot'] : 0;
        $count = isset($entry['count']) ? (int)$entry['count'] : 1;
        if ($slot <= 0 || $count <= 0) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_slot_entry', 'index' => $idx));
        $normalized[] = $slot . ':' . $count;
    }
    return array('ok' => true, 'value' => $normalized);
}

function obl_command_validate_string_list($list, $field) {
    if ($list === null) return array('ok' => true, 'value' => array());
    if (!is_array($list)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_array', 'field' => $field));
    $normalized = array();
    foreach ($list as $idx => $value) {
        if (!is_string($value) && !is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_string', 'field' => $field, 'index' => $idx));
        $s = trim((string)$value);
        if ($s === '') continue;
        if (!preg_match('/^[a-zA-Z0-9_.:-]{1,128}$/', $s)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_string_format', 'field' => $field, 'index' => $idx));
        $normalized[] = $s;
    }
    return array('ok' => true, 'value' => $normalized);
}

function obl_command_validate_int_list($list, $field, $rule = array()) {
    if (!is_array($list)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_array', 'field' => $field));
    $max_items = isset($rule['max_items']) ? max(1, (int)$rule['max_items']) : 256;
    if (count($list) > $max_items) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'too_many_items', 'field' => $field, 'max_items' => $max_items));
    $min = isset($rule['min']) ? (int)$rule['min'] : PHP_INT_MIN;
    $normalized = array();
    foreach ($list as $idx => $value) {
        if (!is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'expected_int', 'field' => $field, 'index' => $idx));
        $int = (int)$value;
        if ($int < $min) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'below_min', 'field' => $field, 'index' => $idx, 'min' => $min));
        $normalized[$int] = $int;
    }
    return array('ok' => true, 'value' => array_values($normalized));
}
