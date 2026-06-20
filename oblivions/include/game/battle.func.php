<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统 / Oblivions battle system
//
// 核心概念：
// - 先攻轮是单方的：一个先攻轮只属于一个"先攻者"，被攻击方只能反击
// - 先攻队列：所有参战者按先攻率摇随机数排序，生成队列保存在所有人 oblpara
// - NPC 先攻轮自动执行，玩家先攻轮等前端提交
// - 只有玩家先攻轮推进 tick（由 command [F] 段白名单处理）
// - 遭遇战（NPC 移动到玩家格）走正常战斗载入流程，不再有"突袭"特殊逻辑
//
// 先攻轮结构（obl_battle_execute）：
//   1. 加载先攻者攻击队列
//   2. foreach 攻击队列：
//      a. 执行攻击动作
//      b. 检查反击策略（留接口）
//      c. 执行反击（留接口）
//   3. 攻击队列清空 → 先攻轮结束
//
// 相关文档：oblivions/docs/战斗系统设计案.md
// ================================================================

// ----------------------------------------------------------------
// 接口预留函数（阶段一返回固定值，未来由技能/装备系统覆盖）
// ----------------------------------------------------------------

/**
 * 获取玩家攻击射程
 *
 * 阶段一固定返回 1（近战）。未来由武器类型决定。
 *
 * @param array &$pdata 玩家数据
 * @return int 射程（BFS 跳数）
 */
function obl_get_range(&$pdata) {
    return 1;
}

/**
 * 获取玩家可用的攻击模式列表
 *
 * 阶段一固定返回 ['unarmed_strike']。未来由武器技能决定。
 *
 * @param array &$pdata 玩家数据
 * @return array 攻击模式 ID 数组
 */
function obl_get_weapon_attack_modes(&$pdata) {
    return array('unarmed_strike');
}

/**
 * 计算伤害值
 *
 * 公式：max(1, att - def + weapon_bonus)
 * 保底 1 点伤害（避免 0 伤害卡死战斗）。
 *
 * @param int $att         攻击方攻击力
 * @param int $def         防御方防御力
 * @param int $weapon_bonus 武器加成（阶段一=0）
 * @return int 伤害值
 */
function obl_calc_damage($att, $def, $weapon_bonus = 0) {
    return max(1, (int)$att - (int)$def + (int)$weapon_bonus);
}

/**
 * 获取玩家先攻率
 *
 * 阶段一固定返回 50。未来由敏捷/技能/装备覆盖。
 * 先攻率用于摇随机数：mt_rand(0, 先攻率)，大者先攻。
 *
 * @param array &$pdata 玩家数据
 * @return int 先攻率（0~100）
 */
function obl_get_initiative_rate(&$pdata) {
    return 50;
}

// ----------------------------------------------------------------
// 辅助函数
// ----------------------------------------------------------------

/**
 * 获取战斗单位的标识符
 *
 * @param array &$pdata 单位数据
 * @return string 'player' 或 'enemy_{pid}'
 */
function obl_battle_actor_id(&$pdata) {
    return ($pdata['type'] == 0) ? 'player' : 'enemy_' . $pdata['pid'];
}

/**
 * 获取动作的显示名称
 *
 * @param string $action_id 动作 ID
 * @return string 显示名称
 */
function obl_battle_action_name($action_id) {
    static $names = array(
        'unarmed_strike' => '空手攻击',
        'escape'         => '逃跑',
    );
    return isset($names[$action_id]) ? $names[$action_id] : $action_id;
}

// ----------------------------------------------------------------
// 战斗状态管理
// ----------------------------------------------------------------

/**
 * 初始化战斗状态到 oblpara
 *
 * 包含 turn 计数器（用于日志排序）和先攻队列。
 *
 * @param array &$pdata 玩家数据
 */
function obl_battle_init_state(&$pdata) {
    if (!is_array($pdata['oblpara'])) $pdata['oblpara'] = array();
    $pdata['oblpara']['battle'] = array(
        'turn'  => 0,    // 先攻轮序号（用于日志排序）
        'queue' => array(),  // 先攻队列
    );
}

/**
 * 清除战斗状态从 oblpara
 *
 * @param array &$pdata 玩家数据
 */
