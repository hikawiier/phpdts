<?php
/**
 * @module O 编辑器接口层
 * @framework O-4 编辑器守卫与后端对接
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions O-4 编辑器 Command Handlers / Editor Command Handlers
//
// 实现 editor.* 命令的写入处理器，全部走 command.php 入口。
// 所有命令必须先通过 obl_editor_enabled() 守卫（由 obl_command_handler_dispatch 调用前检查）。
//
// 命令分类：
//   - editor.map.save：写 map.php + tiles/region_*.php（先备份 ZIP，再 file_put_contents + LOCK_EX）
//   - editor.wilditem.upsert / delete：直接 INSERT/UPDATE/DELETE bra_oblmapitem
//   - editor.poi.upsert / delete：直接 INSERT/UPDATE/DELETE bra_oblmappoi
//   - editor.fog.set：UPSERT bra_oblmapstates.fog（INSERT ... ON DUPLICATE KEY UPDATE）
//   - editor.config.save：写 scatter_pool.php / poi_table.php / poi_pool.php（同样备份+LOCK_EX）
//
// 安全约束（对齐 UPGRADE_DESIGN.md §3.3 / §6.4）：
//   - PHP 文件写入前先备份到 oblivions/gamedata/backup/（时间戳 ZIP）
//   - file_put_contents + LOCK_EX 防并发写
//   - 写入后 php -l 语法检查（命令行调用，失败回滚）
//   - DB 操作复用现有 PDO 预处理式查询（$db->escape_string + 字符串拼接，与 generate.func.php 一致）
//
// $pdata 约定：编辑器命令使用合成 pdata（pid=0），不依赖玩家会话；handler 内部不读 $pdata 字段。
// ================================================================

/**
 * 编辑器命令：保存 map.php + tiles/region_*.php
 *
 * 流程：
 *   1. 备份旧文件到 oblivions/gamedata/backup/oblivions_map_backup_{timestamp}.zip
 *   2. 写 map.php（regions + grids）
 *   3. 删除不再存在的 region_*.php（基于 payload.tiles 的 pgroup 集合）
 *   4. 写每个 pgroup 的 tiles/region_{pgroup}.php
 *   5. php -l 语法检查（失败抛错，文件已写入但需手工回滚）
 *
 * payload: { regions, grids, tiles }
 *
 * @param array $payload
 * @param array &$pdata（编辑器合成 pdata，pid=0）
 * @return array
 */
function obl_editor_command_map_save($payload, &$pdata) {
    $regions = isset($payload['regions']) && is_array($payload['regions']) ? $payload['regions'] : array();
    $grids   = isset($payload['grids'])   && is_array($payload['grids'])   ? $payload['grids']   : array();
    $tiles   = isset($payload['tiles'])   && is_array($payload['tiles'])   ? $payload['tiles']   : array();

    $gamedata_dir = GAME_ROOT . './oblivions/gamedata/';
    $tiles_dir = $gamedata_dir . 'tiles/';
    $backup_dir = $gamedata_dir . 'backup/';

    // 1. 备份
    $backup_result = obl_editor_backup_files($backup_dir, 'map', array(
        $gamedata_dir . 'map.php' => 'map.php',
    ), $tiles_dir, 'region_*.php');

    // 2. 写 map.php
    $map_php = obl_editor_generate_map_php($regions, $grids);
    $write_result = obl_editor_safe_write_php($gamedata_dir . 'map.php', $map_php, 'map.php');
    if (!$write_result['ok']) return $write_result;

    // 3. 删除不再存在的 region_*.php
    $keep_pgroups = array_map('strval', array_keys($tiles));
    foreach (glob($tiles_dir . 'region_*.php') as $existing_file) {
        $basename = basename($existing_file, '.php');  // region_N
        $pg_str = substr($basename, strlen('region_'));
        if (!in_array($pg_str, $keep_pgroups, true)) {
            @unlink($existing_file);
        }
    }

    // 4. 写每个 region_{pgroup}.php
    foreach ($tiles as $pg_str => $region_tiles) {
        $pg = (int)$pg_str;
        $php_content = obl_editor_generate_region_php($pg, $region_tiles);
        $write_result = obl_editor_safe_write_php($tiles_dir . 'region_' . $pg . '.php', $php_content, "region_{$pg}.php");
        if (!$write_result['ok']) return $write_result;
    }

    return array(
        'ok' => true,
        'data' => array(
            'regions_written' => count($regions),
            'tiles_written'   => count($tiles),
            'backup'          => $backup_result,
        ),
    );
}

