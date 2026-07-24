<?php
/**
 * 诊断寻路震荡问题：从 pls=40 到 pls=44 的路径为何在 49↔48 之间震荡。
 *
 * 用法：php oblivions/tools/diagnose_pathfinding.php
 */

declare(strict_types=1);

define('IN_GAME', true);
define('GAME_ROOT', dirname(__DIR__, 2) . '/');
define('GAMENAME', 'bra');
define('CURSCRIPT', 'diag');

require GAME_ROOT . 'config.inc.php';
require GAME_ROOT . 'gamedata/system.php';
require GAME_ROOT . 'include/db/db_' . $database . '.class.php';

$pconnect = false;
$db = new dbstuff();
$db->connect($dbhost, $dbuser, $dbpw, $dbname, 0);
$gtablepre = $tablepre;
$groomid = 0;
$gruleset = 'OBLIVIONS';
$now = time();
$gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
$gamestate = 20;
$GLOBALS['obl_db_throw_on_error'] = true;
$GLOBALS['obl_request_uid'] = 'diag-' . bin2hex(random_bytes(6));

require_once GAME_ROOT . 'oblivions/include/core/obl_bootstrap.php';
require_once GAME_ROOT . 'oblivions/include/core/obl_runtime.php';
require_once GAME_ROOT . 'oblivions/include/game/navigation.func.php';
require_once GAME_ROOT . 'oblivions/include/game/info_acquire.func.php';

// ── 1. 加载区域 1 的地图数据 ──
$pgroup = 1;
$map = obl_get_map_data($pgroup);
$tiles = $map['tiles'][$pgroup] ?? [];

echo "=== 区域 {$pgroup} 图格拓扑 ===\n";
echo "总图格数：" . count($tiles) . "\n\n";

// ── 2. 打印关键图格的信息 ──
$interesting = [40, 44, 48, 49];
echo "=== 关键图格 ===\n";
foreach ($interesting as $pls) {
    if (!isset($tiles[$pls])) {
        echo "pls={$pls} NOT FOUND\n";
        continue;
    }
    $t = $tiles[$pls];
    $neighbors = $t['neighbors'] ?? [];
    echo "pls={$pls} passable=" . (int)($t['passable'] ?? 0)
       . " tide=" . ($t['tide'] ?? 'none')
       . " neighbors=[" . implode(',', $neighbors) . "]\n";
}
echo "\n";

// ── 3. 模拟导航 40 → 44，steady 倾向，不移动敌人 ──
echo "=== 模拟导航 40 → 44 (steady, blocked=空) ===\n";
$blocked_tiles = [];
$path = [40];
$cur = 40;
$target = 44;
$max_iter = 30;
for ($i = 0; $i < $max_iter; $i++) {
    if ($cur === $target) {
        echo "  第 {$i} 步：到达目标 {$target}\n";
        break;
    }
    $next = obl_navigation_find_next_step($pgroup, $cur, $target, $dummy_pdata = ['pid' => 0], 'steady', true);
    if ($next === null) {
        echo "  第 {$i} 步：BFS 返回 null (不可达)\n";
        break;
    }
    echo "  第 {$i} 步：{$cur} → {$next}\n";
    $path[] = $next;
    $cur = $next;
}
echo "  最终路径：" . implode(' → ', $path) . "\n\n";

// ── 4. 单独测试 BFS：从 40、49、48 到 44 的最短路径 ──
echo "=== BFS 最短路径测试 ===\n";
foreach ([40, 49, 48] as $from) {
    $bfs = obl_navigation_standard_bfs_next($from, $target, $tiles, $blocked_tiles);
    echo "  standard_bfs_next(from={$from}, to={$target}): next=" . ($bfs['next'] ?? 'null') . " length=" . $bfs['length'] . "\n";

    // 完整路径
    $full = obl_navigation_bfs_full_path($from, $target, $tiles, $blocked_tiles);
    echo "  bfs_full_path(from={$from}, to={$target}): path=[" . implode(' → ', $full['path']) . "] length=" . $full['length'] . "\n";
}
echo "\n";

// ── 5. 测试 weighted_bfs_next (steady 倾向) ──
echo "=== weighted_bfs_next (steady) 测试 ===\n";
foreach ([40, 49, 48] as $from) {
    $pdata = ['pid' => 0, 'pgroup' => $pgroup, 'pls' => $from];
    $next = obl_navigation_weighted_bfs_next($pgroup, $from, $target, $pdata, $tiles, $blocked_tiles, 'steady', 2);
    echo "  weighted_bfs_next(from={$from}, to={$target}, mode=steady): next=" . ($next ?? 'null') . "\n";
}
echo "\n";

// ── 6. 检查是否有活敌人占据图格 ──
echo "=== 已发现敌人占据图格 ===\n";
$enemy_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, 0, false);
echo "  discovered=1 敌人占据：" . (empty($enemy_tiles) ? "(空)" : implode(',', array_keys($enemy_tiles))) . "\n";
$all_enemy_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, 0, true);
echo "  所有活敌人占据：" . (empty($all_enemy_tiles) ? "(空)" : implode(',', array_keys($all_enemy_tiles))) . "\n";
echo "\n";

// ── 7. 检查 44 的可达性 ──
echo "=== 从 48/49 出发的可达性测试 ===\n";
foreach ([48, 49] as $from) {
    $bfs = obl_navigation_standard_bfs_next($from, $target, $tiles, []);
    if ($bfs['next'] === null) {
        echo "  从 {$from} 到 {$target} 不可达！\n";
    } else {
        echo "  从 {$from} 到 {$target} 可达，第一格={$bfs['next']}, 距离={$bfs['length']}\n";
    }
}

echo "\n=== 诊断结束 ===\n";
