<?php
/**
 * @module F 物品系统
 * @framework F-5 装备穿卸与属性加成
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 装备穿卸与属性加成 / Oblivions equipment equip/unequip
//
// 基于 F-1 槽位背包协议实现穿上/卸下流程；
// 基于 G-1 装备技能注入机制联动技能刷新；
// 属性加成采用"基础值 + 装备加成"的纯函数计算模型，不引入 buff 系统。
// 副武器（wep2）不提供属性加成，仅作技能载体 + 可与主武器交换。
//
// 依赖：
//   item.basic.func.php（obl_get_item / obl_set_item / obl_find_empty_slot / obl_add_item_to_inventory）
//   item.tag.func.php（item_has_tag）
//   skill/skill.main.php（skill_strip_temporary / skill_inject_equipment）
//
// 相关文档：《道具使用与装备系统-设计案.md》§2.2 §2.3 §2.4 §2.5
// ================================================================

// ----------------------------------------------------------------
// itmk → 装备槽位映射
// ----------------------------------------------------------------

/**
 * itmk 到默认装备槽位的映射
 *
 * 设计案 §2.2：
 * - WP/WK/WG/WD/WF/WC → wep（主武器）
 * - AR → db（护甲）
 * - AH → dh（头部防具）
 * - AA → da（手部防具）
 * - AF → df（足部防具）
 * - 其他 → null（不可装备，需通过 tag_equippable 在调用层拦截）
 *
 * 注意：wep2（副武器）默认不通过 itmk 自动映射——副武器需要显式指定 $equip_slot='wep2'。
 *
 * @param string $itmk 道具类型
 * @return string|null 装备槽位名（wep/db/dh/da/df）或 null
 */
function item_equip_get_slot_for_itmk($itmk) {
    $itmk = (string)$itmk;
    switch ($itmk) {
        case 'WP':
        case 'WK':
        case 'WG':
        case 'WD':
        case 'WF':
        case 'WC':
            return 'wep';
        case 'AR':
            return 'db';
        case 'AH':
            return 'dh';
        case 'AA':
            return 'da';
        case 'AF':
            return 'df';
        default:
            return null;
    }
}

/**
 * 校验装备槽位是否接受该 itmk
 *
 * 设计案 §2.2：
 * - wep / wep2：接受 WP/WK/WG/WD/WF/WC
 * - db：接受 AR
 * - dh：接受 AH
 * - da：接受 AA
 * - df：接受 AF
 * - ac：接受任意 itmk（保留槽位，无属性加成）
 *
 * @param string $itmk       道具类型
 * @param string $equip_slot 装备槽位名（wep/wep2/db/dh/da/df/ac）
 * @return bool true=槽位接受该 itmk
 */
function item_equip_validate_slot($itmk, $equip_slot) {
    $itmk = (string)$itmk;
    $equip_slot = (string)$equip_slot;

    $weapon_kinds = array('WP', 'WK', 'WG', 'WD', 'WF', 'WC');
    switch ($equip_slot) {
        case 'wep':
        case 'wep2':
            return in_array($itmk, $weapon_kinds, true);
        case 'db':
            return $itmk === 'AR';
        case 'dh':
            return $itmk === 'AH';
        case 'da':
            return $itmk === 'AA';
        case 'df':
            return $itmk === 'AF';
        case 'ac':
            return true; // 保留槽位，接受任意 itmk
        default:
            return false;
    }
}

/**
 * 装备槽位 → 字段名映射
 *
 * 返回该槽位在 $pdata 中使用的 7 个字段名（id/name/kind/effect/durability/sk/para）。
 * 字段顺序对齐 player.func.php 装备字段约定（wep / wep2 / db / dh / da / df / ac）。
 *
 * @param string $equip_slot 装备槽位名
 * @return array|null 字段名映射数组，未知槽位返回 null
 */
