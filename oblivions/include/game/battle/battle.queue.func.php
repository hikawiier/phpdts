<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 先攻队列模块
//
// 职责：管理战斗的先攻队列（创建、加入、退出、更新、解散）和回合推进。
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

function battle_queue_create(&$actor_data,&$combatants,&$obl_battle_log,$preserve_qid=0)
{
    #先攻队列创建函数
    #根据$combatants和先攻率排序创建先攻队列
    #创建后的先攻队列保存到数据库，数据结构参考oblqueue.sql
    #将先攻队列中包含的每个参战者的bid修改为先攻队列的唯一索引qid
    #$preserve_qid>0 表示在指定 qid 上重建队列（保持 qid 不变，用于战斗轮切换时的先攻重投）
    global $obl_error_log;

    # 确定 qid：重建时复用原 qid，新建时取 MAX(qid)+1 保证唯一
    $is_rebuild = $preserve_qid > 0;
    if ($is_rebuild) {
        $qid = (int)$preserve_qid;
        # 重建时先清空该 qid 的所有旧队列记录，便于重新插入
        obl_queue_delete_by_qid($qid);
    } else {
        $qid = obl_queue_next_qid();
    }

    # 计算先攻顺位（基于先攻属性投掷 + ambush_flag 强制顺位 1）
    $initiative_result = battle_calc_initiative($actor_data, $combatants);

    # 记录先攻计算 debug 日志（含 is_ambush 标记，体现强制顺位信息）
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

        # 获取参战者 type
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

        # 清理该 pid 的旧队列记录（避免 PRIMARY KEY 冲突，保证一个 pid 同时只在一个队列中）
        obl_queue_delete_by_pid($pid);

        # 插入队列记录（qorder=0 表示还没人执行过，done=0 表示未行动）
        obl_queue_insert_entry($pid, $qid, $type, $r['myorder']);

        # 更新参战者的 bid 为 qid
        if ($pid == $actor_data['pid']) {
            $actor_data['bid'] = $qid;
        } else {
            # 其他参战者直接通过函数更新 bid 字段
            obl_player_set_bid($pid, $qid);
        }
    }

    # 清除 ambush_flag（一次性，先攻判定使用完毕）
    if (isset($actor_data['oblpara']['ambush_flag'])) {
        unset($actor_data['oblpara']['ambush_flag']);
    }

    # 保存动作发起者（bid 已修改，ambush_flag 已清除）
    obl_save_player($actor_data);

    # 战斗状态机：创建战场状态记录
    # - 新建队列：状态 = PLAYER_DONE（玩家动作已结算，等待 tick 推进转入 NPC_ACTING）
    # - 重建队列：INSERT IGNORE 不覆盖现有记录，保持原状态
    #   （由后续的 tick_advanced / npc_done 事件驱动状态转换）
    # battle_state_machine.func.php 已由 obl_bootstrap.php 加载
    obl_battle_state_create($qid, OBL_BS_PLAYER_DONE);

    # 记录日志（DEBUG：先攻队列创建）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => $is_rebuild ? 'queue_rebuild' : 'queue_create',
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

    # 插入队列记录（排入末尾，done=0 表示未行动，本游戏刻不会执行先攻轮）
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
    #E. 更新 qorder （记录当前执行顺位，方便前端显示和断点续传）

    $qid = (int)$actor_data['bid'];
    if ($qid <= 0) return;

    # C. 检查队列是否需要解散（队列中只剩 1 人或没人 → 解散）
    $count = obl_fetch_queue_count_by_qid($qid);
    if ($count <= 1) {
        # 队列中只剩玩家（或没人），解散队列
        # 战斗状态机：保存 qid 到 battle_cache，供 battle_queue_try_end 触发 battle_end 事件
        $battle_cache['last_qid'] = $qid;
        obl_queue_delete_by_qid($qid);
        $actor_data['bid'] = 0;
        obl_save_player($actor_data);
        return;
    }

    # D. 检查队列是否需要重建（所有 done=1 → 通过 battle_queue_create 在原 qid 上重投先攻）
    $undone = obl_fetch_queue_undone_by_qid($qid);
    if (empty($undone)) {
        # 所有人都行动过，保持 qid 不变，重投先攻顺位、重置 done=0、更新 myorder
        # 注意：重建时不应保留一次性标记（如 ambush_flag），调用前清理
        if (isset($actor_data['oblpara']['ambush_flag'])) {
            unset($actor_data['oblpara']['ambush_flag']);
        }
        $combatants = obl_fetch_queue_pids_by_qid($qid);
        battle_queue_create($actor_data, $combatants, $obl_battle_log, $qid);
        # 重建保持 qid 不变，actor_data['bid'] 仍为原 qid
    }

    # E. 更新 qorder（记录当前执行者的顺位，方便前端显示和断点续传）
    if ($qid > 0) {
        $my_queue = obl_fetch_queue_by_pid($actor_data['pid']);
        if ($my_queue) {
            obl_queue_update_qorder($actor_data['pid'], $qid, (int)$my_queue['myorder']);
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
        # 没有则创建一个新的先攻队列
        $alive_pids = battle_get_alive_pids($battle_cache);
        battle_queue_create($actor_data, $alive_pids, $obl_battle_log);
    }
}

