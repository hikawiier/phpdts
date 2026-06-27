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
	require_once GAME_ROOT.'./oblivions/include/core/obl_bootstrap.php';
	$pdata = obl_game_entrypoint('api');

	// TODO: battle 状态防呆校验待重新实现（旧 obl_validate_battle_state 已随 tick 模块重构删除）

	// 日志持久化：$obl_log 在 common.inc.php 中初始化，请求结束时统一持久化
	// 用 register_shutdown_function 确保所有 exit 路径都能持久化
	register_shutdown_function(function() {
		global $obl_log, $obl_error_log, $obl_battle_log, $groomid, $pdata;
		if ($obl_log && $obl_log->hasEntries() && isset($pdata['pid'])) {
			obl_log_persist($obl_log, $groomid, $pdata['pid']);
		}
		// 错误日志持久化（与 obl_log 物理隔离，独立存储）
		if (isset($obl_error_log) && $obl_error_log && $obl_error_log->hasEntries() && isset($pdata['pid'])) {
			obl_error_log_persist($obl_error_log, $groomid, $pdata['pid']);
		}
		// 战斗日志持久化（突袭在 tick 结算中产生，需在请求结束时持久化）
		if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries() && isset($pdata['pid'])) {
			obl_battle_log_persist($obl_battle_log, $groomid, $pdata['pid']);
		}
	});
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
    case 'obl_error':
        handle_obl_error();
        break;
    case 'battle_log':
        handle_battle_log();
        break;
    case 'enemies':
        handle_obl_enemies();
        break;
    case 'skill_list':
        handle_skill_list();
        break;
    case 'ai_dump_save':
        handle_ai_dump_save();
        break;
    case 'skill_cd_check':
        handle_skill_cd_check();
        break;
    case 'heartbeat':
        api_response('success');
        break;
    default:
        api_error('无效的API请求', 'INVALID_ACTION');
}

/**
 * skill_cd_check — 查询技能是否定义了冷却
 *
 * 纯配置查询，不涉及玩家状态。
 * 前端据此约束有 CD 的技能在装填队列中最多出现一次。
 *
 * GET / POST 参数：
 *   skill_id  string  技能 ID
 *
 * 返回：
 *   has_cd    bool    true=技能有 CD 定义，false=无 CD 或配置不存在
 */
function handle_skill_cd_check() {
    if (!oblivions_is_active()) {
        api_error('仅在 Oblivions 模式下可用', 'NOT_OBLIVIONS');
    }

    $skill_id = isset($_REQUEST['skill_id']) ? trim($_REQUEST['skill_id']) : '';
    if ($skill_id === '') {
        api_error('缺少 skill_id 参数', 'MISSING_PARAM');
    }

    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    $has_cd = skill_has_cd($skill_id);

    api_response('success', array('has_cd' => $has_cd));
}

