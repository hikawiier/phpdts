<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 战斗状态管理
//
// 职责：combatants/死亡/逃离，复用 battle_cache 内存结构。
//   - combat_state_init():          受击目标进入战斗状态
//   - combat_state_mark_dead():     标记死亡（写 combatants + tag_mutations.dead）
//   - combat_state_mark_escaped():  标记逃离（写 combatants + tag_mutations.escaped）
//   - combat_state_post_check():    attack 管道专有，伤害结算后三分支死亡检测
//   - combat_state_clear():         清理退出者（死亡/逃离后调用，退队列 + 恢复 AP + save）
//   - combat_state_check_end():     检查战斗是否结束（存活数 ≤ 1）
//
// 内存结构（复用旧系统 battle_cache）：
//   - $battle_cache['combatants'][pid] = 1|0  （1=存活, 0=退出）
//   - $battle_cache['tag_mutations'][pid] = ['dead'=>bool, 'escaped'=>bool, 'hidden'=>bool]
//
// 与旧系统边界：复用 battle_cache 数据结构，不重写状态存储。
//   旧系统状态操作散落在 battle.func.php，新系统集中到本文件。
//   combat_state_clear 转调 battle_queue_exit + obl_save_player（保存内存引用）。
// ================================================================

/**
 * 受击目标进入战斗状态
 *
 * @param array $target_data
 * @param array &$battle_cache
 */
function combat_state_init(array $target_data, array &$battle_cache): void {
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return;
    $battle_cache['combatants'][$pid] = 1;
}

/**
 * 标记死亡
 *
 * 写 combatants[pid]=0 + tag_mutations[pid]['dead']=true。
 *
 * @param int   $pid
 * @param array &$battle_cache
 */
function combat_state_mark_dead(int $pid, array &$battle_cache): void {
    if ($pid <= 0) return;
    $battle_cache['combatants'][$pid] = 0;
    if (!isset($battle_cache['tag_mutations'][$pid])) {
        $battle_cache['tag_mutations'][$pid] = ['dead' => false, 'escaped' => false, 'hidden' => false];
    }
    $battle_cache['tag_mutations'][$pid]['dead'] = true;
}

/**
 * 标记逃离
 *
 * 写 combatants[pid]=0 + tag_mutations[pid]['escaped']=true。
 *
 * @param int   $pid
 * @param array &$battle_cache
 */
function combat_state_mark_escaped(int $pid, array &$battle_cache): void {
    if ($pid <= 0) return;
    $battle_cache['combatants'][$pid] = 0;
    if (!isset($battle_cache['tag_mutations'][$pid])) {
        $battle_cache['tag_mutations'][$pid] = ['dead' => false, 'escaped' => false, 'hidden' => false];
    }
    $battle_cache['tag_mutations'][$pid]['escaped'] = true;
}

/**
 * 记录 actor 已退出战斗、但整场战斗尚未完成世界交接。
 *
 * 恢复 tick 不能在逃跑当刻计算：actor 可能提前退出，而战斗继续多个 tick。
 * 这里只保存领域事实，等 qid 真正解散时再锚定首个 post-battle frame。
 */
function combat_state_mark_post_battle_handoff_pending(array &$actor_data): void {
    if (!isset($actor_data['oblpara']) || !is_array($actor_data['oblpara'])) {
        $actor_data['oblpara'] = array();
    }
    $actor_data['oblpara']['post_combat_handoff_pending'] = true;
    unset($actor_data['oblpara']['world_ai_resume_tick']);
}

/**
 * 在战场真正解散时激活 actor 级 world-AI 恢复边界。
 */
function combat_state_activate_post_battle_handoff(array &$actor_data): void {
    if (empty($actor_data['oblpara']['post_combat_handoff_pending'])) return;
    unset($actor_data['oblpara']['post_combat_handoff_pending']);
    $actor_data['oblpara']['world_ai_resume_tick'] = function_exists('obl_tick_get')
        ? obl_tick_get() + 1
        : 1;
}

/**
 * attack 管道专有：伤害结算后写缓存（per-target）
 *
 * 三分支逻辑（spec §Queue/State）：
 *   - 已有 escaped mutation → combatants[pid]=0，不改 dead
 *   - hp>0 且 state!=1 → combatants[pid]=1
 *   - 死亡（hp<=0 或 state==1）→ combatants[pid]=0 + tag_mutations[pid]['dead']=true
 *
 * hp/state 从 $ctx->getCurrentTarget()['target_data'] 读取（effect 应用器已修改）。
 * tile 目标 pid=0 无 mutation，直接跳过。
 *
 * @param CombatContext $ctx
 */
function combat_state_post_check(CombatContext $ctx): void {
    $target = &$ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return;

    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return;

    $hp = (int)($target_data['hp'] ?? 0);
    $state = (int)($target_data['state'] ?? 0);
    combat_state_apply_death_check($pid, $hp, $state, $ctx->battle_cache);
}