function obl_battle_clear_state(&$pdata) {
    if (isset($pdata['oblpara']['battle'])) {
        unset($pdata['oblpara']['battle']);
    }
}

/**
 * 获取当前先攻轮序号
 *
 * @param array &$pdata 玩家数据
 * @return int 先攻轮序号
 */
function obl_battle_get_turn(&$pdata) {
    return isset($pdata['oblpara']['battle']['turn']) ? (int)$pdata['oblpara']['battle']['turn'] : 0;
}

/**
 * 递增先攻轮序号
 *
 * @param array &$pdata 玩家数据
 */
function obl_battle_inc_turn(&$pdata) {
    if (!isset($pdata['oblpara']['battle'])) $pdata['oblpara']['battle'] = array('turn' => 0);
    $pdata['oblpara']['battle']['turn']++;
}

// ----------------------------------------------------------------
// 先攻队列管理
// ----------------------------------------------------------------

/**
 * 先攻判定：摇随机数 + 排序 + 生成先攻队列
 *
 * 排序规则（降序）：
 * 1. 随机数大的优先
 * 2. 随机数相同 → 先攻率大的优先
 * 3. 随机数 + 先攻率都相同 → 玩家优先（type=0）
 *
 * 先攻补正（设计案 L30）：
 * - 玩家不是第一顺位时，玩家随机数 += 第一顺位者随机数 × 25%
 * - 但最高只能成为第二顺位（1v1 中无实际效果，为 1vN 预留）
 *
 * 队列保存在双方 oblpara['battle']['queue'] 中。
 *
 * @param array &$player 玩家数据
 * @param array &$enemy  敌人数据
 * @param int|null $player_roll_override 玩家先攻结果覆盖值（null=正常摇随机数）
 *                                       玩家主动攻击时传 101，确保绝对先攻
 * @return array 先攻队列
 */
function obl_battle_roll_initiative(&$player, &$enemy, $player_roll_override = null) {
    global $obl_battle_log;

    $player_rate = obl_get_initiative_rate($player);
    $enemy_rate  = obl_get_initiative_rate($enemy);

    // 玩家先攻结果：支持覆盖（玩家主动攻击时强制先攻）
    $player_roll = ($player_roll_override !== null) ? (int)$player_roll_override : mt_rand(0, $player_rate);
    $enemy_roll  = mt_rand(0, $enemy_rate);

    // 判定第一顺位
    $player_first = false;
    if ($player_roll > $enemy_roll) {
        $player_first = true;
    } elseif ($player_roll == $enemy_roll) {
        if ($player_rate > $enemy_rate) {
            $player_first = true;
        } elseif ($player_rate == $enemy_rate) {
            $player_first = true;  // 玩家优先
        }
    }

    // 先攻补正（玩家不是第一顺位时）
    // 1v1 中补正不改变顺位，但为 1vN 预留逻辑
    $player_roll_final = $player_roll;
    if (!$player_first) {
        $first_roll = $enemy_roll;
        $player_roll_final = $player_roll + (int)($first_roll * 0.25);
        // 1v1 中无论补正后是否超过敌人，玩家仍然排第二（最高只能第二顺位）
    }

    // 生成先攻队列
    if ($player_first) {
        $queue = array(
            0 => array('pid' => $player['pid'], 'done' => 0),
            1 => array('pid' => $enemy['pid'],  'done' => 0),
        );
    } else {
        $queue = array(
            0 => array('pid' => $enemy['pid'],  'done' => 0),
            1 => array('pid' => $player['pid'], 'done' => 0),
        );
    }

    // 保存到双方的 oblpara
    if (!isset($player['oblpara']['battle'])) $player['oblpara']['battle'] = array();
    if (!isset($enemy['oblpara']['battle']))  $enemy['oblpara']['battle']  = array();
    $player['oblpara']['battle']['queue'] = $queue;
    $enemy['oblpara']['battle']['queue']  = $queue;

    // emit 先攻判定日志（显示原始 roll 值，避免补正后值大于敌人却仍排第二的困惑）
    $first_name = $player_first ? $player['name'] : $enemy['name'];
    $obl_battle_log->emit(
        0,
        'system',
        'initiative.roll',
        '先攻判定',
        $first_name,
        0,
        array(
            'player_roll'  => $player_roll,
            'enemy_roll'   => $enemy_roll,
            'player_first' => $player_first,
        ),
        null,
        (int)$enemy['pid']
    );

    return $queue;
}

