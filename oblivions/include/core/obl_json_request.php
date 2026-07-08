<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_json_request_read() {
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        return array('ok' => false, 'code' => 'BAD_JSON', 'message' => '无法读取请求体');
    }
    if (trim($raw) === '') {
        return array('ok' => false, 'code' => 'BAD_JSON', 'message' => '请求体不能为空');
    }
    $body = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($body)) {
        return array('ok' => false, 'code' => 'BAD_JSON', 'message' => 'JSON 格式错误', 'details' => json_last_error_msg());
    }
    return array('ok' => true, 'body' => $body);
}
