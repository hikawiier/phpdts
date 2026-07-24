<?php
/**
 * @module E 游戏逻辑
 * @framework E-7 统一信息获取与探索编排系统
 *
 * 统一信息获取原语 / Unified Information Acquisition Primitive
 *
 * 设计意图（视野-探索-移动模块改造-正式代码集成设计案 §4）：
 *   移动与探索此前把信息职责固定拆分（obl_post_move_hook 仅点亮迷雾；
 *   obl_explore 调用 obl_update_vision + obl_discover_enemies）。
 *   目标设计要求两者共用统一信息获取原语，通过配置形成差异。
 *
 * 两个真实消费者：
 *   1. obl_post_move_hook（move 配置）：action_type='move'，基础预算，全集 filter
 *   2. obl_explore（explore 配置）：action_type='explore'，强化预算（技能化），全集 filter
 *   未来消费者：战斗移动 action_type='combat_move'，scene_filter=['fog','map']
 *
 * 内部流程（设计案 §4.3）：
 *   1. 计算观察范围（复用 obl_calc_vision_range）
 *   2. 按 scene_filter 过滤信息类别
 *   3. 点亮迷雾（obl_clear_fog）— 若 'fog' 在 filter
 *   4. 发现道具（obl_discover_items，按 info_budget + prob_modifier）— 若 'items' 在 filter
 *   5. 发现敌人（obl_discover_enemies）— 若 'enemies' 在 filter
 *   6. 发现 POI（obl_discover_pois）— 若 'poi' 在 filter；POI 100% 发现（§4.11）
 *   7. 返回结构化信息结果（含各类别发现清单 + 注意力等级）
 */

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ----------------------------------------------------------------
// 配置读取
// ----------------------------------------------------------------

/**
 * 读取指定 action_type 的信息获取配置（设计案 §4.4）
 *
 * 兜底策略：未知 action_type 回退到 'move' 配置，避免崩溃。
 *
 * @param string $action_type move|explore|combat_move
 * @return array [observation, info_budget, discover_prob_modifier, scene_filter]
 */
function obl_get_info_config($action_type) {
    $cfg = obl_get_config();
    $segments = isset($cfg['info_acquisition']) && is_array($cfg['info_acquisition'])
        ? $cfg['info_acquisition']
        : array();

    $key = isset($segments[$action_type]) ? $action_type : 'move';
    $segment = isset($segments[$key]) && is_array($segments[$key]) ? $segments[$key] : array();

    return array(
        'action_type'            => $key,
        'observation'            => isset($segment['observation']) && is_array($segment['observation'])
            ? $segment['observation'] : array('vision'),
        'info_budget'            => array_key_exists('info_budget', $segment)
            ? $segment['info_budget'] : 1,
        'discover_prob_modifier' => isset($segment['discover_prob_modifier'])
            ? (float)$segment['discover_prob_modifier'] : 1.0,
        'scene_filter'           => isset($segment['scene_filter']) && is_array($segment['scene_filter'])
            ? $segment['scene_filter'] : array('fog', 'map', 'items', 'enemies', 'poi'),
    );
}

// ----------------------------------------------------------------
// 已探索标记（仅落点写）
// ----------------------------------------------------------------

/**
 * 标记玩家已踏足本格（仅落点写 explored，中间格不写）
 *
 * 设计案 §4.6：explored 写入的唯一入口。在 obl_perform_move_core 成功后调用。
 * 中间路径格不写 explored（§4.4）。
 *
 * 三态语义：
 *   - explored（本字段）：玩家真实站上本格
 *   - revealed（oblmapstates.fog）：迷雾已点亮（可见地形）
 *   - currently_visible：运行时计算（obl_calc_vision_range），不持久化
 *
 * 幂等：已 explored=1 不重复写。
 *
 * @param int $pgroup 区域
 * @param int $pls    格子
 * @return void
 */
