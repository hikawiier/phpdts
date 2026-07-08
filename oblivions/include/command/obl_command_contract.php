<?php
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
            'payload_schema' => array('to' => array('type' => 'int', 'required' => true, 'min' => 0)),
            'refresh' => array('player_info', 'game_map', 'tile_actions', 'player_inventory', 'obl_log', 'battle_log'),
        ),
        'map.explore' => array(
            'legacy' => 'obl_explore',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => false,
            'payload_schema' => array(),
            'refresh' => array('player_info', 'game_map', 'tile_actions', 'player_inventory', 'obl_log', 'battle_log'),
        ),
        'poi.search' => array(
            'legacy' => 'obl_search',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => true,
            'itm0_allowed' => false,
            'payload_schema' => array('iaid' => array('type' => 'int', 'required' => true, 'min' => 1)),
            'refresh' => array('player_info', 'tile_actions', 'player_inventory', 'obl_log', 'battle_log'),
        ),
        'item.pickup' => array(
            'legacy' => 'obl_pickup',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => false,
            'payload_schema' => array('iid' => array('type' => 'int', 'required' => true, 'min' => 1)),
            'refresh' => array('player_inventory', 'tile_actions', 'obl_log'),
        ),
        'item.discard' => array(
            'legacy' => 'obl_discard',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'payload_schema' => array('slot' => array('type' => 'int', 'required' => true, 'min' => 0)),
            'refresh' => array('player_inventory', 'tile_actions', 'obl_log'),
        ),
        'item.use' => array(
            'legacy' => 'obl_use_item',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'payload_schema' => array('slot' => array('type' => 'int', 'required' => true, 'min' => 0)),
            'refresh' => array('player_info', 'player_inventory', 'tile_actions', 'obl_log'),
        ),
        'inventory.organize' => array(
            'legacy' => 'obl_organize',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'payload_schema' => array(),
            'refresh' => array('player_inventory', 'obl_log'),
        ),
        'craft.execute' => array(
            'legacy' => 'obl_craft',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => false,
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
            'payload_schema' => array('actions' => array('type' => 'actions', 'required' => true)),
            'refresh' => array('player_info', 'battle_log', 'enemies', 'game_map'),
        ),
        'battle.submit_turn' => array(
            'legacy' => 'obl_battle_action',
            'ui_mode' => 'battle',
            'allowed_actions' => array('battle'),
            'battle_state_required' => defined('OBL_BS_PLAYER_TURN') ? OBL_BS_PLAYER_TURN : 'PLAYER_TURN',
            'advances_tick' => true,
            'itm0_allowed' => false,
            'payload_schema' => array('actions' => array('type' => 'actions', 'required' => true)),
            'refresh' => array('player_info', 'battle_log', 'enemies'),
        ),
    );
}

function obl_command_contract($command) {
    $contracts = obl_command_contracts();
    return isset($contracts[$command]) ? $contracts[$command] : null;
}

function obl_command_validate_envelope($body) {
    if (!is_array($body)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'message' => '请求必须是 JSON 对象');
    }
    $command = isset($body['command']) ? (string)$body['command'] : '';
    if ($command === '') {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'message' => '缺少 command');
    }
    if (!preg_match('/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/', $command)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'message' => 'command 格式非法');
    }
    $payload = isset($body['payload']) ? $body['payload'] : array();
    if ($payload === null) $payload = array();
    if (!is_array($payload)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'message' => 'payload 必须是对象');
    }
    $request_id = isset($body['request_id']) ? (string)$body['request_id'] : '';
    if ($request_id !== '' && !preg_match('/^[a-zA-Z0-9_.:-]{1,128}$/', $request_id)) {
        return array('ok' => false, 'code' => 'INVALID_ENVELOPE', 'message' => 'request_id 格式非法');
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
                return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => '缺少字段：' . $field, 'details' => array('field' => $field));
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
        if (!is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 必须是整数');
        $int = (int)$value;
        if (isset($rule['min']) && $int < (int)$rule['min']) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 超出范围');
        return array('ok' => true, 'value' => $int);
    }
    if ($type === 'string') {
        if (!is_string($value) && !is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 必须是字符串');
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
    if ($type === 'array') {
        if (!is_array($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 必须是数组');
        return array('ok' => true, 'value' => $value);
    }
    return array('ok' => true, 'value' => $value);
}

function obl_command_validate_actions($actions) {
    if (!is_array($actions) || empty($actions)) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'actions 必须是非空数组');
    }
    $normalized = array();
    foreach ($actions as $idx => $action) {
        if (!is_array($action)) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'action 必须是对象', 'details' => array('index' => $idx));
        }
        $act_id = isset($action['act_id']) ? (string)$action['act_id'] : '';
        if ($act_id === '' || !preg_match('/^[a-zA-Z0-9_.:-]{1,64}$/', $act_id)) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'act_id 非法', 'details' => array('index' => $idx));
        }
        $target = isset($action['target']) ? (int)$action['target'] : 0;
        if ($target <= 0) {
            return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'target 非法', 'details' => array('index' => $idx));
        }
        $params = isset($action['params']) && is_array($action['params']) ? $action['params'] : array();
        $normalized[] = array('act_id' => $act_id, 'target' => $target, 'params' => $params);
    }
    return array('ok' => true, 'value' => $normalized);
}

function obl_command_validate_slot_counts($slots) {
    if ($slots === null) return array('ok' => true, 'value' => array());
    if (!is_array($slots)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'slots 必须是数组');
    $normalized = array();
    foreach ($slots as $idx => $entry) {
        if (!is_array($entry)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'slots 项必须是对象', 'details' => array('index' => $idx));
        $slot = isset($entry['slot']) ? (int)$entry['slot'] : 0;
        $count = isset($entry['count']) ? (int)$entry['count'] : 1;
        if ($slot <= 0 || $count <= 0) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'slots 项非法', 'details' => array('index' => $idx));
        $normalized[] = $slot . ':' . $count;
    }
    return array('ok' => true, 'value' => $normalized);
}

function obl_command_validate_string_list($list, $field) {
    if ($list === null) return array('ok' => true, 'value' => array());
    if (!is_array($list)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 必须是数组');
    $normalized = array();
    foreach ($list as $idx => $value) {
        if (!is_string($value) && !is_numeric($value)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 项必须是字符串');
        $s = trim((string)$value);
        if ($s === '') continue;
        if (!preg_match('/^[a-zA-Z0-9_.:-]{1,128}$/', $s)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'message' => $field . ' 项格式非法', 'details' => array('index' => $idx));
        $normalized[] = $s;
    }
    return array('ok' => true, 'value' => $normalized);
}
