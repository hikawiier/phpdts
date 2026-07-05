<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 道具合成系统 / Oblivions item crafting
//
// 实现合成系统的核心匹配算法和素材消耗逻辑。
// 命令入口（item_craft）和 API 函数（craft_preview 等）在 U5 追加。
//
// 依赖：item.tag.func.php（item_get_tags / item_get_itmk / item_get_tool_level）
//       item.use.func.php（item_consume_durability）
//       explore.func.php（obl_get_poi_at_position）
//       以上由 obl_bootstrap.php 统一加载
// ================================================================

// ----------------------------------------------------------------
// 5.5.0 配方读取（带静态缓存）
// ----------------------------------------------------------------

/**
 * 读取单个配方（带静态缓存）
 *
 * @param string $recipe_id
 * @return array|null  配方数据或 null（不存在）
 */
function item_get_recipe($recipe_id) {
    static $cache = null;
    if ($cache === null) {
        $cache = include GAME_ROOT . './oblivions/gamedata/recipe_table.php';
    }
    return isset($cache[$recipe_id]) ? $cache[$recipe_id] : null;
}

/**
 * 读取全部配方（带静态缓存）
 *
 * @return array  recipe_id => 配方数据
 */
function item_get_all_recipes() {
    static $cache = null;
    if ($cache === null) {
        $cache = include GAME_ROOT . './oblivions/gamedata/recipe_table.php';
    }
    return $cache;
}

// ----------------------------------------------------------------
// 5.5.3 可用工作台素材查询（U4 实现，item_consume_materials 依赖）
// ----------------------------------------------------------------

/**
 * 查询玩家当前可用的工作台素材列表
 *
 * 来源：
 * 1. 被动技能（永久可用，P0 硬编码 innate_craft_t0）
 * 2. 猫身上（P0 阶段未实现）
 * 3. 地图格 POI（玩家必须站在工作台 POI 上）
 *
 * @param array &$pdata 玩家数据
 * @return array  [{source, id, item_id, tool_level}]
 *   - source：来源类型（'passive' / 'cat' / 'poi'）
 *   - id：工作台素材唯一标识（用于 obl_craft 和 craft_preview 的 workbench_materials 参数）
 *   - item_id：关联的 item_table 道具 ID
 *   - tool_level：工具等级
 */
function item_get_available_workbench_materials(&$pdata) {
    $materials = [];

    // 1. 被动技能来源（永久可用）
    //    P0 阶段硬编码：玩家自带 innate_t0
    $materials[] = [
        'source'     => 'passive',
        'id'         => 'passive:innate_t0',
        'item_id'    => 'innate_craft_t0',
        'tool_level' => 0,
    ];

    // 2. 猫身上来源（猫在身边时可用）
    //    P0 阶段：猫未升级，无便携工作站

    // 3. 地图格 POI 来源（玩家必须站在工作台 POI 上）
    //    查询玩家当前格子上的所有 POI 实例，遍历过滤 mechanic='craft_source'
    $pois = obl_get_poi_at_position($pdata['pgroup'], $pdata['pls']);
    foreach ($pois as $poi) {
        if (isset($poi['mechanic']) && $poi['mechanic'] === 'craft_source') {
            $item_id = isset($poi['mechanic_value']) ? $poi['mechanic_value'] : '';
            if ($item_id === '') continue;
            $materials[] = [
                'source'     => 'poi',
                'id'         => 'poi:' . $poi['iaid'],
                'item_id'    => $item_id,
                'tool_level' => item_get_tool_level($item_id),
            ];
        }
    }

    return $materials;
}

// ----------------------------------------------------------------
// 5.5.7 素材-槽位映射（核心算法）
// ----------------------------------------------------------------

/**
 * 检查素材是否可匹配指定 consume 模式
 * 工作台素材（source='workbench'）只能匹配 consume='none'
 *
 * @param array  $item     素材（含 source 字段）
 * @param string $consume  consume 模式（'all' / 'durability' / 'none'）
 * @return bool
 */
