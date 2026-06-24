<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统功能文件 / Oblivions battle system
// 功能函数负责实现战斗系统的具体功能
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';

function battle_state_init(&$actor_data)
{
    # 进入战斗，初始化参战者的战斗状态
    $actor_data['action'] = 'battle';
}


function battle_state_clear(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    # 战斗已结束了，清空参战者的战斗状态
    $actor_data['action'] = '';
    # 如果还存在关联中的战斗队列，退出队列
    if(!empty($actor_data['bid']))
    {
        battle_queue_exit($actor_data,$obl_battle_log,$battle_cache);
    }
    # 无论 bid 是否为空，都保存 action 的修改（避免战斗结束后卡在 battle 状态）
    obl_save_player($actor_data);

    # 记录日志（DEBUG：战斗结束，清空战斗状态）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => 'battle_end',
            'extra'       => ['ended' => true],
        ]);
    }
}

function battle_queue_create(&$actor_data,&$combatants,&$obl_battle_log)
{
    #先攻队列创建函数
    #根据$combatants和先攻率排序创建先攻队列
    #创建后的先攻队列保存到数据库，数据结构参考oblqueue.sql
    #将先攻队列中包含的每个参战者的bid修改为先攻队列的唯一索引qid
    global $db, $tablepre, $obl_error_log;

    # 生成新的 qid（MAX+1，保证唯一）
    $result = $db->query("SELECT MAX(qid) AS max_qid FROM {$tablepre}oblqueue");
    $row = $db->fetch_array($result);
    $qid = $row && $row['max_qid'] ? (int)$row['max_qid'] + 1 : 1;

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
        $db->query("DELETE FROM {$tablepre}oblqueue WHERE pid = " . (int)$pid);

        # 插入队列记录（qorder=0 表示还没人执行过，done=0 表示未行动）
        $db->query("INSERT INTO {$tablepre}oblqueue (pid, qid, type, qorder, myorder, done) VALUES (" . (int)$pid . ", " . (int)$qid . ", " . (int)$type . ", 0, " . (int)$r['myorder'] . ", 0)");

        # 更新参战者的 bid 为 qid
        if ($pid == $actor_data['pid']) {
            $actor_data['bid'] = $qid;
        } else {
            # 其他参战者直接 SQL UPDATE bid 字段
            $db->query("UPDATE {$tablepre}oblplayers SET bid = " . (int)$qid . " WHERE pid = " . (int)$pid);
        }
    }

    # 清除 ambush_flag（一次性，先攻判定使用完毕）
    if (isset($actor_data['oblpara']['ambush_flag'])) {
        unset($actor_data['oblpara']['ambush_flag']);
    }

    # 保存动作发起者（bid 已修改，ambush_flag 已清除）
    obl_save_player($actor_data);

    # 记录日志（DEBUG：先攻队列创建）
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

function battle_queue_join(&$actor_data, $qid, &$obl_battle_log)
{
    #将新参战者加入现有先攻队列，排入末尾，done=0
    #适用场景：遭遇战中一方已在先攻队列中，另一方（非战斗状态）加入该队列
    global $db, $tablepre;

    # 获取队列中最大的 myorder，新加入者排入末尾（myorder 最大 = 顺位最低）
    $result = $db->query("SELECT MAX(myorder) AS max_myorder FROM {$tablepre}oblqueue WHERE qid = " . (int)$qid);
    $row = $db->fetch_array($result);
    $myorder = $row && $row['max_myorder'] ? (int)$row['max_myorder'] + 1 : 1;

    # 清理该 pid 的旧队列记录（避免 PRIMARY KEY 冲突，保证一个 pid 同时只在一个队列中）
    $db->query("DELETE FROM {$tablepre}oblqueue WHERE pid = " . (int)$actor_data['pid']);

    # 插入队列记录（排入末尾，done=0 表示未行动，本游戏刻不会执行先攻轮）
    $db->query("INSERT INTO {$tablepre}oblqueue (pid, qid, type, qorder, myorder, done) VALUES (" . (int)$actor_data['pid'] . ", " . (int)$qid . ", " . (int)$actor_data['type'] . ", 0, " . (int)$myorder . ", 0)");

    # 更新参战者的 bid 为 qid
    $actor_data['bid'] = $qid;
    obl_save_player($actor_data);
}

function battle_queue_calc()
{

}

