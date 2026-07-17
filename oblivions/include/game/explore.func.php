<?php
/**
 * @module E 游戏逻辑
 * @framework E-7 探索与交互管道
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 探索与交互系统 / Oblivions exploration & interaction
//
// 实现探索、搜索、拾取、丢弃全链路，打通玩家与世界的核心交互闭环。
// 迷雾（fog）与道具发现（discovered）是两个独立关注点：
//   - fog (oblmapstates.fog)：地图格可见性（玩家是否知道该格存在/地形/可通行）
//   - discovered (oblmapitem.discovered)：道具可操作性（道具是否出现在交互界面）
// ================================================================
// 依赖：obl_global.func.php（obl_get_config）
//       vision.func.php（obl_calc_vision_range, obl_clear_fog）
//       enemy_ai.func.php（obl_discover_enemies）
//       以上由 obl_bootstrap.php 统一加载

// ----------------------------------------------------------------
// 4.1 视野更新入口（编排者：调用 vision 的 calc/clear + 本文件的 discover_items）
// ----------------------------------------------------------------

/**
 * 视野更新入口：点亮迷雾 + 发现道具
 * 由移动后钩子、原地探索命令、或玩家出生点调用
 *
 * @param int   $pgroup 当前区域
 * @param int   $pls    当前格
 * @param array &$pdata 玩家数据（读取技能等级影响发现上限）
 */
function obl_update_vision($pgroup, $pls, &$pdata) {
    // 计算视野范围（BFS）
    $visible_tiles = obl_calc_vision_range($pgroup, $pls, $pdata);

    // 子功能 1：点亮迷雾（地图格可见性）
    obl_clear_fog($pgroup, $visible_tiles);

    // 子功能 2：发现道具（道具可操作性）
    obl_discover_items($pgroup, $visible_tiles, $pdata);
}

// ----------------------------------------------------------------
// 4.1b 发现数量技能化（G-1 scavenge 技能影响发现上限）
// ----------------------------------------------------------------

/**
 * 计算玩家本次探索的道具发现上限
 *
 * 公式：discover_base + discover_per_level * scavenge_skill_level
 *
 * 兜底策略（任一条件不满足时回退 memory_range）：
 *   - $pdata['skillpara'] 缺失
 *   - scavenge 技能未注册
 *   - scavenge 技能等级为 0（与 Lv0 行为一致：使用 discover_base）
 *
 * 注意：Lv0 玩家与"技能系统未加载"行为相同——均返回 discover_base
 * （与 memory_range 对齐，避免 G-1 落地前后行为不一致）。
 *
 * @param array &$pdata 玩家数据（读取 skillpara.scavenge.level）
 * @return int 发现数量上限（>=0）
 */
function obl_get_discovery_limit(&$pdata) {
    $cfg = obl_get_config();
    $discover_base      = (int)($cfg['discover_base'] ?? 3);
    $discover_per_level = (int)($cfg['discover_per_level'] ?? 1);
    $memory_range       = (int)($cfg['memory_range'] ?? 3);

    // 兜底：skillpara 缺失 → 回退 memory_range
    if (!isset($pdata['skillpara']) || !is_array($pdata['skillpara'])) {
        return $memory_range;
    }

    // 兜底：scavenge 技能未注册 → 回退 memory_range
    if (!isset($pdata['skillpara']['scavenge']) || !is_array($pdata['skillpara']['scavenge'])) {
        return $memory_range;
    }

    $scavenge_level = isset($pdata['skillpara']['scavenge']['level'])
        ? (int)$pdata['skillpara']['scavenge']['level']
        : 0;
    if ($scavenge_level < 0) $scavenge_level = 0;

    return $discover_base + $discover_per_level * $scavenge_level;
}

// ----------------------------------------------------------------
// 4.1c 道具发现（记忆范围随机抽取，技能化发现上限）
// ----------------------------------------------------------------

/**
 * 根据发现上限，从视野内未发现道具中随机抽取 N 个设为 discovered
 *
 * 规则：
 * - 每次探索最多发现 obl_get_discovery_limit($pdata) 个道具
 *   （由 G-1 scavenge 技能等级驱动；技能系统未加载时回退 memory_range）
 * - 从视野范围内所有 discovered=0 的道具中随机抽取
 * - 距离 <= 1（脚下+相邻格）→ discovered=1（正常可见）
 * - 距离 > 1（视野边缘格）→ discovered=2（近视/拟态怪）
 * - 仅更新 discovered=0 的道具（已发现的不降级）
 * - 同一格重复探索可继续发现剩余未发现道具
 *
 * @param int   $pgroup        当前区域
 * @param array $visible_tiles [pls => ['distance' => int]]
 * @param array &$pdata        玩家数据（读取技能等级影响发现上限）
 */