function item_equip_slot_to_fields($equip_slot) {
    $equip_slot = (string)$equip_slot;
    $map = array(
        'wep'  => array('id' => 'wepid',  'name' => 'wep',  'kind' => 'wepk',  'effect' => 'wepe',  'durability' => 'weps',  'sk' => 'wepsk',  'para' => 'weppara'),
        'wep2' => array('id' => 'wep2id', 'name' => 'wep2', 'kind' => 'wep2k', 'effect' => 'wep2e', 'durability' => 'wep2s', 'sk' => 'wep2sk', 'para' => 'wep2para'),
        'db'   => array('id' => 'dbid',   'name' => 'db',   'kind' => 'dbk',   'effect' => 'dbe',   'durability' => 'dbs',   'sk' => 'dbsk',   'para' => 'dbpara'),
        'dh'   => array('id' => 'dhid',   'name' => 'dh',   'kind' => 'dhk',   'effect' => 'dhe',   'durability' => 'dhs',   'sk' => 'dhsk',   'para' => 'dhpara'),
        'da'   => array('id' => 'daid',   'name' => 'da',   'kind' => 'dak',   'effect' => 'dae',   'durability' => 'das',   'sk' => 'dask',   'para' => 'dapara'),
        'df'   => array('id' => 'dfid',   'name' => 'df',   'kind' => 'dfk',   'effect' => 'dfe',   'durability' => 'dfs',   'sk' => 'dfsk',   'para' => 'dfpara'),
        'ac'   => array('id' => 'acid',   'name' => 'ac',   'kind' => 'ack',   'effect' => 'ace',   'durability' => 'acs',   'sk' => 'acsk',   'para' => 'acpara'),
    );
    return isset($map[$equip_slot]) ? $map[$equip_slot] : null;
}

// ----------------------------------------------------------------
// 穿上装备
// ----------------------------------------------------------------

/**
 * 穿上装备
 *
 * 设计案 §2.3 流程：
 *   1. 读取背包槽位 $slot 的道具实例
 *   2. 检查 tag_equippable → 不含 emit equip.not_equippable
 *   3. 检查耐久 itms='0' → emit equip.broken
 *   4. 决定目标装备槽位 $equip_slot：
 *      - 若调用方传入 $equip_slot，校验该槽位接受道具的 itmk
 *      - 若未传入，根据 itmk 自动映射
 *   5. 检查目标槽位是否已有装备：
 *      - 空 → 直接装入
 *      - 已有装备 → 检查背包是否有空位容纳旧装备：
 *        - 无空位 → emit equip.bag_full 阻止
 *        - 有空位 → 旧装备放入背包空位，新装备装入槽位
 *   6. 写入装备字段（{slot}id / {slot} / {slot}k / {slot}e / {slot}s / {slot}sk / {slot}para）
 *   7. 清空背包槽位（unset itempara[$slot]）
 *   8. 立即重建装备技能：先 skill_strip_temporary + 再 skill_inject_equipment
 *   9. emit equip.success（传 item_id、equip_slot）
 *
 * @param int          $slot       背包槽位号（1~itemmaxslots，不接受 itm0=0）
 * @param string|null  $equip_slot 显式指定的装备槽位；null/空 表示根据 itmk 自动映射
 * @param array        &$pdata     玩家数据
 * @return void
 */