function item_can_consume($item, $consume) {
    if ($consume === 'none') return true;
    if ($item['source'] === 'workbench') return false;
    return true;
}

/**
 * 解析素材-槽位映射
 *
 * 共享辅助函数：item_materials_match（指向性判断）和 item_consume_materials（素材扣减）共用此函数。
 * 返回每个被消耗的素材及其对应的 consume 模式，或 null 表示不匹配。
 *
 * 匹配规则（设计案 §5.5.7）：
 * 1. 先匹配具体 item_id 素材（精确匹配优先）
 * 2. 再匹配 itmk 素材（类别匹配次之）
 * 3. 最后匹配 tag 素材（性质匹配最后）
 * 4. min_level 检查：素材的 tool_level 必须 ≥ material 的 min_level
 * 5. consume 约束：工作台素材只能匹配 consume='none' 的槽位
 * 6. 所有放置的素材必须都被消耗（多放也算不匹配，避免指向不明确）
 * 7. 同一素材不能同时满足多个槽位（由匹配优先级保证）
 *
 * @param array $materials   配方的 materials 数组
 * @param array $placed_items [['item_id'=>xxx, 'itmk'=>xxx, 'tags'=>[...], 'tool_level'=>n, 'source'=>'bag'|'workbench'], ...]
 * @return array|null  匹配成功返回 [['placed_index'=>i, 'consume'=>mode], ...]；失败返回 null
 */
function item_resolve_material_mapping($materials, $placed_items) {
    // 1. 复制 placed_items 用于消耗标记
    $available = [];
    foreach ($placed_items as $i => $p) {
        $available[] = [
            'index'      => $i,
            'item_id'    => isset($p['item_id']) ? $p['item_id'] : '',
            'itmk'       => isset($p['itmk']) ? $p['itmk'] : '',
            'tags'       => isset($p['tags']) ? $p['tags'] : [],
            'tool_level' => isset($p['tool_level']) ? $p['tool_level'] : 0,
            'source'     => isset($p['source']) ? $p['source'] : 'bag',
            'used'       => false,
        ];
    }

    $mapping = [];

    // 2. 先匹配具体 item_id 素材（精确匹配优先）
    foreach ($materials as $mat) {
        if (isset($mat['item_id'])) {
            $need = (int)($mat['count'] ?? 1);
            $consume = $mat['consume'] ?? 'all';
            $min_level = (int)($mat['min_level'] ?? 0);
            $n = count($available);
            for ($i = 0; $i < $n && $need > 0; $i++) {
                if (!$available[$i]['used']
                    && $available[$i]['item_id'] === $mat['item_id']
                    && $available[$i]['tool_level'] >= $min_level
                    && item_can_consume($available[$i], $consume)) {
                    $available[$i]['used'] = true;
                    $mapping[] = ['placed_index' => $available[$i]['index'], 'consume' => $consume];
                    $need--;
                }
            }
            if ($need > 0) return null;
        }
    }

    // 3. 再匹配 itmk 素材（类别匹配次之）
    foreach ($materials as $mat) {
        if (isset($mat['itmk'])) {
            $need = (int)($mat['count'] ?? 1);
            $consume = $mat['consume'] ?? 'all';
            $min_level = (int)($mat['min_level'] ?? 0);
            $n = count($available);
            for ($i = 0; $i < $n && $need > 0; $i++) {
                if (!$available[$i]['used']
                    && $available[$i]['itmk'] === $mat['itmk']
                    && $available[$i]['tool_level'] >= $min_level
                    && item_can_consume($available[$i], $consume)) {
                    $available[$i]['used'] = true;
                    $mapping[] = ['placed_index' => $available[$i]['index'], 'consume' => $consume];
                    $need--;
                }
            }
            if ($need > 0) return null;
        }
    }

    // 4. 最后匹配 tag 素材（性质匹配最后）
    foreach ($materials as $mat) {
        if (isset($mat['tag'])) {
            $need = (int)($mat['count'] ?? 1);
            $consume = $mat['consume'] ?? 'all';
            $min_level = (int)($mat['min_level'] ?? 0);
            $n = count($available);
            for ($i = 0; $i < $n && $need > 0; $i++) {
                if (!$available[$i]['used']
                    && in_array($mat['tag'], $available[$i]['tags'])
                    && $available[$i]['tool_level'] >= $min_level
                    && item_can_consume($available[$i], $consume)) {
                    $available[$i]['used'] = true;
                    $mapping[] = ['placed_index' => $available[$i]['index'], 'consume' => $consume];
                    $need--;
                }
            }
            if ($need > 0) return null;
        }
    }

    // 5. 检查是否所有放置的素材都被消耗（多放也不匹配）
    foreach ($available as $a) {
        if (!$a['used']) return null;
    }

    return $mapping;
}

