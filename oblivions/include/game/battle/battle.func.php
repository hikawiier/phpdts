<?php
/**
 * @module I 旧战斗队列系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}
// ================================================================
// Shared combat infrastructure — 轻量状态与行动资格检查
//
// 说明：
// - 旧 battle engine 的主执行链已下线，但本文件不是死代码。
// - 当前仍由 new combat / queue 层复用：
//   - 轻量 action= battle/'' 切换
//   - actor 可行动检查
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
    # AP 恢复原语。调用边界由 E-5 battle_turn_open 决定。
    $old_ap = (int)$actor_data['ap'];
    $max_ap = (int)$actor_data['max_ap'];
    $actor_data['ap'] = min($old_ap + $max_ap, $max_ap);
    return $actor_data['ap'] - $old_ap;
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