/**
 * 编辑器命令：新增/更新 wild item 实例
 *
 * iid=0 或缺失 → INSERT；iid>0 → UPDATE。
 *
 * @param array $payload
 * @param array &$pdata
 * @return array
 */
function obl_editor_command_wilditem_upsert($payload, &$pdata) {
    global $db, $tablepre;

    $iid = isset($payload['iid']) ? (int)$payload['iid'] : 0;
    $pgroup = (int)$payload['pgroup'];
    $pls = (int)$payload['pls'];

    // 字段提取（带默认值）
    $fields = obl_editor_collect_wilditem_fields($payload);

    if ($iid > 0) {
        // UPDATE
        $set_clause = implode(', ', array_map(function($k, $v) use ($db) {
            return "`{$k}`='" . $db->escape_string((string)$v) . "'";
        }, array_keys($fields), $fields));
        $db->query("UPDATE {$tablepre}oblmapitem SET {$set_clause} WHERE iid='{$iid}'");
        $affected = $db->affected_rows();
        if ($affected === 0 && !obl_editor_wilditem_exists($iid)) {
            return array('ok' => false, 'code' => 'WILDITEM_NOT_FOUND', 'details' => array('iid' => $iid));
        }
        return array('ok' => true, 'data' => array('iid' => $iid, 'op' => 'update'));
    }

    // INSERT
    $columns = array_merge(array('pgroup', 'pls'), array_keys($fields));
    $values = array_merge(array($pgroup, $pls), array_values($fields));
    $col_sql = implode(', ', array_map(function($c) { return "`{$c}`"; }, $columns));
    $val_sql = implode(', ', array_map(function($v) use ($db) {
        return "'" . $db->escape_string((string)$v) . "'";
    }, $values));
    $db->query("INSERT INTO {$tablepre}oblmapitem ({$col_sql}) VALUES ({$val_sql})");
    $new_iid = (int)$db->insert_id();
    if ($new_iid <= 0) {
        return array('ok' => false, 'code' => 'DB_ERROR', 'details' => array('reason' => 'insert_failed'));
    }
    return array('ok' => true, 'data' => array('iid' => $new_iid, 'op' => 'insert'));
}

/**
 * 收集 wild item 字段（除 iid/pgroup/pls 外的可写字段）
 *
 * @param array $payload
 * @return array 字段名 => 值（值已做类型规范化，未做 escape）
 */
function obl_editor_collect_wilditem_fields($payload) {
    $fields = array();
    if (isset($payload['item_id']))      $fields['item_id']      = (string)$payload['item_id'];
    if (isset($payload['itm']))          $fields['itm']          = (string)$payload['itm'];
    if (isset($payload['itmk']))         $fields['itmk']         = (string)$payload['itmk'];
    if (isset($payload['itme']))         $fields['itme']         = (int)$payload['itme'];
    if (isset($payload['itms']))         $fields['itms']         = (string)$payload['itms'];
    if (isset($payload['itmsk']))        $fields['itmsk']        = (string)$payload['itmsk'];
    if (isset($payload['itmpara']))      $fields['itmpara']      = (string)$payload['itmpara'];
    if (isset($payload['discovered']))   $fields['discovered']   = (int)$payload['discovered'];
    if (isset($payload['fake_item_id'])) $fields['fake_item_id'] = (string)$payload['fake_item_id'];
    if (isset($payload['is_trap']))      $fields['is_trap']      = (int)$payload['is_trap'];
    return $fields;
}

/**
 * 检查 wild item 实例是否存在
 *
 * @param int $iid
 * @return bool
 */
