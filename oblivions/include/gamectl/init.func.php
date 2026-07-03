<?php

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 游戏初始化系统 / Oblivions game initialization
//
// 完全与旧模式解耦：Oblivions 模式下 rs_game() 不再被调用，
// 由 obl_rs_game() 接管全部初始化流程。
//
// 复用旧模式基础设施：
//   - rs_reset_social()：清理社交/聊天/战斗记录
//   - rs_init_players()：创建玩家记录（bra_players 表）
//
// Oblivions 专属初始化：
//   - 建表（5 张 obl* 表）
//   - 游戏刻变量初始化
//   - 地图+POI+道具+迷雾生成
//   - 敌人生成
//   - 日志清理
// ================================================================
// 依赖：bootstrap（obl_generate_region_items + obl_get_map_data）
//       system.func.php（rs_reset_social + rs_init_players，由 common.inc.php 加载）

/**
 * Oblivions 游戏初始化主入口
 *
 * 替代旧模式的 rs_game(127)，只执行 Oblivions 需要的初始化步骤。
 * 由 state.func.php 在游戏状态机进入"游戏开始"时调用。
 *
 * @return void
 */
function obl_rs_game() {
    global $gamevars;

    // 1. 复用旧模式基础设施
    rs_reset_social();      // 清理社交/聊天/战斗记录
    rs_init_players();      // 创建玩家记录（bra_players 表）

    // 2. 加载 Oblivions 子系统函数库（确保后续函数可用）
    require_once GAME_ROOT . './oblivions/include/core/obl_bootstrap.php';

    // 3. Oblivions 专属初始化
    obl_init_tables();          // 建表（DROP + CREATE 5 张 obl* 表）
    obl_init_tick_vars();       // 游戏刻双变量初始化
    obl_init_map();             // 地图+POI+道具+迷雾生成
    obl_init_enemies();         // 敌人生成

    // 4. 清理日志文件（避免跨游戏残留）
    if (function_exists('obl_log_clear_all')) {
        obl_log_clear_all();
    }
    if (function_exists('obl_error_log_clear_all')) {
        obl_error_log_clear_all();
    }
    if (function_exists('obl_battle_log_clear_all')) {
        obl_battle_log_clear_all();
    }
}

/**
 * Oblivions 建表（DROP IF EXISTS + CREATE）
 *
 * 独立于 reset.sql：Oblivions 是可选模块，不应污染核心建表脚本。
 * 上一局 Oblivions 残留表在本局初始化时由 DROP IF EXISTS 自动清理。
 *
 * @return void
 */
function obl_init_tables() {
    global $db, $tablepre;
    $sqldir = GAME_ROOT . './oblivions/sql/';

    $tables = ['oblmappoi.sql', 'oblmapitem.sql', 'oblmapstates.sql', 'oblplayers.sql', 'oblqueue.sql', 'oblbattle_state.sql'];
    foreach ($tables as $file) {
        $sql = file_get_contents($sqldir . $file);
        // 与 rs_reset_social() 一致：CR→LF，再替换表前缀
        $sql = str_replace("\r", "\n", str_replace(' bra_', ' ' . $tablepre, $sql));
        $db->queries($sql);
    }
}

/**
 * 初始化游戏刻双变量
 *
 * obl_tick / obl_pretick
 * 由 common.inc.php 检测并驱动后续 tick 事件处理。
 *
 * @return void
 */
function obl_init_tick_vars() {
    global $gamevars;
    if (!isset($gamevars)) $gamevars = array();
    $gamevars['obl_tick'] = 0;
    $gamevars['obl_pretick'] = 0;
}

/**
 * 初始化 Oblivions 地图（POI + 道具 + 迷雾）
 *
 * 遍历所有区域，加载地图格数据，生成 POI 与散落道具，初始化迷雾状态。
 *
 * @return void
 */
function obl_init_map() {
    // 载入配置文件
    $poi_pool     = include GAME_ROOT . './oblivions/gamedata/poi_pool.php';
    $poi_table    = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    $item_table   = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    $scatter_pool = include GAME_ROOT . './oblivions/gamedata/scatter_pool.php';
    $map_data     = include GAME_ROOT . './oblivions/gamedata/map.php';

    // 遍历所有区域，按需加载该区域的地图格数据
    // map.php 的 regions 仅含元数据；tile 的 tide/passable 在 tiles/region_{pgroup}.php 中
    foreach ($map_data['regions'] as $pgroup => $region) {
        $tile_file = GAME_ROOT . "./oblivions/gamedata/tiles/region_{$pgroup}.php";
        if (!is_file($tile_file)) {
            app_log("obl_init_map(): tiles/region_{$pgroup}.php not found, skipping region.", 'WARNING');
            continue;
        }
        $tiles = include $tile_file;
        if (!is_array($tiles) || empty($tiles)) {
            continue;
        }

        // 调用 generate.func.php 入口：为该区域生成 POI 与野生散落道具
        obl_generate_region_items($pgroup, $tiles, [
            'poi_pool'     => $poi_pool,
            'poi_table'    => $poi_table,
            'item_table'   => $item_table,
            'scatter_pool' => $scatter_pool,
        ]);
    }

    // 初始化迷雾（所有可通行格 fog=0，玩家出生时再点亮视野）
    obl_init_fog($map_data);
}

