<?php
/**
 * @module O 编辑器接口层
 * @framework O-4 编辑器守卫与后端对接
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions O-4 编辑器守卫 / Editor Guard
//
// 编辑器后端对接的统一守卫，对所有 editor_* state scope 与 editor.* 命令生效：
//   - 双重守卫：?editor=1 URL 参数 + Authorization: Bearer <token> 请求头
//   - token 文件：oblivions/editor/editor_token.php（在 .gitignore 中忽略，类似 A-5 调试框架
//     的 debug_autologin.php 模式），返回字符串即为有效 token
//   - 生产环境默认关闭：移除 token 文件或留空字符串即拒绝所有编辑器请求，零生产环境影响
//
// 设计原则（对齐 A-5 调试工具框架）：
//   - 守卫在前：所有编辑器入口必须先通过 obl_editor_enabled() 检查
//   - 与游戏框架正交：编辑器操作不绕过领域规则，但跳过 required_capabilities 校验
//   - 复用 A-1 三层入口：编辑器读走 state.php + scope=editor_*，写走 command.php + editor.* 命名空间
//
// 守卫失败统一返回 EDITOR_ACCESS_DENIED 错误码（HTTP 401），不暴露任何数据。
// ================================================================

/**
 * 检查编辑器守卫是否启用
 *
 * 守卫通过条件（全部满足）：
 *   1. $_GET['editor'] === '1'（URL 参数标识编辑器请求）
 *   2. Authorization 头格式为 Bearer <token>
 *   3. token 文件 oblivions/editor/editor_token.php 存在且返回的字符串与请求 token 一致
 *   4. token 文件返回的字符串非空
 *
 * 单例缓存：单次请求内多次调用只读一次文件系统
 *
 * @return bool
 */
function obl_editor_enabled() {
    static $enabled = null;
    if ($enabled !== null) return $enabled;

    // 1. 检查 ?editor=1 URL 参数
    $editor_flag = isset($_GET['editor']) ? (string)$_GET['editor'] : '';
    if ($editor_flag !== '1') {
        $enabled = false;
        return $enabled;
    }

    // 2. 提取 Authorization: Bearer <token>
    $auth_header = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth_header = (string)$_SERVER['HTTP_AUTHORIZATION'];
    } elseif (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            foreach ($headers as $name => $value) {
                if (strcasecmp($name, 'Authorization') === 0) {
                    $auth_header = (string)$value;
                    break;
                }
            }
        }
    }

    if ($auth_header === '') {
        $enabled = false;
        return $enabled;
    }

    // 解析 Bearer 前缀
    if (!preg_match('/^Bearer\s+(.+)$/i', $auth_header, $matches)) {
        $enabled = false;
        return $enabled;
    }
    $request_token = trim($matches[1]);

    // 3. 加载 token 文件
    $token_file = GAME_ROOT . './oblivions/editor/editor_token.php';
    if (!is_file($token_file)) {
        $enabled = false;
        return $enabled;
    }

    $stored_token = @include $token_file;
    if (!is_string($stored_token)) {
        $enabled = false;
        return $enabled;
    }
    $stored_token = trim($stored_token);

    // 4. token 非空且与请求一致
    if ($stored_token === '' || $stored_token !== $request_token) {
        $enabled = false;
        return $enabled;
    }

    $enabled = true;
    return $enabled;
}

/**
 * 注册 editor.* 命令合约
 *
 * 由 obl_command_contract.php 的 obl_command_contracts() 合并调用。
 * 标记 editor_only=true，跳过 required_capabilities 校验。
 * 所有 editor.* 命令：
 *   - advances_tick: false（不推进 tick）
 *   - read_only: false（写 DB / 文件）
 *   - editor_only: true（守卫标识，由 bus 分发层检查）
 *   - required_capabilities: array()（编辑器跳过能力校验）
 *
 * @return array
 */
