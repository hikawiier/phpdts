<?php
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
    # 通过 qid 查找数据库中对应先攻队列，返回由所有参战者 pid 构成的数组
    # 输入先攻队列唯一索引 qid，输出 pid 数组；如果 qid 不存在，返回空数组
    global $db, $tablepre;
    $result = $db->query("SELECT pid FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid);
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

function obl_fetch_queue_current_initiator($qid)
{
    # 获取当前顺位者：myorder 最小且 done=0 的参战者
    # 输入先攻队列唯一索引 qid，输出当前顺位者记录；如果队列不存在或所有人都已行动，返回 false
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND done = 0 ORDER BY myorder ASC LIMIT 1");
    $row = $db->fetch_array($result);
    if (!$row) return false;
    return $row;
}

function obl_fetch_queue_undone_by_qid($qid)
{
    # 获取所有 done=0 的参战者记录，按 myorder 升序排序
    # 输入先攻队列唯一索引 qid，输出未行动参战者记录数组；如果都行动过，返回空数组
    global $db, $tablepre;
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " AND done = 0 ORDER BY myorder ASC");
    $rows = array();
    while ($row = $db->fetch_array($result)) {
        $rows[] = $row;
    }
    return $rows;
}

function obl_fetch_queue_count_by_qid($qid)
{
    # 获取某 qid 的参战者数量，输入先攻队列唯一索引 qid，输出整数
    global $db, $tablepre;
    $result = $db->query("SELECT COUNT(*) AS cnt FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid);
    $row = $db->fetch_array($result);
    return $row ? (int)$row['cnt'] : 0;
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
    $db->query("INSERT INTO {$tablepre}oblqueue (pid, qid, type, qorder, myorder, done) VALUES (" . (int)$pid . ", " . (int)$qid . ", " . (int)$type . ", 0, " . (int)$myorder . ", 0)");
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

function obl_player_set_bid($pid, $qid)
{
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblplayers SET bid = " . (int)$qid . " WHERE pid = " . (int)$pid);
}

function obl_queue_update_qorder($pid, $qid, $qorder)
{
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblqueue SET qorder = " . (int)$qorder . " WHERE qid = " . (int)$qid . " AND pid = " . (int)$pid);
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
    $db->query("INSERT IGNORE INTO {$tablepre}oblbattle_state (qid, state, turn, updated_at) VALUES ("
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

function obl_state_has_npc_acting() {
    global $db, $tablepre;
    $result = $db->query("SELECT 1 FROM {$tablepre}oblbattle_state WHERE state = 'NPC_ACTING' LIMIT 1");
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
