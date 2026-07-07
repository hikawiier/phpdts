<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 先攻队列原语层
//
// 职责：先攻队列的原子操作（先攻计算、创建、加入、退出、更新、解散、重建）。
// 不含编排逻辑，编排层在 battle.queue.main.php。
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
 * - ambush_pid > 0 的参战者强制顺位 1，不参与投掷
 *
 * 纯输入-输出函数，不依赖 actor_data，ambush_pid 作为整数参数透传。
 *
 * @param array $combatants  参战者 PID 数组
 * @param int   $ambush_pid  强制顺位 1 的 pid（0=无突袭）
 * @return array 排序后的先攻顺位数组 [['pid' => int, 'myorder' => int, 'roll' => int, 'initiative' => int, 'type' => int, 'is_ambush' => bool], ...]
 */
function battle_calc_initiative($combatants, $ambush_pid = 0, $player_map = null): array {
    global $obl_error_log;

    $ambush_pid = (int)$ambush_pid;
    $rolls = array();

    foreach ($combatants as $pid) {
        $pid = (int)$pid;

        $data = null;
        if (is_array($player_map) && isset($player_map[$pid])) {
            $data = $player_map[$pid];
        } else {
            $data = obl_fetch_playerdata_by_pid($pid);
        }
        if (!$data) {
            if ($pid !== $ambush_pid && isset($obl_error_log) && $obl_error_log) {
                $obl_error_log->emit('initiative_calc.combatant_not_found', array(
                    'missing_pid' => $pid,
                ), 'command');
            }
            continue;
        }

        if ($pid === $ambush_pid) {
            $rolls[] = array(
                'pid'        => $pid,
                'roll'       => 0,
                'initiative' => 0,
                'type'       => (int)$data['type'],
                'is_ambush'  => true,
            );
            continue;
        }

        $initiative = obl_get_initiative($data);
        $rolls[] = array(
            'pid'        => $pid,
            'roll'       => mt_rand(1, $initiative),
            'initiative' => $initiative,
            'type'       => (int)$data['type'],
            'is_ambush'  => false,
        );
    }

    # 排序：突袭者优先 → 投掷值降序 → 先攻属性降序 → 玩家优先
    usort($rolls, function($a, $b) {
        if ($a['is_ambush'] && !$b['is_ambush']) return -1;
        if (!$a['is_ambush'] && $b['is_ambush']) return 1;
        if ($a['roll'] !== $b['roll']) return $b['roll'] - $a['roll'];
        if ($a['initiative'] !== $b['initiative']) return $b['initiative'] - $a['initiative'];
        if ($a['type'] === 0 && $b['type'] !== 0) return -1;
        if ($a['type'] !== 0 && $b['type'] === 0) return 1;
        return 0;
    });

    $myorder = 1;
    return array_map(function($r) use (&$myorder) {
        $r['myorder'] = $myorder++;
        return $r;
    }, $rolls);
}

/**
 * 创建先攻队列并投先攻（合并版）
 *
 * 一次完成：batch fetch playerdata → 内存算先攻 → INSERT（带正确 myorder）→ 设 bid → 建状态机。
 * 消除原两段式（create_entries + set_initiative）中 SELECT 回读、重复 fetch、UPDATE myorder 等冗余 SQL。
 *
 * @param array  &$actor_data      发起者数据
 * @param array  $pids             参战者 PID 数组
 * @param array  &$obl_battle_log  战斗日志收集器
 * @return int  qid（队列编号），失败返回 0
 */
function battle_queue_create_and_init(&$actor_data, array $pids, &$obl_battle_log): int
{
    $pids = array_values(array_unique(array_map('intval', $pids)));
    if (empty($pids)) return 0;

    $player_map = obl_fetch_playerdata_batch($pids);

    $ambush_pid = !empty($actor_data['oblpara']['ambush_flag'])
        ? (int)$actor_data['pid'] : 0;

    $sorted = battle_calc_initiative($pids, $ambush_pid, $player_map);
    if (empty($sorted)) return 0;

    if ($ambush_pid > 0) {
        unset($actor_data['oblpara']['ambush_flag']);
    }

    $qid = obl_queue_next_qid();
    foreach ($sorted as $r) {
        obl_queue_delete_by_pid($r['pid']);
        obl_queue_insert_entry($r['pid'], $qid, $r['type'], $r['myorder']);
    }

    $actor_pid = (int)$actor_data['pid'];
    $others = array_values(array_filter(
        array_column($sorted, 'pid'),
        fn($p) => $p !== $actor_pid
    ));
    if (!empty($others)) {
        obl_player_set_bid_batch($others, $qid);
    }
    $actor_data['bid'] = $qid;
    obl_save_player($actor_data);

    obl_battle_state_create($qid, OBL_BS_PROCESSING);

    if ($obl_battle_log) {
        // 队列新建 = Round 1（0-indexed），同步到 collector 后再 emit initiative_roll
        $obl_battle_log->setRoundNum(0);
        $obl_battle_log->setPhase('queue_create');
        $obl_battle_log->emit([
            'qid'        => $qid,
            'combatants' => $sorted,
        ], true);  // debug
        $obl_battle_log->setPhase('initiative_roll');
        $obl_battle_log->emit([
            'qid'        => $qid,
            'rolls'      => $sorted,
            'ambush_pid' => $ambush_pid > 0 ? (int)$actor_data['pid'] : 0,
            'combatants' => $sorted,
        ]);
    }

    return $qid;
}

/**
 * 投先攻并写入 myorder（用于 rebuild 路径）
 *
 * 读 queue 行得 pids，批量 fetch playerdata，调 calc_initiative，逐条 UPDATE myorder。
 * 函数不接触 ambush_flag，不接触 actor_data['oblpara']。
 *
 * @param int    $qid             队列编号
 * @param array  &$actor_data     发起者数据（仅用于日志记录）
 * @param array  &$obl_battle_log 战斗日志收集器
 * @param int    $ambush_pid      强制顺位 1 的 pid（0=无突袭）
 * @return array  排序后的先攻顺位数组（空数组=无队列行）
 */
function battle_queue_set_initiative($qid, &$actor_data, &$obl_battle_log, $ambush_pid = 0): array
{
    $qid = (int)$qid;
    $rows = obl_fetch_queue_all_by_qid($qid);
    if (empty($rows)) return [];

    $pids = [];
    foreach ($rows as $row) {
        if ((int)$row['active'] === 1) {  // 只对 active=1 的人重投先攻
            $pids[] = (int)$row['pid'];
        }
    }

    $player_map = obl_fetch_playerdata_batch($pids);
    $sorted = battle_calc_initiative($pids, (int)$ambush_pid, $player_map);
    if (empty($sorted)) return [];

    foreach ($sorted as $r) {
        obl_queue_update_myorder($r['pid'], $qid, $r['myorder']);
    }

    if ($obl_battle_log) {
        $obl_battle_log->setPhase('initiative_roll');
        $obl_battle_log->emit([
            'qid'        => $qid,
            'rolls'      => $sorted,
            'ambush_pid' => $ambush_pid,
        ]);
    }

    return $sorted;
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

function battle_queue_exit(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    #从先攻队列中退出（标记 active=0，不删行、不清 bid）
    #bid 保留由队列解散时统一清理（battle_disband_cleanup）

    $qid = (int)$actor_data['bid'];
    if ($qid > 0) {
        obl_queue_set_active($actor_data['pid'], $qid, 0);
    }
}