/**
 * 初始化 Oblivions 图格迷雾
 *
 * 为所有可通行格插入 oblmapstates 记录，fog=0（未探索）。
 * 玩家出生时由 obl_update_vision() 点亮出生格及视野范围。
 *
 * @param array $map_data map.php 返回的地图结构
 * @return void
 */
function obl_init_fog($map_data) {
    global $db, $tablepre;

    $values = array();
    foreach ($map_data['regions'] as $pgroup => $region) {
        $pgroup = (int)$pgroup;
        $tile_file = GAME_ROOT . "./oblivions/gamedata/tiles/region_{$pgroup}.php";
        if (!is_file($tile_file)) continue;
        $tiles = include $tile_file;
        if (!is_array($tiles)) continue;

        foreach ($tiles as $pls => $tile) {
            // 仅可通行格建立状态记录（不可通行格无需迷雾管理）
            if (empty($tile['passable'])) continue;
            $pls = (int)$pls;
            $values[] = "($pgroup, $pls, 0, 0, '')";
        }
    }

    // 分批插入，每批 500 条
    foreach (array_chunk($values, 500) as $batch) {
        $qry = "INSERT INTO {$tablepre}oblmapstates (pgroup, pls, fog, damaged, flags) VALUES " . implode(',', $batch);
        $db->query($qry);
    }
}

// ================================================================
// 敌人生成（从 enemy_ai.func.php 移入，属于"游戏初始化"而非"AI 行为"）
// ================================================================

/**
 * 生成所有区域的 NPC 敌人
 *
 * 按 enemy_pool.php 配置，在每个区域的对应潮汐区格上生成敌人。
 * 生成规则：
 * - 只选 passable=1 的格
 * - 排除区域出入口（entrance_pls / exit_pls）
 * - 排除已被其他单位占用的格（一个格一个单位）
 * - 敌人只生成在对应潮汐区的格上
 *
 * @return void
 */
function obl_init_enemies() {
    global $db, $tablepre;

    // 载入敌人配置和生成池
    $enemy_pool = require GAME_ROOT . './oblivions/gamedata/enemy_pool.php';

    // 获取所有区域
    $map = obl_get_map_data();
    $regions = $map['regions'];

    foreach ($regions as $pgroup => $region) {
        $pgroup = (int)$pgroup;

        // 加载该区域的 tiles（含 tide 字段）
        $map_data = obl_get_map_data($pgroup);
        $tiles = $map_data['tiles'][$pgroup];

        // 统计该区域各潮汐区的格数，按潮汐区分组
        $tide_tiles = array('shallow' => array(), 'deep' => array(), 'abyss' => array());
        foreach ($tiles as $pls => $tile) {
            $tide = isset($tile['tide']) ? $tile['tide'] : 'shallow';
            if (!empty($tile['passable']) && isset($tide_tiles[$tide])) {
                $tide_tiles[$tide][] = (int)$pls;
            }
        }

        // 查询该区域已占用的位置（玩家初始位置 + 已生成的 NPC）
        $occupied = obl_get_occupied_positions($pgroup);

        // 排除出入口
        $occupied[(int)$region['entrance_pls']] = true;
        $occupied[(int)$region['exit_pls']] = true;

        // 按潮汐区生成敌人
        foreach ($tide_tiles as $tide => $available_pls) {
            if (!isset($enemy_pool[$tide]) || empty($available_pls)) continue;

            foreach ($enemy_pool[$tide] as $entry) {
                $enemy_type = (int)$entry['enemy_type'];
                $count = is_array($entry['count'])
                    ? rand($entry['count'][0], $entry['count'][1])
                    : (int)$entry['count'];

                for ($i = 0; $i < $count; $i++) {
                    // 从可用格中随机选一个未被占用的
                    $pls = obl_pick_available_tile($available_pls, $occupied);
                    if ($pls === false) break;  // 该潮汐区格不够

                    obl_create_enemy_record($enemy_type, $pgroup, $pls);
                    $occupied[$pls] = true;  // 标记占用
                }
            }
        }
    }
}

/**
 * 创建敌人记录
 *
 * @param int $enemy_type 敌人类型 ID（对应 enemies_config.php 的 key）
 * @param int $pgroup     区域 ID
 * @param int $pls        格子 ID
 * @return int|false 返回新创建的 pid，失败返回 false
 */
