<?php
/**
 * @module E 游戏逻辑
 * @framework E-9 静态世界生成系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 野生道具按天刷新 / Wild item refresh per day
//
// 由 E-11 天与昼夜相位派生层的 day_changed 事件触发，
// 每当天数递增时全局扫描所有"已发现过"的图格（fog=1 OR
// last_refresh_day>0），按潮汐倍率与 scatter_pool['refresh']
// 相位 rate 判定是否生成新道具。
//
// 容量计数采用批量 COUNT 方案（R3 决策）：一次 SQL 查询所有图格
// 当前野生道具数（WHERE iaid=0 AND source_iaid=0），不维护冗余
// 计数字段。POI 产出道具（source_iaid>0）被天然过滤，不计入容量。
//
// per-tile 容量保护：last_refresh_day 字段记录上次刷新的天数，
// 确保同一格在同一天内最多被刷新一次。
//
// 设计文档：oblivions/docs/搜索建筑物与掉落机制重构-模块E-探索与搜刮.md §三 E-9
// 改造依据：oblivions/docs/天数与昼夜系统-设计案.md §五
// ================================================================

/**
 * 野生道具按天刷新（全局批量执行，day_changed 事件监听器）
 *
 * 监听器签名：function(array $transition): void
 *   $transition = [
 *     'from' => ['day' => N,   'phase' => 'day'|'night'],
 *     'to'   => ['day' => N+1, 'phase' => 'day'|'night'],
 *     'tick' => T,
 *   ]
 *
 * 流程：
 *   1. 解析 $transition['to']['day'] 为当前天数
 *   2. 读配置（capacity/tide_multiplier）；mode != 'daily' 直接返回
 *   3. 批量 COUNT 查询所有图格当前野生道具数（WHERE iaid=0 AND source_iaid=0）
 *   4. 查询所有"已发现过"且 last_refresh_day < 当前天数的图格
 *   5. 按 pgroup 加载 tiles 数据，读取每格 tide
 *   6. 遍历每个图格：容量检查 → 按 tide × refresh rate 判定 → INSERT
 *   7. 批量 INSERT 新道具（每批 500 条，字段列表与 obl_generate_wild_items 一致）
 *   8. 批量 UPDATE oblmapstates.last_refresh_day / refresh_count
 *
 * @param array $transition day_changed 事件 transition 结构
 * @return void
 * @global object $db
 * @global string $tablepre
 */