/**
 * 获取当前顺位（第一个 done=0 的队列项）
 *
 * @param array &$pdata 玩家数据
 * @return array|null ['index' => N, 'pid' => P]，null=所有人都已完成
 */
function obl_battle_get_current_initiator(&$pdata) {
    if (!isset($pdata['oblpara']['battle']['queue'])) return null;
    foreach ($pdata['oblpara']['battle']['queue'] as $index => $entry) {
        if ($entry['done'] == 0) {
            return array('index' => $index, 'pid' => (int)$entry['pid']);
        }
    }
    return null;
}

/**
 * 标记某个 pid 的先攻轮已完成（done=1）
 *
 * @param array &$pdata 玩家数据
 * @param int   $pid    已完成的 pid
 */
function obl_battle_mark_done(&$pdata, $pid) {
    if (!isset($pdata['oblpara']['battle']['queue'])) return;
    foreach ($pdata['oblpara']['battle']['queue'] as &$entry) {
        if ((int)$entry['pid'] === (int)$pid) {
            $entry['done'] = 1;
            break;
        }
    }
}

/**
 * 检查是否所有人都已完成先攻轮
 *
 * @param array &$pdata 玩家数据
 * @return bool true=所有人都已完成
 */
function obl_battle_all_done(&$pdata) {
    if (!isset($pdata['oblpara']['battle']['queue'])) return true;
    foreach ($pdata['oblpara']['battle']['queue'] as $entry) {
        if ($entry['done'] == 0) return false;
    }
    return true;
}

// ----------------------------------------------------------------
// 战斗发起（取消 prebattle 中间态，直接进入 battle）
// ----------------------------------------------------------------

/**
 * 校验攻击目标合法性
 *
 * 校验敌人存在、discovered=1、在同一区域、BFS 距离 ≤ obl_get_range()。
 * 不修改玩家状态，只返回校验结果和敌人数据。
 *
 * @param int   $enemy_pid 敌人 PID
 * @param array &$pdata    玩家数据
 * @param array &$enemy    输出参数：校验成功时填充敌人数据
 * @return string 错误信息（空字符串=成功）
 */
function obl_battle_validate_target($enemy_pid, &$pdata, &$enemy) {
    $enemy_pid = (int)$enemy_pid;
    if ($enemy_pid <= 0) return '无效的目标';

    // 校验 1：敌人存在
    $enemy = obl_fetch_playerdata_by_pid($enemy_pid);
    if (!$enemy) return '目标不存在';

    obl_format_playerdata($enemy);

    // 校验 2：敌人已死亡
    if ((int)$enemy['state'] !== 0) return '目标已死亡';

    // 校验 3：敌人已发现
    if (empty($enemy['discovered'])) return '未发现的目标';

    // 校验 4：同一区域
    if ((int)$enemy['pgroup'] !== (int)$pdata['pgroup']) return '目标不在当前区域';

    // 校验 5：BFS 距离 ≤ 射程
    $distance = obl_get_distance($pdata['pgroup'], $pdata['pls'], $enemy['pls']);
    if ($distance < 0 || $distance > obl_get_range($pdata)) return '目标距离过远';

    return '';
}

/**
 * 玩家主动攻击：直接进入战斗状态
 *
 * 取消原 prebattle 中间态，obl_battle_start 命令直接完成：
 * 1. 校验目标（obl_battle_validate_target）
 * 2. 状态检测（obl_battle_enter_battle）→ 双方 action='battle'
 * 3. emit battle.start 日志
 * 4. 先攻判定（玩家强制先攻，roll=101 确保绝对先攻）
 *
 * 注意：本函数只做初始化，不执行先攻轮。
 * 玩家先攻轮由调用方（cmd_handle_obl_battle_start）根据当前先攻者判断后执行。
 * NPC 先攻轮由游戏刻更新驱动（obl_resolve_tick_events 阶段 1）。
 *
 * @param int   $enemy_pid 目标敌人 PID
 * @param array &$pdata    玩家数据
 * @return string 错误信息（空字符串=成功）
 */
