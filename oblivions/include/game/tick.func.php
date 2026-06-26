<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 游戏刻（Tick）核心模块
//
// 职责：
// - tick 存储与推进（obl_tick / obl_pretick）
// - 标记管理（请求推进 / 消费推进）
// - 监听器注册与调度（三阶段：battle_npc / idle_npc / post）
// - 命令推进判定（白名单）
//
// 设计原则：
// - tick 是时间驱动层，与玩家数据层（player.func.php）正交
// - 推进策略（何时推进）与推进机制（如何推进）分离
// - 监听器机制：业务系统注册监听器，tick 模块不硬编码业务分支
// - 持久化统一由调用方负责（common.inc.php 末尾 / obl_command.php 显式调用）
//   tick 模块只修改内存中的 $gamevars，通过 $ginfochange 标记通知调用方
// ================================================================
// 依赖：player.func.php + enemy_ai.func.php（由 obl_bootstrap.php 统一加载）

#=============================================================================
# 模块 1：标记管理
#=============================================================================
# 封装"请求推进 tick"的标记，替代旧的 $obl_tick_advanced 引用传递。
# 监听器通过 obl_tick_request_advance() 请求推进，调度器统一消费。

/**
 * 请求推进 tick（监听器调用）
 *
 * battle_npc phase 的监听器执行了 NPC 回合后调用此函数，
 * 调度器末尾检测标记并推进 1 游戏刻。
 *
 * @return void
 */
function obl_tick_request_advance() {
    $GLOBALS['obl_tick_advance_requested'] = true;
}

/**
 * 消费"请求推进"标记（读取并清除）
 *
 * 调度器在 battle_npc phase 中调用，检测监听器是否请求推进。
 *
 * @return bool true=监听器请求推进，false=未请求
 */
function obl_tick_consume_advance() {
    $advanced = !empty($GLOBALS['obl_tick_advance_requested']);
    $GLOBALS['obl_tick_advance_requested'] = false;
    return $advanced;
}

/**
 * 重置"请求推进"标记（调度开始时调用）
 *
 * @return void
 */
function obl_tick_reset_advance() {
    $GLOBALS['obl_tick_advance_requested'] = false;
}

#=============================================================================
# 模块 2：推进控制
#=============================================================================
# 封装 obl_tick / obl_pretick 的读写，调用方不直接操作 $gamevars。

/**
 * 推进 1 游戏刻（obl_tick++）
 *
 * 修改内存中的 $gamevars['obl_tick'] 并设置 $ginfochange 标记，
 * 不直接调用 save_gameinfo()，持久化由调用方统一负责。
 *
 * 调用场景：
 * - obl_tick_dispatch() 末尾：NPC 回合执行后推进
 * - obl_command.php [F] 段：玩家行为推进
 *
 * @return void
 */
function obl_tick_advance() {
    global $gamevars, $ginfochange;
    if (!isset($gamevars['obl_tick'])) $gamevars['obl_tick'] = 0;
    $gamevars['obl_tick']++;
    $ginfochange = true;  // 通知 common.inc.php 末尾持久化
}

/**
 * 同步 obl_pretick = obl_tick（标记已处理的游戏刻）
 *
 * 由 common.inc.php 在调用 obl_resolve_tick_events() 之前调用。
 *
 * @return void
 */
function obl_tick_synchronize() {
    global $gamevars;
    if (isset($gamevars['obl_tick'])) {
        $gamevars['obl_pretick'] = $gamevars['obl_tick'];
    }
}

/**
 * 获取当前游戏刻
 *
 * @return int
 */
function obl_tick_get() {
    global $gamevars;
    return isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
}

/**
 * 获取已处理到的游戏刻
 *
 * @return int
 */
function obl_tick_get_pretick() {
    global $gamevars;
    return isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0;
}

#=============================================================================
# 模块 2b：战场忙检测（替代 NPC 待结算检测）
#=============================================================================
# 由状态机管辖，查询是否任何战场在 PROCESSING 状态。
# 状态机内部保证 PROCESSING → PLAYER_TURN 的过渡正确及时。

