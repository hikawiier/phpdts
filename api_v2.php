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
$pdata = game_entrypoint('api');

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
    case 'game_status':
        handle_game_status();
        break;
    case 'player_info':
        handle_player_info();
        break;
    case 'player_inventory':
        handle_player_inventory();
        break;
    case 'game_map':
        handle_game_map();
        break;
    case 'game_log':
        handle_game_log();
        break;
    case 'chat_list':
        handle_chat_list();
        break;
    case 'debug_log':
        handle_debug_log();
        break;
    case 'ai_dump_save':
        handle_ai_dump_save();
        break;
    case 'tile_actions':
        handle_tile_actions();
        break;
    case 'obl_log':
        handle_obl_log();
        break;
    default:
        api_error('无效的API请求', 'INVALID_ACTION');
}

function handle_game_status() {
    global $gamenum, $gamestate, $groomid, $groomnums, $groomownid, $gruleset;
    global $starttime, $winmode, $winner;
    global $arealist, $areanum, $areatime, $areawarn;
    global $validnum, $alivenum, $deathnum;
    global $afktime, $optime, $weather;
    global $hack, $hdamage, $hplayer, $combonum;
    global $gamevars;
    global $noisetime, $noisepls, $noiseid, $noiseid2, $noisemode;
    global $rdown, $bdown, $ldown, $kdown;

    api_response('success', array(
        // 基本游戏信息 / Basic game info
        'gamenum' => $gamenum,          // 局数编号
        'gamestate' => $gamestate,      // 游戏状态 0=等待 10=准备 20=进行 30=停止 40=连斗
        'groomid' => $groomid,          // 房间ID 0=大厅
        'groomnums' => $groomnums,      // 房间总数
        'groomownid' => $groomownid,    // 房主ID
        'gruleset' => $gruleset,        // 规则集
        'starttime' => $starttime,      // 开始时间戳
        'winmode' => $winmode,           // 胜利模式 1=常胜 2=团战 3=单人 4=队伍 5=随机
        'winner' => $winner,             // 胜利者名称
        // 禁区信息 / Danger area info
        'arealist' => $arealist,        // 禁区编号数组
        'areanum' => $areanum,          // 当前禁区数量
        'areatime' => $areatime,        // 下次增加禁区时间戳
        'areawarn' => $areawarn,        // 当前禁区的警告等级
        // 人数统计 / Player count
        'validnum' => $validnum,        // 总人数(含NPC)
        'alivenum' => $alivenum,        // 存活人数
        'deathnum' => $deathnum,         // 死亡人数
        // 时间信息 / Time info
        'afktime' => $afktime,          // 挂机判定时间戳(超过则踢出)
        'optime' => $optime,            // 最后操作时间戳
        'weather' => $weather,           // 天气 详见gamedate/cache/resources_1.php中的$wthinfo
        // 种火信息 / Hack info
        'hack' => $hack,                 // 禁区解除状态 0=关闭
        'hdamage' => $hdamage,          // 当前打出的最高伤害
        'hplayer' => $hplayer,          // 当前打出最高伤害的玩家名
        'combonum' => $combonum,         // 进入连斗需要的死亡数
        // 游戏变量 / Game variables (JSON)
        'gamevars' => $gamevars,        // 游戏变量(botplayer等) json格式
        // 四色暮状态 / Elemental down flags
        'rdown' => $rdown,               // 红暮 0=正常 1=入暮 n=第n级暮
        'bdown' => $bdown,               // 蓝暮
        'ldown' => $ldown,                // 绿暮
        'kdown' => $kdown,                // 黑暮
        // 噪音信息 / Noise info
        'noise' => array(
            'time' => $noisetime,       // 噪音发生时间
            'pls' => $noisepls,         // 噪音发生位置
            'id' => $noiseid,           // 噪音第一来源ID
            'id2' => $noiseid2,         // 噪音第二来源ID
            'mode' => $noisemode,       // 噪音模式
        ),
    ));
}

