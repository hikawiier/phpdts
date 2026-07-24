<?php
/**
 * @module E 游戏逻辑
 * @framework E-13 移动方式与轨迹拦截框架
 *
 * F-E2-Move：移动方式注册表 + 轨迹拦截接口
 *
 * 设计意图（视野-探索-移动模块改造 §4.2 / §4.3 / §4.9 + F-E2-Move 设计案）：
 *   E-3 的纯净基础操作原本只承载单一"普通移动"语义。本框架在其上增加
 *   "移动方式"参数维度，使同一次 obl_perform_move_core 可承载普通/飞行/跳跃/传送
 *   等多种语义；同时在原子移动执行前增加一次"轨迹拦截"判定窗口，允许路径上
 *   发生一次性拦截事件而不破坏"一个游戏刻一个最终落点"的核心不变量。
 *
 * 不变量（F-E2-Move §三）：
 *   1. 一次原子移动只产生一个最终落点（即使被拦截改写，仍只推进一个游戏刻）
 *   2. 移动方式不改变"中间格不形成权威位置"语义
 *   3. 特殊移动不被自动导航擅自消耗（主动技能型位移需玩家明确授权）
 *   4. 轨迹经过不触发中间格事件（只有最终落点才执行落点规则）
 *   5. 拦截事件顺序不由移动模块决定（由 E-1 时间调度器研判）
 *
 * 与 E-3 的关系：
 *   - 不破坏 E-3 的纯净基础操作契约（不写库、不写日志、不触发钩子）
 *   - 本框架只提供路径计算、范围判定、拦截判定、信息足迹等"参数维度"原语，
 *     实际位移仍由 obl_perform_move_core 执行
 *
 * 首期落地范围：
 *   - 只实现"普通移动"一种（normal）
 *   - 飞行 / 跳跃 / 传送只预留配置槽位，不写路径/演出逻辑
 *   - 轨迹拦截接口已建立，但不注册任何拦截规则
 */

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 一、移动方式注册表（设计案 §4.2 / F-E2-Move §5.1）
//
// 配置驱动：每种移动方式定义 7 项属性：
//   1. max_range        — 最大范围（null=使用角色 move_power）
//   2. distance_calc     — 距离计算方式（bfs / euclidean / none）
//   3. requires_real_path — 是否需要真实可通行路径
//   4. blocking          — 哪些图格/墙体/连接能够阻挡
//   5. landing_rules     — 最终落点的合法条件
//   6. trajectory_interceptable — 轨迹是否可被拦截
//   7. info_footprint    — 信息获取的空间足迹模式
//   8. presentation_type — 前端演出类型
// ================================================================

/**
 * 获取全部移动方式配置
 *
 * 配置源：obl_config.php 的 move_types 段。
 * 兜底：配置缺失时回退到内置默认（仅含 normal）。
 *
 * 不使用静态缓存：确保 $GLOBALS['obl_test_config_override'] 在测试中即时生效，
 * 支持移动方式注册表可扩展性验证（F-E2-Move 验收：新增配置不破坏现有逻辑）。
 *
 * @return array [type_id => config, ...]
 */
function obl_move_types(): array {
    $cfg = obl_get_config();
    $configured = isset($cfg['move_types']) && is_array($cfg['move_types'])
        ? $cfg['move_types'] : array();

    // 兜底：确保 normal 始终存在且启用
    if (!isset($configured['normal']) || !is_array($configured['normal'])) {
        $configured['normal'] = obl_move_type_default_config();
    }

    return $configured;
}

/**
 * 内置默认 normal 配置（配置缺失时的兜底）
 */
function obl_move_type_default_config(): array {
    return array(
        'label'                   => '普通移动',
        'enabled'                 => true,
        'max_range'               => null,        // null = 使用角色 move_power
        'distance_calc'           => 'bfs',
        'requires_real_path'      => true,        // 需要真实可通行路径
        'blocking'                => ['impassable_tiles', 'occupied_tiles'],
        'landing_rules'           => ['passable', 'unoccupied'],
        'trajectory_interceptable' => true,
        'info_footprint'          => 'merge_path_observation',
        'presentation_type'       => 'walk',
    );
}

