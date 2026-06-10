<?php

if(!defined('IN_GAME')) {
    exit('Access Denied');
}

/*
 * RuleSet系统（时光重现）配置文件
 * 用于配置旧版本游戏模式的相关设置
 */

// 系统总开关与配置数据，从独立数据文件加载（消除重复定义）
// System switch and config data, loaded from dedicated data file (eliminates duplication)
require GAME_ROOT.'./gamedata/ruleset/ruleset_config_data.php';


// 获取RuleSet配置的函数
function get_ruleset_config($ruleset_id = null) {
    // 直接在函数内部定义配置，避免全局变量作用域问题
    $local_ruleset_enabled = true;

    // 尝试使用全局配置，如果不存在则使用本地配置
    global $ruleset_config;
    if (isset($ruleset_config) && is_array($ruleset_config)) {
        $local_ruleset_config = $ruleset_config;
    } else {
        // 如果全局变量不存在，从数据文件加载（消除重复定义的fallback副本）
        // If global variable not set, load from data file (eliminates duplicate fallback copy)
        // 注意：必须用require而非require_once，因为数据文件可能已在其他函数作用域加载
        // Note: must use require not require_once, as file may have been loaded in another function scope
        require GAME_ROOT.'./gamedata/ruleset/ruleset_config_data.php';
        $local_ruleset_config = $ruleset_config;
        $local_ruleset_enabled = $ruleset_enabled;
    }

    if (!$local_ruleset_enabled) {
        return false;
    }

    if ($ruleset_id === null) {
        return $local_ruleset_config;
    }

    return isset($local_ruleset_config[$ruleset_id]) ? $local_ruleset_config[$ruleset_id] : false;
}

// 检查用户是否可以创建指定RuleSet房间
function can_create_ruleset_room($ruleset_id, $user_data) {
    // 使用get_ruleset_config函数获取配置，确保一致性
    $local_ruleset_enabled = true;
    $local_ruleset_config = get_ruleset_config();

    // 调试信息：记录函数内部状态
    $debug_info = array(
        'function_called' => 'can_create_ruleset_room',
        'ruleset_id' => $ruleset_id,
        'user_data_groupid' => isset($user_data['groupid']) ? $user_data['groupid'] : 'undefined',
        'user_data_credits2' => isset($user_data['credits2']) ? $user_data['credits2'] : 'undefined',
        'local_ruleset_enabled' => $local_ruleset_enabled,
        'local_config_exists' => isset($local_ruleset_config[$ruleset_id]) ? 'yes' : 'no',
        'fix_method' => 'using_local_config'
    );

    if (!$local_ruleset_enabled || !isset($local_ruleset_config[$ruleset_id])) {
        $debug_info['early_return'] = 'ruleset_disabled_or_config_missing';
        $debug_info['enabled_check'] = $local_ruleset_enabled ? 'pass' : 'fail';
        $debug_info['config_exists_check'] = isset($local_ruleset_config[$ruleset_id]) ? 'pass' : 'fail';

        // 写入调试文件
        //file_put_contents(GAME_ROOT.'./doc/etc/can_create_debug_'.date('Y-m-d_H-i-s').'.txt',
        //    "can_create_ruleset_room调试信息:\n" . print_r($debug_info, true));

        return false;
    }

    $config = $local_ruleset_config[$ruleset_id];
    $debug_info['config_admin_free'] = $config['admin_free'];
    $debug_info['config_credits_cost'] = $config['credits_cost'];

    // 管理员免费 (修改权限要求从>=4改为>=2，允许所有管理员免费创建)
    if ($config['admin_free'] && $user_data['groupid'] >= 2) {
        $debug_info['result'] = 'admin_pass';
        $debug_info['admin_free_check'] = $config['admin_free'] ? 'pass' : 'fail';
        $debug_info['groupid_check'] = ($user_data['groupid'] >= 2) ? 'pass' : 'fail';

        // 写入调试文件
        //file_put_contents(GAME_ROOT.'./doc/etc/can_create_debug_'.date('Y-m-d_H-i-s').'.txt',
         //   "can_create_ruleset_room调试信息:\n" . print_r($debug_info, true));

        return true;
    }

    // 检查切糕数量
    if ($user_data['credits2'] >= $config['credits_cost']) {
        $debug_info['result'] = 'credits_pass';
        $debug_info['credits_check'] = ($user_data['credits2'] >= $config['credits_cost']) ? 'pass' : 'fail';

        // 写入调试文件
        //file_put_contents(GAME_ROOT.'./doc/etc/can_create_debug_'.date('Y-m-d_H-i-s').'.txt',
         //   "can_create_ruleset_room调试信息:\n" . print_r($debug_info, true));

        return true;
    }

    $debug_info['result'] = 'all_checks_failed';
    $debug_info['admin_free_check'] = $config['admin_free'] ? 'pass' : 'fail';
    $debug_info['groupid_check'] = ($user_data['groupid'] >= 2) ? 'pass' : 'fail';
    $debug_info['credits_check'] = ($user_data['credits2'] >= $config['credits_cost']) ? 'pass' : 'fail';

    // 写入调试文件
    //file_put_contents(GAME_ROOT.'./doc/etc/can_create_debug_'.date('Y-m-d_H-i-s').'.txt',
    //    "can_create_ruleset_room调试信息:\n" . print_r($debug_info, true));

    return false;
}

