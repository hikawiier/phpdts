<?php
/**
 * @module C 核心运行时
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 数据库抓取系统 / Oblivions database fetching system
//
// 整合所有从数据库中fetch数据的函数，提供统一的接口。数据抓取函数负责从数据库中获取玩家数据、技能数据、先攻队列数据等，并进行必要的数据处理和格式化。
// ================================================================

function obl_fetch_queuedata_by_qid($qid)
{
    # 从数据库中获取先攻队列数据，输入先攻队列唯一索引qid，输出先攻队列数据；如果qid不存在，返回false
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " ");
    $qdata = $db->fetch_array($result);
    if (!$qdata) return false;
    return $qdata;
}

function obl_fetch_queue_all_by_qid($qid)
{
    # 获取某 qid 的所有参战者记录，按 myorder 升序排序（顺位高→低）
    # 输入先攻队列唯一索引 qid，输出参战者记录数组；如果 qid 不存在，返回空数组
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " ORDER BY myorder ASC");
    $rows = array();
    while ($row = $db->fetch_array($result)) {
        $rows[] = $row;
    }
    return $rows;
}

function obl_fetch_queue_pids_by_qid($qid)
{
    # 通过 qid 查找数据库中对应先攻队列，返回由所有 active=1 参战者 pid 构成的数组
    # 输入先攻队列唯一索引 qid，输出 pid 数组；如果 qid 不存在，返回空数组
    global $db, $tablepre;
    $result = $db->query("SELECT pid FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND active = 1");
    $pids = array();
    while ($row = $db->fetch_array($result)) {
        $pids[] = $row['pid'];
    }
    return $pids;
}

function obl_fetch_queue_by_pid($pid)
{
    # 获取某 pid 的队列记录（单行），如果该 pid 不在任何先攻队列中，返回 false
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE pid = " . (int)$pid . " LIMIT 1");
    $row = $db->fetch_array($result);
    if (!$row) return false;
    return $row;
}

function obl_fetch_queue_by_pid_for_update($pid) {
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE pid = " . (int)$pid . " LIMIT 1 FOR UPDATE");
    return $db->fetch_array($result);
}

function obl_fetch_queue_all_by_qid_for_update($qid): array {
    global $db, $tablepre;
    $rows = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " ORDER BY myorder ASC, pid ASC FOR UPDATE");
    while ($row = $db->fetch_array($result)) $rows[] = $row;
    return $rows;
}

function obl_fetch_queue_current_initiator($qid)
{
    # 获取当前顺位者：myorder 最小且 done=0、active=1 的参战者
    # 输入先攻队列唯一索引 qid，输出当前顺位者记录；如果队列不存在或所有人都已行动，返回 false
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND done = 0 AND active = 1 ORDER BY myorder ASC LIMIT 1");
    $row = $db->fetch_array($result);
    if (!$row) return false;
    return $row;
}

function obl_fetch_queue_undone_by_qid($qid)
{
    # 获取所有 done=0 且 active=1 的参战者记录，按 myorder 升序排序
    # 输入先攻队列唯一索引 qid，输出未行动参战者记录数组；如果都行动过，返回空数组
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND done = 0 AND active = 1 ORDER BY myorder ASC");
    $rows = array();
    while ($row = $db->fetch_array($result)) {
        $rows[] = $row;
    }
    return $rows;
}

function obl_fetch_queue_count_by_qid($qid)
{
    # 获取某 qid 的 active=1 参战者数量，输入先攻队列唯一索引 qid，输出整数
    global $db, $tablepre;
    $result = $db->query("SELECT COUNT(*) AS cnt FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND active = 1");
    $row = $db->fetch_array($result);
    return $row ? (int)$row['cnt'] : 0;
}

function obl_fetch_queue_has_player($qid)
{
    # 查队列中是否存在 type=0（玩家）且 active=1 的记录
    global $db, $tablepre;
    $result = $db->query("SELECT 1 FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND type = 0 AND active = 1 LIMIT 1");
    return $db->num_rows($result) > 0;
}

function obl_update_queue_done_and_last_acted($pid, $qid, $done, $myorder) {
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET done=" . (int)$done
        . ", last_acted=" . (int)$myorder
        . " WHERE pid=" . (int)$pid . " AND qid=" . (int)$qid);
}

function obl_update_queue_done($pid, $qid, $done)
{
    # 更新某 pid 在某 qid 的 done 标记，输入先攻队列唯一索引 qid，输出整数
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET done = " . (int)$done . " WHERE pid = " . (int)$pid . " AND qid = " . (int)$qid);
}

# ── 队列写操作 ──

function obl_queue_insert_entry($pid, $qid, $type, $myorder)
{
    global $db, $tablepre;
    $db->query("INSERT INTO {$tablepre}oblqueue (pid, qid, type, last_acted, myorder, done) VALUES (" . (int)$pid . ", " . (int)$qid . ", " . (int)$type . ", 0, " . (int)$myorder . ", 0)");
}

function obl_queue_delete_entry($pid, $qid)
{
    global $db, $tablepre;
    $db->query("DELETE FROM {$tablepre}oblqueue WHERE pid = " . (int)$pid . " AND qid = " . (int)$qid);
}

function obl_queue_delete_by_qid($qid)
{
    global $db, $tablepre;
    $db->query("DELETE FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid);
}

function obl_queue_delete_by_pid($pid)
{
    global $db, $tablepre;
    $db->query("DELETE FROM {$tablepre}oblqueue WHERE pid = " . (int)$pid);
}

function obl_queue_set_active($pid, $qid, $active)
{
    # 标记某 pid 在某 qid 的 active 状态（1=可参战，0=已退出），不删行不清 bid
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET active=" . (int)$active
        . " WHERE pid=" . (int)$pid . " AND qid=" . (int)$qid);
}

function obl_fetch_pids_by_bid($qid)
{
    # 扫玩家表，返回所有 bid 指向指定 qid 的 pid（兜底分支用：队列行已不存在时清理残留 bid）
    global $db, $tablepre;
    $result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE bid = " . (int)$qid);
    $pids = array();
    while ($row = $db->fetch_array($result)) {
        $pids[] = (int)$row['pid'];
    }
    return $pids;
}

function obl_player_set_bid($pid, $qid)
{
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblplayers SET bid = " . (int)$qid . " WHERE pid = " . (int)$pid);
}

function obl_player_set_bid_batch(array $pids, int $qid): void {
    if (empty($pids)) return;
    global $db, $tablepre;
    $ids = implode(',', array_map('intval', $pids));
    $qid = (int)$qid;
    $db->query("UPDATE {$tablepre}oblplayers SET bid = {$qid} WHERE pid IN ({$ids})");
}

function obl_queue_update_last_acted($pid, $qid, $myorder)
{
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET last_acted = " . (int)$myorder . " WHERE qid = " . (int)$qid . " AND pid = " . (int)$pid);
}

function obl_state_set_next_pid($qid, $pid)
{
    global $db, $tablepre;
    if ($qid <= 0) return;
    $db->query("UPDATE {$tablepre}oblbattle_state SET next_pid = " . (int)$pid . " WHERE qid = " . (int)$qid);
}

function obl_queue_next_qid()
{
    global $db, $tablepre;
    $result = $db->query("SELECT MAX(qid) AS max_qid FROM {$tablepre}oblqueue");
    $row = $db->fetch_array($result);
    return $row && $row['max_qid'] ? (int)$row['max_qid'] + 1 : 1;
}

function obl_queue_next_myorder($qid)
{
    global $db, $tablepre;
    $result = $db->query("SELECT MAX(myorder) AS max_myorder FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid);
    $row = $db->fetch_array($result);
    return $row && $row['max_myorder'] ? (int)$row['max_myorder'] + 1 : 1;
}

function obl_queue_update_myorder($pid, $qid, $myorder) {
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET myorder=" . (int)$myorder
        . " WHERE pid=" . (int)$pid . " AND qid=" . (int)$qid);
}

function obl_queue_reset_done_by_qid($qid) {
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET done=0 WHERE qid=" . (int)$qid);
}

// ── 状态机读写 ──

function obl_state_get($qid) {
    global $db, $tablepre;
    if ($qid <= 0) return 'IDLE';
    $result = $db->query("SELECT state FROM {$tablepre}oblbattle_state WHERE qid = " . (int)$qid);
    $row = $db->fetch_array($result);
    return $row ? $row['state'] : 'IDLE';
}

function obl_state_set($qid, $state) {
    global $db, $tablepre, $now;
    if (!isset($now)) $now = time();
    $db->query("UPDATE {$tablepre}oblbattle_state SET state = '" . addslashes($state) . "', updated_at = " . (int)$now . " WHERE qid = " . (int)$qid);
}

function obl_state_create($qid, $initial_state) {
    global $db, $tablepre, $now;
    if ($qid <= 0) return;
    if (!isset($now)) $now = time();
    $db->query("INSERT IGNORE INTO {$tablepre}oblbattle_state (qid, state, round_num, updated_at) VALUES ("
        . (int)$qid . ", '" . addslashes($initial_state) . "', 0, " . (int)$now . ")");
}

function obl_state_destroy($qid) {
    global $db, $tablepre;
    if ($qid <= 0) return;
    $db->query("DELETE FROM {$tablepre}oblbattle_state WHERE qid = " . (int)$qid);
}

function obl_state_get_all_active() {
    global $db, $tablepre;
    $result = $db->query("SELECT qid, state FROM {$tablepre}oblbattle_state WHERE state != 'IDLE'");
    $states = array();
    while ($row = $db->fetch_array($result)) {
        $states[(int)$row['qid']] = $row['state'];
    }
    return $states;
}

function obl_state_has_busy_battle() {
    global $db, $tablepre;
    $result = $db->query("SELECT 1 FROM {$tablepre}oblbattle_state WHERE state = 'PROCESSING' LIMIT 1");
    return (bool)$db->fetch_array($result);
}



function obl_state_find_stale($cutoff, $state) {
    global $db, $tablepre;
    $result = $db->query("SELECT qid FROM {$tablepre}oblbattle_state WHERE state = '" . addslashes($state) . "' AND updated_at < " . (int)$cutoff);
    $stale = array();
    while ($row = $db->fetch_array($result)) {
        $stale[] = (int)$row['qid'];
    }
    return $stale;
}
