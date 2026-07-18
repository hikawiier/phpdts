<?php
/**
 * @module E 游戏逻辑
 * @framework E-11 天与昼夜相位派生层
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 天与昼夜相位派生层 / Day & Day-Night Cycle
//
// 在刻（tick）之上建立宏观时间语义：
//   - 天（day）：由若干刻组成的宏观时间单位，从 1 开始递增
//   - 昼夜相位（phase）：一天内的时段标记，'day'（昼）/ 'night'（夜）
//
// 派生公式（纯函数）：
//   - day = floor(tick / day_length_ticks) + 1
//   - phase = (tick % day_length_ticks) < day_phase_ticks ? 'day' : 'night'
//
// 事件钩子机制：
//   - day_started  ：夜→昼切换时触发（同时为新一天的开始）
//   - night_started：昼→夜切换时触发
//   - day_changed  ：天数递增时触发（与 day_started 同时触发，但作为独立事件）
//
// 监听器签名：function(array $transition): void
//   $transition = [
//     'from' => ['day' => N,   'phase' => 'day'|'night'],
//     'to'   => ['day' => N+1, 'phase' => 'day'|'night'],
//     'tick' => T,  // 触发事件时的当前 tick
//   ]
//
// 设计原则：
//   - 天与相位都是 tick 的派生纯函数，不引入新的时间单位
//   - 事件在 tick 推进调用栈内同步触发，不引入异步队列
//   - 监听器机制与 E-1 tick 监听器机制平行存在（独立注册表，独立调度）
//   - 推进时序：obl_tick_advance() 末尾调用 obl_day_advance_hook()
// ================================================================

#=============================================================================
# 模块 1：纯函数推导（无副作用，可重入）
#=============================================================================

/**
 * 读取天与昼夜配置（带静态缓存）
 *
 * @return array{day_length:int, day_phase:int}
 */
function obl_day_get_config() {
    static $cfg = null;
    if ($cfg !== null) return $cfg;

    $raw = function_exists('obl_get_config') ? obl_get_config() : array();
    $day_length = isset($raw['day_length_ticks']) ? (int)$raw['day_length_ticks'] : 120;
    $day_phase = isset($raw['day_phase_ticks']) ? (int)$raw['day_phase_ticks'] : 80;

    // 配置校验：day_phase 必须严格小于 day_length，否则回退默认值
    if ($day_length <= 0 || $day_phase <= 0 || $day_phase >= $day_length) {
        $day_length = 120;
        $day_phase = 80;
    }

    $cfg = array('day_length' => $day_length, 'day_phase' => $day_phase);
    return $cfg;
}

/**
 * 从 tick 推导天与相位（纯函数）
 *
 * @param int $tick 当前 tick
 * @return array{day:int, phase:string}
 */
function obl_day_compute($tick) {
    $tick = max(0, (int)$tick);
    $cfg = obl_day_get_config();
    $day = (int)floor($tick / $cfg['day_length']) + 1;
    $in_day = ($tick % $cfg['day_length']) < $cfg['day_phase'];
    $phase = $in_day ? 'day' : 'night';
    return array('day' => $day, 'phase' => $phase);
}

#=============================================================================
# 模块 2：读取接口
#=============================================================================

/**
 * 获取当前游戏天
 *
 * @return int
 */
function obl_day_get() {
    global $gamevars;
    return isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1;
}

/**
 * 获取当前昼夜相位
 *
 * @return string 'day' | 'night'
 */
function obl_day_phase_get() {
    global $gamevars;
    $phase = isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : 'day';
    return ($phase === 'night') ? 'night' : 'day';
}

#=============================================================================
# 模块 3：监听器注册与调度
#=============================================================================

// 初始化监听器注册表（确保事件顺序）
if (!isset($GLOBALS['obl_day_listeners'])) {
    $GLOBALS['obl_day_listeners'] = array(
        'day_started'   => array(),
        'night_started' => array(),
        'day_changed'   => array(),
    );
}

/**
 * 注册天/相位事件监听器
 *
 * @param string   $event 事件名（day_started / night_started / day_changed）
 * @param callable $cb    监听器回调，签名：function(array $transition): void
 * @return void
 */
function obl_day_register_listener($event, $cb) {
    $event = (string)$event;
    if (!isset($GLOBALS['obl_day_listeners'][$event])) {
        $GLOBALS['obl_day_listeners'][$event] = array();
    }
    $GLOBALS['obl_day_listeners'][$event][] = $cb;
}

/**
 * 获取指定事件的所有监听器
 *
 * @param string $event
 * @return array
 */
function obl_day_get_listeners($event) {
    return isset($GLOBALS['obl_day_listeners'][$event])
        ? $GLOBALS['obl_day_listeners'][$event]
        : array();
}