function obl_create_enemy_record($enemy_type, $pgroup, $pls) {
    global $db, $tablepre, $obl_enemies_config, $obl_error_log;

    // 载入敌人配置（按需）
    if (!isset($obl_enemies_config)) {
        include GAME_ROOT . './oblivions/gamedata/enemies_config.php';
    }

    $config = isset($obl_enemies_config[$enemy_type]) ? $obl_enemies_config[$enemy_type] : null;
    if (!$config) {
        // 敌人配置缺失属于系统级异常（敌人 NPC 已生成但配置被删），
        // 记录到错误日志，前端可通过 ?action=obl_error 感知
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('enemy_ai.config_missing', array(
                'enemy_type' => $enemy_type,
                'pgroup'     => $pgroup,
                'pls'        => $pls,
            ), 'api');
        }
        return false;
    }

    $itemmaxslots = 6;
    $empty_itempara = array_fill(0, $itemmaxslots + 1, null);  // index 0=特殊槽，1-6=普通槽

    # 构造 skillpara 新格式：{"skill_id": {"lstact": 0}, ...}
    $skillpara_init = array();
    foreach ($config['skills'] as $skill_id) {
        $skillpara_init[$skill_id] = array('lstact' => 0);
    }

    $enemy = array(
        'type'   => $enemy_type,
        'name'   => $config['name'],
        'pass'   => '',
        'gd'     => $config['gd'],
        'icon'   => $config['icon'],
        'action' => '',
        'bid'    => 0,
        'hp'     => $config['hp'],
        'mhp'    => $config['mhp'],
        'sp'     => $config['sp'],
        'msp'    => $config['msp'],
        'att'    => $config['att'],
        'def'    => $config['def'],
        'ap'     => 10,
        'max_ap' => 10,
        'pgroup' => $pgroup,
        'pls'    => $pls,
        'lvl'    => $config['lvl'],
        'exp'    => 0,
        'state'  => 0,
        // 装备字段（7 槽 × ID + 6 运行时字段，初始全空）
        'wepid' => '', 'wep' => '', 'wepk' => '', 'wepe' => 0, 'weps' => '0', 'wepsk' => '', 'weppara' => '',
        'wep2id' => '', 'wep2' => '', 'wep2k' => '', 'wep2e' => 0, 'wep2s' => '0', 'wep2sk' => '', 'wep2para' => '',
        'arbid' => '', 'arb' => '', 'arbk' => '', 'arbe' => 0, 'arbs' => '0', 'arbsk' => '', 'arbpara' => '',
        'arhid' => '', 'arh' => '', 'arhk' => '', 'arhe' => 0, 'arhs' => '0', 'arhsk' => '', 'arhpara' => '',
        'araid' => '', 'ara' => '', 'arak' => '', 'arae' => 0, 'aras' => '0', 'arask' => '', 'arapara' => '',
        'arfid' => '', 'arf' => '', 'arfk' => '', 'arfe' => 0, 'arfs' => '0', 'arfsk' => '', 'arfpara' => '',
        'artid' => '', 'art' => '', 'artk' => '', 'arte' => 0, 'arts' => '0', 'artsk' => '', 'artpara' => '',
        // 道具栏
        'itempara'     => json_encode($empty_itempara, JSON_UNESCAPED_UNICODE),
        'itemmaxslots' => $itemmaxslots,
        // Oblivions 专属 JSON 字段
        'tacpara'   => json_encode(array('slots' => $config['strategy_slots']), JSON_UNESCAPED_UNICODE),
        'skillpara' => json_encode($skillpara_init, JSON_UNESCAPED_UNICODE),
        'oblpara'   => json_encode(array(
            'ai_type'       => $config['ai_type'],
            'vision_range'  => $config['vision_range'],
            'action_chance' => $config['action_chance'],
            'combat_skills' => isset($config['combat_skills']) ? $config['combat_skills'] : array('unarmed_strike'),
        ), JSON_UNESCAPED_UNICODE),
        'discovered' => 0,
    );

    $db->array_insert("{$tablepre}oblplayers", $enemy);

    // 获取插入的 pid
    $result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE type='{$enemy_type}' AND pgroup='{$pgroup}' AND pls='{$pls}' ORDER BY pid DESC LIMIT 1");
    $row = $db->fetch_array($result);
    return $row ? (int)$row['pid'] : false;
}

/**
 * 获取指定区域所有已占用的 pls（玩家 + NPC）
 *
 * @param int $pgroup 区域 ID
 * @return array {pls => true} 已占用的格集合
 */
function obl_get_occupied_positions($pgroup) {
    global $db, $tablepre;
    $occupied = array();
    $result = $db->query("SELECT pls FROM {$tablepre}oblplayers WHERE pgroup='{$pgroup}' AND state=0");
    while ($row = $db->fetch_array($result)) {
        $occupied[(int)$row['pls']] = true;
    }
    return $occupied;
}

/**
 * 从可用格列表中随机选一个未被占用的
 *
 * @param array $available_pls 可用格 pls 列表
 * @param array &$occupied     已占用格集合（引用传递，选中后会被标记）
 * @return int|false 选中的 pls，无可用格返回 false
 */
function obl_pick_available_tile($available_pls, &$occupied) {
    $candidates = array();
    foreach ($available_pls as $pls) {
        if (!isset($occupied[$pls])) {
            $candidates[] = $pls;
        }
    }
    if (empty($candidates)) return false;
    return $candidates[array_rand($candidates)];
}
