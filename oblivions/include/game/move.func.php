<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 移动函数
// 基于 (pgroup, pls) 组合键 + 邻接表连通图移动
// 操作 $pdata 数组，不使用 extract($pdata, EXTR_REFS)
// ================================================================

/**
 * 获取地块的显示名称
 * - 有名地块直接返回 name
 * - 无名地块根据 floor/tide/passable 生成地形描述，如"一片金属覆盖的荒地"
 *
 * @param array $tile 地块数据
 * @return string 显示名称
 */
function obl_get_tile_display_name($tile) {
    if (!empty($tile['name'])) {
        return $tile['name'];
    }

    $cfg = include GAME_ROOT . './oblivions/gamedata/terrain_desc.php';
    $floor_key = $tile['floor'] ?? 'standard';
    $tide_key = $tile['tide'] ?? 'shallow';

    $floor = $cfg['floor'][$floor_key] ?? $cfg['floor']['standard'];
    $floor_name = $floor['name'][array_rand($floor['name'])];
    $floor_adj  = $floor['adj'][array_rand($floor['adj'])];

    $tide_pool = $cfg['tide'][$tide_key] ?? [''];
    $tide_adj = $tide_pool[array_rand($tide_pool)];

    // 选择模板：有潮汐修饰用完整版，否则用简洁版
    if (!empty($tide_adj)) {
        $tpl_pool = $cfg['templates']['default'];
        $text = str_replace(
            ['{tide_adj}', '{floor_adj}', '{floor_name}'],
            [$tide_adj, $floor_adj, $floor_name],
            $tpl_pool[array_rand($tpl_pool)]
        );
    } else {
        $tpl_pool = $cfg['templates']['no_tide'];
        $text = str_replace(
            ['{floor_adj}', '{floor_name}'],
            [$floor_adj, $floor_name],
            $tpl_pool[array_rand($tpl_pool)]
        );
    }

    // 不可通行追加后缀
    if (empty($tile['passable'])) {
        $suffix_pool = $cfg['impassable_suffix'];
        $text .= $suffix_pool[array_rand($suffix_pool)];
    }

    return $text;
}

/**
 * 加载地图数据（按区域懒加载）
 * - 不传参：返回 regions + grids + 已缓存的 tiles
 * - 传 pgroup：加载该区域 tiles 并返回完整结构
 * @param int|null $pgroup 区域 ID，null 表示不额外加载
 * @return array
 */
function obl_get_map_data($pgroup = null) {
    static $regions = null;
    static $grids = null;
    static $tilesCache = [];

    // 首次调用加载 regions + grids（轻量元数据）
    if ($regions === null) {
        $base = require GAME_ROOT . './oblivions/gamedata/map.php';
        $regions = $base['regions'];
        $grids = $base['grids'];
    }

    // 按需加载指定区域的 tiles
    if ($pgroup !== null && !isset($tilesCache[$pgroup])) {
        $path = GAME_ROOT . "./oblivions/gamedata/tiles/region_{$pgroup}.php";
        if (file_exists($path)) {
            $tilesCache[$pgroup] = require $path;
        }
    }

    return [
        'regions' => $regions,
        'tiles'   => $tilesCache,
        'grids'   => $grids,
    ];
}

/**
 * 获取当前玩家可移动的最大格数
 * 保底 1，由技能系统扩展
 * @return int
 */
function obl_get_move_range() {
    return 3;
}

/**
 * 计算同区域内两格之间的最短路径距离（BFS）
 * @param  int $pgroup 区域 ID
 * @param  int $from   起始 pls
 * @param  int $to     目标 pls
 * @return int         最短路径长度（边数），不可达返回 -1
 */
function obl_get_distance($pgroup, $from, $to) {
    $from = (int)$from;
    $to = (int)$to;
    if ($from === $to) return 0;

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? [];
    if (!isset($tiles[$from]) || !isset($tiles[$to])) return -1;

    $visited = [$from => true];
    $queue = [[$from, 0]];

    while (!empty($queue)) {
        [$current, $dist] = array_shift($queue);

        foreach ($tiles[$current]['neighbors'] as $neighbor) {
            if ($neighbor === $to) return $dist + 1;
            if (!isset($visited[$neighbor]) && !empty($tiles[$neighbor]['passable'])) {
                $visited[$neighbor] = true;
                $queue[] = [$neighbor, $dist + 1];
            }
        }
    }
    return -1;
}

/**
 * Oblivions 模式移动
 * @param int $moveto 目标 pls（区域内局部索引）
 * @param array $pdata 玩家数据
 */
