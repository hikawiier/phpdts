<?php
/**
 * @module E 游戏逻辑
 * @framework E-9 静态世界生成系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 野生道具时间流逝刷新 / Wild item refresh over time
//
// 由 tick 调度的 post phase 监听器触发，每 N tick 全局扫描所有
// "已发现过"的图格（fog=1 OR last_refresh_turn>0），按潮汐倍率
// 与 scatter_pool['refresh'] 相位 rate 判定是否生成新道具。
//
// 容量计数采用批量 COUNT 方案（R3 决策）：一次 SQL 查询所有图格
// 当前野生道具数（WHERE iaid=0 AND source_iaid=0），不维护冗余
// 计数字段。POI 产出道具（source_iaid>0）被天然过滤，不计入容量。
//
// 多 tick 推进时监听器按 delta 循环触发，per-tile 的 last_refresh_turn
// 检查确保同一格在一次 delta 批处理内最多被刷新一次。
//
// 设计文档：oblivions/docs/搜索建筑物与掉落机制重构-模块E-探索与搜刮.md §三 E-9
// ================================================================

/**
 * 野生道具时间流逝刷新（全局批量执行）
 *
 * 流程：
 *   1. 读配置（interval/capacity/tide_multiplier）；interval<=0 直接返回
 *   2. 批量 COUNT 查询所有图格当前野生道具数（WHERE iaid=0 AND source_iaid=0）
 *   3. 查询所有"已发现过"的图格（fog=1 OR last_refresh_turn>0）
 *   4. 按 pgroup 加载 tiles 数据，读取每格 tide
 *   5. 遍历每个图格：容量检查 → 间隔检查 → 按 tide × refresh rate 判定 → INSERT
 *   6. 批量 INSERT 新道具（每批 500 条，字段列表与 obl_generate_wild_items 一致）
 *   7. 批量 UPDATE oblmapstates.last_refresh_turn / refresh_count
 *
 * @param int $current_turn 本次刷新所对应的 tick（由监听器循环传入历史 tick）
 * @return void
 * @global object $db
 * @global string $tablepre
 */
function obl_refresh_wild_items($current_turn) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return;
    $current_turn = (int)$current_turn;

    // 静态缓存配置与数据池（同请求内多次调用零开销）
    static $cfg = null, $scatter_pool = null, $item_table = null;
    if ($cfg === null) {
        $cfg          = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $scatter_pool = include GAME_ROOT . './oblivions/gamedata/scatter_pool.php';
        $item_table   = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    }

    $interval = isset($cfg['wild_item_refresh_interval_ticks']) ? (int)$cfg['wild_item_refresh_interval_ticks'] : 100;
    if ($interval <= 0) return;  // 0=不刷新

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

    // 3. 查询所有"已发现过"的图格
    $result = $db->query("SELECT pgroup, pls, last_refresh_turn
                          FROM {$tablepre}oblmapstates
                          WHERE fog=1 OR last_refresh_turn>0");
    if (!$result) return;

    // 按 pgroup 分组收集图格
    $tiles_by_pgroup = array();  // pgroup => [['pls'=>..., 'last_refresh_turn'=>...], ...]
    while ($row = $db->fetch_array($result)) {
        $pg = (int)$row['pgroup'];
        $pl = (int)$row['pls'];
        $lrt = (int)$row['last_refresh_turn'];
        $tiles_by_pgroup[$pg][] = array('pls' => $pl, 'last_refresh_turn' => $lrt);
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
            $last_refresh = (int)$tile_info['last_refresh_turn'];

            // 容量检查
            $cnt = isset($cnt_map[$pgroup][$pls]) ? $cnt_map[$pgroup][$pls] : 0;
            if ($cnt >= $capacity) continue;

            // 刷新间隔检查（per-tile 双重保险，避免 delta 循环内重复刷新）
            if ($last_refresh > 0 && ($current_turn - $last_refresh) < $interval) continue;

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

    // 7. 批量 UPDATE oblmapstates.last_refresh_turn / refresh_count（按 pgroup 分组，主键前缀扫描）
    foreach ($refreshed_by_pgroup as $pgroup => $pls_list) {
        $pgroup = (int)$pgroup;
        if (empty($pls_list)) continue;
        $pls_in = implode(',', array_map('intval', $pls_list));
        $qry = "UPDATE {$tablepre}oblmapstates
                SET last_refresh_turn = $current_turn,
                    refresh_count = refresh_count + 1
                WHERE pgroup = $pgroup AND pls IN ($pls_in)";
        $db->query($qry);
    }
}

/**
 * tick post phase 监听器：野生道具刷新
 *
 * 按 delta 循环遍历历史 tick，对每个满足 t % interval == 0 的 tick
 * 调用 obl_refresh_wild_items($t)。多 tick 推进时避免跳过刷新。
 *
 * 监听器签名：function(int $delta, array &$ctx): void
 * - $delta：待处理的 tick 差值（obl_tick - obl_pretick 同步前的值）
 * - $ctx：调度上下文（引用传递，本监听器不修改 ctx）
 *
 * delta=1 时退化为单次 current % interval == 0 检查；
 * delta=250、interval=100 时循环触发 tick=100/200 两次（current%100≠0 不触发）。
 *
 * @param int   $delta 待处理的 tick 差值
 * @param array &$ctx  调度上下文（引用传递）
 * @return void
 */
function obl_tick_phase_refresh_wild_items($delta, &$ctx) {
    $delta = (int)$delta;
    if ($delta <= 0) return;

    // 静态缓存 interval 配置
    static $interval = null;
    if ($interval === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $interval = isset($cfg['wild_item_refresh_interval_ticks']) ? (int)$cfg['wild_item_refresh_interval_ticks'] : 100;
    }
    if ($interval <= 0) return;  // 0=不刷新

    $current = obl_tick_get();
    $start = $current - $delta + 1;
    if ($start < 0) $start = 0;

    for ($t = $start; $t <= $current; $t++) {
        if ($t % $interval === 0) {
            obl_refresh_wild_items($t);
        }
    }
}
