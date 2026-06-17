<?php

define('CURSCRIPT', 'api');

# 这个api文件不处理非登录、非游戏中的请求
# 怎么注释也有自动补全，嘴给你你替我说吧
# 具体的游戏数据要通过 common.inc.php 和 game.func.php 拉取
# 大部分传向前端的游戏数据都在 common.inc.php 和 game.func.php 声明过了
# 但是，类似的东西（比如$upexp，存在 state.func.php里） 还是东一块西一块的 ，如果发现要用但是没有的时候，把它们从其他文件清理出来，统一到上面两个文件里处理，未来再统一转移到一个规范文件里

require_once './include/core/common.inc.php';
require_once './include/gamectl/game.func.php';
require_once './include/gamectl/player_auth.func.php';
require_once './include/core/entrypoint.php';

// 玩家认证（统一入口骨架）/ Player authentication (unified entrypoint)
// Oblivions 模式：使用 oblplayers 独立数据层
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
	require_once GAME_ROOT.'./oblivions/include/game/player.func.php';
	$pdata = obl_game_entrypoint('api');
} else {
	$pdata = game_entrypoint('api');
}

header('Content-Type: application/json');

// CORS：生产环境只允许同源，开发环境可通过配置扩展
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if ($origin) {
    $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https' : 'http';
    $self_origin = $scheme . '://' . $_SERVER['HTTP_HOST'];
    $is_same_origin = (strpos($origin, $self_origin) === 0);

    // 如需允许额外的开发地址，在此数组中添加
    $extra_origins = array();
    // $extra_origins[] = 'http://localhost:3000';

    if ($is_same_origin || in_array($origin, $extra_origins)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    }
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function api_response($status, $data = null, $message = '') {
    echo json_encode(array(
        'status' => $status,
        'data' => $data,
        'message' => $message
    ));
    exit;
}

function api_error($message, $code = 'ERROR') {
    echo json_encode(array(
        'status' => 'error',
        'message' => $message,
        'code' => $code
    ));
    exit;
}

$action = isset($_REQUEST['action']) ? $_REQUEST['action'] : '';

switch ($action) {
    case 'player_info':
        handle_player_info();
        break;
    case 'player_inventory':
        handle_player_inventory();
        break;
    case 'game_map':
        handle_game_map();
        break;
    case 'tile_actions':
        handle_tile_actions();
        break;
    case 'obl_log':
        handle_obl_log();
        break;
    case 'ai_dump_save':
        handle_ai_dump_save();
        break;
    default:
        api_error('无效的API请求', 'INVALID_ACTION');
}

function handle_player_info() {
    global $upexp, $pdata;

    // Oblivions 模式：oblplayers 独立数据层，字段精简
    // 只返回 oblplayers 表中存在的字段 + obl 专属 JSON 字段
    api_response('success', array(
        // 基本信息 / Basic info
        'pid'   => $pdata['pid'],
        'type'  => $pdata['type'],
        'name'  => $pdata['name'],
        'gd'    => $pdata['gd'],
        'icon'  => $pdata['icon'],

        // 战斗状态 / Combat state
        'action' => $pdata['action'],
        'bid'    => $pdata['bid'],

        // 战斗属性 / Combat stats
        'hp'  => $pdata['hp'],
        'mhp' => $pdata['mhp'],
        'sp'  => $pdata['sp'],
        'msp' => $pdata['msp'],
        'att' => $pdata['att'],
        'def' => $pdata['def'],

        // AP（Oblivions 专属）/ Action points
        'ap'     => $pdata['ap'],
        'max_ap' => $pdata['max_ap'],

        // 位置与进度 / Position & Level
        'pgroup' => $pdata['pgroup'],
        'pls'    => $pdata['pls'],
        'lvl'    => $pdata['lvl'],
        'exp'    => $pdata['exp'],
        'upexp'  => $upexp,
        'state'  => $pdata['state'],

        // 道具栏 / Inventory
        'itemmaxslots' => $pdata['itemmaxslots'],

        // Oblivions 专属 JSON 字段 / Oblivions JSON fields
        'tacpara'   => $pdata['tacpara'],
        'skillpara' => $pdata['skillpara'],
        'oblpara'   => $pdata['oblpara'],

        // 装备信息 / Equipment（7 槽 × 6 字段）
        'equipment' => array(
            'wep'  => array('name' => $pdata['wep'],  'kind' => $pdata['wepk'],  'exp' => $pdata['wepe'],  'sk' => $pdata['weps'],  'skk' => $pdata['wepsk'],  'para' => $pdata['weppara']),
            'wep2' => array('name' => $pdata['wep2'], 'kind' => $pdata['wep2k'], 'exp' => $pdata['wep2e'], 'sk' => $pdata['wep2s'], 'skk' => $pdata['wep2sk'], 'para' => $pdata['wep2para']),
            'arb'  => array('name' => $pdata['arb'],  'kind' => $pdata['arbk'],  'exp' => $pdata['arbe'],  'sk' => $pdata['arbs'],  'skk' => $pdata['arbsk'],  'para' => $pdata['arbpara']),
            'arh'  => array('name' => $pdata['arh'],  'kind' => $pdata['arhk'],  'exp' => $pdata['arhe'],  'sk' => $pdata['arhs'],  'skk' => $pdata['arhsk'],  'para' => $pdata['arhpara']),
            'ara'  => array('name' => $pdata['ara'],  'kind' => $pdata['arak'],  'exp' => $pdata['arae'],  'sk' => $pdata['aras'],  'skk' => $pdata['arask'],  'para' => $pdata['arapara']),
            'arf'  => array('name' => $pdata['arf'],  'kind' => $pdata['arfk'],  'exp' => $pdata['arfe'],  'sk' => $pdata['arfs'],  'skk' => $pdata['arfsk'],  'para' => $pdata['arfpara']),
            'art'  => array('name' => $pdata['art'],  'kind' => $pdata['artk'],  'exp' => $pdata['arte'],  'sk' => $pdata['arts'],  'skk' => $pdata['artsk'],  'para' => $pdata['artpara']),
        ),
    ));
}

function handle_player_inventory() {
    global $pdata;

    // Oblivions 模式：从 itempara JSON 数组渲染道具栏
    $slots = array();
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    $itempara = isset($pdata['itempara']) && is_array($pdata['itempara']) ? $pdata['itempara'] : array();
    $used_count = 0;

    // 普通槽位 1~maxslots（index 0 为特殊槽，不在此展示）
    for ($i = 1; $i <= $maxslots; $i++) {
        $item = isset($itempara[$i]) ? $itempara[$i] : null;
        $empty = empty($item) || !is_array($item);
        if (!$empty) $used_count++;
        $slots[] = array(
            'slot' => $i,
            'name' => !$empty && isset($item['itm']) ? $item['itm'] : '',
            'kind' => !$empty && isset($item['itmk']) ? $item['itmk'] : '',
            'effect' => !$empty && isset($item['itme']) ? (int)$item['itme'] : 0,
            'durability' => !$empty && isset($item['itms']) ? $item['itms'] : '0',
            'empty' => $empty
        );
    }

    api_response('success', array(
        'slots' => $slots,
        'num' => $used_count,
        'limit' => $maxslots,
        'equipment' => array(
            'weapon' => array('name' => $pdata['wep'], 'type' => $pdata['wepk']),
            'armor' => array('name' => $pdata['arb'], 'type' => $pdata['arbk'])
        )
    ));
}

function handle_game_map() {
    global $pdata, $plsinfo;
    global $db, $tablepre;

    // Oblivions 模式：只返回 obl 前端需要的字段（无禁区系统）
    $data = array(
        'currentLocation' => (int)$pdata['pls'],
        'currentRegion'   => (int)$pdata['pgroup'],
    );

    // 附加连通性数据（按需加载当前区域 tiles）
    if (oblivions_is_active()) {
        include_once GAME_ROOT . './oblivions/include/game/move.func.php';
        $cur_pgroup = (int)$pdata['pgroup'];
        $map = obl_get_map_data($cur_pgroup);
        $data['links'] = array(
            'regions' => $map['regions'],
            'tiles'   => $map['tiles'],
            'grids'   => $map['grids'],
            'move_range' => obl_get_move_range(),
        );

        // 迷雾数据：查询当前区域已点亮（fog=1）的格子，稀疏表示 {pls: 1}
        // 未列出的格子默认 fog=0（迷雾中）。仅查当前区域，与 tiles 数据范围对齐。
        $fog_data = array();
        $fog_result = $db->query("SELECT pls FROM {$tablepre}oblmapstates
                                   WHERE pgroup='$cur_pgroup' AND fog=1");
        while ($row = $db->fetch_array($fog_result)) {
            $fog_data[(int)$row['pls']] = 1;
        }
        $data['links']['fog'] = array($cur_pgroup => $fog_data);
    }

    api_response('success', $data);
}

function handle_ai_dump_save() {
    global $groomid, $cuser;

    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        api_error('空数据', 'EMPTY_DATA');
    }

    $log_file = GAME_ROOT . './vex/cache/ai_dump_' . $groomid . '.jsonl';
    $dir = dirname($log_file);
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }

    // JSON Lines 追加写入，每行末尾加换行
    $payload = trim($raw);
    $lines = explode("\n", $payload);
    $valid_lines = array();
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line)) continue;
        // 验证每行是合法 JSON
        json_decode($line);
        if (json_last_error() === JSON_ERROR_NONE) {
            $valid_lines[] = $line;
        }
    }

    if (!empty($valid_lines)) {
        $content = implode("\n", $valid_lines) . "\n";
        file_put_contents($log_file, $content, FILE_APPEND | LOCK_EX);
    }

    api_response('success', array('written' => count($valid_lines)));
}

