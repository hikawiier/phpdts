<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 先攻队列编排层
//
// 职责：先攻队列的编排逻辑（setup/manage_queue/rebuild）。
// 依赖 battle.queue.func.php 中的原语函数。
// ================================================================

/**
 * 先攻队列创建入口
 *
 * 从参战者地图 combatants_map 中过滤存活者，调 battle_queue_create_and_init
 * 一次完成建队列+投先攻。ambush_flag 的消费内化在 create_and_init 中。
 *
 * @param array  &$actor_data      发起者数据
 * @param array  &$obl_battle_log  战斗日志收集器
 * @param array   $combatants_map  参战者地图 [pid => 0|1]
 * @return bool  队列是否创建成功
 */
function battle_queue_setup(&$actor_data, &$obl_battle_log, $combatants_map): bool
{
    if (!empty($actor_data['bid'])) return false;

    $pids = [];
    foreach ($combatants_map as $pid => $status) {
        if ($status === 1) $pids[] = (int)$pid;
    }

    if (count($pids) < 2) return false;

    return battle_queue_create_and_init($actor_data, $pids, $obl_battle_log) > 0;
}

/**
 * 重建先攻队列
 *
 * 复用 qid，重置 done=0，重投先攻（ambush_pid=0，重建时无突袭）。
 * 不设 bid，不建状态机（bid 已存在，状态机已在创建时建立）。
 *
 * @param int    $qid             队列编号
 * @param array  &$actor_data     发起者数据（用于日志记录）
 * @param array  &$obl_battle_log 战斗日志收集器
 * @return array  排序后的先攻顺位数组
 */
function battle_queue_rebuild($qid, &$actor_data, &$obl_battle_log): array
{
    $qid = (int)$qid;
    if ($qid <= 0) return [];

    obl_queue_reset_done_by_qid($qid);

    // 重建时无突袭，ambush_pid = 0
    $result = battle_queue_set_initiative($qid, $actor_data, $obl_battle_log, 0);

    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'queue_rebuild',
            'extra'       => ['qid' => $qid],
        ]);
    }

    return $result;
}

/**
 * 队列管理主函数
 *
 * 优化版：一次性 SELECT 全量队列行，所有派生值从内存数组推导，
 * 消除 4 次冗余 SELECT（count/has_player/undone/by_pid/current_initiator）。
 * 步骤 1+4 的 UPDATE done + last_acted 合并为一次写入。
 *
 * @return array ['disbanded' => bool, 'rebuilt' => bool, 'next' => array|null]
 */
function battle_manage_queue(&$actor_data, &$obl_battle_log, &$battle_cache): array
{
    $result = ['disbanded' => false, 'rebuilt' => false, 'next' => null];

    $qid = (int)$actor_data['bid'];

    $obl_battle_log->setPhase('queue_check');

    // ── 一次性读取所有队列行 ──
    $queue_rows = obl_fetch_queue_all_by_qid($qid);
    if (empty($queue_rows)) {
        $actor_data['bid'] = 0;
        battle_state_clear($actor_data, $obl_battle_log, $battle_cache);
        $result['disbanded'] = true;
        return $result;
    }

    // ── 从全量数据推导各派生值 ──
    $count = count($queue_rows);
    $has_player = false;
    $actor_myorder = 0;

    foreach ($queue_rows as $r) {
        if ((int)$r['type'] === 0) $has_player = true;
        if ((int)$r['pid'] === (int)$actor_data['pid']) {
            $actor_myorder = (int)$r['myorder'];
        }
    }

    // ── 从内存标记 actor 为 done ──
    $undone = array_values(array_filter($queue_rows, function($r) use ($actor_data) {
        return (int)$r['done'] === 0 && (int)$r['pid'] !== (int)$actor_data['pid'];
    }));

    // ── 1+4. 标记 done + 更新 last_acted（合并为一次 UPDATE） ──
    obl_update_queue_done_and_last_acted($actor_data['pid'], $qid, 1, $actor_myorder);

    // ── 2. 解散判定 ──
    if ($count <= 1 || !$has_player) {
        obl_queue_delete_by_qid($qid);
        obl_battle_state_transition($qid, 'battle_end');
        obl_battle_state_destroy($qid);
        $actor_data['bid'] = 0;
        battle_state_clear($actor_data, $obl_battle_log, $battle_cache);
        $result['disbanded'] = true;
        return $result;
    }

    // ── 3. 重建判定 ──
    if (empty($undone)) {
        battle_queue_rebuild($qid, $actor_data, $obl_battle_log);
        $result['rebuilt'] = true;

        // rebuild 后 myorder 和 done 都变了，重新加载
        $queue_rows = obl_fetch_queue_all_by_qid($qid);
        $undone = [];
        foreach ($queue_rows as $r) {
            if ((int)$r['done'] === 0) $undone[] = $r;
        }
    }

    // ── 5. 确定下一顺位 + 状态转换 ──
    $next = $undone[0] ?? null;
    $result['next'] = $next;
    obl_battle_state_set_next_pid($qid, $next ? (int)$next['pid'] : 0);
    if ($next) {
        if ((int)$next['type'] == 0) {
            obl_battle_state_transition($qid, 'player_turn');
        } else {
            obl_battle_state_refresh($qid);
        }
    }

    // ── 6. 下一轮准备 ──
    $obl_battle_log->setPhase('prepare');
    battle_ap_recover($actor_data, $battle_cache, $obl_battle_log);
    obl_save_player($actor_data);

    return $result;
}