function battle_queue_update(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    #A. 更新参战者的 done （标记当前先攻者已行动）
    #B. 死亡参战者从队列中移除 （battle_target_alive_check 检测到死亡时，从 bra_oblqueue 删除该行，清空其 bid）
    #C. 检查队列是否需要解散 （移除死亡者后，队列中除玩家外都死了 → 解散队列，清空玩家 bid）
    #D. 检查队列是否需要重建 （队列中所有 done 都=1 → 重新先攻判定，所有人 done=0，更新 myorder）
    #E. 更新 qorder （记录当前执行顺位，方便前端显示和断点续传）
    global $db, $tablepre;

    $qid = (int)$actor_data['bid'];
    if ($qid <= 0) return;

    # A. 更新当前先攻者的 done=1
    $db->query("UPDATE {$tablepre}oblqueue SET done = 1 WHERE pid = " . (int)$actor_data['pid'] . " AND qid = " . $qid);

    # B. 兜底扫描：清理队列中的死亡参战者（battle_queue_exit 已处理的情况会跳过）
    # 注：当前 battle_queue_exit 已在死亡时调用并清理队列，此兜底扫描暂注释，
    # 待整体清理完成后按新设计重构（避免重复处理与潜在竞态）。
    # $queue_all = obl_fetch_queue_all_by_qid($qid);
    # foreach ($queue_all as $qrow) {
    #     $pid = (int)$qrow['pid'];
    #     if ($pid == $actor_data['pid']) continue; # 跳过自己
    #     $combatant_data = obl_fetch_playerdata_by_pid($pid);
    #     if (!$combatant_data || $combatant_data['state']) {
    #         # 参战者不存在或已死亡，从队列移除并清空 bid
    #         $db->query("DELETE FROM {$tablepre}oblqueue WHERE pid = " . $pid . " AND qid = " . $qid);
    #         $db->query("UPDATE {$tablepre}oblplayers SET bid = 0 WHERE pid = " . $pid);
    #     }
    # }

    # C. 检查队列是否需要解散（队列中只剩 1 人或没人 → 解散）
    $count = obl_fetch_queue_count_by_qid($qid);
    if ($count <= 1) {
        # 队列中只剩玩家（或没人），解散队列
        $db->query("DELETE FROM {$tablepre}oblqueue WHERE qid = " . $qid);
        $actor_data['bid'] = 0;
        obl_save_player($actor_data);
        return;
    }

    # D. 检查队列是否需要重建（所有 done=1 → 重新先攻判定，所有人 done=0，更新 myorder）
    $undone = obl_fetch_queue_undone_by_qid($qid);
    if (empty($undone)) {
        # 所有人都行动过，重建先攻队列：重新计算 myorder，重置 done=0
        $queue_all = obl_fetch_queue_all_by_qid($qid);
        foreach ($queue_all as $qrow) {
            $pid = (int)$qrow['pid'];
            $myorder = mt_rand(1, 100);
            $db->query("UPDATE {$tablepre}oblqueue SET myorder = " . $myorder . ", done = 0 WHERE pid = " . $pid . " AND qid = " . $qid);
        }
    }

    # E. 更新 qorder（记录当前执行者的顺位，方便前端显示和断点续传）
    $my_queue = obl_fetch_queue_by_pid($actor_data['pid']);
    if ($my_queue) {
        $qorder = (int)$my_queue['myorder'];
        $db->query("UPDATE {$tablepre}oblqueue SET qorder = " . $qorder . " WHERE qid = " . $qid . " AND pid = " . (int)$actor_data['pid']);
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
    global $db, $tablepre;

    $qid = (int)$actor_data['bid'];
    if ($qid > 0) {
        # 从先攻队列表中删除自己的记录
        $db->query("DELETE FROM {$tablepre}oblqueue WHERE pid = " . (int)$actor_data['pid'] . " AND qid = " . $qid);
    }

    #清空bid
    $actor_data['bid'] = 0;
}


function battle_ap_recover(&$actor_data, &$battle_cache, &$obl_battle_log)
{
    #AP恢复函数：每轮开始时，先攻者恢复AP，恢复量为当前AP+AP上限，不会超过AP上限
    $old_ap = (int)$actor_data['ap'];
    $max_ap = (int)$actor_data['max_ap'];
    $actor_data['ap'] = min($old_ap + $max_ap, $max_ap);
    $recovered = $actor_data['ap'] - $old_ap;

    # 记录日志（DEBUG：AP 恢复信息）
    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'    => (int)$actor_data['pid'],
            'actor_type'   => (int)$actor_data['type'],
            'target_pid'   => (int)$actor_data['pid'],
            'target_type'  => (int)$actor_data['type'],
            'action_id'    => 'ap_recover',
            'effect_value' => $recovered,
        ]);
    }
}

function battle_act_verify(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache)
{
    #单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；
    #委托给技能系统的 skill_act_verify 处理：查配置、检查拥有、检查CD、检查AP、自动引用 verify 文件
    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    return skill_act_verify($actor_data, $act_id, $obl_battle_log, $battle_cache);
}

function battle_target_alive_check(&$target_data, &$obl_battle_log, &$battle_cache)
{
    #如果目标hp<=0，但state为0，修改state标记为死亡
    if ($target_data['hp'] <= 0 && !$target_data['state']) 
    {
        $target_data['state'] = 1; //修改目标状态为死亡
    }
    #目标已死，清理目标的战斗状态，并从战斗队列中移除
    if ($target_data['state'])
    {
        battle_state_clear($target_data, $obl_battle_log, $battle_cache);
        return false;
    }
    #目标没死
    return true;
}

function battle_target_distance_check(&$actor_data, &$target_data, &$battle_cache)
{
    $actor_range = obl_get_range($actor_data);
    // 这里应该实现具体的距离检查逻辑，然后和射程比较判断目标是否合法。由于目前没有具体的距离计算逻辑，暂时默认所有目标都在射程内。
    return true;
}

function battle_action_name($action_id)
{
    #获取动作的显示名称
    static $names = array(
        'unarmed_strike' => '空手攻击',
        'escape'         => '逃跑',
    );
    return isset($names[$action_id]) ? $names[$action_id] : $action_id;
}

function battle_apply_damage(&$actor_data, &$target_data, $damage, &$obl_battle_log, &$battle_cache)
{
    #伤害应用函数，输入目标数据、伤害数值，实际扣除目标HP，并且记录战斗日志
    $target_data['hp'] -= $damage;
    if ($target_data['hp'] < 0) {
        $target_data['hp'] = 0;
    }
}
