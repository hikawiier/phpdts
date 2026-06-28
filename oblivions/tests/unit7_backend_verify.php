<?php
// 单元 7 验证脚本：后端集成验证（检查 battle_main_end + ambush_battle_end emit 输出）
// 运行：php oblivions/tests/unit7_backend_verify.php

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

// ── 场景 A：模拟 battle_main_end 的 combatant_cleared 输出 ──
echo "\n=== 场景 A：combatant_cleared（模拟 battle_main_end 调用） ===\n";

// 模拟 death 场景
$log = new BattleLogCollector();
$reason = 'death';
$log->setPhase('combatant_cleared');
$log->emit([
    'cleared_pid' => 20,
    'reason'      => $reason,
], $reason === 'unknown');
$entries = $log->getEntries();
$e = $entries[0];

assertEqual($e['phase'], 'combatant_cleared', 'phase = combatant_cleared');
assertEqual($e['cleared_pid'], 20, 'cleared_pid = 20（death 场景）');
assertEqual($e['reason'], 'death', 'reason = death（原始值）');
assertEqual($e['winner_pid'], null, '无 winner_pid');
assertEqual($e['debug'], false, 'death 场景 debug = false');

// 模拟 escaped 场景
$log2 = new BattleLogCollector();
$reason2 = 'escaped';
$log2->setPhase('combatant_cleared');
$log2->emit([
    'cleared_pid' => 20,
    'reason'      => $reason2,
], $reason2 === 'unknown');
$e2 = $log2->getEntries()[0];
assertEqual($e2['reason'], 'escaped', 'reason = escaped（原始值）');
assertEqual($e2['debug'], false, 'escaped 场景 debug = false');

// 模拟 unknown 场景
$log3 = new BattleLogCollector();
$reason3 = 'unknown';
$log3->setPhase('combatant_cleared');
$log3->emit([
    'cleared_pid' => 20,
    'reason'      => $reason3,
], $reason3 === 'unknown');
$e3 = $log3->getEntries()[0];
assertEqual($e3['reason'], 'unknown', 'reason = unknown（原始值）');
assertEqual($e3['debug'], true, 'unknown 场景 debug = true');

// ── 场景 B：模拟 ambush_battle_end 输出 ──
echo "\n=== 场景 B：ambush_battle_end（模拟 battle.entry.php step 5a/5b 调用） ===\n";

// 模拟 step 5a：突袭者死亡
$log4 = new BattleLogCollector();
$log4->setPhase('ambush_battle_end');
$log4->emit([
    'ambusher_pid' => 19,
    'reason'       => 'ambush_dead',
]);
$e4 = $log4->getEntries()[0];
assertEqual($e4['phase'], 'ambush_battle_end', 'phase = ambush_battle_end');
assertEqual($e4['ambusher_pid'], 19, 'ambusher_pid = 19');
assertEqual($e4['reason'], 'ambush_dead', 'reason = ambush_dead');
assertEqual($e4['winner_pid'], null, '无 winner_pid');
assertEqual($e4['bl_segment_flag'], 'ambush_battle_end', 'bl_segment_flag = ambush_battle_end');
assertEqual($e4['debug'], false, 'ambush_battle_end 默认 debug = false');

// 模拟 step 5b：突袭者杀光所有敌人
$log5 = new BattleLogCollector();
$log5->setPhase('ambush_battle_end');
$log5->emit([
    'ambusher_pid' => 19,
    'reason'       => 'ambush_killed_all',
]);
$e5 = $log5->getEntries()[0];
assertEqual($e5['reason'], 'ambush_killed_all', 'reason = ambush_killed_all');

// ── 场景 C：标准 battle_end（battle_manage_queue 路径，检查 bl_* 字段） ──
echo "\n=== 场景 C：标准 battle_end（battle_manage_queue 路径） ===\n";
$log6 = new BattleLogCollector();
$log6->nextTurn();                // Turn 1
$log6->setRoundNum(0);            // Round 1
$log6->setPhase('battle_end');
$log6->emit([
    'winner_pid' => 19,
    'reason'     => 'queue_empty',
]);
$e6 = $log6->getEntries()[0];
assertEqual($e6['bl_turn_num'], 1, 'bl_turn_num = 1');
assertEqual($e6['bl_round_num'], 0, 'bl_round_num = 0');
assertEqual($e6['bl_segment_flag'], 'battle_end', 'bl_segment_flag = battle_end');
assertEqual($e6['winner_pid'], 19, 'winner_pid = 19');
assertEqual($e6['cleared_pid'], null, '标准 battle_end 无 cleared_pid');
assertEqual($e6['ambusher_pid'], null, '标准 battle_end 无 ambusher_pid');

// ── 场景 D：Phase 0 vs Phase 1 ──
echo "\n=== 场景 D：bl_turn_num/bl_round_num null 判定 ===\n";
$log7 = new BattleLogCollector();
// Phase 0：默认 turnNum=0, roundNum=null
$log7->setPhase('once_execute_pre');
$log7->emit(['actor_pid' => 19]);
$e7a = $log7->getEntries()[0];
assertEqual($e7a['bl_turn_num'], null, 'Phase 0 bl_turn_num = null');
assertEqual($e7a['bl_round_num'], null, 'Phase 0 bl_round_num = null');

// Phase 1：nextTurn + setRoundNum 后
$log7->nextTurn();
$log7->setRoundNum(0);
$log7->setPhase('once_execute_pre');
$log7->emit(['actor_pid' => 19]);
$e7b = $log7->getEntries()[1];
assertEqual($e7b['bl_turn_num'], 1, 'Phase 1 bl_turn_num = 1');
assertEqual($e7b['bl_round_num'], 0, 'Phase 1 bl_round_num = 0');

// ── 总结 ──
echo "\n========================================\n";
if (empty($failures)) {
    echo "✅ 全部通过\n";
    exit(0);
} else {
    echo "❌ 失败 " . count($failures) . " 项：\n";
    foreach ($failures as $f) echo "  - {$f}\n";
    exit(1);
}