/**
 * 触发事件（同步执行所有监听器，捕获异常防扩散）
 *
 * @param string $event
 * @param array  $transition
 * @return void
 */
function obl_day_emit($event, $transition) {
    global $obl_error_log;

    $listeners = obl_day_get_listeners($event);
    foreach ($listeners as $cb) {
        try {
            call_user_func($cb, $transition);
        } catch (Throwable $e) {
            if (isset($obl_error_log) && $obl_error_log) {
                $obl_error_log->emit('day_cycle.listener.error', array(
                    'event' => $event,
                    'error' => $e->getMessage(),
                    'file'  => $e->getFile(),
                    'line'  => $e->getLine(),
                ), 'api');
            }
        }
    }
}

#=============================================================================
# 模块 4：tick 推进时的相位更新钩子
#=============================================================================

/**
 * tick 推进后的相位/天数变化检测与事件触发
 *
 * 由 obl_tick_advance() 末尾调用。流程：
 *   1. 用 obl_day_compute($new_tick) 推导新的 (day, phase)
 *   2. 与 $gamevars['obl_day'] / $gamevars['obl_phase'] 比较
 *   3. 若相位变化：触发 day_started 或 night_started 事件
 *   4. 若天数变化：触发 day_changed 事件
 *   5. 更新 $gamevars['obl_day'] / $gamevars['obl_phase']
 *
 * 事件触发顺序：
 *   - 夜→昼且天数递增：先 night_started? 不可能（夜→昼是同一相位内的"夜→昼"切换，
 *     即从 night 跨到 day，按相位先后触发 night_started 不合理；
 *     正确顺序：先触发 day_started（进入新一天昼），再触发 day_changed）
 *   - 昼→夜：触发 night_started（天数不变）
 *   - 同相位但天数递增：仅可能发生在 phase_length==0 退化情况，正常配置下不会出现
 *
 * @return void
 */
function obl_day_advance_hook() {
    global $gamevars;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();
    $tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;

    $new = obl_day_compute($tick);
    $old_day = isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : $new['day'];
    $old_phase = isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : $new['phase'];

    $transition = array(
        'from' => array('day' => $old_day, 'phase' => $old_phase),
        'to'   => array('day' => $new['day'], 'phase' => $new['phase']),
        'tick' => $tick,
    );

    // 相位切换：触发 phase_started 事件
    if ($old_phase !== $new['phase']) {
        if ($new['phase'] === 'day') {
            obl_day_emit('day_started', $transition);
        } else {
            obl_day_emit('night_started', $transition);
        }
    }

    // 天数递增：触发 day_changed 事件
    // 注：day_changed 与 day_started 在夜→昼跨天场景下同时触发，
    // 顺序为 day_started → day_changed（先相位事件，再天数事件）
    if ($new['day'] > $old_day) {
        obl_day_emit('day_changed', $transition);
    }

    $gamevars['obl_day'] = $new['day'];
    $gamevars['obl_phase'] = $new['phase'];
}

#=============================================================================
# 模块 5：批量推进时的多事件触发（多 tick 推进时跨多天）
#=============================================================================

/**
 * 批量推进时的天数事件回放
 *
 * 当 delta > 1 且跨过多天时，对每一天触发 day_changed 事件。
 * 用于 wild_refresh 等"按天订阅"的监听器在多 tick 推进时不丢失刷新。
 *
 * 调用方：tick 监听器（如 obl_tick_phase_refresh_wild_items）在 delta > 1 时
 * 调用本函数，按天数循环回放 day_changed 事件。
 *
 * 注意：本函数不会修改 $gamevars['obl_day']（已由 obl_day_advance_hook 在每次
 * tick 推进时维护），仅用于"补发"天数事件给需要按天循环处理的监听器。
 *
 * @param int $from_tick 起始 tick（推进前）
 * @param int $to_tick   目标 tick（推进后）
 * @return void
 */
function obl_day_replay_day_changed_events($from_tick, $to_tick) {
    $from_tick = max(0, (int)$from_tick);
    $to_tick = max(0, (int)$to_tick);
    if ($to_tick <= $from_tick) return;

    $cfg = obl_day_get_config();
    $day_length = $cfg['day_length'];

    // 推导起止天
    $from_day = (int)floor($from_tick / $day_length) + 1;
    $to_day = (int)floor($to_tick / $day_length) + 1;

    if ($to_day <= $from_day) return;

    // 对每一天触发 day_changed 事件
    for ($d = $from_day + 1; $d <= $to_day; $d++) {
        $transition = array(
            'from' => array('day' => $d - 1, 'phase' => 'night'),
            'to'   => array('day' => $d, 'phase' => 'day'),
            'tick' => ($d - 1) * $day_length,  // 该天切换发生时的 tick
        );
        obl_day_emit('day_changed', $transition);
    }
}
