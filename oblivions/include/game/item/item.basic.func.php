<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 道具库存基础操作 / Oblivions item basic inventory ops
//
// 承载道具系统的"基础操作层"——槽位读写、堆叠、拾取、丢弃、整理。
// 与衍生系统（use/craft/tag）形成层级关系：
//   基础层：item.basic.func.php（本文件）
//   衍生层：item.use.func.php / item.craft.func.php / item.tag.func.php
//
// 依赖：item.tag.func.php（item_load_table，数据加载）
//       item.use.func.php（item_consume_itms，由 obl_discard_item 间接调用）
//       以上由 obl_bootstrap.php 统一加载
// ================================================================

// ----------------------------------------------------------------
// itms 属性查询
// ----------------------------------------------------------------

/**
 * 判断 itms 是否为无限标识
 *
 * 无限标识统一为字符串 '∞'（对齐旧模式 $nosta = '∞'）。
 * 数量模型表示无限数量，耐久模型表示无限耐久。
 *
 * @param mixed $itms  道具的 itms 字段值
 * @return bool  true=无限
 */
function item_is_infinite($itms): bool {
    return (string)$itms === '∞';
}

// ----------------------------------------------------------------
// 堆叠属性查询（带静态缓存）
// ----------------------------------------------------------------

/**
 * 读取道具是否可堆叠（带静态缓存）
 *
 * @param string $item_id
 * @return bool true=可堆叠，不可堆叠或不存在返回 false
 */
function item_get_stack($item_id) {
    static $cache = null;
    if ($cache === null) {
        $table = item_load_table();
        $cache = [];
        foreach ($table as $id => $tpl) {
            $cache[$id] = !empty($tpl['stack']);
        }
    }
    return isset($cache[$item_id]) ? $cache[$item_id] : false;
}

/**
 * 读取道具的 stack_limit（带静态缓存）
 *
 * 与 item_get_stack 共享缓存加载时机，避免 obl_find_mergeable_slot 等高频函数
 * 每次调用 item_load_table（即使 item_load_table 内部有缓存，仍省一次哈希查找）。
 *
 * @param string $item_id
 * @return int  stack_limit，不可堆叠或不存在时返回 1
 */
function item_get_stack_limit($item_id) {
    static $cache = null;
    if ($cache === null) {
        $table = item_load_table();
        $cache = [];
        foreach ($table as $id => $tpl) {
            $cache[$id] = isset($tpl['stack_limit']) ? (int)$tpl['stack_limit'] : 1;
        }
    }
    return isset($cache[$item_id]) ? $cache[$item_id] : 1;
}

// ----------------------------------------------------------------
// 道具销毁
// ----------------------------------------------------------------

/**
 * 检查道具 itms 归零并销毁
 *
 * itms 归零代表道具耗尽（数量模型）或损坏（耐久模型）。
 * 检查 itms 是否为 '0'，是则从 itempara 移除该槽位（道具实例彻底销毁）。
 *
 * 这是"销毁道具"的统一入口，所有 itms 扣减后的销毁逻辑都应经过此函数。
 * 未来若销毁流程需要扩展（如销毁前清理、emit 销毁事件），只需改此一处。
 *
 * @param array &$pdata 玩家数据
 * @param int   $slot   槽位号（0=itm0，1~maxslots=普通槽位）
 * @return bool 是否触发了销毁（true=道具已销毁，false=道具未归零）
 */
function item_destroy_if_depleted(&$pdata, $slot): bool {
    $item = &$pdata['itempara'][$slot];
    if (isset($item['itms']) && (string)$item['itms'] === '0') {
        unset($pdata['itempara'][$slot]);
        return true;
    }
    return false;
}

/**
 * 将 itmpara 标准化为字符串键，用于堆叠合并时的相等性比较
 *
 * 设计理由：堆叠合并要求堆内每个单位完全相同。itmpara 携带个体状态时，
 * 不同 itmpara 的道具不可合并（避免状态丢失或错误聚合）。
 *
 * 数量模型道具的 itmpara 应为模板参数（来自 item_table），同 item_id 必相等。
 * 耐久模型道具不可堆叠，不调用此函数。
 *
 * @param mixed $itmpara  道具实例的 itmpara 字段（数组或 null）
 * @return string  标准化键（空 itmpara 返回空字符串）
 */
