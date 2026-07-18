<?php
/**
 * @module F 物品系统
 * @framework F-6 POI 道具交互系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions F-6 POI 道具交互系统主流程
//
// 与 F-3 use_effect 分发器同构的纯分发框架：
//   poi_interact($slot, $poi, &$pdata)
//     → 校验槽位 / tag_poi_interactive / 耐久
//     → 加载 poi_interactions.php 配置
//     → 按 (poi.mechanic × item) 匹配交互
//     → 校验 POI 状态
//     → 分发到 poi_interact_effect_{effect_type}()
//     → 消耗道具（如配置 consume_item=true）
//     → emit poi.interact.success
//
// 配置驱动：poi_interactions.php 定义 {poi_mechanic × 道具匹配 → effect_type}
// 效果函数：poi.interact_effects.func.php 实现 poi_interact_effect_{name}()
//
// 命令入口：obl_command_handler_poi_interact（obl_command_handlers.php）
//   - payload: {slot, iaid}
//   - 复用 obl_lookup_poi_for_search 做位置校验
//
// 状态投影：obl_get_available_interactions_for_poi($poi, $pdata)
//   - 在 tile_actions scope 中为每个 POI 返回可用交互列表
//   - 前端按 available_slots 渲染按钮
//
// 设计案：oblivions/docs/道具POI交互系统-设计案.md
// ================================================================

// ----------------------------------------------------------------
// 主流程
// ----------------------------------------------------------------

/**
 * POI 道具交互主入口
 *
 * 流程（设计案 §4.3）：
 *   1. 读取槽位 $slot 的道具实例（slot >= 1，非 itm0）
 *   2. 检查 tag_poi_interactive → 不含 → emit poi.interact.not_interactive
 *   3. 检查耐久 itms='0' → emit poi.interact.broken
 *   4. 加载 poi_interactions.php 配置
 *   5. 按 (poi.mechanic × item) 匹配交互配置
 *   6. 校验 POI 状态（per effect_type）
 *   7. 调用 poi_interact_effect_{effect_type}($item, $poi, $interaction, $pdata)
 *   8. 消耗道具（如 interaction.consume_item=true）
 *   9. emit poi.interact.success
 *
 * @param int   $slot   背包槽位号（1~maxslots）
 * @param array $poi    POI 实例行（由 obl_lookup_poi_for_search 返回）
 * @param array &$pdata 玩家数据引用
 * @return void
 */
