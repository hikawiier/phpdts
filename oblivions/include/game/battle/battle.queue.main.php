<?php
/**
 * @module I 旧战斗队列系统
 * @framework I-1 先攻队列编排
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Shared combat infrastructure — 先攻队列编排层
//
// 职责：先攻队列的编排逻辑（setup/manage_queue/rebuild）。
// 依赖 battle.queue.func.php 中的原语函数。
//
// 说明：
// - `battle_manage_queue()` 仍是 new combat 的共享出口。
// - 这里不再代表旧 battle engine 主执行流程，而是队列/状态/AP 的共享编排层。
// ================================================================

/**
 * 先攻队列检查入口
 *
 * 从参战者地图 combatants_map 中过滤存活者（status=1），
 * 够数时返回 pids 数组，不够数返回 false。
 * 不执行队列创建——由 dispatch 根据返回值决定是否调 battle_queue_create_and_init。
 *
 * @param array  &$actor_data      发起者数据
 * @param array  &$obl_battle_log  战斗日志收集器
 * @param array   $combatants_map  参战者地图 [pid => 0|1]
 * @return array|false  存活者 pid 数组，不足 2 人时返回 false
 */
function battle_queue_setup(&$actor_data, &$obl_battle_log, $combatants_map)
{
    if (!empty($actor_data['bid'])) return false;

    $pids = [];
    foreach ($combatants_map as $pid => $status) {
        if ($status === 1) $pids[] = (int)$pid;
    }

    if (count($pids) < 2) return false;

    return $pids;
}

/**
 * 重建先攻队列
 *
 * 复用 qid，重置 done=0，重投先攻（ambush_pid=0，重建时无突袭）。
 * 不设 bid、不写战斗状态、不发射领域事件。
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

    // 重建时无突袭，ambush_pid = 0。
    $result = battle_queue_set_initiative($qid, $actor_data, $obl_battle_log, 0);

    if ($obl_battle_log) {
        $obl_battle_log->setPhase('queue_rebuild');
        $obl_battle_log->emit([
            'qid' => $qid,
        ], true);  // debug
    }

    return $result;
}

/**
 * 队列解散时统一清理所有参与者
 *
 * 遍历队列所有行（包括 active=0 已退出的），清空 bid + action + 恢复 AP + save。
 * actor_data 是引用传入，直接修改；其他人 fetch 后修改。
 *
 * @param int    $qid
 * @param array  &$actor_data   当前 actor（引用，直接修改）
 * @param array  &$obl_battle_log
 */
function battle_disband_cleanup_actor($qid, array &$data, $obl_battle_log = null): array {
    $data['bid'] = 0;
    $data['action'] = '';
    $data['ap'] = $data['max_ap'];
    $activated = skill_effect_activate_boundary(
        $data,
        'battle_disband',
        (int)$qid,
        function_exists('obl_tick_get') ? (int)obl_tick_get() : 0
    );
    if (!empty($activated) && function_exists('obl_authority_mark_actor_changed')) {
        obl_authority_mark_actor_changed($data, true);
    }
    obl_save_player($data);
    return $activated;
}

function battle_disband_cleanup($qid, &$actor_data, &$obl_battle_log): array {
    $activated = array();
    $queue_rows = obl_fetch_queue_all_by_qid($qid);
    foreach ($queue_rows as $r) {
        $pid = (int)$r['pid'];
        if ($pid === (int)$actor_data['pid']) {
            $activated = array_merge($activated, battle_disband_cleanup_actor($qid, $actor_data, $obl_battle_log));
            continue;
        }
        $c_data = obl_fetch_playerdata_by_pid($pid);
        if (!$c_data) continue;
        $activated = array_merge($activated, battle_disband_cleanup_actor($qid, $c_data, $obl_battle_log));

        if ($obl_battle_log) {
            $obl_battle_log->setPhase('disband_cleanup');
            $obl_battle_log->emit([
                'cleared_pid'  => $pid,
                'cleared_name' => $c_data['name'],
            ], true);  // debug
        }
    }
    return $activated;
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
    $result = [
        'ended' => false,
        'reason' => null,
        'rebuilt' => false,
        'next' => null,
        'queue_rows' => array(),
    ];

    $qid = (int)$actor_data['bid'];

    $obl_battle_log->setPhase('queue_check');

    // ── 一次性读取所有队列行 ──
    $queue_rows = obl_fetch_queue_all_by_qid($qid);
    if (empty($queue_rows)) {
        $result['ended'] = true;
        $result['reason'] = 'queue_empty';
        return $result;
    }
    $result['queue_rows'] = $queue_rows;

    // ── 从全量数据推导各派生值（基于 active=1 计数）──
    $active_count = 0;
    $has_player   = false;
    $actor_myorder = 0;

    foreach ($queue_rows as $r) {
        if ((int)$r['active'] === 1) {
            $active_count++;
            if ((int)$r['type'] === 0) $has_player = true;
        }
        if ((int)$r['pid'] === (int)$actor_data['pid']) {
            $actor_myorder = (int)$r['myorder'];
        }
    }

    // ── 从内存标记 actor 为 done（过滤 active=1）──
    $undone = array_values(array_filter($queue_rows, function($r) use ($actor_data) {
        return (int)$r['done'] === 0
            && (int)$r['active'] === 1
            && (int)$r['pid'] !== (int)$actor_data['pid'];
    }));

    // ── 1+4. 标记 done + 更新 last_acted（合并为一次 UPDATE） ──
    obl_update_queue_done_and_last_acted($actor_data['pid'], $qid, 1, $actor_myorder);

    // ── 2. 解散判定（基于 active=1 计数）──
    if ($active_count <= 1 || !$has_player) {
        $result['ended'] = true;
        $result['reason'] = 'disband';
        return $result;
    }

    // ── 3. 重建判定 ──
    if (empty($undone)) {
        battle_queue_rebuild($qid, $actor_data, $obl_battle_log);
        $result['rebuilt'] = true;

        // rebuild 后 myorder 和 done 都变了，重新加载（过滤 active=1）
        $queue_rows = obl_fetch_queue_all_by_qid($qid);
        $undone = [];
        foreach ($queue_rows as $r) {
            if ((int)$r['done'] === 0 && (int)$r['active'] === 1) $undone[] = $r;
        }
    }

    // ── 5. 只返回下一候选者；战斗状态由 E-5 统一推进 ──
    $next = $undone[0] ?? null;
    $result['next'] = $next;

    return $result;
}