function _item_para_key($itmpara) {
    if (!is_array($itmpara) || empty($itmpara)) return '';
    ksort($itmpara);
    $parts = [];
    foreach ($itmpara as $k => $v) {
        $parts[] = $k . '=' . (is_array($v) ? json_encode($v) : (string)$v);
    }
    return implode('&', $parts);
}

// ----------------------------------------------------------------
// 道具栏槽位读写（基础 CRUD）
// ----------------------------------------------------------------

/**
 * 获取道具栏数组
 *
 * @param array &$pdata 已格式化的玩家数据
 * @return array 道具栏数组（index 0=特殊槽，1~itemmaxslots=普通槽）
 */
function obl_get_items(&$pdata) {
    return $pdata['itempara'];
}

/**
 * 获取指定槽位的道具
 *
 * @param array &$pdata
 * @param int $slot 槽位索引（0=特殊，1~itemmaxslots=普通）
 * @return array|null 道具对象数组，空槽返回 null
 */
function obl_get_item(&$pdata, $slot) {
    return isset($pdata['itempara'][$slot]) ? $pdata['itempara'][$slot] : null;
}

/**
 * 设置指定槽位的道具
 *
 * @param array &$pdata
 * @param int $slot
 * @param array|null $item 道具对象数组，或 null（清空）
 * @return void
 */
function obl_set_item(&$pdata, $slot, $item) {
    $pdata['itempara'][$slot] = $item;
}

/**
 * 找空槽位（仅普通槽 1~itemmaxslots，不含特殊槽 0）
 *
 * @param array &$pdata
 * @return int|false 空槽位索引，无空位返回 false
 */
function obl_find_empty_slot(&$pdata) {
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    for ($i = 1; $i <= $maxslots; $i++) {
        if (!isset($pdata['itempara'][$i]) || $pdata['itempara'][$i] === null) {
            return $i;
        }
    }
    return false;
}

/**
 * 检查背包是否已满
 *
 * @param array &$pdata
 * @return bool
 */
function obl_is_bag_full(&$pdata) {
    return obl_find_empty_slot($pdata) === false;
}

// ----------------------------------------------------------------
// 堆叠合并核心
// ----------------------------------------------------------------

/**
 * 查找可合并堆叠的槽位（仅查 1~itemmaxslots，不含 itm0）
 *
 * 合并条件：item_id 相同 + itmpara 相等（避免合并个体状态不同的道具，§2.3 约束）
 *
 * @param array &$pdata
 * @param string $item_id  道具 ID
 * @param mixed $itmpara   待合并道具的 itmpara（用于相等性检查）
 * @return int|false  可合并的槽位号，无则 false
 */
function obl_find_mergeable_slot(&$pdata, $item_id, $itmpara = null) {
    if (!item_get_stack($item_id)) {
        return false;
    }
    $stack_limit = item_get_stack_limit($item_id);
    $para_key = _item_para_key($itmpara);

    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    for ($i = 1; $i <= $maxslots; $i++) {
        $item = isset($pdata['itempara'][$i]) ? $pdata['itempara'][$i] : null;
        if (!$item || !is_array($item) || empty($item['itmid'])) continue;
        if ($item['itmid'] !== $item_id) continue;

        $s = (string)$item['itms'];
        $slot_para_key = _item_para_key(isset($item['itmpara']) ? $item['itmpara'] : null);
        if ($slot_para_key !== $para_key) continue;

        if (item_is_infinite($s)) return $i;
        $cur = (int)$s;
        if ($cur < $stack_limit) return $i;
    }
    return false;
}

/**
 * 添加道具到背包（自动合并，原子性）
 *
 * 行为：
 * - 不可堆叠道具 / 无限标识：直接找空槽位放入
 * - 可堆叠道具：先合并到已有堆叠，超限部分找空槽位创建新堆叠
 * - 预检查空间不足时返回 false，不修改任何数据（原子性）
 *
 * 注意：此函数不操作 itm0，只操作背包槽位 1~itemmaxslots。
 *       用于 obl_organize_inventory 转移 itm0 内容。
 *
 * @param array &$pdata
 * @param array $item  道具实例（itempara 格式）
 * @return int|false  实际放入的首个槽位号，空间不足返回 false
 */
