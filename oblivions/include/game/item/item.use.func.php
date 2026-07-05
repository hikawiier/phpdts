<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 道具使用系统 / Oblivions item use system
//
// 含 use_effect 分发框架（纯分发器，不预定义任何具体效果）。
// 具体效果函数由归属系统自行注册：
// - restore_sp     → 食物经验系统注册（恢复 SP + 发放经验）
// - cure_bs        → 健康系统注册（解除 Body Status）
// - gain_resistance → 被动技能系统注册（抗性跃迁）
//
// 相关文档：《道具使用与合成系统-设计案.md》§5.4
// ================================================================

/**
 * 道具使用入口（由 cmd_handle_obl_use_item 调用）
 *
 * 流程（设计案 §5.4.1 + §5.4.3 文字描述）：
 * 1. 读取槽位，空槽位 → emit use_item.empty_slot
 * 2. 检查 tag_usable，不含 → emit use_item.not_usable
 * 2.5 检查耐久，itms='0' → emit use_item.broken（已损坏道具不可使用）
 * 3. 调用 item_execute_use_effect 分发到具体效果函数
 * 4. 调用 item_consume_itms 扣减 itms
 * 4.5 itms 归零 → item_destroy_if_depleted 销毁道具实例
 * 5. emit use_item.success（供对话系统订阅触发猫提醒）
 *
 * @param int   $slot   背包槽位号（0=itm0，1~maxslots=普通槽位）
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use($slot, &$pdata) {
    global $obl_log;

    $slot = (int)$slot;

    // 1. 读取槽位
    if (!isset($pdata['itempara'][$slot]) || !is_array($pdata['itempara'][$slot])) {
        $obl_log->emit('use_item.empty_slot', 'system', ['slot' => $slot]);
        return;
    }
    $item = &$pdata['itempara'][$slot];
    if (empty($item['itmid'])) {
        $obl_log->emit('use_item.empty_slot', 'system', ['slot' => $slot]);
        return;
    }

    $item_id = $item['itmid'];

    // 2. 检查 tag_usable（从 item_table 查询，实例层不存 tags）
    if (!item_has_tag($item_id, 'tag_usable')) {
        $obl_log->emit('use_item.not_usable', 'system', ['item_id' => $item_id]);
        return;
    }

    // 2.5 检查耐久（已损坏道具不可使用）
    if (isset($item['itms']) && (string)$item['itms'] === '0') {
        $obl_log->emit('use_item.broken', 'system', ['item_id' => $item_id]);
        return;
    }

    // 3. 应用使用效果（use_effect 分发框架）
    item_execute_use_effect($item, $pdata);

    // 4. 扣减 itms（内部检查归零 emit durability.broken）
    item_consume_itms($item, 1);

    // 4.5 itms 归零 → 销毁道具实例（遵循 §5.4.3 文字描述）
    item_destroy_if_depleted($pdata, $slot);

    // 5. emit 成功事件（介入点：供对话系统订阅触发猫提醒）
    $obl_log->emit('use_item.success', 'system', ['item_id' => $item_id, 'slot' => $slot]);

    // $pdata 由外部（obl_command.php）统一持久化
}

/**
 * use_effect 分发框架（纯分发器）
 *
 * 根据 use_effect 字段调用对应的 item_use_effect_{name}() 函数。
 * 框架本身不实现任何效果函数，由归属系统自行注册。
 *
 * @param array $item  道具实例（itempara 条目）
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_execute_use_effect($item, &$pdata) {
    global $obl_log;

    $item_id = $item['itmid'];

    // use_effect 在模板层（item_table），不在实例层
    $table = item_load_table();
    $effect_name = isset($table[$item_id]['use_effect']) ? $table[$item_id]['use_effect'] : '';
    if ($effect_name === '') {
        return;
    }

    $func_name = "item_use_effect_{$effect_name}";
    if (!function_exists($func_name)) {
        // 效果函数未注册（归属系统未实现），emit 警告日志
        $obl_log->emit('use_item.effect_not_registered', 'system', ['effect' => $effect_name]);
        return;
    }

    $func_name($item, $pdata);
}

/**
 * itms 扣减
 *
 * itms 字段语义（对数量模型表示数量，对耐久模型表示耐久，两者互斥）：
 * - 纯数字字符串 → 有限值，每次扣 $amount
 * - "∞" → 无限值，不扣减（item_is_infinite() 判断）
 * - 扣到 0 → emit durability.broken（道具耗尽/破坏）
 *
 * 注意：本函数只负责扣减 itms 和 emit 事件，不销毁道具实例。
 * 销毁逻辑由 item_destroy_if_depleted 统一处理。
 *
 * @param array &$item  道具实例（引用，修改直接生效）
 * @param int   $amount 扣减量（默认 1）
 * @return void
 */
function item_consume_itms(&$item, $amount = 1) {
    global $obl_log;

    if (!isset($item['itms'])) return;

    $s = (string)$item['itms'];
    if (item_is_infinite($s)) return;

    $cur = (int)$s;
    $cur = max(0, $cur - $amount);
    $item['itms'] = (string)$cur;

    // itms 归零 → 道具耗尽/破坏
    if ($cur === 0) {
        $item_id = isset($item['itmid']) ? $item['itmid'] : '';
        $obl_log->emit('durability.broken', 'system', ['item_id' => $item_id]);
    }
}