function obl_battle_initiate($enemy_pid, &$pdata) {
    global $obl_log, $obl_battle_log;

    // 步骤 1：校验目标
    $enemy = null;
    $error = obl_battle_validate_target($enemy_pid, $pdata, $enemy);
    if ($error !== '') return $error;

    // 步骤 2：状态检测（双方进入 battle 状态）
    obl_battle_enter_battle($pdata, $enemy);

    // 步骤 3：emit 战斗摘要日志
    $obl_log->emit('battle.start', 'battle', array(
        'enemy_name' => $enemy['name'],
        'enemy_pid'  => $enemy['pid'],
        'initiator'  => 'player',
    ));

    // emit 战斗细节日志：战斗开始（玩家主动攻击）
    $obl_battle_log->emit(
        0,
        'player',
        'battle.start',
        '开战',
        'enemy_' . $enemy['pid'],
        0,
        array('initiator' => 'player', 'enemy_name' => $enemy['name']),
        null,
        (int)$enemy['pid']
    );

    // 步骤 4：先攻判定（玩家主动攻击强制先攻，roll=101 确保绝对先攻）
    obl_battle_roll_initiative($pdata, $enemy, 101);

    // 步骤 5：保存双方数据（先攻轮由调用方或游戏刻更新驱动）
    obl_save_player($pdata);
    obl_save_player($enemy);

    return '';
}

// ----------------------------------------------------------------
// 战斗载入流程（步骤 1-2 + 核心循环）
// ----------------------------------------------------------------

/**
 * 步骤 1：状态检测函数
 *
 * 设置所有参战者 action='battle' + bid，初始化战斗状态。
 *
 * @param array &$player 玩家数据
 * @param array &$enemy  敌人数据
 */
function obl_battle_enter_battle(&$player, &$enemy) {
    // 双方进入战斗状态
    $player['action'] = 'battle';
    $player['bid']    = $enemy['pid'];
    $enemy['action']  = 'battle';
    $enemy['bid']     = $player['pid'];

    // 初始化战斗状态（含先攻队列占位）
    obl_battle_init_state($player);
    obl_battle_init_state($enemy);
}

/**
 * 战斗载入流程入口（玩家提交 obl_battle_action 时调用）
 *
 * 流程：
 * 1. 执行玩家先攻轮（玩家应该是当前顺位）
 * 2. NPC 自动执行直到玩家顺位或战斗结束
 *
 * 注意：prebattle → battle 转换已前移到 obl_battle_initiate()，
 * 本函数只处理 action='battle' 状态下的先攻轮执行。
 *
 * @param string $action_id 玩家选择的动作 ID
 * @param array  &$pdata    玩家数据
 * @return string 错误信息（空字符串=成功）
 */
function obl_battle_resolve_round($action_id, &$pdata) {
    global $obl_log, $obl_battle_log;

    // 校验：action 状态（必须是 battle，prebattle 已取消）
    if ($pdata['action'] !== 'battle') {
        return '当前不在战斗状态';
    }

    // 校验：bid 非空
    $enemy_pid = (int)$pdata['bid'];
    if ($enemy_pid <= 0) return '无效的战斗目标';

    // 加载敌人数据
    $enemy = obl_fetch_playerdata_by_pid($enemy_pid);
    if (!$enemy) return '战斗目标不存在';
    obl_format_playerdata($enemy);

    // 校验：敌人已死亡
    if ((int)$enemy['state'] !== 0) return '战斗目标已死亡';

    // 获取当前顺位
    $current = obl_battle_get_current_initiator($pdata);

    // 所有人都完成 → 重新先攻判定
    if ($current === null) {
        obl_battle_roll_initiative($pdata, $enemy);
        $current = obl_battle_get_current_initiator($pdata);
    }

    // 校验：当前顺位应该是玩家
    if ((int)$current['pid'] !== (int)$pdata['pid']) {
        // 当前顺位不是玩家 → 前端不应提交，直接走 NPC 自动执行
        return obl_battle_auto_npc($pdata, $enemy);
    }

    // 执行玩家先攻轮
    $result = obl_battle_execute($pdata, $enemy, $action_id);

    // 更新先攻队列（双方同步）
    obl_battle_mark_done($pdata, $pdata['pid']);
    obl_battle_mark_done($enemy, $pdata['pid']);

    // 检查战斗结束
    if ($result === 'escape') {
        obl_battle_end($pdata, $enemy, 'escape');
        return '';
    }
    $end_result = obl_battle_check_end($pdata, $enemy);
    if ($end_result !== 'continue') {
        obl_battle_end($pdata, $enemy, $end_result);
        return '';
    }

    // NPC 自动执行直到玩家顺位或战斗结束
    return obl_battle_auto_npc($pdata, $enemy);
}