function obl_add_item_to_inventory(&$pdata, $item) {
    $item_id = isset($item['itmid']) ? $item['itmid'] : '';
    $add_itms = isset($item['itms']) ? (string)$item['itms'] : '1';
    $item_itmpara = isset($item['itmpara']) ? $item['itmpara'] : null;
    $para_key = _item_para_key($item_itmpara);

    $is_stack = ($item_id !== '') && item_get_stack($item_id);
    if (item_is_infinite($add_itms) || !$is_stack) {
        $slot = obl_find_empty_slot($pdata);
        if ($slot === false) return false;
        $pdata['itempara'][$slot] = $item;
        return $slot;
    }

    $add_count = max(1, (int)$add_itms);
    $stack_limit = item_get_stack_limit($item_id);

    $available_space = 0;
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;
    for ($i = 1; $i <= $maxslots; $i++) {
        $slot_item = isset($pdata['itempara'][$i]) ? $pdata['itempara'][$i] : null;
        if ($slot_item === null) {
            $available_space += $stack_limit;
        } elseif (is_array($slot_item) && isset($slot_item['itmid']) && $slot_item['itmid'] === $item_id) {
            $s = (string)$slot_item['itms'];
            $slot_para_key = _item_para_key(isset($slot_item['itmpara']) ? $slot_item['itmpara'] : null);
            if ($slot_para_key !== $para_key) continue;

            if (item_is_infinite($s)) {
                $available_space = PHP_INT_MAX;
                break;
            }
            $available_space += max(0, $stack_limit - (int)$s);
        }
    }
    if ($available_space < $add_count) {
        return false;
    }

    $remaining = $add_count;
    $first_slot = false;

    while ($remaining > 0) {
        $slot = obl_find_mergeable_slot($pdata, $item_id, $item_itmpara);
        if ($slot === false) break;
        if ($first_slot === false) $first_slot = $slot;

        $cur = (string)$pdata['itempara'][$slot]['itms'];
        if (item_is_infinite($cur)) {
            return $slot;
        }
        $cur = (int)$cur;
        $merge = min($remaining, $stack_limit - $cur);
        $pdata['itempara'][$slot]['itms'] = (string)($cur + $merge);
        $remaining -= $merge;
    }

    while ($remaining > 0) {
        $slot = obl_find_empty_slot($pdata);
        if ($slot === false) break;
        if ($first_slot === false) $first_slot = $slot;

        $put = min($remaining, $stack_limit);
        $new_item = $item;
        $new_item['itms'] = (string)$put;
        $pdata['itempara'][$slot] = $new_item;
        $remaining -= $put;
    }

    return $first_slot;
}

/**
 * 合并背包内同类堆叠
 *
 * 遍历背包槽位，找同类可堆叠道具合并到 stack_limit。
 * 无限堆叠吸收所有同类。仅合并，不转移 itm0，不排序。
 *
 * @param array &$pdata
 */
function obl_merge_stacks_in_inventory(&$pdata) {
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;

    $groups = [];
    for ($i = 1; $i <= $maxslots; $i++) {
        $item = isset($pdata['itempara'][$i]) ? $pdata['itempara'][$i] : null;
        if (!$item || !is_array($item) || empty($item['itmid'])) continue;
        if (!item_get_stack($item['itmid'])) continue;
        $item_id = $item['itmid'];
        $para_key = _item_para_key(isset($item['itmpara']) ? $item['itmpara'] : null);
        $group_key = $item_id . '|' . $para_key;
        if (!isset($groups[$group_key])) {
            $groups[$group_key] = ['item_id' => $item_id, 'slots' => []];
        }
        $groups[$group_key]['slots'][] = $i;
    }

    foreach ($groups as $group) {
        $item_id = $group['item_id'];
        $slots = $group['slots'];
        if (count($slots) < 2) continue;

        $stack_limit = item_get_stack_limit($item_id);

        $infinite_slot = null;
        foreach ($slots as $slot) {
            $s = (string)$pdata['itempara'][$slot]['itms'];
            if (item_is_infinite($s)) {
                $infinite_slot = $slot;
                break;
            }
        }

        if ($infinite_slot !== null) {
            foreach ($slots as $slot) {
                if ($slot !== $infinite_slot) {
                    unset($pdata['itempara'][$slot]);
                }
            }
            continue;
        }

        $remaining_slots = $slots;
        while (count($remaining_slots) > 1) {
            $target_slot = array_shift($remaining_slots);
            $target_count = (int)$pdata['itempara'][$target_slot]['itms'];

            if ($target_count >= $stack_limit) continue;

            $next_remaining = [];
            foreach ($remaining_slots as $src_slot) {
                if ($target_count >= $stack_limit) {
                    $next_remaining[] = $src_slot;
                    continue;
                }
                $src_count = (int)$pdata['itempara'][$src_slot]['itms'];
                $merge = min($src_count, $stack_limit - $target_count);
                if ($merge > 0) {
                    $target_count += $merge;
                    $pdata['itempara'][$target_slot]['itms'] = (string)$target_count;
                    $src_count -= $merge;
                }
                if ($src_count > 0) {
                    $pdata['itempara'][$src_slot]['itms'] = (string)$src_count;
                    $next_remaining[] = $src_slot;
                } else {
                    unset($pdata['itempara'][$src_slot]);
                }
            }
            $remaining_slots = $next_remaining;
        }
    }
}

