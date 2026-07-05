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
    $success = obl_organize_inventory($pdata);
    if ($success) {
        $obl_log->emit('organize.success', 'system');
    } else {
        // 整理失败：itm0 有道具卡住，带 item_id
        $item_id = isset($pdata['itempara'][0]['itmid']) ? (string)$pdata['itempara'][0]['itmid'] : '';
        $obl_log->emit('organize.fail', 'system', ['item_id' => $item_id]);
    }
}

/**
 * Oblivions 使用道具
 * @param int   $slot   背包槽位号
 * @param array &$pdata 玩家数据
 */
function cmd_handle_obl_use_item($slot, &$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/item/item.use.func.php';
    item_use((int)$slot, $pdata);
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
 * 不做任何目标校验，直接委托 battle_entry_dispatch('ambush') 处理。
 * 突袭不创建先攻队列，直接动手打一次，由 battle_main 尾部的 battle_queue_check 后补票创建队列。
 *
 * 指令格式统一：只传 actions JSON 数组，突袭目标从 actions[0]['target'] 推导。
 *
 * @param array     &$pdata    玩家数据
 * @param array|null $actions   预装填动作数组，每项含 act_id + target。null 时为空（不执行动作）
 */
function cmd_handle_obl_battle_start(&$pdata, $actions = null) {
    if (!oblivions_is_active()) return;
    battle_entry_dispatch('ambush', $pdata, $actions);
}

/**
 * 玩家回合（已有先攻队列的情况下）
 *
 * 由前端在玩家选择动作后提交 obl_battle_action 命令时调用。
 * 直接委托 battle_entry_dispatch('player_turn') 处理。
 *
 * @param array     &$pdata    玩家数据
 * @param array|null $actions   预装填动作数组，每项含 act_id + target。提供时优先使用
 */
function cmd_handle_obl_battle_action(&$pdata, $actions = null) {
    if (!oblivions_is_active()) return;
    battle_entry_dispatch('player_turn', $pdata, $actions);
}