/**
 * NPC 自动执行循环
 *
 * NPC 是当前顺位时自动执行先攻轮，直到轮到玩家或战斗结束。
 * 所有人都完成时重新先攻判定。
 *
 * @param array &$player 玩家数据
 * @param array &$enemy  敌人数据
 * @return string 错误信息（空字符串=成功）
 */
function obl_battle_auto_npc(&$player, &$enemy) {
    $max_iterations = 100;  // 防止异常情况下死循环
    $iterations = 0;
    while ($iterations < $max_iterations) {
        $iterations++;

        // 获取当前顺位
        $current = obl_battle_get_current_initiator($player);

        // 所有人都完成 → 重新先攻判定
        if ($current === null) {
            obl_battle_roll_initiative($player, $enemy);
            $current = obl_battle_get_current_initiator($player);
        }

        // 检查当前顺位
        if ((int)$current['pid'] === (int)$player['pid']) {
            // 轮到玩家 → 停止，等前端
            break;
        }

        // NPC 自动执行先攻轮
        $result = obl_battle_execute($enemy, $player, 'unarmed_strike');

        // 更新先攻队列（双方同步）
        obl_battle_mark_done($player, $enemy['pid']);
        obl_battle_mark_done($enemy, $enemy['pid']);

        // 检查战斗结束
        if ($result === 'escape') {
            obl_battle_end($player, $enemy, 'escape');
            return '';
        }
        $end_result = obl_battle_check_end($player, $enemy);
        if ($end_result !== 'continue') {
            obl_battle_end($player, $enemy, $end_result);
            return '';
        }
    }

    // 保存双方数据
    obl_save_player($player);
    obl_save_player($enemy);

    return '';
}

/**
 * 遭遇战入口（tick 结算中 NPC 移动到玩家格时调用）
 *
 * 走正常战斗载入流程：步骤 1（状态检测）+ 步骤 2（先攻判定）+ NPC 自动执行。
 * 取消原"突袭"特殊逻辑，先攻完全由先攻率决定。
 *
 * @param array &$player 玩家数据
 * @param array &$enemy  敌人数据
 */
function obl_battle_encounter(&$player, &$enemy) {
    global $obl_log, $obl_battle_log, $groomid;

    // 步骤 1：状态检测
    obl_battle_enter_battle($player, $enemy);

    // 交火后互相可见
    $player['discovered'] = 1;
    $enemy['discovered']  = 1;

    // emit 战斗摘要日志
    $obl_log->emit('battle.start', 'battle', array(
        'enemy_name' => $enemy['name'],
        'enemy_pid'  => $enemy['pid'],
        'initiator'  => 'enemy',
    ));

    // emit 战斗细节日志：遭遇战开始
    $obl_battle_log->emit(
        0,
        'enemy_' . $enemy['pid'],
        'battle.start',
        '遭遇',
        'player',
        0,
        array('initiator' => 'enemy', 'enemy_name' => $enemy['name']),
        null,
        (int)$enemy['pid']
    );

    // 步骤 2：先攻判定
    obl_battle_roll_initiative($player, $enemy);

    // NPC 自动执行直到玩家顺位或战斗结束
    obl_battle_auto_npc($player, $enemy);

    // 立即持久化战斗日志（遭遇战可能在非当前请求玩家的 tick 中发生，
    // 不能依赖请求结束时的持久化，否则会写到错误的 pid 文件）
    if (isset($obl_battle_log) && $obl_battle_log && $obl_battle_log->hasEntries()) {
        obl_battle_log_persist($obl_battle_log, $groomid, $player['pid']);
        // 清空已持久化的条目，避免请求结束时重复持久化
        $obl_battle_log = new BattleLogCollector();
    }
}

// ----------------------------------------------------------------
// 先攻轮执行（步骤 3-5）
// ----------------------------------------------------------------

