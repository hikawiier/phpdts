<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

class OblStateApiException extends Exception {
    protected $stateCode;
    protected $details;

    public function __construct($stateCode, $message = '', $details = null) {
        parent::__construct($message !== '' ? $message : $stateCode);
        $this->stateCode = $stateCode;
        $this->details = $details;
    }

    public function getStateCode() {
        return $this->stateCode;
    }

    public function getDetails() {
        return $this->details;
    }
}

function obl_state_response_success($data = null, $message = '') {
    return array(
        'status' => 'success',
        'data' => $data,
        'message' => $message,
    );
}

function obl_state_response_error($message, $code = 'ERROR', $details = null) {
    $resp = array(
        'status' => 'error',
        'message' => $message !== '' ? $message : $code,
        'code' => $code,
    );
    if ($details !== null) $resp['details'] = $details;
    return $resp;
}

function obl_state_http_status_for_code($code) {
    switch ($code) {
        case 'AUTH_FAILED':
            return 401;
        case 'NOT_OBLIVIONS':
        case 'COMMAND_NOT_ALLOWED':
            return 409;
        case 'INVALID_METHOD':
        case 'UNKNOWN_SCOPE':
        case 'MISSING_PARAM':
        case 'INVALID_PARAM':
            return 400;
        case 'PHP_FATAL':
        case 'INTERNAL_ERROR':
            return 500;
        default:
            return 400;
    }
}

function obl_state_response_emit($response) {
    if (isset($response['status']) && $response['status'] === 'error') {
        http_response_code(obl_state_http_status_for_code(isset($response['code']) ? $response['code'] : 'INTERNAL_ERROR'));
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

function obl_state_throw($code, $message = '', $details = null) {
    throw new OblStateApiException($code, $message, $details);
}

?>
