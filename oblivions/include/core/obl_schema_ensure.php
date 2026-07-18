<?php
/**
 * @module C 核心运行时
 * @framework C-8 运行时表 schema 自愈机制
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 运行时表 Schema 自愈 / Runtime Table Schema Self-Healing
//
// 解决问题：oblivions/sql/*.sql 中的 DROP IF EXISTS + CREATE TABLE
// 只在 obl_rs_game() 新开局时执行，运行中的表不会因字段新增而自动升级。
// 当代码迭代引入新字段（如 E-9 last_refresh_day、E-12 placed_by_pid 等）
// 后，day_changed 事件触发的 wild_refresh / poi.durability_cleanup 监听器
// 会因 "Unknown column" 报错。
//
// 修复模式（参照 obl_game_schema_ensure 的实现范式）：
//   1. CREATE TABLE IF NOT EXISTS（保证表存在）
//   2. SHOW COLUMNS 检查字段；缺失则 ALTER TABLE ADD COLUMN
//   3. SHOW INDEX 检查索引；缺失则 ALTER TABLE ADD INDEX
//   4. static $ensured 防重入，同请求多次调用零开销
//
// 调用策略：
//   - 顶层入口：obl_runtime_boot() 在 is_oblivions 且非 state 路径时
//     调用 obl_runtime_tables_schema_ensure()，覆盖 command/heartbeat 路径
//   - state.php 是纯读入口，不触发 schema 副作用（保持纯读语义）
//   - 使用点防御性兜底：wild_refresh / poi.durability_cleanup 入口
//     再次调用对应表的 schema_ensure，避免从其他路径调用时的遗漏
//
// 研判覆盖范围：
//   - oblmapstates：需要（E-9 新增 last_refresh_day / refresh_count）
//   - oblmappoi：需要（E-12 新增 placed_by_pid / placed_at_day / ttl_days + idx_ttl_expiry）
//   - oblmapitem：需要（source_iaid 字段虽非新引入，但 wild_refresh 与
//     poi.dismantle 均依赖此字段；纳入统一框架覆盖更稳健）
//   - oblplayers / oblqueue / oblbattle_state：暂不需要（无最近字段变更）
//
// 设计文档：oblivions/docs/天数与昼夜系统-设计案.md §五（E-9 wild_refresh）
//          oblivions/docs/玩家放置POI与耐久系统-设计案.md（E-12 POI 耐久）
// ================================================================

/**
 * oblmapstates 表 schema 自愈
 *
 * 检查字段：last_refresh_day / refresh_count / last_refresh_turn
 * 表结构定义：oblivions/sql/oblmapstates.sql
 */
