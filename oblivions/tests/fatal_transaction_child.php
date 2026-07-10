<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

if (count($argv) !== 5) {
    fwrite(STDERR, "usage: fatal_transaction_child.php <tablepre> <groomid> <pid> <result-file>\n");
    exit(2);
}

$tablepre = (string)$argv[1];
$groomid = (int)$argv[2];
$pid = (int)$argv[3];
$resultFile = (string)$argv[4];

$lockName = obl_runtime_acquire_room_lock(1);
if (!$lockName) {
    fwrite(STDERR, "failed to acquire test room lock\n");
    exit(3);
}
$GLOBALS['obl_runtime_lock_name'] = $lockName;

register_shutdown_function(static function () use ($pid, $resultFile): void {
    global $db, $tablepre, $groomid;
    $fatal = obl_runtime_shutdown_cleanup();
    $rowResult = $db->query("SELECT hp FROM {$tablepre}oblplayers WHERE pid=" . $pid);
    $row = $db->fetch_array($rowResult);
    $lockResult = $db->query("SELECT IS_FREE_LOCK('game_state_" . $groomid . "') AS free_lock");
    $lock = $db->fetch_array($lockResult);
    file_put_contents($resultFile, json_encode([
        'fatal_type' => is_array($fatal) ? (int)$fatal['type'] : 0,
        'transaction_active' => obl_runtime_transaction_is_active(),
        'hp' => (int)($row['hp'] ?? -1),
        'lock_free' => (int)($lock['free_lock'] ?? 0),
    ]));
});

obl_runtime_transaction_begin();
$db->query("UPDATE {$tablepre}oblplayers SET hp=1 WHERE pid=" . $pid);
trigger_error('intentional fatal transaction test', E_USER_ERROR);
