<?php
/**
 * @module F 物品系统
 * @framework F-3 使用效果分发器
 * @framework F-7 玩家放置 POI 框架
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 道具使用效果函数集 / Oblivions item use_effect functions
//
// 在 F-3 分发器（item.use.func.php）下注册 6 个 use_effect 函数：
//   - restore_hp        恢复 HP（基于 itme，不超过 mhp）
//   - restore_sp        恢复 SP（基于 itme，不超过 msp）
//   - cure_bs           清除 oblpara.body_status（简化版，未来健康系统可订阅替换）
//   - gain_resistance   emit 事件占位（未来被动技能系统订阅）
//   - open_gift_box     调用 F-4 掷骰原语生成物品 → itm0 → organize
//   - place_poi         F-7 玩家放置 POI（itmpara='poi_id:{template_id}' 协议）
//
// 函数签名约定（与 F-3 分发器 item.use.func.php:110 调用一致）：
//   function item_use_effect_{name}($item, &$pdata)
//   - $item  道具实例（itempara 七字段数组，按值传递）
//   - &$pdata 玩家数据（引用传递，修改直接生效）
//
// 注意：
//   - itms 扣减由 F-3 框架在 use_effect 之后统一处理（item_consume_itms）
//   - 效果函数内部不应自行扣 itms
//   - HP/SP 字段位于 $pdata['hp']/['mhp']/['sp']/['msp']
//
// 相关文档：《道具使用与装备系统-设计案.md》§2.1、§3.2、§8.2
// ================================================================

/**
 * use_effect: 恢复 HP
 *
 * HP += itme，不超过 mhp。emit restore_hp.success（传 amount、item_id）。
 *
 * 适用道具：bread / health_potion / supply_pack / soda_crackers /
 *           cooked_meat_chunk / cured_meat / concentrated_soup /
 *           orange_pill / white_pill / nano_medkit
 *
 * @param array $item   道具实例
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use_effect_restore_hp($item, &$pdata) {
    global $obl_log;

    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';
    $amount = isset($item['itme']) ? (int)$item['itme'] : 0;
    $mhp = isset($pdata['mhp']) ? (int)$pdata['mhp'] : 0;
    $cur_hp = isset($pdata['hp']) ? (int)$pdata['hp'] : 0;

    if ($amount <= 0 || $mhp <= 0) {
        $obl_log->emit('restore_hp.invalid', 'system', [
            'item_id' => $item_id,
            'amount'  => $amount,
            'mhp'     => $mhp,
        ]);
        return;
    }

    // 已满时不溢出，但仍算"使用成功"（itms 由 F-3 扣减）
    $new_hp = min($cur_hp + $amount, $mhp);
    $actual = $new_hp - $cur_hp;
    $pdata['hp'] = $new_hp;

    $obl_log->emit('restore_hp.success', 'system', [
        'item_id' => $item_id,
        'amount'  => $actual,
    ]);
}

/**
 * use_effect: 恢复 SP
 *
 * SP += itme，不超过 msp。emit restore_sp.success（传 amount、item_id）。
 *
 * 适用道具：mineral_water / stamina_potion / roasted_rabbit /
 *           simple_stew / wild_mushroom / berries / cola / herbal_tea
 *
 * @param array $item   道具实例
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use_effect_restore_sp($item, &$pdata) {
    global $obl_log;

    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';
    $amount = isset($item['itme']) ? (int)$item['itme'] : 0;
    $msp = isset($pdata['msp']) ? (int)$pdata['msp'] : 0;
    $cur_sp = isset($pdata['sp']) ? (int)$pdata['sp'] : 0;

    if ($amount <= 0 || $msp <= 0) {
        $obl_log->emit('restore_sp.invalid', 'system', [
            'item_id' => $item_id,
            'amount'  => $amount,
            'msp'     => $msp,
        ]);
        return;
    }

    $new_sp = min($cur_sp + $amount, $msp);
    $actual = $new_sp - $cur_sp;
    $pdata['sp'] = $new_sp;

    $obl_log->emit('restore_sp.success', 'system', [
        'item_id' => $item_id,
        'amount'  => $actual,
    ]);
}

/**
 * use_effect: 清除 Body Status（简化版）
 *
 * 检查 $pdata['oblpara']['body_status']，存在则清空；emit cure_bs.success
 * 供未来健康系统订阅。当前 oblpara.body_status 字段未实现，本函数做防御性
 * 处理：字段不存在视为"无 Body Status 可清"，仍 emit success。
 *
 * 适用道具：antidote / bandage / whiskey / painkiller
 *
 * 未来健康系统实现后，可通过 function_exists 检测接管本函数，或订阅
 * cure_bs.success 事件实现更精细的"按 Tag 解除"逻辑。
 *
 * @param array $item   道具实例
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use_effect_cure_bs($item, &$pdata) {
    global $obl_log;

    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';

    $cured = [];
    if (isset($pdata['oblpara']) && is_array($pdata['oblpara'])
        && isset($pdata['oblpara']['body_status'])
        && is_array($pdata['oblpara']['body_status'])
    ) {
        $cured = $pdata['oblpara']['body_status'];
        $pdata['oblpara']['body_status'] = [];
    }

    $obl_log->emit('cure_bs.success', 'system', [
        'item_id'  => $item_id,
        'cured'    => $cured,
    ]);
}

/**
 * use_effect: 获得抗性（占位）
 *
 * emit gain_resistance.triggered 事件，供未来被动技能系统订阅实现抗性跃迁。
 * 当前无副作用（玩家 HP/SP/oblpara 不变），但 itms 由 F-3 框架扣减——
 * 这是"占位但有道具消耗语义"的合理设计：未来抗性系统订阅本事件后效果
 * 自动生效，无需再改道具模板。
 *
 * 适用道具：rabbit_meat_raw / raw_meat_chunk
 *
 * @param array $item   道具实例
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use_effect_gain_resistance($item, &$pdata) {
    global $obl_log;

    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';

    $obl_log->emit('gain_resistance.triggered', 'system', [
        'item_id' => $item_id,
    ]);
}

/**
 * use_effect: 打开神秘礼盒
 *
 * 调用 F-4 掷骰原语（obl_roll_group / obl_apply_durability_decay）生成
 * 物品实例列表，逐件经 itm0 → obl_organize_inventory 放入背包。
 *
 * 流程：
 *   1. include loot_tables.php，取出 gift_box_loot 表定义（P3 合并自原 gift_box_loot_table.php）
 *   2. 遍历 groups，逐组调用 obl_roll_group 累积物品实例
 *   3. 若 durability_decay=true，调用 obl_apply_durability_decay
 *   4. 逐件 obl_put_item_to_itm0 + obl_organize_inventory 放入背包
 *   5. 整理失败（背包满 + 无法合并）→ unset itm0 + emit open_gift_box.bag_full
 *      物品实例丢失；mystery_box 仍由 F-3 框架扣减（赌博语义）
 *
 * 适用道具：mystery_box
 *
 * @param array $item   道具实例（mystery_box）
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use_effect_open_gift_box($item, &$pdata) {
    global $obl_log;

    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';

    // 1. 加载 gift_box_loot 表定义（P3 阶段合并到 loot_tables.php 统一管理）
    $gift_tables = include GAME_ROOT . './oblivions/gamedata/loot_tables.php';
    if (!is_array($gift_tables) || !isset($gift_tables['gift_box_loot'])) {
        $obl_log->emit('open_gift_box.table_missing', 'system', [
            'item_id' => $item_id,
        ]);
        return;
    }
    $table = $gift_tables['gift_box_loot'];

    // 2. 遍历 groups 累积物品实例（复用 F-4 obl_roll_group 原语）
    $groups = isset($table['groups']) && is_array($table['groups']) ? $table['groups'] : [];
    $items = [];
    foreach ($groups as $group) {
        $group_items = obl_roll_group($group, []);
        foreach ($group_items as $it) {
            $items[] = $it;
        }
    }

    // 3. 耐久衰减（复用 F-4 obl_apply_durability_decay 原语）
    if (!empty($table['durability_decay'])) {
        obl_apply_durability_decay($items);
    }

    if (empty($items)) {
        $obl_log->emit('open_gift_box.empty', 'system', [
            'item_id' => $item_id,
        ]);
        return;
    }

    // 4. 逐件经 itm0 → organize 放入背包
    $dropped = [];
    foreach ($items as $new_item) {
        $new_item_id = isset($new_item['itmid']) ? (string)$new_item['itmid'] : '';

        // itm0 必须为空才能 put（cmd_handle_obl_use_item 已门控 itm0_pending）
        if (!obl_put_item_to_itm0($pdata, $new_item)) {
            // itm0 被占用（理论不应发生），直接尝试 add_to_inventory
            $slot = obl_add_item_to_inventory($pdata, $new_item);
            if ($slot === false) {
                $dropped[] = $new_item_id;
            }
            continue;
        }

        if (!obl_organize_inventory($pdata)) {
            // 背包满 + 无法合并，清理 itm0 + 记录丢失物品
            unset($pdata['itempara'][0]);
            $dropped[] = $new_item_id;
        }
    }

    // 5. emit 结果事件
    if (!empty($dropped)) {
        $obl_log->emit('open_gift_box.bag_full', 'system', [
            'item_id' => $item_id,
            'dropped' => $dropped,
        ]);
    }

    $obl_log->emit('open_gift_box.success', 'system', [
        'item_id' => $item_id,
        'count'   => count($items) - count($dropped),
    ]);
}

/**
 * use_effect: 放置 POI（F-7 玩家放置 POI 框架）
 *
 * 解析 item.itmpara 的 'poi_id:{template_id}' 协议，在玩家当前格放置
 * 对应模板的 POI 实例，写入 placed_by_pid / placed_at_day / ttl_days 三字段
 * 供 E-12 耐久系统跟踪。itms 扣减由 F-3 框架统一处理（与 open_gift_box 同模式：
 * 校验失败时仍扣 itms，"赌博语义"）。
 *
 * itmpara 协议：'poi_id:campfire_unlit'，由正则 /^poi_id:([a-z0-9_]+)$/ 严格解析
 *
 * 流程：
 *   1. 正则解析 itmpara 取 poi_id；格式错误 → emit place_poi.bad_protocol，return
 *   2. 加载 poi_table，校验模板存在；不存在 → emit place_poi.no_template，return
 *   3. 校验同格同模板 POI 实例数 < 上限（软约束 1，避免堆叠）
 *   4. INSERT bra_oblmappoi（pgroup/pls/poi_id/state='idle'/searched=0/
 *      placed_by_pid=pdata.pid/placed_at_day=obl_day_get()/ttl_days=template.ttl_days）
 *   5. emit place_poi.success（含 iaid / poi_id / placed_at_day / ttl_days）
 *
 * 适用道具：firewood（itmpara='poi_id:campfire_unlit'）
 *
 * @param array $item   道具实例（itmpara 含 poi_id 协议）
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_use_effect_place_poi($item, &$pdata) {
    global $db, $tablepre, $obl_log;

    if (!isset($db) || !$db || !isset($tablepre)) return;

    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';
    $itmpara = isset($item['itmpara']) ? (string)$item['itmpara'] : '';

    // 1. 正则解析 itmpara 协议
    if (!preg_match('/^poi_id:([a-z0-9_]+)$/', $itmpara, $m)) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('place_poi.bad_protocol', 'system', [
                'item_id'  => $item_id,
                'itmpara'  => $itmpara,
            ]);
        }
        return;
    }
    $poi_id = $m[1];

    // 2. 加载 POI 模板，校验存在性
    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    if (!isset($poi_table[$poi_id])) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('place_poi.no_template', 'system', [
                'item_id' => $item_id,
                'poi_id'  => $poi_id,
            ]);
        }
        return;
    }
    $template = $poi_table[$poi_id];

    // 3. 同格同模板上限校验（软约束 1：避免玩家堆叠放置）
    $pgroup = (int)$pdata['pgroup'];
    $pls = (int)$pdata['pls'];
    $poi_id_esc = $db->escape_string($poi_id);
    $cnt_result = $db->query("SELECT COUNT(*) AS cnt FROM {$tablepre}oblmappoi
                              WHERE pgroup='{$pgroup}' AND pls='{$pls}' AND poi_id='{$poi_id_esc}'");
    $cnt = 0;
    if ($cnt_result) {
        $row = $db->fetch_array($cnt_result);
        $cnt = (int)$row['cnt'];
    }
    if ($cnt >= 1) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('place_poi.tile_limit', 'system', [
                'item_id' => $item_id,
                'poi_id'  => $poi_id,
                'pgroup'  => $pgroup,
                'pls'     => $pls,
            ]);
        }
        return;
    }

    // 4. INSERT 新 POI 实例
    $placed_by_pid = (int)$pdata['pid'];
    $placed_at_day = function_exists('obl_day_get') ? (int)obl_day_get() : 0;
    $ttl_days = isset($template['ttl_days']) ? (int)$template['ttl_days'] : 0;

    $db->query("INSERT INTO {$tablepre}oblmappoi
                (pgroup, pls, poi_id, state, search_count, search_count_remaining,
                 last_search_turn, cooldown_until_turn, searched,
                 placed_by_pid, placed_at_day, ttl_days)
                VALUES
                ({$pgroup}, {$pls}, '{$poi_id_esc}', 'idle', 0, -1,
                 0, 0, 0,
                 {$placed_by_pid}, {$placed_at_day}, {$ttl_days})");

    $new_iaid = (int)$db->insert_id();

    // 5. emit 成功事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('place_poi.success', 'system', [
            'item_id'       => $item_id,
            'poi_id'        => $poi_id,
            'iaid'          => $new_iaid,
            'placed_by_pid' => $placed_by_pid,
            'placed_at_day' => $placed_at_day,
            'ttl_days'      => $ttl_days,
        ]);
    }
}
