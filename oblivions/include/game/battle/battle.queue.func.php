<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 先攻队列模块
//
// 职责：管理战斗的先攻队列（创建、加入、退出、更新、解散）和轮推进（Round = 全队列一轮循环）。
// 从 battle.main.php + battle.func.php 拆出，与执行层和状态层解耦。
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/player.func.php';
require_once GAME_ROOT . './oblivions/include/game/sql.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php';

/**
 * 从战斗上下文中提取存活参战者 pid 列表
 * @param array $battle_cache 战斗上下文
 * @return int[] 存活参战者 pid 列表（索引数组）
 */
function battle_get_alive_pids(array &$battle_cache): array {
    if (empty($battle_cache['combatants'])) return [];
    $pids = [];
    foreach ($battle_cache['combatants'] as $pid => $status) {
        if ($status === 1) $pids[] = (int)$pid;
    }
    return $pids;
}

/**
 * 计算先攻顺位
 *
 * 先攻率计算规则：
 * - 参战者投掷随机数 1~自己的先攻属性（obl_get_initiative，默认 50）
 * - 根据投掷结果决定先攻顺位（平局时取先攻属性更高者，再平局直接取玩家）
 * - ambush_flag=true 的参战者强制顺位 1，不参与投掷
 *
 * @param array &$actor_data 突袭者数据（含 ambush_flag）
 * @param array $combatants  参战者 PID 数组
 * @return array 排序后的先攻顺位数组 [['pid' => int, 'myorder' => int, 'roll' => int, 'initiative' => int, 'type' => int, 'is_ambush' => bool], ...]
 */
function battle_calc_initiative(&$actor_data, $combatants) {
    global $obl_error_log;
    $rolls = array();
    $ambush_pid = !empty($actor_data['oblpara']['ambush_flag']) ? (int)$actor_data['pid'] : 0;

    foreach ($combatants as $pid) {
        if ($pid == $ambush_pid) {
            # 突袭者强制顺位 1，不参与投掷
            $rolls[] = array(
                'pid' => (int)$pid,
                'roll' => 0,
                'initiative' => 0,
                'type' => (int)$actor_data['type'],
                'is_ambush' => true,
            );
            continue;
        }

        # 获取参战者数据
        if ($pid == $actor_data['pid']) {
            $combatant_data = &$actor_data;
        } else {
            $combatant_data = obl_fetch_playerdata_by_pid($pid);
            if (!$combatant_data) {
                if (isset($obl_error_log) && $obl_error_log) {
                    $obl_error_log->emit('initiative_calc.combatant_not_found', array(
                        'actor_pid' => (int)$actor_data['pid'],
                        'missing_pid' => (int)$pid,
                    ), 'command');
                }
                continue;
            }
        }

        $initiative = obl_get_initiative($combatant_data);
        $roll = mt_rand(1, $initiative);
        $type = (int)$combatant_data['type'];

        $rolls[] = array(
            'pid' => (int)$pid,
            'roll' => $roll,
            'initiative' => $initiative,
            'type' => $type,
            'is_ambush' => false,
        );
    }

    # 排序：突袭者优先 → 投掷值降序 → 先攻属性降序 → 玩家优先
    usort($rolls, function($a, $b) {
        # 突袭者强制第一
        if ($a['is_ambush'] && !$b['is_ambush']) return -1;
        if (!$a['is_ambush'] && $b['is_ambush']) return 1;

        # 投掷值降序
        if ($a['roll'] !== $b['roll']) return $b['roll'] - $a['roll'];

        # 先攻属性降序
        if ($a['initiative'] !== $b['initiative']) return $b['initiative'] - $a['initiative'];

        # 玩家优先（type=0）
        if ($a['type'] == 0 && $b['type'] != 0) return -1;
        if ($a['type'] != 0 && $b['type'] == 0) return 1;

        return 0;
    });

    # 分配 myorder（从 1 开始递增）
    $result = array();
    $myorder = 1;
    foreach ($rolls as $r) {
        $r['myorder'] = $myorder++;
        $result[] = $r;
    }

    return $result;
}