/**
 * tile_actions — 当前格交互数据
 *
 * 返回当前格的 POI 列表 + 已发现道具（按 iaid 分组）。
 * POI 仅在迷雾清除（fog=1）后可见；道具仅在 discovered>0 时可见。
 *
 * 返回结构：
 *   pois         — POI 数组，每个 POI 含 iaid/name/desc/searchable/repeatable/searched/items...
 *   ground_items — 脚边散落道具（iaid=0）数组
 */
function handle_tile_actions() {
    global $pdata, $db, $tablepre;

    if (!oblivions_is_active()) {
        api_error('非 Oblivions 模式', 'NOT_OBLIVIONS');
    }

    $pgroup = (int)$pdata['pgroup'];
    $pls = (int)$pdata['pls'];

    // 1. 读取当前格 POI（仅迷雾清除后的）
    $poi_result = $db->query("SELECT p.* FROM {$tablepre}oblmappoi p
                               INNER JOIN {$tablepre}oblmapstates s
                               ON p.pgroup=s.pgroup AND p.pls=s.pls
                               WHERE p.pgroup='$pgroup' AND p.pls='$pls' AND s.fog=1");
    $pois = array();
    $poi_iaids = array();

    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';

    while ($poi = $db->fetch_array($poi_result)) {
        $poi_id = $poi['poi_id'];
        $tpl = isset($poi_table[$poi_id]) ? $poi_table[$poi_id] : null;
        if (!$tpl) continue;

        $poi_iaids[] = (int)$poi['iaid'];
        $poi_data = array(
            'iaid'          => (int)$poi['iaid'],
            'poi_id'        => $poi_id,
            'name'          => $tpl['name'],
            'desc'          => $tpl['desc'],
            'searchable'    => !empty($tpl['searchable']),
            'repeatable'    => !empty($tpl['repeatable']),
            'searched'      => !empty($poi['searched']),
            'search_count'  => (int)$poi['search_count'],
            'items'         => array(),
        );

        // 可重复搜索属性
        if (!empty($tpl['repeatable'])) {
            $poi_data['repeat_limit'] = (int)($tpl['repeat_limit'] ?? 0);
            $poi_data['repeat_cooldown'] = (int)($tpl['repeat_cooldown'] ?? 0);
        }

        // 机制属性
        if (!empty($tpl['mechanic'])) {
            $poi_data['mechanic'] = $tpl['mechanic'];
            if (isset($tpl['mechanic_value'])) {
                $poi_data['mechanic_value'] = $tpl['mechanic_value'];
            }
            if (isset($tpl['mechanic_params'])) {
                $poi_data['mechanic_params'] = $tpl['mechanic_params'];
            }
        }

        $pois[] = $poi_data;
    }

    // 2. 读取当前格已发现的道具（按 iaid 分组）
    $item_result = $db->query("SELECT * FROM {$tablepre}oblmapitem
                                WHERE pgroup='$pgroup' AND pls='$pls' AND discovered>0");

    $items_by_iaid = array();  // iaid => [item, ...]
    $ground_items = array();   // iaid=0 的道具

    while ($item = $db->fetch_array($item_result)) {
        $iaid = (int)$item['iaid'];
        $item_data = array(
            'iid'       => (int)$item['iid'],
            'item_id'   => $item['item_id'],
            'itm'       => $item['itm'],
            'itmk'      => $item['itmk'],
            'itme'      => (int)$item['itme'],
            'itms'      => $item['itms'],
            'itmsk'     => $item['itmsk'],
            'itmpara'   => $item['itmpara'],
            'discovered'=> (int)$item['discovered'],
        );

        // 近视道具附加信息
        if ((int)$item['discovered'] === 2) {
            $fake_id = $item['fake_item_id'];
            if (!empty($fake_id)) {
                $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
                $display_name = isset($item_table[$fake_id])
                    ? $item_table[$fake_id]['itm'] . '（？）'
                    : $item['itm'] . '（？）';
            } else {
                $display_name = $item['itm'] . '（？）';
            }
            $item_data['display_name'] = $display_name;
            $item_data['fake_item_id'] = $fake_id;
            $item_data['is_trap'] = !empty($item['is_trap']) ? 1 : 0;
        }

        if ($iaid === 0) {
            $ground_items[] = $item_data;
        } else {
            if (!isset($items_by_iaid[$iaid])) {
                $items_by_iaid[$iaid] = array();
            }
            $items_by_iaid[$iaid][] = $item_data;
        }
    }

    // 3. 将道具分配到对应 POI
    foreach ($pois as &$poi) {
        if (isset($items_by_iaid[$poi['iaid']])) {
            $poi['items'] = $items_by_iaid[$poi['iaid']];
        }
    }
    unset($poi);

    api_response('success', array(
        'pois'         => $pois,
        'ground_items' => $ground_items,
    ));
}

/**
 * obl_log — 读取 Oblivions 结构化日志
 *
 * 返回当前玩家的结构化日志条目数组（按时间正序）。
 * 仅在 Oblivions 模式下可用。
 */
function handle_obl_log() {
    global $pdata, $groomid;

    if (!oblivions_is_active()) {
        api_error('仅在 Oblivions 模式下可用', 'NOT_OBLIVIONS');
    }

    include_once GAME_ROOT . './oblivions/include/game/log.func.php';

    $pid = (int)$pdata['pid'];
    $entries = obl_log_load($groomid, $pid);

    api_response('success', array(
        'entries' => $entries,
        'total'   => count($entries),
    ));
}

?>