function item_equip($slot, $equip_slot, &$pdata) {
    global $obl_log;

    $slot = (int)$slot;
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;

    // slot 合法性：仅接受普通槽 1~maxslots，不接受 itm0=0
    if ($slot < 1 || $slot > $maxslots) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('equip.invalid_slot', 'equip', array('slot' => $slot));
        return;
    }

    // 1. 读取背包槽位的道具实例
    $item = obl_get_item($pdata, $slot);
    if (!$item || !is_array($item) || empty($item['itmid'])) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('equip.empty_slot', 'equip', array('slot' => $slot));
        return;
    }

    $item_id = (string)$item['itmid'];
    $itmk = isset($item['itmk']) ? (string)$item['itmk'] : '';

    // 2. 检查 tag_equippable
    if (!item_has_tag($item_id, 'tag_equippable')) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('equip.not_equippable', 'equip', array('item_id' => $item_id));
        return;
    }

    // 3. 检查耐久 itms='0'
    $itms = isset($item['itms']) ? (string)$item['itms'] : '0';
    if ($itms === '0') {
        if (isset($obl_log) && $obl_log) $obl_log->emit('equip.broken', 'equip', array('item_id' => $item_id));
        return;
    }

    // 4. 决定目标装备槽位
    if ($equip_slot === null || $equip_slot === '') {
        $target_slot = item_equip_get_slot_for_itmk($itmk);
        if ($target_slot === null) {
            if (isset($obl_log) && $obl_log) $obl_log->emit('equip.invalid_kind', 'equip', array('item_id' => $item_id, 'itmk' => $itmk));
            return;
        }
    } else {
        $target_slot = (string)$equip_slot;
        if (item_equip_slot_to_fields($target_slot) === null) {
            if (isset($obl_log) && $obl_log) $obl_log->emit('equip.invalid_slot', 'equip', array('equip_slot' => $target_slot));
            return;
        }
        if (!item_equip_validate_slot($itmk, $target_slot)) {
            if (isset($obl_log) && $obl_log) $obl_log->emit('equip.invalid_slot', 'equip', array('item_id' => $item_id, 'itmk' => $itmk, 'equip_slot' => $target_slot));
            return;
        }
    }

    $fields = item_equip_slot_to_fields($target_slot);

    // 5. 检查目标槽位是否已有装备
    $existing_id = isset($pdata[$fields['id']]) ? (string)$pdata[$fields['id']] : '';
    if ($existing_id !== '') {
        // 已有装备：检查背包是否有空位容纳旧装备
        $empty_slot = obl_find_empty_slot($pdata);
        if ($empty_slot === false) {
            if (isset($obl_log) && $obl_log) $obl_log->emit('equip.bag_full', 'equip', array('item_id' => $item_id, 'equip_slot' => $target_slot));
            return;
        }
        // 旧装备还原为 itempara 七字段实例，放入空位
        $old_item = array(
            'itm'     => isset($pdata[$fields['name']]) ? $pdata[$fields['name']] : '',
            'itmk'    => isset($pdata[$fields['kind']]) ? $pdata[$fields['kind']] : '',
            'itme'    => isset($pdata[$fields['effect']]) ? (int)$pdata[$fields['effect']] : 0,
            'itms'    => isset($pdata[$fields['durability']]) ? (string)$pdata[$fields['durability']] : '0',
            'itmsk'   => isset($pdata[$fields['sk']]) ? $pdata[$fields['sk']] : '',
            'itmpara' => isset($pdata[$fields['para']]) && is_array($pdata[$fields['para']]) ? $pdata[$fields['para']] : array(),
            'itmid'   => $existing_id,
        );
        obl_set_item($pdata, $empty_slot, $old_item);
    }

    // 6. 写入新装备到装备字段
    $pdata[$fields['id']]         = $item_id;
    $pdata[$fields['name']]       = isset($item['itm']) ? $item['itm'] : '';
    $pdata[$fields['kind']]       = $itmk;
    $pdata[$fields['effect']]     = isset($item['itme']) ? (int)$item['itme'] : 0;
    $pdata[$fields['durability']] = $itms; // 保留原值，可能为 '∞'
    $pdata[$fields['sk']]         = isset($item['itmsk']) ? $item['itmsk'] : '';
    $pdata[$fields['para']]       = isset($item['itmpara']) && is_array($item['itmpara']) ? $item['itmpara'] : array();

    // 7. 清空背包槽位
    unset($pdata['itempara'][$slot]);

    // 8. 重建装备技能：先剥离所有 equipment 类技能，再按新装备字段重新注入
    if (function_exists('skill_strip_temporary')) {
        skill_strip_temporary($pdata['skillpara']);
    }
    if (function_exists('skill_inject_equipment')) {
        skill_inject_equipment($pdata['skillpara'], $pdata);
    }

    // 9. emit 成功事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('equip.success', 'equip', array(
            'item_id'    => $item_id,
            'equip_slot' => $target_slot,
        ));
    }
}

// ----------------------------------------------------------------
// 卸下装备
// ----------------------------------------------------------------