function obl_move($moveto, &$pdata) {
    global $log;

    $moveto = (int)$moveto;
    $cur_pgroup = (int)$pdata['pgroup'];
    $map = obl_get_map_data($cur_pgroup);
    $cur_pls = (int)$pdata['pls'];
    $region = $map['regions'][$cur_pgroup] ?? null;

    // 1. 同位置检查（允许在出入口格原地触发区域切换）
    if ($cur_pls == $moveto) {
        $is_exit = $region && $cur_pls == $region['exit_pls'];
        $is_entrance = $region && $cur_pls == $region['entrance_pls'] && !empty($region['prev_region']);
        if (!$is_exit && !$is_entrance) {
            $log .= '已经在当前位置，不需要移动。<br>';
            return;
        }
        // 站在出入口格原地 → 执行区域切换
        obl_switch_region($region, $cur_pls, $map, $pdata);
        obl_post_move_hook($pdata);
        return;
    }

    // 2. 目标有效性检查
    $tiles = $map['tiles'][$cur_pgroup] ?? [];
    if (!isset($tiles[$moveto])) {
        $log .= '请选择正确的移动地点。<br>';
        return;
    }

    $target_tile = $tiles[$moveto];

    // 3. 可通行检查
    if (empty($target_tile['passable'])) {
        $tname = obl_get_tile_display_name($target_tile);
        $log .= "{$tname}，无法通行，请绕道。<br>";
        return;
    }

    // 4. 体力检查（首格预扣，独立函数配置驱动）
    if (!obl_check_move_sp($pdata, 1)) {
        return;
    }

    // 5. 连通性 + 距离判定
    $neighbors = $tiles[$cur_pls]['neighbors'] ?? [];
    $move_range = obl_get_move_range();

    if (in_array($moveto, $neighbors)) {
        // 直连 → 移动
        $distance = 1;
    } elseif ($move_range > 1) {
        // 跨格移动 → BFS 距离
        $distance = obl_get_distance($cur_pgroup, $cur_pls, $moveto);
        if ($distance === -1 || ($distance > $move_range)) {
            $tname = obl_get_tile_display_name($target_tile);
            $log .= "无法直接移动到{$tname}。<br>";
            return;
        }
    } else {
        $tname = obl_get_tile_display_name($target_tile);
        $log .= "无法直接移动到{$tname}，需要通过相邻区域。<br>";
        return;
    }

    // 6. 跨格移动补扣差额（obl_check_move_sp 已按 distance=1 扣除首格）
    if ($distance > 1) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $base_cost = (int)($cfg['move_sp_cost'] ?? 0);
        $extra_cost = ($distance - 1) * $base_cost;
        if ($pdata['sp'] < $extra_cost) {
            $log .= '体力不足，无法移动到那么远的地方。<br>';
            return;
        }
        $pdata['sp'] -= $extra_cost;
    }

    // 7. 执行移动
    $from_tile = $tiles[$cur_pls];
    $pdata['pls'] = $moveto;

    $from_name = obl_get_tile_display_name($from_tile);
    $to_name = obl_get_tile_display_name($target_tile);
    $log .= "从{$from_name}移动到了<span class=\"yellow\">{$to_name}</span>。<br>";
    if (!empty($target_tile['desc'])) {
        $log .= $target_tile['desc'] . '<br>';
    }

    // 8. 区域切换不再自动触发（需玩家在出入口格主动点击切换）

    // 9. 游戏刻
    // [预留] $gamevars['obl_tick']++

    // 10. 移动后钩子：自动探索（跳过体力检查）
    obl_post_move_hook($pdata);
}

/**
 * 区域切换处理
 * 当玩家移动到出口/入口格，或站在出入口格原地触发切换时调用
 *
 * @param array  $region  当前区域信息
 * @param int    $moveto  目标格 pls（与当前格相同时为原地切换）
 * @param array  $map     地图数据
 * @param array  &$pdata  玩家数据
 */
function obl_switch_region($region, $moveto, &$map, &$pdata) {
    global $log;
    if (!$region) return;

    // 出口格 → 前往下一区域
    if ($moveto == $region['exit_pls']) {
        $next_group = $region['next_region'];
        if ($next_group && isset($map['regions'][$next_group])) {
            $map = obl_get_map_data($next_group);
            $next_region = $map['regions'][$next_group];
            $pdata['pgroup'] = $next_group;
            $pdata['pls'] = $next_region['entrance_pls'];
            $log .= "<br>离开了<span class=\"yellow\">{$region['name']}</span>，进入了<span class=\"yellow\">{$next_region['name']}</span>。<br>";
            $log .= $next_region['desc'] . '<br>';

            $entrance_tile = $map['tiles'][$next_group][$next_region['entrance_pls']] ?? [];
            if ($entrance_tile) {
                $log .= $entrance_tile['desc'] . '<br>';
            }
        } elseif ($next_group === null) {
            $log .= '<br>你已经到达了当前区域的尽头，前方似乎没有路了……<br>';
        }
    }

    // 入口格回退 → 返回上一区域
    if ($moveto == $region['entrance_pls'] && !empty($region['prev_region'])) {
        $prev_group = $region['prev_region'];
        if (isset($map['regions'][$prev_group])) {
            $map = obl_get_map_data($prev_group);
            $prev_region = $map['regions'][$prev_group];
            $pdata['pgroup'] = $prev_group;
            $pdata['pls'] = $prev_region['exit_pls'];
            $log .= "<br>你转过身，从<span class=\"yellow\">{$region['name']}</span>" .
                    "回到了<span class=\"yellow\">{$prev_region['name']}</span>。<br>";
            $log .= $prev_region['desc'] . '<br>';

            $exit_tile = $map['tiles'][$prev_group][$prev_region['exit_pls']] ?? [];
            if ($exit_tile) {
                $log .= $exit_tile['desc'] . '<br>';
            }
        }
    }
}

/**
 * 检查玩家是否满足移动消耗的体力
 * 独立函数，配置驱动，基础值 0 不消耗
 *
 * @param array &$pdata   玩家数据
 * @param int   $distance 移动距离（格数）
 * @return bool true=体力充足（已扣除），false=体力不足
 */
function obl_check_move_sp(&$pdata, $distance = 1) {
    global $log;

    $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
    $base_cost = (int)($cfg['move_sp_cost'] ?? 0);
    $cost = $distance * $base_cost;

    if ($pdata['sp'] < $cost) {
        $log .= '体力不足，无法移动。<br>';
        return false;
    }

    // 扣除体力
    $pdata['sp'] -= $cost;
    return true;
}

/**
 * 移动后钩子：自动探索（跳过体力检查）
 *
 * @param array &$pdata 玩家数据
 */
function obl_post_move_hook(&$pdata) {
    // 移动后自动触发探索，不消耗探索体力
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_explore($pdata, true);
}