function obl_editor_command_contracts() {
    return array(
        'editor.map.save' => array(
            'legacy' => 'editor_map_save',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'regions' => array('type' => 'array', 'required' => true),
                'grids'   => array('type' => 'array', 'required' => true),
                'tiles'   => array('type' => 'array', 'required' => true),
            ),
            'refresh' => array(),
        ),
        'editor.wilditem.upsert' => array(
            'legacy' => 'editor_wilditem_upsert',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'iid'      => array('type' => 'int', 'required' => false, 'min' => 0),
                'pgroup'   => array('type' => 'int', 'required' => true, 'min' => 1),
                'pls'      => array('type' => 'int', 'required' => true, 'min' => 1),
                'item_id'  => array('type' => 'string', 'required' => true),
                'itm'      => array('type' => 'string', 'required' => false),
                'itmk'     => array('type' => 'string', 'required' => false),
                'itme'     => array('type' => 'int', 'required' => false),
                'itms'     => array('type' => 'string', 'required' => false),
                'itmsk'    => array('type' => 'string', 'required' => false),
                'itmpara'  => array('type' => 'string', 'required' => false),
                'discovered'    => array('type' => 'int', 'required' => false, 'min' => 0, 'max' => 2),
                'fake_item_id'  => array('type' => 'string', 'required' => false),
                'is_trap'       => array('type' => 'int', 'required' => false, 'min' => 0, 'max' => 1),
            ),
            'refresh' => array(),
        ),
        'editor.wilditem.delete' => array(
            'legacy' => 'editor_wilditem_delete',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'iid' => array('type' => 'int', 'required' => true, 'min' => 1),
            ),
            'refresh' => array(),
        ),
        'editor.poi.upsert' => array(
            'legacy' => 'editor_poi_upsert',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'iaid'        => array('type' => 'int', 'required' => false, 'min' => 0),
                'pgroup'      => array('type' => 'int', 'required' => true, 'min' => 1),
                'pls'         => array('type' => 'int', 'required' => true, 'min' => 1),
                'poi_id'      => array('type' => 'string', 'required' => true),
                'state'       => array('type' => 'string', 'required' => false),
                'searched'    => array('type' => 'int', 'required' => false, 'min' => 0, 'max' => 1),
                'search_count'              => array('type' => 'int', 'required' => false, 'min' => 0),
                'search_count_remaining'     => array('type' => 'int', 'required' => false),
                'last_search_turn'           => array('type' => 'int', 'required' => false, 'min' => 0),
                'cooldown_until_turn'        => array('type' => 'int', 'required' => false, 'min' => 0),
                'placed_by_pid'              => array('type' => 'int', 'required' => false, 'min' => 0),
                'placed_at_day'              => array('type' => 'int', 'required' => false, 'min' => 0),
                'ttl_days'                   => array('type' => 'int', 'required' => false, 'min' => 0),
            ),
            'refresh' => array(),
        ),
        'editor.poi.delete' => array(
            'legacy' => 'editor_poi_delete',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'iaid' => array('type' => 'int', 'required' => true, 'min' => 1),
            ),
            'refresh' => array(),
        ),
        'editor.fog.set' => array(
            'legacy' => 'editor_fog_set',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'pgroup' => array('type' => 'int', 'required' => true, 'min' => 1),
                'pls'    => array('type' => 'int', 'required' => true, 'min' => 1),
                'fog'    => array('type' => 'int', 'required' => true, 'min' => 0, 'max' => 1),
            ),
            'refresh' => array(),
        ),
        'editor.config.save' => array(
            'legacy' => 'editor_config_save',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'editor_only' => true,
            'required_capabilities' => array(),
            'payload_schema' => array(
                'file'        => array('type' => 'string', 'required' => true),
                'content'     => array('type' => 'string', 'required' => true),
            ),
            'refresh' => array(),
        ),
    );
}

/**
 * editor.* 命令分发入口
 *
 * 由 obl_command_handler_dispatch() 在 default 之前调用。
 * 调用前需通过 obl_editor_enabled() 守卫检查（由调用方完成）。
 *
 * @param string $command
 * @param array  $payload
 * @param array  &$pdata  编辑器命令使用合成 pdata（pid=0），不依赖玩家会话
 * @return array ['ok' => bool, 'code'?: string, 'data'?: array]
 */
function obl_editor_command_dispatch($command, $payload, &$pdata) {
    switch ($command) {
        case 'editor.map.save':
            return obl_editor_command_map_save($payload, $pdata);
        case 'editor.wilditem.upsert':
            return obl_editor_command_wilditem_upsert($payload, $pdata);
        case 'editor.wilditem.delete':
            return obl_editor_command_wilditem_delete($payload, $pdata);
        case 'editor.poi.upsert':
            return obl_editor_command_poi_upsert($payload, $pdata);
        case 'editor.poi.delete':
            return obl_editor_command_poi_delete($payload, $pdata);
        case 'editor.fog.set':
            return obl_editor_command_fog_set($payload, $pdata);
        case 'editor.config.save':
            return obl_editor_command_config_save($payload, $pdata);
    }
    return array('ok' => false, 'code' => 'UNKNOWN_EDITOR_COMMAND');
}

/**
 * editor_* state scope 分发入口
 *
 * 由 obl_state_dispatch() 在 switch 前调用。
 * 调用前需通过 obl_editor_enabled() 守卫检查。
 *
 * @param string $scope
 * @param array  $ctx
 * @return array
 */
function obl_editor_state_dispatch($scope, $ctx) {
    switch ($scope) {
        case 'editor_map_list':
            return obl_editor_state_map_list($ctx);
        case 'editor_map_load':
            return obl_editor_state_map_load($ctx);
        case 'editor_wilditem_list':
            return obl_editor_state_wilditem_list($ctx);
        case 'editor_poi_list':
            return obl_editor_state_poi_list($ctx);
        case 'editor_fog_list':
            return obl_editor_state_fog_list($ctx);
        case 'editor_config_load':
            return obl_editor_state_config_load($ctx);
        case 'editor_backup_dump':
            return obl_editor_state_backup_dump($ctx);
    }
    obl_state_throw('UNKNOWN_SCOPE', '未知 editor scope: ' . $scope);
}