function poi_interact($slot, $poi, &$pdata) {
    global $obl_log;

    $slot = (int)$slot;

    // 1. 读取槽位
    if (!isset($pdata['itempara'][$slot]) || !is_array($pdata['itempara'][$slot])) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.empty_slot', 'poi_interact', array('slot' => $slot));
        return;
    }
    $item = $pdata['itempara'][$slot];
    if (empty($item['itmid'])) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.empty_slot', 'poi_interact', array('slot' => $slot));
        return;
    }

    $item_id = (string)$item['itmid'];

    // 2. 检查 tag_poi_interactive
    if (!item_has_tag($item_id, 'tag_poi_interactive')) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.not_interactive', 'poi_interact', array('item_id' => $item_id, 'slot' => $slot));
        return;
    }

    // 3. 检查耐久（已损坏道具不可交互）
    if (isset($item['itms']) && (string)$item['itms'] === '0') {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.broken', 'poi_interact', array('item_id' => $item_id, 'slot' => $slot));
        return;
    }

    // 4. 加载 POI 模板（取 mechanic）
    $poi_id = isset($poi['poi_id']) ? (string)$poi['poi_id'] : '';
    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    if (!isset($poi_table[$poi_id])) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.no_interaction', 'poi_interact', array('item_id' => $item_id, 'poi_id' => $poi_id));
        return;
    }
    $template = $poi_table[$poi_id];
    $poi_mechanic = isset($template['mechanic']) ? (string)$template['mechanic'] : '';

    // 5. 加载交互配置 + 按 (poi_mechanic × item) 匹配
    $interactions_config = include GAME_ROOT . './oblivions/gamedata/poi_interactions.php';
    $matched = null;
    foreach ($interactions_config as $interaction_id => $interaction) {
        $cfg_mechanic = isset($interaction['poi_mechanic']) ? (string)$interaction['poi_mechanic'] : '';
        if ($cfg_mechanic !== $poi_mechanic) continue;

        $required_item = isset($interaction['required_item']) ? (string)$interaction['required_item'] : '';
        $required_tag  = isset($interaction['required_tag'])  ? (string)$interaction['required_tag']  : '';

        if ($required_item !== '' && $required_item !== 'null' && $required_item === $item_id) {
            $matched = array('interaction_id' => $interaction_id) + $interaction;
            break;
        }
        if ($required_tag !== '' && $required_tag !== 'null' && item_has_tag($item_id, $required_tag)) {
            $matched = array('interaction_id' => $interaction_id) + $interaction;
            break;
        }
    }

    if ($matched === null) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.no_interaction', 'poi_interact', array('item_id' => $item_id, 'poi_id' => $poi_id));
        return;
    }

    // 6. 校验 POI 状态（per effect_type）
    $effect_type = isset($matched['effect_type']) ? (string)$matched['effect_type'] : '';
    $current_state = isset($poi['state']) ? (string)$poi['state'] : 'idle';
    $required_state = obl_get_required_state_for_effect($effect_type);
    if ($required_state !== null && $current_state !== $required_state) {
        $already_event = obl_get_already_event_for_effect($effect_type);
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit($already_event, 'poi_interact', array(
                'iaid'          => isset($poi['iaid']) ? (int)$poi['iaid'] : 0,
                'current_state' => $current_state,
                'required_state'=> $required_state,
            ));
        }
        return;
    }

    // 7. 调用效果函数
    $effect_func = "poi_interact_effect_{$effect_type}";
    if (!function_exists($effect_func)) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('poi.interact.no_interaction', 'poi_interact', array('item_id' => $item_id, 'effect' => $effect_type, 'reason' => 'effect_not_registered'));
        return;
    }
    $effect_ok = $effect_func($item, $poi, $matched, $pdata);
    if (!$effect_ok) {
        // 效果失败（如乐观锁冲突），effect 函数已 emit 日志，跳过消耗
        return;
    }

    // 8. 消耗道具（如配置 consume_item=true）
    $consume_item = !empty($matched['consume_item']);
    if ($consume_item) {
        $consume_count = isset($matched['consume_count']) ? (int)$matched['consume_count'] : 1;
        if ($consume_count > 0) {
            // 取引用以修改 $pdata['itempara'][$slot]
            $item_ref = &$pdata['itempara'][$slot];
            item_consume_itms($item_ref, $consume_count);
            item_destroy_if_depleted($pdata, $slot);
        }
    }

    // 9. emit 成功事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('poi.interact.success', 'poi_interact', array(
            'interaction_id' => $matched['interaction_id'],
            'effect_type'    => $effect_type,
            'item_id'        => $item_id,
            'iaid'           => isset($poi['iaid']) ? (int)$poi['iaid'] : 0,
            'poi_id'         => $poi_id,
            'slot'           => $slot,
        ));
    }
}

// ----------------------------------------------------------------
// 状态投影查询函数
// ----------------------------------------------------------------

/**
 * 查询 POI 当前可用的道具交互列表（tile_actions 投影专用）
 *
 * 流程（设计案 §5.5）：
 *   1. 加载 poi_interactions.php 配置
 *   2. 加载 POI 模板，取 mechanic
 *   3. 遍历配置，筛选 poi_mechanic === template.mechanic 的项
 *   4. 对每个 interaction：
 *      - 校验 POI state（仅返回当前可触发的；不匹配则跳过）
 *      - 按 required_item 或 required_tag 在玩家 itempara[1..maxslots] 中查找匹配道具
 *      - 收集可触发的 slot 列表 → available_slots
 *   5. 返回 interactions 列表（available_slots 为空的交互也返回，前端显示"需要 X 道具"占位）
 *
 * @param array $poi   POI 实例行
 * @param array $pdata 玩家数据
 * @return array interactions 列表，每项含 interaction_id/name/poi_mechanic/required_item/required_tag/consume_item/available_slots
 */