function obl_mark_explored($pgroup, $pls) {
    global $db, $tablepre;

    $pgroup_i = (int)$pgroup;
    $pls_i = (int)$pls;
    if ($pls_i <= 0) return;

    // INSERT ... ON DUPLICATE KEY UPDATE explored=1（幂等，已 explored 不重置）
    $db->query("INSERT INTO {$tablepre}oblmapstates (pgroup, pls, fog, damaged, flags, explored)
                VALUES ({$pgroup_i}, {$pls_i}, 1, 0, '', 1)
                ON DUPLICATE KEY UPDATE explored=1, fog=1");
}

// ----------------------------------------------------------------
// POI 发现（100% 发现，进入信息范围即发现）
// ----------------------------------------------------------------

/**
 * 发现视野范围内的 POI，标记 discovered=1（设计案 §4.11：POI 100% 发现）
 *
 * 与道具/敌人发现的差异：
 *   - POI 进入有效信息范围 100% 发现（不受概率/预算限制）
 *   - 已 discovered=1 的 POI 不重复处理（幂等）
 *   - 已 discovered 的 POI 永久退出自动导航目标池（§4.7 边界）
 *
 * 注意：Q3 决策——本函数仅写 discovered 字段，不修改 poi.search 的位置校验逻辑。
 * poi.search 仍按 iaid + pgroup/pls 校验，不检查 discovered（避免历史数据回归）。
 *
 * @param int   $pgroup        当前区域
 * @param array $visible_tiles [pls => ['distance' => int]] 视野范围
 * @return array 新发现的 POI 实例列表 [{iaid, pls, poi_id, ...}]
 */
function obl_discover_pois($pgroup, $visible_tiles) {
    global $db, $tablepre, $obl_log;

    if (empty($visible_tiles)) return array();

    $pgroup_i = (int)$pgroup;
    $pls_list = implode(',', array_map('intval', array_keys($visible_tiles)));

    // 查询视野范围内未发现的 POI
    $result = $db->query("SELECT iaid, pls, poi_id FROM {$tablepre}oblmappoi
                           WHERE pgroup='{$pgroup_i}' AND pls IN ({$pls_list}) AND discovered=0");
    if (!$result) return array();

    $discovered_pois = array();
    $iaid_to_update = array();
    while ($row = $db->fetch_array($result)) {
        $iaid = (int)$row['iaid'];
        $discovered_pois[] = array(
            'iaid'   => $iaid,
            'pls'    => (int)$row['pls'],
            'poi_id' => (string)$row['poi_id'],
        );
        $iaid_to_update[] = $iaid;
    }

    if (empty($iaid_to_update)) return array();

    // 批量标记 discovered=1（WHERE discovered=0 保证幂等，避免并发竞态）
    $iid_list = implode(',', array_map('intval', $iaid_to_update));
    $db->query("UPDATE {$tablepre}oblmappoi SET discovered=1 WHERE iaid IN ({$iid_list}) AND discovered=0");

    // emit 结构化日志：发现 POI（每个 POI 一条，供前端发现模态使用）
    if (isset($obl_log) && $obl_log) {
        foreach ($discovered_pois as $poi) {
            $obl_log->emit('poi.discovered', 'poi', array(
                'iaid'   => $poi['iaid'],
                'poi_id' => $poi['poi_id'],
                'pls'    => $poi['pls'],
            ));
        }
    }

    return $discovered_pois;
}

// ----------------------------------------------------------------
// 统一信息获取原语
// ----------------------------------------------------------------

/**
 * 统一信息获取原语（设计案 §4.2-§4.3）
 *
 * 内部流程：
 *   1. 计算观察范围（复用 obl_calc_vision_range）
 *   2. 按 scene_filter 过滤信息类别
 *   3. 点亮迷雾（obl_clear_fog）— 若 'fog' 在 filter
 *   4. 发现道具（obl_discover_items，按 info_budget + prob_modifier）— 若 'items' 在 filter
 *   5. 发现敌人（obl_discover_enemies）— 若 'enemies' 在 filter
 *   6. 发现 POI（obl_discover_pois）— 若 'poi' 在 filter；POI 100% 发现（§4.11）
 *   7. 返回结构化信息结果（含各类别发现清单 + 注意力等级）
 *
 * @param int    $pgroup 当前区域
 * @param int    $pls    当前格
 * @param array  &$pdata 玩家数据（读取技能等级影响发现上限； Enemies 发现用 vision_range）
 * @param array  $config obl_get_info_config 返回的配置
 * @return array 结构化信息结果
 *   [
 *     'action_type'   => string,
 *     'visible_tiles' => [pls => ['distance' => int]],
 *     'fog_cleared'   => [pls, ...],         // 本次新点亮格（运行时收集）
 *     'items_discovered' => [{iid, pls, distance_tier}, ...],  // 道具发现清单
 *     'enemies_discovered' => [{pid, name, pls}, ...],         // 敌人发现清单
 *     'pois_discovered' => [{iaid, pls, poi_id}, ...],         // POI 发现清单
 *     'attention'     => 'normal'|'item'|'important'|'force',  // 注意力等级（F-E4-Info §5.5）
 *     'has_key_item'  => bool,                  // 是否发现关键道具（首期=普通道具，预留）
 *   ]
 *
 * 注意力等级（F-E4-Info §5.5 / 设计案 §4.12）：
 *   - normal    : 迷雾/地形/潮汐/普通地图变化 — 播放反馈但不中断导航（默认）
 *   - item      : 普通道具发现 — 显示名称数量、写入日志、地图标记，不中断导航
 *   - important : POI / 关键道具 / 任务道具 / 成功发现的敌人 — 中断导航
 *   - force     : 陷阱 / 突袭 / 战斗 / 时间调度事件 — 立即终止并交接场景
 *                 本原语不直接设置 force；force 由外部事件触发器
 *                 （obl_post_move_hook / obl_post_explore_hook 的陷阱/事件点触发等）
 *                 在本原语返回后追加升级。
 *   升级规则（按发现内容单向升级 normal→item→important；force 由外部设置）：
 *     - 初始 normal
 *     - 发现道具 → 至少 item（不降级 important）
 *     - 发现敌人或 POI → important（覆盖 item）
 */
function obl_acquire_information($pgroup, $pls, &$pdata, array $config) {
    $pgroup = (int)$pgroup;
    $pls = (int)$pls;

    $action_type = isset($config['action_type']) ? (string)$config['action_type'] : 'move';
    $scene_filter = isset($config['scene_filter']) && is_array($config['scene_filter'])
        ? $config['scene_filter'] : array();
    $filter_lookup = array();
    foreach ($scene_filter as $f) $filter_lookup[$f] = true;

    // 1. 计算观察范围（复用 E-6 obl_calc_vision_range）
    include_once GAME_ROOT . './oblivions/include/game/vision.func.php';
    $visible_tiles = obl_calc_vision_range($pgroup, $pls, $pdata);

    $result = array(
        'action_type'         => $action_type,
        'visible_tiles'       => $visible_tiles,
        'fog_cleared'         => array(),
        'items_discovered'    => array(),
        'enemies_discovered'  => array(),
        'pois_discovered'     => array(),
        'attention'           => 'normal',  // F-E4-Info §5.5：4 级注意力等级，默认 normal（仅迷雾/地形）
        'has_key_item'        => false,
    );

    if (empty($visible_tiles)) return $result;

    // 3. 点亮迷雾（若 'fog' 在 filter）
    if (isset($filter_lookup['fog'])) {
        obl_clear_fog($pgroup, $visible_tiles);
        $result['fog_cleared'] = array_keys($visible_tiles);
    }

    // 4. 发现道具（若 'items' 在 filter 且 info_budget > 0）
    if (isset($filter_lookup['items'])) {
        // 注意：使用 array_key_exists 而非 isset，因为 explore 配置中 info_budget 显式为 null
        // （null 表示使用技能化上限 obl_get_discovery_limit），isset(null) 返回 false 会误判
        $info_budget = array_key_exists('info_budget', $config) ? $config['info_budget'] : 0;
        // null 表示使用技能化上限（explore 配置）
        if ($info_budget === null) {
            $info_budget = obl_get_discovery_limit($pdata);
        }
        $prob_modifier = isset($config['discover_prob_modifier']) ? (float)$config['discover_prob_modifier'] : 1.0;

        if ($info_budget > 0 && $prob_modifier > 0) {
            $items_before = obl_count_discovered_items($pgroup, $visible_tiles);
            // 传入 $info_budget 强制执行 config 中的预算（F-E4-Info §5.3）
            // move 配置 info_budget=1（基础预算，远低于探索）
            // explore 配置 info_budget 已解析为 obl_get_discovery_limit（技能化上限）
            obl_discover_items($pgroup, $visible_tiles, $pdata, $info_budget);
            $items_after = obl_count_discovered_items($pgroup, $visible_tiles);
            $result['items_discovered'] = obl_list_newly_discovered_items($pgroup, $visible_tiles, $items_before);
            // F-E4-Info §5.5：普通道具发现 → 注意力升级为 item（写入日志、地图标记，不中断导航）
            // 单向升级：normal → item；若已 important（之前未发生）则保持
            if (!empty($result['items_discovered']) && $result['attention'] === 'normal') {
                $result['attention'] = 'item';
            }
        }
    }

    // 5. 发现敌人（若 'enemies' 在 filter）
    if (isset($filter_lookup['enemies'])) {
        $vision_range = obl_get_player_vision_range($pdata);
        $enemies_before = obl_count_discovered_enemies($pgroup);
        obl_discover_enemies($pgroup, $pls, $vision_range);
        $result['enemies_discovered'] = obl_list_newly_discovered_enemies($pgroup, $enemies_before);
        // F-E4-Info §5.5：成功发现敌人 → 注意力升级为 important（中断导航）
        // 单向升级：覆盖 item（敌人发现优先于道具发现）
        if (!empty($result['enemies_discovered'])) {
            $result['attention'] = 'important';
        }
    }

    // 6. 发现 POI（若 'poi' 在 filter；POI 100% 发现）
    if (isset($filter_lookup['poi'])) {
        $result['pois_discovered'] = obl_discover_pois($pgroup, $visible_tiles);
        // F-E4-Info §5.5：POI 发现 → 注意力升级为 important（中断导航）
        // 单向升级：覆盖 item（POI 发现优先于道具发现）
        if (!empty($result['pois_discovered'])) {
            $result['attention'] = 'important';
        }
    }

    return $result;
}

// ----------------------------------------------------------------
// 辅助：发现清单收集（用于结构化结果与导航中断判定）
// ----------------------------------------------------------------

/**
 * 统计视野范围内已发现道具数（发现前后对比用）
 */
function obl_count_discovered_items($pgroup, $visible_tiles) {
    global $db, $tablepre;
    if (empty($visible_tiles)) return 0;
    $pgroup_i = (int)$pgroup;
    $pls_list = implode(',', array_map('intval', array_keys($visible_tiles)));
    $result = $db->query("SELECT COUNT(*) AS cnt FROM {$tablepre}oblmapitem
                           WHERE pgroup='{$pgroup_i}' AND pls IN ({$pls_list}) AND discovered>0");
    $row = $db->fetch_array($result);
    return $row ? (int)$row['cnt'] : 0;
}

/**
 * 列出本次新发现的道具（discovered>0 且 iid > $before_max_iid）
 *
 * 简化实现：返回视野范围内所有 discovered>0 的道具（调用方按 $items_before 差集判断）
 */
function obl_list_newly_discovered_items($pgroup, $visible_tiles, $count_before) {
    global $db, $tablepre;
    if (empty($visible_tiles)) return array();
    $pgroup_i = (int)$pgroup;
    $pls_list = implode(',', array_map('intval', array_keys($visible_tiles)));
    $result = $db->query("SELECT iid, pls, item_id, discovered FROM {$tablepre}oblmapitem
                           WHERE pgroup='{$pgroup_i}' AND pls IN ({$pls_list}) AND discovered>0
                           ORDER BY iid");
    $all = array();
    while ($row = $db->fetch_array($result)) {
        $all[] = array(
            'iid'         => (int)$row['iid'],
            'pls'         => (int)$row['pls'],
            'item_id'     => (string)$row['item_id'],
            'distance_tier' => (int)$row['discovered'],  // 1=近 2=远
        );
    }
    // 返回本次新增的（取末尾 count - count_before 个）
    $new_count = count($all) - $count_before;
    if ($new_count <= 0) return array();
    return array_slice($all, -$new_count);
}

/**
 * 统计区域内已发现敌人数（发现前后对比用）
 */
function obl_count_discovered_enemies($pgroup) {
    global $db, $tablepre;
    $pgroup_i = (int)$pgroup;
    $result = $db->query("SELECT COUNT(*) AS cnt FROM {$tablepre}oblplayers
                           WHERE type>0 AND pgroup='{$pgroup_i}' AND discovered=1 AND state=0");
    $row = $db->fetch_array($result);
    return $row ? (int)$row['cnt'] : 0;
}

/**
 * 列出本次新发现的敌人
 */
function obl_list_newly_discovered_enemies($pgroup, $count_before) {
    global $db, $tablepre;
    $pgroup_i = (int)$pgroup;
    $result = $db->query("SELECT pid, name, pls FROM {$tablepre}oblplayers
                           WHERE type>0 AND pgroup='{$pgroup_i}' AND discovered=1 AND state=0
                           ORDER BY pid");
    $all = array();
    while ($row = $db->fetch_array($result)) {
        $all[] = array(
            'pid'  => (int)$row['pid'],
            'name' => (string)$row['name'],
            'pls'  => (int)$row['pls'],
        );
    }
    $new_count = count($all) - $count_before;
    if ($new_count <= 0) return array();
    return array_slice($all, -$new_count);
}
