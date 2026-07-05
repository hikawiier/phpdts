<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 道具 Tag 系统 / Oblivions item Tag system
//
// 统一读取 item_table.tags 字段（含性质描述 Tag + 系统钩子 Tag）。
// 各系统按需过滤自己关心的 Tag ID，不依赖 category 区分。
//
// 相关文档：
// - 《道具使用与合成系统-设计案.md》§5.3
// - 《道具-系统钩子Tag设计案.md》
// ================================================================

/**
 * 读取 item_table（带静态缓存）
 * @return array
 */
function item_load_table() {
    static $table = null;
    if ($table === null) {
        $table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    }
    return $table;
}

/**
 * 读取道具的 Tag 列表（带静态缓存）
 *
 * @param string $item_id
 * @return array Tag ID 数组，道具不存在返回空数组
 */
function item_get_tags($item_id) {
    static $cache = [];
    $item_id = (string)$item_id;
    if (isset($cache[$item_id])) {
        return $cache[$item_id];
    }
    $table = item_load_table();
    $tags = isset($table[$item_id]['tags']) && is_array($table[$item_id]['tags'])
        ? $table[$item_id]['tags']
        : [];
    $cache[$item_id] = $tags;
    return $tags;
}

/**
 * 判断道具是否拥有某 Tag
 *
 * @param string $item_id
 * @param string $tag_id
 * @return bool
 */
function item_has_tag($item_id, $tag_id) {
    return in_array($tag_id, item_get_tags($item_id), true);
}

/**
 * 读取道具的 itmk 类别（带静态缓存）
 *
 * @param string $item_id
 * @return string itmk 值（如 'WP'/'MT'/'HH'），道具不存在返回空字符串
 */
function item_get_itmk($item_id) {
    static $cache = [];
    $item_id = (string)$item_id;
    if (isset($cache[$item_id])) {
        return $cache[$item_id];
    }
    $table = item_load_table();
    $itmk = isset($table[$item_id]['itmk']) ? (string)$table[$item_id]['itmk'] : '';
    $cache[$item_id] = $itmk;
    return $itmk;
}

/**
 * 读取道具的工具等级（带静态缓存）
 *
 * @param string $item_id
 * @return int 工具等级，非工具道具返回 0
 */
function item_get_tool_level($item_id) {
    static $cache = [];
    $item_id = (string)$item_id;
    if (isset($cache[$item_id])) {
        return $cache[$item_id];
    }
    $table = item_load_table();
    $level = isset($table[$item_id]['tool_level']) ? (int)$table[$item_id]['tool_level'] : 0;
    $cache[$item_id] = $level;
    return $level;
}

/**
 * 反向查询：拥有某 Tag 的所有道具
 *
 * @param string $tag_id
 * @return array item_id 数组
 */
function item_get_items_by_tag($tag_id) {
    static $cache = [];
    $tag_id = (string)$tag_id;
    if (isset($cache[$tag_id])) {
        return $cache[$tag_id];
    }
    $table = item_load_table();
    $result = [];
    foreach ($table as $id => $item) {
        if (isset($item['tags']) && is_array($item['tags']) && in_array($tag_id, $item['tags'], true)) {
            $result[] = $id;
        }
    }
    $cache[$tag_id] = $result;
    return $result;
}

