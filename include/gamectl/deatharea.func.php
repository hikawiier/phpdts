<?php

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * ============================================================
 * 禁区系统功能函数 / Death Area System Functions
 * ============================================================
 * 
 * 核心设计：
 *   $arealist — 所有区域编号的随机排列（禁区出现顺序）
 *   $areanum  — 当前禁区指针，$arealist[0]~$arealist[$areanum] 为禁区
 *   判断禁区：array_search($area_id, $arealist) <= $areanum
 *   $hack     — 禁区解除标志，为 1 时所有禁区视为安全区
 * 
 * 本文件统一封装所有禁区相关的判断与操作，避免重复代码。
 * 在 common.inc.php 中 system.func.php 之后加载，全项目可用。
 * ============================================================
 */

/**
 * 判断指定区域是否为禁区
 * Check if a specific area is currently a death area
 * 
 * @param int $area_id 区域编号 / Area ID
 * @return bool true = 是禁区且未解除 / is death area and not hacked
 * 
 * 使用示例：
 *   if (is_death_area($pls)) { ... }
 * 
 * 替换原表达式：array_search($area_id, $arealist) <= $areanum && !$hack
 */
function is_death_area($area_id) {
    global $arealist, $areanum, $hack;
    return !$hack && array_search($area_id, $arealist) <= $areanum;
}

/**
 * 判断指定区域是否为安全区（非禁区或被 hack 解除）
 * Check if a specific area is currently safe (not a death area, or hack is active)
 * 
 * @param int $area_id 区域编号 / Area ID
 * @return bool true = 安全区 / is safe area
 * 
 * 使用示例：
 *   if (is_safe_area($pls)) { ... }
 * 
 * 替换原表达式：array_search($area_id, $arealist) > $areanum || $hack
 */
function is_safe_area($area_id) {
    global $arealist, $areanum, $hack;
    return $hack || array_search($area_id, $arealist) > $areanum;
}

/**
 * 获取当前所有禁区列表
 * Get the list of all current death areas
 * 
 * @return array 当前禁区编号数组 / Array of death area IDs (index 0 to $areanum)
 * 
 * 使用示例：
 *   $death_areas = get_death_areas();  // [0, 12, 5, 8, ...]
 * 
 * 替换原表达式：array_slice($arealist, 0, $areanum + 1)
 */
function get_death_areas() {
    global $arealist, $areanum;
    return array_slice($arealist, 0, $areanum + 1);
}

/**
 * 获取当前所有安全区列表
 * Get the list of all current safe areas (non-death areas)
 * 
 * 当 $hack 激活时，所有区域均视为安全区。
 * When hack is active, all areas are considered safe.
 * 
 * @return array 安全区编号数组 / Array of safe area IDs
 * 
 * 使用示例：
 *   $safe_areas = get_safe_areas();
 * 
 * 替换原表达式：$hack ? $arealist : array_slice($arealist, $areanum + 1)
 */
function get_safe_areas() {
    global $arealist, $areanum, $hack;
    return $hack ? $arealist : array_slice($arealist, $areanum + 1);
}

/**
 * 获取下一批将要成为禁区的区域列表
 * Get the list of areas that will become death areas in the next batch
 * 
 * @param int $batch 第几批（0 = 下一批，1 = 下下批，以此类推）
 * @param bool $exact_count 是否精确数量。false = 剩余不足时返回全部（用于最后一批边界）
 * @return array 下一批禁区编号数组
 * 
 * 使用示例：
 *   $next = get_next_death_areas();           // 下一批，精确 $areaadd 个
 *   $next = get_next_death_areas(0, false);   // 下一批，剩余不足时返回全部
 * 
 * 替换：
 *   array_slice($arealist, $areanum+1+$areaadd*$batch, $areaadd) → get_next_death_areas($batch)
 *   array_slice($arealist, $areanum+1)                        → get_next_death_areas(0, false)
 */
function get_next_death_areas($batch = 0, $exact_count = true) {
    global $arealist, $areanum, $areaadd;
    $offset = $areanum + 1 + $areaadd * $batch;
    $length = $exact_count ? $areaadd : null;
    return array_slice($arealist, $offset, $length);
}

/**
 * 获取当前禁区 + 未来 N 批的合并区域列表（管理后台专用）
 * 
 * @param int $extra_batches 额外追加批数，默认 1
 * @return array 合并后的区域编号数组
 * 
 * 替换：array_slice($arealist, 0, $areanum + $areaadd) → get_death_areas_with_future()
 */
function get_death_areas_with_future($extra_batches = 1) {
    global $arealist, $areanum, $areaadd;
    return array_slice($arealist, 0, $areanum + $extra_batches * $areaadd);
}