function obl_editor_wilditem_exists($iid) {
    global $db, $tablepre;
    $result = $db->query("SELECT 1 FROM {$tablepre}oblmapitem WHERE iid='" . (int)$iid . "' LIMIT 1");
    return $result && $db->num_rows($result) > 0;
}

/**
 * 编辑器命令：删除 wild item 实例
 *
 * @param array $payload
 * @param array &$pdata
 * @return array
 */
function obl_editor_command_wilditem_delete($payload, &$pdata) {
    global $db, $tablepre;
    $iid = (int)$payload['iid'];
    if ($iid <= 0) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_iid'));
    }
    $db->query("DELETE FROM {$tablepre}oblmapitem WHERE iid='{$iid}'");
    $affected = $db->affected_rows();
    if ($affected === 0) {
        return array('ok' => false, 'code' => 'WILDITEM_NOT_FOUND', 'details' => array('iid' => $iid));
    }
    return array('ok' => true, 'data' => array('iid' => $iid, 'deleted' => true));
}

/**
 * 编辑器命令：新增/更新 POI 实例
 *
 * iaid=0 或缺失 → INSERT；iaid>0 → UPDATE。
 *
 * @param array $payload
 * @param array &$pdata
 * @return array
 */
function obl_editor_command_poi_upsert($payload, &$pdata) {
    global $db, $tablepre;

    $iaid = isset($payload['iaid']) ? (int)$payload['iaid'] : 0;
    $pgroup = (int)$payload['pgroup'];
    $pls = (int)$payload['pls'];

    $fields = obl_editor_collect_poi_fields($payload);

    if ($iaid > 0) {
        $set_clause = implode(', ', array_map(function($k, $v) use ($db) {
            return "`{$k}`='" . $db->escape_string((string)$v) . "'";
        }, array_keys($fields), $fields));
        $db->query("UPDATE {$tablepre}oblmappoi SET {$set_clause} WHERE iaid='{$iaid}'");
        $affected = $db->affected_rows();
        if ($affected === 0 && !obl_editor_poi_exists($iaid)) {
            return array('ok' => false, 'code' => 'POI_NOT_FOUND', 'details' => array('iaid' => $iaid));
        }
        return array('ok' => true, 'data' => array('iaid' => $iaid, 'op' => 'update'));
    }

    $columns = array_merge(array('pgroup', 'pls'), array_keys($fields));
    $values = array_merge(array($pgroup, $pls), array_values($fields));
    $col_sql = implode(', ', array_map(function($c) { return "`{$c}`"; }, $columns));
    $val_sql = implode(', ', array_map(function($v) use ($db) {
        return "'" . $db->escape_string((string)$v) . "'";
    }, $values));
    $db->query("INSERT INTO {$tablepre}oblmappoi ({$col_sql}) VALUES ({$val_sql})");
    $new_iaid = (int)$db->insert_id();
    if ($new_iaid <= 0) {
        return array('ok' => false, 'code' => 'DB_ERROR', 'details' => array('reason' => 'insert_failed'));
    }
    return array('ok' => true, 'data' => array('iaid' => $new_iaid, 'op' => 'insert'));
}

/**
 * 收集 POI 字段（除 iaid/pgroup/pls 外的可写字段）
 *
 * @param array $payload
 * @return array
 */
function obl_editor_collect_poi_fields($payload) {
    $fields = array();
    if (isset($payload['poi_id']))                 $fields['poi_id']                 = (string)$payload['poi_id'];
    if (isset($payload['state']))                  $fields['state']                  = (string)$payload['state'];
    if (isset($payload['searched']))               $fields['searched']               = (int)$payload['searched'];
    if (isset($payload['search_count']))           $fields['search_count']           = (int)$payload['search_count'];
    if (isset($payload['search_count_remaining'])) $fields['search_count_remaining'] = (int)$payload['search_count_remaining'];
    if (isset($payload['last_search_turn']))       $fields['last_search_turn']       = (int)$payload['last_search_turn'];
    if (isset($payload['cooldown_until_turn']))    $fields['cooldown_until_turn']    = (int)$payload['cooldown_until_turn'];
    if (isset($payload['placed_by_pid']))          $fields['placed_by_pid']          = (int)$payload['placed_by_pid'];
    if (isset($payload['placed_at_day']))          $fields['placed_at_day']          = (int)$payload['placed_at_day'];
    if (isset($payload['ttl_days']))               $fields['ttl_days']               = (int)$payload['ttl_days'];
    return $fields;
}

