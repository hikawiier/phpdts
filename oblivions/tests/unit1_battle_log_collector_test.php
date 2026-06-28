<?php
// 单元 1 验证脚本：BattleLogCollector 扩展
// 运行：php oblivions/tests/unit1_battle_log_collector_test.php

define('IN_GAME', true);
$GAME_ROOT = __DIR__ . '/../../';
require_once $GAME_ROOT . 'oblivions/include/game/battle_log.func.php';

$failures = [];
function assertEqual($actual, $expected, string $label): void {
    global $failures;
    if ($actual === $expected) {
        echo "[PASS] {$label}\n";
    } else {
        $failures[] = $label;
        $a = var_export($actual, true);
        $e = var_export($expected, true);
        echo "[FAIL] {$label}\n  expected: {$e}\n  actual:   {$a}\n";
    }
}
function assertNotEqual($actual, $forbidden, string $label): void {
    global $failures;
    if ($actual !== $forbidden) {
        echo "[PASS] {$label}\n";
    } else {
        $failures[] = $label;
        $a = var_export($actual, true);
        $f = var_export($forbidden, true);
        echo "[FAIL] {$label}\n  forbidden: {$f}\n  actual:    {$a}\n";
    }
}
function assertTrue($cond, string $label): void {
    global $failures;
    if ($cond) {
        echo "[PASS] {$label}\n";
    } else {
        $failures[] = $label;
        echo "[FAIL] {$label}\n";
    }
}

$log = new BattleLogCollector();

// ── 测试 1：默认状态（Phase 0）emit → bl_turn_num=null, bl_round_num=null ──
echo "\n=== 测试 1：默认状态 emit（Phase 0） ===\n";
$log->setPhase('once_execute_pre');
$log->emit([
    'actor_pid' => 19, 'actor_name' => 'Alice',
    'target_pid' => 20, 'target_name' => 'Bob',
    'action_id'  => 'unarmed_strike',
]);
$entries = $log->getEntries();
$e = $entries[0];
assertEqual($e['bl_turn_num'], null, '默认 bl_turn_num = null');
assertEqual($e['bl_round_num'], null, '默认 bl_round_num = null');
assertEqual($e['bl_segment_flag'], null, 'once_execute_pre 的 bl_segment_flag = null');
assertEqual($e['phase'], 'once_execute_pre', 'phase 字段保留');
assertEqual($e['actor_name'], 'Alice', 'actor_name 字段保留');
assertEqual($e['cleared_pid'], null, 'cleared_pid 默认 null');
assertEqual($e['ambusher_pid'], null, 'ambusher_pid 默认 null');

// ── 测试 2：nextTurn() 后 emit → bl_turn_num=1 ──
echo "\n=== 测试 2：nextTurn 后 emit ===\n";
$log->nextTurn();
$log->setPhase('ap_recover');
$log->emit(['actor_pid' => 19, 'actor_name' => 'Alice', 'effect_value' => 50]);
$entries = $log->getEntries();
$e = $entries[1];
assertEqual($e['bl_turn_num'], 1, 'nextTurn 后 bl_turn_num = 1');
assertEqual($e['bl_round_num'], null, '未 setRoundNum 时 bl_round_num = null');
assertEqual($e['bl_segment_flag'], 'turn_start', 'ap_recover 的 bl_segment_flag = turn_start');

// ── 测试 3：setRoundNum(0) 后 emit initiative_roll → bl_round_num=0, segment_flag=round_start ──
echo "\n=== 测试 3：setRoundNum(0) 后 emit initiative_roll ===\n";
$log->setRoundNum(0);
$log->setPhase('initiative_roll');
$log->emit(['qid' => 1, 'rolls' => [], 'ambush_pid' => 0]);
$entries = $log->getEntries();
$e = $entries[2];
assertEqual($e['bl_round_num'], 0, 'setRoundNum(0) 后 bl_round_num = 0');
assertEqual($e['bl_segment_flag'], 'round_start', 'initiative_roll 的 bl_segment_flag = round_start');

// ── 测试 4：setRoundNum(1) 模拟 rebuild 后 emit → bl_round_num=1 ──
echo "\n=== 测试 4：setRoundNum(1) 模拟 rebuild 后 ===\n";
$log->setRoundNum(1);
$log->setPhase('initiative_roll');
$log->emit(['qid' => 1, 'rolls' => [], 'ambush_pid' => 0]);
$entries = $log->getEntries();
$e = $entries[3];
assertEqual($e['bl_round_num'], 1, 'setRoundNum(1) 后 bl_round_num = 1');

