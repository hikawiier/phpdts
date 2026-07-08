<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 移动函数
// 基于 (pgroup, pls) 组合键 + 邻接表连通图移动
// 操作 $pdata 数组，不使用 extract($pdata, EXTR_REFS)
//
// 日志系统：使用 $obl_log（OblivionsLogger）替代传统 $log
// 后端只输出事件结构，前端完全控制视觉呈现
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
 * 构造地块日志参数（用于 $obl_log->emit 的 params）
 * 后端只传原始属性，前端负责生成显示文案
 *
 * @param array $tile 地块数据
 * @return array 日志参数
 */
function obl_tile_log_params($tile) {
    return [
        'name'     => $tile['name'] ?? '',
        'desc'     => $tile['desc'] ?? '',
        'floor'    => $tile['floor'] ?? 'standard',
        'tide'     => $tile['tide'] ?? 'shallow',
        'passable' => !empty($tile['passable']),
    ];
}

/**
 * Oblivions 模式移动
 * @param int $moveto 目标 pls（区域内局部索引）
 * @param array $pdata 玩家数据
 */
function obl_move($moveto, &$pdata) {
    global $obl_log;

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
            $obl_log->emit('move.same_pos', 'move');
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
        $obl_log->emit('move.invalid_target', 'move');
        return;
    }

    $target_tile = $tiles[$moveto];

    // 3. 可通行检查
    if (empty($target_tile['passable'])) {
        $obl_log->emit('move.blocked', 'move', obl_tile_log_params($target_tile));
        return;
    }

    // 3.5 占用检查（1 格 1 单位：目标格被其他单位占用则不能移动）
    // TODO: 碰撞战斗机制待 tick 框架重构后重新实现（旧 obl_resolve_collision_battle 已删除）
    global $db, $tablepre;
    $occ_result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE pgroup='{$cur_pgroup}' AND pls='{$moveto}' AND state=0 AND pid != '{$pdata['pid']}' LIMIT 1");
    $occupier = $db->fetch_array($occ_result);
    if ($occupier) {
        $obl_log->emit('move.occupied', 'move', obl_tile_log_params($target_tile));
        return;
    }

    // 4. 连通性 + 距离判定
    $neighbors = $tiles[$cur_pls]['neighbors'] ?? [];
    $move_range = obl_get_move_range();

    if (in_array($moveto, $neighbors)) {
        // 直连 → 移动
        $distance = 1;
    } elseif ($move_range > 1) {
        // 跨格移动 → BFS 距离
        $distance = obl_get_distance($cur_pgroup, $cur_pls, $moveto);
        if ($distance === -1 || ($distance > $move_range)) {
            $obl_log->emit('move.unreachable', 'move', obl_tile_log_params($target_tile));
            return;
        }
    } else {
        $obl_log->emit('move.no_path', 'move', obl_tile_log_params($target_tile));
        return;
    }

    // 5. 体力检查（距离确认后一次性扣除，避免远距离失败时先扣首格体力）
    if ($distance > 1) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $base_cost = (int)($cfg['move_sp_cost'] ?? 0);
        $cost = $distance * $base_cost;
        if ($pdata['sp'] < $cost) {
            $obl_log->emit('move.no_sp_far', 'move');
            return;
        }
        $pdata['sp'] -= $cost;
    } elseif (!obl_check_move_sp($pdata, 1)) {
        return;
    }

    // 6. 执行移动
    $from_tile = $tiles[$cur_pls];
    $pdata['pls'] = $moveto;

    $obl_log->emit('move.success', 'move', [
        'from' => obl_tile_log_params($from_tile),
        'to'   => obl_tile_log_params($target_tile),
    ]);
    // 地块描述作为独立条目，前端自行组合
    $obl_log->emit('move.tile_desc', 'move', obl_tile_log_params($target_tile));

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
    global $obl_log;
    if (!$region) return;

    // 出口格 → 前往下一区域
    if ($moveto == $region['exit_pls']) {
        $next_group = $region['next_region'];
        if ($next_group && isset($map['regions'][$next_group])) {
            $map = obl_get_map_data($next_group);
            $next_region = $map['regions'][$next_group];
            $pdata['pgroup'] = $next_group;
            $pdata['pls'] = $next_region['entrance_pls'];

            // 拆分为三条独立日志：离开 → 进入 → 落脚格描述
            $obl_log->emit('move.region_leave', 'move', [
                'region_name' => $region['name'],
            ]);
            $obl_log->emit('move.region_enter', 'move', [
                'region_name' => $next_region['name'],
                'region_desc' => $next_region['desc'] ?? '',
            ]);

            $entrance_tile = $map['tiles'][$next_group][$next_region['entrance_pls']] ?? [];
            if ($entrance_tile) {
                $obl_log->emit('move.tile_desc', 'move', obl_tile_log_params($entrance_tile));
            }
        } elseif ($next_group === null) {
            $obl_log->emit('move.region_end', 'move');
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

            // 拆分为三条独立日志：离开 → 进入 → 落脚格描述
            $obl_log->emit('move.region_leave', 'move', [
                'region_name' => $region['name'],
            ]);
            $obl_log->emit('move.region_enter', 'move', [
                'region_name' => $prev_region['name'],
                'region_desc' => $prev_region['desc'] ?? '',
            ]);

            $exit_tile = $map['tiles'][$prev_group][$prev_region['exit_pls']] ?? [];
            if ($exit_tile) {
                $obl_log->emit('move.tile_desc', 'move', obl_tile_log_params($exit_tile));
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
    global $obl_log;

    $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
    $base_cost = (int)($cfg['move_sp_cost'] ?? 0);
    $cost = $distance * $base_cost;

    if ($pdata['sp'] < $cost) {
        $obl_log->emit('move.no_sp', 'move');
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