/**
 * 检查 POI 实例是否存在
 *
 * @param int $iaid
 * @return bool
 */
function obl_editor_poi_exists($iaid) {
    global $db, $tablepre;
    $result = $db->query("SELECT 1 FROM {$tablepre}oblmappoi WHERE iaid='" . (int)$iaid . "' LIMIT 1");
    return $result && $db->num_rows($result) > 0;
}

/**
 * 编辑器命令：删除 POI 实例
 *
 * @param array $payload
 * @param array &$pdata
 * @return array
 */
function obl_editor_command_poi_delete($payload, &$pdata) {
    global $db, $tablepre;
    $iaid = (int)$payload['iaid'];
    if ($iaid <= 0) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_iaid'));
    }
    $db->query("DELETE FROM {$tablepre}oblmappoi WHERE iaid='{$iaid}'");
    $affected = $db->affected_rows();
    if ($affected === 0) {
        return array('ok' => false, 'code' => 'POI_NOT_FOUND', 'details' => array('iaid' => $iaid));
    }
    return array('ok' => true, 'data' => array('iaid' => $iaid, 'deleted' => true));
}

/**
 * 编辑器命令：设置 fog 状态
 *
 * 实现 INSERT ... ON DUPLICATE KEY UPDATE 模式（pgroup+pls 是主键）。
 *
 * @param array $payload
 * @param array &$pdata
 * @return array
 */
function obl_editor_command_fog_set($payload, &$pdata) {
    global $db, $tablepre;
    $pgroup = (int)$payload['pgroup'];
    $pls = (int)$payload['pls'];
    $fog = (int)$payload['fog'] ? 1 : 0;

    if (function_exists('obl_mapstates_schema_ensure')) {
        obl_mapstates_schema_ensure();
    }

    // DELETE then INSERT 简化（避免 schema 字段不一致带来的 ON DUPLICATE 难题）
    $db->query("DELETE FROM {$tablepre}oblmapstates WHERE pgroup='{$pgroup}' AND pls='{$pls}'");
    if ($fog === 1) {
        $db->query("INSERT INTO {$tablepre}oblmapstates (pgroup, pls, fog) VALUES ({$pgroup}, {$pls}, 1)");
    }
    return array('ok' => true, 'data' => array(
        'pgroup' => $pgroup,
        'pls'    => $pls,
        'fog'    => $fog,
        'op'     => $fog === 1 ? 'set' : 'clear',
    ));
}

/**
 * 编辑器命令：保存配置文件（scatter_pool / poi_table / poi_pool）
 *
 * payload: { file: 'scatter_pool'|'poi_table'|'poi_pool'|'obl_config', content: 'PHP source string' }
 *
 * 流程：
 *   1. 校验 file 取值白名单（防止任意文件写入漏洞）
 *   2. 备份旧文件到 oblivions/gamedata/backup/
 *   3. file_put_contents + LOCK_EX 写入新内容
 *   4. php -l 语法检查（失败抛错）
 *
 * @param array $payload
 * @param array &$pdata
 * @return array
 */