/**
 * 清理退出者（死亡/逃离后调用）
 *
 * 流程：
 *   - 二次调用保护：action 为空时直接返回
 *   - reason='dead' → state=1；reason='escaped' → state=0（逃离只在本场 battle_cache 中表示）
 *   - 清 action
 *   - 退队列：battle_queue_exit（标 active=0，不删行不清 bid）
 *   - 恢复 AP：ap = max_ap
 *   - 保存：obl_save_player($actor_data)（保存内存引用，禁止重新 fetch，spec §4）
 *
 * @param int    $pid         退出者 pid（用于校验/日志）
 * @param string $reason      退出原因（'dead' / 'escaped' / 其他）
 * @param array  &$actor_data 退出者数据（引用，直接修改）
 * @param array  &$battle_cache
 * @param mixed  $log         BattleLogCollector
 */
function combat_state_clear(int $pid, string $reason, array &$actor_data, array &$battle_cache, $log): void {
    if (empty($actor_data['action'])) {
        return;
    }

    if ($reason === 'dead') {
        $actor_data['state'] = 1;
    } elseif ($reason === 'escaped') {
        $actor_data['state'] = 0;
        combat_state_mark_post_battle_handoff_pending($actor_data);
    }

    $actor_data['action'] = '';

    if (!empty($actor_data['bid'])) {
        battle_queue_exit($actor_data, $log, $battle_cache);
    } elseif ($reason === 'escaped') {
        // 无 qid 表示此处本身就是最终退出边界。
        combat_state_activate_post_battle_handoff($actor_data);
    }

    $actor_data['ap'] = $actor_data['max_ap'];
    obl_save_player($actor_data);
}

/**
 * 检查战斗是否结束（存活数 ≤ 1）
 *
 * @param array $battle_cache
 * @return bool
 */
function combat_state_check_end(array $battle_cache): bool {
    $combatants = $battle_cache['combatants'] ?? [];
    $alive = 0;
    foreach ($combatants as $pid => $status) {
        if ((int)$status === 1) $alive++;
    }
    return $alive <= 1;
}

// ================================================================
// 内部辅助函数
// ================================================================

/**
 * 死亡检测三分支逻辑（纯写 battle_cache）
 *
 * 由 combat_state_post_check 和 combat_state_check_pid_in_memory 共用。
 *
 * @param int   $pid
 * @param int   $hp
 * @param int   $state
 * @param array &$battle_cache
 */
function combat_state_apply_death_check(int $pid, int $hp, int $state, array &$battle_cache): void {
    if ($pid <= 0) return;

    $mutations = $battle_cache['tag_mutations'][$pid] ?? [];

    // 分支 1：已有 escaped mutation → combatants=0，不改 dead
    if (!empty($mutations['escaped'])) {
        $battle_cache['combatants'][$pid] = 0;
        return;
    }

    // 分支 2：hp>0 且 state!=1 → combatants=1
    if ($hp > 0 && $state !== 1) {
        $battle_cache['combatants'][$pid] = 1;
        return;
    }

    // 分支 3：死亡（hp<=0 或 state==1）→ combatants=0 + dead=true
    $battle_cache['combatants'][$pid] = 0;
    if (!isset($battle_cache['tag_mutations'][$pid])) {
        $battle_cache['tag_mutations'][$pid] = ['dead' => false, 'escaped' => false, 'hidden' => false];
    }
    $battle_cache['tag_mutations'][$pid]['dead'] = true;
}

/**
 * 对指定 pid 应用死亡检测（从内存中查找数据）
 *
 * 在 $ctx->actor_data 和 $ctx->targets 中按 pid 查找 target_data，找到则
 * 应用三分支逻辑。未找到则跳过（遵守 spec §4 no-fetch 约束）。
 *
 * 用于 post_check 阶段遍历 effects/applied_reacts 的 target_pid 时，
 * 对不在 current_target 中的 pid 做死亡检测。
 *
 * @param CombatContext $ctx
 * @param int           $pid
 */
function combat_state_check_pid_in_memory(CombatContext $ctx, int $pid): void {
    if ($pid <= 0) return;

    // 先检查 actor_data
    if ((int)($ctx->actor_data['pid'] ?? 0) === $pid) {
        combat_state_apply_death_check(
            $pid,
            (int)($ctx->actor_data['hp'] ?? 0),
            (int)($ctx->actor_data['state'] ?? 0),
            $ctx->battle_cache
        );
        return;
    }

    // 检查 targets
    foreach ($ctx->targets as $target) {
        $target_data = $target['target_data'] ?? null;
        if (!is_array($target_data)) continue;
        if ((int)($target_data['pid'] ?? 0) === $pid) {
            combat_state_apply_death_check(
                $pid,
                (int)($target_data['hp'] ?? 0),
                (int)($target_data['state'] ?? 0),
                $ctx->battle_cache
            );
            return;
        }

        foreach (($target['effect_targets'] ?? []) as $effect_target) {
            if (!is_array($effect_target)) continue;
            if ((int)($effect_target['pid'] ?? 0) !== $pid) continue;

            combat_state_apply_death_check(
                $pid,
                (int)($effect_target['hp'] ?? 0),
                (int)($effect_target['state'] ?? 0),
                $ctx->battle_cache
            );
            return;
        }
    }
    // 未在内存中找到，跳过（no-fetch 约束）
}
