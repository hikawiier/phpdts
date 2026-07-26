<?php
/**
 * @module E 游戏逻辑
 * @framework E-3 基于图的移动与多行动导航系统
 *
 * Oblivions 自动导航器 / Oblivions Auto-Navigator
 *
 * 设计意图（视野-探索-移动模块改造-正式代码集成设计案 §3.4, §5, §7）：
 *   高层导航命令 map.navigate 的核心领域层。后端选目标 + 多次原子移动 + 中断判断。
 *   与 map.move 的差异：map.move 是单次精确移动（区域切换），
 *   map.navigate 是循环编排（选目标→原子移动→tick→检查中断→继续/停止）。
 *
 * 四个公开入口（设计案 §3.4 handler 内循环）：
 *   1. obl_navigation_begin($payload, &$pdata) - 初始化导航器，选目标
 *   2. obl_navigation_next_step($navigation, &$pdata) - 选下一次原子移动目标
 *   3. obl_navigation_check_interrupt($navigation, &$pdata, $info_result) - 检查中断
 *   4. obl_navigation_select_target($pgroup, $pls, $tendency, &$pdata) - 自动选目标
 *
 * 不自动执行的行为（设计案 §7.6）：
 *   - 不自动调用 combat.start / battle.start
 *   - 不自动调用 poi.search / poi.interact / poi.dismantle
 *   - 不自动调用 item.pickup
 *   - 不自动执行区域切换（obl_switch_region）
 *   - 不自动消耗主动位移技能（飞行/跳跃/传送）
 *
 * 不向前端泄露的隐藏信息（设计案 §7.9）：
 *   - 隐藏敌人位置（discovered=0 的敌人）
 *   - 隐藏 POI（discovered=0 的 POI）
 *   - 自动选目标时若选隐藏敌人搜索位置，前端只显示"正在搜索可疑区域"
 */

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ----------------------------------------------------------------
// 导航倾向枚举（设计案 §7.5）
// ----------------------------------------------------------------

/**
 * 四种移动倾向（设计案 §7.5）
 *
 * | 倾向 | 步幅 | 目标偏好 | 路线偏好 |
 * |-----|------|---------|---------|
 * | steady（稳健，默认） | 1 格 | 低潮汐优先 | 不绕行 |
 * | nearby（就近） | 1 格 | 移动行动次数最少 | 同行动次数内实际距离最近 |
 * | deep（深入险境） | 1 格 | 高潮汐未探索优先 | 允许危险落点 |
 * | efficient（效率优先） | 满移动力 | 减少行动次数 | 可跳过中间未探索格 |
 *
 * @return array 倾向枚举（key=>label）
 */
function obl_navigation_tendencies() {
    return array(
        'steady'    => '稳健',
        'nearby'    => '就近',
        'deep'      => '深入险境',
        'efficient' => '效率优先',
    );
}

/**
 * 校验并归一化移动倾向
 *
 * @param string $tendency 原始倾向值
 * @return string 归一化后的倾向（未知值回退 steady）
 */
function obl_navigation_normalize_tendency($tendency) {
    $tendency = is_string($tendency) ? trim($tendency) : '';
    $tendencies = obl_navigation_tendencies();
    return isset($tendencies[$tendency]) ? $tendency : 'steady';
}

// ----------------------------------------------------------------
// 倾向差异化公共辅助（F-E5-Target §5.6 四种倾向差异化）
// ----------------------------------------------------------------

/**
 * 读取移动倾向配置（F-E5-Target §5.6 / 设计案 §6.2.1）
 *
 * 从 obl_config['tendencies'] 读取，缺失时回退内置默认值。
 * 集中管理所有倾向差异化参数，函数内部不硬编码。
 *
 * @return array 倾向配置字典
 */
function obl_navigation_tendency_config() {
    $cfg = obl_get_config();
    $defaults = array(
        'steady_max_detour'              => 2,
        'steady_max_target_distance'     => 10,
        'tendency_nearby_max_actions'    => 5,
        'tendency_deep_max_distance'     => 8,
        'tendency_deep_max_detour'       => 3,
        'tendency_efficient_max_actions' => 5,
        'tide_weight_map'                => array(
            'shallow' => 1,
            'deep'    => 2,
            'abyss'   => 3,
        ),
    );
    $stored = isset($cfg['tendencies']) && is_array($cfg['tendencies']) ? $cfg['tendencies'] : array();
    return array_merge($defaults, $stored);
}

/**
 * 计算潮汐等级的权重（F-E5-Target §5.6 steady/deep 路径加权）
 *
 * steady 路径成本 = sum(tide_weight)；高潮汐格成本高，软性偏好低潮汐
 * deep 路径成本 = sum(-tide_weight)；低潮汐格成本高，软性偏好高潮汐
 *
 * @param string $tide 潮汐等级（shallow/deep/abyss）
 * @param array  $weight_map 配置中的潮汐权重表
 * @return int 权重值，未知潮汐回退 1（与 shallow 同级）
 */
function obl_navigation_tide_weight($tide, array $weight_map = null) {
    if (!is_array($weight_map)) {
        $weight_map = obl_navigation_tendency_config()['tide_weight_map'];
    }
    $tide = is_string($tide) ? $tide : 'shallow';
    return isset($weight_map[$tide]) ? (int)$weight_map[$tide] : 1;
}

/**
 * 计算从当前位置到目标的"行动次数"（F-E5-Target §5.6 nearby/efficient 距离度量）
 *
 * 行动次数 = ceil(BFS距离 / move_power)，表示按 move_power 步幅走完需要的最少行动数。
 * nearby 用作主排序键；efficient 用作候选过滤上限。
 *
 * @param int $bfs_distance BFS 距离（边数）
 * @param int $move_power 单次原子移动最大格数
 * @return int 行动次数（至少 0）
 */
function obl_navigation_action_count($bfs_distance, $move_power) {
    $bfs_distance = max(0, (int)$bfs_distance);
    $move_power = max(1, (int)$move_power);
    return (int)ceil($bfs_distance / $move_power);
}

/**
 * 按倾向对候选集合排序并返回首个候选（F-E5-Target §5.6）
 *
 * 候选元素结构：['pls' => int, 'distance' => int, 'tide' => string, 'tide_weight' => int]
 * 排序稳定性：主键相同时按 distance 升序回退，再相同时按 pls 升序（确保确定性）。
 *
 * 倾向路由：
 *   - steady：distance 升序 → tide_weight 升序（低潮汐优先）
 *   - nearby：action_count 升序 → distance 升序
 *   - deep：tide_weight 降序（高潮汐优先） → distance 升序
 *   - efficient：distance 降序（最远优先） → tide_weight 升序
 *
 * @param array  $candidates 候选集合
 * @param string $tendency 归一化后的倾向
 * @param int    $move_power 用于 action_count 计算
 * @return array|null 首个候选，空集合返回 null
 */
function obl_navigation_score_tendency_candidates(array $candidates, $tendency, $move_power) {
    if (empty($candidates)) return null;
    $move_power = max(1, (int)$move_power);

    usort($candidates, static function (array $a, array $b) use ($tendency, $move_power) {
        $a_dist = (int)($a['distance'] ?? 0);
        $b_dist = (int)($b['distance'] ?? 0);
        $a_tide_w = (int)($a['tide_weight'] ?? 1);
        $b_tide_w = (int)($b['tide_weight'] ?? 1);
        $a_pls = (int)($a['pls'] ?? 0);
        $b_pls = (int)($b['pls'] ?? 0);

        switch ($tendency) {
            case 'steady':
                // 距离升序 → 潮汐权重升序（低潮汐优先）
                if ($a_dist !== $b_dist) return $a_dist <=> $b_dist;
                if ($a_tide_w !== $b_tide_w) return $a_tide_w <=> $b_tide_w;
                break;
            case 'nearby':
                // 行动次数升序 → 距离升序
                $a_act = obl_navigation_action_count($a_dist, $move_power);
                $b_act = obl_navigation_action_count($b_dist, $move_power);
                if ($a_act !== $b_act) return $a_act <=> $b_act;
                if ($a_dist !== $b_dist) return $a_dist <=> $b_dist;
                break;
            case 'deep':
                // 潮汐权重降序（高潮汐优先） → 距离升序
                if ($a_tide_w !== $b_tide_w) return $b_tide_w <=> $a_tide_w;
                if ($a_dist !== $b_dist) return $a_dist <=> $b_dist;
                break;
            case 'efficient':
                // 距离降序（最远优先） → 潮汐权重升序
                if ($a_dist !== $b_dist) return $b_dist <=> $a_dist;
                if ($a_tide_w !== $b_tide_w) return $a_tide_w <=> $b_tide_w;
                break;
            default:
                // 未知倾向回退 steady 行为
                if ($a_dist !== $b_dist) return $a_dist <=> $b_dist;
                if ($a_tide_w !== $b_tide_w) return $a_tide_w <=> $b_tide_w;
                break;
        }
        // 稳定性回退：pls 升序
        return $a_pls <=> $b_pls;
    });

    return $candidates[0] ?? null;
}

