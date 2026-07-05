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
//       item.use.func.php（item_consume_itms）
//       item.basic.func.php（item_destroy_if_depleted）
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
// 5.5.x slots 参数解析 + placed_items 构建（P2 重构）
// ----------------------------------------------------------------

/**
 * 解析 slots 参数为 [slot => count] 映射
 *
 * 支持两种格式：
 * - "1:3,2:1" 或 ["1:3","2:1"] → [1 => 3, 2 => 1]
 * - "1,2,3" 或 ["1","2","3"]   → [1 => 1, 2 => 1, 3 => 1]（旧格式兼容）
 *
 * 同槽位多次引用会合并数量。slot < 1（特殊槽，含 itm0）不可投入。
 *
 * @param mixed $slots  逗号分隔字符串或数组
 * @return array  [slot => count, ...]
 */
function item_parse_slots($slots) {
    if (!is_array($slots)) {
        $slots = ($slots === '' || $slots === null) ? [] : explode(',', (string)$slots);
    }
    $result = [];
    foreach ($slots as $entry) {
        $entry = trim((string)$entry);
        if ($entry === '') continue;
        if (strpos($entry, ':') !== false) {
            list($slot, $count) = explode(':', $entry, 2);
            $slot = (int)$slot;
            $count = max(1, (int)$count);
        } else {
            $slot = (int)$entry;
            $count = 1;
        }
        if ($slot < 1) continue;  // 特殊槽（含 itm0）不可投入
        $result[$slot] = ($result[$slot] ?? 0) + $count;  // 同槽多次引用合并
    }
    return $result;
}

/**
 * 构建 placed_items + slot_map（P2 重构 + 堆叠适配）
 *
 * 把背包素材按投入数量展开为虚拟 placed_item，追加工作台素材。
 * 供 item_match_recipes_by_slots / item_consume_materials / item_craft 共用。
 *
 * 展开逻辑：槽位有 N 个可堆叠素材 → 展开为 N 个虚拟 placed_item，都指向该槽位。
 * 不可堆叠道具 itms=1（投入 count 必为 1），展开为 1 个 placed_item。
 * 投入数量不超过实际堆叠数量（无限标识不限）。
 *
 * @param array &$pdata
 * @param array $slot_counts  [slot => count] 映射（由 item_parse_slots 生成）
 * @param array $workbench_materials  工作台素材 ID 列表
 * @return array  [
 *   'placed_items' => [...],   // 虚拟 placed_item 列表
 *   'slot_map'     => [...],   // placed_index → 槽位号（仅背包素材）
 *   'bag_count'    => int,     // 背包素材数量（区分工作台素材的起点）
 * ]
 */
