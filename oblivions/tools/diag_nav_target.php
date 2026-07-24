<?php
/**
 * 诊断脚本：检查当前玩家所在区域为什么 obl_navigation_select_target 返回 null。
 *
 * 用法：php diag_nav_target.php <pid>
 *   默认 pid=1
 */

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
$groomid = 1;
// 关键：手动改 $tablepre 为 oblivions 房间表前缀
$base_tablepre = $tablepre;
$tablepre = $base_tablepre . 's' . $groomid . '_';
$gruleset = 'OBLIVIONS';
$now = time();
$gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
$gamestate = 20;
$GLOBALS['obl_db_throw_on_error'] = true;
$GLOBALS['obl_request_uid'] = 'diag-' . bin2hex(random_bytes(6));

require_once GAME_ROOT . 'oblivions/include/core/obl_bootstrap.php';
require_once GAME_ROOT . 'oblivions/include/core/obl_runtime.php';

$pid = isset($argv[1]) ? (int)$argv[1] : 1;

// 0. 列出所有玩家
echo "--- 所有 players ---\n";
$r = $db->query("SELECT pid, pls, pgroup, name FROM {$tablepre}oblplayers ORDER BY pid");
while ($row0 = $db->fetch_array($r)) {
    echo "  pid={$row0['pid']} pgroup={$row0['pgroup']} pls={$row0['pls']} name={$row0['name']}\n";
}
echo "\n";

// 1. 读玩家
$r = $db->query("SELECT pid, pls, pgroup FROM {$tablepre}oblplayers WHERE pid='{$pid}' LIMIT 1");
$row = $db->fetch_array($r);
if (!$row) {
    echo "[ERR] 玩家 pid={$pid} 不存在\n";
    exit(1);
}
$pls = (int)$row['pls'];
$pgroup = (int)$row['pgroup'];
echo "=== 玩家 pid={$pid} 当前位置：pgroup={$pgroup} pls={$pls} ===\n\n";

// 2. 该 pgroup 的 oblmapstates.explored 分布
$r = $db->query("SELECT explored, COUNT(*) AS c FROM {$tablepre}oblmapstates WHERE pgroup='{$pgroup}' GROUP BY explored");
echo "--- oblmapstates.explored 分布 ---\n";
while ($row2 = $db->fetch_array($r)) {
    echo "  explored={$row2['explored']} : {$row2['c']} 格\n";
}

// 3. 地图数据中的 passable 格分布
$map = obl_get_map_data($pgroup);
$tiles = $map['tiles'][$pgroup] ?? array();
echo "\n--- 地图 tiles 分布 ---\n";
echo "  总格数: " . count($tiles) . "\n";
$passable_count = 0;
foreach ($tiles as $pls_id => $tile) {
    if (!empty($tile['passable'])) $passable_count++;
}
echo "  passable=1 格数: {$passable_count}\n";

// 4. 当前格的邻居 + explored 状态
echo "\n--- 当前格 pls={$pls} 的直接邻居 ---\n";
if (!isset($tiles[$pls])) {
    echo "  [ERR] 当前格在 tiles 中不存在\n";
} else {
    $neighbors = $tiles[$pls]['neighbors'] ?? array();
    foreach ($neighbors as $n) {
        $n = (int)$n;
        $passable = !empty($tiles[$n]['passable']) ? 1 : 0;
        $r2 = $db->query("SELECT explored FROM {$tablepre}oblmapstates WHERE pgroup='{$pgroup}' AND pls='{$n}' LIMIT 1");
        $row3 = $db->fetch_array($r2);
        $explored = $row3 ? (int)$row3['explored'] : -1;
        echo "  邻居 pls={$n} passable={$passable} explored={$explored}\n";
    }
}

// 5. oblmappoi 分布
echo "\n--- oblmappoi.discovered 分布 ---\n";
$r = $db->query("SELECT discovered, COUNT(*) AS c FROM {$tablepre}oblmappoi WHERE pgroup='{$pgroup}' GROUP BY discovered");
$has_poi_row = false;
while ($row2 = $db->fetch_array($r)) {
    $has_poi_row = true;
    echo "  discovered={$row2['discovered']} : {$row2['c']} POI\n";
}
if (!$has_poi_row) echo "  (无 POI 数据)\n";

// 6. 直接调用 select_target 看结果（测多个 pls）
echo "\n--- 直接调用 obl_navigation_select_target ---\n";
$pdata = array('pid' => $pid);
foreach ([1, 7, 24, 23] as $test_pls) {
    echo "  从 pls={$test_pls} 出发：\n";
    foreach (['steady', 'nearby', 'deep', 'efficient'] as $t) {
        $target = obl_navigation_select_target($pgroup, $test_pls, $t, $pdata);
        echo "    tendency={$t} → target=" . ($target === null ? 'null' : (int)$target) . "\n";
    }
}

echo "\n完成。\n";