// ── 测试 5：combatant_cleared phase → debug 默认 false, segment_flag=null ──
echo "\n=== 测试 5：combatant_cleared phase ===\n";
$log->setPhase('combatant_cleared');
$log->emit(['cleared_pid' => 20, 'reason' => 'death']);
$entries = $log->getEntries();
$e = $entries[4];
assertEqual($e['phase'], 'combatant_cleared', 'phase = combatant_cleared');
assertEqual($e['debug'], false, 'combatant_cleared 默认 debug = false');
assertEqual($e['bl_segment_flag'], null, 'combatant_cleared 的 bl_segment_flag = null');
assertEqual($e['cleared_pid'], 20, 'cleared_pid 字段正确');
assertEqual($e['winner_pid'], null, 'combatant_cleared 无 winner_pid');

// ── 测试 6：battle_end phase → segment_flag=battle_end ──
echo "\n=== 测试 6：battle_end phase ===\n";
$log->setPhase('battle_end');
$log->emit(['winner_pid' => 19, 'reason' => 'queue_empty']);
$entries = $log->getEntries();
$e = $entries[5];
assertEqual($e['bl_segment_flag'], 'battle_end', 'battle_end 的 bl_segment_flag = battle_end');
assertEqual($e['winner_pid'], 19, 'winner_pid 字段正确');
assertEqual($e['debug'], false, 'battle_end 默认 debug = false');

// ── 测试 7：ambush_battle_end phase → segment_flag=ambush_battle_end, debug=false ──
echo "\n=== 测试 7：ambush_battle_end phase ===\n";
$log->setPhase('ambush_battle_end');
$log->emit(['ambusher_pid' => 19, 'reason' => 'ambush_killed_all']);
$entries = $log->getEntries();
$e = $entries[6];
assertEqual($e['phase'], 'ambush_battle_end', 'phase = ambush_battle_end');
assertEqual($e['bl_segment_flag'], 'ambush_battle_end', 'ambush_battle_end 的 bl_segment_flag = ambush_battle_end');
assertEqual($e['ambusher_pid'], 19, 'ambusher_pid 字段正确');
assertEqual($e['winner_pid'], null, 'ambush_battle_end 无 winner_pid');
assertEqual($e['debug'], false, 'ambush_battle_end 默认 debug = false');

// ── 测试 8：main_end_cleanup 已从 phaseDebugDefault 移除 ──
echo "\n=== 测试 8：main_end_cleanup 已移除 ===\n";
$ref = new ReflectionClass('BattleLogCollector');
$prop = $ref->getProperty('phaseDebugDefault');
$defaults = $prop->getValue();
assertTrue(!array_key_exists('main_end_cleanup', $defaults), 'main_end_cleanup 已从 phaseDebugDefault 移除');
assertTrue(array_key_exists('combatant_cleared', $defaults), 'combatant_cleared 已加入 phaseDebugDefault');
assertTrue(array_key_exists('ambush_battle_end', $defaults), 'ambush_battle_end 已加入 phaseDebugDefault');

// ── 测试 9：phaseSegmentFlag 映射表完整 ──
echo "\n=== 测试 9：phaseSegmentFlag 映射表完整 ===\n";
$prop2 = $ref->getProperty('phaseSegmentFlag');
$flags = $prop2->getValue();
assertEqual($flags['initiative_roll'], 'round_start', 'initiative_roll → round_start');
assertEqual($flags['ap_recover'], 'turn_start', 'ap_recover → turn_start');
assertEqual($flags['battle_end'], 'battle_end', 'battle_end → battle_end');
assertEqual($flags['ambush_battle_end'], 'ambush_battle_end', 'ambush_battle_end → ambush_battle_end');
assertTrue(!array_key_exists('once_execute_pre', $flags), 'once_execute_pre 不在映射表（→null）');
assertTrue(!array_key_exists('combatant_cleared', $flags), 'combatant_cleared 不在映射表（→null）');

// ── 测试 10：未在 phaseDebugDefault 的 phase → debug 默认 true ──
echo "\n=== 测试 10：未知 phase 默认 debug=true ===\n";
$log->setPhase('some_unknown_phase');
$log->emit(['actor_pid' => 1]);
$entries = $log->getEntries();
assertEqual($entries[7]['debug'], true, '未知 phase 默认 debug = true');

// ── 总结 ──
echo "\n========================================\n";
if (empty($failures)) {
    echo "✅ 全部通过（" . count($entries) . " 条 emit 测试）\n";
    exit(0);
} else {
    echo "❌ 失败 " . count($failures) . " 项：\n";
    foreach ($failures as $f) echo "  - {$f}\n";
    exit(1);
}