function obl_editor_command_config_save($payload, &$pdata) {
    $file = isset($payload['file']) ? (string)$payload['file'] : '';
    $content = isset($payload['content']) ? (string)$payload['content'] : '';

    // 白名单校验（防止任意文件写入漏洞，对齐 UPGRADE_DESIGN.md §6.4）
    $allowed_files = array(
        'scatter_pool' => 'scatter_pool.php',
        'poi_table'    => 'poi_table.php',
        'poi_pool'     => 'poi_pool.php',
        'obl_config'   => 'obl_config.php',
    );
    if (!isset($allowed_files[$file])) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array(
            'reason' => 'invalid_file',
            'allowed' => array_keys($allowed_files),
        ));
    }

    $target_path = GAME_ROOT . './oblivions/gamedata/' . $allowed_files[$file];
    $backup_dir = GAME_ROOT . './oblivions/gamedata/backup/';

    // 备份旧文件
    $backup_result = obl_editor_backup_files($backup_dir, 'config_' . $file, array(
        $target_path => $allowed_files[$file],
    ), null, null);

    // 写入新内容
    $write_result = obl_editor_safe_write_php($target_path, $content, $allowed_files[$file]);
    if (!$write_result['ok']) return $write_result;

    return array(
        'ok' => true,
        'data' => array(
            'file'   => $file,
            'bytes'  => strlen($content),
            'backup' => $backup_result,
        ),
    );
}

// ================================================================
// PHP 文件写入辅助函数（对齐 UPGRADE_DESIGN.md §3.3 / §6.4）
// ================================================================

/**
 * 安全写入 PHP 文件：file_put_contents + LOCK_EX + php -l 语法检查
 *
 * 失败时返回 ['ok' => false, 'code' => 'editor.file_write_failed', 'details' => [...]]
 *
 * @param string $path 目标文件绝对路径
 * @param string $content PHP 源码字符串
 * @param string $label 用于错误消息的文件标签
 * @return array
 */
function obl_editor_safe_write_php($path, $content, $label) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    if (!is_writable($dir)) {
        return array('ok' => false, 'code' => 'FILE_WRITE_FAILED', 'details' => array(
            'reason' => 'dir_not_writable',
            'path'   => $dir,
        ));
    }

    // 写入前如果是已存在文件，先备份到内存（用于语法检查失败时回滚）
    $old_content = is_file($path) ? file_get_contents($path) : null;

    // file_put_contents + LOCK_EX
    $written = file_put_contents($path, $content, LOCK_EX);
    if ($written === false) {
        return array('ok' => false, 'code' => 'FILE_WRITE_FAILED', 'details' => array(
            'reason' => 'write_failed',
            'path'   => $path,
        ));
    }

    // php -l 语法检查
    $lint_result = obl_editor_php_lint($path);
    if (!$lint_result['ok']) {
        // 回滚
        if ($old_content !== null) {
            file_put_contents($path, $old_content, LOCK_EX);
        } else {
            @unlink($path);
        }
        return array('ok' => false, 'code' => 'FILE_WRITE_FAILED', 'details' => array(
            'reason'   => 'php_lint_failed',
            'file'     => $label,
            'output'   => $lint_result['output'],
        ));
    }

    return array('ok' => true, 'data' => array('bytes' => $written, 'file' => $label));
}

/**
 * 调用 php -l 语法检查
 *
 * 部分环境禁用 shell_exec 时降级为 token_get_all 解析检查。
 *
 * @param string $path
 * @return array ['ok' => bool, 'output'?: string]
 */
function obl_editor_php_lint($path) {
    $php_bin = PHP_BINARY;
    // 检测 PHP_BINARY 是否为真正的 PHP CLI 可执行文件
    // WAMP Apache 模块下 PHP_BINARY 返回 httpd.exe，shell_exec 执行 "httpd.exe -l file.php"
    // 输出 Apache mpm_winnt 错误而非 PHP 语法检查结果，会误判为 lint 失败
    $is_php_cli = false;
    if ($php_bin) {
        $base = basename($php_bin);
        $is_php_cli = preg_match('/php/i', $base) === 1
                   && preg_match('/httpd|apache/i', $base) === 0;
    }
    if ($is_php_cli && function_exists('shell_exec')) {
        $cmd = escapeshellarg($php_bin) . ' -l ' . escapeshellarg($path) . ' 2>&1';
        $output = @shell_exec($cmd);
        if ($output !== null && strpos($output, 'No syntax errors detected') !== false) {
            return array('ok' => true);
        }
        return array('ok' => false, 'output' => is_string($output) ? $output : 'lint_unknown');
    }
    // Fallback: 用 token_get_all 解析（不验证语义，只验证词法）
    // 适用场景：shell_exec 禁用 / PHP_BINARY 为非 CLI（如 Apache httpd.exe）
    $src = file_get_contents($path);
    if ($src === false) {
        return array('ok' => false, 'output' => 'read_failed');
    }
    $tokens = @token_get_all($src);
    if ($tokens === false) {
        return array('ok' => false, 'output' => 'token_get_all_failed');
    }
    return array('ok' => true);
}