// 获取RuleSet资源文件路径
function get_ruleset_resource_path($ruleset_id, $resource_type) {
    if (empty($ruleset_id)) {
        return false;
    }
    
    $base_path = GAME_ROOT . './gamedata/ruleset/' . $ruleset_id . '/';
    
    switch ($resource_type) {
        case 'cache':
            return $base_path . 'cache/';
        case 'img':
            return $base_path . 'img/';
        case 'include':
            return $base_path . 'include/';
        default:
            return $base_path;
    }
}

// 检查RuleSet资源文件是否存在
function ruleset_resource_exists($ruleset_id, $filename, $resource_type = 'cache') {
    $path = get_ruleset_resource_path($ruleset_id, $resource_type);
    if (!$path) return false;

    return file_exists($path . $filename);
}

// 获取RuleSet头像路径
function get_ruleset_avatar_path($ruleset_id, $avatar_type, $avatar_id = null) {
    // 直接获取配置，不依赖全局变量
    $config = get_ruleset_config($ruleset_id);

    if (!$config || !isset($config['avatar_config']) || !$config['avatar_config']['use_ruleset_avatars']) {
        return false;
    }

    $avatar_config = $config['avatar_config'];
    $base_path = $avatar_config['avatar_path'];

    switch ($avatar_type) {
        case 'male':
            if ($avatar_id !== null && $avatar_id >= 0 && $avatar_id < $avatar_config['male_avatars']) {
                return $base_path . "m_{$avatar_id}.gif";
            }
            break;

        case 'female':
            if ($avatar_id !== null && $avatar_id >= 0 && $avatar_id < $avatar_config['female_avatars']) {
                return $base_path . "f_{$avatar_id}.gif";
            }
            break;

        case 'npc':
            if ($avatar_id !== null && isset($avatar_config['npc_avatars'][$avatar_id])) {
                return $base_path . $avatar_config['npc_avatars'][$avatar_id];
            }
            break;

        case 'special':
            if ($avatar_id !== null && isset($avatar_config['special_avatars'][$avatar_id])) {
                return $base_path . $avatar_config['special_avatars'][$avatar_id];
            }
            break;
    }

    return false;
}

// 检查RuleSet是否使用自定义头像
function ruleset_uses_custom_avatars($ruleset_id) {
    $config = get_ruleset_config($ruleset_id);
    return $config && isset($config['avatar_config']) && $config['avatar_config']['use_ruleset_avatars'];
}

// 获取RuleSet头像数量限制
function get_ruleset_avatar_limits($ruleset_id) {
    $config = get_ruleset_config($ruleset_id);

    if (!$config || !isset($config['avatar_config'])) {
        return false;
    }

    return Array(
        'male' => $config['avatar_config']['male_avatars'],
        'female' => $config['avatar_config']['female_avatars'],
    );
}

?>