/**
 * 获取单个移动方式配置（兜底回退 normal）
 *
 * @param string $type_id 移动方式 ID
 * @return array 配置数组
 */
function obl_move_type_get(string $type_id): array {
    $types = obl_move_types();
    if (isset($types[$type_id]) && is_array($types[$type_id])) {
        return $types[$type_id];
    }
    // 未知类型回退 normal（避免上层崩溃）
    return obl_move_type_default_config();
}

/**
 * 默认移动方式 ID
 */
function obl_move_type_default_id(): string {
    return 'normal';
}

/**
 * 判断移动方式是否启用（首期仅 normal 启用）
 *
 * @param string $type_id 移动方式 ID
 * @return bool
 */
function obl_move_type_is_enabled(string $type_id): bool {
    $config = obl_move_type_get($type_id);
    return !empty($config['enabled']);
}

// ================================================================
// 二、范围与路径计算（属性 1-3）
// ================================================================

/**
 * 计算移动方式的最大范围（F-E2-Move §5.1 属性 1）
 *
 * normal：使用角色 move_power（obl_get_move_power）
 * 预留：fly/jump 可配置固定 max_range；teleport 通常不受范围限制
 *
 * @param string $type_id 移动方式 ID
 * @param array  &$pdata  玩家数据
 * @return int 最大格数
 */
function obl_move_type_calc_max_range(string $type_id, array &$pdata): int {
    $config = obl_move_type_get($type_id);
    if (array_key_exists('max_range', $config) && $config['max_range'] !== null) {
        return (int)$config['max_range'];
    }
    // null = 使用角色 move_power
    return obl_get_move_power($pdata);
}

/**
 * 计算路径距离（F-E2-Move §5.1 属性 1 / 2）
 *
 * normal/fly/jump：BFS 路径距离
 * teleport：不计算路径距离（返回 0，距离由落点合法性决定）
 *
 * @return int 距离（边数），不可达返回 -1
 */
function obl_move_type_calc_distance(string $type_id, int $pgroup, int $from, int $to): int {
    $config = obl_move_type_get($type_id);
    $method = $config['distance_calc'] ?? 'bfs';

    if ($method === 'none') {
        // teleport：不计算路径距离
        return 0;
    }

    // bfs / euclidean（首期 euclidean 也走 BFS，因图模型基于邻接）
    return obl_get_distance($pgroup, $from, $to);
}

/**
 * 查找完整路径（F-E2-Move §5.1 属性 2 / 3）
 *
 * normal：BFS 尊重可通行图格（impassable 不作为中间节点）；
 *         目标格本身可以是不可通行的（由调用方通过 landing_rules 校验），
 *         以支持"迷雾格作为导航锚点"语义。
 * fly/jump/teleport：首期回退到 normal 的 BFS（预留扩展点）。
 *
 * @param string $type_id 移动方式 ID
 * @param int    $pgroup  区域
 * @param int    $from    起始格
 * @param int    $to      目标格
 * @param array  &$pdata  玩家数据
 * @return array|null 完整路径 [from, step1, ..., to]，不可达返回 null
 */