function obl_refresh_wild_items(array $transition) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return;

    $current_day = isset($transition['to']['day']) ? (int)$transition['to']['day'] : 0;
    if ($current_day <= 0) return;

    // 静态缓存配置与数据池（同请求内多次调用零开销）
    static $cfg = null, $scatter_pool = null, $item_table = null;
    if ($cfg === null) {
        $cfg          = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $scatter_pool = include GAME_ROOT . './oblivions/gamedata/scatter_pool.php';
        $item_table   = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    }

    // 刷新模式校验：仅 'daily' 模式启用按天刷新
    $mode = isset($cfg['wild_item_refresh_mode']) ? (string)$cfg['wild_item_refresh_mode'] : 'daily';
    if ($mode !== 'daily') return;

    $capacity  = isset($cfg['wild_item_capacity_per_tile']) ? (int)$cfg['wild_item_capacity_per_tile'] : 5;
    $tide_rate = isset($cfg['wild_item_refresh_rate_by_tide']) && is_array($cfg['wild_item_refresh_rate_by_tide'])
        ? $cfg['wild_item_refresh_rate_by_tide'] : array();

    // 2. 批量 COUNT 查询所有图格当前野生道具数
    // WHERE iaid=0 AND source_iaid=0：过滤掉 POI 产出道具（source_iaid>0）
    $cnt_map = array();  // cnt_map[pgroup][pls] = cnt
    $result = $db->query("SELECT pgroup, pls, COUNT(*) AS cnt
                          FROM {$tablepre}oblmapitem
                          WHERE iaid=0 AND source_iaid=0
                          GROUP BY pgroup, pls");
    if ($result) {
        while ($row = $db->fetch_array($result)) {
            $pg = (int)$row['pgroup'];
            $pl = (int)$row['pls'];
            $cnt_map[$pg][$pl] = (int)$row['cnt'];
        }
    }

    // 3. 查询所有"已发现过"且本天未刷新的图格
    $result = $db->query("SELECT pgroup, pls, last_refresh_day
                          FROM {$tablepre}oblmapstates
                          WHERE (fog=1 OR last_refresh_day>0)
                            AND last_refresh_day < {$current_day}");
    if (!$result) return;

    // 按 pgroup 分组收集图格
    $tiles_by_pgroup = array();  // pgroup => [['pls'=>..., 'last_refresh_day'=>...], ...]
    while ($row = $db->fetch_array($result)) {
        $pg = (int)$row['pgroup'];
        $pl = (int)$row['pls'];
        $lrd = (int)$row['last_refresh_day'];
        $tiles_by_pgroup[$pg][] = array('pls' => $pl, 'last_refresh_day' => $lrd);
    }
    if (empty($tiles_by_pgroup)) return;

    $insert_values = array();
    $refreshed_by_pgroup = array();  // pgroup => [pls, pls, ...]

    // 5. 遍历每个图格
    foreach ($tiles_by_pgroup as $pgroup => $tile_list) {
        $pgroup = (int)$pgroup;

        // 4. 加载该区域 tiles（懒加载缓存，同区域多次调用零开销）
        $map = obl_get_map_data($pgroup);
        $tiles = isset($map['tiles'][$pgroup]) ? $map['tiles'][$pgroup] : array();
        if (empty($tiles)) continue;  // tile 文件不存在，跳过该区域所有格

        foreach ($tile_list as $tile_info) {
            $pls = (int)$tile_info['pls'];

            // 容量检查
            $cnt = isset($cnt_map[$pgroup][$pls]) ? (int)$cnt_map[$pgroup][$pls] : 0;
            if ($cnt >= $capacity) continue;

            // 读取 tile 的 tide
            if (!isset($tiles[$pls])) continue;  // tile 不存在
            $tide = isset($tiles[$pls]['tide']) ? $tiles[$pls]['tide'] : 'shallow';
            if (!isset($scatter_pool[$tide]['refresh']) || !is_array($scatter_pool[$tide]['refresh'])) {
                continue;  // refresh 相位缺失，跳过该 tide 桶
            }

            // 潮汐倍率（越危险越丰沛）
            $mult = isset($tide_rate[$tide]) ? (float)$tide_rate[$tide] : 1.0;

            $refreshed = false;

            // 逐条按 rate * mult 概率判定
            foreach ($scatter_pool[$tide]['refresh'] as $cfg_entry) {
                $item_id = isset($cfg_entry['item_id']) ? (string)$cfg_entry['item_id'] : '';
                if ($item_id === '' || !isset($item_table[$item_id])) continue;

                $rate = isset($cfg_entry['rate']) ? (float)$cfg_entry['rate'] : 0;
                if ($rate <= 0) continue;
                $eff_rate = $rate * $mult;
                if ($eff_rate > 1.0) $eff_rate = 1.0;  // clamp 到 [0,1]

                // count 处理（与 obl_generate_wild_items 一致：单值或 [min,max] 区间）
                $count = isset($cfg_entry['count']) ? $cfg_entry['count'] : 1;
                if (is_array($count)) {
                    $lo = isset($count[0]) ? (int)$count[0] : 1;
                    $hi = isset($count[1]) ? (int)$count[1] : $lo;
                    if ($hi < $lo) { $tmp = $lo; $lo = $hi; $hi = $tmp; }
                } else {
                    $lo = $hi = (int)$count;
                }

                // 容量上限内才生成（避免一次刷新超过容量）
                if ($cnt >= $capacity) break;

                // rate 概率生成（与 obl_generate_wild_items 同一判定模式）
                if (mt_rand() / mt_getrandmax() > $eff_rate) continue;

                $n = ($lo === $hi) ? $lo : rand($lo, $hi);
                for ($i = 0; $i < $n; $i++) {
                    if ($cnt >= $capacity) break;  // 容量保护

                    $template = $item_table[$item_id];
                    // 模板名称属于前端 locale；实例 itm 只保留自定义名称（空）
                    $itm     = '';
                    $itmk    = $db->escape_string((string)$template['itmk']);
                    $itme    = (int)$template['itme'];
                    $itms    = $db->escape_string((string)$template['itms']);
                    $itmsk   = $db->escape_string((string)$template['itmsk']);
                    $itmpara = $db->escape_string((string)$template['itmpara']);
                    $item_id_e = $db->escape_string($item_id);

                    // INSERT 字段列表与 obl_generate_wild_items 完全一致
                    // source_iaid 取默认值 0（野生来源，无需显式写）
                    $insert_values[] = "($pgroup, $pls, 0, '$item_id_e', '$itm', '$itmk', $itme, '$itms', '$itmsk', '$itmpara', 0, '', 0)";
                    $cnt++;  // 内存中同步容量计数
                    $refreshed = true;
                }
            }

            if ($refreshed) {
                $refreshed_by_pgroup[$pgroup][] = $pls;
            }
        }
    }

    // 6. 批量 INSERT 新道具（每批 500 条）
    if (!empty($insert_values)) {
        foreach (array_chunk($insert_values, 500) as $batch) {
            $qry = "INSERT INTO {$tablepre}oblmapitem
                    (pgroup, pls, iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara, discovered, fake_item_id, is_trap)
                    VALUES " . implode(',', $batch);
            $db->query($qry);
        }
    }

    // 7. 批量 UPDATE oblmapstates.last_refresh_day / refresh_count（按 pgroup 分组，主键前缀扫描）
    foreach ($refreshed_by_pgroup as $pgroup => $pls_list) {
        $pgroup = (int)$pgroup;
        if (empty($pls_list)) continue;
        $pls_in = implode(',', array_map('intval', $pls_list));
        $qry = "UPDATE {$tablepre}oblmapstates
                SET last_refresh_day = $current_day,
                    refresh_count = refresh_count + 1
                WHERE pgroup = $pgroup AND pls IN ($pls_in)";
        $db->query($qry);
    }
}