// ----------------------------------------------------------------
// 5.5.6 素材多重集匹配（布尔包装）
// ----------------------------------------------------------------

/**
 * 素材多重集匹配（item_resolve_material_mapping 的布尔包装）
 *
 * @param array $materials   配方的 materials 数组
 * @param array $placed_items 放置的素材列表
 * @return bool  true=匹配成功
 */
function item_materials_match($materials, $placed_items) {
    return item_resolve_material_mapping($materials, $placed_items) !== null;
}

// ----------------------------------------------------------------
// 5.5.x 统计背包素材数量
// ----------------------------------------------------------------

/**
 * 统计背包中指定 item_id 的素材数量
 *
 * @param array  &$pdata  玩家数据
 * @param string $item_id 道具 ID
 * @return int
 */
function item_count_material_in_inventory(&$pdata, $item_id) {
    if (!isset($pdata['itempara']) || !is_array($pdata['itempara'])) return 0;
    $count = 0;
    foreach ($pdata['itempara'] as $item) {
        if (is_array($item) && isset($item['itmid']) && $item['itmid'] === $item_id) {
            $count++;
        }
    }
    return $count;
}

// ----------------------------------------------------------------
// 5.5.8 素材扣减
// ----------------------------------------------------------------

/**
 * 扣除合成素材
 *
 * 调用 item_resolve_material_mapping 获取映射，再按 consume 模式分别处理。
 * 工作台素材只能匹配 consume='none'（由 item_can_consume 保证），无需扣减。
 *
 * @param array &$pdata     玩家数据
 * @param array $materials  配方的 materials 数组
 * @param array $slots      玩家放入素材池的背包槽位号列表
 * @param array $workbench_materials  工作台素材 ID 列表
 * @return bool  扣除成功返回 true
 */