/**
 * 加载先攻者的攻击动作队列
 *
 * 玩家：使用提交的 action_id（阶段一单个动作，未来从 AP 区读取多个）
 * 敌人：AI 行为树（阶段一固定 unarmed_strike）
 *
 * @param array  &$actor    先攻者数据
 * @param string $action_id 动作 ID（仅玩家使用）
 * @return array 动作 ID 数组
 */
function obl_battle_load_attack_queue(&$actor, $action_id) {
    if ($actor['type'] == 0) {
        // 玩家：使用提交的 action_id
        return array($action_id);
    } else {
        // 敌人：AI 行为树（阶段一固定 unarmed_strike）
        return array('unarmed_strike');
    }
}

/**
 * 检查被攻击者是否有反击策略
 *
 * 留接口：阶段一返回 null（无反击）。
 * 未来由防守策略槽/被动技能决定。
 *
 * @param array &$defender 被攻击者数据
 * @return array|null 反击策略，null=无反击
 */
function obl_battle_check_counter(&$defender) {
    return null;
}

/**
 * 执行被攻击者的反击动作
 *
 * 留接口：阶段一空实现。
 *
 * @param array &$defender 被攻击者数据
 * @param array &$attacker 先攻者数据
 */
function obl_battle_execute_counter(&$defender, &$attacker) {
    // 阶段一空实现
}

/**
 * 先攻轮执行函数（步骤 3-5）
 *
 * 流程：
 * 1. 加载先攻者攻击队列
 * 2. foreach 攻击队列：
 *    a. 执行攻击动作
 *    b. 被攻击者 HP ≤ 0 时先不判死亡
 *    c. 检查反击策略（留接口）
 *    d. 被攻击者 HP ≤ 0 且无反击 → 死亡，先攻轮结束
 *    e. 执行反击（留接口）
 * 3. 攻击队列清空 → 先攻轮结束
 *
 * @param array  &$actor    先攻者数据
 * @param array  &$target   被攻击者数据
 * @param string $action_id 动作 ID
 * @return string 'continue' | 'escape' | 'victory'
 */
function obl_battle_execute(&$actor, &$target, $action_id) {
    global $obl_battle_log;

    // 递增 turn（双方同步，用于日志排序）
    obl_battle_inc_turn($actor);
    $turn = obl_battle_get_turn($actor);
    if (isset($target['oblpara']['battle'])) {
        $target['oblpara']['battle']['turn'] = $turn;
    }

    // 步骤 1：加载攻击动作队列
    $attack_queue = obl_battle_load_attack_queue($actor, $action_id);

    // 步骤 2：foreach 攻击队列
    foreach ($attack_queue as $act_id) {
        // 步骤 2a：执行攻击动作
        $continue = obl_battle_do_action($actor, $target, $act_id, $turn);

        // 动作导致战斗结束（如 escape 成功）
        if (!$continue) {
            return 'escape';
        }

        // 步骤 2b：被攻击者 HP ≤ 0，先不判死亡

        // 步骤 2c：检查反击策略
        $counter = obl_battle_check_counter($target);

        // 步骤 2d：被攻击者 HP ≤ 0 且无反击 → 死亡，先攻轮结束
        if ((int)$target['hp'] <= 0 && $counter === null) {
            return 'victory';
        }

        // 步骤 2e：执行反击（留接口，阶段一空实现）
        if ($counter !== null) {
            obl_battle_execute_counter($target, $actor);
        }
    }

    // 步骤 3：攻击队列清空，先攻轮结束
    return 'continue';
}

/**
 * 执行单个攻击动作
 *
 * 阶段一支持 2 个动作：
 * - unarmed_strike：伤害 = obl_calc_damage(att, def, 0)，扣 HP
 * - escape：50% 概率成功，成功则战斗结束
 *
 * @param array  &$actor    行动方数据
 * @param array  &$target   目标方数据
 * @param string $action_id 动作 ID
 * @param int    $turn      先攻轮序号
 * @return bool true=继续下一个动作，false=战斗结束（escape 成功）
 */
