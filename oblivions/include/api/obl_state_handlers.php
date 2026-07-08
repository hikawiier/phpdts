<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_state_dispatch($scope, $ctx) {
    $scope = trim((string)$scope);
    switch ($scope) {
        case '':
        case 'runtime':
            return obl_state_handle_runtime_status($ctx);
        case 'player_info':
            return obl_state_handle_player_info($ctx);
        case 'battle_log':
            return obl_state_handle_battle_log($ctx);
        case 'game_map':
            return obl_state_handle_game_map($ctx);
        case 'tile_actions':
            return obl_state_handle_tile_actions($ctx);
        case 'enemies':
            return obl_state_handle_enemies($ctx);
        case 'player_inventory':
            return obl_state_handle_player_inventory($ctx);
        case 'craft_preview':
            return obl_state_handle_craft_preview($ctx);
        case 'craft_workbench_materials':
            return obl_state_handle_craft_workbench_materials($ctx);
        case 'craft_recipes':
            return obl_state_handle_craft_recipes($ctx);
        case 'obl_log':
            return obl_state_handle_obl_log($ctx);
        case 'obl_error':
            return obl_state_handle_obl_error($ctx);
        case 'skill_list':
            return obl_state_handle_skill_list($ctx);
        case 'skill_cd_check':
            return obl_state_handle_skill_cd_check($ctx);
        default:
            obl_state_throw('UNKNOWN_SCOPE', '未知 State API scope: ' . $scope);
    }
}

function obl_state_require_player() {
    global $pdata, $cuser, $cpass;

    if (isset($pdata) && is_array($pdata) && isset($pdata['pid'])) {
        return $pdata;
    }

    if (!$cuser || !$cpass) {
        obl_state_throw('AUTH_FAILED', '认证失败，请重新登录');
    }

    $pid = obl_auth_player($cuser, $cpass);
    if ($pid === false) {
        obl_state_throw('AUTH_FAILED', '找不到当前 Oblivions 玩家');
    }

    $loaded = obl_fetch_playerdata_by_pid((int)$pid);
    if (!$loaded) {
        obl_state_throw('AUTH_FAILED', '找不到当前 Oblivions 玩家');
    }

    $pdata = $loaded;
    return $pdata;
}

function obl_state_get_level_up_exp($pdata) {
    global $baseexp;
    $lvl = isset($pdata['lvl']) ? (int)$pdata['lvl'] : 0;
    $base = isset($baseexp) ? (int)$baseexp : 0;
    return round(($lvl * $base) + (($lvl + 1) * $base));
}

function obl_state_equipment_slot($pdata, $id_key, $name_key, $kind_key, $effect_key, $durability_key, $sk_key, $para_key) {
    $item_id = isset($pdata[$id_key]) ? $pdata[$id_key] : '';
    return array(
        'item_id' => $item_id,
        'itmid'   => $item_id,
        'name'    => isset($pdata[$name_key]) ? $pdata[$name_key] : '',
        'kind'    => isset($pdata[$kind_key]) ? $pdata[$kind_key] : '',
        'exp'     => isset($pdata[$effect_key]) ? $pdata[$effect_key] : 0,
        'sk'      => isset($pdata[$durability_key]) ? $pdata[$durability_key] : '0',
        'skk'     => isset($pdata[$sk_key]) ? $pdata[$sk_key] : '',
        'para'    => isset($pdata[$para_key]) ? $pdata[$para_key] : array(),
    );
}

function obl_state_build_battle_queue($pdata) {
    if (!isset($pdata['action']) || $pdata['action'] !== 'battle' || empty($pdata['bid'])) {
        return null;
    }

    $qid = (int)$pdata['bid'];
    $queue_rows = obl_fetch_queue_all_by_qid($qid);
    if (empty($queue_rows)) {
        return null;
    }

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

    return $battle_queue;
}

