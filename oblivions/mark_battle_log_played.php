<?php
/**
 * 战斗日志标记接口（零依赖）
 *
 * 唯一职责：将指定 log_id 的 battlelog 条目标记为 played=1。
 *
 * 不依赖任何游戏框架文件（common.inc.php / player.func.php 等），
 * 只做文件读写操作。安全性靠 (int) 强制转换防路径遍历。
 *
 * 请求：POST，application/x-www-form-urlencoded
 *   - groomid: 房间 ID
 *   - pid: 玩家 ID
 *   - log_ids: 要标记的 log_id 数组（逗号分隔或数组形式）
 *
 * 响应：JSON
 *   - { "success": true, "marked": N }
 *   - { "success": false, "error": "..." }
 */

header('Content-Type: application/json');

// ── 参数读取 + (int) 强制转换（防路径遍历） ──
$groomid = isset($_POST['groomid']) ? (int)$_POST['groomid'] : 0;
$pid     = isset($_POST['pid'])     ? (int)$_POST['pid']     : 0;

if ($groomid <= 0 || $pid <= 0) {
    echo json_encode(array('success' => false, 'error' => 'invalid_params'));
    exit;
}

// log_ids 可以是数组或逗号分隔字符串
$log_ids = array();
if (isset($_POST['log_ids'])) {
    if (is_array($_POST['log_ids'])) {
        foreach ($_POST['log_ids'] as $lid) {
            $log_ids[] = (int)$lid;
        }
    } else {
        $raw = explode(',', $_POST['log_ids']);
        foreach ($raw as $lid) {
            $lid = (int)trim($lid);
            if ($lid > 0) $log_ids[] = $lid;
        }
    }
}

if (empty($log_ids)) {
    echo json_encode(array('success' => true, 'marked' => 0));
    exit;
}

// ── 文件路径（(int) 转换后的值拼路径，安全） ──
// 路径与 battle_log.func.php 中 obl_battle_log_persist 保持一致
// 目录由 obl_battle_log_persist 首次写入时创建，此处不负责 mkdir
$log_file = __DIR__ . '/cache/battles/obl_battle_log_' . $groomid . '_' . $pid . '.json';

if (!file_exists($log_file)) {
    echo json_encode(array('success' => true, 'marked' => 0));
    exit;
}

// ── 读取 + 标记 + 写回（LOCK_EX 防并发） ──
$raw = file_get_contents($log_file);
$entries = json_decode($raw, true);
if (!is_array($entries)) {
    echo json_encode(array('success' => false, 'error' => 'invalid_json'));
    exit;
}

$log_ids_map = array();
foreach ($log_ids as $lid) {
    $log_ids_map[$lid] = true;
}

$marked = 0;
foreach ($entries as &$e) {
    if (!empty($e['log_id']) && isset($log_ids_map[(int)$e['log_id']])) {
        if (empty($e['played']) || (int)$e['played'] === 0) {
            $e['played'] = 1;
            $marked++;
        }
    }
}
unset($e);

if ($marked > 0) {
    file_put_contents($log_file, json_encode($entries, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

echo json_encode(array('success' => true, 'marked' => $marked));
