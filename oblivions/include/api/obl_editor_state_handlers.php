<?php
/**
 * @module O 编辑器接口层
 * @framework O-4 编辑器守卫与后端对接
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions O-4 编辑器 State Handlers / Editor State Scope Handlers
//
// 实现 editor_* scope 的只读查询处理器，全部走 state.php 入口。
// 所有 scope 必须先通过 obl_editor_enabled() 守卫（由 obl_state_dispatch 调用前检查）。
//
// 数据来源：
//   - editor_map_list / editor_map_load：gamedata/map.php + gamedata/tiles/region_*.php
//     （直接 include 加载，避免与运行时混淆）
//   - editor_wilditem_list / editor_poi_list / editor_fog_list：DB bra_oblmapitem /
//     bra_oblmappoi / bra_oblmapstates 行（直传，不投影，编辑器需要原始字段）
//   - editor_config_load：gamedata/scatter_pool.php / poi_table.php / poi_pool.php /
//     obl_config.php（include 加载，纯配置无 DB 依赖）
//   - editor_backup_dump：一次性返回 gamedata 全部 PHP 文件原始内容 + DB 实例
//     （供编辑器前端打包为 ZIP 备份，避免多次往返）
//
// 守卫前置 + 零写副作用 = 对齐 A-3 状态分发与 2.8 dry-run 契约。
// ================================================================

/**
 * editor_map_list：列出所有 pgroup（来自 map.php）
 *
 * 不读 tiles 数据，仅返回 pgroup 列表，用于编辑器侧"选择区域"下拉。
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_map_list($ctx) {
    $map_data = include GAME_ROOT . './oblivions/gamedata/map.php';
    if (!is_array($map_data) || !isset($map_data['regions']) || !is_array($map_data['regions'])) {
        return obl_state_response_success(array('pgroups' => array()));
    }

    $pgroups = array_keys($map_data['regions']);
    sort($pgroups, SORT_NUMERIC);

    return obl_state_response_success(array(
        'pgroups' => $pgroups,
        'total'   => count($pgroups),
    ));
}

/**
 * editor_map_load：加载完整地图数据（map.php + 所有 region_*.php）
 *
 * 返回结构：
 *   - regions: { [pgroup]: { name, desc, entrance_pls, exit_pls, next_region, prev_region, exit_links, cols, rows } }
 *   - grids:   { [pgroup]: { cols, rows } }
 *   - tiles:   { [pgroup]: { [pls]: { name, desc, floor, tide, passable, neighbors, x, y, height, destructible } } }
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_map_load($ctx) {
    $map_data = include GAME_ROOT . './oblivions/gamedata/map.php';
    if (!is_array($map_data) || !isset($map_data['regions'])) {
        return obl_state_response_success(array(
            'regions' => array(),
            'grids'   => array(),
            'tiles'   => array(),
        ));
    }

    $regions = $map_data['regions'];
    $grids = isset($map_data['grids']) && is_array($map_data['grids']) ? $map_data['grids'] : array();

    // 兜底：旧 map.php 可能未导出 grids 字段，从 regions 中提取
    foreach ($regions as $pg => $rinfo) {
        if (!isset($grids[$pg]) && is_array($rinfo)) {
            $grids[$pg] = array(
                'cols' => isset($rinfo['cols']) ? (int)$rinfo['cols'] : 8,
                'rows' => isset($rinfo['rows']) ? (int)$rinfo['rows'] : 6,
            );
        }
    }

    // 加载 tiles/region_*.php
    $tiles = array();
    foreach ($pgroups_list = array_keys($regions) as $pg_str) {
        $pg = (int)$pg_str;
        $file_path = GAME_ROOT . './oblivions/gamedata/tiles/region_' . $pg . '.php';
        if (!is_file($file_path)) {
            $tiles[$pg] = array();
            continue;
        }
        $region_tiles = @include $file_path;
        if (!is_array($region_tiles)) {
            $tiles[$pg] = array();
            continue;
        }
        $tiles[$pg] = $region_tiles;
    }

    return obl_state_response_success(array(
        'regions' => $regions,
        'grids'   => $grids,
        'tiles'   => $tiles,
    ));
}

/**
 * editor_wilditem_list：列出指定区域 wild item 实例（bra_oblmapitem）
 *
 * 必填参数：?pgroup=N
 * 可选参数：?pls=N（按格过滤）
 *
 * 直传 DB 行（不投影），编辑器需要原始字段（iid/iaid/item_id/discovered/fake_item_id/is_trap 等）。
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_wilditem_list($ctx) {
    global $db, $tablepre;

    $pgroup = isset($_GET['pgroup']) ? (int)$_GET['pgroup'] : 0;
    if ($pgroup < 1) {
        obl_state_throw('MISSING_PARAM', '缺少 pgroup 参数');
    }
    $pls_filter = isset($_GET['pls']) ? (int)$_GET['pls'] : 0;

    // 防御性 schema 自愈（state.php 是纯读入口，但读取运行时表需要字段已就位）
    if (function_exists('obl_mapitem_schema_ensure')) {
        obl_mapitem_schema_ensure();
    }

    $where = "pgroup='" . $pgroup . "'";
    if ($pls_filter > 0) {
        $where .= " AND pls='" . $pls_filter . "'";
    }
    $where .= " ORDER BY pls, iaid";

    $items = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblmapitem WHERE " . $where);
    if ($result) {
        while ($row = $db->fetch_array($result)) {
            $items[] = obl_editor_sanitize_wilditem_row($row);
        }
    }

    return obl_state_response_success(array(
        'items' => $items,
        'total' => count($items),
    ));
}

/**
 * 编辑器 wild item 行投影：保留所有字段，仅做类型规范化
 *
 * @param array $row
 * @return array
 */