/**
 * 放入道具到 itm0 缓存槽
 *
 * 设计案 §4.1：itm0 必须为空才能放入新道具。
 * 调用方通常由 router 门控保证 itm0 为空，本函数额外做防御性检查。
 *
 * @param array &$pdata
 * @param array $item   道具实例（itempara 格式）
 * @return bool  true=放入成功，false=itm0 已被占用
 */
function obl_put_item_to_itm0(&$pdata, $item) {
    if (isset($pdata['itempara'][0]) && is_array($pdata['itempara'][0]) && !empty($pdata['itempara'][0]['itmid'])) {
        return false;
    }
    $pdata['itempara'][0] = $item;
    return true;
}

/**
 * 整理背包：合并同类堆叠 + 转移 itm0 → 背包
 *
 * 算法：
 * 1. 合并背包内同类堆叠（腾出空槽）
 * 2. 转移 itm0 → 背包（原子性，含合并到已有堆叠）
 *
 * 无步骤3：obl_add_item_to_inventory 转移时已合并，新堆叠必为满堆叠，无需再合并。
 *
 * @param array &$pdata
 * @return bool  true=整理成功（itm0 已清空），false=背包满（itm0 保留）
 */
function obl_organize_inventory(&$pdata) {
    obl_merge_stacks_in_inventory($pdata);

    if (!isset($pdata['itempara'][0]) || empty($pdata['itempara'][0]['itmid'])) {
        return true;
    }

    $item = $pdata['itempara'][0];
    $slot = obl_add_item_to_inventory($pdata, $item);

    if ($slot === false) {
        return false;
    }

    unset($pdata['itempara'][0]);

    return true;
}

// ----------------------------------------------------------------
// 拾取道具
// ----------------------------------------------------------------

/**
 * 从地图拾取道具到背包
 *
 * 流程（堆叠功能与合成系统P2重构-设计案 §7.1；itm0拾取语义拆分-设计案 §3.1）：
 *   1. 读取道具实例 + itms='0'/空 检查
 *   2. 位置检查
 *   3. 发现状态检查
 *   4. 近视道具揭示（陷阱处理 + $real_itm 定义）
 *   5. 构建道具实例
 *   6. 放入 itm0（obl_put_item_to_itm0，不直接放背包）
 *   7. 原子删除地图实例（失败回滚 itm0 + emit system.pickup_concurrent_loss）
 *   7.5 拾起成功 emit（pickup.success，传 item_id；近视道具跳过，避免与 reveal 重复）
 *   8. 自动整理（obl_organize_inventory，转移 itm0 → 背包）
 *   8.5 整理成功 emit（item.to_bag，传 item_id）
 *   8.6 整理失败 emit（organize.fail，传 item_id；与 7.5 解耦）
 *
 * item_id 存储约定（统一 JSON）：
 *   拾取时将地图表 item_id 复制到 itempara[].itmid；itmpara 保持原始附加参数。
 *   丢弃时从 itempara[].itmid 还原 bra_oblmapitem.item_id。
 *
 * @param int   $iid    道具实例 ID（bra_oblmapitem.iid）
 * @param array &$pdata 玩家数据
 */