function item_consume_materials(&$pdata, $materials, $slots, $workbench_materials = []) {
    // 1. 读取背包素材 + 工作台素材，合并为 placed_items
    $placed_items = [];
    $slot_map = [];     // placed_items 索引 → 背包槽位号（仅背包素材有）
    $bag_count = 0;     // 背包素材数量（用于区分 placed_index 对应背包还是工作台）

    foreach ($slots as $slot) {
        $slot = (int)$slot;
        $item = isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
        if ($item && !empty($item['itmid'])) {
            $placed_items[] = [
                'item_id'    => $item['itmid'],
                'itmk'       => item_get_itmk($item['itmid']),
                'tags'       => item_get_tags($item['itmid']),
                'tool_level' => item_get_tool_level($item['itmid']),
                'source'     => 'bag',
            ];
            $slot_map[] = $slot;
            $bag_count++;
        }
    }

    // 工作台素材追加到 placed_items 末尾
    $available_wb = item_get_available_workbench_materials($pdata);
    foreach ($workbench_materials as $wb_id) {
        foreach ($available_wb as $wb) {
            if ($wb['id'] === $wb_id) {
                $placed_items[] = [
                    'item_id'    => $wb['item_id'],
                    'itmk'       => item_get_itmk($wb['item_id']),
                    'tags'       => item_get_tags($wb['item_id']),
                    'tool_level' => $wb['tool_level'],
                    'source'     => 'workbench',
                ];
                break;
            }
        }
    }

    // 2. 调用共享映射函数
    $mapping = item_resolve_material_mapping($materials, $placed_items);
    if ($mapping === null) {
        return false;  // 理论上不会走到这里（item_craft 流程已确认匹配）
    }

    // 3. 按 consume 模式处理每个被消耗的素材
    //    工作台素材只匹配 consume='none'，无需操作
    //    只有背包素材需要处理 consume='all' / 'durability'
    foreach ($mapping as $m) {
        $idx = $m['placed_index'];
        if ($idx >= $bag_count) {
            // 工作台素材，consume 必为 'none'，跳过
            continue;
        }
        $slot = $slot_map[$idx];
        $item = &$pdata['itempara'][$slot];

        switch ($m['consume']) {
            case 'all':
                // 从背包移除（清空槽位为 null，与 obl_discard_item 一致）
                unset($pdata['itempara'][$slot]);
                break;

            case 'durability':
                // 素材保留，扣 1 点耐久
                item_consume_durability($item, 1);
                break;

            case 'none':
                // 素材完全保留（不消耗不扣耐久）
                break;
        }
    }

    return true;
}

// ================================================================
// U5：合成命令入口 + API 函数 + 已发现配方管理
// ================================================================

// ----------------------------------------------------------------
// 5.5.2 指向性判断（匹配配方列表）
// ----------------------------------------------------------------

/**
 * 匹配素材池对应的配方列表（指向性判断）
 *
 * 遍历所有配方，找 materials 完全匹配的。
 * 软锁是显示控制，不是合成拦截（详见设计案 §2.5.1）。
 *
 * @param array &$pdata
 * @param array $slots              背包槽位号列表
 * @param array $workbench_materials 工作台素材 ID 列表
 * @return array 匹配的 recipe_id 列表（0个=不亮，1个=亮，2+=不亮）
 */
function item_match_recipes_by_slots(&$pdata, $slots, $workbench_materials = []) {
    // 标准化 slots：去重 + 过滤无效值（slot < 1 为特殊槽）
    $slots = array_values(array_unique(array_filter(array_map('intval', $slots), function($s) { return $s >= 1; })));

    $placed_items = [];

    // 1. 读取背包素材
    foreach ($slots as $slot) {
        $slot = (int)$slot;
        $item = isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
        if ($item && !empty($item['itmid'])) {
            $placed_items[] = [
                'item_id'    => $item['itmid'],
                'itmk'       => item_get_itmk($item['itmid']),
                'tags'       => item_get_tags($item['itmid']),
                'tool_level' => item_get_tool_level($item['itmid']),
                'source'     => 'bag',
            ];
        }
    }

    // 2. 读取工作台素材（通过 item_get_available_workbench_materials 验证并获取元数据）
    $available_wb = item_get_available_workbench_materials($pdata);
    foreach ($workbench_materials as $wb_id) {
        foreach ($available_wb as $wb) {
            if ($wb['id'] === $wb_id) {
                $placed_items[] = [
                    'item_id'    => $wb['item_id'],
                    'itmk'       => item_get_itmk($wb['item_id']),
                    'tags'       => item_get_tags($wb['item_id']),
                    'tool_level' => $wb['tool_level'],
                    'source'     => 'workbench',
                ];
                break;
            }
        }
    }

    // 3. 遍历所有配方，找 materials 完全匹配的
    $matched = [];
    foreach (item_get_all_recipes() as $recipe_id => $recipe) {
        if (item_materials_match($recipe['materials'], $placed_items)) {
            $matched[] = $recipe_id;
        }
    }

    return $matched;
}

