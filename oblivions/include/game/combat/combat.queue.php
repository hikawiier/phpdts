<?php
/**
 * @module D 战斗系统（Combat）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 先攻队列管理（适配层）
//
// 职责：转调 battle_queue_* 原语，提供新系统命名空间。
//   - combat_queue_create_and_init():  建队列 + 排先攻（共享函数内部已建状态机）
//   - combat_queue_advance():          推进到下一顺位（标当前顺位者 done=1）
//   - combat_queue_exit():             退出队列（标 active=0，不删行不清 bid）
//   - combat_queue_disband():          解散队列（删行 + 清 bid，状态机由 manage_queue 处理）
//   - combat_queue_get_next_actor():   取下一行动者 pid
//
// 策略 B 核心设计（spec §与 tick 系统的集成）：
//   - 新系统**不重写** battle_manage_queue，直接调用它。
//   - 权威回合状态由 E-5 battle_turn 编排器统一管理
//     全部由 battle_manage_queue 内部自动处理。
//   - 新系统**不直接调** obl_battle_state_* 函数（spec §1 不可违反约束）。
//
// 与 shared battle/ 层边界：完全复用 battle.queue.* 原语，仅做命名空间隔离。
//   共享函数签名（battle.queue.func.php）：
//     battle_queue_create_and_init(&$actor_data, array $pids, &$obl_battle_log): int
//     battle_queue_exit(&$actor_data, &$obl_battle_log, &$battle_cache)
// ================================================================

/**
 * 创建先攻队列并投先攻
 *
 * 转调 battle_queue_create_and_init。旧函数内部已完成：
 *   - batch fetch playerdata → 算先攻 → INSERT（带 myorder）→ 设 bid
 *   - obl_battle_state_create($qid, OBL_BS_IDLE) 建立战场记录
 *   - emit v2 `round_start` render 事件
 * 新函数无需独立调状态机创建。
 *
 * @param array &$actor_data 发起者数据
 * @param array $pids        参战者 PID 数组
 * @param mixed $log         BattleLogCollector
 * @return int qid（失败返回 0）
 */
function combat_queue_create_and_init(array &$actor_data, array $pids, $log): int {
    return battle_queue_create_and_init($actor_data, $pids, $log);
}

/**
 * 推进到下一顺位
 *
 * 旧系统无直接对应原语（推进逻辑内联在 battle_manage_queue 内）。
 * 本函数提供原子推进：标当前顺位者（done=0, active=1, myorder 最小）为 done=1。
 *
 * 注意：本函数**不**做状态机转换、AP 恢复、round 计数——这些由 battle_manage_queue 接管。
 * 通常场景下新系统直接调 battle_manage_queue 即可完成推进 + 收尾；
 * 本函数仅用于需要手动推进顺位而不触发完整 manage_queue 流程的场景。
 *
 * @param int $qid
 */
function combat_queue_advance(int $qid): void {
    if ($qid <= 0) return;
    $current = obl_fetch_queue_current_initiator($qid);
    if (!$current) return;
    obl_update_queue_done((int)$current['pid'], $qid, 1);
}

/**
 * 退出队列（标 active=0，不删行不清 bid）
 *
 * 转调 battle_queue_exit。bid 保留由队列解散时统一清理（battle_disband_cleanup）。
 *
 * @param array &$actor_data 退出者数据
 * @param mixed $log         BattleLogCollector
 * @param array &$battle_cache
 */
function combat_queue_exit(array &$actor_data, $log, array &$battle_cache): void {
    battle_queue_exit($actor_data, $log, $battle_cache);
}

/**
 * 解散队列
 *
 * 旧系统无直接对应原语（解散逻辑内联在 battle_manage_queue 的 disband 分支）。
 * 本函数提供原子解散：
 *   - 删除队列所有行（obl_queue_delete_by_qid）
 *   - 清理所有 bid 指向此 qid 的玩家 bid（obl_player_set_bid(pid, 0)）
 *
 * 注意：本函数不关闭权威回合。生产流程必须由 battle_turn_complete_and_open_next
 * 统一收尾；直接调用仅适用于明确不处于活动回合的维护路径。
 *
 * @param int $qid
 */
function combat_queue_disband(int $qid): void {
    if ($qid <= 0) return;

    $pids = array();
    foreach (obl_fetch_queue_all_by_qid($qid) as $row) $pids[(int)$row['pid']] = true;
    foreach (obl_fetch_pids_by_bid($qid) as $pid) $pids[(int)$pid] = true;
    foreach (array_keys($pids) as $pid) {
        $data = obl_fetch_playerdata_by_pid((int)$pid);
        if (!$data) continue;
        battle_disband_cleanup_actor($qid, $data, null);
    }

    // 删除队列所有行
    obl_queue_delete_by_qid($qid);
}

/**
 * 取下一行动者 pid
 *
 * 返回当前顺位者（done=0, active=1, myorder 最小）的 pid。
 * 无下一行动者时返回 0。
 *
 * @param int $qid
 * @return int
 */
function combat_queue_get_next_actor(int $qid): int {
    if ($qid <= 0) return 0;
    $current = obl_fetch_queue_current_initiator($qid);
    if (!$current) return 0;
    return (int)$current['pid'];
}
