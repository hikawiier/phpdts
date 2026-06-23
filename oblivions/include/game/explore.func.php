<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 探索与交互系统 / Oblivions exploration & interaction
//
// 实现探索、搜索、拾取、丢弃全链路，打通玩家与世界的核心交互闭环。
// 迷雾（fog）与道具发现（discovered）是两个独立关注点：
//   - fog (oblmapstates.fog)：地图格可见性（玩家是否知道该格存在/地形/可通行）
//   - discovered (oblmapitem.discovered)：道具可操作性（道具是否出现在交互界面）
// ================================================================

// 依赖 move.func.php 的 obl_get_map_data()
if (!function_exists('obl_get_map_data')) {
    include_once GAME_ROOT . './oblivions/include/game/move.func.php';
}

// ----------------------------------------------------------------
// 配置读取辅助
// ----------------------------------------------------------------

/**
 * 读取 Oblivions 配置（带静态缓存）
 * @return array
 */
function obl_get_config() {
    static $cfg = null;
    if ($cfg === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
    }
    return $cfg;
}

// ----------------------------------------------------------------
// 4.1 视野更新入口
// ----------------------------------------------------------------

/**
 * 视野更新入口：点亮迷雾 + 发现道具
 * 由移动后钩子、原地探索命令、或玩家出生点调用
 *
 * @param int   $pgroup 当前区域
 * @param int   $pls    当前格
 * @param array &$pdata 玩家数据（预留：读取视野等级等加成）
 */
function obl_update_vision($pgroup, $pls, &$pdata) {
    // 计算视野范围（BFS）
    $visible_tiles = obl_calc_vision_range($pgroup, $pls, $pdata);

    // 子功能 1：点亮迷雾（地图格可见性）
    obl_clear_fog($pgroup, $visible_tiles);

    // 子功能 2：发现道具（道具可操作性）
    obl_discover_items($pgroup, $visible_tiles);
}

// ----------------------------------------------------------------
// 4.1a 视野范围计算
// ----------------------------------------------------------------

/**
 * 计算玩家视野范围内的所有格及其距离
 *
 * @param int   $pgroup 当前区域
 * @param int   $pls    当前格
 * @param array &$pdata 玩家数据（预留：技能/装备加成覆盖 vision_range）
 * @return array [pls => ['distance' => int]]，空数组表示当前格无效
 */
function obl_calc_vision_range($pgroup, $pls, &$pdata) {
    $cfg = obl_get_config();
    $vision_lv = (int)($cfg['vision_range'] ?? 1);

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? [];
    if (!isset($tiles[$pls])) return [];

    $visible_tiles = [$pls => ['distance' => 0]];

    // BFS 扩展视野
    $visited = [$pls => true];
    $queue = [[$pls, 0]];
    while (!empty($queue)) {
        $frame = array_shift($queue);
        $cur = $frame[0];
        $dist = $frame[1];
        if ($dist >= $vision_lv) continue;

        $neighbors = $tiles[$cur]['neighbors'] ?? [];
        foreach ($neighbors as $n_pls) {
            if (isset($visited[$n_pls])) continue;
            $visited[$n_pls] = true;
            $visible_tiles[$n_pls] = ['distance' => $dist + 1];
            // 不可通行格可见但不再继续扩展（不能站在山上看到更远的地方）
            if (empty($tiles[$n_pls]['passable'])) continue;
            $queue[] = [$n_pls, $dist + 1];
        }
    }

    return $visible_tiles;
}

// ----------------------------------------------------------------
// 4.1b 迷雾点亮
// ----------------------------------------------------------------

/**
 * 点亮视野范围内所有格的迷雾
 * 迷雾清除后，该格上的 POI 自动可见（POI 无 discovered 字段）
 *
 * @param int   $pgroup       当前区域
 * @param array $visible_tiles [pls => ['distance' => int]]
 */
