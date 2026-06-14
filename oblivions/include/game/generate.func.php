<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 资源生成函数库 / Oblivions resource generation
//
// 由 rs_init_oblivions() 按需 include，仅在 OBLIVIONS 模式加载。
// tiles 数据结构：tiles/region_{pgroup}.php 返回 [pls => tile]
// 每个 tile 含 tide(潮汐区)/passable(可通行)/neighbors/x/y 等字段。
// 同一区域内 tile 的 tide 可能不同，因此按 tide 桶分组生成。
// ================================================================

/**
 * 为指定区域生成全部资源（入口函数）
 *
 * 协调该区域的 POI 与野生散落道具生成。后续可扩展敌人/事件点生成。
 *
 * @param int   $pgroup 区域 ID
 * @param array $tiles  tiles/region_{pgroup}.php 返回的 [pls => tile] 数据
 * @param array $cfg    配置包，含 poi_pool/poi_table/item_table/scatter_pool
 * @return void
 */
function obl_generate_region_items($pgroup, $tiles, $cfg) {
    $pgroup = (int)$pgroup;

    // 1. POI 实例（宝箱/图腾/地标等）
    if (!empty($cfg['poi_pool']) && !empty($cfg['poi_table'])) {
        obl_generate_region_pois($pgroup, $tiles, $cfg['poi_pool'], $cfg['poi_table']);
    }

    // 2. 野生散落道具
    if (!empty($cfg['scatter_pool']) && !empty($cfg['item_table'])) {
        obl_generate_wild_items($pgroup, $tiles, $cfg['scatter_pool'], $cfg['item_table']);
    }

    // 预留：obl_generate_region_enemies($pgroup, $tiles, ...)
    // 预留：obl_generate_region_events($pgroup, $tiles, ...)
}

/**
 * 为指定区域生成 POI 实例
 *
 * 按 tile 的 tide 分桶，每个潮汐区独立按 poi_pool 配置的数量在可通行格上放置 POI。
 * 每个可通行格最多放置一个 POI（occupied 集合去重）。
 *
 * @param int   $pgroup    区域 ID
 * @param array $tiles     [pls => tile]
 * @param array $poi_pool  poi_pool.php 返回的 [tide => [cfg...]]
 * @param array $poi_table poi_table.php 返回的 [poi_id => template]
 * @global object $db
 * @global string $tablepre
 * @return void
 */
function obl_generate_region_pois($pgroup, $tiles, $poi_pool, $poi_table) {
    global $db, $tablepre;
    $pgroup = (int)$pgroup;

    // 1. 按 tide 分桶，仅保留可通行格
    $by_tide = array();  // tide => [pls, pls, ...]
    foreach ($tiles as $pls => $tile) {
        if (empty($tile['passable'])) continue;
        $tide = isset($tile['tide']) ? $tile['tide'] : 'shallow';
        $by_tide[$tide][] = (int)$pls;
    }
    if (empty($by_tide)) return;

    $occupied = array();  // 该区域内已放置 POI 的 pls
    $values   = array();

    // 2. 逐 tide 桶、逐 POI 配置生成
    foreach ($by_tide as $tide => $grid_list) {
        if (!isset($poi_pool[$tide]) || !is_array($poi_pool[$tide])) continue;

        foreach ($poi_pool[$tide] as $cfg) {
            // 校验 POI 模板存在
            $poi_id = isset($cfg['poi_id']) ? (string)$cfg['poi_id'] : '';
            if ($poi_id === '' || !isset($poi_table[$poi_id])) continue;

            $count = isset($cfg['per_region']) ? (int)$cfg['per_region'] : 0;
            if ($count <= 0) continue;

            // 排除该区域已占用的格
            $available = array_values(array_diff($grid_list, $occupied));
            if (count($available) < $count) {
                $count = count($available);
            }
            if ($count <= 0) continue;

            // 随机选择 N 个格（array_rand 数量>1 时返回数组，=1 时返回 key 本身）
            $selected = array_rand(array_flip($available), $count);
            if (!is_array($selected)) {
                $selected = array($selected);
            }

            foreach ($selected as $pls) {
                $pls = (int)$pls;
                $poi_id_esc = $db->escape_string($poi_id);
                $values[] = "($pgroup, $pls, '$poi_id_esc', 0, 0, 0)";
                $occupied[] = $pls;
            }
        }
    }

    // 3. 批量插入
    if (!empty($values)) {
        foreach (array_chunk($values, 500) as $batch) {
            $qry = "INSERT INTO {$tablepre}oblmappoi
                    (pgroup, pls, poi_id, searched, search_count, last_search_turn)
                    VALUES " . implode(',', $batch);
            $db->query($qry);
        }
    }
}