/**
 * 备份文件到 ZIP（如果 ZipArchive 可用）或目录副本
 *
 * @param string $backup_dir 备份目录
 * @param string $prefix 备份文件名前缀（如 'map' / 'config_scatter_pool'）
 * @param array $files [绝对路径 => zip 内相对路径]
 * @param string|null $glob_dir glob 模式所在目录（如 tiles 目录）
 * @param string|null $glob_pattern glob 模式（如 'region_*.php'）
 * @return array 备份结果摘要
 */
function obl_editor_backup_files($backup_dir, $prefix, $files, $glob_dir = null, $glob_pattern = null) {
    if (!is_dir($backup_dir)) {
        @mkdir($backup_dir, 0755, true);
    }
    $timestamp = date('Ymd_His');
    $backup_name = "oblivions_{$prefix}_backup_{$timestamp}";
    $backup_zip = $backup_dir . $backup_name . '.zip';

    // 收集待备份文件
    $files_to_zip = array();
    foreach ($files as $abs_path => $rel_path) {
        if (is_file($abs_path)) {
            $files_to_zip[$abs_path] = $rel_path;
        }
    }
    if ($glob_dir && $glob_pattern) {
        foreach (glob($glob_dir . $glob_pattern) as $gfile) {
            $files_to_zip[$gfile] = 'tiles/' . basename($gfile);
        }
    }

    if (empty($files_to_zip)) {
        return array('skipped' => true, 'reason' => 'no_files_to_backup');
    }

    // 优先用 ZipArchive
    if (class_exists('ZipArchive', false)) {
        $zip = new ZipArchive();
        if ($zip->open($backup_zip, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
            foreach ($files_to_zip as $abs => $rel) {
                $zip->addFile($abs, $rel);
            }
            $zip->close();
            return array('skipped' => false, 'file' => $backup_zip, 'count' => count($files_to_zip));
        }
    }

    // Fallback: 复制到子目录（PHP ZipArchive 不可用时）
    $fallback_dir = $backup_dir . $backup_name . '/';
    if (!is_dir($fallback_dir)) {
        @mkdir($fallback_dir, 0755, true);
    }
    foreach ($files_to_zip as $abs => $rel) {
        $target = $fallback_dir . $rel;
        $target_dir = dirname($target);
        if (!is_dir($target_dir)) {
            @mkdir($target_dir, 0755, true);
        }
        @copy($abs, $target);
    }
    return array('skipped' => false, 'dir' => $fallback_dir, 'count' => count($files_to_zip));
}

// ================================================================
// PHP 代码生成器（与编辑器前端 php-codegen.js 格式对齐）
// 4 空格缩进 / 单引号字符串 / 'key' => value
// ================================================================

/**
 * 生成 map.php 内容
 *
 * @param array $regions
 * @param array $grids
 * @return string PHP 源码
 */
function obl_editor_generate_map_php($regions, $grids) {
    $lines = array();
    $lines[] = '<?php';
    $lines[] = '/**';
    $lines[] = ' * @module E 游戏逻辑';
    $lines[] = ' */';
    $lines[] = "if (!defined('IN_GAME')) { exit('Access Denied'); }";
    $lines[] = '';
    $lines[] = '// ================================================================';
    $lines[] = '// Oblivions 地图数据 — 区域元数据 + 网格布局';
    $lines[] = '// 地图格数据按区域拆分至 tiles/region_{pgroup}.php，按需加载';
    $lines[] = '// 数据结构：regions[pgroup] + grids[pgroup]';
    $lines[] = '// pls 范围 1-254，区域内局部索引，pls=0 保留不使用';
    $lines[] = '// ================================================================';
    $lines[] = '';
    $lines[] = 'return [';
    $lines[] = "    'regions' => [";

    foreach ($regions as $pg_str => $rinfo) {
        $lines[] = "    '{$pg_str}' => [";
        foreach ($rinfo as $k => $v) {
            $lines[] = "        '{$k}' => " . obl_editor_value_to_php($v, 8) . ',';
        }
        $lines[] = '    ],';
    }

    $lines[] = "    ],";
    $lines[] = "    'grids' => [";
    foreach ($grids as $pg_str => $grid) {
        $cols = isset($grid['cols']) ? (int)$grid['cols'] : 8;
        $rows = isset($grid['rows']) ? (int)$grid['rows'] : 6;
        $lines[] = "        '{$pg_str}' => ['cols' => {$cols}, 'rows' => {$rows}],";
    }
    $lines[] = "    ],";
    $lines[] = '];';
    return implode("\n", $lines) . "\n";
}

/**
 * 生成 tiles/region_{pgroup}.php 内容
 *
 * @param int $pgroup
 * @param array $region_tiles
 * @return string PHP 源码
 */
function obl_editor_generate_region_php($pgroup, $region_tiles) {
    $pg = (int)$pgroup;
    $lines = array();
    $lines[] = '<?php';
    $lines[] = '/**';
    $lines[] = ' * @module E 游戏逻辑';
    $lines[] = ' */';
    $lines[] = "if (!defined('IN_GAME')) { exit('Access Denied'); }";
    $lines[] = '';
    $lines[] = '// ================================================================';
    $lines[] = "// Oblivions 地图格数据 — 区域 {$pg}：区域数据";
    $lines[] = '// pls 范围 1-254，区域内局部索引';
    $lines[] = '// ================================================================';
    $lines[] = '';
    $lines[] = 'return [';
    foreach ($region_tiles as $pls_str => $tile) {
        $lines[] = "    '{$pls_str}' => [";
        foreach ($tile as $k => $v) {
            $lines[] = "        '{$k}' => " . obl_editor_value_to_php($v, 8) . ',';
        }
        $lines[] = '    ],';
    }
    $lines[] = '];';
    return implode("\n", $lines) . "\n";
}

/**
 * PHP 值序列化（递归，与编辑器前端 php-codegen.js 一致）
 *
 * @param mixed $value
 * @param int $indent 当前缩进空格数
 * @return string
 */
function obl_editor_value_to_php($value, $indent = 0) {
    $pad = str_repeat(' ', $indent);

    if (is_int($value) || is_float($value)) {
        return (string)$value;
    }
    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }
    if ($value === null) {
        return 'null';
    }
    if (is_string($value)) {
        // 单引号字符串 + 转义单引号与反斜杠
        $escaped = str_replace(array('\\', "'"), array('\\\\', "\\'"), $value);
        return "'" . $escaped . "'";
    }
    if (is_array($value)) {
        // 关联数组 vs 索引数组：PHP 中 keys 是 0..n-1 即视为索引
        $keys = array_keys($value);
        $is_sequential = ($keys === range(0, count($value) - 1));
        $child_pad = $indent + 4;
        $inner = array();
        if ($is_sequential) {
            foreach ($value as $v) {
                $inner[] = $pad . str_repeat(' ', 4) . obl_editor_value_to_php($v, $child_pad) . ',';
            }
        } else {
            foreach ($value as $k => $v) {
                $inner[] = $pad . str_repeat(' ', 4) . obl_editor_value_to_php((string)$k, $child_pad) . ' => ' . obl_editor_value_to_php($v, $child_pad) . ',';
            }
        }
        if (empty($inner)) {
            return '[]';
        }
        return "[\n" . implode("\n", $inner) . "\n" . $pad . "]";
    }
    // fallback
    return "'" . str_replace(array('\\', "'"), array('\\\\', "\\'"), (string)$value) . "'";
}
