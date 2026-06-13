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
    return 1;
}

/**
 * 计算同区域内两格之间的最短路径距离（BFS）
 * @param  int $pgroup 区域 ID
 * @param  int $from   起始 pls
 * @param  int $to     目标 pls
 * @return int         最短路径长度（边数），不可达返回 -1
 */
function obl_get_distance($pgroup, $from, $to) {
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

    $cur_pgroup = (int)$pdata['pgroup'];
    $map = obl_get_map_data($cur_pgroup);
    $cur_pls = (int)$pdata['pls'];

    // 1. 同位置检查
    if ($cur_pls == $moveto) {
        $log .= '已经在当前位置，不需要移动。<br>';
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
        $log .= "{$target_tile['name']}无法通行，请绕道。<br>";
        return;
    }

    // 4. 体力检查
    $base_cost = 0;
    if ($pdata['sp'] < $base_cost) {
        $log .= '体力不足，无法移动。<br>';
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
        if ($distance === -1 || $distance > $move_range) {
            $log .= "无法直接移动到{$target_tile['name']}。<br>";
            return;
        }
    } else {
        $log .= "无法直接移动到{$target_tile['name']}，需要通过相邻区域。<br>";
        return;
    }

    // 6. 消耗体力
    $cost = $distance * $base_cost;
    if ($pdata['sp'] < $cost) {
        $log .= '体力不足，无法移动。<br>';
        return;
    }
    $pdata['sp'] -= $cost;

    // 7. 执行移动
    $from_tile = $tiles[$cur_pls];
    $pdata['pls'] = $moveto;

    $region = $map['regions'][$cur_pgroup];
    $log .= "从{$from_tile['name']}移动到了<span class=\"yellow\">{$target_tile['name']}</span>。<br>";
    $log .= $target_tile['desc'] . '<br>';

    // 8. 区域切换检查 — 出口格
    if ($moveto == $region['exit_pls']) {
        $next_group = $region['next_region'];
        if ($next_group && isset($map['regions'][$next_group])) {
            // 预加载目标区域 tiles
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

    // 9. 区域切换检查 — 入口格回退
    if ($moveto == $region['entrance_pls'] && !empty($region['prev_region'])) {
        $prev_group = $region['prev_region'];
        if (isset($map['regions'][$prev_group])) {
            // 预加载目标区域 tiles
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

    // 10. 游戏刻
    // [预留] $gamevars['obl_tick']++

    // 10. 移动后钩子
    obl_post_move_hook();
}

/**
 * 移动后钩子（预留）
 * 后续在此实现：自动探索、遇敌判定、事件点触发、地板属性效果
 */
function obl_post_move_hook() {
    // TODO
}