function battle_queue_create(&$actor_data, &$combatants, &$obl_battle_log)
{
    # 新建先攻队列：设 bid、建状态机
    global $obl_error_log;

    $qid = obl_queue_next_qid();

    # 计算先攻顺位（基于先攻属性投掷 + ambush_flag 强制顺位 1）
    $initiative_result = battle_calc_initiative($actor_data, $combatants);

    # 记录先攻计算 debug 日志
    $ambush_pid = !empty($actor_data['oblpara']['ambush_flag']) ? (int)$actor_data['pid'] : 0;
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'initiative.roll',
            'extra'       => [
                'qid' => $qid,
                'rolls' => $initiative_result,
                'ambush_pid' => $ambush_pid,
            ],
        ]);
    }

    # 为每个参战者插入队列记录
    foreach ($initiative_result as $r) {
        $pid = $r['pid'];

        if ($pid == $actor_data['pid']) {
            $type = $actor_data['type'];
        } else {
            $combatant_data = obl_fetch_playerdata_by_pid($pid);
            if (!$combatant_data) {
                if (isset($obl_error_log) && $obl_error_log) {
                    $obl_error_log->emit('queue_create.combatant_not_found', array(
                        'actor_pid' => (int)$actor_data['pid'],
                        'missing_pid' => (int)$pid,
                        'qid' => $qid,
                    ), 'command');
                }
                continue;
            }
            $type = $combatant_data['type'];
        }

        obl_queue_delete_by_pid($pid);
        obl_queue_insert_entry($pid, $qid, $type, $r['myorder']);

        if ($pid == $actor_data['pid']) {
            $actor_data['bid'] = $qid;
        } else {
            obl_player_set_bid($pid, $qid);
        }
    }

    # 清除 ambush_flag（一次性，先攻判定使用完毕）
    if (isset($actor_data['oblpara']['ambush_flag'])) {
        unset($actor_data['oblpara']['ambush_flag']);
    }

    obl_save_player($actor_data);

    # 战斗状态机：创建战场状态记录（初始 PROCESSING，后续由队列顺位校正）
    obl_battle_state_create($qid, OBL_BS_PROCESSING);

    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'queue_create',
            'extra'       => ['qid' => $qid, 'combatants' => $combatants],
        ]);
    }
}

function battle_queue_rebuild($qid, $combatants, &$obl_battle_log)
{
    # 重建先攻队列：复用 qid，不设 bid，不建状态机
    global $obl_error_log;

    $qid = (int)$qid;
    if ($qid <= 0) return;

    # 清空该 qid 的所有旧队列记录
    obl_queue_delete_by_qid($qid);

    # 计算先攻顺位（重建时无突袭，所有参战者正常投掷）
    $rolls = array();
    foreach ($combatants as $pid) {
        $combatant_data = obl_fetch_playerdata_by_pid($pid);
        if (!$combatant_data) {
            if (isset($obl_error_log) && $obl_error_log) {
                $obl_error_log->emit('queue_rebuild.combatant_not_found', array(
                    'missing_pid' => (int)$pid,
                    'qid' => $qid,
                ), 'command');
            }
            continue;
        }
        $initiative = obl_get_initiative($combatant_data);
        $rolls[] = array(
            'pid' => (int)$pid,
            'roll' => mt_rand(1, $initiative),
            'initiative' => $initiative,
            'type' => (int)$combatant_data['type'],
        );
    }

    # 排序：先攻投掷降序 → 先攻属性降序 → 玩家优先
    usort($rolls, function($a, $b) {
        if ($a['roll'] !== $b['roll']) return $b['roll'] - $a['roll'];
        if ($a['initiative'] !== $b['initiative']) return $b['initiative'] - $a['initiative'];
        if ($a['type'] == 0 && $b['type'] != 0) return -1;
        if ($a['type'] != 0 && $b['type'] == 0) return 1;
        return 0;
    });

    # 插入新队列记录（bid 已存在，不重复设置）
    $myorder = 1;
    foreach ($rolls as $r) {
        obl_queue_delete_by_pid($r['pid']);
        obl_queue_insert_entry($r['pid'], $qid, $r['type'], $myorder++);
    }

    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => 0,
            'actor_type'  => -1,
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'queue_rebuild',
            'extra'       => ['qid' => $qid, 'combatants' => $combatants],
        ]);
    }
}

