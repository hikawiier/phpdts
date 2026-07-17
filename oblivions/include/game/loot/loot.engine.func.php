<?php
/**
 * @module F 物品系统
 * @framework F-4 战利品表引擎
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions F-4 战利品表引擎 / Oblivions F-4 Loot Table Engine
//
// 替代 obl_search_poi 内联的扁平掉落循环。
// 入口：obl_roll_loot_table($table_id, $context) → list<item_instance>
//
// item_instance 格式与 F-1 itempara 七字段对齐：
//   ['itm','itmk','itme','itms','itmsk','itmpara','itmid']
//   - itm 留空字符串（前端通过 itmid 查 locale 渲染名称）
//   - itmpara 为数组（item_table.php 中 itmpara 是字符串/JSON，本引擎 json_decode 后返回）
//   - itms 为字符串（保留 '∞' 表示无限耐久/数量）
//
// F-4 仅负责"掷骰生成物品实例列表"，不负责物化（INSERT oblmapitem、discovered 标记、
// source_iaid 归属、loot_dropped 响应等都属于 E-7 / E-10 调用方的物化逻辑）。
//
// 依赖：oblivions/gamedata/loot_tables.php（配置）、oblivions/gamedata/item_table.php（模板）
//       由 obl_bootstrap.php 统一加载
// ================================================================

// ----------------------------------------------------------------
// 常量
// ----------------------------------------------------------------

if (!defined('OBL_LOOT_MAX_ENTRIES')) {
    /**
     * 单张战利品表的 entries 总数上限
     *
     * 校验时机：obl_roll_loot_table 加载表时统计 Σ count(group.entries)
     * 超限则 emit loot.entries_exceed_limit 错误并返回空数组
     */
    define('OBL_LOOT_MAX_ENTRIES', 100);
}

// ----------------------------------------------------------------
// 顶层入口
// ----------------------------------------------------------------

/**
 * 掷战利品表，返回物品实例列表
 *
 * 流程：
 *   1. 解析 context.loot_table_override（可选，工具/技能路由覆盖）
 *   2. 加载 loot_tables.php，查表
 *   3. entries 总数校验（≤ OBL_LOOT_MAX_ENTRIES）
 *   4. 遍历 groups，逐组掷骰（obl_roll_group）累积物品实例
 *   5. 若表 durability_decay=true → obl_apply_durability_decay(items)
 *   6. 返回 items
 *
 * @param string $table_id  战利品表 ID（loot_tables.php 的 key，约定与 POI ID 共用命名空间）
 * @param array  $context   运行时上下文（可选）：
 *                          - loot_table_override: string 覆盖表 ID（工具/技能路由）
 *                          - player_skills: array 玩家技能（预留，未来 E-10 使用）
 *                          - search_count: int POI 搜索次数（预留，衰减判定）
 * @return array 物品实例列表，每项为 itempara 七字段数组；可能为空数组
 */
function obl_roll_loot_table($table_id, $context = []) {
    // 1. 上下文覆盖优先（工具/技能路由）
    if (!empty($context['loot_table_override'])) {
        $table_id = $context['loot_table_override'];
    }

    // 2. 加载配置
    $tables = include GAME_ROOT . './oblivions/gamedata/loot_tables.php';
    if (!isset($tables[$table_id])) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.table_not_found', [
                'table_id' => $table_id,
            ], 'command');
        }
        return [];
    }
    $table = $tables[$table_id];

    // 3. entries 上限校验
    $total_entries = 0;
    $groups = isset($table['groups']) && is_array($table['groups']) ? $table['groups'] : [];
    foreach ($groups as $group) {
        $total_entries += isset($group['entries']) && is_array($group['entries'])
            ? count($group['entries'])
            : 0;
    }
    if ($total_entries > OBL_LOOT_MAX_ENTRIES) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.entries_exceed_limit', [
                'table_id' => $table_id,
                'total'    => $total_entries,
                'limit'    => OBL_LOOT_MAX_ENTRIES,
            ], 'command');
        }
        return [];
    }

    // 4. 遍历 groups 累积物品实例
    $items = [];
    foreach ($groups as $group) {
        $group_items = obl_roll_group($group, $context);
        foreach ($group_items as $it) {
            $items[] = $it;
        }
    }

    // 5. 统一应用耐久衰减
    if (!empty($table['durability_decay'])) {
        obl_apply_durability_decay($items);
    }

    return $items;
}

// ----------------------------------------------------------------
// 单组掷骰
// ----------------------------------------------------------------

/**
 * 单组掷骰
 *
 * 流程：
 *   1. 组级 chance 判定（失败返回空数组）
 *   2. 组内 entries 按 weight 加权选择一个 entry
 *   3. 解析 count（int 或 [min,max]，min>max 自动 swap，count<=0 兜底为 1）
 *   4. 加载 item_table 校验 item_id 存在
 *   5. 实例化：
 *      - stackable 物品：单实例 itms=count（超 stack_limit 自动分批）
 *      - 非 stackable 物品：N 个独立实例，各 itms=模板 itms
 *
 * @param array $group   组配置（chance + entries）
 * @param array $context 运行时上下文（当前未使用，预留扩展）
 * @return array 物品实例列表
 */