// ----------------------------------------------------------------
// 5.5.4 已发现配方查询 + 可见性过滤接口
// ----------------------------------------------------------------

/**
 * 配方可见性过滤接口（可替换）
 *
 * P0 默认返回 true（所有已发现配方都可见）。
 * 后续设计案确定过滤依据（全局事件/剧情节点/玩家进度等）后，替换此实现（见 §2.5.3）。
 *
 * @param array $recipe  配方数据
 * @param array &$pdata  玩家数据
 * @return bool true=可见，false=隐藏
 */
function item_recipe_visibility_filter($recipe, &$pdata) {
    return true;
}

/**
 * 查询已发现配方列表（按可见性过滤）
 *
 * @param array &$pdata
 * @return array [{recipe_id, category, materials, results}]
 */
function item_get_discovered_recipes(&$pdata) {
    $discovered = isset($pdata['oblpara']['discovered_recipes']) ? $pdata['oblpara']['discovered_recipes'] : [];
    if (!is_array($discovered)) $discovered = [];

    $result = [];
    foreach ($discovered as $recipe_id) {
        $recipe = item_get_recipe($recipe_id);
        if (!$recipe) continue;

        if (!item_recipe_visibility_filter($recipe, $pdata)) {
            continue;
        }

        $result[] = [
            'recipe_id' => $recipe_id,
            'category'  => $recipe['category'],
            'materials' => $recipe['materials'],
            'results'   => $recipe['results'],
        ];
    }

    return $result;
}

/**
 * 标记配方为已发现
 *
 * @param array  &$pdata
 * @param string $recipe_id
 */
function item_discover_recipe(&$pdata, $recipe_id) {
    if (!isset($pdata['oblpara']) || !is_array($pdata['oblpara'])) {
        $pdata['oblpara'] = [];
    }
    if (!isset($pdata['oblpara']['discovered_recipes']) || !is_array($pdata['oblpara']['discovered_recipes'])) {
        $pdata['oblpara']['discovered_recipes'] = [];
    }
    if (!in_array($recipe_id, $pdata['oblpara']['discovered_recipes'], true)) {
        $pdata['oblpara']['discovered_recipes'][] = $recipe_id;
    }
}

// ----------------------------------------------------------------
// 5.5.5 前端预判 API
// ----------------------------------------------------------------

/**
 * 前端预判：素材池能否合成
 *
 * @param array $slots               背包槽位号列表
 * @param array &$pdata
 * @param array $workbench_materials 工作台素材 ID 列表
 * @return array {match_count, craftable, is_new_recipe}
 */
function item_craft_preview($slots, &$pdata, $workbench_materials = []) {
    $matched = item_match_recipes_by_slots($pdata, $slots, $workbench_materials);
    $match_count = count($matched);
    $craftable = ($match_count === 1);

    $is_new_recipe = false;
    if ($craftable) {
        $recipe_id = $matched[0];
        $discovered = isset($pdata['oblpara']['discovered_recipes']) ? $pdata['oblpara']['discovered_recipes'] : [];
        if (!is_array($discovered)) $discovered = [];
        $is_new_recipe = !in_array($recipe_id, $discovered, true);
    }

    return [
        'match_count'   => $match_count,
        'craftable'     => $craftable,
        'is_new_recipe' => $is_new_recipe,
    ];
}

// ----------------------------------------------------------------
// 5.5.1 合成入口（12 步流程）
// ----------------------------------------------------------------