function obl_mapstates_schema_ensure() {
    global $db, $tablepre;
    static $ensured = array();

    if (!isset($db) || !$db || !isset($tablepre)) return;
    $table = $tablepre . 'oblmapstates';
    if (isset($ensured[$table])) return;

    // 1. CREATE TABLE IF NOT EXISTS（字段定义与 sql/oblmapstates.sql 保持一致）
    $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
        `pgroup` tinyint unsigned NOT NULL,
        `pls` tinyint unsigned NOT NULL DEFAULT '0',
        `fog` tinyint(1) unsigned NOT NULL DEFAULT '0',
        `damaged` tinyint(1) unsigned NOT NULL DEFAULT '0',
        `flags` varchar(255) NOT NULL DEFAULT '',
        `last_refresh_day` int unsigned NOT NULL DEFAULT '0',
        `refresh_count` smallint unsigned NOT NULL DEFAULT '0',
        `last_refresh_turn` int unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (`pgroup`, `pls`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    $db->query($sql);

    // 2. 检查字段并补建
    $columns_known = array();
    $col_result = $db->query("SHOW COLUMNS FROM `{$table}`");
    if ($col_result) {
        while ($col_row = $db->fetch_array($col_result)) {
            $columns_known[$col_row['Field']] = true;
        }
    }
    if (!isset($columns_known['last_refresh_day'])) {
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `last_refresh_day` int unsigned NOT NULL DEFAULT '0' AFTER `flags`");
    }
    if (!isset($columns_known['refresh_count'])) {
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `refresh_count` smallint unsigned NOT NULL DEFAULT '0' AFTER `last_refresh_day`");
    }
    if (!isset($columns_known['last_refresh_turn'])) {
        // deprecated 字段，仅为兼容旧逻辑的兜底查询保留
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `last_refresh_turn` int unsigned NOT NULL DEFAULT '0' AFTER `refresh_count`");
    }

    $ensured[$table] = true;
}

/**
 * oblmappoi 表 schema 自愈
 *
 * 检查字段：placed_by_pid / placed_at_day / ttl_days（E-12 POI 耐久系统）
 * 检查索引：idx_ttl_expiry（支撑 day_changed 监听器批量扫描过期 POI）
 * 表结构定义：oblivions/sql/oblmappoi.sql
 */
function obl_mappoi_schema_ensure() {
    global $db, $tablepre;
    static $ensured = array();

    if (!isset($db) || !$db || !isset($tablepre)) return;
    $table = $tablepre . 'oblmappoi';
    if (isset($ensured[$table])) return;

    // 1. CREATE TABLE IF NOT EXISTS（仅核心字段，旧表不会被重建）
    $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
        `iaid` mediumint unsigned NOT NULL AUTO_INCREMENT,
        `pgroup` tinyint unsigned NOT NULL DEFAULT '0',
        `pls` tinyint unsigned NOT NULL DEFAULT '0',
        `poi_id` varchar(32) NOT NULL DEFAULT '',
        `state` varchar(16) NOT NULL DEFAULT 'idle',
        `search_count` int unsigned NOT NULL DEFAULT '0',
        `search_count_remaining` smallint signed NOT NULL DEFAULT '-1',
        `last_search_turn` int unsigned NOT NULL DEFAULT '0',
        `cooldown_until_turn` int unsigned NOT NULL DEFAULT '0',
        `searched` tinyint(1) unsigned NOT NULL DEFAULT '0',
        `placed_by_pid` mediumint unsigned NOT NULL DEFAULT '0',
        `placed_at_day` int unsigned NOT NULL DEFAULT '0',
        `ttl_days` smallint unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (`iaid`),
        INDEX `idx_pgroup_pls` (`pgroup`, `pls`),
        INDEX `idx_state` (`state`),
        INDEX `idx_ttl_expiry` (`ttl_days`, `placed_at_day`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    $db->query($sql);

    // 2. 检查 E-12 字段并补建
    $columns_known = array();
    $col_result = $db->query("SHOW COLUMNS FROM `{$table}`");
    if ($col_result) {
        while ($col_row = $db->fetch_array($col_result)) {
            $columns_known[$col_row['Field']] = true;
        }
    }
    if (!isset($columns_known['placed_by_pid'])) {
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `placed_by_pid` mediumint unsigned NOT NULL DEFAULT '0' AFTER `searched`");
    }
    if (!isset($columns_known['placed_at_day'])) {
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `placed_at_day` int unsigned NOT NULL DEFAULT '0' AFTER `placed_by_pid`");
    }
    if (!isset($columns_known['ttl_days'])) {
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `ttl_days` smallint unsigned NOT NULL DEFAULT '0' AFTER `placed_at_day`");
    }

    // 3. 检查 idx_ttl_expiry 索引并补建
    $indexes_known = array();
    $idx_result = $db->query("SHOW INDEX FROM `{$table}`");
    if ($idx_result) {
        while ($idx_row = $db->fetch_array($idx_result)) {
            $indexes_known[$idx_row['Key_name']] = true;
        }
    }
    if (!isset($indexes_known['idx_ttl_expiry'])) {
        $db->query("ALTER TABLE `{$table}` ADD INDEX `idx_ttl_expiry` (`ttl_days`, `placed_at_day`)");
    }

    $ensured[$table] = true;
}

/**
 * oblmapitem 表 schema 自愈
 *
 * 检查字段：source_iaid（区分野生/POI 产出道具，wild_refresh / poi.dismantle 依赖）
 * 检查索引：idx_pgroup_pls_iaid_source / idx_iaid_source_iaid_pgroup_pls
 * 表结构定义：oblivions/sql/oblmapitem.sql
 */
function obl_mapitem_schema_ensure() {
    global $db, $tablepre;
    static $ensured = array();

    if (!isset($db) || !$db || !isset($tablepre)) return;
    $table = $tablepre . 'oblmapitem';
    if (isset($ensured[$table])) return;

    // 1. CREATE TABLE IF NOT EXISTS（仅核心字段，旧表不会被重建）
    $sql = "CREATE TABLE IF NOT EXISTS `{$table}` (
        `iid` mediumint unsigned NOT NULL AUTO_INCREMENT,
        `pgroup` tinyint unsigned NOT NULL DEFAULT '0',
        `pls` tinyint unsigned NOT NULL DEFAULT '0',
        `iaid` mediumint unsigned NOT NULL DEFAULT '0',
        `source_iaid` mediumint unsigned NOT NULL DEFAULT '0',
        `item_id` varchar(32) NOT NULL DEFAULT '',
        `itm` char(30) NOT NULL DEFAULT '',
        `itmk` char(40) NOT NULL DEFAULT '',
        `itme` int(10) unsigned NOT NULL DEFAULT '0',
        `itms` char(10) NOT NULL DEFAULT '0',
        `itmsk` char(40) NOT NULL DEFAULT '',
        `itmpara` text NOT NULL,
        `discovered` tinyint(1) unsigned NOT NULL DEFAULT '0',
        `fake_item_id` varchar(32) NOT NULL DEFAULT '',
        `is_trap` tinyint(1) unsigned NOT NULL DEFAULT '0',
        PRIMARY KEY (`iid`),
        INDEX `idx_pgroup_pls` (`pgroup`, `pls`),
        INDEX `idx_iaid` (`iaid`),
        INDEX `idx_pgroup_pls_iaid_source` (`pgroup`, `pls`, `iaid`, `source_iaid`),
        INDEX `idx_iaid_source_iaid_pgroup_pls` (`iaid`, `source_iaid`, `pgroup`, `pls`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    $db->query($sql);

    // 2. 检查 source_iaid 字段并补建（关键：wild_refresh 容量 COUNT 与 poi.dismantle 级联清理依赖此字段）
    $columns_known = array();
    $col_result = $db->query("SHOW COLUMNS FROM `{$table}`");
    if ($col_result) {
        while ($col_row = $db->fetch_array($col_result)) {
            $columns_known[$col_row['Field']] = true;
        }
    }
    if (!isset($columns_known['source_iaid'])) {
        $db->query("ALTER TABLE `{$table}` ADD COLUMN `source_iaid` mediumint unsigned NOT NULL DEFAULT '0' AFTER `iaid`");
    }

    // 3. 检查关键索引并补建
    $indexes_known = array();
    $idx_result = $db->query("SHOW INDEX FROM `{$table}`");
    if ($idx_result) {
        while ($idx_row = $db->fetch_array($idx_result)) {
            $indexes_known[$idx_row['Key_name']] = true;
        }
    }
    if (!isset($indexes_known['idx_pgroup_pls_iaid_source'])) {
        $db->query("ALTER TABLE `{$table}` ADD INDEX `idx_pgroup_pls_iaid_source` (`pgroup`, `pls`, `iaid`, `source_iaid`)");
    }
    if (!isset($indexes_known['idx_iaid_source_iaid_pgroup_pls'])) {
        $db->query("ALTER TABLE `{$table}` ADD INDEX `idx_iaid_source_iaid_pgroup_pls` (`iaid`, `source_iaid`, `pgroup`, `pls`)");
    }

    $ensured[$table] = true;
}

/**
 * Oblivions 运行时表 schema 自愈总入口
 *
 * 调用所有运行时表的 schema_ensure 函数。
 * 由 obl_runtime_boot() 在 is_oblivions 且非 state 路径时调用。
 * 各子函数内部 static $ensured 防重入，重复调用零开销。
 */
function obl_runtime_tables_schema_ensure() {
    if (!function_exists('obl_game_schema_ensure')) {
        // 理论上 obl_game_repository.php 已在 obl_bootstrap.php 第 0.5 层加载
        return;
    }
    obl_game_schema_ensure();
    obl_mapstates_schema_ensure();
    obl_mappoi_schema_ensure();
    obl_mapitem_schema_ensure();
}
