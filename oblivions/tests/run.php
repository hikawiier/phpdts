<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$room = new TestRoom();
$results = [];
$exit = 0;
try {
    $room->create();
    foreach (['range_test.php', 'equipment_skill_test.php', 'skill_effect_test.php', 'domain_test.php', 'battle_integration_test.php', 'battle_turn_test.php', 'transaction_integration_test.php', 'navigation_contract_test.php', 'info_acquire_test.php', 'navigation_integration_test.php', 'info_framework_test.php', 'navigation_tick_test.php', 'target_resolution_test.php', 'combat_boundary_test.php', 'move_types_test.php', 'debug_console_test.php'] as $file) {
        $path = __DIR__ . '/' . $file;
        if (!file_exists($path)) continue;
        $suite = require $path;
        $results = array_merge($results, $suite($room));
    }
} catch (Throwable $e) {
    $results[] = ['suite' => 'bootstrap', 'name' => 'test_room', 'ok' => false, 'ms' => 0, 'error' => $e->getMessage()];
} finally {
    try { $room->cleanup(); } catch (Throwable $cleanupError) {
        $results[] = ['suite' => 'bootstrap', 'name' => 'cleanup', 'ok' => false, 'ms' => 0, 'error' => $cleanupError->getMessage()];
    }
}

foreach ($results as $result) {
    $status = $result['ok'] ? 'PASS' : 'FAIL';
    echo sprintf("[%s] %s::%s (%d ms)%s\n", $status, $result['suite'], $result['name'], $result['ms'], $result['ok'] ? '' : ' - ' . $result['error']);
    if (!$result['ok']) $exit = 1;
}
$passed = count(array_filter($results, static fn(array $r): bool => !empty($r['ok'])));
echo sprintf("\n%d/%d tests passed\n", $passed, count($results));
exit($exit);

