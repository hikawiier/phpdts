<?php
declare(strict_types=1);

define('IN_GAME', true);
define('GAME_ROOT', dirname(__DIR__, 2) . '/');
define('GAMENAME', 'bra');
define('CURSCRIPT', 'test');

require GAME_ROOT . 'config.inc.php';
require GAME_ROOT . 'gamedata/system.php';
require GAME_ROOT . 'include/db/db_' . $database . '.class.php';

$pconnect = false;
$db = new dbstuff();
$db->connect($dbhost, $dbuser, $dbpw, $dbname, 0);
$gtablepre = $tablepre;
$groomid = 0;
$gruleset = 'OBLIVIONS';
$now = time();
$gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
$gamestate = 20;
$GLOBALS['obl_db_throw_on_error'] = true;
$GLOBALS['obl_request_uid'] = 'test-' . bin2hex(random_bytes(6));

require_once GAME_ROOT . 'oblivions/include/core/obl_bootstrap.php';
require_once GAME_ROOT . 'oblivions/include/core/obl_runtime.php';
require_once GAME_ROOT . 'oblivions/include/command/obl_command_bus.php';
require_once __DIR__ . '/TestRoom.php';

final class TestFailure extends RuntimeException {}

function test_assert(bool $condition, string $message): void {
    if (!$condition) throw new TestFailure($message);
}

function test_same($expected, $actual, string $message): void {
    if ($expected !== $actual) {
        throw new TestFailure($message . ' expected=' . var_export($expected, true) . ' actual=' . var_export($actual, true));
    }
}

function test_event_types(BattleLogCollector $log): array {
    return array_values(array_map(static fn(array $entry): string => (string)($entry['event_type'] ?? ''), $log->getEntries()));
}

function test_run_cases(string $suite, array $cases): array {
    $results = [];
    foreach ($cases as $name => $case) {
        $started = microtime(true);
        try {
            $case();
            $results[] = ['suite' => $suite, 'name' => $name, 'ok' => true, 'ms' => (int)((microtime(true) - $started) * 1000)];
        } catch (Throwable $e) {
            $results[] = ['suite' => $suite, 'name' => $name, 'ok' => false, 'ms' => (int)((microtime(true) - $started) * 1000), 'error' => $e->getMessage()];
        }
    }
    return $results;
}