function obl_clear_fog($pgroup, $visible_tiles) {
    global $db, $tablepre;

    if (empty($visible_tiles)) return;

    $pgroup_i = (int)$pgroup;
    $fog_values = [];
    foreach ($visible_tiles as $t_pls => $info) {
        $t_pls = (int)$t_pls;
        $fog_values[] = "($pgroup_i, $t_pls, 1, 0, '')";
    }

    // INSERT ... ON DUPLICATE KEY UPDATE fog=1（幂等）
    foreach (array_chunk($fog_values, 500) as $batch) {
        $qry = "INSERT INTO {$tablepre}oblmapstates (pgroup, pls, fog, damaged, flags)
                VALUES " . implode(',', $batch) . "
                ON DUPLICATE KEY UPDATE fog=1";
        $db->query($qry);
    }
}

// ----------------------------------------------------------------
// 4.1c 道具发现（记忆范围随机抽取）
// ----------------------------------------------------------------

/**
 * 根据记忆范围，从视野内未发现道具中随机抽取 N 个设为 discovered
 *
 * 规则：
 * - 每次探索最多发现 memory_range 个道具（配置项，基础值 3）
 * - 从视野范围内所有 discovered=0 的道具中随机抽取
 * - 距离 <= 1（脚下+相邻格）→ discovered=1（正常可见）
 * - 距离 > 1（视野边缘格）→ discovered=2（近视/拟态怪）
 * - 仅更新 discovered=0 的道具（已发现的不降级）
 * - 同一格重复探索可继续发现剩余未发现道具
 *
 * @param int   $pgroup       当前区域
 * @param array $visible_tiles [pls => ['distance' => int]]
 */