/**
 * 读取图格的潮汐等级（缺失时回退 'shallow'，与 obl_tile_log_params 一致）
 *
 * @param array $tile 图格数据
 * @return string 潮汐等级
 */
function obl_navigation_tile_tide(array $tile) {
    return isset($tile['tide']) && is_string($tile['tide']) ? $tile['tide'] : 'shallow';
}

/**
 * 加权 BFS：找从 from 到 to 的"软偏好路径"的下一格（steady/deep 共用）
 *
 * steady：路径成本 = sum(tide_weight)，软性偏好低潮汐格（高潮汐成本高）
 * deep：路径成本 = sum(max_weight - tide_weight + 1)，软性偏好高潮汐格
 *   （通过反转权重，所有边权重非负，保证 Dijkstra 正确性；
 *    shallow (w=1) → 边权 = max_w; abyss (w=3) → 边权 = 1，故 abyss 成本最低）
 *
 * 软偏好上限：加权路径长度（边数）相对标准最短路径长度的绕行格数，
 * 不超过 max_detour。超出绕行预算时返回 ['next'=>null] 让调用方回退标准最短路径，
 * 体现"软性偏好"而非"硬性强制"——超过绕行预算时放弃软偏好。
 *
 * 防回头机制：avoid_pls 传入时，该格视为 blocked（中间点避开），
 * 用于打破 A↔B 反复横跳的死循环（导航器单步独立 Dijkstra 无"刚走过的格"记忆，
 * 在低潮汐双子格拓扑下会产生跨调用环）。
 *
 * F-E6-Combat §5.3：已发现敌人占据的图格作为中间点不可通行（目标格除外）。
 *
 * E-Q5-D Q5-16：优先队列改用 SplMinHeap（自定义比较），单步最坏复杂度从
 *   O(N² log N)（sort 模拟）降为 O(N log N)。
 *
 * @param int    $pgroup 区域
 * @param int    $from 起始格
 * @param int    $to 目标格
 * @param array  &$pdata 玩家数据
 * @param array  $tiles 区域图格集
 * @param array  $blocked_tiles 已发现敌人占据格集
 * @param string $mode 'steady'（避高潮汐）或 'deep'（趋高潮汐）
 * @param int    $max_detour 最大绕行格数（硬约束：加权路径边数 - 标准最短路径边数 > max_detour 时回退）
 * @param int    $standard_length 标准最短路径长度（边数），用于 max_detour 比较
 * @param int    $avoid_pls 需要避开的格 pls（防回头，0 表示不避开）
 * @return array ['next' => int|null, 'length' => int] next=下一格 pls，null=不可达/超 detour；length=加权路径边数
 */