function battle_queue_join(&$actor_data, $qid, &$obl_battle_log)
{
    #将新参战者加入现有先攻队列，排入末尾，done=0
    #适用场景：遭遇战中一方已在先攻队列中，另一方（非战斗状态）加入该队列

    # 获取队列中最大的 myorder，新加入者排入末尾（myorder 最大 = 顺位最低）
    $myorder = obl_queue_next_myorder($qid);

    # 清理该 pid 的旧队列记录（避免 PRIMARY KEY 冲突，保证一个 pid 同时只在一个队列中）
    obl_queue_delete_by_pid($actor_data['pid']);

    # 插入队列记录（排入末尾，done=0 表示未行动，本游戏刻不会执行其回合）
    obl_queue_insert_entry($actor_data['pid'], $qid, $actor_data['type'], $myorder);

    # 更新参战者的 bid 为 qid
    $actor_data['bid'] = $qid;
    obl_save_player($actor_data);
}

function battle_queue_done(&$actor_data, $qid, &$obl_battle_log)
{
    #将参战者的 done 标记为 1
    obl_update_queue_done($actor_data['pid'], $qid, 1);
}

function battle_queue_update(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    #B. 死亡参战者从队列中移除 （battle_target_alive_check 检测到死亡时，从 bra_oblqueue 删除该行，清空其 bid）
    #C. 检查队列是否需要解散 （移除死亡者后，队列中除玩家外都死了 → 解散队列，清空玩家 bid）
    #D. 检查队列是否需要重建 （队列中所有 done 都=1 → 重新先攻判定，所有人 done=0，更新 myorder）
    #E. 更新 last_acted（记录上一个行动者的 myorder，用于日志和调试）

    $qid = (int)$actor_data['bid'];
    if ($qid <= 0) return;

    # C. 检查队列是否需要解散（只剩 1 人或没人或无人玩家 → 解散）
    $count = obl_fetch_queue_count_by_qid($qid);
    if ($count <= 1 || !obl_fetch_queue_has_player($qid)) {
        # 解散队列，直接销毁状态机
        obl_queue_delete_by_qid($qid);
        obl_battle_state_transition($qid, 'battle_end');
        obl_battle_state_destroy($qid);  // battle_end → IDLE，然后删行
        $actor_data['bid'] = 0;
        obl_save_player($actor_data);
        return;
    }

    # D. 检查队列是否需要重建（所有 done=1 → 重投先攻）
    $undone = obl_fetch_queue_undone_by_qid($qid);
    if (empty($undone)) {
        # 所有人都行动过，保持 qid 不变，重投先攻顺位
        # 注意：重建时不应保留一次性标记（如 ambush_flag），调用前清理
        if (isset($actor_data['oblpara']['ambush_flag'])) {
            unset($actor_data['oblpara']['ambush_flag']);
        }
        $combatants = obl_fetch_queue_pids_by_qid($qid);
        battle_queue_rebuild($qid, $combatants, $obl_battle_log);
    }

    # E. 更新 last_acted（记录上一个行动者的 myorder，用于日志和调试）
    if ($qid > 0) {
        $my_queue = obl_fetch_queue_by_pid($actor_data['pid']);
        if ($my_queue) {
            obl_queue_update_last_acted($actor_data['pid'], $qid, (int)$my_queue['myorder']);
        }
    }

    # 记录日志（DEBUG：先攻队列更新）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'queue_update',
            'extra'       => ['qid' => $qid, 'remaining' => $count, 'rebuilt' => empty($undone)],
        ]);
    }
}

function battle_queue_exit(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    #从数据库中的先攻队列中移除自己

    $qid = (int)$actor_data['bid'];
    if ($qid > 0) {
        # 从先攻队列表中删除自己的记录
        obl_queue_delete_entry($actor_data['pid'], $qid);
    }

    #清空bid
    $actor_data['bid'] = 0;
}

/**
 * 先攻队列确保函数
 *
 * 如果 actor_data 没有关联先攻队列（bid 为空），则创建一个新的先攻队列。
 * 由 battle_manage_queue 在 battle_queue_advance 前调用。
 */