function obl_editor_sanitize_wilditem_row($row) {
    return array(
        'iid'           => (int)$row['iid'],
        'pgroup'        => (int)$row['pgroup'],
        'pls'           => (int)$row['pls'],
        'iaid'          => (int)$row['iaid'],
        'source_iaid'   => isset($row['source_iaid']) ? (int)$row['source_iaid'] : 0,
        'item_id'       => isset($row['item_id']) ? (string)$row['item_id'] : '',
        'itm'           => isset($row['itm']) ? (string)$row['itm'] : '',
        'itmk'          => isset($row['itmk']) ? (string)$row['itmk'] : '',
        'itme'          => isset($row['itme']) ? (int)$row['itme'] : 0,
        'itms'          => isset($row['itms']) ? (string)$row['itms'] : '0',
        'itmsk'         => isset($row['itmsk']) ? (string)$row['itmsk'] : '',
        'itmpara'       => isset($row['itmpara']) ? (string)$row['itmpara'] : '',
        'discovered'    => isset($row['discovered']) ? (int)$row['discovered'] : 0,
        'fake_item_id'  => isset($row['fake_item_id']) ? (string)$row['fake_item_id'] : '',
        'is_trap'       => isset($row['is_trap']) ? (int)$row['is_trap'] : 0,
    );
}