function obl_navigation_weighted_bfs_next($pgroup, $from, $to, &$pdata, array $tiles, array $blocked_tiles, $mode, $max_detour, $standard_length = 0, $avoid_pls = 0) {
    $from = (int)$from;
    $to = (int)$to;
    if ($from === $to) return array('next' => null, 'length' => 0);
    if (!isset($tiles[$from]) || !isset($tiles[$to])) return array('next' => null, 'length' => -1);

    $max_detour = max(0, (int)$max_detour);
    $standard_length = max(0, (int)$standard_length);
    $avoid_pls = (int)$avoid_pls;
    // 防回头格视为 blocked 中间点（目标格例外：玩家可能正在折返到目标）
    if ($avoid_pls > 0 && $avoid_pls !== $to) {
        $blocked_tiles[$avoid_pls] = true;
    }

    $tendency_cfg = obl_navigation_tendency_config();
    $weight_map = $tendency_cfg['tide_weight_map'];
    // 计算 weight_map 的最大值（用于 deep 模式的权重反转，保证非负）
    $max_w = 1;
    foreach ($weight_map as $w) $max_w = max($max_w, (int)$w);

    // E-Q5-D Q5-16：Dijkstra 优先队列改用 SplMinHeap，单步复杂度从 O(N² log N) 降为 O(N log N)
    // cost[v] = 从 from 到 v 的最小加权成本；dist[v] = 从 from 到 v 的边数（用于 max_detour 硬约束）
    $heap = new obl_navigation_dijkstra_heap();
    $cost = array($from => 0);
    $dist = array($from => 0);
    $predecessor = array();
    $processed = array($from => true);
    // 堆元素 [cost, pls]；按 cost 升序处理（cost 相同时按 pls 升序，确保确定性）
    $heap->insert(array(0, $from));

    while (!$heap->isEmpty()) {
        // 取出最小 cost 项
        $frame = $heap->extract();
        $current_cost = (int)$frame[0];
        $current = (int)$frame[1];

        if (isset($processed[$current])) {
            // 已通过更优或同等路径处理过；除非这是 from 节点的初始化
            if ($current !== $from) continue;
        }
        $processed[$current] = true;

        if ($current === $to) break;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($processed[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            // 不可通行格不可作为路径中间点（目标格除外）
            if (empty($tiles[$neighbor]['passable']) && $neighbor !== $to) continue;
            // F-E6-Combat §5.3：敌人占位过滤
            if (isset($blocked_tiles[$neighbor]) && $neighbor !== $to) continue;

            // 边权重 = 目标格的 tide_weight（不包含 from，从进入的第一格开始计）
            // mode='steady'：cost 累加 tide_weight（高潮汐成本高 → 软偏好低潮汐）
            // mode='deep'：cost 累加 (max_w - tide_weight + 1)（高潮汐成本低 → 软偏好高潮汐）
            //   反转后所有边权重均为 [1, max_w] 区间内正整数，保证 Dijkstra 正确性
            $tide = obl_navigation_tile_tide($tiles[$neighbor]);
            $w = obl_navigation_tide_weight($tide, $weight_map);
            $edge_weight = ($mode === 'deep') ? ($max_w - $w + 1) : $w;

            $new_cost = $current_cost + $edge_weight;
            $new_dist = $dist[$current] + 1;
            // max_detour 硬约束：超出绕行预算的路径不再扩展（剪枝）
            // standard_length=0 时不应用（兼容旧调用方未传 standard_length 的场景）
            if ($standard_length > 0 && $new_dist - $standard_length > $max_detour) continue;

            if (!isset($cost[$neighbor]) || $new_cost < $cost[$neighbor]) {
                $cost[$neighbor] = $new_cost;
                $dist[$neighbor] = $new_dist;
                $predecessor[$neighbor] = $current;
                $heap->insert(array($new_cost, $neighbor));
            }
        }
    }

    if (!isset($predecessor[$to])) {
        // 加权 BFS 不可达（或被 max_detour 剪枝），返回 null 让调用方回退标准 BFS
        return array('next' => null, 'length' => -1);
    }

    $weighted_length = $dist[$to];

    // 二次 max_detour 校验：Dijkstra 可能找到绕远的最优路径，最终路径仍超 detour
    if ($standard_length > 0 && $weighted_length - $standard_length > $max_detour) {
        return array('next' => null, 'length' => $weighted_length);
    }

    // 回溯：从 to 找到 from 的下一格
    $step = $to;
    while (isset($predecessor[$step]) && (int)$predecessor[$step] !== $from) {
        $step = (int)$predecessor[$step];
    }
    $next = isset($predecessor[$step]) ? (int)$step : null;
    return array('next' => $next, 'length' => $weighted_length);
}

/**
 * Dijkstra 优先队列堆（E-Q5-D Q5-16：SplMinHeap 替代 sort 数组）
 *
 * 队列元素为 [cost, pls] 数组，按 cost 升序排列（min-heap 语义）。
 * cost 相同时按 pls 升序排列，确保算法确定性（与原 sort 数组语义一致）。
 *
 * 单次 insert/extract 均为 O(log N)，整体单步复杂度 O(N log N)，
 * 相比原 sort 模拟的 O(N² log N) 显著降低大区域导航延迟。
 */
class obl_navigation_dijkstra_heap extends SplMinHeap {
    /**
     * 比较两个堆元素（升序：cost 低者优先，cost 相同时 pls 小者优先）
     *
     * @param array $a [cost, pls]
     * @param array $b [cost, pls]
     * @return int 正数表示 a>b，负数表示 a<b，0 表示相等
     */
    protected function compare($a, $b): int {
        $cost_a = (int)$a[0];
        $cost_b = (int)$b[0];
        if ($cost_a !== $cost_b) {
            return $cost_a - $cost_b;
        }
        // 稳定性回退：pls 升序（与原 sort 数组对 [cost, pls] 排序的语义一致）
        return (int)$a[1] - (int)$b[1];
    }
}

/**
 * 标准 BFS 最短路径：返回从 from 到 to 的下一格 + 路径长度
 *
 * F-E6-Combat §5.3：已发现敌人占据的图格作为中间点不可通行（目标格除外）。
 *
 * @param int   $pgroup 区域
 * @param int   $from 起始格
 * @param int   $to 目标格
 * @param array $tiles 区域图格集
 * @param array $blocked_tiles 已发现敌人占据格集
 * @return array ['next' => int|null, 'length' => int] length=-1 表示不可达
 */
function obl_navigation_standard_bfs_next($from, $to, array $tiles, array $blocked_tiles) {
    $from = (int)$from;
    $to = (int)$to;
    if ($from === $to) return array('next' => null, 'length' => 0);
    if (!isset($tiles[$from]) || !isset($tiles[$to])) return array('next' => null, 'length' => -1);

    $visited = array($from => true);
    $predecessor = array();
    $distance = array($from => 0);
    $queue = array($from);

    while (!empty($queue)) {
        $current = array_shift($queue);
        if ($current === $to) break;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($visited[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            if (empty($tiles[$neighbor]['passable']) && $neighbor !== $to) continue;
            if (isset($blocked_tiles[$neighbor]) && $neighbor !== $to) continue;

            $visited[$neighbor] = true;
            $predecessor[$neighbor] = $current;
            $distance[$neighbor] = $distance[$current] + 1;
            $queue[] = $neighbor;
        }
    }

    if (!isset($visited[$to])) {
        return array('next' => null, 'length' => -1);
    }

    $step = $to;
    while (isset($predecessor[$step]) && (int)$predecessor[$step] !== $from) {
        $step = (int)$predecessor[$step];
    }
    $next = isset($predecessor[$step]) ? (int)$step : null;
    return array('next' => $next, 'length' => $distance[$to]);
}

/**
 * 标准 BFS 最短路径：返回完整路径数组（E-Q5-D Q5-5 efficient 单次 BFS 优化）
 *
 * 设计案 §5.1 + E-Q5-D：efficient 倾向需要"沿最短路径走 move_power 格"，
 * 原实现为验证候选是否在最短路径上，对每个候选调用一次完整 BFS，单步复杂度 O(move_power × N)。
 * 本函数从 from 出发跑一次 BFS，记录 distance + predecessor 表，回溯 from→to 完整路径，
 * 供 efficient 直接取第 target_distance 格，单步复杂度降为 O(N)。
 *
 * F-E6-Combat §5.3：已发现敌人占据的图格作为中间点不可通行（目标格除外）。
 *
 * @param int   $from 起始格
 * @param int   $to 目标格
 * @param array $tiles 区域图格集
 * @param array $blocked_tiles 已发现敌人占据格集
 * @return array ['path' => int[], 'length' => int]
 *               path[0]=from, path[length]=to；不可达 path=[] length=-1
 */
function obl_navigation_bfs_full_path($from, $to, array $tiles, array $blocked_tiles) {
    $from = (int)$from;
    $to = (int)$to;
    if ($from === $to) return array('path' => array($from), 'length' => 0);
    if (!isset($tiles[$from]) || !isset($tiles[$to])) return array('path' => array(), 'length' => -1);

    $visited = array($from => true);
    $predecessor = array();
    $distance = array($from => 0);
    $queue = array($from);

    while (!empty($queue)) {
        $current = array_shift($queue);
        if ($current === $to) break;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($visited[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            if (empty($tiles[$neighbor]['passable']) && $neighbor !== $to) continue;
            if (isset($blocked_tiles[$neighbor]) && $neighbor !== $to) continue;

            $visited[$neighbor] = true;
            $predecessor[$neighbor] = $current;
            $distance[$neighbor] = $distance[$current] + 1;
            $queue[] = $neighbor;
        }
    }

    if (!isset($visited[$to])) {
        return array('path' => array(), 'length' => -1);
    }

    // 回溯完整路径：from → ... → to（path[0]=from, path[length]=to）
    $path = array();
    $step = $to;
    while (true) {
        array_unshift($path, $step);
        if ($step === $from) break;
        $step = (int)$predecessor[$step];
    }
    return array('path' => $path, 'length' => $distance[$to]);
}

// ----------------------------------------------------------------
// 导航器初始化
// ----------------------------------------------------------------

/**
 * 初始化导航器（设计案 §3.4 handler 第一步）
 *
 * 流程：
 *   1. 解析 payload（target/tendency/max_steps）
 *   2. 校验 tendency（未知值回退 steady）
 *   3. 应用 max_steps 默认值（配置 navigation_max_steps_default）
 *   4. 选择目标：
 *      - 玩家指定 target：保留请求锚点，校验后解析实际落点
 *      - 省略 target：调用 obl_navigation_select_target 自动选目标
 *   5. 返回导航器状态对象
 *
 * 无目标时返回 finished=true, outcome='no_target' 的导航器（设计案 §7.10）。
 *
 * @param array $payload 命令 payload（target/tendency/max_steps）
 * @param array &$pdata  玩家数据（读取 pgroup/pls）
 * @return array 导航器状态对象
 *   [
 *     'navigation_id' => string,  // 前端标识（用 request_id，由 handler 注入）
 *     'requested_target_pls' => int|null, // 玩家请求的原始导航锚点
 *     'target_pls' => int|null,   // 实际导航目标
 *     'target_adjustment' => array|null, // 原目标被解析到附近落点时的公开原因
 *     'target_is_auto' => bool,   // 是否自动选目标
 *     'tendency' => string,       // 移动倾向
 *     'max_steps' => int,         // 最大步数
 *     'steps_taken' => int,       // 已执行步数
 *     'finished' => bool,         // 是否结束
 *     'outcome' => string|null,   // 最终结果枚举
 *     'outcome_reason' => string|null,  // 中断原因
 *   ]
 */
function obl_navigation_begin($payload, &$pdata) {
    global $obl_diag_log;
    $cfg = obl_get_config();
    $default_max_steps = (int)($cfg['navigation_max_steps_default'] ?? 20);
    $limit_max_steps = (int)($cfg['navigation_max_steps_limit'] ?? 50);

    // 1. 解析 payload
    $target_pls = isset($payload['target']) ? (int)$payload['target'] : null;
    $tendency = obl_navigation_normalize_tendency(isset($payload['tendency']) ? $payload['tendency'] : 'steady');
    $max_steps = isset($payload['max_steps']) ? (int)$payload['max_steps'] : 0;

    // E-Q5-D Q5-13：max_steps 自适应——未显式指定时按区域对角线长度动态计算
    // 设计案 §5.1 + §14：大区域远距离目标可能需要超过 20 步才能抵达，
    // 固定 20 会导致 max_steps_reached 终态频繁触发，前端需频繁断点续导航。
    // 自适应默认值 = min(对角线 × 1.5, navigation_max_steps_limit)，
    // 仍受配置上界约束避免单请求超时（§14 性能保护）。
    if ($max_steps < 1) {
        $pgroup_for_diag = (int)$pdata['pgroup'];
        $map_for_diag = obl_get_map_data($pgroup_for_diag);
        $grid_meta = isset($map_for_diag['grids'][$pgroup_for_diag]) ? $map_for_diag['grids'][$pgroup_for_diag] : null;
        if ($grid_meta && isset($grid_meta['cols']) && isset($grid_meta['rows'])) {
            // BFS 网格距离上界 ≈ (cols-1) + (rows-1) = cols + rows - 2
            $diagonal = (int)$grid_meta['cols'] + (int)$grid_meta['rows'] - 2;
            if ($diagonal < 1) $diagonal = 1;
            // 对角线 × 1.5 提供余量（绕行、避开敌人等），向上取整
            $adaptive = (int)ceil($diagonal * 1.5);
            $max_steps = min($adaptive, $limit_max_steps);
        } else {
            // 无网格元数据时回退配置默认值
            $max_steps = $default_max_steps;
        }
    }
    if ($max_steps < 1) $max_steps = 1;
    if ($max_steps > $limit_max_steps) $max_steps = $limit_max_steps;

    $pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    $navigation = array(
        'navigation_id'   => '',
        'requested_target_pls' => null,
        'target_pls'      => null,
        'target_adjustment' => null,
        'target_is_auto'  => false,
        'tendency'        => $tendency,
        'max_steps'       => $max_steps,
        'steps_taken'     => 0,
        'finished'        => false,
        'outcome'         => null,
        'outcome_reason'  => null,
        // 防回头：记录玩家上一次所在的 pls，加权 BFS 把它视为 blocked 中间点
        // 打破 A↔B 反复横跳死循环（导航器单步独立 Dijkstra 无记忆，跨调用形成环）
        'previous_pls'    => 0,
    );

    // 2. 选择目标
    if ($target_pls !== null && $target_pls > 0) {
        $navigation['requested_target_pls'] = $target_pls;
        // 玩家指定目标：校验目标在当前区域且存在
        $map = obl_get_map_data($pgroup);
        $tiles = $map['tiles'][$pgroup] ?? array();
        if (!isset($tiles[$target_pls])) {
            // 目标不存在 → 中断
            $navigation['finished'] = true;
            $navigation['outcome'] = 'interrupted';
            $navigation['outcome_reason'] = 'target_invalid';
            return $navigation;
        }

        // F-E5-Target §三.10：玩家指定目标格的合法性校验（导航锚点）
        // 迷雾格的通行性/占位是隐藏信息，前端无法预知；后端用真值兜底
        $target_tile = $tiles[$target_pls];
        $target_passable = !empty($target_tile['passable']);
        $occupied_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, (int)($pdata['pid'] ?? 0), true);
        $target_occupied = isset($occupied_tiles[$target_pls]);

        if (!$target_passable || $target_occupied) {
            $adjustment_reasons = array();
            if (!$target_passable) $adjustment_reasons[] = 'impassable';
            // 只公开“已被占据”，不借隐藏真值泄露占据者类型或身份。
            if ($target_occupied) $adjustment_reasons[] = 'occupied';
            // 导航锚点：目标不可落脚，BFS 寻找附近合法落点
            $landing = obl_navigation_find_anchor_landing($pgroup, $target_pls, $tiles, $occupied_tiles);
            if ($landing === null) {
                // 半径内无合法落点 → 目标无效
                $navigation['finished'] = true;
                $navigation['outcome'] = 'interrupted';
                $navigation['outcome_reason'] = 'target_invalid';
                return $navigation;
            }
            $navigation['target_adjustment'] = array(
                'from_pls' => $target_pls,
                'to_pls'   => $landing,
                'reasons'  => $adjustment_reasons,
            );
            $target_pls = $landing; // 替换为合法落点
        }

        $navigation['target_pls'] = $target_pls;
        $navigation['target_is_auto'] = false;

        // 玩家已在目标格 → 已抵达
        if ($cur_pls === $target_pls) {
            $navigation['finished'] = true;
            $navigation['outcome'] = 'arrived';
            $navigation['outcome_reason'] = 'arrived';
        }
    } else {
        // 自动选目标
        $auto_target = obl_navigation_select_target($pgroup, $cur_pls, $tendency, $pdata);
        if ($auto_target === null) {
            // 无可用目标（设计案 §7.10）
            $navigation['finished'] = true;
            $navigation['outcome'] = 'no_target';
            $navigation['outcome_reason'] = 'no_target';
            return $navigation;
        }
        $navigation['target_pls'] = $auto_target;
        $navigation['target_is_auto'] = true;
    }

    if (isset($obl_diag_log) && $obl_diag_log) {
        $obl_diag_log->emit('nav.begin_result', 'navigate', array(
            'requested_target_pls' => isset($navigation['requested_target_pls']) ? $navigation['requested_target_pls'] : null,
            'target_pls'           => isset($navigation['target_pls']) ? $navigation['target_pls'] : null,
            'target_is_auto'       => isset($navigation['target_is_auto']) ? (int)$navigation['target_is_auto'] : 0,
            'finished'             => isset($navigation['finished']) ? (int)$navigation['finished'] : 0,
            'outcome'              => isset($navigation['outcome']) ? $navigation['outcome'] : null,
            'outcome_reason'       => isset($navigation['outcome_reason']) ? $navigation['outcome_reason'] : null,
            'cur_pls'              => isset($pdata['pls']) ? (int)$pdata['pls'] : 0,
        ));
    }
    return $navigation;
}

// ----------------------------------------------------------------
// 选下一次原子移动目标
// ----------------------------------------------------------------

/**
 * 选下一次原子移动目标（设计案 §3.4 步骤 1, §7.8 改路）
 *
 * 每原子移动后重新寻路（基于当前权威状态），自动换路不需玩家确认。
 *
 * 寻路策略（简化版 BFS）：
 *   - 从当前格到目标格的最短路径
 *   - 返回路径上的下一个邻接格
 *   - efficient 倾向：步幅 = move_power，可一次移动多格
 *   - 其他倾向：步幅 = 1，逐格移动
 *
 * 无可达路径时返回 null（handler 标记 route_invalid 中断）。
 *
 * 达到 max_steps 上限时返回 null（handler 标记 max_steps_reached）。
 *
 * @param array &$navigation 导航器状态（引用，更新 steps_taken）
 * @param array &$pdata      玩家数据（读取 pgroup/pls）
 * @return array|null 步骤信息 ['to_pls' => int, 'from_pls' => int, 'seq' => int]
 *                    null 表示无下一步（handler 根据状态判定中断原因）
 */
function obl_navigation_next_step(&$navigation, &$pdata) {
    // 1. 已结束 → 无下一步
    if (!empty($navigation['finished'])) return null;

    // 2. 达到 max_steps → 无下一步（handler 标记 max_steps_reached）
    if ($navigation['steps_taken'] >= $navigation['max_steps']) return null;

    // 3. 无目标 → 无下一步
    if ($navigation['target_pls'] === null) return null;

    $pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];
    $target_pls = (int)$navigation['target_pls'];

    // 4. 已抵达目标 → 无下一步（handler 在 check_interrupt 中标记 arrived）
    if ($cur_pls === $target_pls) return null;

    // 5. 寻路：BFS 找最短路径的下一格
    // E-Q5-C Q5-3：玩家指定目标时 nearby 跳过距离上限——target_is_auto=false 即玩家指定
    // 防回头：把 navigation.previous_pls 传入，加权 BFS 把它视为 blocked 中间点
    $is_player_targeted = empty($navigation['target_is_auto']);
    $previous_pls = (int)($navigation['previous_pls'] ?? 0);
    $next_pls = obl_navigation_find_next_step($pgroup, $cur_pls, $target_pls, $pdata, $navigation['tendency'], $is_player_targeted, $previous_pls);
    if ($next_pls === null) {
        // 无可达路径
        return null;
    }

    // 6. 构造步骤信息 + 记录防回头信息
    $navigation['steps_taken']++;
    $navigation['previous_pls'] = $cur_pls;
    return array(
        'to_pls'   => $next_pls,
        'from_pls' => $cur_pls,
        'seq'      => $navigation['steps_taken'],
    );
}

/**
 * 获取当前区域内被敌人占据的图格集合（F-E6-Combat §5.3 / F-E5-Target §三.10）
 *
 * 收集 state=0（活着）的敌人占据的图格。discovered 过滤由调用方按阶段决定：
 *   - BFS 寻路阶段（F-E6-Combat §5.3）：$include_undiscovered=false，仅收集 discovered=1 的敌人
 *     理由：未发现敌人不阻挡 BFS（隐藏信息，导航器无法预知），避免路径选择泄露敌人位置
 *   - 目标选择阶段（F-E5-Target §三.10）：$include_undiscovered=true，收集所有活敌人
 *     理由：选一个走不到的目标（被占用）必然导致首次移动即中断，目标选择阶段必须排除所有被占用格
 *   - state>0 的敌人不阻挡（死亡，与 obl_perform_move_core 的 alive_only=true 一致）
 *
 * @param int  $pgroup               区域
 * @param int  $exclude_pid          排除的 pid（玩家自己）
 * @param bool $include_undiscovered 是否包含未发现敌人（默认 false 保持原 BFS 寻路语义）
 * @return array<int, true> 被占据图格的 pls 集合
 */
function obl_navigation_get_enemy_occupied_tiles($pgroup, $exclude_pid = 0, $include_undiscovered = false) {
    global $db, $tablepre;
    $pgroup = (int)$pgroup;
    $exclude_pid = (int)$exclude_pid;
    $include_undiscovered = (bool)$include_undiscovered;

    $sql = "SELECT pls FROM {$tablepre}oblplayers
             WHERE type > 0 AND pgroup = {$pgroup}
               AND state = 0";
    // F-E6-Combat §5.3：BFS 寻路阶段仅避开已发现敌人；F-E5-Target §三.10：目标选择阶段需包含未发现敌人
    if (!$include_undiscovered) {
        $sql .= " AND discovered = 1";
    }
    if ($exclude_pid > 0) {
        $sql .= " AND pid != {$exclude_pid}";
    }
    $result = $db->query($sql);
    $tiles = array();
    while ($row = $db->fetch_array($result)) {
        $tiles[(int)$row['pls']] = true;
    }
    return $tiles;
}

/**
 * 导航锚点：从不可落脚的目标格出发，BFS 寻找最近的合法落点
 * （F-E5-Target §三.10 / 设计案 §4.6 / §7.5）
 *
 * 触发条件：玩家指定目标格 passable=false 或被活单位占据。
 * 搜索策略：从锚点 BFS 扩散，首个 passable=true 且未占的格即为落点。
 * 搜索半径上限避免在极端区域扫描全图；BFS 保证距离最近。
 *
 * @param int   $pgroup         区域
 * @param int   $anchor_pls     锚点格（玩家原始指定目标）
 * @param array $tiles          区域 tiles（来自 obl_get_map_data）
 * @param array $occupied_tiles 活单位占据格集合（来自 obl_navigation_get_enemy_occupied_tiles）
 * @return int|null 合法落点 pls，null 表示半径内无合法落点
 */
function obl_navigation_find_anchor_landing($pgroup, $anchor_pls, array $tiles, array $occupied_tiles) {
    $anchor_pls = (int)$anchor_pls;
    if (!isset($tiles[$anchor_pls])) return null;

    // 搜索半径上限（可配置化：未来移至 obl_get_config navigation_anchor_max_radius）
    $cfg = obl_get_config();
    $max_radius = (int)($cfg['navigation_anchor_max_radius'] ?? 5);
    if ($max_radius < 1) $max_radius = 5;

    $visited = array($anchor_pls => true);
    $queue = array(array($anchor_pls, 0));

    while (!empty($queue)) {
        $frame = array_shift($queue);
        $current = (int)$frame[0];
        $distance = (int)$frame[1];

        if ($distance >= $max_radius) continue;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($visited[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            $visited[$neighbor] = true;

            // 合法落点 = 可通行 + 未被活单位占据
            if (!empty($tiles[$neighbor]['passable']) && !isset($occupied_tiles[$neighbor])) {
                return $neighbor;
            }

            $queue[] = array($neighbor, $distance + 1);
        }
    }

    return null;
}

/**
 * 寻路：按移动倾向选择从 from 到 to 的下一格（F-E5-Target §5.6 四种倾向差异化）
 *
 * 倾向路由：
 *   - steady（稳健探索）：加权 BFS 软偏好低潮汐，绕行不超过 steady_max_detour（硬约束）
 *   - nearby（就近探索）：标准 BFS 最短路径，路径长度超 nearby_max_distance 时返回 null
 *     （E-Q5-C Q5-3：玩家指定目标时跳过距离上限——距离偏好仅用于自动选目标阶段）
 *   - deep（深入险境）：加权 BFS 软偏好高潮汐，绕行不超过 tendency_deep_max_detour（硬约束）
 *   - efficient（效率优先）：标准 BFS 最短路径，返回沿路径方向 move_power 格的目标
 *     （最后一段 < move_power 时返回剩余最近格，遵守 obl_perform_move_core 距离校验）
 *
 * F-E6-Combat §5.3：自动导航不能进入敌人占据的图格。
 *   BFS 把"已发现敌人占据的图格"视为不可通行（中间点），有替代路线时自动避开。
 *   目标格除外（由 obl_perform_move_core 占位校验兜底，允许玩家主动走向敌人）。
 *
 * E-Q5-C Q5-3：$is_player_targeted 区分"玩家指定目标"与"自动选目标"。
 *   设计案 §5.8 "目标超出范围：创建远程导航，途中步幅和路线服从当前移动倾向"。
 *   nearby 倾向的 max_distance 过滤是"自动选目标的距离偏好"，误用到玩家指定目标上
 *   会导致 20 格远目标被直接判定为 route_invalid 中断。玩家指定目标必达，距离偏好
 *   只在自动选目标阶段（obl_navigation_select_unexplored_tile）应用。
 *
 * 防回头（K-12-A 振荡根因修复）：
 *   $previous_pls 传入时，steady/deep 加权 BFS 把它视为 blocked 中间点，
 *   打破"加权最优路径经过对方"导致的 A↔B 跨调用反复横跳。
 *   若加权 BFS 因 avoid 不可达，回退到不带 avoid 的加权 BFS；
 *   若仍不可达或超 max_detour，再回退到标准最短路径。
 *
 * @param int    $pgroup             区域
 * @param int    $from               起始格
 * @param int    $to                 目标格
 * @param array  &$pdata             玩家数据
 * @param string $tendency           倾向
 * @param bool   $is_player_targeted 是否玩家指定目标（true 时 nearby 跳过距离上限）
 * @param int    $previous_pls       玩家上一次所在的 pls（防回头，0 表示无）
 * @return int|null 下一格的 pls，null 表示不可达
 */
function obl_navigation_find_next_step($pgroup, $from, $to, &$pdata, $tendency, $is_player_targeted = false, $previous_pls = 0) {
    $from = (int)$from;
    $to = (int)$to;
    $previous_pls = (int)$previous_pls;
    if ($from === $to) return null;

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();
    if (!isset($tiles[$from]) || !isset($tiles[$to])) return null;

    // F-E6-Combat §5.3：收集已发现敌人占据的图格（中间点避开，目标格除外）
    $blocked_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, (int)($pdata['pid'] ?? 0));

    // 倾向归一化（防御性：调用方应已归一化，这里再保险一次）
    $tendency = obl_navigation_normalize_tendency($tendency);

    // 先用标准 BFS 拿最短路径长度（所有倾向都需要它作为基准）
    $standard = obl_navigation_standard_bfs_next($from, $to, $tiles, $blocked_tiles);
    if ($standard['next'] === null) {
        return null;
    }
    $shortest_length = $standard['length'];

    $tendency_cfg = obl_navigation_tendency_config();
    $move_power = function_exists('obl_get_move_power') ? (int)obl_get_move_power($pdata) : 1;
    $move_power = max(1, $move_power);

    switch ($tendency) {
        case 'steady':
        case 'deep':
            // 加权 BFS 软偏好；max_detour 硬约束（超出绕行预算则回退标准最短路径）
            $mode = $tendency;
            $max_detour = (int)($tendency === 'steady'
                ? $tendency_cfg['steady_max_detour']
                : $tendency_cfg['tendency_deep_max_detour']);

            // 第一选择：带防回头的加权 BFS（避开 previous_pls）
            $weighted = obl_navigation_weighted_bfs_next(
                $pgroup, $from, $to, $pdata, $tiles, $blocked_tiles, $mode,
                $max_detour, $shortest_length, $previous_pls
            );
            if ($weighted['next'] !== null) {
                return $weighted['next'];
            }

            // 第二选择：不带防回头的加权 BFS（previous_pls 是必经之路时回退）
            if ($previous_pls > 0) {
                $weighted = obl_navigation_weighted_bfs_next(
                    $pgroup, $from, $to, $pdata, $tiles, $blocked_tiles, $mode,
                    $max_detour, $shortest_length, 0
                );
                if ($weighted['next'] !== null) {
                    return $weighted['next'];
                }
            }

            // 第三选择：标准最短路径（不带防回头，保证可达性）
            return $standard['next'];

        case 'nearby':
            // 标准 BFS；自动选目标时路径长度超 move_power * tendency_nearby_max_actions 返回 null。
            // E-Q5-C Q5-3：玩家指定目标时跳过距离上限——距离偏好仅用于自动选目标阶段，
            // 玩家指定目标必达（设计案 §5.8 远程导航承诺）。
            $max_actions = (int)$tendency_cfg['tendency_nearby_max_actions'];
            $max_distance = $move_power * $max_actions;
            if (!$is_player_targeted && $shortest_length > $max_distance) {
                return null;
            }
            return $standard['next'];

        case 'efficient':
            // 标准 BFS 最短路径；返回沿路径方向 move_power 格的目标
            // E-Q5-D Q5-5：单次 BFS + 完整路径回溯，复杂度 O(N)
            $target_distance = min($move_power, $shortest_length);
            if ($target_distance <= 1) {
                // 剩余路径 ≤ 1 格：直接走下一格
                return $standard['next'];
            }
            // 单次 BFS 拿完整路径，取 path[target_distance] 作为下一落点
            // path[0]=from, path[target_distance]=距 from target_distance 格的最短路径上的格
            $path_result = obl_navigation_bfs_full_path($from, $to, $tiles, $blocked_tiles);
            if (!empty($path_result['path']) && count($path_result['path']) > $target_distance) {
                $next_pls = (int)$path_result['path'][$target_distance];
                return $next_pls;
            }
            // 回退：直接走下一格（理论不应到达，bfs_full_path 与 standard_bfs_next 同源）
            return $standard['next'];

        default:
            // 未知倾向（已被 normalize_tendency 归一化为 steady，此处不应到达）
            return $standard['next'];
    }
}

// ----------------------------------------------------------------
// 中断检查
// ----------------------------------------------------------------

/**
 * 检查导航中断（设计案 §3.4 步骤 8, §7.3）
 *
 * 必停检查项（按优先级）：
 *   0. force_combat - 强制战斗中断（action='battle' 或 bid>0，被突袭时立即终止）
 *   1. arrived - 抵达目标（当前位置 == 导航目标）
 *   2. enemy_discovered - 发现敌人（info_result.enemies_discovered 非空）
 *   3. poi_discovered - 发现 POI（info_result.pois_discovered 非空）
 *   4. no_sp - 体力不足（下一次移动体力不足）
 *   5. capability_lost - 能力失效（voluntary_move 不再 allowed）
 *
 * 未实现（首期占位）：
 *   - key_item_discovered - 发现关键道具（首期=普通道具，不中断）
 *   - route_invalid - 路线失效（由 next_step 返回 null 时 handler 标记）
 *   - target_invalid - 目标失效（由 begin/next_step 标记）
 *
 * @param array &$navigation 导航器状态
 * @param array &$pdata      玩家数据（读取 sp/skillpara 等）
 * @param array $info_result obl_acquire_information 返回的结构化信息结果
 * @return array|null 中断信息 ['reason' => string, 'details' => array]
 *                     null 表示无中断，可继续
 */
function obl_navigation_check_interrupt(&$navigation, &$pdata, $info_result) {
    global $obl_diag_log;
    $cur_pls = (int)$pdata['pls'];
    $target_pls = (int)$navigation['target_pls'];

    // 0. 强制战斗中断（最高优先级，新增）
    //    设计案 §6.4：敌人突袭/拦截/强制事件由 E-1 时间调度接管，导航在对应移动结果处终止
    //    触发条件：玩家在 tick 结算后被标记为战斗状态（action='battle' 或 bid>0）
    if ((string)$pdata['action'] === 'battle' || (int)($pdata['bid'] ?? 0) > 0) {
        $navigation['finished'] = true;
        $navigation['outcome'] = 'interrupted';
        $navigation['outcome_reason'] = 'force_combat';
        if (isset($obl_diag_log) && $obl_diag_log) {
            $obl_diag_log->emit('nav.interrupt', 'navigate', array(
                'reason'     => 'force_combat',
                'cur_pls'    => $cur_pls,
                'target_pls' => $target_pls,
            ));
        }
        return array(
            'reason'  => 'force_combat',
            'details' => array(
                'bid'    => (int)($pdata['bid'] ?? 0),
                'action' => (string)$pdata['action'],
            ),
        );
    }

    // 1. 抵达目标（最高优先级）
    if ($cur_pls === $target_pls) {
        $navigation['finished'] = true;
        $navigation['outcome'] = 'arrived';
        $navigation['outcome_reason'] = 'arrived';
        if (isset($obl_diag_log) && $obl_diag_log) {
            $obl_diag_log->emit('nav.interrupt', 'navigate', array(
                'reason'     => 'arrived',
                'cur_pls'    => $cur_pls,
                'target_pls' => $target_pls,
            ));
        }
        return array('reason' => 'arrived', 'details' => array());
    }

    // 2. 发现敌人
    if (!empty($info_result['enemies_discovered'])) {
        $navigation['finished'] = true;
        $navigation['outcome'] = 'interrupted';
        $navigation['outcome_reason'] = 'enemy_discovered';
        if (isset($obl_diag_log) && $obl_diag_log) {
            $obl_diag_log->emit('nav.interrupt', 'navigate', array(
                'reason'     => 'enemy_discovered',
                'cur_pls'    => $cur_pls,
                'target_pls' => $target_pls,
            ));
        }
        return array(
            'reason'  => 'enemy_discovered',
            'details' => array('enemies' => $info_result['enemies_discovered']),
        );
    }

    // 3. 发现 POI
    if (!empty($info_result['pois_discovered'])) {
        $navigation['finished'] = true;
        $navigation['outcome'] = 'interrupted';
        $navigation['outcome_reason'] = 'poi_discovered';
        if (isset($obl_diag_log) && $obl_diag_log) {
            $obl_diag_log->emit('nav.interrupt', 'navigate', array(
                'reason'     => 'poi_discovered',
                'cur_pls'    => $cur_pls,
                'target_pls' => $target_pls,
            ));
        }
        return array(
            'reason'  => 'poi_discovered',
            'details' => array('pois' => $info_result['pois_discovered']),
        );
    }

    // 4. 体力不足：检查下一次移动是否有足够体力
    // 设计案 §7.3 no_sp：下一次移动体力不足时中断
    // 当前 move_sp_cost=0（基础值），所以此检查默认通过
    $cfg = obl_get_config();
    $move_sp_cost = (int)($cfg['move_sp_cost'] ?? 0);
    if ($move_sp_cost > 0 && (int)$pdata['sp'] < $move_sp_cost) {
        $navigation['finished'] = true;
        $navigation['outcome'] = 'interrupted';
        $navigation['outcome_reason'] = 'no_sp';
        if (isset($obl_diag_log) && $obl_diag_log) {
            $obl_diag_log->emit('nav.interrupt', 'navigate', array(
                'reason'     => 'no_sp',
                'cur_pls'    => $cur_pls,
                'target_pls' => $target_pls,
            ));
        }
        return array('reason' => 'no_sp', 'details' => array());
    }

    // 5. 能力失效：检查 voluntary_move 是否仍 allowed
    if (function_exists('actor_capability_decide')) {
        $decision = actor_capability_decide($pdata, 'voluntary_move', array(
            'command' => 'map.navigate',
            'payload' => array(),
        ), function_exists('skill_effect_next_action_tick') ? skill_effect_next_action_tick() : 0);
        if (empty($decision['allowed'])) {
            $navigation['finished'] = true;
            $navigation['outcome'] = 'interrupted';
            $navigation['outcome_reason'] = 'capability_lost';
            if (isset($obl_diag_log) && $obl_diag_log) {
                $obl_diag_log->emit('nav.interrupt', 'navigate', array(
                    'reason'     => 'capability_lost',
                    'cur_pls'    => $cur_pls,
                    'target_pls' => $target_pls,
                ));
            }
            return array(
                'reason'  => 'capability_lost',
                'details' => array('capability' => 'voluntary_move'),
            );
        }
    }

    return null;
}

// ----------------------------------------------------------------
// 自动选目标
// ----------------------------------------------------------------

/**
 * 自动选目标（设计案 §7.4 目标优先级）
 *
 * 优先级顺序：
 *   1. 当前可达且 explored=0 的真实图格（最高优先级）
 *   2. 尚未发现的 POI 搜索位置（POI 进入信息范围后必发现，§5.3）
 *   3. 隐藏敌人搜索位置（§5.4，不泄露敌人位置）
 *
 * 不进入目标池（设计案 §7.4）：
 *   - 普通地面道具（§5.2.5）
 *   - 已发现 POI（§5.2.6，永久退出目标池）
 *   - 已发现敌人（§5.2.7，不是自动移动目标）
 *
 * @param int    $pgroup  当前区域
 * @param int    $pls     当前格
 * @param string $tendency 移动倾向
 * @param array  &$pdata  玩家数据
 * @return int|null 目标格 pls，null 表示无可用目标
 */
function obl_navigation_select_target($pgroup, $pls, $tendency, &$pdata) {
    $pgroup = (int)$pgroup;
    $pls = (int)$pls;

    // 优先级 1：可达且 explored=0 的真实图格
    $target = obl_navigation_select_unexplored_tile($pgroup, $pls, $tendency, $pdata);
    if ($target !== null) return $target;

    // 优先级 2：未发现的 POI 搜索位置
    $target = obl_navigation_select_undiscovered_poi($pgroup, $pls, $tendency, $pdata);
    if ($target !== null) return $target;

    // E-Q5-E Q5-14：优先级 3——隐藏敌人搜索位置（§5.3 内容搜索 + §5.4 隐藏敌人搜索位置快照）
    // 不向前端泄露敌人实体/位置：前端只看到搜索位置 pls，不看到 pid/name
    $target = obl_navigation_select_hidden_enemy_search_position($pgroup, $pls, $tendency, $pdata);
    if ($target !== null) return $target;

    // 优先级 4：无目标（设计案 §7.10）
    return null;
}

/**
 * 选未探索的真实图格作为目标（设计案 §7.4 优先级 1，F-E5-Target §5.6 四种倾向差异化）
 *
 * 从当前格 BFS 遍历，收集 explored=0 的可达图格候选集，按移动倾向排序选首个候选。
 *
 * 倾向差异化排序（F-E5-Target §5.6）：
 *   - steady：BFS 距离升序 → tide_weight 升序（低潮汐优先）
 *     候选过滤：距离 ≤ steady_max_target_distance
 *   - nearby：行动次数升序 → BFS 距离升序
 *     候选过滤：行动次数 ≤ tendency_nearby_max_actions
 *   - deep：tide_weight 降序（高潮汐优先） → BFS 距离升序
 *     候选过滤：距离 ≤ tendency_deep_max_distance
 *   - efficient：BFS 距离降序（最远优先） → tide_weight 升序
 *     候选过滤：行动次数 ≤ tendency_efficient_max_actions
 *
 * 候选为空时返回 null（导致 select_target 降级到优先级 2 POI 候选）。
 *
 * F-E5-Target §三.10：目标选择阶段必须排除所有被活单位占用的图格。
 *   与 F-E6-Combat §5.3 BFS 寻路不同：目标选择阶段不区分已发现/未发现敌人，
 *   因为选一个走不到的目标（被占用）必然导致首次移动即被 obl_perform_move_core 占位校验拒绝。
 *   隐藏敌人位置不通过候选排除泄露给前端——前端只看到最终选定的目标，看不到被跳过的候选。
 *
 * @param int    $pgroup  区域
 * @param int    $pls     当前格
 * @param string $tendency 倾向
 * @param array  &$pdata  玩家数据
 * @return int|null 目标格 pls
 */
function obl_navigation_select_unexplored_tile($pgroup, $pls, $tendency, &$pdata) {
    global $db, $tablepre;

    $pgroup = (int)$pgroup;
    $pls = (int)$pls;
    $tendency = obl_navigation_normalize_tendency($tendency);

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();
    if (!isset($tiles[$pls])) return null;

    // F-E5-Target §三.10：预收集所有活敌人（含未发现）占用格，BFS 候选筛选时跳过
    // 与 obl_perform_move_core 的 alive_only=true 一致，只排除活单位
    $occupied_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, (int)($pdata['pid'] ?? 0), true);

    // 倾向配置（候选过滤上限）
    $tendency_cfg = obl_navigation_tendency_config();
    $weight_map = $tendency_cfg['tide_weight_map'];
    $move_power = function_exists('obl_get_move_power') ? (int)obl_get_move_power($pdata) : 1;
    $move_power = max(1, $move_power);

    // E-Q5-C Q5-6：候选扫描上限自适应——区域对角线长度与固定上限取较小值
    // 设计案 §5.6 "最终覆盖所有可探索图格的收束目标"要求大区域稀疏未探索格也能进入候选集
    // 对角线 BFS 距离 ≈ cols + rows（网格最坏路径），固定上限取所有倾向距离上限的最大值
    // 大区域（cols+rows > fixed_limit）时按 fixed_limit 截断避免全图扫描；
    // 小区域按对角线扫描确保覆盖所有可达未探索格
    $fixed_limit = max(
        (int)$tendency_cfg['steady_max_target_distance'],
        (int)$tendency_cfg['tendency_deep_max_distance']
    );
    $fixed_limit = max($fixed_limit, $move_power * max(
        (int)$tendency_cfg['tendency_nearby_max_actions'],
        (int)$tendency_cfg['tendency_efficient_max_actions']
    ));
    $grid_meta = isset($map['grids'][$pgroup]) ? $map['grids'][$pgroup] : null;
    $region_diagonal = PHP_INT_MAX;
    if ($grid_meta && isset($grid_meta['cols']) && isset($grid_meta['rows'])) {
        // BFS 网格距离上界 ≈ (cols-1) + (rows-1) = cols + rows - 2
        $region_diagonal = (int)$grid_meta['cols'] + (int)$grid_meta['rows'] - 2;
        if ($region_diagonal < 1) $region_diagonal = 1;
    }
    $candidate_scan_limit = min($region_diagonal, $fixed_limit);

    // BFS 遍历，收集 explored=0 的可达图格候选
    $candidates = obl_navigation_collect_unexplored_candidates(
        $pgroup, $pls, $tiles, $occupied_tiles, $weight_map, $candidate_scan_limit
    );

    // E-Q5-C Q5-6：候选为空时回退全局扫描（不应用距离上限）
    // 意图是"空间覆盖必完成"——玩家附近 candidate_scan_limit 半径内无未探索格时，
    // 扩大到全区域扫描，避免无谓降级到 POI 候选（违反 §5.6 收束目标）
    if (empty($candidates)) {
        $candidates = obl_navigation_collect_unexplored_candidates(
            $pgroup, $pls, $tiles, $occupied_tiles, $weight_map, PHP_INT_MAX
        );
    }

    if (empty($candidates)) return null;

    // 按倾向过滤候选集
    $filtered = array();
    foreach ($candidates as $cand) {
        $distance = (int)$cand['distance'];
        $action_count = obl_navigation_action_count($distance, $move_power);
        $include = true;
        switch ($tendency) {
            case 'steady':
                if ($distance > (int)$tendency_cfg['steady_max_target_distance']) $include = false;
                break;
            case 'nearby':
                if ($action_count > (int)$tendency_cfg['tendency_nearby_max_actions']) $include = false;
                break;
            case 'deep':
                if ($distance > (int)$tendency_cfg['tendency_deep_max_distance']) $include = false;
                break;
            case 'efficient':
                if ($action_count > (int)$tendency_cfg['tendency_efficient_max_actions']) $include = false;
                break;
        }
        if ($include) $filtered[] = $cand;
    }

    // 候选为空时返回 null（让 select_target 降级到优先级 2 POI 候选）
    if (empty($filtered)) return null;

    // 按倾向排序选首个候选
    $best = obl_navigation_score_tendency_candidates($filtered, $tendency, $move_power);
    return $best !== null ? (int)$best['pls'] : null;
}