function obl_pickup_item($iid, &$pdata) {
    global $db, $tablepre, $obl_log;

    $iid = (int)$iid;
    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    // 1. 读取道具实例
    $result = $db->query("SELECT * FROM {$tablepre}oblmapitem WHERE iid='$iid'");
    if (!$db->num_rows($result)) {
        $obl_log->emit('pickup.not_found', 'pickup');
        return;
    }
    $item = $db->fetch_array($result);

    // 1.5 itms='0' 或空检查（§12.3 边缘状态处理）
    $itms_raw = (string)$item['itms'];
    if ($itms_raw === '' || $itms_raw === '0') {
        $obl_log->emit('pickup.empty_item', 'pickup');
        return;
    }

    // 2. 位置检查
    if ((int)$item['pgroup'] != $cur_pgroup || (int)$item['pls'] != $cur_pls) {
        $obl_log->emit('pickup.not_adjacent', 'pickup');
        return;
    }

    // 3. 发现状态检查（未发现的道具不能拾取）
    if (empty($item['discovered'])) {
        $obl_log->emit('pickup.unknown', 'pickup');
        return;
    }

    // 4. 近视道具揭示
    $real_itm = $item['itm'];
    if ($real_itm === '') {
        $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
        $real_itm = isset($item_table[$item['item_id']]['itm']) ? $item_table[$item['item_id']]['itm'] : $item['item_id'];
    }
    $was_nearsighted = ((int)$item['discovered'] === 2);

    if ($was_nearsighted) {
        // 揭示真实身份
        if (!empty($item['is_trap'])) {
            // 陷阱（v1 简化：仅写日志，不造成伤害，不获得道具）
            $obl_log->emit('pickup.trap', 'pickup', [
                'item_name' => $real_itm,
            ]);
            // 原子删除：仅当道具仍存在时删除，防止并发重复触发
            $db->query("DELETE FROM {$tablepre}oblmapitem WHERE iid='$iid'");
            return;
        }
        // 正常近视道具：揭示真实名称
        $obl_log->emit('pickup.nearsighted_reveal', 'pickup', [
            'item_name' => $real_itm,
        ]);
    }

    // 5. 构建道具实例（itm 留空：新拾取道具遵循约定，前端通过 item_id 查 locale 渲染名称）
    $itmpara = json_decode((string)$item['itmpara'], true);
    if (!is_array($itmpara)) $itmpara = [];

    $new_item = array(
        'itm'     => '',
        'itmk'    => $item['itmk'],
        'itme'    => (int)$item['itme'],
        'itms'    => $item['itms'],
        'itmsk'   => $item['itmsk'],
        'itmpara' => $itmpara,
        'itmid'   => (string)$item['item_id'],
    );

    // 6. 放入 itm0（不直接放背包）
    if (!obl_put_item_to_itm0($pdata, $new_item)) {
        // itm0 已被占用（理论不应发生，router 门控已拦截）
        $obl_log->emit('system.itm0_occupied', 'system');
        return;
    }

    // 7. 原子删除地图道具实例：仅当 discovered>0 时删除，防止并发拾取同一道具
    //    如果 affected_rows=0 说明道具已被其他请求拾取，回滚 itm0
    $db->query("DELETE FROM {$tablepre}oblmapitem WHERE iid='$iid' AND discovered>0");
    if ($db->affected_rows() <= 0) {
        // 道具已被并发请求拾取，回滚 itm0（O(1) 操作）
        unset($pdata['itempara'][0]);
        $obl_log->emit('system.pickup_concurrent_loss', 'system');
        return;
    }

    // 7.5 拾起成功（道具已从地图删除，已存入 itm0，即"拿在手上"）
    //     近视道具已在步骤4 emit reveal（含"拿起"语义），不重复 emit success
    //     即使后续整理失败，玩家也已看到"捡起了 xxx"，与 organize.fail 语义自洽
    if (!$was_nearsighted) {
        $obl_log->emit('pickup.success', 'pickup', [
            'item_id' => (string)$item['item_id'],
        ]);
    }

    // 8. 自动整理（转移 itm0 → 背包）
    $organized = obl_organize_inventory($pdata);

    // 8.5 / 8.6 整理结果 emit（与 7.5 解耦：拾起成功是独立事件，整理结果是独立事件）
    if ($organized) {
        // 8.5 整理成功：道具从 itm0 进入背包
        $obl_log->emit('item.to_bag', 'system', [
            'item_id' => (string)$item['item_id'],
        ]);
    } else {
        // 8.6 整理失败：道具卡在 itm0，玩家被门控锁定
        $obl_log->emit('organize.fail', 'system', [
            'item_id' => (string)$item['item_id'],
        ]);
    }
}