function battle_queue_ensure(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 检验$actor_data['bid']是否关联存在的先攻队列
    if (empty($actor_data['bid']))
    {
        $alive_pids = battle_get_alive_pids($battle_cache);
        # 逃跑后 bid=0 但 combatants 中可能只剩自己，无人可打则不建队列
        $others = array_filter($alive_pids, fn($p) => $p !== (int)$actor_data['pid']);
        if (empty($others)) return;
        battle_queue_create($actor_data, $alive_pids, $obl_battle_log);
    }
}

/**
 * 先攻队列推进函数
 *
 * 标记当前先攻者为已行动 + 解散检查 + 重建检查 + 更新 last_acted。
 * 三步不拆：mark_done + disband + rebuild。
 * 由 battle_manage_queue 在 battle_queue_ensure 后调用。
 */
function battle_queue_advance(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 标记当前先攻者在队列中为已行动
    battle_queue_done($actor_data, $actor_data['bid'], $obl_battle_log);

    # 执行解散/重建/last_acted 更新
    battle_queue_update($actor_data, $obl_battle_log, $battle_cache);
}

/**
 * 队列结束检测函数
 *
 * 遍历先攻队列，检查是否满足战斗结束条件（玩家是唯一幸存者，或玩家成功逃跑）。
 * 由 battle_manage_queue 在 battle_queue_advance 后调用。
 */
function battle_queue_try_end(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 检验$actor_data['bid']是否关联存在的先攻队列
    if (empty($actor_data['bid']))
    {
        # 没有关联战斗队列，说明战斗已结束。
        # C 段解散时已直接销毁状态机，此处仅清理 actor 状态。
        battle_state_clear($actor_data, $obl_battle_log, $battle_cache);
        return;
    }
    # 战斗没结束，进入新一轮战斗流程
    battle_queue_prepare_next_round($actor_data, $obl_battle_log, $battle_cache);
    return;
}

/**
 * 下一轮准备函数（Round）
 *
 * 重置先攻者AP，保存数据。
 * 由 battle_queue_try_end 在检测到战斗继续时调用。
 */
function battle_queue_prepare_next_round(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 轮准备函数：恢复AP（下一轮队列循环）
    $obl_battle_log->setPhase('prepare');
    battle_ap_recover($actor_data, $battle_cache, $obl_battle_log);
    # 保存先攻者数据到数据库
    obl_save_player($actor_data);
}

/**
 * 队列管理主函数（从 battle_main 拆出）
 *
 * 职责：五步流水线：create/ensure → advance(mark_done+disband+rebuild) → 确定下一顺位+状态转换 → try_end。
 * 返回结构化结果，调用方不再需要重复查询队列或手动做状态转换。
 *
 * @return array ['disbanded' => bool, 'rebuilt' => bool, 'next' => array|null]
 *   disbanded: 队列是否已解散（战斗结束）
 *   rebuilt:   队列是否已重建（新一轮）
 *   next:      下一顺位者 ['pid' => int, 'type' => int] 或 null（解散后为 null）
 */
function battle_manage_queue(&$actor_data, &$obl_battle_log, &$battle_cache): array
{
    $result = [
        'disbanded' => false,
        'rebuilt'   => false,
        'next'      => null,
    ];

    $obl_battle_log->setPhase('queue_check');
    battle_queue_ensure($actor_data, $obl_battle_log, $battle_cache);
    battle_queue_advance($actor_data, $obl_battle_log, $battle_cache);

    # 确定下一顺位并同步到 state 表 + 状态转换
    $qid = (int)$actor_data['bid'];
    if ($qid <= 0) {
        $result['disbanded'] = true;
    } else {
        $next = obl_fetch_queue_current_initiator($qid);
        $result['next'] = $next;
        obl_battle_state_set_next_pid($qid, $next ? (int)$next['pid'] : 0);

        if ($next) {
            if ($next['type'] == 0) {
                obl_battle_state_transition($qid, 'player_turn');
            } else {
                obl_battle_state_refresh($qid);
            }
        }
    }

    $obl_battle_log->setPhase('finish_check');
    battle_queue_try_end($actor_data, $obl_battle_log, $battle_cache);

    return $result;
}