/**
 * 先攻队列推进函数
 *
 * 标记当前先攻者为已行动 + 解散检查 + 重建检查 + 更新 qorder。
 * 三步不拆：mark_done + disband + rebuild。
 * 由 battle_manage_queue 在 battle_queue_ensure 后调用。
 */
function battle_queue_advance(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 标记当前先攻者在队列中为已行动
    battle_queue_done($actor_data, $actor_data['bid'], $obl_battle_log);

    # 执行解散/重建/qorder 更新
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
        # 没有关联战斗队列，且在之前的流程里也没有建立新的战斗队列。说明战斗已结束了

        # 战斗状态机：触发 battle_end 事件并销毁状态记录
        # qid 从 battle_cache['last_qid'] 获取（由 battle_queue_update 解散逻辑保存）
        $last_qid = isset($battle_cache['last_qid']) ? (int)$battle_cache['last_qid'] : 0;
        if ($last_qid > 0 && function_exists('obl_battle_state_get')) {
            $current_state = obl_battle_state_get($last_qid);
            # 仅当状态记录还存在且非 IDLE 时触发 battle_end 事件
            if ($current_state !== OBL_BS_IDLE) {
                obl_battle_state_transition($last_qid, 'battle_end');
            }
            # 战斗清理完成后，销毁状态记录
            obl_battle_state_destroy($last_qid);
        }

        battle_state_clear($actor_data, $obl_battle_log, $battle_cache);
        return;
    }
    # 战斗没结束，进入新一轮战斗流程
    battle_queue_prepare_next_round($actor_data, $obl_battle_log, $battle_cache);
    return;
}

/**
 * 下一轮准备函数
 *
 * 重置先攻者AP，保存数据。
 * 由 battle_queue_try_end 在检测到战斗继续时调用。
 */
function battle_queue_prepare_next_round(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 先攻轮准备函数：恢复AP
    $obl_battle_log->setPhase('prepare');
    battle_ap_recover($actor_data, $battle_cache, $obl_battle_log);
    # 保存先攻者数据到数据库
    obl_save_player($actor_data);
}

/**
 * 队列管理主函数（从 battle_main 拆出）
 *
 * 职责：四步流水线：create/ensure → advance(mark_done+disband+rebuild) → try_end。
 * 由入口函数在 battle_main 返回后调用（入口 3 不调 battle_main 时单独调用）。
 */
function battle_manage_queue(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    $obl_battle_log->setPhase('queue_check');
    battle_queue_ensure($actor_data, $obl_battle_log, $battle_cache);
    battle_queue_advance($actor_data, $obl_battle_log, $battle_cache);

    $obl_battle_log->setPhase('finish_check');
    battle_queue_try_end($actor_data, $obl_battle_log, $battle_cache);
}