function obl_get_available_interactions_for_poi($poi, $pdata) {
    if (empty($poi) || !is_array($poi)) return array();

    $poi_id = isset($poi['poi_id']) ? (string)$poi['poi_id'] : '';
    if ($poi_id === '') return array();

    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    if (!isset($poi_table[$poi_id])) return array();
    $template = $poi_table[$poi_id];
    $poi_mechanic = isset($template['mechanic']) ? (string)$template['mechanic'] : '';
    if ($poi_mechanic === '') return array();

    $interactions_config = include GAME_ROOT . './oblivions/gamedata/poi_interactions.php';
    if (empty($interactions_config) || !is_array($interactions_config)) return array();

    $current_state = isset($poi['state']) ? (string)$poi['state'] : 'idle';
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 0;

    $result = array();
    foreach ($interactions_config as $interaction_id => $interaction) {
        $cfg_mechanic = isset($interaction['poi_mechanic']) ? (string)$interaction['poi_mechanic'] : '';
        if ($cfg_mechanic !== $poi_mechanic) continue;

        $effect_type = isset($interaction['effect_type']) ? (string)$interaction['effect_type'] : '';
        $required_state = obl_get_required_state_for_effect($effect_type);

        // POI 状态不匹配 → 跳过（已解锁/已点燃/已开过等终态不显示交互入口）
        if ($required_state !== null && $current_state !== $required_state) {
            continue;
        }

        $required_item = isset($interaction['required_item']) ? (string)$interaction['required_item'] : '';
        $required_tag  = isset($interaction['required_tag'])  ? (string)$interaction['required_tag']  : '';

        // 在玩家 itempara[1..maxslots] 中查找匹配道具
        $available_slots = array();
        for ($s = 1; $s <= $maxslots; $s++) {
            if (!isset($pdata['itempara'][$s]) || !is_array($pdata['itempara'][$s])) continue;
            $slot_item = $pdata['itempara'][$s];
            if (empty($slot_item['itmid'])) continue;

            $slot_item_id = (string)$slot_item['itmid'];

            // 跳过已损坏道具
            if (isset($slot_item['itms']) && (string)$slot_item['itms'] === '0') continue;

            $slot_matches = false;
            if ($required_item !== '' && $required_item !== 'null') {
                $slot_matches = ($required_item === $slot_item_id);
            } elseif ($required_tag !== '' && $required_tag !== 'null') {
                $slot_matches = item_has_tag($slot_item_id, $required_tag);
            }

            if ($slot_matches) {
                $available_slots[] = $s;
            }
        }

        $result[] = array(
            'interaction_id'  => $interaction_id,
            'name'            => isset($interaction['name']) ? (string)$interaction['name'] : $interaction_id,
            'poi_mechanic'    => $poi_mechanic,
            'required_item'   => ($required_item !== '' && $required_item !== 'null') ? $required_item : null,
            'required_tag'    => ($required_tag !== '' && $required_tag !== 'null') ? $required_tag : null,
            'consume_item'    => !empty($interaction['consume_item']),
            'available_slots' => $available_slots,
        );
    }

    return $result;
}

// ----------------------------------------------------------------
// 辅助函数
// ----------------------------------------------------------------

/**
 * 按 effect_type 取所需的 POI 状态（前置校验用）
 *
 * @param string $effect_type
 * @return string|null 所需状态（null 表示不前置校验，由 effect 函数乐观锁兜底）
 */
function obl_get_required_state_for_effect($effect_type) {
    switch ($effect_type) {
        case 'unlock_door':
        case 'open_container':
            return 'locked';
        case 'ignite':
            return 'idle';
        default:
            return null;
    }
}

/**
 * 按 effect_type 取"已完成"对应的日志事件 ID
 *
 * @param string $effect_type
 * @return string
 */
function obl_get_already_event_for_effect($effect_type) {
    switch ($effect_type) {
        case 'unlock_door':
            return 'poi.interact.already_unlocked';
        case 'open_container':
            return 'poi.interact.already_done';
        case 'ignite':
            return 'poi.interact.already_ignited';
        default:
            return 'poi.interact.already_done';
    }
}