function obl_roll_group($group, $context) {
    // 1. chance 判定
    $chance = isset($group['chance']) ? (float)$group['chance'] : 1.0;
    if ($chance <= 0) return [];
    // chance > 1.0 视为 1.0（防御性，配置错误兜底）
    if ($chance < 1.0) {
        if ((mt_rand() / mt_getrandmax()) > $chance) return [];
    }

    // 2. 加权选择 entry
    $entries = isset($group['entries']) && is_array($group['entries']) ? $group['entries'] : [];
    if (empty($entries)) return [];
    $entry = obl_weighted_pick($entries);

    // 3. 解析 count
    $count = isset($entry['count']) ? $entry['count'] : 1;
    if (is_array($count)) {
        $lo = isset($count[0]) ? (int)$count[0] : 1;
        $hi = isset($count[1]) ? (int)$count[1] : $lo;
        if ($hi < $lo) { $tmp = $lo; $lo = $hi; $hi = $tmp; }
        $n = rand($lo, $hi);
    } else {
        $n = (int)$count;
    }
    $n = max(1, $n);

    // 4. 校验 item_id
    $item_id = isset($entry['item_id']) ? (string)$entry['item_id'] : '';
    if ($item_id === '') return [];

    $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    if (!isset($item_table[$item_id])) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.item_template_missing', [
                'item_id' => $item_id,
            ], 'command');
        }
        return [];
    }
    $template = $item_table[$item_id];

    // 5. 实例化（区分 stackable 与非 stackable）
    $is_stack = !empty($template['stack']);
    $items = [];

    if ($is_stack) {
        // 可堆叠：单实例 itms=count（受 stack_limit 上限，自动分批）
        $stack_limit = isset($template['stack_limit']) ? (int)$template['stack_limit'] : 1;
        if ($stack_limit < 1) $stack_limit = 1;
        $remaining = $n;
        while ($remaining > 0) {
            $batch = min($remaining, $stack_limit);
            $instance = obl_instantiate_item($template, $item_id);
            $instance['itms'] = (string)$batch;
            $items[] = $instance;
            $remaining -= $batch;
        }
    } else {
        // 不可堆叠：N 个独立实例，各 itms=模板 itms（'∞' 或数值字符串）
        for ($i = 0; $i < $n; $i++) {
            $items[] = obl_instantiate_item($template, $item_id);
        }
    }

    return $items;
}

// ----------------------------------------------------------------
// 加权选择
// ----------------------------------------------------------------

/**
 * 加权随机选择一个 entry
 *
 * weight 全 0 时均匀随机选一个（避免除零）；weight 缺失按 1.0 计。
 *
 * @param array $entries entries 列表
 * @return array 选中的 entry
 */
function obl_weighted_pick($entries) {
    $total_weight = 0;
    foreach ($entries as $e) {
        $total_weight += isset($e['weight']) ? (float)$e['weight'] : 1.0;
    }

    if ($total_weight <= 0) {
        // 全 0 权重：均匀随机选一个（避免除零）
        return $entries[array_rand($entries)];
    }

    $r = mt_rand() / mt_getrandmax() * $total_weight;
    $cum = 0;
    foreach ($entries as $e) {
        $w = isset($e['weight']) ? (float)$e['weight'] : 1.0;
        $cum += $w;
        if ($r <= $cum) return $e;
    }
    // 浮点累加误差兜底：返回最后一个
    return $entries[count($entries) - 1];
}

// ----------------------------------------------------------------
// 物品实例化
// ----------------------------------------------------------------

/**
 * 从模板实例化物品（itempara 七字段结构）
 *
 * - itm 留空：新实例遵循约定，前端通过 itmid 查 locale 渲染名称
 * - itmpara 从模板拷贝（item_table.php 中 itmpara 为字符串/JSON；本函数统一返回数组）
 * - itms 保留模板原值（含 '∞'）；衰减由 obl_apply_durability_decay 后处理
 *
 * @param array  $template 模板（item_table.php 的 entry）
 * @param string $item_id  物品 ID
 * @return array 物品实例
 */
function obl_instantiate_item($template, $item_id) {
    $itmpara = isset($template['itmpara']) ? $template['itmpara'] : '';
    if (!is_array($itmpara)) {
        $decoded = $itmpara !== '' ? json_decode((string)$itmpara, true) : null;
        $itmpara = is_array($decoded) ? $decoded : [];
    }
    return [
        'itm'     => '',
        'itmk'    => (string)$template['itmk'],
        'itme'    => (int)$template['itme'],
        'itms'    => (string)$template['itms'],
        'itmsk'   => (string)$template['itmsk'],
        'itmpara' => $itmpara,
        'itmid'   => (string)$item_id,
    ];
}

// ----------------------------------------------------------------
// 耐久度衰减
// ----------------------------------------------------------------

/**
 * 应用耐久度衰减（引用修改）
 *
 * 衰减规则（基于 itms 双模型语义，由 item_table.php 的 stack 字段区分）：
 *   - stack=true（数量模型，材料/消耗品）：跳过（itms 是堆叠数量，非耐久）
 *   - stack=false（耐久模型，装备/工具）：
 *       - itms='∞'：保留 ∞（无限耐久，如指南针）
 *       - itms 为数值且 > 0：随机 [1, itms]（模拟"被丢弃前已用过一段时间"）
 *       - itms=0 或负值或非数值：保留原值（防御性，模板不应出现）
 *
 * @param array &$items 物品实例列表
 * @return void
 */
function obl_apply_durability_decay(&$items) {
    if (empty($items)) return;

    $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';

    foreach ($items as &$item) {
        $item_id = isset($item['itmid']) ? $item['itmid'] : '';
        if (!isset($item_table[$item_id])) continue;

        $template = $item_table[$item_id];
        if (!empty($template['stack'])) continue;  // 数量模型跳过

        $itms = (string)$item['itms'];
        if ($itms === '∞') continue;               // 无限耐久保留

        $max = (int)$itms;
        if ($max <= 0) continue;                    // 0/负值/非数值保留

        // 随机 [1, max]：模拟"被丢弃前已用过一段时间"
        $item['itms'] = (string)rand(1, $max);
    }
    unset($item);
}