function obl_state_handle_runtime_status($ctx) {
    global $cuser;

    // runtime status 是纯读探针：只重载内存镜像，不推进 tick，也不创建缺失的 oblgame。
    if (function_exists('obl_gamevars_sync_to_globals')) {
        obl_gamevars_sync_to_globals(false, false);
    }

    $status = obl_tick_orchestrator_status($ctx);
    $player = $cuser ? obl_fetch_playerdata_by_name($cuser) : false;
    if ($player) {
        $qid = isset($player['bid']) ? (int)$player['bid'] : 0;
        $battle_state = $qid > 0 && function_exists('obl_battle_state_get')
            ? obl_battle_state_get($qid)
            : (defined('OBL_BS_IDLE') ? OBL_BS_IDLE : 'IDLE');
        $status['player'] = array(
            'pid' => (int)$player['pid'],
            'name' => isset($player['name']) ? (string)$player['name'] : '',
            'action' => isset($player['action']) ? (string)$player['action'] : '',
            'bid' => $qid,
            'battle_state' => $battle_state,
        );
    }

    return obl_state_response_success($status);
}

function obl_state_handle_player_info($ctx) {
    global $gamevars, $groomid;

    $pdata = obl_state_require_player();
    $battle_queue = obl_state_build_battle_queue($pdata);

    return obl_state_response_success(array(
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
        'upexp'  => obl_state_get_level_up_exp($pdata),
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

        // 装备信息（7 槽 × ID + 6 运行时字段）
        'equipment' => array(
            'wep'  => obl_state_equipment_slot($pdata, 'wepid',  'wep',  'wepk',  'wepe',  'weps',  'wepsk',  'weppara'),
            'wep2' => obl_state_equipment_slot($pdata, 'wep2id', 'wep2', 'wep2k', 'wep2e', 'wep2s', 'wep2sk', 'wep2para'),
            'arb'  => obl_state_equipment_slot($pdata, 'arbid',  'arb',  'arbk',  'arbe',  'arbs',  'arbsk',  'arbpara'),
            'arh'  => obl_state_equipment_slot($pdata, 'arhid',  'arh',  'arhk',  'arhe',  'arhs',  'arhsk',  'arhpara'),
            'ara'  => obl_state_equipment_slot($pdata, 'araid',  'ara',  'arak',  'arae',  'aras',  'arask',  'arapara'),
            'arf'  => obl_state_equipment_slot($pdata, 'arfid',  'arf',  'arfk',  'arfe',  'arfs',  'arfsk',  'arfpara'),
            'art'  => obl_state_equipment_slot($pdata, 'artid',  'art',  'artk',  'arte',  'arts',  'artsk',  'artpara'),
        ),
    ));
}

function obl_state_handle_battle_log($ctx) {
    global $groomid;

    $pdata = obl_state_require_player();
    $pid = (int)$pdata['pid'];
    $entries = obl_battle_log_load($groomid, $pid);

    return obl_state_response_success(array(
        'entries' => $entries,
        'total'   => count($entries),
    ));
}