/**
 * 检测是否有战场正在处理中
 *
 * @return bool true=存在处理中战场，应拒绝推进 tick 的玩家命令
 */
function obl_tick_has_busy_battle() {
    if (function_exists('obl_battle_state_has_busy_battle')) {
        return obl_battle_state_has_busy_battle();
    }
    return false;
}

/** @deprecated 使用 obl_tick_has_busy_battle */
function obl_tick_is_pending_npc() {
    return obl_tick_has_busy_battle();
}

#=============================================================================
# 模块 3：命令推进判定（从 player.func.php 迁移）
#=============================================================================

/**
 * 判断命令是否推进游戏刻（白名单机制）
 *
 * 规则：只有白名单内的命令才推进 tick。
 * 白名单 = 明确消耗时间/影响世界状态的行为。
 *
 * 当前白名单：
 * - move              玩家移动
 * - obl_explore       玩家原地探索（点亮迷雾+发现道具）
 * - obl_search        玩家搜索建筑物 POI
 * - obl_battle_start  玩家发起战斗（含玩家回合）
 * - obl_battle_action 玩家回合完成
 *
 * 设计原则：只有"玩家主动行动结束"才推进 tick。
 * NPC 回合由 obl_tick_dispatch() 末尾推进 tick（与玩家命令互斥）。
 *
 * @param string $command 命令名
 * @return bool true=推进 tick，false=不推进
 */
function obl_command_advances_tick($command) {
    $tick_commands = array(
        'move',             // 玩家移动
        'obl_explore',      // 玩家探索
        'obl_search',       // 玩家搜索建筑物
        'obl_battle_start',  // 玩家发起战斗（含玩家回合）
        'obl_battle_action', // 玩家回合完成
    );
    return in_array($command, $tick_commands, true);
}

#=============================================================================
# 模块 4：监听器注册
#=============================================================================
# 监听器注册表按 phase 分组，调度时按 phase 顺序执行。
#
# Phase 语义：
# - battle_npc：战斗中 NPC 回合（串行，最多 1 个监听器请求推进）
# - idle_npc  ：非战斗 NPC AI 行为（并行，所有监听器都执行）
# - post      ：tick 后处理（技能 CD、buff 等，预留扩展）

/**
 * 注册 tick 事件监听器
 *
 * @param string   $phase 阶段名（battle_npc / idle_npc / post）
 * @param callable $cb    监听器回调，签名：function(int $delta, array &$ctx): void
 * @return void
 */
function obl_tick_register_listener($phase, $cb) {
    if (!isset($GLOBALS['obl_tick_listeners'][$phase])) {
        $GLOBALS['obl_tick_listeners'][$phase] = array();
    }
    $GLOBALS['obl_tick_listeners'][$phase][] = $cb;
}

/**
 * 获取指定阶段的所有监听器
 *
 * @param string $phase 阶段名
 * @return array 监听器回调数组
 */
function obl_tick_get_listeners($phase) {
    return isset($GLOBALS['obl_tick_listeners'][$phase])
        ? $GLOBALS['obl_tick_listeners'][$phase]
        : array();
}

#=============================================================================
# 模块 5：事件调度
#=============================================================================

/**
 * 调度 tick 事件（三阶段处理）
 *
 * 阶段顺序：
 *   1. battle_npc（串行）：战斗中 NPC 回合，最多 1 个监听器请求推进
 *   2. idle_npc（并行）  ：非战斗 NPC AI 行为，所有监听器都执行
 *   3. post（串行）      ：tick 后处理（技能 CD 等），所有监听器都执行
 *
 * 末尾：如果 battle_npc phase 请求推进，调用 obl_tick_advance() 推进 1 游戏刻。
 *
 * 监听器签名：function(int $delta, array &$ctx): void
 *   - $delta：待处理的 tick 差值（obl_tick - obl_pretick 同步前的值）
 *   - $ctx：调度上下文，结构：
 *     [
 *       'player'   => &array,  // 当前玩家数据（引用）
 *       'advanced' => bool,    // 是否请求推进 tick（battle_npc phase 有效）
 *     ]
 *
 * @param int   $delta 待处理的 tick 差值
 * @param array &$ctx  调度上下文（引用传递）
 * @return void
 */