/**
 * 卸下装备
 *
 * 设计案 §2.3 流程：
 *   1. 读取装备槽位 $equip_slot
 *   2. 检查槽位是否为空 → 空 emit unequip.empty_slot
 *   3. 检查背包是否有空位 → 无空位 emit unequip.bag_full 阻止
 *   4. 将装备字段还原为道具实例（itempara 七字段格式）
 *   5. 调用 obl_add_item_to_inventory 放入背包（含堆叠合并）
 *   6. 清空装备字段
 *   7. 立即重建装备技能：先 skill_strip_temporary + 再 skill_inject_equipment
 *   8. emit unequip.success（传 item_id、equip_slot）
 *
 * @param string $equip_slot 装备槽位名（wep/wep2/db/dh/da/df/ac）
 * @param array  &$pdata     玩家数据
 * @return void
 */
function item_unequip($equip_slot, &$pdata) {
    global $obl_log;

    $equip_slot = (string)$equip_slot;
    $fields = item_equip_slot_to_fields($equip_slot);
    if ($fields === null) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('unequip.invalid_slot', 'unequip', array('equip_slot' => $equip_slot));
        return;
    }

    // 1. 读取装备槽位
    $item_id = isset($pdata[$fields['id']]) ? (string)$pdata[$fields['id']] : '';

    // 2. 检查槽位是否为空
    if ($item_id === '') {
        if (isset($obl_log) && $obl_log) $obl_log->emit('unequip.empty_slot', 'unequip', array('equip_slot' => $equip_slot));
        return;
    }

    // 3. 检查背包是否有空位（卸下的装备不可堆叠——耐久模型，必然占用一个空槽）
    $empty_slot = obl_find_empty_slot($pdata);
    if ($empty_slot === false) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('unequip.bag_full', 'unequip', array('item_id' => $item_id, 'equip_slot' => $equip_slot));
        return;
    }

    // 4. 将装备字段还原为道具实例（itempara 七字段格式）
    $restored_item = array(
        'itm'     => isset($pdata[$fields['name']]) ? $pdata[$fields['name']] : '',
        'itmk'    => isset($pdata[$fields['kind']]) ? $pdata[$fields['kind']] : '',
        'itme'    => isset($pdata[$fields['effect']]) ? (int)$pdata[$fields['effect']] : 0,
        'itms'    => isset($pdata[$fields['durability']]) ? (string)$pdata[$fields['durability']] : '0',
        'itmsk'   => isset($pdata[$fields['sk']]) ? $pdata[$fields['sk']] : '',
        'itmpara' => isset($pdata[$fields['para']]) && is_array($pdata[$fields['para']]) ? $pdata[$fields['para']] : array(),
        'itmid'   => $item_id,
    );

    // 5. 调用 obl_add_item_to_inventory 放入背包（含堆叠合并）
    //    装备均为耐久模型（stack=false），obl_add_item_to_inventory 会走"不可堆叠"分支直接找空槽放入。
    //    步骤 3 已预检空位，此处必成功；保留防御性判断以防并发。
    $placed = obl_add_item_to_inventory($pdata, $restored_item);
    if ($placed === false) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('unequip.bag_full', 'unequip', array('item_id' => $item_id, 'equip_slot' => $equip_slot));
        return;
    }

    // 6. 清空装备字段
    $pdata[$fields['id']]         = '';
    $pdata[$fields['name']]       = '';
    $pdata[$fields['kind']]       = '';
    $pdata[$fields['effect']]     = 0;
    $pdata[$fields['durability']] = '0';
    $pdata[$fields['sk']]         = '';
    $pdata[$fields['para']]       = array();

    // 7. 重建装备技能：先剥离所有 equipment 类技能，再按卸下后的装备字段重新注入
    if (function_exists('skill_strip_temporary')) {
        skill_strip_temporary($pdata['skillpara']);
    }
    if (function_exists('skill_inject_equipment')) {
        skill_inject_equipment($pdata['skillpara'], $pdata);
    }

    // 8. emit 成功事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('unequip.success', 'unequip', array(
            'item_id'    => $item_id,
            'equip_slot' => $equip_slot,
        ));
    }
}

// ----------------------------------------------------------------
// 副武器交换
// ----------------------------------------------------------------