function _item_build_placed_items(&$pdata, $slot_counts, $workbench_materials = []) {
    $placed_items = [];
    $slot_map = [];
    $bag_count = 0;

    // 1. 背包素材：按 count 展开为虚拟 placed_item（校验不超实际数量）
    foreach ($slot_counts as $slot => $count) {
        $slot = (int)$slot;
        $item = isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
        if (!$item || !is_array($item) || empty($item['itmid'])) continue;

        // 校验投入数量不超过实际堆叠数量（无限标识不限）
        $s = (string)$item['itms'];
        if ($s === '∞' || $s === '999') {
            $actual_count = $count;
        } else {
            $actual_count = min($count, max(0, (int)$s));
        }

        $item_id = $item['itmid'];
        for ($i = 0; $i < $actual_count; $i++) {
            $placed_items[] = [
                'item_id'    => $item_id,
                'itmk'       => item_get_itmk($item_id),
                'tags'       => item_get_tags($item_id),
                'tool_level' => item_get_tool_level($item_id),
                'source'     => 'bag',
            ];
            $slot_map[] = $slot;
            $bag_count++;
        }
    }

    // 2. 工作台素材（不展开，每个工作台素材是1个 placed_item）
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

    return [
        'placed_items' => $placed_items,
        'slot_map'     => $slot_map,
        'bag_count'    => $bag_count,
    ];
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
        'tags'       => item_get_tags('innate_craft_t0'),
        'itmk'       => item_get_itmk('innate_craft_t0'),
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
                'tags'       => item_get_tags($item_id),
                'itmk'       => item_get_itmk($item_id),
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
 * 统计背包中指定 item_id 的素材数量（堆叠数量，跳过 itm0）
 *
 * 可堆叠道具返回堆叠数量总和；无限标识返回 PHP_INT_MAX。
 *
 * @param array  &$pdata  玩家数据
 * @param string $item_id 道具 ID
 * @return int
 */
function item_count_material_in_inventory(&$pdata, $item_id) {
    if (!isset($pdata['itempara']) || !is_array($pdata['itempara'])) return 0;
    $count = 0;
    foreach ($pdata['itempara'] as $slot => $item) {
        if ($slot == 0) continue;  // 跳过 itm0
        if (is_array($item) && isset($item['itmid']) && $item['itmid'] === $item_id) {
            $s = (string)$item['itms'];
            if ($s === '∞' || $s === '999') return PHP_INT_MAX;  // 无限
            $count += max(0, (int)$s);
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
 * 调用 _item_build_placed_items 构建 placed_items，再通过 item_resolve_material_mapping
 * 获取映射，按 consume 模式分别处理。
 *
 * 消耗逻辑（设计案 §8.3，区分模型）：
 * - consume='all' 数量模型（stack=true）：扣 itms-N，归零由 item_destroy_if_depleted 销毁
 * - consume='all' 耐久模型（stack=false）：直接 unset 整槽（合成消耗整槽素材）
 * - consume='durability' 数量模型：扣 cnt 个数量，归零由 item_destroy_if_depleted 销毁
 * - consume='durability' 耐久模型：扣 cnt 点耐久（item_consume_itms），归零由 item_destroy_if_depleted 销毁
 * - consume='none'：不操作（工作台素材）
 *
 * @param array &$pdata     玩家数据
 * @param array $materials  配方的 materials 数组
 * @param mixed $slots      背包槽位号（"1:3,2:1" 字符串或数组）
 * @param array $workbench_materials  工作台素材 ID 列表
 * @return bool  扣除成功返回 true
 */
function item_consume_materials(&$pdata, $materials, $slots, $workbench_materials = []) {
    $slot_counts = item_parse_slots($slots);
    $built = _item_build_placed_items($pdata, $slot_counts, $workbench_materials);
    $placed_items = $built['placed_items'];
    $slot_map = $built['slot_map'];
    $bag_count = $built['bag_count'];

    $mapping = item_resolve_material_mapping($materials, $placed_items);
    if ($mapping === null) {
        return false;  // 理论上不会走到这里（item_craft 流程已确认匹配）
    }

    // 按槽位汇总 consume='all' 和 consume='durability' 的数量
    $slot_consume_all = [];  // [slot => count]
    $slot_consume_dur = [];  // [slot => count]
    foreach ($mapping as $m) {
        $idx = $m['placed_index'];
        if ($idx >= $bag_count) continue;  // 工作台素材跳过
        $slot = $slot_map[$idx];
        if ($m['consume'] === 'all') {
            $slot_consume_all[$slot] = ($slot_consume_all[$slot] ?? 0) + 1;
        } elseif ($m['consume'] === 'durability') {
            $slot_consume_dur[$slot] = ($slot_consume_dur[$slot] ?? 0) + 1;
        }
        // consume='none' 不操作
    }

    // 批量扣减 consume='all'（区分模型，见 §8.3）
    foreach ($slot_consume_all as $slot => $cnt) {
        $item = &$pdata['itempara'][$slot];
        $item_id = $item['itmid'];

        // 耐久模型（stack=false）：consume='all' 直接 unset 整槽
        if (!item_get_stack($item_id)) {
            unset($pdata['itempara'][$slot]);
            continue;
        }

        // 数量模型（stack=true）：扣 itms-N，归零由 item_destroy_if_depleted 销毁
        $s = (string)$item['itms'];
        if ($s === '∞' || $s === '999') continue;  // 无限不扣
        $cur = max(0, (int)$s - $cnt);
        $item['itms'] = (string)$cur;
        item_destroy_if_depleted($pdata, $slot);
    }

    // 批量扣减 consume='durability'（区分模型，见 §8.3）
    foreach ($slot_consume_dur as $slot => $cnt) {
        $item = &$pdata['itempara'][$slot];
        $item_id = $item['itmid'];

        // 数量模型（stack=true）：扣 cnt 个数量，归零由 item_destroy_if_depleted 销毁
        if (item_get_stack($item_id)) {
            $s = (string)$item['itms'];
            if ($s === '∞' || $s === '999') continue;  // 无限不扣
            $cur = max(0, (int)$s - $cnt);
            $item['itms'] = (string)$cur;
            item_destroy_if_depleted($pdata, $slot);
            continue;
        }

        // 耐久模型（stack=false）：扣 cnt 点耐久，归零由 item_destroy_if_depleted 销毁
        item_consume_itms($item, $cnt);
        item_destroy_if_depleted($pdata, $slot);
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
 * @param mixed $slots               背包槽位号（"1:3,2:1" 字符串或数组）
 * @param array $workbench_materials 工作台素材 ID 列表
 * @return array 匹配的 recipe_id 列表（0个=不亮，1个=亮，2+=不亮）
 */
function item_match_recipes_by_slots(&$pdata, $slots, $workbench_materials = []) {
    $slot_counts = item_parse_slots($slots);
    $built = _item_build_placed_items($pdata, $slot_counts, $workbench_materials);

    $matched = [];
    foreach (item_get_all_recipes() as $recipe_id => $recipe) {
        if (item_materials_match($recipe['materials'], $built['placed_items'])) {
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
 * 分析素材池无法合成的原因（match_count=0 时调用）
 *
 * 策略：
 *   1. 遍历所有配方，对每个配方调用 item_resolve_material_mapping 判断是否匹配
 *   2. 对匹配失败的配方，分析失败原因（tool_missing / extra_material / insufficient）
 *   3. 返回出现次数最多的原因（并列时按优先级 tool_missing > extra_material > insufficient）
 *
 * 失败原因判定：
 *   - tool_missing：配方需要 consume='none' 工作台素材，但 placed_items 中无工作台素材
 *   - extra_material：所有 material 需求都能满足，但 placed_items 有多余素材未被消耗
 *   - insufficient：有 material 需求无法满足（数量/类别不足）
 *
 * 注意：失败原因分析使用独立的 available 副本模拟三阶段匹配，
 *       仅用于诊断失败原因，不影响实际合成逻辑。
 *
 * @param array $placed_items  _item_build_placed_items 返回的 placed_items
 * @return string  失败原因 ID（'craft.tool_missing' / 'craft.extra_material' / 'craft.insufficient' / 'craft.fail_no_match'）
 */
function item_analyze_craft_failure($placed_items) {
    // 检查 placed_items 是否包含工作台素材
    $has_workbench = false;
    foreach ($placed_items as $p) {
        if (isset($p['source']) && $p['source'] === 'workbench') {
            $has_workbench = true;
            break;
        }
    }

    $reasons = ['tool_missing' => 0, 'extra_material' => 0, 'insufficient' => 0];

    foreach (item_get_all_recipes() as $recipe) {
        $materials = $recipe['materials'];

        // 1. 检查是否需要工作台素材（consume='none'）
        $needs_workbench = false;
        foreach ($materials as $mat) {
            if (($mat['consume'] ?? 'all') === 'none') {
                $needs_workbench = true;
                break;
            }
        }
        if ($needs_workbench && !$has_workbench) {
            $reasons['tool_missing']++;
            continue;
        }

        // 2. 调用 item_resolve_material_mapping 判断是否匹配
        $mapping = item_resolve_material_mapping($materials, $placed_items);
        if ($mapping !== null) {
            // 此配方能匹配，跳过（match_count=0 时不应走到这里，防御性 continue）
            continue;
        }

        // 3. 匹配失败，分析原因：构建 available 副本模拟三阶段匹配
        //    item_resolve_material_mapping 返回 null 时无法区分"素材不足"和"多余素材"，
        //    此处独立模拟以获取 used 状态
        $available = [];
        foreach ($placed_items as $i => $p) {
            $available[] = [
                'index'      => $i,
                'item_id'    => $p['item_id'] ?? '',
                'itmk'       => $p['itmk'] ?? '',
                'tags'       => $p['tags'] ?? [],
                'tool_level' => $p['tool_level'] ?? 0,
                'source'     => $p['source'] ?? 'bag',
                'used'       => false,
            ];
        }

        $unmet_need = false;
        foreach (['item_id', 'itmk', 'tag'] as $match_key) {
            foreach ($materials as $mat) {
                if (!isset($mat[$match_key])) continue;
                $need = (int)($mat['count'] ?? 1);
                $consume = $mat['consume'] ?? 'all';
                $min_level = (int)($mat['min_level'] ?? 0);
                $n = count($available);
                for ($i = 0; $i < $n && $need > 0; $i++) {
                    if ($available[$i]['used']) continue;
                    $matched = false;
                    if ($match_key === 'item_id') {
                        $matched = ($available[$i]['item_id'] === $mat['item_id']);
                    } elseif ($match_key === 'itmk') {
                        $matched = ($available[$i]['itmk'] === $mat['itmk']);
                    } else {
                        $matched = in_array($mat['tag'], $available[$i]['tags'], true);
                    }
                    if ($matched && $available[$i]['tool_level'] >= $min_level && item_can_consume($available[$i], $consume)) {
                        $available[$i]['used'] = true;
                        $need--;
                    }
                }
                if ($need > 0) $unmet_need = true;
            }
        }

        if ($unmet_need) {
            $reasons['insufficient']++;
        } else {
            $reasons['extra_material']++;
        }
    }

    // 返回出现次数最多的原因（并列时按优先级 tool_missing > extra_material > insufficient）
    $max_count = max($reasons['tool_missing'], $reasons['extra_material'], $reasons['insufficient']);
    if ($max_count === 0) return 'craft.fail_no_match';
    if ($reasons['tool_missing'] === $max_count) return 'craft.tool_missing';
    if ($reasons['extra_material'] === $max_count) return 'craft.extra_material';
    return 'craft.insufficient';
}

/**
 * 构建 preview_log 单对象
 *
 * @param array $slot_counts        item_parse_slots 结果
 * @param array $workbench_materials 工作台素材 ID 列表
 * @param array $placed_items        _item_build_placed_items 返回的 placed_items
 * @param int   $match_count         匹配配方数
 * @param bool  $is_new_recipe       是否新配方（仅 match_count=1 时有意义）
 * @return array  {id: string, params: array}
 */
function _item_build_preview_log($slot_counts, $workbench_materials, $placed_items, $match_count, $is_new_recipe) {
    // 1. 素材池实际为空（基于 placed_items 判断，而非输入参数）
    //    场景：玩家只选了无效工作台素材（slot_counts 空 + workbench_materials 非空），
    //    但 placed_items 实际为空时，应返回 empty_pool 而非走失败原因分析
    if (empty($placed_items)) {
        return ['id' => 'craft.empty_pool', 'params' => []];
    }

    // 2. match_count >= 2：指向不明确
    if ($match_count >= 2) {
        return ['id' => 'craft.fail_ambiguous', 'params' => ['match_count' => $match_count]];
    }

    // 3. match_count = 1：可合成
    if ($match_count === 1) {
        return $is_new_recipe
            ? ['id' => 'craft.new_recipe', 'params' => []]
            : ['id' => 'craft.ready', 'params' => []];
    }

    // 4. match_count = 0：分析失败原因
    $reason_id = item_analyze_craft_failure($placed_items);
    return ['id' => $reason_id, 'params' => []];
}

/**
 * 前端预判：素材池能否合成
 *
 * @param array $slots               背包槽位号列表
 * @param array &$pdata
 * @param array $workbench_materials 工作台素材 ID 列表
 * @return array {match_count, craftable, is_new_recipe, preview_log}
 */
function item_craft_preview($slots, &$pdata, $workbench_materials = []) {
    $slot_counts = item_parse_slots($slots);
    $built = _item_build_placed_items($pdata, $slot_counts, $workbench_materials);
    $placed_items = $built['placed_items'];

    $matched = [];
    foreach (item_get_all_recipes() as $recipe_id => $recipe) {
        if (item_materials_match($recipe['materials'], $placed_items)) {
            $matched[] = $recipe_id;
        }
    }
    $match_count = count($matched);
    $craftable = ($match_count === 1);

    $is_new_recipe = false;
    if ($craftable) {
        $recipe_id = $matched[0];
        $discovered = isset($pdata['oblpara']['discovered_recipes']) ? $pdata['oblpara']['discovered_recipes'] : [];
        if (!is_array($discovered)) $discovered = [];
        $is_new_recipe = !in_array($recipe_id, $discovered, true);
    }

    // 生成 preview_log（单对象）
    $preview_log = _item_build_preview_log($slot_counts, $workbench_materials, $placed_items, $match_count, $is_new_recipe);

    return [
        'match_count'   => $match_count,
        'craftable'     => $craftable,
        'is_new_recipe' => $is_new_recipe,
        'preview_log'   => $preview_log,
    ];
}

// ----------------------------------------------------------------
// 5.5.1 合成入口（12 步流程）
// ----------------------------------------------------------------

/**
 * 合成入口（设计案 §5.5.1 + §8.4 空间检查 + §8.6 产物入 itm0）
 *
 * 流程：
 *   1. 解析 $slots + $workbench_materials → _item_build_placed_items
 *   2. 空参数检查
 *   3. 调用 item_match_recipes_by_slots → $matched
 *   4. 根据 count($matched) 分支（0=不匹配，2+=指向不明确，1=继续）
 *   5. 取唯一匹配的 $recipe
 *   6. 检查背包剩余空间（§8.4 区分模型，含 consume='all' 和 consume='durability'）
 *   7. 介入点 1：合成失败检查（P0 预留，跳过）
 *   8. 调用 item_consume_materials（素材扣减）
 *   9. 添加产物（§8.6 逐个产物 → itm0 → 自动整理）
 *  10. 检查是否新发现配方 → item_discover_recipe + emit craft.new_recipe_discovered
 *  11. emit craft.success
 *  12. 保存 $pdata（由上层调用方负责）
 *
 * @param mixed $slots               背包槽位号（"1:3,2:1" 字符串或数组）
 * @param array &$pdata
 * @param mixed $workbench_materials 工作台素材 ID 列表（数组或逗号分隔字符串）
 * @return void
 */
function item_craft($slots, &$pdata, $workbench_materials = []) {
    global $obl_log;

    // 标准化 workbench_materials 为数组
    if (!is_array($workbench_materials)) {
        $workbench_materials = ($workbench_materials === '' || $workbench_materials === null) ? [] : explode(',', (string)$workbench_materials);
    }

    // 步骤 1-2：解析 slots + workbench_materials
    $slot_counts = item_parse_slots($slots);
    if (empty($slot_counts) && empty($workbench_materials)) {
        $obl_log->emit('craft.fail_no_match', 'system');
        return;
    }

    $built = _item_build_placed_items($pdata, $slot_counts, $workbench_materials);
    $placed_items = $built['placed_items'];
    $slot_map = $built['slot_map'];
    $bag_count = $built['bag_count'];

    // 步骤 3：匹配
    $matched = [];
    foreach (item_get_all_recipes() as $recipe_id => $recipe) {
        if (item_materials_match($recipe['materials'], $placed_items)) {
            $matched[] = $recipe_id;
        }
    }

    // 步骤 4：分支
    $match_count = count($matched);
    if ($match_count === 0) {
        $obl_log->emit('craft.fail_no_match', 'system');
        return;
    }
    if ($match_count >= 2) {
        $obl_log->emit('craft.fail_ambiguous', 'system', ['match_count' => $match_count]);
        return;
    }

    // 步骤 5：取配方
    $recipe_id = $matched[0];
    $recipe = item_get_recipe($recipe_id);

    // 步骤 6：空间检查（§8.4 适配，区分模型，含 consume='all' 和 consume='durability'）
    $mapping = item_resolve_material_mapping($recipe['materials'], $placed_items);
    if ($mapping === null) {
        // 理论上不会走到这里（步骤 3 已确认匹配）
        $obl_log->emit('craft.fail_no_match', 'system');
        return;
    }

    // 统计每个槽位的消耗数量
    $slot_consume_all = [];   // [slot => count]
    $slot_consume_dur = [];   // [slot => count]
    foreach ($mapping as $m) {
        if ($m['placed_index'] >= $bag_count) continue;
        $slot = $slot_map[$m['placed_index']];
        if ($m['consume'] === 'all') {
            $slot_consume_all[$slot] = ($slot_consume_all[$slot] ?? 0) + 1;
        } elseif ($m['consume'] === 'durability') {
            $slot_consume_dur[$slot] = ($slot_consume_dur[$slot] ?? 0) + 1;
        }
    }

    // 计算空出的槽位数（区分模型）
    $freed_slots = 0;

    // consume='all' 空出的槽位
    foreach ($slot_consume_all as $slot => $cnt) {
        $item = isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
        if (!$item) continue;

        // 耐久模型（stack=false）：consume='all' 必空出槽位
        if (!item_get_stack($item['itmid'])) {
            $freed_slots++;
            continue;
        }

        // 数量模型（stack=true）：消耗后 itms 归零才空出
        $s = (string)$item['itms'];
        if ($s === '∞' || $s === '999') continue;  // 无限不空出
        if ((int)$s - $cnt <= 0) $freed_slots++;
    }

    // consume='durability' 空出的槽位（§2.3 统一语义，按模型区分）
    foreach ($slot_consume_dur as $slot => $cnt) {
        $item = isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
        if (!$item) continue;

        // 数量模型（stack=true）：扣 cnt 个数量，归零才空出
        if (item_get_stack($item['itmid'])) {
            $s = (string)$item['itms'];
            if ($s === '∞' || $s === '999') continue;
            if ((int)$s - $cnt <= 0) $freed_slots++;
            continue;
        }

        // 耐久模型（stack=false）：扣 cnt 点耐久，归零才空出
        $s = (string)$item['itms'];
        if ($s === '∞' || $s === '999') continue;
        if ((int)$s - $cnt <= 0) $freed_slots++;
    }

    $results_count = 0;
    foreach ($recipe['results'] as $r) {
        $results_count += (int)($r['count'] ?? 1);
    }

    $empty_count = 0;
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    for ($i = 1; $i <= $maxslots; $i++) {
        // 与 obl_find_empty_slot 一致：只查 null，不查 itmid
        if (!isset($pdata['itempara'][$i]) || $pdata['itempara'][$i] === null) {
            $empty_count++;
        }
    }

    if ($empty_count + $freed_slots < $results_count) {
        $obl_log->emit('craft.fail_bag_full', 'system');
        return;
    }

    // 步骤 7：介入点 1（合成失败检查，P0 跳过）

    // 步骤 8：扣减素材
    // 介入点 2：鉴定系统未来可在此处检查素材的真实 Tag
    item_consume_materials($pdata, $recipe['materials'], $slots, $workbench_materials);

    // 步骤 9：添加产物（按 §8.6，产物 → itm0 → 自动整理）
    // 事件解耦：合成成功由步骤11 craft.success 统一 emit（仅传 recipe_id，前端查配方表）
    //          整理失败由 obl_organize_inventory 返回值判断，emit organize.fail
    $table = item_load_table();
    foreach ($recipe['results'] as $r) {
        $item_id = $r['item_id'];
        $count = (int)($r['count'] ?? 1);
        $template = isset($table[$item_id]) ? $table[$item_id] : null;
        if (!$template) continue;

        // 产物 itms 区分模型：
        // - 数量模型（stack=true）：itms=$count（一次产出 N 个，itm0 一次装入）
        // - 耐久模型（stack=false）：itms=模板 itms（初始耐久，count 必为 1）
        $is_stack = item_get_stack($item_id);
        $product_itms = $is_stack ? (string)$count : (string)$template['itms'];

        // 构建产物实例
        $new_item = [
            'itm'     => '',
            'itmk'    => $template['itmk'],
            'itme'    => (int)$template['itme'],
            'itms'    => $product_itms,
            'itmsk'   => $template['itmsk'],
            'itmpara' => isset($template['itmpara']) && is_array($template['itmpara']) ? $template['itmpara'] : [],
            'itmid'   => $item_id,
        ];

        // 放入 itm0
        if (!obl_put_item_to_itm0($pdata, $new_item)) {
            $obl_log->emit('system.itm0_occupied', 'system');
            break;
        }

        // 自动整理（转移 itm0 → 背包）
        $organized = obl_organize_inventory($pdata);
        if (!$organized) {
            // 整理失败：产物卡在 itm0，玩家被门控锁定
            // 注意：素材已扣减，之前的产物已入背包，当前产物卡在 itm0
            $obl_log->emit('organize.fail', 'system', ['item_id' => $item_id]);
            break;
        }
    }

    // 步骤 10：检查是否新发现配方
    $discovered = isset($pdata['oblpara']['discovered_recipes']) ? $pdata['oblpara']['discovered_recipes'] : [];
    if (!is_array($discovered)) $discovered = [];
    if (!in_array($recipe_id, $discovered, true)) {
        item_discover_recipe($pdata, $recipe_id);
        $obl_log->emit('craft.new_recipe_discovered', 'system', ['recipe_id' => $recipe_id]);
    }

    // 步骤 11：emit craft.success（只传 recipe_id，前端从配置查产物）
    // 介入点 3：对话系统订阅 craft.success 触发猫提醒
    $obl_log->emit('craft.success', 'system', [
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