// ----------------------------------------------------------------
// 丢弃道具
// ----------------------------------------------------------------

/**
 * 从背包丢弃道具到当前地图格
 * 道具从背包槽位删除，写入 bra_oblmapitem（iaid=0, discovered=1）
 * 其他玩家/后续可拾取
 *
 * slot=0（itm0 缓存槽）与普通槽位走同一逻辑：写回地图 + 清槽 + emit discard.success。
 * itm0 中的道具是真实存在的（来自拾取/合成），丢弃语义=放回地图，与普通丢弃一致。
 * itm0 清空后门控立即解锁（§4.2）。
 *
 * item_id 还原（统一 JSON）：
 *   从 itempara[].itmid 还原 bra_oblmapitem.item_id，itmpara 原样写回。
 *
 * @param int   $slot   背包槽位号（0=itm0，1~maxslots=普通槽位）
 * @param array &$pdata 玩家数据
 */
function obl_discard_item($slot, &$pdata) {
    global $db, $tablepre, $obl_log;

    $slot = (int)$slot;
    $maxslots = isset($pdata['itemmaxslots']) ? (int)$pdata['itemmaxslots'] : 6;

    // slot 合法性：0=itm0 缓存槽，1~maxslots=普通槽
    if ($slot < 0 || $slot > $maxslots) {
        $obl_log->emit('discard.invalid_slot', 'discard', ['slot' => $slot]);
        return;
    }

    $item = obl_get_item($pdata, $slot);
    if (empty($item) || !is_array($item)) {
        $obl_log->emit('discard.empty_slot', 'discard', ['slot' => $slot]);
        return;
    }

    // 读取道具数据（从 itempara JSON 七字段结构还原为地图道具表字段）
    $itm     = isset($item['itm']) ? $item['itm'] : '';
    $itmk    = isset($item['itmk']) ? $item['itmk'] : '';
    $itme    = isset($item['itme']) ? (int)$item['itme'] : 0;
    $itms    = isset($item['itms']) ? $item['itms'] : '';
    $itmsk   = isset($item['itmsk']) ? $item['itmsk'] : '';
    $itmpara = isset($item['itmpara']) && is_array($item['itmpara']) ? $item['itmpara'] : [];
    $item_id = isset($item['itmid']) ? (string)$item['itmid'] : '';
    $log_name = $itm;
    if ($log_name === '' && $item_id !== '') {
        $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
        $log_name = isset($item_table[$item_id]['itm']) ? $item_table[$item_id]['itm'] : $item_id;
    }

    // 还原 itmpara 为字符串（空数组留空字符串）
    $itmpara_str = empty($itmpara) ? '' : json_encode($itmpara, JSON_UNESCAPED_UNICODE);

    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    // 写入地图道具表（iaid=0 散落道具，discovered=1 立即可见）
    $itm_e       = $db->escape_string($itm);
    $itmk_e      = $db->escape_string($itmk);
    $itms_e      = $db->escape_string($itms);
    $itmsk_e     = $db->escape_string($itmsk);
    $itmpara_e   = $db->escape_string($itmpara_str);
    $item_id_e   = $db->escape_string($item_id);

    $db->query("INSERT INTO {$tablepre}oblmapitem
                (pgroup, pls, iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara, discovered, fake_item_id, is_trap)
                VALUES ('$cur_pgroup', '$cur_pls', 0, '$item_id_e', '$itm_e', '$itmk_e', $itme, '$itms_e', '$itmsk_e', '$itmpara_e', 1, '', 0)");

    // 清空槽位：slot=0 用 unset（保持 itm0 清空约定，与 item_consume_materials 一致），
    // 普通槽用 obl_set_item null
    if ($slot === 0) {
        unset($pdata['itempara'][0]);
    } else {
        obl_set_item($pdata, $slot, null);
    }

    $obl_log->emit('discard.success', 'discard', [
        'item_name' => $log_name,
    ]);
}