/**
 * BFS 遍历收集 explored=0 的可达图格候选（E-Q5-C Q5-6 抽取的辅助函数）
 *
 * 从 $pls 出发 BFS，收集 explored=0 的可达图格作为候选，应用 $scan_limit 距离上限。
 * 候选元素结构：['pls' => int, 'distance' => int, 'tide' => string, 'tide_weight' => int]
 *
 * F-E5-Target §三.10：被活单位占用的图格不作为目标候选，也不作为路径中间点。
 * 未探索格仍作为路径中间点继续扩展，以收集更多候选用于倾向排序。
 *
 * @param int    $pgroup         区域
 * @param int    $pls            起始格
 * @param array  $tiles          区域图格集
 * @param array  $occupied_tiles 活单位占据格集
 * @param array  $weight_map     潮汐权重表
 * @param int    $scan_limit     BFS 距离上限（PHP_INT_MAX 表示无上限，全区域扫描）
 * @return array 候选数组
 */
function obl_navigation_collect_unexplored_candidates($pgroup, $pls, array $tiles, array $occupied_tiles, array $weight_map, $scan_limit) {
    global $db, $tablepre;
    $pgroup = (int)$pgroup;
    $pls = (int)$pls;
    $scan_limit = (int)$scan_limit;

    $candidates = array();
    $visited = array($pls => true);
    $queue = array(array($pls, 0));

    while (!empty($queue)) {
        $frame = array_shift($queue);
        $current = (int)$frame[0];
        $distance = (int)$frame[1];

        // 候选距离上限：超过则不扩展（PHP_INT_MAX 时无上限，全区域扫描）
        if ($distance > $scan_limit) continue;

        $neighbors = $tiles[$current]['neighbors'] ?? array();
        foreach ($neighbors as $neighbor) {
            $neighbor = (int)$neighbor;
            if (isset($visited[$neighbor])) continue;
            if (!isset($tiles[$neighbor])) continue;
            $visited[$neighbor] = true;

            // 不可通行格不作为目标（但可经过？BFS 中不可通行格不扩展）
            if (empty($tiles[$neighbor]['passable'])) continue;

            // F-E5-Target §三.10：被活单位占用的图格不作为目标候选（玩家走不过去）
            // 注意：此处不扩展队列，被占用格不作为路径中间点（与 BFS 寻路一致）
            if (isset($occupied_tiles[$neighbor])) continue;

            // 检查 explored 状态
            $result = $db->query("SELECT explored FROM {$tablepre}oblmapstates
                                   WHERE pgroup='{$pgroup}' AND pls='{$neighbor}' LIMIT 1");
            $row = $db->fetch_array($result);
            $explored = $row ? (int)$row['explored'] : 0;

            if ($explored === 0) {
                // 收集候选（带 BFS 距离 + tide 信息）
                $tide = obl_navigation_tile_tide($tiles[$neighbor]);
                $candidates[] = array(
                    'pls'         => $neighbor,
                    'distance'    => $distance + 1,
                    'tide'        => $tide,
                    'tide_weight' => obl_navigation_tide_weight($tide, $weight_map),
                );
                // 注意：未探索格仍作为路径中间点继续扩展，以收集更多候选用于倾向排序。
                // 实际移动时不"穿过"未探索格——obl_navigation_find_next_step 走最短路径，
                // 抵达未探索目标格即触发 check_interrupt.arrived 中断。
            }

            $queue[] = array($neighbor, $distance + 1);
        }
    }

    return $candidates;
}

/**
 * 选未发现的 POI 搜索位置作为目标（设计案 §7.4 优先级 2, §7.9，F-E5-Target §5.6 四种倾向差异化）
 *
 * 查询当前区域 discovered=0 的 POI，按移动倾向排序选首个候选。
 * 不向前端泄露 POI 具体位置（前端只显示"正在搜索可疑区域"）。
 *
 * 倾向差异化排序（与 select_unexplored_tile 一致，但 POI 候选不应用距离上限过滤——
 * POI 是稀缺资源，距离过远时玩家可中断导航 route_invalid，不应在目标选择阶段提前放弃）：
 *   - steady：距离升序 → tide_weight 升序
 *   - nearby：行动次数升序 → 距离升序
 *   - deep：tide_weight 降序 → 距离升序
 *   - efficient：距离降序 → tide_weight 升序
 *
 * F-E5-Target §三.10：POI 候选同样排除被活单位占用的图格。
 *   POI 进入信息范围后必发现，玩家走过去后才能互动；若 POI 所在格被敌人占用，
 *   玩家走不过去，选这样的目标必然导致首次移动即中断。
 *
 * @param int    $pgroup  区域
 * @param int    $pls     当前格
 * @param string $tendency 倾向
 * @param array  &$pdata  玩家数据
 * @return int|null 目标格 pls
 */
function obl_navigation_select_undiscovered_poi($pgroup, $pls, $tendency, &$pdata) {
    global $db, $tablepre;

    $pgroup = (int)$pgroup;
    $pls = (int)$pls;
    $tendency = obl_navigation_normalize_tendency($tendency);

    // 查询当前区域未发现的 POI
    $result = $db->query("SELECT pls FROM {$tablepre}oblmappoi
                           WHERE pgroup='{$pgroup}' AND discovered=0
                           ORDER BY iaid");
    if (!$result) return null;

    $raw_candidates = array();
    while ($row = $db->fetch_array($result)) {
        $raw_candidates[] = (int)$row['pls'];
    }

    if (empty($raw_candidates)) return null;

    // F-E5-Target §三.10：预收集所有活敌人（含未发现）占用格，POI 候选筛选时跳过
    // 与 obl_navigation_select_unexplored_tile 一致，目标选择阶段不区分已发现/未发现敌人
    $occupied_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, (int)($pdata['pid'] ?? 0), true);

    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();

    $tendency_cfg = obl_navigation_tendency_config();
    $weight_map = $tendency_cfg['tide_weight_map'];
    $move_power = function_exists('obl_get_move_power') ? (int)obl_get_move_power($pdata) : 1;
    $move_power = max(1, $move_power);

    // 构造候选集合（带 BFS 距离 + tide 信息）
    $candidates = array();
    foreach ($raw_candidates as $candidate_pls) {
        // F-E5-Target §三.10：被活单位占用的 POI 候选跳过（玩家走不过去）
        if (isset($occupied_tiles[$candidate_pls])) continue;
        $distance = obl_get_distance($pgroup, $pls, $candidate_pls);
        if ($distance === -1) continue;  // 不可达
        $tide = isset($tiles[$candidate_pls]) ? obl_navigation_tile_tide($tiles[$candidate_pls]) : 'shallow';
        $candidates[] = array(
            'pls'         => $candidate_pls,
            'distance'    => $distance,
            'tide'        => $tide,
            'tide_weight' => obl_navigation_tide_weight($tide, $weight_map),
        );
    }

    if (empty($candidates)) return null;

    // 按倾向排序选首个候选（POI 候选不做距离上限过滤）
    $best = obl_navigation_score_tendency_candidates($candidates, $tendency, $move_power);
    return $best !== null ? (int)$best['pls'] : null;
}

/**
 * 选隐藏敌人搜索位置作为目标（E-Q5-E Q5-14，设计案 §5.3 + §5.4）
 *
 * 当所有未探索格和未发现 POI 均已处理完后（优先级 1/2 均返回 null），
 * 移动按钮继续承担内容搜索入口。查询当前区域 state=0（活）且 discovered=0
 * （未发现）的敌人，按移动倾向排序取首个敌人所在格作为搜索位置。
 *
 * 不向前端泄露敌人实体信息（§5.5 后端可用隐藏数据，前端不提前泄露）：
 *   - 前端只看到搜索位置 pls（作为导航目标），不看到敌人 pid/name
 *   - 搜索位置是敌人当前位置快照，敌人可在导航过程中移动/离开/突袭
 *
 * 玩家抵达搜索位置后必定停止（§5.3），由 check_interrupt.arrived 中断；
 * 敌人之后可以移动、离开、靠近或突袭（§5.4），本次导航不持续追踪实体。
 * 通常情况下玩家在抵达搜索位置前已进入敌人信息范围，触发 enemy_discovered
 * 中断（由移动过程中的 info 采集机制触发），不会真正踏上敌人所在格。
 *
 * 倾向差异化排序（与 select_undiscovered_poi 一致，不做距离上限过滤）：
 *   - steady：距离升序 → tide_weight 升序
 *   - nearby：行动次数升序 → 距离升序
 *   - deep：tide_weight 降序 → 距离升序
 *   - efficient：距离降序 → tide_weight 升序
 *
 * F-E6-Combat §5.3：BFS 距离计算只避开已发现敌人（隐藏敌人不阻挡路径）；
 *   隐藏敌人所在格作为目标格可达（BFS 目标格不被 blocked_tiles 阻挡）。
 *
 * 边界案例：
 *   - 隐藏敌人在导航过程中被击杀：下次选目标时该敌人 state>0，不再进入候选
 *   - 隐藏敌人在导航过程中突袭玩家：触发 force_combat 中断，搜索位置失效
 *   - 隐藏敌人所在格不可通行：跳过该候选（不选不可达目标）
 *   - 区域内无活着的隐藏敌人：返回 null，select_target 走优先级 4 返回 no_target
 *
 * @param int    $pgroup  当前区域
 * @param int    $pls     当前格
 * @param string $tendency 移动倾向
 * @param array  &$pdata  玩家数据
 * @return int|null 搜索位置 pls（敌人所在格），null 表示无可用目标
 */
function obl_navigation_select_hidden_enemy_search_position($pgroup, $pls, $tendency, &$pdata) {
    global $db, $tablepre;
    $pgroup = (int)$pgroup;
    $pls = (int)$pls;
    $tendency = obl_navigation_normalize_tendency($tendency);

    // 查询当前区域 state=0（活）且 discovered=0（未发现）的敌人
    $sql = "SELECT pls FROM {$tablepre}oblplayers
            WHERE type > 0 AND pgroup = {$pgroup}
              AND state = 0 AND discovered = 0";
    $result = $db->query($sql);
    if (!$result) return null;

    $raw_candidates = array();
    while ($row = $db->fetch_array($result)) {
        $raw_candidates[] = (int)$row['pls'];
    }
    if (empty($raw_candidates)) return null;

    // 获取区域图格数据
    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup] ?? array();
    if (!isset($tiles[$pls])) return null;

    // F-E6-Combat §5.3：BFS 寻路只避开已发现敌人（隐藏敌人不阻挡路径）
    // 隐藏敌人所在格作为目标格可达（BFS 目标格不被 blocked_tiles 阻挡）
    $blocked_tiles = obl_navigation_get_enemy_occupied_tiles($pgroup, (int)($pdata['pid'] ?? 0), false);

    $tendency_cfg = obl_navigation_tendency_config();
    $weight_map = $tendency_cfg['tide_weight_map'];
    $move_power = function_exists('obl_get_move_power') ? (int)obl_get_move_power($pdata) : 1;
    $move_power = max(1, $move_power);

    // 构造候选集合（带 BFS 距离 + tide 信息）
    $candidates = array();
    foreach ($raw_candidates as $enemy_pls) {
        if (!isset($tiles[$enemy_pls])) continue;
        // 敌人所在格必须可通行（不可通行格如墙壁内的敌人不作为搜索目标）
        if (empty($tiles[$enemy_pls]['passable'])) continue;
        // 计算玩家到敌人所在格的 BFS 距离（隐藏敌人不阻挡路径）
        $bfs_result = obl_navigation_standard_bfs_next($pls, $enemy_pls, $tiles, $blocked_tiles);
        if ($bfs_result['next'] === null && $pls !== $enemy_pls) continue;
        $distance = $bfs_result['length'];
        if ($distance < 0) continue;
        $tide = obl_navigation_tile_tide($tiles[$enemy_pls]);
        $candidates[] = array(
            'pls'         => $enemy_pls,
            'distance'    => $distance,
            'tide'        => $tide,
            'tide_weight' => obl_navigation_tide_weight($tide, $weight_map),
        );
    }

    if (empty($candidates)) return null;

    // 按倾向排序选首个候选（与 select_undiscovered_poi 一致，不做距离上限过滤）
    $best = obl_navigation_score_tendency_candidates($candidates, $tendency, $move_power);
    return $best !== null ? (int)$best['pls'] : null;
}
