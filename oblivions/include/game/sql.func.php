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
    global $db, $tablepre;
    # 从数据库中获取先攻队列数据，输入先攻队列唯一索引qid，输出先攻队列数据；如果qid不存在，返回false
    $result = $db->query("SELECT * FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid . " ");
    $qdata = $db->fetch_array($result);
    if (!$qdata) return false;
    return $qdata;
}