/**
 * 获取安全区列表（排除深渊等危险区域）
 * Get safe areas list, optionally excluding deep zones (dangerous areas)
 * 
 * 这是对原有 get_safe_plslist() 的增强封装，语义更清晰。
 * Enhanced wrapper for the original get_safe_plslist() with clearer semantics.
 * 
 * @param bool $exclude_danger_areas 是否排除深渊等危险区域 / Whether to exclude danger zones
 * @return array 安全区编号数组 / Array of safe area IDs
 * 
 * 使用示例：
 *   $safe = get_safe_areas_ex();        // 安全区（排除危险区）
 *   $safe = get_safe_areas_ex(false);   // 安全区（含危险区）
 */
function get_safe_areas_ex($exclude_danger_areas = true) {
    global $hack, $arealist, $areanum, $danger_areas;
    $r = $hack ? $arealist : array_slice($arealist, $areanum + 1);
    if ($exclude_danger_areas) {
        $r = array_diff($r, $danger_areas);
    }
    return $r;
}

/**
 * 获取禁区相关的玩家可见展示信息
 * Get death area display info for the player (areainfo template data)
 * 
 * 生成"现在的禁区"和"下回禁区"的展示数据，供模板使用。
 * Generates display data for "current death areas" and "upcoming death areas".
 * 
 * @return string 格式化的禁区信息 HTML / Formatted death area info HTML
 * 
 * 此函数重构自 movehtm()，将其从直接输出改为返回数据。
 */
function get_areainfo_html() {
    global $plsinfo, $arealist, $areanum, $areaadd, $areatime, $areahour;

    $areadata = '';
    $plsnum = count($plsinfo);

    // 检查是否还有区域可以添加为禁区
    if ($areanum >= $plsnum - 1) {
        return $areadata;
    }

    // 生成未来三批禁区信息（最多三批）
    for ($batch = 0; $batch < 3; $batch++) {
        $batch_offset = $areanum + 1 + $areaadd * $batch;
        if ($batch_offset >= $plsnum) {
            break;
        }

        $at = getdate($areatime + $areahour * 60 * $batch);
        $nexthour = $at['hours'];
        $nextmin = $at['minutes'];
        while ($nextmin >= 60) {
            $nexthour += 1;
            $nextmin -= 60;
        }
        if ($nexthour >= 24) {
            $nexthour -= 24;
        }

        // 分隔符：第一批用空，后续用 "；"
        if ($batch > 0) {
            $areadata .= "；";
        }

        $areadata .= "<b>{$nexthour}时{$nextmin}分：</b> ";
        for ($i = 1; $i <= $areaadd; $i++) {
            $idx = $areanum + $areaadd * $batch + $i;
            if (!isset($arealist[$idx]) || !isset($plsinfo[$arealist[$idx]])) {
                break;
            }
            $areadata .= '&nbsp;' . $plsinfo[$arealist[$idx]] . '&nbsp;';
        }
    }

    return $areadata;
}

/**
 * 获取禁区总数（索引上限）
 * Get the total number of death areas (the index of the last death area)
 * 
 * @return int 禁区总数上限 / Total death area count (upper bound index)
 */
function get_death_area_count() {
    global $areanum;
    return $areanum;
}

/**
 * 获取禁区每次增加的数量
 * Get the number of areas added per batch
 * 
 * @return int 每次增加数量 / Areas added per batch
 */
function get_area_add_count() {
    global $areaadd;
    return $areaadd;
}

/**
 * 获取禁区是否已被 hack 解除
 * Check if death areas are currently hacked (all areas safe)
 * 
 * @return bool true = 禁区已解除 / Death areas are hacked
 */
function is_hack_active() {
    global $hack;
    return (bool)$hack;
}

/**
 * 获取下一个禁区到来的时间戳
 * Get the timestamp of the next death area addition
 * 
 * @return int Unix 时间戳 / Unix timestamp
 */
function get_next_area_time() {
    global $areatime;
    return $areatime;
}

/**
 * 判断指定区域是否为危险区（NPC 会躲避的区域，如深渊、SCP等）
 * Check if a specific area is a danger zone (areas NPCs avoid, e.g. abyss, SCP, etc.)
 * 
 * 注意：危险区 ≠ 禁区。危险区是 NPC 不会进入的区域，但玩家可以正常进入。
 * Note: danger areas ≠ death areas. NPCs avoid danger areas, but players can enter them.
 * 
 * @param int $area_id 区域编号
 * @return bool true = 是危险区
 */
function is_danger_area($area_id) {
    global $danger_areas;
    return in_array($area_id, $danger_areas);
}

/**
 * 判断指定区域是否为特殊事件区域（具有独立脚本事件的区域，如英灵殿）
 * Check if a specific area is a special event area (area with scripted events, e.g. Valhalla)
 * 
 * 特殊事件区域：玩家移动到这些区域时会触发特殊事件脚本，而非通用探索逻辑。
 * Special event areas: moving to these areas triggers special event scripts instead of generic exploration.
 * 
 * @param int $area_id 区域编号
 * @return bool true = 是特殊事件区域
 * 
 * 替换原表达式：$pls == 34 / $rmap == 34 / $rpls == 34
 */
function is_event_area($area_id) {
    global $event_areas;
    return isset($event_areas) ? in_array($area_id, $event_areas) : 0 ;
}

?>