function obl_move_type_find_path(string $type_id, int $pgroup, int $from, int $to, array &$pdata): ?array {
    $from = (int)$from;
    $to = (int)$to;
    if ($from === $to) return array($from);

    $config = obl_move_type_get($type_id);
    $requires_real_path = !empty($config['requires_real_path']);

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();
    if (!isset($tiles[$from]) || !isset($tiles[$to])) return null;

    // BFS：记录前驱
    $visited = array($from => true);
    $predecessor = array();
    $queue = array($from);

    while (!empty($queue)) {
        $current = array_shift($queue);
        if ($current === $to) break;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($visited[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            // normal：不可通行格不作为路径中间节点（但目标格可以是不可通行的，由调用方校验）
            if ($requires_real_path && empty($tiles[$neighbor]['passable']) && $neighbor !== $to) continue;

            $visited[$neighbor] = true;
            $predecessor[$neighbor] = $current;
            $queue[] = $neighbor;
        }
    }

    if (!isset($visited[$to])) return null;

    // 回溯完整路径
    $path = array($to);
    $step = $to;
    while (isset($predecessor[$step])) {
        $step = (int)$predecessor[$step];
        array_unshift($path, $step);
    }
    return $path;
}

/**
 * 检查目标是否在本次移动方式的可达范围内
 *
 * @return bool true=目标在范围内（可直接精确移动）
 */
function obl_move_type_is_target_in_range(string $type_id, int $pgroup, int $from, int $to, array &$pdata): bool {
    if ($from === $to) return true;
    $max_range = obl_move_type_calc_max_range($type_id, $pdata);
    $distance = obl_move_type_calc_distance($type_id, $pgroup, $from, $to);
    if ($distance === -1) return false;
    return $distance <= $max_range;
}

// ================================================================
// 三、落点合法性（属性 4）
// ================================================================

/**
 * 检查落点合法性（F-E2-Move §5.1 属性 4）
 *
 * normal：passable + unoccupied（与 obl_perform_move_core 的检查一致）
 *
 * @param string $type_id     移动方式 ID
 * @param int    $pgroup      区域
 * @param int    $pls         待校验格
 * @param array  &$pdata      玩家数据
 * @param int    $exclude_pid 排除的 pid（自身，避免误判）
 * @return array ['legal' => bool, 'reason' => string]
 */
function obl_move_type_check_landing(string $type_id, int $pgroup, int $pls, array &$pdata, int $exclude_pid = 0): array {
    $config = obl_move_type_get($type_id);
    $rules = isset($config['landing_rules']) && is_array($config['landing_rules'])
        ? $config['landing_rules'] : array('passable', 'unoccupied');

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();
    if (!isset($tiles[$pls])) {
        return array('legal' => false, 'reason' => 'invalid_target');
    }
    $tile = $tiles[$pls];

    if (in_array('passable', $rules, true) && empty($tile['passable'])) {
        return array('legal' => false, 'reason' => 'blocked');
    }

    if (in_array('unoccupied', $rules, true)) {
        include_once GAME_ROOT . './oblivions/include/game/player.func.php';
        $occupiers = obl_get_pids_in_tile($pgroup, $pls, $exclude_pid, true);
        if (!empty($occupiers)) {
            return array('legal' => false, 'reason' => 'occupied');
        }
    }

    return array('legal' => true, 'reason' => 'ok');
}

/**
 * 解析落点：若目标本身不可落脚，寻找附近合法落点（F-E2-Move §5.5）
 *
 * 用途：玩家点选迷雾格作为导航锚点时，若该格实际不可落脚
 * （不可通行或被占用），系统在附近寻找一个合法落点。
 *
 * 策略：从目标格 BFS 扩展，返回第一个满足 landing_rules 的格。
 *
 * @return array ['landing_pls' => int|null, 'resolved' => bool, 'reason' => string]
 *               resolved=true 表示找到了附近合法落点（landing_pls != 原目标）
 */
function obl_move_type_resolve_landing(string $type_id, int $pgroup, int $target_pls, array &$pdata): array {
    $exclude_pid = (int)($pdata['pid'] ?? 0);

    // 1. 先检查目标本身
    $check = obl_move_type_check_landing($type_id, $pgroup, $target_pls, $pdata, $exclude_pid);
    if ($check['legal']) {
        return array('landing_pls' => $target_pls, 'resolved' => false, 'reason' => 'ok');
    }

    // 2. 目标不可落脚 → BFS 找最近合法落点
    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();
    if (!isset($tiles[$target_pls])) {
        return array('landing_pls' => null, 'resolved' => false, 'reason' => 'invalid_target');
    }

    $visited = array($target_pls => true);
    $queue = array(array($target_pls, 0));
    $max_search_radius = 10;

    while (!empty($queue)) {
        $frame = array_shift($queue);
        $current = (int)$frame[0];
        $dist = (int)$frame[1];
        if ($dist > $max_search_radius) break;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($visited[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            $visited[$neighbor] = true;

            $check = obl_move_type_check_landing($type_id, $pgroup, $neighbor, $pdata, $exclude_pid);
            if ($check['legal']) {
                return array('landing_pls' => $neighbor, 'resolved' => true, 'reason' => 'nearby_legal');
            }
            $queue[] = array($neighbor, $dist + 1);
        }
    }

    return array('landing_pls' => null, 'resolved' => false, 'reason' => 'no_legal_landing');
}

// ================================================================
// 四、轨迹拦截框架（设计案 §4.3 / F-E2-Move §5.3）
//
// 流程：
//   计划 A → C
//   → 对轨迹执行拦截判定
//   → 无拦截：最终落点 C
//   → 在 B 被拦截：结果改写为停在 B 或进入对应事件
//   → 整体仍只推进一个游戏刻（W-E1 不变量 #1/#2）
//
// 不变量：
//   - B 上的普通道具/POI/潮汐/陷阱不因轨迹经过而逐格触发
//   - 只有 B 成为最终落点，才执行落点规则
//   - 拦截事件顺序不由移动模块决定（由 E-1 时间调度器研判）
//
// 首期：不注册任何拦截规则，obl_trajectory_intercept_check 总是返回未拦截。
// ================================================================

/**
 * 获取轨迹拦截规则注册表（首期为空）
 *
 * 规则结构（未来扩展）：
 *   ['rule_id' => string, 'priority' => int, 'check' => callable]
 *
 * callable 签名（预留）：
 *   function(int $pgroup, int $from, int $to, array $path, array &$pdata): ?array
 *   返回 null=未拦截；返回 ['intercept_at' => int, 'event' => string] = 拦截
 *
 * @return array [rule_id => rule, ...]
 */
function obl_trajectory_intercept_rules(): array {
    if (!isset($GLOBALS['obl_trajectory_intercept_rules'])) {
        $GLOBALS['obl_trajectory_intercept_rules'] = array();
    }
    return $GLOBALS['obl_trajectory_intercept_rules'];
}

/**
 * 注册轨迹拦截规则（扩展点，首期无调用）
 *
 * 设计意图：未来拦截规则（陷阱触发、突袭、强制事件等）通过此接口注册，
 * 而不是硬编码在移动模块中。拦截事件的先后顺序由 priority 决定，
 * 但具体调度由 E-1 时间调度器研判（本模块只提供候选）。
 *
 * @param string   $rule_id   规则 ID
 * @param int      $priority  优先级（数值越小越先判定）
 * @param callable $check     拦截判定回调
 */
function obl_trajectory_intercept_register_rule(string $rule_id, int $priority, callable $check): void {
    if (!isset($GLOBALS['obl_trajectory_intercept_rules'])) {
        $GLOBALS['obl_trajectory_intercept_rules'] = array();
    }
    $GLOBALS['obl_trajectory_intercept_rules'][$rule_id] = array(
        'rule_id'  => $rule_id,
        'priority' => $priority,
        'check'    => $check,
    );
}

/**
 * 清空轨迹拦截规则（仅供测试使用）
 */
function obl_trajectory_intercept_clear_rules(): void {
    $GLOBALS['obl_trajectory_intercept_rules'] = array();
}

/**
 * 轨迹拦截判定（F-E2-Move §5.3 核心接口）
 *
 * 在原子移动执行前对轨迹执行拦截判定：
 *   - 无拦截：最终落点 = 计划落点 to
 *   - 在 B 被拦截：结果改写为停在 B（landing_pls = B）
 *
 * 首期：不注册任何拦截规则，总是返回未拦截。
 *
 * @param string $type_id 移动方式 ID
 * @param int    $pgroup  区域
 * @param int    $from    起始格
 * @param int    $to      计划落点
 * @param array  $path    完整路径 [from, ..., to]
 * @param array  &$pdata  玩家数据
 * @return array [
 *   'intercepted'  => bool,    // 是否被拦截
 *   'landing_pls'  => int,     // 最终落点（被拦截则为拦截位置 B）
 *   'intercept_at' => int|null,// 拦截位置 pls
 *   'rule_id'      => string|null,
 *   'event'        => string|null,
 * ]
 */
function obl_trajectory_intercept_check(
    string $type_id,
    int $pgroup,
    int $from,
    int $to,
    array $path,
    array &$pdata
): array {
    $config = obl_move_type_get($type_id);

    $not_intercepted = array(
        'intercepted'  => false,
        'landing_pls'  => $to,
        'intercept_at' => null,
        'rule_id'      => null,
        'event'        => null,
    );

    // 移动方式本身不允许拦截（如传送）→ 直接通过
    if (empty($config['trajectory_interceptable'])) {
        return $not_intercepted;
    }

    $rules = obl_trajectory_intercept_rules();
    if (empty($rules)) {
        // 首期无拦截规则 → 未拦截
        return $not_intercepted;
    }

    // 按 priority 升序排列（数值越小越先判定）
    // 注意：拦截事件的最终先后顺序由 E-1 时间调度器研判，本模块只提供候选
    uasort($rules, static function (array $a, array $b): int {
        return $a['priority'] <=> $b['priority'];
    });

    foreach ($rules as $rule) {
        $check = $rule['check'];
        $result = $check($pgroup, $from, $to, $path, $pdata);
        if ($result !== null && isset($result['intercept_at'])) {
            return array(
                'intercepted'  => true,
                'landing_pls'  => (int)$result['intercept_at'],
                'intercept_at' => (int)$result['intercept_at'],
                'rule_id'      => $rule['rule_id'],
                'event'        => isset($result['event']) ? (string)$result['event'] : null,
            );
        }
    }

    return $not_intercepted;
}

// ================================================================
// 五、信息获取空间足迹（设计案 §4.9 / F-E2-Move §5.4）
//
// 一次移动只进行一次信息获取，但候选范围由移动方式决定：
//   - normal：合并真实路径沿途的观察范围
//   - teleport：只使用最终落点的观察范围
//   - fly：空中观察走廊（首期占位，回退到 merge_path_observation）
//
// 不变量：路径上的格子不会因此变成已探索，也不逐格重复投骰。
// （explored 写入仍由 obl_mark_explored 在最终落点执行，§4.6）
// ================================================================

/**
 * 计算信息获取空间足迹（F-E2-Move §5.4）
 *
 * @param string $type_id 移动方式 ID
 * @param int    $pgroup  区域
 * @param array  $path    完整路径 [from, ..., to]
 * @param array  &$pdata  玩家数据
 * @return array [pls => ['distance' => int]] 合并后的观察范围
 */
function obl_move_type_calc_info_footprint(string $type_id, int $pgroup, array $path, array &$pdata): array {
    $config = obl_move_type_get($type_id);
    $mode = $config['info_footprint'] ?? 'merge_path_observation';

    include_once GAME_ROOT . './oblivions/include/game/vision.func.php';

    // teleport / jump：只使用最终落点的观察范围
    if ($mode === 'landing_only') {
        $landing = end($path);
        if ($landing === false) return array();
        return obl_calc_vision_range($pgroup, (int)$landing, $pdata);
    }

    // normal（merge_path_observation）/ fly（air_corridor，首期回退到合并路径）
    // 合并路径沿途每个格的观察范围，取最小距离
    $merged = array();
    foreach ($path as $path_pls) {
        $path_pls = (int)$path_pls;
        $visible = obl_calc_vision_range($pgroup, $path_pls, $pdata);
        foreach ($visible as $pls => $info) {
            $dist = isset($info['distance']) ? (int)$info['distance'] : 0;
            if (!isset($merged[$pls])) {
                $merged[$pls] = array('distance' => $dist);
            } else {
                $merged[$pls]['distance'] = min($merged[$pls]['distance'], $dist);
            }
        }
    }
    return $merged;
}

// ================================================================
// 六、纯净组合原语：移动方式感知的原子移动
//
// 不破坏 E-3 纯净基础操作契约：不写库、不写日志、不触发钩子。
// 仅组合 find_path + intercept_check + obl_perform_move_core。
// ================================================================

/**
 * 计划并执行一次移动方式感知的原子移动（纯净，无副作用）
 *
 * 流程（设计案 §4.3 + F-E2-Move §5.3）：
 *   1. 查找路径（find_path）
 *   2. 轨迹拦截判定（intercept_check）— 可能改写落点
 *   3. 调用 obl_perform_move_core 执行（受 max_range 约束）
 *
 * 拦截改写落点时：
 *   - landing_pls = 拦截位置 B（而非原计划 to）
 *   - 距离重新计算为 from → B 的路径距离
 *   - 整体仍只推进一个游戏刻（由调用方控制 tick，本函数不推进 tick）
 *
 * @param string $type_id 移动方式 ID
 * @param array  &$pdata  玩家数据（引用，修改 pls）
 * @param int    $to_pls  计划目标格
 * @return array [
 *   'success'      => bool,
 *   'distance'     => int,
 *   'reason'       => string,
 *   'intercepted'  => bool,
 *   'intercept_at' => int|null,
 *   'rule_id'      => string|null,
 *   'path'         => array,
 *   'landing_pls'  => int,
 * ]
 */
function obl_move_type_execute(string $type_id, array &$pdata, int $to_pls): array {
    $pgroup = (int)$pdata['pgroup'];
    $from_pls = (int)$pdata['pls'];
    $to_pls = (int)$to_pls;

    // 1. 查找路径
    $path = obl_move_type_find_path($type_id, $pgroup, $from_pls, $to_pls, $pdata);
    if ($path === null) {
        return array(
            'success'      => false,
            'distance'     => 0,
            'reason'       => 'unreachable',
            'intercepted'  => false,
            'intercept_at' => null,
            'rule_id'      => null,
            'path'         => array(),
            'landing_pls'  => $to_pls,
        );
    }

    // 2. 轨迹拦截判定
    $intercept = obl_trajectory_intercept_check($type_id, $pgroup, $from_pls, $to_pls, $path, $pdata);
    $landing_pls = $intercept['intercepted'] ? $intercept['landing_pls'] : $to_pls;

    // 3. 距离计算：被拦截时计算到拦截点的距离
    if ($intercept['intercepted'] && $landing_pls !== $to_pls) {
        $distance = obl_move_type_calc_distance($type_id, $pgroup, $from_pls, $landing_pls);
    } else {
        $distance = obl_move_type_calc_distance($type_id, $pgroup, $from_pls, $to_pls);
    }

    // 4. 范围检查（拦截位置必须在范围内）
    $max_range = obl_move_type_calc_max_range($type_id, $pdata);
    if ($distance === -1) {
        return array(
            'success'      => false,
            'distance'     => 0,
            'reason'       => 'unreachable',
            'intercepted'  => $intercept['intercepted'],
            'intercept_at' => $intercept['intercept_at'],
            'rule_id'      => $intercept['rule_id'],
            'path'         => $path,
            'landing_pls'  => $landing_pls,
        );
    }
    if ($distance > $max_range) {
        return array(
            'success'      => false,
            'distance'     => $distance,
            'reason'       => 'too_far',
            'intercepted'  => $intercept['intercepted'],
            'intercept_at' => $intercept['intercept_at'],
            'rule_id'      => $intercept['rule_id'],
            'path'         => $path,
            'landing_pls'  => $landing_pls,
        );
    }

    // 5. 执行纯净基础操作（不写库/日志/钩子）
    $result = obl_perform_move_core($pdata, $landing_pls, $max_range);

    return array(
        'success'      => $result['success'],
        'distance'     => $result['distance'],
        'reason'       => $result['reason'],
        'intercepted'  => $intercept['intercepted'],
        'intercept_at' => $intercept['intercept_at'],
        'rule_id'      => $intercept['rule_id'],
        'path'         => $path,
        'landing_pls'  => $landing_pls,
    );
}