function obl_battle_do_action(&$actor, &$target, $action_id, $turn) {
    global $obl_battle_log;

    $actor_id   = obl_battle_actor_id($actor);
    $target_id  = obl_battle_actor_id($target);
    $action_name = obl_battle_action_name($action_id);

    // 计算战斗对象 PID（用于前端按战斗分组）
    // actor 是玩家时，enemy 是 target；actor 是敌人时，enemy 是 actor
    $enemy_pid = ($actor['type'] == 0) ? (int)$target['pid'] : (int)$actor['pid'];

    switch ($action_id) {
        case 'unarmed_strike':
            // 计算伤害
            $damage = obl_calc_damage($actor['att'], $target['def'], 0);

            // 扣 HP
            $target['hp'] = max(0, (int)$target['hp'] - $damage);

            // emit 战斗日志
            $obl_battle_log->emit(
                $turn,
                $actor_id,
                $action_id,
                $action_name,
                $target_id,
                $damage,
                null,
                null,
                $enemy_pid
            );
            return true;

        case 'escape':
            // 50% 概率成功
            $success = (mt_rand(0, 1) === 1);

            // emit 战斗日志
            $obl_battle_log->emit(
                $turn,
                $actor_id,
                $action_id,
                $action_name,
                $target_id,
                0,
                array('success' => $success),
                null,
                $enemy_pid
            );

            return !$success;  // 成功=false（战斗结束），失败=true（继续）

        default:
            // 未知动作，不执行
            $obl_battle_log->emit(
                $turn,
                $actor_id,
                $action_id,
                $action_name,
                $target_id,
                0,
                array('error' => 'unknown_action'),
                null,
                $enemy_pid
            );
            return true;
    }
}

// ----------------------------------------------------------------
// 战斗结束
// ----------------------------------------------------------------

/**
 * 检查战斗是否结束
 *
 * @param array &$player 玩家数据
 * @param array &$enemy  敌人数据
 * @return string 'continue' | 'victory' | 'defeat'
 */
function obl_battle_check_end(&$player, &$enemy) {
    if ((int)$player['hp'] <= 0) return 'defeat';
    if ((int)$enemy['hp'] <= 0) return 'victory';
    return 'continue';
}

/**
 * 结束战斗
 *
 * 清空 action, bid, oblpara['battle']（含先攻队列）。
 * 设置死亡方 state=1。
 * emit 'battle.end' 到 obl_log。
 * 保存双方数据。
 *
 * @param array  &$player 玩家数据
 * @param array  &$enemy  敌人数据
 * @param string $result  战斗结果：'victory' | 'defeat' | 'escape'
 */
function obl_battle_end(&$player, &$enemy, $result) {
    global $obl_log, $obl_battle_log;

    // 在清空状态前获取 turn（清空后 obl_battle_get_turn 返回 0，导致 battle.end 日志排序错误）
    $turn = obl_battle_get_turn($player);

    // 清空战斗状态
    $player['action'] = '';
    $player['bid']    = 0;
    $enemy['action']  = '';
    $enemy['bid']     = 0;

    obl_battle_clear_state($player);
    obl_battle_clear_state($enemy);

    // 设置死亡状态
    if ($result === 'victory') {
        $enemy['state'] = 1;
        $enemy['hp']    = 0;
    } elseif ($result === 'defeat') {
        $player['state'] = 1;
        $player['hp']    = 0;
    }

    // emit 战斗摘要日志（obl_log）
    $obl_log->emit('battle.end', 'battle', array(
        'enemy_name' => $enemy['name'],
        'enemy_pid'  => $enemy['pid'],
        'result'     => $result,
    ));

    // emit 战斗细节日志（obl_battle_log）— 让前端能在战斗日志区显示战斗结果
    $result_name = array(
        'victory' => '胜利',
        'defeat'  => '失败',
        'escape'  => '逃跑',
    );
    $obl_battle_log->emit(
        $turn,
        'system',
        'battle.end',
        '战斗结束',
        $result,
        0,
        array('result' => $result, 'result_name' => isset($result_name[$result]) ? $result_name[$result] : $result),
        null,
        (int)$enemy['pid']
    );

    // 逃跑成功时设置标志：跳过本次命令的 tick 推进
    // 理由：逃跑是防御性脱战动作，不应消耗时间，否则 NPC 会在同 tick 内再次遭遇玩家
    if ($result === 'escape') {
        $player['oblpara']['escape_skip_tick'] = true;
    }

    // 保存双方数据
    obl_save_player($player);
    obl_save_player($enemy);
}