/**
 * 为指定区域生成野生散落道具
 *
 * 按 tile 的 tide 分桶，每个可通行格独立判定是否生成某道具（rate 概率）。
 * 生成的道具 iaid=0（非 POI 来源），discovered=0（迷雾中不可见）。
 *
 * @param int   $pgroup      区域 ID
 * @param array $tiles       [pls => tile]
 * @param array $scatter_pool scatter_pool.php 返回的 [tide => [cfg...]]
 * @param array $item_table  item_table.php 返回的 [item_id => template]
 * @global object $db
 * @global string $tablepre
 * @return void
 */
function obl_generate_wild_items($pgroup, $tiles, $scatter_pool, $item_table) {
    global $db, $tablepre;
    $pgroup = (int)$pgroup;

    // 1. 按 tide 分桶，仅保留可通行格
    $by_tide = array();  // tide => [pls, pls, ...]
    foreach ($tiles as $pls => $tile) {
        if (empty($tile['passable'])) continue;
        $tide = isset($tile['tide']) ? $tile['tide'] : 'shallow';
        $by_tide[$tide][] = (int)$pls;
    }
    if (empty($by_tide)) return;

    $values = array();

    // 2. 逐 tide 桶、逐道具配置生成
    foreach ($by_tide as $tide => $grid_list) {
        if (!isset($scatter_pool[$tide]) || !is_array($scatter_pool[$tide])) continue;

        foreach ($scatter_pool[$tide] as $cfg) {
            $item_id = isset($cfg['item_id']) ? (string)$cfg['item_id'] : '';
            if ($item_id === '' || !isset($item_table[$item_id])) continue;

            $rate = isset($cfg['rate']) ? (float)$cfg['rate'] : 0;
            if ($rate <= 0) continue;

            // count 可以是单值或 [min,max] 区间
            $count = isset($cfg['count']) ? $cfg['count'] : 1;
            if (is_array($count)) {
                $lo = isset($count[0]) ? (int)$count[0] : 1;
                $hi = isset($count[1]) ? (int)$count[1] : $lo;
                if ($hi < $lo) { $tmp = $lo; $lo = $hi; $hi = $tmp; }
            } else {
                $lo = $hi = (int)$count;
            }

            // 每个格独立判定
            foreach ($grid_list as $pls) {
                // rate 概率生成；count>1 时生成多份（每份独立判定或一次生成多份？此处按"每格独立判定×生成数量"）
                // 设计意图：rate 是"该格出现此道具的概率"，count 是"出现时生成的数量"
                if (mt_rand() / mt_getrandmax() > $rate) continue;

                $n = ($lo === $hi) ? $lo : rand($lo, $hi);
                for ($i = 0; $i < $n; $i++) {
                    $template = $item_table[$item_id];
                    $itm     = $db->escape_string((string)$template['itm']);
                    $itmk    = $db->escape_string((string)$template['itmk']);
                    $itme    = (int)$template['itme'];
                    $itms    = $db->escape_string((string)$template['itms']);
                    $itmsk   = $db->escape_string((string)$template['itmsk']);
                    $itmpara = $db->escape_string((string)$template['itmpara']);

                    $values[] = "($pgroup, $pls, 0, '$item_id', '$itm', '$itmk', $itme, '$itms', '$itmsk', '$itmpara', 0, '', 0)";
                }
            }
        }
    }

    // 3. 批量插入，每批 500 条
    if (!empty($values)) {
        foreach (array_chunk($values, 500) as $batch) {
            $qry = "INSERT INTO {$tablepre}oblmapitem
                    (pgroup, pls, iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara, discovered, fake_item_id, is_trap)
                    VALUES " . implode(',', $batch);
            $db->query($qry);
        }
    }
}
