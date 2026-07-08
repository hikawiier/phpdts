<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_command_response_success($request_id = '', $data = array(), $code = 'OK', $message = '') {
    $resp = array(
        'status' => 'success',
        'code' => $code,
    );
    if ($request_id !== '') $resp['request_id'] = $request_id;
    if ($message !== '') $resp['message'] = $message;
    $resp['data'] = is_array($data) ? $data : array();
    return $resp;
}

function obl_command_response_error($code, $message = '', $details = null, $request_id = '', $data = null) {
    $resp = array(
        'status' => 'error',
        'code' => $code,
    );
    if ($message !== '') $resp['message'] = $message;
    if ($request_id !== '') $resp['request_id'] = $request_id;
    if ($details !== null) $resp['details'] = $details;
    if ($data !== null) $resp['data'] = $data;
    return $resp;
}

function obl_command_http_status_for_code($code) {
    switch ($code) {
        case 'BAD_JSON':
        case 'INVALID_ENVELOPE':
        case 'INVALID_PAYLOAD':
        case 'UNKNOWN_COMMAND':
            return 400;
        case 'AUTH_FAILED':
            return 401;
        case 'COMMAND_IN_PROGRESS':
        case 'COMMAND_NOT_ALLOWED':
        case 'ITM0_PENDING':
        case 'BATTLE_BUSY':
        case 'STATE_CONFLICT':
            return 409;
        case 'DOMAIN_REJECTED':
        case 'NO_SP':
        case 'MOVE_SAME_POSITION':
        case 'MOVE_INVALID_TARGET':
        case 'MOVE_BLOCKED':
        case 'MOVE_OCCUPIED':
        case 'MOVE_UNREACHABLE':
        case 'MOVE_NO_PATH':
        case 'POI_NOT_FOUND':
        case 'POI_NOT_HERE':
        case 'POI_NOT_SEARCHABLE':
        case 'POI_ALREADY_SEARCHED':
        case 'POI_DATA_ERROR':
        case 'ITEM_NOT_FOUND':
        case 'ITEM_EMPTY':
        case 'ITEM_NOT_HERE':
        case 'ITEM_NOT_DISCOVERED':
        case 'INVALID_SLOT':
        case 'EMPTY_SLOT':
        case 'ITEM_NOT_USABLE':
        case 'ITEM_BROKEN':
        case 'BAG_FULL':
        case 'CRAFT_NO_MATCH':
        case 'CRAFT_AMBIGUOUS':
            return 422;
        case 'PHP_FATAL':
        case 'INTERNAL_ERROR':
            return 500;
        default:
            return 400;
    }
}

function obl_command_response_emit($response) {
    if (isset($response['status']) && $response['status'] === 'error') {
        http_response_code(obl_command_http_status_for_code(isset($response['code']) ? $response['code'] : 'INTERNAL_ERROR'));
    }
    if (ob_get_length() !== false) {
        @ob_clean();
    }
    header('Content-Type: application/json');
    if (function_exists('compatible_json_encode')) {
        echo compatible_json_encode($response);
    } else {
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }
}