/**
 * 合成入口（设计案 §5.5.1）
 *
 * 流程：
 *   1. 解析 $slots（背包素材）
 *   2. 解析 $workbench_materials（工作台素材）
 *   3. 调用 item_match_recipes_by_slots → $matched
 *   4. 根据 count($matched) 分支（0=不匹配，2+=指向不明确，1=继续）
 *   5. 取唯一匹配的 $recipe
 *   6. 检查背包剩余空间（所有产物入背包）
 *   7. 介入点 1：合成失败检查（P0 预留，跳过）
 *   8. 调用 item_consume_materials（素材扣减）
 *   9. 添加所有产物到背包
 *  10. 检查是否新发现配方 → item_discover_recipe + emit craft.new_recipe_discovered
 *  11. emit craft.success
 *  12. 保存 $pdata（由上层调用方负责）
 *
 * @param mixed $slots               背包槽位号列表（数组或逗号分隔字符串）
 * @param array &$pdata
 * @param mixed $workbench_materials 工作台素材 ID 列表（数组或逗号分隔字符串）
 * @return void
 */
function item_craft($slots, &$pdata, $workbench_materials = []) {
    global $obl_log;

    // 标准化参数为数组
    if (!is_array($slots)) {
        $slots = ($slots === '' || $slots === null) ? [] : explode(',', (string)$slots);
    }
    if (!is_array($workbench_materials)) {
        $workbench_materials = ($workbench_materials === '' || $workbench_materials === null) ? [] : explode(',', (string)$workbench_materials);
    }
    // 标准化 slots：去重 + 过滤无效值（slot < 1 为特殊槽，不可作为合成素材）
    $slots = array_values(array_unique(array_filter(array_map('intval', $slots), function($s) { return $s >= 1; })));

    // 步骤 1-2：解析 slots 和 workbench_materials（在 item_match_recipes_by_slots 内完成）

    // 步骤 3：调用 item_match_recipes_by_slots
    $matched = item_match_recipes_by_slots($pdata, $slots, $workbench_materials);

    // 步骤 4：根据 count($matched) 分支
    $match_count = count($matched);
    if ($match_count === 0) {
        $obl_log->emit('craft.fail_no_match', 'system');
        return;
    }
    if ($match_count >= 2) {
        $obl_log->emit('craft.fail_ambiguous', 'system', ['match_count' => $match_count]);
        return;
    }

    // 步骤 5：取唯一匹配的 $recipe
    $recipe_id = $matched[0];
    $recipe = item_get_recipe($recipe_id);

    // 步骤 6：检查背包剩余空间（所有产物入背包）
    $results_count = 0;
    foreach ($recipe['results'] as $r) {
        $results_count += (int)($r['count'] ?? 1);
    }

    // 构建 placed_items（与 item_consume_materials 相同的逻辑，用于精确计算消耗后空出的槽位）
    $placed_items = [];
    $bag_count = 0;
    foreach ($slots as $slot) {
        $slot = (int)$slot;
        $item = isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
        if ($item && !empty($item['itmid'])) {
            $placed_items[] = [
                'item_id'    => $item['itmid'],
                'itmk'       => item_get_itmk($item['itmid']),
                'tags'       => item_get_tags($item['itmid']),
                'tool_level' => item_get_tool_level($item['itmid']),
                'source'     => 'bag',
            ];
            $bag_count++;
        }
    }
    $available_wb = item_get_available_workbench_materials($pdata);
    foreach ($workbench_materials as $wb_id) {
        foreach ($available_wb as $wb) {
            if ($wb['id'] === $wb_id) {
                $placed_items[] = [
                    'item_id'    => $wb['item_id'],
                    'itmk'       => item_get_itmk($wb['item_id']),
                    'tags'       => item_get_tags($wb['item_id']),
                    'tool_level' => $wb['tool_level'],
                    'source'     => 'workbench',
                ];
                break;
            }
        }
    }

    $mapping = item_resolve_material_mapping($recipe['materials'], $placed_items);
    if ($mapping === null) {
        // 理论上不会走到这里（步骤 3 已确认匹配）
        $obl_log->emit('craft.fail_no_match', 'system');
        return;
    }

    // 统计将被清空的槽位数（consume='all' 且 source='bag'）
    $freed_slots = 0;
    foreach ($mapping as $m) {
        if ($m['consume'] === 'all' && $m['placed_index'] < $bag_count) {
            $freed_slots++;
        }
    }

    // 当前空槽位数
    $empty_count = 0;
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    for ($i = 1; $i <= $maxslots; $i++) {
        $slot_item = isset($pdata['itempara'][$i]) ? $pdata['itempara'][$i] : null;
        if ($slot_item === null || !is_array($slot_item) || empty($slot_item['itmid'])) {
            $empty_count++;
        }
    }

    if ($empty_count + $freed_slots < $results_count) {
        $obl_log->emit('craft.fail_bag_full', 'system');
        return;
    }

    // 步骤 7：介入点 1（合成失败检查，P0 跳过）
    // 未来合成失败机制可在此处介入（emit craft.fail {recipe_id, reason}）

    // 步骤 8：调用 item_consume_materials（素材扣减）
    // 介入点 2：鉴定系统未来可在此处检查素材的真实 Tag
    item_consume_materials($pdata, $recipe['materials'], $slots, $workbench_materials);

    // 步骤 9：添加所有产物到背包
    $table = item_load_table();
    $added_results = [];
    foreach ($recipe['results'] as $r) {
        $item_id = $r['item_id'];
        $count = (int)($r['count'] ?? 1);
        $template = isset($table[$item_id]) ? $table[$item_id] : null;
        if (!$template) {
            // 模板不存在，跳过（理论上不应该发生）
            continue;
        }
        $actually_added = 0;
        for ($i = 0; $i < $count; $i++) {
            $slot = obl_find_empty_slot($pdata);
            if ($slot === false) {
                // 理论上不会走到这里（步骤 6 已检查空间）
                break;
            }
            $new_item = [
                'itm'     => '',  // 新道具 itm 留空，由前端通过 item_id 查询 locale
                'itmk'    => $template['itmk'],
                'itme'    => (int)$template['itme'],
                'itms'    => $template['itms'],
                'itmsk'   => $template['itmsk'],
                'itmpara' => isset($template['itmpara']) && is_array($template['itmpara']) ? $template['itmpara'] : [],
                'itmid'   => $item_id,
            ];
            obl_set_item($pdata, $slot, $new_item);
            $actually_added++;
        }
        if ($actually_added > 0) {
            $added_results[] = ['item_id' => $item_id, 'count' => $actually_added];
        }
    }

    // 步骤 10：检查是否新发现配方
    $discovered = isset($pdata['oblpara']['discovered_recipes']) ? $pdata['oblpara']['discovered_recipes'] : [];
    if (!is_array($discovered)) $discovered = [];
    if (!in_array($recipe_id, $discovered, true)) {
        item_discover_recipe($pdata, $recipe_id);
        $obl_log->emit('craft.new_recipe_discovered', 'system', ['recipe_id' => $recipe_id]);
    }

    // 步骤 11：emit craft.success
    // 介入点 3：对话系统订阅 craft.success 触发猫提醒
    $obl_log->emit('craft.success', 'system', [
        'results'   => $added_results,
        'recipe_id' => $recipe_id,
    ]);

    // 步骤 12：保存 $pdata（由上层调用方负责）
}

// ----------------------------------------------------------------
// 5.5.x POI 机制占位
// ----------------------------------------------------------------

/**
 * POI 机制占位：craft_source 类型
 *
 * 工作台 POI 的素材获取由 item_get_available_workbench_materials() 完成。
 * 此函数为未来扩展预留（如工作台升级、特殊交互等），P0 阶段不实现具体逻辑。
 *
 * @param array $template POI 模板配置
 * @param array &$pdata   玩家数据
 */
function obl_mechanic_craft_source($template, &$pdata) {
    // P0 占位：工作台 POI 的交互逻辑由合成系统接管，此处不实现
}