/**
 * editor_poi_list：列出指定区域 POI 实例（bra_oblmappoi）
 *
 * 必填参数：?pgroup=N
 * 可选参数：?pls=N（按格过滤）
 *
 * 直传 DB 行 + 模板字段拼接（dismantle_returns 来自 poi_table 模板）。
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_poi_list($ctx) {
    global $db, $tablepre;

    $pgroup = isset($_GET['pgroup']) ? (int)$_GET['pgroup'] : 0;
    if ($pgroup < 1) {
        obl_state_throw('MISSING_PARAM', '缺少 pgroup 参数');
    }
    $pls_filter = isset($_GET['pls']) ? (int)$_GET['pls'] : 0;

    if (function_exists('obl_mappoi_schema_ensure')) {
        obl_mappoi_schema_ensure();
    }

    $where = "pgroup='" . $pgroup . "'";
    if ($pls_filter > 0) {
        $where .= " AND pls='" . $pls_filter . "'";
    }
    $where .= " ORDER BY pls, iaid";

    $pois = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblmappoi WHERE " . $where);
    if ($result) {
        // poi_table 模板（用于 dismantle_returns 拼接）
        $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
        $current_day = function_exists('obl_day_get') ? (int)obl_day_get() : 0;

        while ($row = $db->fetch_array($result)) {
            $poi_id = isset($row['poi_id']) ? (string)$row['poi_id'] : '';
            $tpl = isset($poi_table[$poi_id]) ? $poi_table[$poi_id] : null;

            $ttl_days = (int)(isset($row['ttl_days']) ? $row['ttl_days'] : 0);
            $placed_at_day = (int)(isset($row['placed_at_day']) ? $row['placed_at_day'] : 0);
            $ttl_remaining = ($ttl_days > 0)
                ? max(0, $placed_at_day + $ttl_days - $current_day)
                : null;

            $pois[] = array(
                'iaid'                    => (int)$row['iaid'],
                'pgroup'                  => (int)$row['pgroup'],
                'pls'                     => (int)$row['pls'],
                'poi_id'                  => $poi_id,
                'state'                   => isset($row['state']) ? (string)$row['state'] : 'idle',
                'searched'                => !empty($row['searched']),
                'search_count'            => (int)(isset($row['search_count']) ? $row['search_count'] : 0),
                'search_count_remaining'  => (int)(isset($row['search_count_remaining']) ? $row['search_count_remaining'] : -1),
                'last_search_turn'        => (int)(isset($row['last_search_turn']) ? $row['last_search_turn'] : 0),
                'cooldown_until_turn'     => (int)(isset($row['cooldown_until_turn']) ? $row['cooldown_until_turn'] : 0),
                'placed_by_pid'           => (int)(isset($row['placed_by_pid']) ? $row['placed_by_pid'] : 0),
                'placed_at_day'           => $placed_at_day,
                'ttl_days'                => $ttl_days,
                'ttl_remaining_days'      => $ttl_remaining,
                // dismantle_returns 来自模板（F-7 拆除返还配置在 poi_table 模板中）
                'dismantle_returns'      => (is_array($tpl) && isset($tpl['dismantle_returns']) && is_array($tpl['dismantle_returns']))
                    ? $tpl['dismantle_returns']
                    : array(),
                // 模板关键字段（编辑器侧识别 POI 类型）
                'name'                    => (is_array($tpl) && isset($tpl['name'])) ? (string)$tpl['name'] : '',
                'searchable'              => (is_array($tpl) && !empty($tpl['searchable'])),
                'mechanic'                => (is_array($tpl) && isset($tpl['mechanic'])) ? (string)$tpl['mechanic'] : '',
            );
        }
    }

    return obl_state_response_success(array(
        'pois'  => $pois,
        'total' => count($pois),
    ));
}

/**
 * editor_fog_list：列出指定区域 fog 状态（bra_oblmapstates）
 *
 * 必填参数：?pgroup=N
 * 可选参数：?pls=N（按格过滤）
 *
 * 返回稀疏字典 { [pls]: 1 }（仅包含 fog=1 的 pls）。
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_fog_list($ctx) {
    global $db, $tablepre;

    $pgroup = isset($_GET['pgroup']) ? (int)$_GET['pgroup'] : 0;
    if ($pgroup < 1) {
        obl_state_throw('MISSING_PARAM', '缺少 pgroup 参数');
    }
    $pls_filter = isset($_GET['pls']) ? (int)$_GET['pls'] : 0;

    if (function_exists('obl_mapstates_schema_ensure')) {
        obl_mapstates_schema_ensure();
    }

    $where = "pgroup='" . $pgroup . "' AND fog=1";
    if ($pls_filter > 0) {
        $where .= " AND pls='" . $pls_filter . "'";
    }

    $fog = array();
    $result = $db->query("SELECT pls FROM {$tablepre}oblmapstates WHERE " . $where);
    if ($result) {
        while ($row = $db->fetch_array($result)) {
            $fog[(int)$row['pls']] = 1;
        }
    }

    return obl_state_response_success(array(
        'fog'    => $fog,
        'pgroup' => $pgroup,
        'total'  => count($fog),
    ));
}

/**
 * editor_config_load：加载 gamedata 配置文件
 *
 * 一次性返回 scatter_pool / poi_table / poi_pool / obl_config 四个配置文件内容。
 * 编辑器侧可直接填入 state.configCache（对齐 UPGRADE_DESIGN.md §1.4 configCache 结构）。
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_config_load($ctx) {
    $configs = array(
        'scatterPool' => array(),
        'poiTable'    => array(),
        'poiPool'     => array(),
        'oblConfig'   => array(),
    );

    $files = array(
        'scatterPool' => GAME_ROOT . './oblivions/gamedata/scatter_pool.php',
        'poiTable'    => GAME_ROOT . './oblivions/gamedata/poi_table.php',
        'poiPool'     => GAME_ROOT . './oblivions/gamedata/poi_pool.php',
        'oblConfig'   => GAME_ROOT . './oblivions/gamedata/obl_config.php',
    );

    foreach ($files as $key => $path) {
        if (!is_file($path)) continue;
        $data = @include $path;
        if (is_array($data)) {
            $configs[$key] = $data;
        }
    }

    return obl_state_response_success($configs);
}

/**
 * editor_backup_dump：一次性返回 gamedata 全部 PHP 文件原始内容 + DB 实例
 *
 * 用途：编辑器前端"备份后端"按钮调用，打包为 oblivions_backend_backup_<ts>.zip 下载。
 * 该 scope 是 editor_map_load / editor_config_load / editor_*_list 三类 scope 的合并导出，
 * 避免前端为单个备份发起 N 次请求；同时返回 PHP 文件原始字符串（而非 include 后的数据）
 * 以便前端打包的 ZIP 直接还原 gamedata 目录结构。
 *
 * 返回结构：
 *   - files: { 'map.php' => string, 'tiles/region_1.php' => string, 'scatter_pool.php' => string, ... }
 *     （键为相对 gamedata 目录的路径；值为文件原始内容；缺失文件不出现在字典中）
 *   - db: {
 *       fog:         { [pgroup]: { [pls]: 1 } },
 *       wildItems:   { [pgroup]: [bra_oblmapitem rows] },
 *       poiInstances:{ [pgroup]: [bra_oblmappoi rows] },
 *     }
 *   - timestamp: ISO8601 字符串（备份生成时刻）
 *   - pgroups: 后端实际存在的 pgroup 列表（用于前端校验）
 *
 * 安全：与所有 editor_* scope 共用 obl_editor_enabled() 守卫，无额外副作用。
 *
 * @param array $ctx
 * @return array
 */
