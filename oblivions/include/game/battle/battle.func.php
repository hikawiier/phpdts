<?php
/**
 * @module I 旧战斗队列系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Shared combat infrastructure — 轻量状态 / AP恢复 / turn hook
//
// 说明：
// - 旧 battle engine 的主执行链已下线，但本文件不是死代码。
// - 当前仍由 new combat / queue 层复用：
//   - 轻量 action= battle/'' 切换
//   - AP 恢复
//   - actor 可行动检查
//   - turn 生命周期 hook
// - Tag 系统、射程/距离检查、旧 damage 应用已迁移至 combat/（2026-07-11 清理）
//
// 已被 combat/ 替代的职责：
//   - `battle_state_clear` 的主要退出清理由 `combat_state_clear` 接管
//   - `battle_state_init` 的完整语义由 `combat_start_battle` / `combat_dispatch` 驱动
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';

function battle_state_init(&$actor_data)
{
    # 进入战斗，初始化参战者的战斗状态
    $actor_data['action'] = 'battle';
}


function battle_state_clear(&$actor_data, &$obl_battle_log, &$battle_cache, $reason = 'unknown')
{
    # 二次调用保护：只检查 action（bid 保留不代表在战斗中）
    if (empty($actor_data['action'])) {
        return;
    }

    # ── reason 相关处理 ──
    if ($reason === 'death') {
        $actor_data['state'] = $actor_data['state'] ?: 1;
    }

    # ── 清空战斗状态 ──
    $actor_data['action'] = '';
    # 标记队列行 active=0（不删行、不清 bid，bid 由队列解散时统一清理）
    if(!empty($actor_data['bid']))
    {
        battle_queue_exit($actor_data,$obl_battle_log,$battle_cache);
    }
    # 恢复AP
    $actor_data['ap'] = $actor_data['max_ap'];
    obl_save_player($actor_data);
}








function battle_ap_recover(&$actor_data, &$battle_cache, &$obl_battle_log)
{
    #AP恢复函数：每个 turn 开始时（combat_dispatch 入口），当前 actor 恢复 AP，恢复量为当前AP+AP上限，不会超过AP上限
    #设计案：oblivions/docs/turn_start发送时机修复-2026-07-14.md
    $old_ap = (int)$actor_data['ap'];
    $max_ap = (int)$actor_data['max_ap'];
    $actor_data['ap'] = min($old_ap + $max_ap, $max_ap);
    $recovered = $actor_data['ap'] - $old_ap;

    if ($obl_battle_log && function_exists('combat_log_v2_turn_start')) {
        combat_log_v2_turn_start($obl_battle_log, $actor_data, $recovered);
    }
}

// ================================================================
// Actor 行动资格检查 / Actor can-act check
// ================================================================

/**
 * 检查 actor 当前是否能行动（state>0 或 hp<=0 视为不能行动）
 *
 * 独立于调用方，失败时 emit 失败原因。
 *
 * @param array               &$actor_data
 * @param BattleLogCollector|null &$obl_battle_log
 * @return bool
 */
function battle_actor_can_act(&$actor_data, &$obl_battle_log, &$battle_cache = null): bool {
    $dead = false;
    if ((int)$actor_data['state'] > 0) {
        if ($obl_battle_log) {
            $obl_battle_log->setPhase('actor_state_check');
            $obl_battle_log->emit([
                'actor_pid' => (int)$actor_data['pid'],
                'reason'    => 'actor_dead',
            ], true);  // debug
        }
        $dead = true;
    }
    if ((int)$actor_data['hp'] <= 0) {
        if ($obl_battle_log) {
            $obl_battle_log->setPhase('actor_state_check');
            $obl_battle_log->emit([
                'actor_pid' => (int)$actor_data['pid'],
                'reason'    => 'actor_hp_zero',
            ], true);  // debug
        }
        $dead = true;
    }
    if ($dead && $battle_cache !== null) {
        $battle_cache['combatants'][(int)$actor_data['pid']] = 0;
        $battle_cache['tag_mutations'][(int)$actor_data['pid']]['dead'] = true;
    }
    return !$dead;
}

// ================================================================
// Turn 生命周期 hook / Turn lifecycle hooks
//
// Turn start / Turn end 在代码中的精确位置。
// 仅 Phase 1（有先攻队列的标准战斗）中存在 Turn；Phase 0（Ambush）无 Turn。
//
// Turn 的身份由先攻队列的 done 标志位标识：
//   - done=0 的 combatant 即为当前回合持有者
//   - manage_queue 在 step 5 取下一顺位时读的就是 done=0 的首行
//   - 因此在 Turn start hook 中可通过 queue 行定位 current turn holder
//
// Turn start hook 内递增 BattleLogCollector::$turnNum，使后续 emit 的
// bl_turn_num 标识"当前回合"。
//
// 调用时机：combat_dispatch 入口（step 3.5），"当前 combatant 的回合开始"。
// 设计案：oblivions/docs/turn_start发送时机修复-2026-07-14.md
// ================================================================

/**
 * Turn start hook
 *
 * 在 combat_dispatch 入口（step 3.5）调用，"当前 combatant 的回合开始"。
 * 此时当前 combatant 即将执行动作，AP 恢复由配套的 battle_ap_recover 完成。
 *
 * 递增 BattleLogCollector 的 turnNum，使后续 emit 的 bl_turn_num 标识当前回合。
 *
 * @param array  &$actor_data   当前 combatant 的数据
 * @param array  &$obl_battle_log
 * @param array  &$battle_cache
 */
function battle_hook_turn_start(&$actor_data, &$obl_battle_log, &$battle_cache): void {
    if ($obl_battle_log) {
        $obl_battle_log->nextTurn();
    }
}

/**
 * Turn end hook
 *
 * 在共享回合收尾入口调用，"当前 combatant 的行动已全部执行完毕"。
 * 仅 Phase 1 时触发（有先攻队列），Phase 0（Ambush）不触发。
 *
 * 不操作计数器（Turn end 不递增，Turn start 才递增——turn_num 标识"当前回合"）。
 *
 * @param array  &$actor_data   当前 combatant 的数据（刚刚完成行动的 actor）
 * @param array  &$obl_battle_log
 * @param array  &$battle_cache
 */
function battle_hook_turn_end(&$actor_data, &$obl_battle_log, &$battle_cache): void {
    // ── Turn end placeholder ──
}