function obl_state_handle_game_map($ctx) {
    global $db, $tablepre;

    $pdata = obl_state_require_player();

    // Oblivions 模式：只返回 obl 前端需要的字段（无禁区系统）。
    $data = array(
        'currentLocation' => (int)$pdata['pls'],
        'currentRegion'   => (int)$pdata['pgroup'],
    );

    $cur_pgroup = (int)$pdata['pgroup'];
    $map = obl_get_map_data($cur_pgroup);
    $data['links'] = array(
        'regions' => $map['regions'],
        'tiles'   => $map['tiles'],
        'grids'   => $map['grids'],
        'move_range' => obl_get_move_range(),
    );

    // 迷雾数据：查询当前区域已点亮（fog=1）的格子，稀疏表示 {pls: 1}。
    $fog_data = array();
    $fog_result = $db->query("SELECT pls FROM {$tablepre}oblmapstates
                               WHERE pgroup='" . (int)$cur_pgroup . "' AND fog=1");
    while ($row = $db->fetch_array($fog_result)) {
        $fog_data[(int)$row['pls']] = 1;
    }
    $data['links']['fog'] = array($cur_pgroup => $fog_data);

    return obl_state_response_success($data);
}

function obl_state_handle_tile_actions($ctx) {
    global $db, $tablepre;

    $pdata = obl_state_require_player();
    $pgroup = (int)$pdata['pgroup'];
    $pls = (int)$pdata['pls'];

    // 1. 读取当前格 POI（仅迷雾清除后的）。
    $poi_result = $db->query("SELECT p.* FROM {$tablepre}oblmappoi p
                               INNER JOIN {$tablepre}oblmapstates s
                               ON p.pgroup=s.pgroup AND p.pls=s.pls
                               WHERE p.pgroup='{$pgroup}' AND p.pls='{$pls}' AND s.fog=1");
    $pois = array();
    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';

    while ($poi = $db->fetch_array($poi_result)) {
        $poi_id = $poi['poi_id'];
        $tpl = isset($poi_table[$poi_id]) ? $poi_table[$poi_id] : null;
        if (!$tpl) continue;

        $poi_data = array(
            'iaid'          => (int)$poi['iaid'],
            'poi_id'        => $poi_id,
            // 兼容旧消费者保留展示字段；新界面通过 poi_id + locale 渲染。
            'name'          => isset($tpl['name']) ? $tpl['name'] : '',
            'desc'          => isset($tpl['desc']) ? $tpl['desc'] : '',
            'searchable'    => !empty($tpl['searchable']),
            'repeatable'    => !empty($tpl['repeatable']),
            'searched'      => !empty($poi['searched']),
            'search_count'  => (int)$poi['search_count'],
            'items'         => array(),
        );

        // 可重复搜索属性。
        if (!empty($tpl['repeatable'])) {
            $poi_data['repeat_limit'] = (int)($tpl['repeat_limit'] ?? 0);
            $poi_data['repeat_cooldown'] = (int)($tpl['repeat_cooldown'] ?? 0);
        }

        // 机制属性。
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

    // 2. 读取当前格已发现的道具（按 iaid 分组）。
    $item_result = $db->query("SELECT * FROM {$tablepre}oblmapitem
                                WHERE pgroup='{$pgroup}' AND pls='{$pls}' AND discovered>0");

    $items_by_iaid = array();  // iaid => [item, ...]
    $ground_items = array();   // iaid=0 的道具
    $item_table = null;

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

        // 近视道具附加信息。
        if ((int)$item['discovered'] === 2) {
            if ($item_table === null) {
                $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
            }
            $fake_id = $item['fake_item_id'];
            if (!empty($fake_id)) {
                $display_name = isset($item_table[$fake_id])
                    ? $item_table[$fake_id]['itm'] . '（？）'
                    : $item['itm'] . '（？）';
            } else {
                $display_name = isset($item_table[$item['item_id']])
                    ? $item_table[$item['item_id']]['itm'] . '（？）'
                    : $item['itm'] . '（？）';
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

    // 3. 将道具分配到对应 POI。
    foreach ($pois as &$poi) {
        if (isset($items_by_iaid[$poi['iaid']])) {
            $poi['items'] = $items_by_iaid[$poi['iaid']];
        }
    }
    unset($poi);

    return obl_state_response_success(array(
        'pois'         => $pois,
        'ground_items' => $ground_items,
    ));
}

function obl_state_handle_enemies($ctx) {
    $pdata = obl_state_require_player();

    // 获取当前区域 discovered=1 的敌人。
    $enemies = obl_state_fetch_discovered_enemies($pdata['pgroup']);

    // 如果玩家处于战斗状态，确保返回战斗对象（即使 discovered=0）。
    if ($pdata['action'] == 'battle' && $pdata['bid']) {
        // $pdata['bid'] 是先攻队列 qid，不是 pid。
        // 查询队列中所有参战者，找到非玩家的 NPC。
        $queue_members = obl_fetch_queue_all_by_qid($pdata['bid']);
        foreach ($queue_members as $qrow) {
            $qpid = (int)$qrow['pid'];
            if ($qpid == $pdata['pid']) continue;  // 跳过玩家自己。
            $battle_enemy = obl_fetch_playerdata_by_pid($qpid);
            if ($battle_enemy) {
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

    // 返回敌人数据（精简字段）。
    $result = array();
    foreach ($enemies as &$enemy) {
        $result[] = obl_state_simplify_enemy_data($enemy);
    }

    return obl_state_response_success(array('enemies' => $result));
}

function obl_state_fetch_discovered_enemies($pgroup) {
    global $db, $tablepre;
    $enemies = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblplayers
                          WHERE type > 0 AND pgroup='" . (int)$pgroup . "' AND discovered=1");
    while ($edata = $db->fetch_array($result)) {
        obl_format_playerdata($edata);
        $enemies[] = $edata;
    }
    return $enemies;
}

function obl_state_simplify_enemy_data(&$enemy) {
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


function obl_state_handle_player_inventory($ctx) {
    $pdata = obl_state_require_player();

    // Oblivions 模式：从 itempara JSON 数组渲染道具栏。
    $slots = array();
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    $itempara = isset($pdata['itempara']) && is_array($pdata['itempara']) ? $pdata['itempara'] : array();
    $used_count = 0;

    // 普通槽位 1~maxslots（index 0 为特殊槽，不在此展示）。
    $has_tag_funcs = function_exists('item_has_tag') && function_exists('item_get_tags');
    $has_stack_func = function_exists('item_get_stack');
    for ($i = 1; $i <= $maxslots; $i++) {
        $item = isset($itempara[$i]) ? $itempara[$i] : null;
        $empty = empty($item) || !is_array($item);
        if (!$empty) $used_count++;
        $item_id = !$empty && isset($item['itmid']) ? $item['itmid'] : '';
        $slots[] = array(
            'slot' => $i,
            'name' => !$empty && isset($item['itm']) ? $item['itm'] : '',
            'itmid' => $item_id,
            'item_id' => $item_id,
            'kind' => !$empty && isset($item['itmk']) ? $item['itmk'] : '',
            'itmk' => !$empty && isset($item['itmk']) ? $item['itmk'] : '',
            'effect' => !$empty && isset($item['itme']) ? (int)$item['itme'] : 0,
            'durability' => !$empty && isset($item['itms']) ? $item['itms'] : '0',
            'usable' => !$empty && $item_id !== '' && $has_tag_funcs ? item_has_tag($item_id, 'tag_usable') : false,
            'tags' => !$empty && $item_id !== '' && $has_tag_funcs ? item_get_tags($item_id) : array(),
            'stack' => !$empty && $item_id !== '' && $has_stack_func ? (bool)item_get_stack($item_id) : false,
            'empty' => $empty
        );
    }

    // itm0 缓存槽（index 0，与 slots 结构对齐，前端可复用渲染逻辑）。
    $itm0 = null;
    if (isset($itempara[0]) && is_array($itempara[0]) && !empty($itempara[0]['itmid'])) {
        $itm0_item = $itempara[0];
        $itm0_item_id = $itm0_item['itmid'];
        $itm0 = array(
            'slot' => 0,
            'name' => isset($itm0_item['itm']) ? $itm0_item['itm'] : '',
            'itmid' => $itm0_item_id,
            'item_id' => $itm0_item_id,
            'kind' => isset($itm0_item['itmk']) ? $itm0_item['itmk'] : '',
            'itmk' => isset($itm0_item['itmk']) ? $itm0_item['itmk'] : '',
            'effect' => isset($itm0_item['itme']) ? (int)$itm0_item['itme'] : 0,
            'durability' => isset($itm0_item['itms']) ? $itm0_item['itms'] : '0',
            'usable' => $has_tag_funcs ? item_has_tag($itm0_item_id, 'tag_usable') : false,
            'tags' => $has_tag_funcs ? item_get_tags($itm0_item_id) : array(),
            'stack' => $has_stack_func ? (bool)item_get_stack($itm0_item_id) : false,
            'empty' => false,
        );
    }

    return obl_state_response_success(array(
        'slots' => $slots,
        'num' => $used_count,
        'limit' => $maxslots,
        'itm0' => $itm0,
        'equipment' => array(
            'weapon' => array(
                'item_id' => isset($pdata['wepid']) ? $pdata['wepid'] : '',
                'itmid' => isset($pdata['wepid']) ? $pdata['wepid'] : '',
                'name' => isset($pdata['wep']) ? $pdata['wep'] : '',
                'type' => isset($pdata['wepk']) ? $pdata['wepk'] : '',
            ),
            'armor' => array(
                'item_id' => isset($pdata['arbid']) ? $pdata['arbid'] : '',
                'itmid' => isset($pdata['arbid']) ? $pdata['arbid'] : '',
                'name' => isset($pdata['arb']) ? $pdata['arb'] : '',
                'type' => isset($pdata['arbk']) ? $pdata['arbk'] : '',
            ),
        )
    ));
}

function obl_state_handle_craft_preview($ctx) {
    $pdata = obl_state_require_player();

    $slots = isset($_GET['slots']) ? $_GET['slots'] : '';
    $workbench_materials = isset($_GET['workbench_materials']) ? $_GET['workbench_materials'] : '';

    if ($slots === '' && $workbench_materials === '') {
        obl_state_throw('MISSING_PARAM', '缺少 slots 参数');
    }

    $slots_arr = $slots === '' ? array() : explode(',', $slots);
    $wb_arr = $workbench_materials === '' ? array() : explode(',', $workbench_materials);

    $result = item_craft_preview($slots_arr, $pdata, $wb_arr);

    return obl_state_response_success($result);
}

function obl_state_handle_craft_workbench_materials($ctx) {
    $pdata = obl_state_require_player();

    $materials = item_get_available_workbench_materials($pdata);

    return obl_state_response_success(array('workbench_materials' => $materials));
}

function obl_state_handle_craft_recipes($ctx) {
    $pdata = obl_state_require_player();

    $recipes = item_get_visible_recipes($pdata);

    return obl_state_response_success(array('recipes' => $recipes));
}


function obl_state_handle_obl_log($ctx) {
    global $groomid;

    $pdata = obl_state_require_player();
    $pid = (int)$pdata['pid'];
    $entries = obl_log_load($groomid, $pid);

    return obl_state_response_success(array(
        'entries' => $entries,
        'total'   => count($entries),
    ));
}

function obl_state_handle_obl_error($ctx) {
    global $groomid;

    $pdata = obl_state_require_player();
    $pid = (int)$pdata['pid'];
    $entries = obl_error_log_load($groomid, $pid);

    return obl_state_response_success(array(
        'entries' => $entries,
        'total'   => count($entries),
    ));
}

function obl_state_handle_skill_list($ctx) {
    $pdata = obl_state_require_player();

    $skills = skill_get_available_list($pdata);

    return obl_state_response_success(array(
        'skills'       => $skills,
        'player_ap'    => isset($pdata['ap']) ? (int)$pdata['ap'] : 0,
        'player_max_ap' => isset($pdata['max_ap']) ? (int)$pdata['max_ap'] : 0,
    ));
}

function obl_state_handle_skill_cd_check($ctx) {
    // 虽然是纯配置查询，也要求已进入 Oblivions 局内，保持 State API 认证边界一致。
    obl_state_require_player();

    $skill_id = isset($_GET['skill_id']) ? trim($_GET['skill_id']) : '';
    if ($skill_id === '') {
        obl_state_throw('MISSING_PARAM', '缺少 skill_id 参数');
    }

    $has_cd = skill_has_cd($skill_id);

    return obl_state_response_success(array('has_cd' => $has_cd));
}

?>