function obl_editor_state_backup_dump($ctx) {
    $gamedata_dir = GAME_ROOT . './oblivions/gamedata/';
    $tiles_dir    = $gamedata_dir . 'tiles/';

    // 1. 收集 gamedata 顶层 PHP 文件（白名单 + 备份范围）
    $top_files = array(
        'map.php',
        'scatter_pool.php',
        'poi_table.php',
        'poi_pool.php',
        'obl_config.php',
    );
    $files = array();
    foreach ($top_files as $name) {
        $path = $gamedata_dir . $name;
        if (!is_file($path)) continue;
        $content = @file_get_contents($path);
        if ($content === false) continue;
        $files[$name] = $content;
    }

    // 2. 从 map.php 读取 pgroup 列表（用于遍历 tiles/region_*.php 与 DB 实例）
    $pgroups = array();
    if (isset($files['map.php'])) {
        // 临时 include 取 regions key（不污染输出，因为 map.php 仅 return 数组）
        $tmp = @include $gamedata_dir . 'map.php';
        if (is_array($tmp) && isset($tmp['regions']) && is_array($tmp['regions'])) {
            $pgroups = array_keys($tmp['regions']);
            sort($pgroups, SORT_NUMERIC);
        }
    }

    // 3. tiles/region_*.php：按 pgroup 遍历，缺失文件跳过
    foreach ($pgroups as $pg_str) {
        $pg = (int)$pg_str;
        $region_path = $tiles_dir . 'region_' . $pg . '.php';
        if (!is_file($region_path)) continue;
        $content = @file_get_contents($region_path);
        if ($content === false) continue;
        $files['tiles/region_' . $pg . '.php'] = $content;
    }

    // 4. 兜底：扫描 tiles/ 目录下所有 region_*.php（即便 map.php 未列出也纳入备份）
    if (is_dir($tiles_dir)) {
        foreach (glob($tiles_dir . 'region_*.php') as $abs_path) {
            $rel = 'tiles/' . basename($abs_path);
            if (isset($files[$rel])) continue;  // 已收录
            $content = @file_get_contents($abs_path);
            if ($content !== false) $files[$rel] = $content;
        }
    }

    // 5. DB 实例：按 pgroup 遍历 fog / wild item / POI
    $db_dump = array(
        'fog'          => array(),
        'wildItems'    => array(),
        'poiInstances' => array(),
    );

    if (!empty($pgroups)) {
        // 复用 obl_editor_state_*_list 内部查询逻辑，但绕过 ctx（直接传 pgroup）
        // fog：稀疏 { [pgroup]: { [pls]: 1 } }
        // wildItems / poiInstances：{ [pgroup]: [rows...] }
        global $db, $tablepre;

        // schema 自愈（与 list scope 一致）
        if (function_exists('obl_mapitem_schema_ensure'))   obl_mapitem_schema_ensure();
        if (function_exists('obl_mappoi_schema_ensure'))    obl_mappoi_schema_ensure();
        if (function_exists('obl_mapstates_schema_ensure')) obl_mapstates_schema_ensure();

        foreach ($pgroups as $pg_str) {
            $pg = (int)$pg_str;

            // fog
            $fog = array();
            $fog_result = $db->query("SELECT pls FROM {$tablepre}oblmapstates WHERE pgroup='{$pg}' AND fog=1");
            if ($fog_result) {
                while ($row = $db->fetch_array($fog_result)) {
                    $fog[(int)$row['pls']] = 1;
                }
            }
            $db_dump['fog'][$pg] = $fog;

            // wildItems
            $items = array();
            $item_result = $db->query("SELECT * FROM {$tablepre}oblmapitem WHERE pgroup='{$pg}' ORDER BY pls, iaid");
            if ($item_result) {
                while ($row = $db->fetch_array($item_result)) {
                    $items[] = obl_editor_sanitize_wilditem_row($row);
                }
            }
            $db_dump['wildItems'][$pg] = $items;

            // poiInstances（简化字段集：备份只需原始 DB 行，不拼接 poi_table 模板字段）
            $pois = array();
            $poi_result = $db->query("SELECT * FROM {$tablepre}oblmappoi WHERE pgroup='{$pg}' ORDER BY pls, iaid");
            if ($poi_result) {
                while ($row = $db->fetch_array($poi_result)) {
                    $pois[] = array(
                        'iaid'                    => (int)$row['iaid'],
                        'pgroup'                  => (int)$row['pgroup'],
                        'pls'                     => (int)$row['pls'],
                        'poi_id'                  => isset($row['poi_id']) ? (string)$row['poi_id'] : '',
                        'state'                   => isset($row['state']) ? (string)$row['state'] : 'idle',
                        'searched'                => !empty($row['searched']),
                        'search_count'            => (int)(isset($row['search_count']) ? $row['search_count'] : 0),
                        'search_count_remaining'  => (int)(isset($row['search_count_remaining']) ? $row['search_count_remaining'] : -1),
                        'last_search_turn'        => (int)(isset($row['last_search_turn']) ? $row['last_search_turn'] : 0),
                        'cooldown_until_turn'     => (int)(isset($row['cooldown_until_turn']) ? $row['cooldown_until_turn'] : 0),
                        'placed_by_pid'           => (int)(isset($row['placed_by_pid']) ? $row['placed_by_pid'] : 0),
                        'placed_at_day'           => (int)(isset($row['placed_at_day']) ? $row['placed_at_day'] : 0),
                        'ttl_days'                => (int)(isset($row['ttl_days']) ? $row['ttl_days'] : 0),
                    );
                }
            }
            $db_dump['poiInstances'][$pg] = $pois;
        }
    }

    return obl_state_response_success(array(
        'files'     => $files,
        'db'        => $db_dump,
        'pgroups'   => array_map('intval', $pgroups),
        'timestamp' => date('c'),
    ));
}