function handle_player_info() {
    global $upexp, $pdata, $gamevars, $groomid;

    // Oblivions 模式：oblplayers 独立数据层，字段精简
    // 只返回 oblplayers 表中存在的字段 + obl 专属 JSON 字段

    // 先攻队列数据（如果玩家在战斗中）
    $battle_queue = null;
    if ($pdata['action'] === 'battle' && $pdata['bid']) {
        if (!function_exists('obl_fetch_queue_all_by_qid')) {
            include_once GAME_ROOT . './oblivions/include/game/sql.func.php';
        }
        $qid = (int)$pdata['bid'];
        $queue_rows = obl_fetch_queue_all_by_qid($qid);
        if (!empty($queue_rows)) {
            $battle_queue = array(
                'qid' => $qid,
                'queue' => array(),
            );
            foreach ($queue_rows as $qrow) {
                $battle_queue['queue'][] = array(
                    'pid' => (int)$qrow['pid'],
                    'type' => (int)$qrow['type'],
                    'myorder' => (int)$qrow['myorder'],
                    'done' => (int)$qrow['done'],
                );
            }
        }
    }

    api_response('success', array(
        // 基本信息 / Basic info
        'pid'   => $pdata['pid'],
        'type'  => $pdata['type'],
        'name'  => $pdata['name'],
        'gd'    => $pdata['gd'],
        'icon'  => $pdata['icon'],

        // 房间 ID（供前端调用零依赖接口如 mark_battle_log_played.php）
        'groomid' => $groomid,

        // 战斗状态 / Combat state
        'action' => $pdata['action'],
        'bid'    => $pdata['bid'],

        // 先攻队列数据（新框架：从 bra_oblqueue 表查询）
        'battle_queue' => $battle_queue,

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

        // 调试用：游戏刻状态 / Debug: tick state
        'obl_tick'     => isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0,
        'obl_pretick'  => isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0,
        // 战斗状态机：当前玩家所在战场的状态（单一数据源）
        // IDLE / PLAYER_TURN / PROCESSING
        'obl_battle_state' => (function_exists('obl_battle_state_get') && (int)$pdata['bid'] > 0)
            ? obl_battle_state_get((int)$pdata['bid'])
            : 'IDLE',

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

    $log_file = GAME_ROOT . './oblivions/cache/debug/ai_dump_' . $groomid . '.jsonl';
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

/**
 * obl_error — 读取错误日志
 *
 * 返回当前玩家的错误日志条目（OblivionsErrorLogger 条目数组）。
 * 前端独立轮询此接口，检测后端异常（如 tick 结算错误）。
 * 与 obl_log 物理隔离，错误日志不会被普通日志挤掉。
 * 仅在 Oblivions 模式下可用。
 */
function handle_obl_error() {
    global $pdata, $groomid;

    if (!oblivions_is_active()) {
        api_error('仅在 Oblivions 模式下可用', 'NOT_OBLIVIONS');
    }

    include_once GAME_ROOT . './oblivions/include/game/log.func.php';

    $pid = (int)$pdata['pid'];
    $entries = obl_error_log_load($groomid, $pid);

    api_response('success', array(
        'entries' => $entries,
        'total'   => count($entries),
    ));
}

/**
 * battle_log — 读取待播放的战斗日志
 *
 * 返回当前玩家最近一批的战斗动作日志（BattleLogEntry 数组）。
 * 前端检测 player_info.action='battle' 时拉取，播放完毕后等待玩家操作。
 * 仅在 Oblivions 模式下可用。
 */
function handle_battle_log() {
    global $pdata, $groomid;

    if (!oblivions_is_active()) {
        api_error('仅在 Oblivions 模式下可用', 'NOT_OBLIVIONS');
    }

    include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';

    $pid = (int)$pdata['pid'];
    $entries = obl_battle_log_load($groomid, $pid);

    api_response('success', array(
        'entries' => $entries,
        'total'   => count($entries),
    ));
}

/**
 * enemies API：返回当前区域已发现的敌人
 *
 * 返回 discovered=1 的敌人列表。如果玩家处于战斗状态，
 * 确保返回战斗对象（即使 discovered=0）。
 */
function handle_obl_enemies() {
    global $pdata;

    if (!oblivions_is_active()) {
        api_error('仅在 Oblivions 模式下可用', 'NOT_OBLIVIONS');
    }

    // 获取当前区域 discovered=1 的敌人
    $enemies = obl_fetch_discovered_enemies($pdata['pgroup']);

    // 如果玩家处于战斗状态，确保返回战斗对象（即使 discovered=0）
    if ($pdata['action'] == 'battle' && $pdata['bid']) {
        // $pdata['bid'] 是先攻队列 qid，不是 pid
        // 查询队列中所有参战者，找到非玩家的 NPC
        $queue_members = obl_fetch_queue_all_by_qid($pdata['bid']);
        foreach ($queue_members as $qrow) {
            $qpid = (int)$qrow['pid'];
            if ($qpid == $pdata['pid']) continue;  // 跳过玩家自己
            $battle_enemy = obl_fetch_playerdata_by_pid($qpid);
            if ($battle_enemy) {
                obl_format_playerdata($battle_enemy);
                $already_in_list = false;
                foreach ($enemies as $e) {
                    if ($e['pid'] == $battle_enemy['pid']) {
                        $already_in_list = true;
                        break;
                    }
                }
                if (!$already_in_list) {
                    $enemies[] = $battle_enemy;
                }
            }
        }
    }

    // 返回敌人数据（精简字段）
    $result = array();
    foreach ($enemies as &$enemy) {
        $result[] = obl_simplify_enemy_data($enemy);
    }

    api_response('success', array('enemies' => $result));
}

/**
 * 获取当前区域 discovered=1 的敌人
 *
 * @param int $pgroup 区域 ID
 * @return array 敌人数据数组（每个元素已格式化）
 */
function obl_fetch_discovered_enemies($pgroup) {
    global $db, $tablepre;
    $enemies = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblplayers
                          WHERE type > 0 AND pgroup='{$pgroup}' AND discovered=1");
    while ($edata = $db->fetch_array($result)) {
        obl_format_playerdata($edata);
        $enemies[] = $edata;
    }
    return $enemies;
}

/**
 * 精简敌人数据（只返回前端需要的字段）
 *
 * @param array &$enemy 敌人数据（已格式化）
 * @return array 精简后的敌人数据
 */
function obl_simplify_enemy_data(&$enemy) {
    return array(
        'pid'        => $enemy['pid'],
        'type'       => $enemy['type'],
        'name'       => $enemy['name'],
        'icon'       => $enemy['icon'],
        'gd'         => $enemy['gd'],
        'pgroup'     => $enemy['pgroup'],
        'pls'        => $enemy['pls'],
        'hp'         => $enemy['hp'],
        'mhp'        => $enemy['mhp'],
        'lvl'        => $enemy['lvl'],
        'state'      => $enemy['state'],
        'discovered' => $enemy['discovered'],
    );
}

/**
 * skill_list — 返回玩家可用技能列表
 *
 * 返回玩家 skillpara 中所有技能的配置与运行时状态（CD、AP、可用性）。
 * 前端装填区据此渲染技能列表。
 * 仅在 Oblivions 模式下可用。
 */
function handle_skill_list() {
    global $pdata;

    if (!oblivions_is_active()) {
        api_error('仅在 Oblivions 模式下可用', 'NOT_OBLIVIONS');
    }

    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';

    $skills = skill_get_available_list($pdata);

    api_response('success', array(
        'skills'       => $skills,
        'player_ap'    => isset($pdata['ap']) ? (int)$pdata['ap'] : 0,
        'player_max_ap' => isset($pdata['max_ap']) ? (int)$pdata['max_ap'] : 0,
    ));
}

?>