function handle_player_info() {
    global $upexp, $pdata;

    api_response('success', array(
        // 基本信息 / Basic info
        'pid' => $pdata['pid'],               // 角色ID
        'type' => $pdata['type'],             // 类型 0=PC 1~254=NPC 详见 gamedate/cache/resources_1.php中的 $typeinfo
        'name' => $pdata['name'],             // 角色名 
        'gd' => $pdata['gd'],                 // 性别 m=男 f=女
        'race' => $pdata['race'],             // 种族
        'sNo' => $pdata['sNo'],               // 编号
        'icon' => $pdata['icon'],             // 头像图标
        'club' => $pdata['club'],              // 社团ID

        // 时间信息 / Time info
        'endtime' => $pdata['endtime'],       // 结束时间
        'validtime' => $pdata['validtime'],   // 有效时间
        'deathtime' => $pdata['deathtime'],   // 死亡时间
        'cmdnum' => $pdata['cmdnum'],         // 指令数 

        // 角色信息 / Character info
        'nick' => $pdata['nick'],             // 昵称
        'nicks' => $pdata['nicks'],           // 昵称列表
        'skillpoint' => $pdata['skillpoint'], // 技能点
        'skills' => $pdata['skills'],         // 技能

        // CD与行动 / Cooldown & Action
        'cdsec' => $pdata['cdsec'],           // CD秒
        'cdmsec' => $pdata['cdmsec'],         // CD毫秒
        'cdtime' => $pdata['cdtime'],         // CD时间
        'action' => $pdata['action'],         // 当前行动
        'bid' => $pdata['bid'],               // 敌对单位ID

        // 战斗属性 / Combat stats
        'hp' => $pdata['hp'],                 // 生命值
        'mhp' => $pdata['mhp'],               // 最大生命值
        'sp' => $pdata['sp'],                 // 体力值
        'msp' => $pdata['msp'],               // 最大体力值
        'ss' => $pdata['ss'],                 // 气力值
        'mss' => $pdata['mss'],               // 最大气力值
        'att' => $pdata['att'],               // 攻击力
        'def' => $pdata['def'],               // 防御力

        // 游戏位置与等级 / Position & Level
        'pgroup' => $pdata['pgroup'],         // 当前位置所处的地图组 详见 gamedate/cache/resources_1.php中的 $typeinfo
        'pls' => $pdata['pls'],               // 当前位置的地图编号 详见 gamedate/cache/resources_1.php中的 $plsinfo 地图编号(键名)=>显示的地图名(键值)
        'lvl' => $pdata['lvl'],               // 等级
        'exp' => $pdata['exp'],               // 经验值
        'upexp' => $upexp,                    // 升级所需经验
        'money' => $pdata['money'],           // 金钱
        'rp' => $pdata['rp'],                 // 积分
        'inf' => $pdata['inf'],               // 状态标识
        'rage' => $pdata['rage'],             // 怒气值
        'pose' => $pdata['pose'],             // 姿态
        'tactic' => $pdata['tactic'],         // 应战策略
        'horizon' => $pdata['horizon'],       // 战术视界

        // 战斗记录 / Battle record
        'killnum' => $pdata['killnum'],       // 击杀数
        'state' => $pdata['state'],           // 状态

        // 武器熟练度 / Weapon proficiency
        'wp' => $pdata['wp'],                 // 熟练度-殴
        'wk' => $pdata['wk'],                 // 熟练度-斩
        'wg' => $pdata['wg'],                 // 熟练度-射
        'wc' => $pdata['wc'],                 // 熟练度-投
        'wd' => $pdata['wd'],                 // 熟练度-爆
        'wf' => $pdata['wf'],                 // 熟练度-灵

        // 队伍信息 / Team info
        'teamID' => $pdata['teamID'],         // 队伍ID
        'teamIcon' => $pdata['teamIcon'],     // 队伍图标

        // 特殊道具-背包的相关信息 不要和道具栏混淆 / Itembag info
        'extrabag_put' => $pdata['extrabag_put'],       // 装备了特殊道具背包时用到此变量 从特殊道具背包中拿出物品时用到此变量
        'extrabag' => $pdata['extrabag'],       // 装备了特殊道具背包时用到此变量
        'extrabag_num' => $pdata['extrabag_num'],         // 装备了特殊道具背包时用到此变量 用于记录背包内物品数量
        'extrabag_max' => $pdata['extrabag_max'], // 装备了特殊道具背包时用到此变量 用于记录背包可保存的物品数量上限

        // 装备信息 / Equipment
        'equipment' => array(
            // 主武器 / Main weapon
            'wep' => array(
                'name' => $pdata['wep'],      // 武器名
                'kind' => $pdata['wepk'],     // 武器种类
                'exp' => $pdata['wepe'],      // 武器熟练度
                'sk' => $pdata['weps'],       // 武器耐久
                'skk' => $pdata['wepsk'],     // 武器耐久种类
                'para' => $pdata['weppara'],  // 武器参数  json格式
            ),
            // 副武器 / Secondary weapon
            'wep2' => array(
                'name' => $pdata['wep2'],     // 副武器名
                'kind' => $pdata['wep2k'],    // 副武器种类
                'exp' => $pdata['wep2e'],      // 副武器熟练度
                'sk' => $pdata['wep2s'],       // 副武器耐久
                'skk' => $pdata['wep2sk'],     // 副武器耐久种类
                'para' => $pdata['wep2para'],  // 副武器参数  json格式
            ),
            // 身体防具 / Body armor
            'arb' => array(
                'name' => $pdata['arb'],       // 防具名
                'kind' => $pdata['arbk'],      // 防具种类
                'exp' => $pdata['arbe'],       // 防具熟练度
                'sk' => $pdata['arbs'],        // 防具耐久
                'skk' => $pdata['arbsk'],      // 防具耐久种类
                'para' => $pdata['arbpara'],   // 防具参数  json格式
            ),
            // 头部防具 / Head armor
            'arh' => array(
                'name' => $pdata['arh'],       // 头部防具名
                'kind' => $pdata['arhk'],      // 头部防具种类
                'exp' => $pdata['arhe'],       // 头部防具熟练度
                'sk' => $pdata['arhs'],        // 头部防具耐久
                'skk' => $pdata['arhsk'],      // 头部防具耐久种类
                'para' => $pdata['arhpara'],   // 头部防具参数  json格式
            ),
            // 饰品 / Accessory
            'ara' => array(
                'name' => $pdata['ara'],       // 饰品名
                'kind' => $pdata['arak'],      // 饰品种类
                'exp' => $pdata['arae'],       // 饰品熟练度
                'sk' => $pdata['aras'],        // 饰品耐久
                'skk' => $pdata['arask'],      // 饰品耐久种类
                'para' => $pdata['arapara'],   // 饰品参数  json格式
            ),
            // 脚部防具 / Feet armor
            'arf' => array(
                'name' => $pdata['arf'],       // 脚部防具名
                'kind' => $pdata['arfk'],      // 脚部防具种类
                'exp' => $pdata['arfe'],       // 脚部防具熟练度
                'sk' => $pdata['arfs'],        // 脚部防具耐久
                'skk' => $pdata['arfsk'],      // 脚部防具耐久种类
                'para' => $pdata['arfpara'],   // 脚部防具参数  json格式
            ),
            // 其他防具 / Other armor
            'art' => array(
                'name' => $pdata['art'],       // 其他防具名
                'kind' => $pdata['artk'],      // 其他防具种类
                'exp' => $pdata['arte'],       // 其他防具熟练度
                'sk' => $pdata['arts'],        // 其他防具耐久
                'skk' => $pdata['artsk'],      // 其他防具耐久种类
                'para' => $pdata['artpara'],   // 其他防具参数  json格式
            ),
        ),

        // 道具栏内物品 0~6代表不同的道具槽位 / Inventory items
        'items' => array(
            array('name' => $pdata['itm0'], 'kind' => $pdata['itmk0'], 'exp' => $pdata['itme0'], 'sk' => $pdata['itms0'], 'skk' => $pdata['itmsk0'], 'para' => $pdata['itmpara0']),
            array('name' => $pdata['itm1'], 'kind' => $pdata['itmk1'], 'exp' => $pdata['itme1'], 'sk' => $pdata['itms1'], 'skk' => $pdata['itmsk1'], 'para' => $pdata['itmpara1']),
            array('name' => $pdata['itm2'], 'kind' => $pdata['itmk2'], 'exp' => $pdata['itme2'], 'sk' => $pdata['itms2'], 'skk' => $pdata['itmsk2'], 'para' => $pdata['itmpara2']),
            array('name' => $pdata['itm3'], 'kind' => $pdata['itmk3'], 'exp' => $pdata['itme3'], 'sk' => $pdata['itms3'], 'skk' => $pdata['itmsk3'], 'para' => $pdata['itmpara3']),
            array('name' => $pdata['itm4'], 'kind' => $pdata['itmk4'], 'exp' => $pdata['itme4'], 'sk' => $pdata['itms4'], 'skk' => $pdata['itmsk4'], 'para' => $pdata['itmpara4']),
            array('name' => $pdata['itm5'], 'kind' => $pdata['itmk5'], 'exp' => $pdata['itme5'], 'sk' => $pdata['itms5'], 'skk' => $pdata['itmsk5'], 'para' => $pdata['itmpara5']),
            array('name' => $pdata['itm6'], 'kind' => $pdata['itmk6'], 'exp' => $pdata['itme6'], 'sk' => $pdata['itms6'], 'skk' => $pdata['itmsk6'], 'para' => $pdata['itmpara6']),
        ),

        'clbpara' => $pdata['clbpara'],       // 角色相关复杂参数 json格式

        // 特殊属性 / Special attributes
        'flare' => $pdata['flare'],           // 种火
        'dcloak' => $pdata['dcloak'],         // 隐蔽
        'aura' => array(
            'a' => $pdata['auraa'],           // 光环A
            'b' => $pdata['aurab'],           // 光环B
            'c' => $pdata['aurac'],           // 光环C
            'd' => $pdata['aurad'],           // 光环D
            'e' => $pdata['aurae'],           // 光环E
        ),
        'souls' => $pdata['souls'],           // 灵魂

        // 减益状态 / Debuffs
        'debuff' => array(
            'a' => $pdata['debuffa'],         // 减益A
            'b' => $pdata['debuffb'],         // 减益B
            'c' => $pdata['debuffc'],         // 减益C
        ),

        // 验证码 / Verification code
        'vcode' => $pdata['vcode'],           // 验证码

        // 状态 / Status
        'status' => array(
            'a' => $pdata['statusa'],         // 状态A
            'b' => $pdata['statusb'],         // 状态B
            'c' => $pdata['statusc'],         // 状态C
            'd' => $pdata['statusd'],         // 状态D
            'e' => $pdata['statuse'],         // 状态E
        ),

        // 社团状态 / Club status
        'clbstatus' => array(
            'a' => $pdata['clbstatusa'],      // 社团状态A
            'b' => $pdata['clbstatusb'],      // 社团状态B
            'c' => $pdata['clbstatusc'],      // 社团状态C
            'd' => $pdata['clbstatusd'],      // 社团状态D
            'e' => $pdata['clbstatuse'],      // 社团状态E
        ),

        // 昵称状态 / Nick status
        'nikstatus' => array(
            'a' => $pdata['nikstatusa'],      // 昵称状态A
            'b' => $pdata['nikstatusb'],      // 昵称状态B
            'c' => $pdata['nikstatusc'],      // 昵称状态C
            'd' => $pdata['nikstatusd'],      // 昵称状态D
            'e' => $pdata['nikstatuse'],      // 昵称状态E
        ),

        // 元素 / Elements
        'element' => array(
            '0' => $pdata['element0'],        // 元素0
            '1' => $pdata['element1'],        // 元素1
            '2' => $pdata['element2'],        // 元素2
            '3' => $pdata['element3'],        // 元素3
            '4' => $pdata['element4'],        // 元素4
            '5' => $pdata['element5'],        // 元素5
        ),
    ));
}

