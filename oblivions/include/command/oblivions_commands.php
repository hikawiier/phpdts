<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 指令处理：探索/搜索/拾取/丢弃/战斗
// Command handlers for Oblivions explore/search/pickup/discard/battle
//
// 由 oblivions_router.php 在 Oblivions 模式下分发调用。
// 每个 handler 内部按需 include 所需函数库，避免非 Oblivions 模式加载。
// ================================================================

/**
 * Oblivions 原地探索
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_explore(&$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_explore($pdata);
}

/**
 * Oblivions 搜索建筑物
 * @param int   $iaid   建筑物实例 ID
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_search($iaid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/explore.func.php';
    obl_search_poi((int)$iaid, $pdata);
}

/**
 * Oblivions 拾取道具
 * @param int   $iid    道具实例 ID（bra_oblmapitem.iid）
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_pickup($iid, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/item/item.basic.func.php';
    obl_pickup_item((int)$iid, $pdata);
}

/**
 * Oblivions 丢弃道具
 * @param int   $slot   背包槽位号（1~6）
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_discard($slot, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/item/item.basic.func.php';
    obl_discard_item((int)$slot, $pdata);
}

/**
 * Oblivions 整理背包
 *
 * 触发 obl_organize_inventory：合并背包内同类堆叠 + 转移 itm0 → 背包。
 * 用于 itm0 被锁定时玩家主动整理，或日常整理背包。
 *
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_organize(&$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/item/item.basic.func.php';
    global $obl_log;
    // item_id 必须在 organize 之前读取：成功后 itm0 已被 unset，无法再获取
    $item_id = isset($pdata['itempara'][0]['itmid']) ? (string)$pdata['itempara'][0]['itmid'] : '';
    $success = obl_organize_inventory($pdata);
    if ($success) {
        $obl_log->emit('item.to_bag', 'system', ['item_id' => $item_id]);
    } else {
        // 整理失败：itm0 有道具卡住，带 item_id
        $obl_log->emit('organize.fail', 'system', ['item_id' => $item_id]);
    }
}

/**
 * Oblivions 使用道具
 *
 * itm0 非空时只允许使用 itm0（slot=0），其他槽位被阻塞（路由门控已放行 obl_use_item，
 * 此处二次校验 slot）。这与旧 phpdts 的"手持道具可直接使用"语义一致。
 *
 * @param int   $slot   背包槽位号（0=itm0，1~maxslots=普通槽位）
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_use_item($slot, &$pdata) {
    if (!oblivions_is_active()) return;
    $slot = (int)$slot;
    $itm0_pending = isset($pdata['itempara'][0]) && is_array($pdata['itempara'][0]) && !empty($pdata['itempara'][0]['itmid']);
    if ($itm0_pending && $slot !== 0) {
        global $obl_log;
        $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    include_once GAME_ROOT . './oblivions/include/game/item/item.use.func.php';
    item_use($slot, $pdata);
}

/**
 * Oblivions 合成道具
 * @param mixed $slots               背包槽位号（逗号分隔字符串）
 * @param mixed $workbench_materials 工作台素材 ID（逗号分隔字符串）
 * @param array &$pdata              玩家数据
 */
function cmd_handle_obl_craft($slots, $workbench_materials, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/item/item.craft.func.php';
    item_craft($slots, $pdata, $workbench_materials);
}

// ================================================================
// Oblivions 战斗指令处理 / Oblivions battle command handlers
// ================================================================

/**
 * 玩家突袭 NPC
 *
 * 玩家前端点击已发现的 NPC → 前端预装填动作 → 提交 obl_battle_start 命令。
 * 不做任何目标校验，直接委托 combat_start_battle 处理。
 * 新 combat 负责执行玩家首轮动作并创建先攻队列。
 *
 * 指令格式统一：只传 actions JSON 数组，突袭目标从 actions[0]['target'] 推导。
 *
 * @param array     &$pdata    玩家数据
 * @param array|null $actions   预装填动作数组，每项含 act_id + target。null 时为空（不执行动作）
 */
function cmd_handle_obl_battle_start(&$pdata, $actions = null) {
    if (!oblivions_is_active()) return;
    combat_start_battle($pdata, $actions);
}

/**
 * 玩家回合（已有先攻队列的情况下）
 *
 * 由前端在玩家选择动作后提交 obl_battle_action 命令时调用。
 * 直接委托 combat_dispatch('player_turn') 处理。
 *
 * @param array     &$pdata    玩家数据
 * @param array|null $actions   预装填动作数组，每项含 act_id + target。提供时优先使用
 */
function cmd_handle_obl_battle_action(&$pdata, $actions = null) {
    if (!oblivions_is_active()) return;
    combat_dispatch('player_turn', $pdata, $actions);
}