function obl_discover_items($pgroup, $visible_tiles) {
    global $db, $tablepre;

    if (empty($visible_tiles)) return;

    $cfg = obl_get_config();
    $memory_range = (int)($cfg['memory_range'] ?? 3);

    $pgroup_i = (int)$pgroup;

    // 1. 查询视野范围内所有未发现道具
    $pls_list = implode(',', array_map('intval', array_keys($visible_tiles)));
    $result = $db->query("SELECT iid, pls FROM {$tablepre}oblmapitem
                           WHERE pgroup='$pgroup_i' AND pls IN ($pls_list) AND discovered=0");

    $undiscovered = [];
    while ($row = $db->fetch_array($result)) {
        $undiscovered[] = [
            'iid' => (int)$row['iid'],
            'pls' => (int)$row['pls'],
        ];
    }

    if (empty($undiscovered)) return;

    // 2. 随机抽取 memory_range 个
    shuffle($undiscovered);
    $to_discover = array_slice($undiscovered, 0, $memory_range);

    // 3. 按距离分组更新 discovered 状态
    $d1_iids = [];  // discovered=1
    $d2_iids = [];  // discovered=2

    foreach ($to_discover as $item) {
        $distance = $visible_tiles[$item['pls']]['distance'] ?? 999;
        if ($distance <= 1) {
            $d1_iids[] = $item['iid'];
        } else {
            $d2_iids[] = $item['iid'];
        }
    }

    // discovered=1：脚下和相邻格的道具
    if (!empty($d1_iids)) {
        $iid_list = implode(',', array_map('intval', $d1_iids));
        $db->query("UPDATE {$tablepre}oblmapitem
                     SET discovered=1
                     WHERE iid IN ($iid_list)");
    }

    // discovered=2：视野边缘格的道具（近视/拟态怪）
    if (!empty($d2_iids)) {
        $iid_list = implode(',', array_map('intval', $d2_iids));
        $db->query("UPDATE {$tablepre}oblmapitem
                     SET discovered=2
                     WHERE iid IN ($iid_list)");
    }
}

// ----------------------------------------------------------------
// 4.2 探索体力检查
// ----------------------------------------------------------------

/**
 * 检查玩家是否满足探索消耗的体力
 * 独立函数，便于移动后自动探索时跳过
 *
 * @param array &$pdata 玩家数据
 * @return bool true=体力充足（已扣除），false=体力不足
 */
function obl_check_explore_sp(&$pdata) {
    global $obl_log;

    $cfg = obl_get_config();
    $cost = (int)($cfg['explore_sp_cost'] ?? 0);

    if ($pdata['sp'] < $cost) {
        $obl_log->emit('explore.no_sp', 'explore');
        return false;
    }

    // 扣除体力
    $pdata['sp'] -= $cost;
    return true;
}

// ----------------------------------------------------------------
// 4.3 探索命令
// ----------------------------------------------------------------

/**
 * 探索当前格：体力检查 → 点亮迷雾 → 发现道具 → 探索后钩子
 *
 * @param array &$pdata          玩家数据
 * @param bool  $skip_sp_check   是否跳过体力检查（移动后自动探索时为 true）
 */
function obl_explore(&$pdata, $skip_sp_check = false) {
    global $obl_log;

    // 1. 体力检查（移动后自动探索跳过）
    if (!$skip_sp_check) {
        if (!obl_check_explore_sp($pdata)) {
            return;
        }
    }

    $pgroup = (int)$pdata['pgroup'];
    $pls = (int)$pdata['pls'];

    // 2. 更新视野（迷雾点亮 + 道具发现）
    obl_update_vision($pgroup, $pls, $pdata);

    // 3. 发现视野内的敌人（同时清除敌人所在格的迷雾）
    if (!function_exists('obl_discover_enemies')) {
        include_once GAME_ROOT . './oblivions/include/game/enemy_ai.func.php';
    }
    $vision_range = obl_get_player_vision_range($pdata);
    obl_discover_enemies($pgroup, $pls, $vision_range);

    // 4. 探索日志
    $obl_log->emit('explore.success', 'explore');

    // 5. 探索后钩子
    obl_post_explore_hook($pdata);
}

// ----------------------------------------------------------------
// 4.4 探索后钩子（预留）
// ----------------------------------------------------------------

/**
 * 探索后钩子（预留）
 * 后续在此实现：事件点触发、地板属性效果、成就判定等
 *
 * @param array &$pdata 玩家数据
 */
function obl_post_explore_hook(&$pdata) {
    // 预留：未来扩展
}

// ----------------------------------------------------------------
// 4.5 搜索建筑物
// ----------------------------------------------------------------

/**
 * 搜索建筑物：掉落表结算 + 机制触发
 *
 * @param int   $iaid   建筑物实例 ID（bra_oblmappoi.iaid）
 * @param array &$pdata 玩家数据
 */
function obl_search_poi($iaid, &$pdata) {
    global $db, $tablepre, $obl_log, $obl_error_log;

    $iaid = (int)$iaid;
    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    // 1. 读取 POI 实例
    $result = $db->query("SELECT * FROM {$tablepre}oblmappoi WHERE iaid='$iaid'");
    if (!$db->num_rows($result)) {
        $obl_log->emit('search.not_found', 'search');
        return;
    }
    $poi = $db->fetch_array($result);

    // 2. 位置检查：只能搜索当前格的建筑物
    if ((int)$poi['pgroup'] != $cur_pgroup || (int)$poi['pls'] != $cur_pls) {
        $obl_log->emit('search.not_adjacent', 'search');
        return;
    }

    // 3. 载入 POI 模板
    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    $poi_id = $poi['poi_id'];
    if (!isset($poi_table[$poi_id])) {
        // 数据配置错误：POI 实例存在但模板表无对应条目，迁移到 obl_error_log
        // 避免被 obl_log 的 200 条上限挤掉，前端通过错误 Toast 感知
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('search.data_error', array(
                'poi_id' => $poi_id,
                'iaid'   => $iaid,
            ), 'command');
        }
        return;
    }
    $template = $poi_table[$poi_id];

    // 4. 可搜索检查
    if (empty($template['searchable'])) {
        $obl_log->emit('search.not_searchable', 'search', [
            'poi_name' => $template['name'],
        ]);
        return;
    }

    // 5. 重复搜索检查（v1 简化：不检查冷却，允许无限重复搜索）
    // 后续版本在此加入 repeat_limit / repeat_cooldown 判定

    // 6. 选择掉落表
    $poi_loot = include GAME_ROOT . './oblivions/gamedata/poi_loot.php';
    $loot_config = isset($poi_loot[$poi_id]) ? $poi_loot[$poi_id] : [];

    $is_repeat = !empty($poi['searched']);
    $loot_table = [];

    if ($is_repeat && isset($loot_config['repeat_loot'])) {
        $loot_table = $loot_config['repeat_loot'];
    } elseif (!$is_repeat && isset($loot_config['loot'])) {
        $loot_table = $loot_config['loot'];
    } elseif ($is_repeat && !isset($loot_config['repeat_loot'])) {
        // 一次性建筑物已搜索过
        $obl_log->emit('search.already_searched', 'search', [
            'poi_name' => $template['name'],
        ]);
        return;
    }

    // 7. 机制触发型 POI
    $has_mechanic = !empty($template['mechanic']);
    if ($has_mechanic) {
        obl_execute_mechanic($template, $pdata);
    }

    // 8. 掉落表结算
    $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    $dropped_items = [];

    foreach ($loot_table as $drop) {
        $rate = isset($drop['rate']) ? (float)$drop['rate'] : 0;
        if ($rate <= 0) continue;
        if (mt_rand() / mt_getrandmax() > $rate) continue;

        $item_id = isset($drop['item_id']) ? (string)$drop['item_id'] : '';
        if ($item_id === '' || !isset($item_table[$item_id])) continue;

        // count 可以是单值或 [min,max] 区间
        $count = isset($drop['count']) ? $drop['count'] : 1;
        if (is_array($count)) {
            $lo = isset($count[0]) ? (int)$count[0] : 1;
            $hi = isset($count[1]) ? (int)$count[1] : $lo;
            if ($hi < $lo) { $tmp = $lo; $lo = $hi; $hi = $tmp; }
            $n = rand($lo, $hi);
        } else {
            $n = (int)$count;
        }

        for ($i = 0; $i < $n; $i++) {
            $tpl = $item_table[$item_id];
            $itm     = $db->escape_string((string)$tpl['itm']);
            $itmk    = $db->escape_string((string)$tpl['itmk']);
            $itme    = (int)$tpl['itme'];
            $itms    = $db->escape_string((string)$tpl['itms']);
            $itmsk   = $db->escape_string((string)$tpl['itmsk']);
            $itmpara = $db->escape_string((string)$tpl['itmpara']);
            $item_id_e = $db->escape_string($item_id);

            $db->query("INSERT INTO {$tablepre}oblmapitem
                        (pgroup, pls, iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara, discovered, fake_item_id, is_trap)
                        VALUES ('$cur_pgroup', '$cur_pls', '$iaid', '$item_id_e', '$itm', '$itmk', $itme, '$itms', '$itmsk', '$itmpara', 1, '', 0)");

            $dropped_items[] = $tpl['itm'];
        }
    }

    // 9. 更新 POI 状态（原子递增 search_count，避免并发丢计数）
    $db->query("UPDATE {$tablepre}oblmappoi
                SET searched=1, search_count=search_count+1
                WHERE iaid='$iaid'");

    // 10. 日志
    if ($has_mechanic) {
        $obl_log->emit('search.mechanic_triggered', 'search', [
            'poi_name' => $template['name'],
        ]);
        // 机制效果日志由 obl_execute_mechanic 写入
    } else {
        $obl_log->emit('search.result', 'search', [
            'poi_name' => $template['name'],
            'items'    => $dropped_items,
        ]);
    }
}

// ----------------------------------------------------------------
// 4.6 机制分发框架
// ----------------------------------------------------------------

/**
 * 执行 POI 机制效果（通用分发框架）
 * 新增机制只需添加 obl_mechanic_{mechanic_name}() 函数，框架自动分发
 *
 * @param array $template POI 模板配置
 * @param array &$pdata   玩家数据
 */
function obl_execute_mechanic($template, &$pdata) {
    global $obl_log;

    $mechanic = $template['mechanic'];

    // 分发到具体处理函数
    $handler = 'obl_mechanic_' . $mechanic;
    if (function_exists($handler)) {
        $handler($template, $pdata);
    } else {
        $obl_log->emit('search.mechanic_pending', 'search', [
            'mechanic' => $mechanic,
        ]);
    }
}

/**
 * 机制：增加最大生命值
 */
function obl_mechanic_max_hp_up($template, &$pdata) {
    global $obl_log;

    $value = (int)($template['mechanic_value'] ?? 0);
    if ($value <= 0) return;

    $pdata['mhp'] += $value;
    // 同时回复等量生命值
    $pdata['hp'] = min($pdata['hp'] + $value, $pdata['mhp']);

    $obl_log->emit('system.mechanic_max_hp_up', 'system', [
        'value' => $value,
        'hp'    => $pdata['hp'],
        'mhp'   => $pdata['mhp'],
    ]);
}

// ----------------------------------------------------------------
// 4.7 拾取道具
// ----------------------------------------------------------------

/**
 * 从地图拾取道具到背包
 *
 * item_id 存储约定（统一 JSON）：
 *   拾取时将原 item_id 注入 itmpara JSON 数组的 'obl_item_id' 键，
 *   丢弃时从该键还原，原 itmpara 保持完整。
 *
 * @param int   $iid    道具实例 ID（bra_oblmapitem.iid）
 * @param array &$pdata 玩家数据
 */
function obl_pickup_item($iid, &$pdata) {
    global $db, $tablepre, $obl_log;

    $iid = (int)$iid;
    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    // 1. 读取道具实例
    $result = $db->query("SELECT * FROM {$tablepre}oblmapitem WHERE iid='$iid'");
    if (!$db->num_rows($result)) {
        $obl_log->emit('pickup.not_found', 'pickup');
        return;
    }
    $item = $db->fetch_array($result);

    // 2. 位置检查
    if ((int)$item['pgroup'] != $cur_pgroup || (int)$item['pls'] != $cur_pls) {
        $obl_log->emit('pickup.not_adjacent', 'pickup');
        return;
    }

    // 3. 发现状态检查（未发现的道具不能拾取）
    if (empty($item['discovered'])) {
        $obl_log->emit('pickup.unknown', 'pickup');
        return;
    }

    // 4. 近视道具揭示
    $real_itm = $item['itm'];
    $was_nearsighted = ((int)$item['discovered'] === 2);

    if ($was_nearsighted) {
        // 揭示真实身份
        if (!empty($item['is_trap'])) {
            // 陷阱（v1 简化：仅写日志，不造成伤害，不获得道具）
            $obl_log->emit('pickup.trap', 'pickup', [
                'item_name' => $real_itm,
            ]);
            // 原子删除：仅当道具仍存在时删除，防止并发重复触发
            $db->query("DELETE FROM {$tablepre}oblmapitem WHERE iid='$iid'");
            return;
        }
        // 正常近视道具：揭示真实名称
        $obl_log->emit('pickup.nearsighted_reveal', 'pickup', [
            'item_name' => $real_itm,
        ]);
    }

    // 5. 写入玩家背包（寻找空槽位，使用 itempara JSON 结构）
    $slot = obl_find_empty_slot($pdata);
    if ($slot === false) {
        $obl_log->emit('pickup.bag_full', 'pickup');
        return;
    }

    // 构建道具对象（遵循 itempara JSON 七字段规范：itm/itmk/itme/itms/itmsk/itmpara/itmid）
    // itmid 为独立字段（地图道具实例 ID），丢弃时直接还原
    // itmpara 保持原始数据，不注入 obl_item_id
    $itmpara = json_decode((string)$item['itmpara'], true);
    if (!is_array($itmpara)) $itmpara = [];

    $new_item = array(
        'itm'     => $item['itm'],
        'itmk'    => $item['itmk'],
        'itme'    => (int)$item['itme'],
        'itms'    => $item['itms'],
        'itmsk'   => $item['itmsk'],
        'itmpara' => $itmpara,
        'itmid'   => (string)$item['item_id'],
    );
    obl_set_item($pdata, $slot, $new_item);

    // 6. 原子删除地图道具实例：仅当 discovered>0 时删除，防止并发拾取同一道具
    //    如果 affected_rows=0 说明道具已被其他请求拾取，回滚背包写入
    $db->query("DELETE FROM {$tablepre}oblmapitem WHERE iid='$iid' AND discovered>0");
    if ($db->affected_rows() <= 0) {
        // 道具已被并发请求拾取，回滚背包
        obl_set_item($pdata, $slot, null);
        $obl_log->emit('system.pickup_concurrent_loss', 'system');
        return;
    }

    // 7. 日志
    if (!$was_nearsighted) {
        $obl_log->emit('pickup.success', 'pickup', [
            'item_name' => $real_itm,
        ]);
    }
}

// ----------------------------------------------------------------
// 4.8 丢弃道具
// ----------------------------------------------------------------

/**
 * 从背包丢弃道具到当前地图格
 * 道具从背包槽位删除，写入 bra_oblmapitem（iaid=0, discovered=1）
 * 其他玩家/后续可拾取
 *
 * item_id 还原（统一 JSON）：
 *   从 itempara[].para.obl_item_id 取出还原，剩余作为原 itmpara 保留。
 *
 * @param int   $slot   背包槽位号（1~6）
 * @param array &$pdata 玩家数据
 */
function obl_discard_item($slot, &$pdata) {
    global $db, $tablepre, $obl_log;

    $slot = (int)$slot;
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    if ($slot < 1 || $slot > $maxslots) {
        $obl_log->emit('discard.invalid_slot', 'discard', ['slot' => $slot]);
        return;
    }

    $item = obl_get_item($pdata, $slot);
    if (empty($item) || !is_array($item)) {
        $obl_log->emit('discard.empty_slot', 'discard', ['slot' => $slot]);
        return;
    }

    // 读取道具数据（从 itempara JSON 七字段结构还原为地图道具表字段）
    $itm     = isset($item['itm']) ? $item['itm'] : '';
    $itmk    = isset($item['itmk']) ? $item['itmk'] : '';
    $itme    = isset($item['itme']) ? (int)$item['itme'] : 0;
    $itms    = isset($item['itms']) ? $item['itms'] : '';
    $itmsk   = isset($item['itmsk']) ? $item['itmsk'] : '';
    $itmpara = isset($item['itmpara']) && is_array($item['itmpara']) ? $item['itmpara'] : [];
    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';

    // 还原 itmpara 为字符串（空数组留空字符串）
    $itmpara_str = empty($itmpara) ? '' : json_encode($itmpara, JSON_UNESCAPED_UNICODE);

    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    // 写入地图道具表（iaid=0 散落道具，discovered=1 立即可见）
    $itm_e       = $db->escape_string($itm);
    $itmk_e      = $db->escape_string($itmk);
    $itms_e      = $db->escape_string($itms);
    $itmsk_e     = $db->escape_string($itmsk);
    $itmpara_e   = $db->escape_string($itmpara_str);
    $item_id_e   = $db->escape_string($item_id);

    $db->query("INSERT INTO {$tablepre}oblmapitem
                (pgroup, pls, iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara, discovered, fake_item_id, is_trap)
                VALUES ('$cur_pgroup', '$cur_pls', 0, '$item_id_e', '$itm_e', '$itmk_e', $itme, '$itms_e', '$itmsk_e', '$itmpara_e', 1, '', 0)");

    // 清空背包槽位
    obl_set_item($pdata, $slot, null);

    $obl_log->emit('discard.success', 'discard', [
        'item_name' => $itm,
    ]);
}

// ----------------------------------------------------------------
// 4.9 / 4.10 / 4.11 移动体力检查 + 移动后钩子
//   定义在 move.func.php（与 obl_move() 同文件，保持移动逻辑内聚）
// ----------------------------------------------------------------
