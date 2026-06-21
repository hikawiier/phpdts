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