function obl_discover_items($pgroup, $visible_tiles, &$pdata) {
    global $db, $tablepre;

    if (empty($visible_tiles)) return;

    $discover_limit = obl_get_discovery_limit($pdata);
    if ($discover_limit <= 0) return;

    $pgroup_i = (int)$pgroup;

    // 1. 查询视野范围内所有未发现道具
    $pls_list = implode(',', array_map('intval', array_keys($visible_tiles)));
    $result = $db->query("SELECT iid, pls FROM {$tablepre}oblmapitem
                           WHERE pgroup='$pgroup_i' AND pls IN ($pls_list) AND discovered=0");

    $undiscovered = [];
    while ($row = $db->fetch_array($result)) {
        $undiscovered[] = [
            'iid' => (int)$row['iid'],
            'pls' => (int)$row['pls'],
        ];
    }

    if (empty($undiscovered)) return;

    // 2. 随机抽取 discover_limit 个
    shuffle($undiscovered);
    $to_discover = array_slice($undiscovered, 0, $discover_limit);

    // 3. 按距离分组更新 discovered 状态
    $d1_iids = [];  // discovered=1
    $d2_iids = [];  // discovered=2

    foreach ($to_discover as $item) {
        $distance = $visible_tiles[$item['pls']]['distance'] ?? 999;
        if ($distance <= 1) {
            $d1_iids[] = $item['iid'];
        } else {
            $d2_iids[] = $item['iid'];
        }
    }

    // discovered=1：脚下和相邻格的道具
    if (!empty($d1_iids)) {
        $iid_list = implode(',', array_map('intval', $d1_iids));
        $db->query("UPDATE {$tablepre}oblmapitem
                     SET discovered=1
                     WHERE iid IN ($iid_list)");
    }

    // discovered=2：视野边缘格的道具（近视/拟态怪）
    if (!empty($d2_iids)) {
        $iid_list = implode(',', array_map('intval', $d2_iids));
        $db->query("UPDATE {$tablepre}oblmapitem
                     SET discovered=2
                     WHERE iid IN ($iid_list)");
    }
}

// ----------------------------------------------------------------
// 4.2 探索体力检查
// ----------------------------------------------------------------

/**
 * 检查玩家是否满足探索消耗的体力
 * 独立函数，便于移动后自动探索时跳过
 *
 * @param array &$pdata 玩家数据
 * @return bool true=体力充足（已扣除），false=体力不足
 */
function obl_check_explore_sp(&$pdata) {
    global $obl_log;

    $cfg = obl_get_config();
    $cost = (int)($cfg['explore_sp_cost'] ?? 0);

    if ($pdata['sp'] < $cost) {
        $obl_log->emit('explore.no_sp', 'explore');
        return false;
    }

    // 扣除体力
    $pdata['sp'] -= $cost;
    return true;
}

// ----------------------------------------------------------------
// 4.3 探索命令
// ----------------------------------------------------------------

/**
 * 探索当前格：体力检查 → 点亮迷雾 → 发现道具 → 探索后钩子
 *
 * @param array &$pdata          玩家数据
 * @param bool  $skip_sp_check   是否跳过体力检查（移动后自动探索时为 true）
 */
function obl_explore(&$pdata, $skip_sp_check = false) {
    global $obl_log;

    // 1. 体力检查（移动后自动探索跳过）
    if (!$skip_sp_check) {
        if (!obl_check_explore_sp($pdata)) {
            return;
        }
    }

    $pgroup = (int)$pdata['pgroup'];
    $pls = (int)$pdata['pls'];

    // 2. 更新视野（迷雾点亮 + 道具发现）
    obl_update_vision($pgroup, $pls, $pdata);

    // 3. 发现视野内的敌人（同时清除敌人所在格的迷雾）
    // obl_discover_enemies 已由 obl_bootstrap.php 加载
    $vision_range = obl_get_player_vision_range($pdata);
    obl_discover_enemies($pgroup, $pls, $vision_range);

    // 4. 探索日志
    $obl_log->emit('explore.success', 'explore');

    // 5. 探索后钩子
    obl_post_explore_hook($pdata);
}

// ----------------------------------------------------------------
// 4.4 探索后钩子（三段式占位骨架）
// ----------------------------------------------------------------

/**
 * 探索后钩子（三段式占位骨架）
 *
 * 三个扩展点占位（待对应子系统落地后填充）：
 *   1. obl_trigger_tile_event_points($pdata)  — 事件点触发（待事件系统落地）
 *   2. obl_apply_tile_floor_effects($pdata)   — 地板属性效果（待地板属性系统落地）
 *   3. obl_notify_explore_completes_quests($pdata) — 任务进度通知（待任务系统落地）
 *
 * 占位函数未定义时通过 function_exists 守卫跳过，避免崩溃。
 * 原型阶段每次调用末尾 emit 一条 explore.hook_completed 调试日志。
 *
 * @param array &$pdata 玩家数据
 */
function obl_post_explore_hook(&$pdata) {
    global $obl_log;

    // 1. 事件点触发（占位，待事件系统落地）
    if (function_exists('obl_trigger_tile_event_points')) {
        obl_trigger_tile_event_points($pdata);
    }

    // 2. 地板属性效果（占位，待地板属性系统落地）
    if (function_exists('obl_apply_tile_floor_effects')) {
        obl_apply_tile_floor_effects($pdata);
    }

    // 3. 任务进度通知（占位，待任务系统落地）
    if (function_exists('obl_notify_explore_completes_quests')) {
        obl_notify_explore_completes_quests($pdata);
    }

    // 调试日志：钩子完成
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('explore.hook_completed', 'explore');
    }
}

// ----------------------------------------------------------------
// 4.5 搜索建筑物（已迁移到 E-10）
// ----------------------------------------------------------------
// 旧 obl_search_poi($iaid, &$pdata) 实现已整体迁移到 E-10：
//   - 主入口：oblivions/include/game/poi/poi.search.func.php
//     新签名 obl_search_poi($pdata, $poi, $tool_id = null, $skill_id = null)
//     接收已查到的 POI 实例行 + 玩家数据引用，而非裸 iaid
//   - 事件池分发：oblivions/include/game/poi/poi.event.func.php
//   - 命令分发层 obl_command_handlers.php 改为先按 iaid 查 POI 实例 + 位置校验，
//     再调用新签名
// 本文件保留 obl_execute_mechanic 机制分发框架（life_totem/skill_totem 等机制型 POI 仍走该路径），
// 与 E-10 三档判定并列。

// ----------------------------------------------------------------
// 4.6 机制分发框架
// ----------------------------------------------------------------

/**
 * 执行 POI 机制效果（通用分发框架）
 * 新增机制只需添加 obl_mechanic_{mechanic_name}() 函数，框架自动分发
 *
 * @param array $template POI 模板配置
 * @param array &$pdata   玩家数据
 */
function obl_execute_mechanic($template, &$pdata) {
    global $obl_log;

    $mechanic = $template['mechanic'];

    // 分发到具体处理函数
    $handler = 'obl_mechanic_' . $mechanic;
    if (function_exists($handler)) {
        $handler($template, $pdata);
    } else {
        $obl_log->emit('search.mechanic_pending', 'search', [
            'mechanic' => $mechanic,
        ]);
    }
}

/**
 * 机制：增加最大生命值
 */
function obl_mechanic_max_hp_up($template, &$pdata) {
    global $obl_log;

    $value = (int)($template['mechanic_value'] ?? 0);
    if ($value <= 0) return;

    $pdata['mhp'] += $value;
    // 同时回复等量生命值
    $pdata['hp'] = min($pdata['hp'] + $value, $pdata['mhp']);

    $obl_log->emit('system.mechanic_max_hp_up', 'system', [
        'value' => $value,
        'hp'    => $pdata['hp'],
        'mhp'   => $pdata['mhp'],
    ]);
}

// ----------------------------------------------------------------
// 4.12 POI 位置查询（道具系统工作台素材查询用）
// ----------------------------------------------------------------

/**
 * 查询当前格子上的所有 POI 实例
 *
 * 用于 item_get_available_workbench_materials() 查询玩家所在格子的工作台 POI。
 * 一个格子可能有多个 POI 实例（如同时有 forge_anvil_poi 和 vent_stove），
 * 因此返回数组，由调用方遍历过滤 mechanic='craft_source'。
 *
 * @param int $pgroup 当前区域
 * @param int $pls    当前格
 * @return array POI 实例数组，每个元素是 bra_oblmappoi 的一行
 *               （含 iaid/pgroup/pls/poi_id/mechanic/mechanic_value 等字段）
 */
function obl_get_poi_at_position($pgroup, $pls) {
    global $db, $tablepre;

    $pgroup_i = (int)$pgroup;
    $pls_i = (int)$pls;

    $result = $db->query("SELECT * FROM {$tablepre}oblmappoi
                           WHERE pgroup='$pgroup_i' AND pls='$pls_i'");

    $pois = [];
    while ($row = $db->fetch_array($result)) {
        $pois[] = $row;
    }

    return $pois;
}