function obl_tick_dispatch($delta, &$ctx) {
    global $obl_error_log;
    obl_tick_reset_advance();

    try {
        // 阶段 1：战斗 NPC 回合（串行，最多 1 个监听器请求推进）
        $battle_npc_listeners = obl_tick_get_listeners('battle_npc');
        foreach ($battle_npc_listeners as $cb) {
            call_user_func_array($cb, array(&$delta, &$ctx));
            if (obl_tick_consume_advance()) {
                $ctx['advanced'] = true;
                break;  // 最多处理 1 个 NPC 回合
            }
        }

        // 阶段 2：非战斗 NPC AI 行为（并行，所有监听器都执行）
        foreach (obl_tick_get_listeners('idle_npc') as $cb) {
            call_user_func_array($cb, array(&$delta, &$ctx));
        }

        // 阶段 3：后处理（技能 CD 等，预留扩展）
        foreach (obl_tick_get_listeners('post') as $cb) {
            call_user_func_array($cb, array(&$delta, &$ctx));
        }
    } catch (Throwable $e) {
        // 异常兜底：记录错误日志，前端可通过下次请求了解到错误
        // 战斗状态机保持当前状态，下一次 tick dispatch 会重试处理
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('tick.dispatch.error', array(
                'error' => $e->getMessage(),
                'file'  => $e->getFile(),
                'line'  => $e->getLine(),
                'delta' => $delta,
            ), 'api');  // request 来源：tick 事件处理通常在 api_v2.php 请求中触发
        }
        return;  // 异常时不推进 tick，直接返回
    }

    // 末尾：统一推进 tick（如果 battle_npc phase 请求推进）
    if (!empty($ctx['advanced'])) {
        obl_tick_advance();
    }
}

/**
 * tick 事件处理入口（由 common.inc.php 调用）
 *
 * 流程：
 *   1. 抓取当前玩家数据（MVP 策略：只有 1 名玩家，从 $cuser 抓取）
 *   2. 构造调度上下文
 *   3. 调用 obl_tick_dispatch() 执行三阶段处理
 *
 * 调用前已由 common.inc.php 同步 obl_pretick = obl_tick。
 * 调用后由 common.inc.php 末尾根据 $ginfochange 持久化 gamevars。
 *
 * @param int $delta 待处理的 tick 差值（obl_tick - obl_pretick 同步前的值）
 * @return void
 */
function obl_resolve_tick_events($delta) {
    global $cuser, $obl_error_log;

    // 抓取当前玩家数据（MVP 策略：只有 1 名玩家）
    $player = obl_fetch_playerdata_by_name($cuser);
    if (!$player) {
        // 玩家数据抓取失败属于系统级异常（数据库问题或数据不一致），
        // 记录到错误日志，前端可通过 ?action=obl_error 感知，避免 tick 静默卡死。
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('tick.player_fetch.error', array(
                'user'  => $cuser,
                'delta' => $delta,
            ), 'api');
        }
        return;
    }

    $ctx = array(
        'player'   => &$player,
        'advanced' => false,
    );

    obl_tick_dispatch($delta, $ctx);
}

#=============================================================================
# 模块 6：内置监听器注册
#=============================================================================
# 集中注册内置监听器，便于总览所有 tick 事件处理逻辑。
# 第三方功能（如技能系统）可在其文件加载时注册 post phase 监听器。

// 初始化监听器注册表（确保 phase 顺序）
$GLOBALS['obl_tick_listeners'] = array(
    'battle_npc' => array(),
    'idle_npc'   => array(),
    'post'       => array(),
);

// 加载监听器实现（enemy_ai.func.php 定义两个内置监听器，由 obl_bootstrap.php 统一加载）

// 注册内置监听器
obl_tick_register_listener('battle_npc', 'obl_tick_phase_battle_npc');
obl_tick_register_listener('idle_npc',   'obl_tick_phase_idle_npc');