/**
 * 交换主武器（wep）与副武器（wep2）
 *
 * 设计案 §2.5：
 *   1. 检查 wep 和 wep2 槽位是否至少有一个非空：
 *      - 两者均空 → emit swap_weapon.both_empty 阻止
 *   2. 交换 wep 和 wep2 的全部 7 个装备字段
 *   3. 立即重建装备技能：先 skill_strip_temporary + 再 skill_inject_equipment
 *   4. emit swap_weapon.success（传 wep_item_id、wep2_item_id）
 *
 * 设计意图：
 * - 副武器不提供属性加成（设计案 §2.4），交换后 effective_att 自动反映新主武器加成
 * - throw 技能 slots 配置含 wep+wep2，交换后技能仍匹配
 * - 不推进 tick，不涉及背包
 *
 * @param array &$pdata 玩家数据
 * @return void
 */
function item_swap_weapon(&$pdata) {
    global $obl_log;

    $wep_fields = item_equip_slot_to_fields('wep');
    $wep2_fields = item_equip_slot_to_fields('wep2');

    $wep_id = isset($pdata[$wep_fields['id']]) ? (string)$pdata[$wep_fields['id']] : '';
    $wep2_id = isset($pdata[$wep2_fields['id']]) ? (string)$pdata[$wep2_fields['id']] : '';

    // 1. 两者均空 → 阻止
    if ($wep_id === '' && $wep2_id === '') {
        if (isset($obl_log) && $obl_log) $obl_log->emit('swap_weapon.both_empty', 'swap_weapon', array());
        return;
    }

    // 2. 交换 7 个字段（id/name/kind/effect/durability/sk/para）
    $swap_keys = array('id', 'name', 'kind', 'effect', 'durability', 'sk', 'para');
    foreach ($swap_keys as $key) {
        $wep_field = $wep_fields[$key];
        $wep2_field = $wep2_fields[$key];
        $tmp = isset($pdata[$wep_field]) ? $pdata[$wep_field] : '';
        $pdata[$wep_field] = isset($pdata[$wep2_field]) ? $pdata[$wep2_field] : '';
        $pdata[$wep2_field] = $tmp;
    }

    // 3. 重建装备技能：先剥离所有 equipment 类技能，再按交换后的装备字段重新注入
    if (function_exists('skill_strip_temporary')) {
        skill_strip_temporary($pdata['skillpara']);
    }
    if (function_exists('skill_inject_equipment')) {
        skill_inject_equipment($pdata['skillpara'], $pdata);
    }

    // 4. emit 成功事件（交换后的 wep_item_id 与 wep2_item_id）
    $new_wep_id = isset($pdata[$wep_fields['id']]) ? (string)$pdata[$wep_fields['id']] : '';
    $new_wep2_id = isset($pdata[$wep2_fields['id']]) ? (string)$pdata[$wep2_fields['id']] : '';
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('swap_weapon.success', 'swap_weapon', array(
            'wep_item_id'  => $new_wep_id,
            'wep2_item_id' => $new_wep2_id,
        ));
    }
}

// ----------------------------------------------------------------
// 装备属性加成计算
// ----------------------------------------------------------------

/**
 * 计算含装备加成的攻击力
 *
 * 设计案 §2.4：基础值 + 主武器 itme（副武器 wep2 不提供 att 加成）
 *
 * @param array $pdata 玩家数据
 * @return int
 */
function player_get_effective_att($pdata): int {
    $base = (int)($pdata['att'] ?? 0);
    $wep = (int)($pdata['wepe'] ?? 0);
    // 副武器 wep2 不提供 att 加成（仅作技能载体 + 可与主武器交换）
    return $base + $wep;
}

/**
 * 计算含装备加成的防御力
 *
 * 设计案 §2.4：基础值 + db + dh + da + df
 * 注意：ac（饰品槽位）无属性加成（设计案 §2.2）。
 *
 * @param array $pdata 玩家数据
 * @return int
 */
function player_get_effective_def($pdata): int {
    $base = (int)($pdata['def'] ?? 0);
    $db = (int)($pdata['dbe'] ?? 0);
    $dh = (int)($pdata['dhe'] ?? 0);
    $da = (int)($pdata['dae'] ?? 0);
    $df = (int)($pdata['dfe'] ?? 0);
    return $base + $db + $dh + $da + $df;
}
