<?php
/**
 * @module B 命令系统
 * @framework B-2 双层负载校验管道
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_json_request_read() {
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        return array('ok' => false, 'code' => 'BAD_JSON', 'details' => array('reason' => 'read_failed'));
    }
    if (trim($raw) === '') {
        return array('ok' => false, 'code' => 'BAD_JSON', 'details' => array('reason' => 'empty_body'));
    }
    $body = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($body)) {
        return array('ok' => false, 'code' => 'BAD_JSON', 'details' => array(
            'reason' => 'decode_error',
            'json_error' => json_last_error_msg(),
        ));
    }
    return array('ok' => true, 'body' => $body);
}