function handle_player_inventory() {
    global $extrabag_num, $extrabag_max, $pdata;

    // 道具槽 / Item slots: itm1~itm6 (itm0 是刚发现的物品，不在此展示)
    $slots = array();
    for ($i = 1; $i <= 6; $i++) {
        $itm = $pdata['itm' . $i];
        $itmk = $pdata['itmk' . $i];
        $itme = $pdata['itme' . $i];
        $itms = $pdata['itms' . $i];
        $empty = empty($itm) || empty($itms);
        $slots[] = array(
            'slot' => $i,
            'name' => $itm ? $itm : '',
            'kind' => $itmk ? $itmk : '',
            'effect' => (int)$itme,
            'durability' => $itms ? $itms : '0',
            'empty' => $empty
        );
    }

    api_response('success', array(
        'slots' => $slots,
        'num' => $extrabag_num,
        'limit' => $extrabag_max,
        'equipment' => array(
            'weapon' => array('name' => $pdata['wep'], 'type' => $pdata['wepk']),
            'armor' => array('name' => $pdata['arb'], 'type' => $pdata['arbk'])
        )
    ));
}

function handle_game_map() {
    global $pdata, $arealist, $areanum, $plsinfo, $hack, $areaadd;
    global $db, $tablepre;

    $data = array(
        'currentLocation' => (int)$pdata['pls'],
        'currentRegion'   => (int)$pdata['pgroup'],
        'arealist' => $arealist,
        'areanum' => $areanum,
        'areaadd' => $areaadd,
        'hack' => $hack,
        'totalAreas' => count($plsinfo)
    );

    // Oblivions 模式：附加连通性数据（按需加载当前区域 tiles）
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

function handle_game_log() {
    global $pdata, $groomid;

    $pid = $pdata['pid'];
    $log_file = GAME_ROOT . './vex/cache/log_' . $groomid . '_' . $pid . '.php';
    $log = '';
    if (file_exists($log_file)) {
        $log = file_get_contents($log_file);
    }

    api_response('success', array(
        'log' => $log,
    ));
}

function handle_chat_list() {
    global $db, $tablepre;

    $result = $db->query("SELECT * FROM {$tablepre}chat ORDER BY cid DESC LIMIT 50");
    $messages = array();
    while ($row = $db->fetch_array($result)) {
        $messages[] = array(
            'sender' => $row['name'],
            'content' => $row['content'],
            'time' => date('H:i:s', $row['chattime'])
        );
    }
    $messages = array_reverse($messages);
    api_response('success', $messages);
}

function handle_debug_log() {
    global $groomid, $cuser;

    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!$data || !is_array($data)) {
        api_error('无效的调试数据', 'INVALID_DEBUG_DATA');
    }

    $log_file = GAME_ROOT . './vex/cache/debug_move_' . $groomid . '.log';
    $dir = dirname($log_file);
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }

    $entry = array(
        'time' => date('Y-m-d H:i:s'),
        'user' => $cuser,
        'entries' => $data
    );

    $line = json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n";
    file_put_contents($log_file, $line, FILE_APPEND | LOCK_EX);

    api_response('success', array('written' => true));
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