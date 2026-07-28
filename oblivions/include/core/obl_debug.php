<?php
/**
 * @module A API 层
 * @framework A-5 调试工具框架
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions A-5 调试工具框架 / Debug Tool Framework
//
// 在 ?debug=all 守卫下提供调试命令与状态查询能力，用于实际游玩验证：
//   - debug.* 命令：游戏状态快捷变更（推进 tick / 触发事件 / 给予道具等）
//   - debug_* state scope：完整状态查看（POI 全图 / 玩家完整 / gamevars）
//
// 守卫机制：所有 debug.* 命令和 debug_* scope 都要求 ?debug=all 才生效，
// 正常模式调用返回 DEBUG_MODE_REQUIRED 错误，零生产环境影响。
//
// 命令合约注册：obl_debug_command_contracts() 由 B-1 合约聚合调用
// 命令分发路由：obl_debug_command_dispatch() 由 B-3 命令总线调用
// 状态分发路由：obl_debug_state_dispatch() 由 A-3 状态分发调用
//
// 设计原则：
//   - 调试工具与游戏框架正交，不影响正式命令/状态语义
//   - 守卫在前，所有调试入口必须先通过 obl_debug_enabled() 检查
//   - 复用现有 tick / day_cycle / item 系统原语，不绕过领域规则
//   - 命令合约标记 debug_only=true，跳过 required_capabilities 校验
// ================================================================

/**
 * 检查 ?debug=all 守卫是否启用
 *
 * 所有 debug.* 命令和 debug_* state scope 都必须通过此函数守卫。
 * 检查逻辑：$_GET['debug'] 包含 'all' 标识（与前端 vex-vue/src/utils/debug-flags.ts 对齐）
 *
 * @return bool
 */
function obl_debug_enabled() {
    static $enabled = null;
    if ($enabled !== null) return $enabled;

    $debug = isset($_GET['debug']) ? (string)$_GET['debug'] : '';
    if ($debug === '') {
        $enabled = false;
        return $enabled;
    }
    $flags = array_map('trim', explode(',', strtolower($debug)));
    $enabled = in_array('all', $flags, true);
    return $enabled;
}

/**
 * 注册 debug.* 命令合约
 *
 * 由 obl_command_contract.php 的 obl_command_contracts() 合并调用。
 * 标记 debug_only=true，跳过 required_capabilities 校验。
 *
 * @return array
 */
function obl_debug_command_contracts() {
    return array(
        'debug.advance_tick' => array(
            'legacy' => 'debug_advance_tick',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            // 调试命令不走标准 advances_tick 流程（不触发 NPC AI / pending battle actor），
            // 由 debug handler 直接循环调用 obl_tick_advance() 触发 day_changed 等事件。
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'ticks' => array('type' => 'int', 'required' => true, 'min' => 1),
            ),
            'refresh' => array('player_info', 'game_map', 'tile_actions'),
        ),
        'debug.advance_to_phase' => array(
            'legacy' => 'debug_advance_to_phase',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'target' => array('type' => 'string', 'required' => true),
            ),
            'refresh' => array('player_info', 'game_map', 'tile_actions'),
        ),
        'debug.trigger_day_changed' => array(
            'legacy' => 'debug_trigger_day_changed',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'to_day' => array('type' => 'int', 'required' => true, 'min' => 1),
            ),
            'refresh' => array('player_info', 'game_map', 'tile_actions'),
        ),
        'debug.give_item' => array(
            'legacy' => 'debug_give_item',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'item_id' => array('type' => 'string', 'required' => true),
                'count' => array('type' => 'int', 'required' => false, 'min' => 1),
            ),
            'refresh' => array('player_inventory'),
        ),
        'debug.reset_position' => array(
            'legacy' => 'debug_reset_position',
            'ui_mode' => 'explore',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'pgroup' => array('type' => 'int', 'required' => true, 'min' => 0),
                'pls' => array('type' => 'int', 'required' => true, 'min' => 0),
            ),
            'refresh' => array('player_info', 'game_map', 'tile_actions'),
        ),
        'debug.snapshot.save' => array(
            'legacy' => 'debug_snapshot_save',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'read_only' => true,
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(),
            'refresh' => array(),
        ),
        'debug.snapshot.restore' => array(
            'legacy' => 'debug_snapshot_restore',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(),
            'refresh' => array('player_info', 'game_map', 'tile_actions', 'enemies', 'player_inventory'),
        ),
        'debug.snapshot.clear' => array(
            'legacy' => 'debug_snapshot_clear',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'read_only' => true,
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(),
            'refresh' => array(),
        ),
        'debug.enemy.spawn' => array(
            'legacy' => 'debug_enemy_spawn',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'enemy_type' => array('type' => 'int', 'required' => true, 'min' => 1),
                'pgroup' => array('type' => 'int', 'required' => false, 'min' => 0),
                'pls' => array('type' => 'int', 'required' => false, 'min' => 0),
                'discovered' => array('type' => 'int', 'required' => false, 'min' => 0, 'max' => 1),
            ),
            'refresh' => array('enemies', 'game_map'),
        ),
        'debug.actor.set' => array(
            'legacy' => 'debug_actor_set',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'pid' => array('type' => 'int', 'required' => true, 'min' => 1),
                'pgroup' => array('type' => 'int', 'required' => false, 'min' => 0),
                'pls' => array('type' => 'int', 'required' => false, 'min' => 0),
                'hp' => array('type' => 'int', 'required' => false, 'min' => 0),
                'sp' => array('type' => 'int', 'required' => false, 'min' => 0),
                'ap' => array('type' => 'int', 'required' => false, 'min' => 0),
                'state' => array('type' => 'int', 'required' => false, 'min' => 0),
                'discovered' => array('type' => 'int', 'required' => false, 'min' => 0, 'max' => 1),
            ),
            'refresh' => array('player_info', 'enemies', 'game_map'),
        ),
        'debug.mechanism.reset' => array(
            'legacy' => 'debug_mechanism_reset',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'mechanism' => array('type' => 'string', 'required' => true),
            ),
            'refresh' => array('player_info', 'enemies', 'game_map', 'tile_actions'),
        ),
        'debug.scenario.prepare' => array(
            'legacy' => 'debug_scenario_prepare',
            'ui_mode' => 'debug',
            'allowed_actions' => array('', null),
            'advances_tick' => false,
            'itm0_allowed' => true,
            'debug_only' => true,
            'payload_schema' => array(
                'scenario' => array('type' => 'string', 'required' => true),
                'enemy_type' => array('type' => 'int', 'required' => false, 'min' => 1),
            ),
            'refresh' => array('player_info', 'enemies', 'game_map', 'tile_actions'),
        ),
    );
}

/**
 * debug.* 命令分发入口
 *
 * 由 obl_command_handler_dispatch() 在 default 之前调用。
 * 调用前需通过 obl_debug_enabled() 守卫检查。
 *
 * @param string $command
 * @param array  $payload
 * @param array  &$pdata
 * @return array ['ok' => bool, 'code'?: string, 'data'?: array]
 */
function obl_debug_command_dispatch($command, $payload, &$pdata) {
    switch ($command) {
        case 'debug.advance_tick':
            return obl_debug_advance_tick($payload, $pdata);
        case 'debug.advance_to_phase':
            return obl_debug_advance_to_phase($payload, $pdata);
        case 'debug.trigger_day_changed':
            return obl_debug_trigger_day_changed($payload, $pdata);
        case 'debug.give_item':
            return obl_debug_give_item($payload, $pdata);
        case 'debug.reset_position':
            return obl_debug_reset_position($payload, $pdata);
        case 'debug.snapshot.save':
            return obl_debug_snapshot_save($pdata);
        case 'debug.snapshot.restore':
            return obl_debug_snapshot_restore($pdata);
        case 'debug.snapshot.clear':
            return obl_debug_snapshot_clear();
        case 'debug.enemy.spawn':
            return obl_debug_enemy_spawn($payload, $pdata);
        case 'debug.actor.set':
            return obl_debug_actor_set($payload, $pdata);
        case 'debug.mechanism.reset':
            return obl_debug_mechanism_reset($payload, $pdata);
        case 'debug.scenario.prepare':
            return obl_debug_scenario_prepare($payload, $pdata);
    }
    return array('ok' => false, 'code' => 'UNKNOWN_DEBUG_COMMAND');
}

/**
 * debug_* state scope 分发入口
 *
 * 由 obl_state_dispatch() 在 switch 前调用。
 * 调用前需通过 obl_debug_enabled() 守卫检查。
 *
 * @param string $scope
 * @param array  $ctx
 * @return array
 */
function obl_debug_state_dispatch($scope, $ctx) {
    switch ($scope) {
        case 'debug_poi_all':
            return obl_debug_state_poi_all($ctx);
        case 'debug_player_full':
            return obl_debug_state_player_full($ctx);
        case 'debug_gamevars':
            return obl_debug_state_gamevars($ctx);
        case 'debug_console':
            return obl_debug_state_console($ctx);
        case 'debug_diag_log':
            return obl_debug_state_diag_log($ctx);
    }
    obl_state_throw('UNKNOWN_SCOPE', '未知 debug scope: ' . $scope);
}

// ================================================================
// 命令实现
// ================================================================

/**
 * debug.advance_tick 命令实现
 *
 * 通过循环调用 obl_tick_advance() 推进 N 个 tick：
 *   - 每次 obl_tick_advance 都会触发 obl_day_advance_hook
 *   - 跨天时自动触发 day_started / night_started / day_changed 事件
 *   - E-12 POI 耐久清理监听器会自动响应 day_changed 事件
 *
 * 注：与正式命令不同，debug.advance_tick 不触发 tick dispatch（NPC AI），
 * 仅推进 tick 计数器与相位/天数派生。用于快速验证 POI 耐久、昼夜切换。
 *
 * @param array $payload {ticks: int 1-2000}
 * @param array &$pdata
 * @return array
 */
function obl_debug_advance_tick($payload, &$pdata) {
    global $gamevars, $obl_log;

    $ticks = (int)$payload['ticks'];
    if ($ticks < 1 || $ticks > 2000) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'ticks_out_of_range', 'min' => 1, 'max' => 2000));
    }

    $before_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $before_day = isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1;
    $before_phase = isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : 'day';

    for ($i = 0; $i < $ticks; $i++) {
        obl_tick_advance();
    }

    $after_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $after_day = isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1;
    $after_phase = isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : 'day';

    if (function_exists('obl_runtime_save_tick_globals')) {
        obl_runtime_save_tick_globals();
    }

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('debug.advance_tick', 'debug', array(
            'before_tick'  => $before_tick,
            'after_tick'   => $after_tick,
            'before_day'   => $before_day,
            'after_day'    => $after_day,
            'before_phase' => $before_phase,
            'after_phase'  => $after_phase,
            'ticks'        => $ticks,
        ));
    }

    return array('ok' => true, 'data' => array(
        'before_tick'  => $before_tick,
        'after_tick'   => $after_tick,
        'before_day'   => $before_day,
        'after_day'    => $after_day,
        'before_phase' => $before_phase,
        'after_phase'  => $after_phase,
        'ticks'        => $ticks,
    ));
}

/**
 * debug.advance_to_phase 命令实现
 *
 * 推进到下一昼夜边界：
 *   - target=day      : 推进到下一昼相位开始（下一天的 tick = day_length * N）
 *   - target=night    : 推进到下一夜相位开始（当前天的 tick = day_length*N + day_phase）
 *   - target=next_day : 推进到下一天的同一相位（tick += day_length）
 *
 * @param array $payload {target: 'day'|'night'|'next_day'}
 * @param array &$pdata
 * @return array
 */
function obl_debug_advance_to_phase($payload, &$pdata) {
    global $gamevars, $obl_log;

    $target = (string)$payload['target'];
    if (!in_array($target, array('day', 'night', 'next_day'), true)) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'invalid_target', 'allowed' => array('day', 'night', 'next_day')));
    }

    $cfg = obl_day_get_config();
    $day_length = (int)$cfg['day_length'];
    $day_phase = (int)$cfg['day_phase'];

    $cur_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;

    if ($target === 'day') {
        // 下一昼开始：向上取整到 day_length 倍数
        $target_tick = (int)(ceil(max($cur_tick + 1, 1) / $day_length) * $day_length);
    } elseif ($target === 'night') {
        // 下一夜开始：当前昼则本日夜，当前夜则下一天夜
        $cur_in_day = $cur_tick % $day_length;
        if ($cur_in_day < $day_phase) {
            $target_tick = $cur_tick - $cur_in_day + $day_phase;
        } else {
            $target_tick = $cur_tick - $cur_in_day + $day_length + $day_phase;
        }
    } else {  // next_day
        $target_tick = $cur_tick + $day_length;
    }

    $delta = $target_tick - $cur_tick;
    if ($delta <= 0) {
        return array('ok' => false, 'code' => 'INVALID_TARGET', 'details' => array('reason' => 'non_positive_delta', 'delta' => $delta));
    }
    if ($delta > 2000) {
        return array('ok' => false, 'code' => 'INVALID_TARGET', 'details' => array('reason' => 'delta_too_large', 'delta' => $delta, 'max' => 2000));
    }

    $before_tick = $cur_tick;
    $before_day = isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1;
    $before_phase = isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : 'day';

    for ($i = 0; $i < $delta; $i++) {
        obl_tick_advance();
    }

    $after_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $after_day = isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1;
    $after_phase = isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : 'day';

    if (function_exists('obl_runtime_save_tick_globals')) {
        obl_runtime_save_tick_globals();
    }

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('debug.advance_to_phase', 'debug', array(
            'target'       => $target,
            'before_tick'  => $before_tick,
            'after_tick'   => $after_tick,
            'before_day'   => $before_day,
            'after_day'    => $after_day,
            'before_phase' => $before_phase,
            'after_phase'  => $after_phase,
            'delta'        => $delta,
        ));
    }

    return array('ok' => true, 'data' => array(
        'target'       => $target,
        'before_tick'  => $before_tick,
        'after_tick'   => $after_tick,
        'before_day'   => $before_day,
        'after_day'    => $after_day,
        'before_phase' => $before_phase,
        'after_phase'  => $after_phase,
        'delta'        => $delta,
    ));
}

/**
 * debug.trigger_day_changed 命令实现
 *
 * 推进 tick 到目标天的起始（tick = (to_day - 1) * day_length），再调用
 * obl_day_advance_hook() 让 day/phase 自然派生。这样既保持 day_changed 事件触发
 * （E-12 POI 耐久清理监听器据此清理过期 POI），又保证 obl_day 持久化正确——
 * 下一次 tick 推进时 obl_day_compute(tick) 不会重新覆盖设置值。
 *
 * 流程：
 *   1. 推进 $gamevars['obl_tick'] = (to_day - 1) * day_length（目标天的昼起始）
 *   2. 调用 obl_day_advance_hook() 让 day/phase 自然派生（触发 day_changed 事件）
 *   3. 持久化 gamevars
 *
 * 设计权衡：相比"直接设置 obl_day + emit day_changed"的旧实现，本方案推进 tick
 * 后让 day_cycle 派生层统一计算，符合"复用现有 tick / day_cycle / item 系统原语"
 * 设计原则，避免 obl_day 与 tick 派生不一致。
 *
 * @param array $payload {to_day: int >= 1}
 * @param array &$pdata
 * @return array
 */
function obl_debug_trigger_day_changed($payload, &$pdata) {
    global $gamevars, $obl_log;

    $to_day = (int)$payload['to_day'];
    $from_day = isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1;

    $cfg = obl_day_get_config();
    $day_length = (int)$cfg['day_length'];

    // 推进 tick 到目标天的昼起始：(to_day - 1) * day_length
    // to_day=1 → tick=0；to_day=2 → tick=day_length；以此类推
    $target_tick = ($to_day - 1) * $day_length;
    $gamevars['obl_tick'] = $target_tick;

    // 调用 obl_day_advance_hook() 让 day/phase 自然派生
    // 钩子内部比较新旧 day/phase，触发 day_started/night_started/day_changed 事件
    // 并更新 $gamevars['obl_day'] / $gamevars['obl_phase']
    obl_day_advance_hook();

    if (function_exists('obl_runtime_save_tick_globals')) {
        obl_runtime_save_tick_globals();
    }

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('debug.trigger_day_changed', 'debug', array(
            'from_day' => $from_day,
            'to_day'   => $to_day,
        ));
    }

    return array('ok' => true, 'data' => array(
        'from_day' => $from_day,
        'to_day'   => $to_day,
    ));
}

/**
 * debug.give_item 命令实现
 *
 * 从 item_table 实例化 N 个道具，逐个经 itm0 → organize 放入背包。
 * 背包满则掉到地上（复用 F-7 obl_drop_item_to_ground）。
 *
 * @param array $payload {item_id: string, count?: int 1-99}
 * @param array &$pdata
 * @return array
 */
function obl_debug_give_item($payload, &$pdata) {
    global $obl_log;

    $item_id = (string)$payload['item_id'];
    $count = isset($payload['count']) ? (int)$payload['count'] : 1;
    if ($count < 1 || $count > 99) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD', 'details' => array('reason' => 'count_out_of_range', 'min' => 1, 'max' => 99));
    }

    $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    if (!isset($item_table[$item_id])) {
        return array('ok' => false, 'code' => 'ITEM_NOT_FOUND', 'details' => array('item_id' => $item_id));
    }
    $template = $item_table[$item_id];

    $stored_count = 0;
    $dropped_count = 0;

    for ($i = 0; $i < $count; $i++) {
        $new_item = array(
            'itmid'   => $item_id,
            'itm'     => '',
            'itmk'    => isset($template['itmk']) ? (string)$template['itmk'] : '',
            'itme'    => isset($template['itme']) ? (int)$template['itme'] : 0,
            'itms'    => isset($template['itms']) ? (string)$template['itms'] : '1',
            'itmsk'   => isset($template['itmsk']) ? (string)$template['itmsk'] : '',
            'itmpara' => isset($template['itmpara']) ? (string)$template['itmpara'] : '',
        );

        if (function_exists('obl_put_item_to_itm0') && obl_put_item_to_itm0($pdata, $new_item)) {
            if (function_exists('obl_organize_inventory') && obl_organize_inventory($pdata)) {
                $stored_count++;
                continue;
            }
            // organize 失败 → 解除 itm0 占用，落到地面
            unset($pdata['itempara'][0]);
        }

        if (function_exists('obl_drop_item_to_ground')) {
            obl_drop_item_to_ground($pdata, $new_item);
            $dropped_count++;
        }
    }

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('debug.give_item', 'debug', array(
            'item_id'       => $item_id,
            'requested'     => $count,
            'stored_count'  => $stored_count,
            'dropped_count' => $dropped_count,
        ));
    }

    return array('ok' => true, 'data' => array(
        'item_id'       => $item_id,
        'requested'     => $count,
        'stored_count'  => $stored_count,
        'dropped_count' => $dropped_count,
    ));
}

/**
 * debug.reset_position 命令实现
 *
 * 直接修改 $pdata 的 pgroup/pls（obl_save_player 由命令总线 after_dispatch 触发）。
 *
 * @param array $payload {pgroup: int, pls: int}
 * @param array &$pdata
 * @return array
 */
function obl_debug_reset_position($payload, &$pdata) {
    global $obl_log;

    $pgroup = (int)$payload['pgroup'];
    $pls = (int)$payload['pls'];

    $old_pgroup = (int)$pdata['pgroup'];
    $old_pls = (int)$pdata['pls'];

    $pdata['pgroup'] = $pgroup;
    $pdata['pls'] = $pls;

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('debug.reset_position', 'debug', array(
            'from' => array('pgroup' => $old_pgroup, 'pls' => $old_pls),
            'to'   => array('pgroup' => $pgroup, 'pls' => $pls),
        ));
    }

    return array('ok' => true, 'data' => array(
        'from' => array('pgroup' => $old_pgroup, 'pls' => $old_pls),
        'to'   => array('pgroup' => $pgroup, 'pls' => $pls),
    ));
}

function obl_debug_snapshot_tables() {
    return array('oblbattle_state', 'oblgame', 'oblmapitem', 'oblmappoi', 'oblmapstates', 'oblplayers', 'oblqueue');
}

function obl_debug_snapshot_path() {
    global $tablepre;
    $dir = GAME_ROOT . './oblivions/cache/debug-snapshots';
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        throw new RuntimeException('Cannot create debug snapshot directory');
    }
    return $dir . '/room_' . substr(hash('sha256', (string)$tablepre), 0, 24) . '.json';
}

function obl_debug_snapshot_read() {
    $path = obl_debug_snapshot_path();
    if (!is_file($path)) return null;
    $size = filesize($path);
    if ($size === false || $size <= 0 || $size > 32 * 1024 * 1024) {
        throw new RuntimeException('Invalid debug snapshot size');
    }
    $json = file_get_contents($path);
    $snapshot = $json === false ? null : json_decode($json, true);
    if (!is_array($snapshot) || (int)($snapshot['version'] ?? 0) !== 1 || !isset($snapshot['tables']) || !is_array($snapshot['tables'])) {
        throw new RuntimeException('Invalid debug snapshot format');
    }
    return $snapshot;
}

function obl_debug_snapshot_meta() {
    $snapshot = obl_debug_snapshot_read();
    if (!$snapshot) return array('exists' => false);
    return array(
        'exists' => true,
        'created_at' => (int)($snapshot['created_at'] ?? 0),
        'player_pid' => (int)($snapshot['player_pid'] ?? 0),
        'room' => (string)($snapshot['room'] ?? ''),
        'row_counts' => isset($snapshot['row_counts']) && is_array($snapshot['row_counts']) ? $snapshot['row_counts'] : array(),
    );
}

function obl_debug_snapshot_save(&$pdata) {
    global $db, $tablepre, $groomid;
    $tables = array();
    $counts = array();
    foreach (obl_debug_snapshot_tables() as $table) {
        $rows = array();
        $result = $db->query("SELECT * FROM {$tablepre}{$table} ORDER BY 1");
        while ($result && ($row = $db->fetch_array($result))) $rows[] = $row;
        $tables[$table] = $rows;
        $counts[$table] = count($rows);
    }
    $snapshot = array(
        'version' => 1,
        'room' => (string)$groomid,
        'table_prefix' => (string)$tablepre,
        'player_pid' => (int)($pdata['pid'] ?? 0),
        'created_at' => time(),
        'row_counts' => $counts,
        'tables' => $tables,
    );
    $json = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) throw new RuntimeException('Cannot encode debug snapshot');
    $path = obl_debug_snapshot_path();
    $tmp = $path . '.' . getmypid() . '.tmp';
    if (file_put_contents($tmp, $json, LOCK_EX) === false) throw new RuntimeException('Cannot write debug snapshot');
    if (!@rename($tmp, $path)) {
        @unlink($path);
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            throw new RuntimeException('Cannot replace debug snapshot');
        }
    }
    return array('ok' => true, 'data' => array('snapshot' => obl_debug_snapshot_meta()));
}

function obl_debug_snapshot_restore(&$pdata) {
    global $db, $tablepre;
    $snapshot = obl_debug_snapshot_read();
    if (!$snapshot) return array('ok' => false, 'code' => 'DEBUG_SNAPSHOT_NOT_FOUND');
    if ((string)($snapshot['table_prefix'] ?? '') !== (string)$tablepre) {
        return array('ok' => false, 'code' => 'DEBUG_SNAPSHOT_ROOM_MISMATCH');
    }
    foreach (obl_debug_snapshot_tables() as $table) {
        if (!array_key_exists($table, $snapshot['tables']) || !is_array($snapshot['tables'][$table])) {
            return array('ok' => false, 'code' => 'DEBUG_SNAPSHOT_INVALID');
        }
    }
    foreach (array('oblqueue', 'oblbattle_state', 'oblmapitem', 'oblmappoi', 'oblmapstates', 'oblplayers', 'oblgame') as $table) {
        $db->query("DELETE FROM {$tablepre}{$table}");
    }
    foreach (obl_debug_snapshot_tables() as $table) {
        foreach ($snapshot['tables'][$table] as $row) {
            if (is_array($row)) $db->array_insert("{$tablepre}{$table}", $row);
        }
    }
    if (function_exists('obl_runtime_reload_tick_globals')) obl_runtime_reload_tick_globals();
    $restored = obl_fetch_playerdata_by_pid((int)($snapshot['player_pid'] ?? 0));
    if (!$restored) return array('ok' => false, 'code' => 'DEBUG_SNAPSHOT_PLAYER_MISSING', 'rollback' => true);
    obl_format_playerdata($restored);
    $pdata = $restored;
    return array('ok' => true, 'data' => array(
        'snapshot' => obl_debug_snapshot_meta(),
        'player' => obl_debug_actor_summary($pdata),
    ));
}

function obl_debug_snapshot_clear() {
    $path = obl_debug_snapshot_path();
    if (is_file($path) && !@unlink($path)) throw new RuntimeException('Cannot remove debug snapshot');
    return array('ok' => true, 'data' => array('snapshot' => array('exists' => false)));
}

function obl_debug_actor_summary($actor) {
    return array(
        'pid' => (int)($actor['pid'] ?? 0),
        'type' => (int)($actor['type'] ?? 0),
        'name' => (string)($actor['name'] ?? ''),
        'pgroup' => (int)($actor['pgroup'] ?? 0),
        'pls' => (int)($actor['pls'] ?? 0),
        'hp' => (int)($actor['hp'] ?? 0),
        'mhp' => (int)($actor['mhp'] ?? 0),
        'sp' => (int)($actor['sp'] ?? 0),
        'msp' => (int)($actor['msp'] ?? 0),
        'ap' => (int)($actor['ap'] ?? 0),
        'max_ap' => (int)($actor['max_ap'] ?? 0),
        'action' => (string)($actor['action'] ?? ''),
        'bid' => (int)($actor['bid'] ?? 0),
        'state' => (int)($actor['state'] ?? 0),
        'discovered' => (int)($actor['discovered'] ?? 0),
    );
}

function obl_debug_find_available_neighbor($pgroup, $pls, $exclude_pid = 0) {
    global $db, $tablepre;
    $map = obl_get_map_data($pgroup);
    $tiles = isset($map['tiles'][$pgroup]) ? $map['tiles'][$pgroup] : array();
    $neighbors = obl_get_tile_neighbors($pgroup, $pls);
    sort($neighbors, SORT_NUMERIC);
    foreach ($neighbors as $neighbor) {
        $neighbor = (int)$neighbor;
        if (empty($tiles[$neighbor]['passable'])) continue;
        $result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE pgroup='" . (int)$pgroup . "' AND pls='{$neighbor}' AND state=0 AND pid!='" . (int)$exclude_pid . "' LIMIT 1");
        if (!$result || !$db->num_rows($result)) return $neighbor;
    }
    return false;
}

function obl_debug_enemy_spawn($payload, &$pdata) {
    global $db, $tablepre;
    $enemy_type = (int)$payload['enemy_type'];
    $pgroup = array_key_exists('pgroup', $payload) ? (int)$payload['pgroup'] : (int)$pdata['pgroup'];
    $pls = array_key_exists('pls', $payload) ? (int)$payload['pls'] : obl_debug_find_available_neighbor($pgroup, (int)$pdata['pls']);
    if ($pls === false) return array('ok' => false, 'code' => 'DEBUG_NO_AVAILABLE_TILE');
    $map = obl_get_map_data($pgroup);
    if (empty($map['tiles'][$pgroup][$pls]['passable'])) return array('ok' => false, 'code' => 'DEBUG_TILE_NOT_PASSABLE');
    if (obl_is_tile_occupied_by_others($pgroup, $pls, 0)) return array('ok' => false, 'code' => 'DEBUG_TILE_OCCUPIED');
    $pid = obl_create_enemy_record($enemy_type, $pgroup, $pls);
    if (!$pid) return array('ok' => false, 'code' => 'DEBUG_ENEMY_TYPE_NOT_FOUND');
    $discovered = array_key_exists('discovered', $payload) ? (int)$payload['discovered'] : 1;
    $db->query("UPDATE {$tablepre}oblplayers SET discovered='{$discovered}' WHERE pid='" . (int)$pid . "'");
    $enemy = obl_fetch_playerdata_by_pid((int)$pid);
    return array('ok' => true, 'data' => array('enemy' => obl_debug_actor_summary($enemy ?: array())));
}

function obl_debug_actor_set($payload, &$pdata) {
    global $db, $tablepre;
    $pid = (int)$payload['pid'];
    $allowed = array('pgroup', 'pls', 'hp', 'sp', 'ap', 'state', 'discovered');
    $sets = array();
    foreach ($allowed as $field) {
        if (array_key_exists($field, $payload)) $sets[] = "`{$field}`='" . (int)$payload[$field] . "'";
    }
    if (empty($sets)) return array('ok' => false, 'code' => 'INVALID_PAYLOAD');
    $db->query("UPDATE {$tablepre}oblplayers SET " . implode(',', $sets) . " WHERE pid='{$pid}'");
    $actor = obl_fetch_playerdata_by_pid($pid);
    if (!$actor) return array('ok' => false, 'code' => 'ACTOR_NOT_FOUND');
    if ($pid === (int)$pdata['pid']) {
        obl_format_playerdata($actor);
        $pdata = $actor;
    }
    return array('ok' => true, 'data' => array('actor' => obl_debug_actor_summary($actor)));
}

function obl_debug_reset_battle_state() {
    global $db, $tablepre;
    $db->query("DELETE FROM {$tablepre}oblqueue");
    $db->query("DELETE FROM {$tablepre}oblbattle_state");
    $db->query("UPDATE {$tablepre}oblplayers SET action='', bid=0, ap=max_ap");
}

function obl_debug_reset_vitals() {
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblplayers SET hp=mhp, sp=msp, ap=max_ap WHERE state=0");
}

function obl_debug_mechanism_reset($payload, &$pdata) {
    $mechanism = (string)$payload['mechanism'];
    if ($mechanism === 'battle' || $mechanism === 'all_transient') obl_debug_reset_battle_state();
    if ($mechanism === 'vitals' || $mechanism === 'all_transient') obl_debug_reset_vitals();
    if (!in_array($mechanism, array('battle', 'vitals', 'all_transient'), true)) {
        return array('ok' => false, 'code' => 'INVALID_PAYLOAD');
    }
    $fresh = obl_fetch_playerdata_by_pid((int)$pdata['pid']);
    if ($fresh) {
        obl_format_playerdata($fresh);
        $pdata = $fresh;
    }
    return array('ok' => true, 'data' => array('mechanism' => $mechanism, 'player' => obl_debug_actor_summary($pdata)));
}

function obl_debug_scenario_prepare($payload, &$pdata) {
    global $db, $tablepre;
    $scenario = (string)$payload['scenario'];
    if ($scenario !== 'adjacent_enemy') return array('ok' => false, 'code' => 'DEBUG_SCENARIO_NOT_FOUND');
    $enemy_type = isset($payload['enemy_type']) ? (int)$payload['enemy_type'] : 1;
    $result = $db->query("SELECT * FROM {$tablepre}oblplayers WHERE type='{$enemy_type}' AND state=0 ORDER BY pid LIMIT 1");
    $enemy = $result && $db->num_rows($result) ? $db->fetch_array($result) : null;
    $enemy_pid = $enemy ? (int)$enemy['pid'] : 0;
    $target_pls = obl_debug_find_available_neighbor((int)$pdata['pgroup'], (int)$pdata['pls'], $enemy_pid);
    if ($target_pls === false) return array('ok' => false, 'code' => 'DEBUG_NO_AVAILABLE_TILE');
    obl_debug_reset_battle_state();
    obl_debug_reset_vitals();
    if (!$enemy_pid) {
        $enemy_pid = obl_create_enemy_record($enemy_type, (int)$pdata['pgroup'], (int)$target_pls);
        if (!$enemy_pid) return array('ok' => false, 'code' => 'DEBUG_ENEMY_TYPE_NOT_FOUND', 'rollback' => true);
    }
    $db->query("UPDATE {$tablepre}oblplayers SET pgroup='" . (int)$pdata['pgroup'] . "', pls='" . (int)$target_pls . "', hp=mhp, sp=msp, ap=max_ap, action='', bid=0, state=0, discovered=1 WHERE pid='" . (int)$enemy_pid . "'");
    $fresh_player = obl_fetch_playerdata_by_pid((int)$pdata['pid']);
    if ($fresh_player) {
        obl_format_playerdata($fresh_player);
        $pdata = $fresh_player;
    }
    $fresh_enemy = obl_fetch_playerdata_by_pid((int)$enemy_pid);
    return array('ok' => true, 'data' => array(
        'scenario' => $scenario,
        'player' => obl_debug_actor_summary($pdata),
        'enemy' => obl_debug_actor_summary($fresh_enemy ?: array()),
    ));
}

// ================================================================
// 状态查询实现
// ================================================================

/**
 * debug_poi_all scope：全图 POI 完整字段
 *
 * 返回所有 POI 实例行，含 E-12 耐久字段：
 *   placed_by_pid / placed_at_day / ttl_days / ttl_remaining_days / dismantle_returns
 *
 * @param array $ctx
 * @return array
 */
function obl_debug_state_poi_all($ctx) {
    global $db, $tablepre;

    $pois = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblmappoi ORDER BY pgroup, pls, iaid");
    if ($result) {
        $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
        $current_day = function_exists('obl_day_get') ? (int)obl_day_get() : 0;

        while ($row = $db->fetch_array($result)) {
            $poi_id = isset($row['poi_id']) ? (string)$row['poi_id'] : '';
            $tpl = isset($poi_table[$poi_id]) ? $poi_table[$poi_id] : null;

            $ttl_days = (int)(isset($row['ttl_days']) ? $row['ttl_days'] : 0);
            $placed_at_day = (int)(isset($row['placed_at_day']) ? $row['placed_at_day'] : 0);
            $ttl_remaining = ($ttl_days > 0)
                ? max(0, $placed_at_day + $ttl_days - $current_day)
                : null;

            $pois[] = array(
                'iaid'                   => (int)$row['iaid'],
                'poi_id'                 => $poi_id,
                'pgroup'                 => (int)$row['pgroup'],
                'pls'                    => (int)$row['pls'],
                'state'                  => isset($row['state']) ? (string)$row['state'] : 'idle',
                'searched'               => !empty($row['searched']),
                'search_count'           => (int)(isset($row['search_count']) ? $row['search_count'] : 0),
                'search_count_remaining' => (int)(isset($row['search_count_remaining']) ? $row['search_count_remaining'] : -1),
                'cooldown_until_turn'    => (int)(isset($row['cooldown_until_turn']) ? $row['cooldown_until_turn'] : 0),
                // E-12 耐久字段
                'placed_by_pid'          => (int)(isset($row['placed_by_pid']) ? $row['placed_by_pid'] : 0),
                'placed_at_day'          => $placed_at_day,
                'ttl_days'               => $ttl_days,
                'ttl_remaining_days'     => $ttl_remaining,
                // F-7 拆除返还配置（模板层）
                'dismantle_returns'      => (is_array($tpl) && isset($tpl['dismantle_returns']) && is_array($tpl['dismantle_returns']))
                    ? $tpl['dismantle_returns']
                    : array(),
                // 模板属性（便于调试时识别 POI 类型）
                'name'                   => (is_array($tpl) && isset($tpl['name'])) ? (string)$tpl['name'] : '',
                'searchable'             => (is_array($tpl) && !empty($tpl['searchable'])),
                'mechanic'               => (is_array($tpl) && isset($tpl['mechanic'])) ? (string)$tpl['mechanic'] : '',
            );
        }
    }

    return obl_state_response_success(array(
        'pois'        => $pois,
        'total'       => count($pois),
        'current_day' => function_exists('obl_day_get') ? (int)obl_day_get() : 0,
    ));
}

/**
 * debug_player_full scope：完整玩家数据
 *
 * 返回当前玩家完整数据（含 itempara/tacpara/skillpara/oblpara JSON 字段、
 * 装备字段、HP/SP/AP 等），用于调试时核对玩家状态。
 *
 * @param array $ctx
 * @return array
 */
function obl_debug_state_player_full($ctx) {
    $pdata = obl_state_require_player();
    return obl_state_response_success(array(
        'player' => $pdata,
    ));
}

/**
 * debug_gamevars scope：完整 gamevars + 派生时间字段
 *
 * 返回 $gamevars 完整内容，并补充派生时间字段：
 *   tick / processed_tick / day / phase / next_phase / next_phase_tick / ticks_to_next_phase
 *
 * @param array $ctx
 * @return array
 */
function obl_debug_state_gamevars($ctx) {
    global $gamevars;

    if (!isset($gamevars) || !is_array($gamevars)) $gamevars = array();

    $cfg = function_exists('obl_day_get_config') ? obl_day_get_config() : array('day_length' => 120, 'day_phase' => 80);
    $day_length = isset($cfg['day_length']) ? (int)$cfg['day_length'] : 120;
    $day_phase = isset($cfg['day_phase']) ? (int)$cfg['day_phase'] : 80;

    $tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $cur_in_day = $tick % $day_length;
    $cur_phase = ($cur_in_day < $day_phase) ? 'day' : 'night';
    if ($cur_phase === 'day') {
        $next_phase_tick = $tick - $cur_in_day + $day_phase;
        $next_phase = 'night';
    } else {
        $next_phase_tick = $tick - $cur_in_day + $day_length;
        $next_phase = 'day';
    }

    return obl_state_response_success(array(
        'gamevars' => $gamevars,
        'derived'  => array(
            'tick'                => $tick,
            'processed_tick'      => isset($gamevars['obl_pretick']) ? (int)$gamevars['obl_pretick'] : 0,
            'day'                 => isset($gamevars['obl_day']) ? (int)$gamevars['obl_day'] : 1,
            'phase'               => isset($gamevars['obl_phase']) ? (string)$gamevars['obl_phase'] : 'day',
            'day_length'          => $day_length,
            'day_phase'           => $day_phase,
            'cur_in_day'          => $cur_in_day,
            'next_phase'          => $next_phase,
            'next_phase_tick'     => $next_phase_tick,
            'ticks_to_next_phase' => $next_phase_tick - $tick,
        ),
    ));
}

function obl_debug_state_console($ctx) {
    global $db, $tablepre;
    $pdata = obl_state_require_player();
    $enemies = array();
    $result = $db->query("SELECT pid,type,name,pgroup,pls,hp,mhp,sp,msp,ap,max_ap,action,bid,state,discovered FROM {$tablepre}oblplayers WHERE type>0 ORDER BY pid");
    while ($result && ($row = $db->fetch_array($result))) $enemies[] = obl_debug_actor_summary($row);
    $config = array();
    $obl_enemies_config = include GAME_ROOT . './oblivions/gamedata/enemies_config.php';
    foreach (($obl_enemies_config ?? array()) as $type => $enemy) {
        $config[] = array('type' => (int)$type, 'name' => (string)($enemy['name'] ?? ''));
    }
    return obl_state_response_success(array(
        'snapshot' => obl_debug_snapshot_meta(),
        'player' => obl_debug_actor_summary($pdata),
        'enemies' => $enemies,
        'enemy_types' => $config,
        'scenarios' => array('adjacent_enemy'),
        'mechanisms' => array('battle', 'vitals', 'all_transient'),
    ));
}

/**
 * debug_diag_log scope：读取诊断日志并按多维度筛选
 *
 * A-5 调试工具框架下的诊断日志查询通道，受 ?debug=all 守卫保护。
 * 与 obl_log（玩家事件）/ obl_error_log（运行时错误）物理隔离，
 * 专供调试期诊断信息查询（含正常流程诊断，用于排查"为什么没触发"类问题）。
 *
 * 参数（通过 $_GET，A-5-2 加固设计案 §3.5 增强）：
 *   - category:    粗粒度分类筛选（如 "navigate" / "move" / "tick"），默认返回全部
 *   - id:          按 ID 精确匹配或前缀通配（如 "nav.interrupt" 或 "nav.*"）
 *   - request_uid: 按请求关联过滤（跨请求追溯某次前端操作的后端事件链）
 *   - since_seq:   增量游标，返回 seq > since_seq 的条目（同请求内单调递增）
 *   - since_ts_ms: 时间戳过滤（辅助，按毫秒时间戳过滤）
 *   - lines:       返回尾部条数（默认 200，上限 1000）
 *
 * 返回结构（A-5-2 加固）：
 *   - matched_total: 满足过滤条件的总条数（未应用 lines 裁剪前）
 *   - returned:      本次返回条数
 *   - has_more:      是否还有更多（matched_total > returned）
 *   - next_since_seq: 下次增量查询的游标（返回条目中最大 seq，无条目时不变）
 *
 * @param array $ctx
 * @return array
 */
function obl_debug_state_diag_log($ctx) {
    global $groomid;

    $pdata = obl_state_require_player();
    $pid = (int)$pdata['pid'];

    $category = isset($_GET['category']) ? trim((string)$_GET['category']) : '';
    $id_filter = isset($_GET['id']) ? trim((string)$_GET['id']) : '';
    $request_uid = isset($_GET['request_uid']) ? trim((string)$_GET['request_uid']) : '';
    $since_seq = isset($_GET['since_seq']) ? max(0, (int)$_GET['since_seq']) : 0;
    $since_ts_ms = isset($_GET['since_ts_ms']) ? max(0, (int)$_GET['since_ts_ms']) : 0;
    $lines = isset($_GET['lines']) ? max(1, min(1000, (int)$_GET['lines'])) : 200;

    $entries = obl_diag_log_load($groomid, $pid);

    // 多维度过滤
    $filtered = array();
    foreach ($entries as $entry) {
        // category 精确匹配
        if ($category !== '' && (!isset($entry['category']) || $entry['category'] !== $category)) continue;
        // id 精确匹配或前缀通配
        if ($id_filter !== '') {
            $entry_id = isset($entry['id']) ? (string)$entry['id'] : '';
            if ($entry_id !== $id_filter) {
                // 前缀通配 nav.* 匹配 nav. 开头的所有 ID
                if (substr($id_filter, -2) === '.*') {
                    $prefix = substr($id_filter, 0, -1); // 保留尾部点
                    if (strpos($entry_id, $prefix) !== 0) continue;
                } else {
                    continue;
                }
            }
        }
        // request_uid 精确匹配
        if ($request_uid !== '' && (!isset($entry['request_uid']) || $entry['request_uid'] !== $request_uid)) continue;
        // since_seq 增量游标
        if ($since_seq > 0 && (!isset($entry['seq']) || (int)$entry['seq'] <= $since_seq)) continue;
        // since_ts_ms 时间戳过滤
        if ($since_ts_ms > 0 && (!isset($entry['ts_ms']) || (int)$entry['ts_ms'] <= $since_ts_ms)) continue;
        $filtered[] = $entry;
    }

    $matched_total = count($filtered);

    // 取尾部 N 条
    $returned_entries = array_slice($filtered, -$lines);

    // 计算 next_since_seq（返回条目中最大 seq）
    $next_since_seq = $since_seq;
    foreach ($returned_entries as $entry) {
        if (isset($entry['seq']) && (int)$entry['seq'] > $next_since_seq) {
            $next_since_seq = (int)$entry['seq'];
        }
    }

    return obl_state_response_success(array(
        'available'     => true,
        'matched_total' => $matched_total,
        'returned'      => count($returned_entries),
        'has_more'      => $matched_total > count($returned_entries),
        'next_since_seq' => $next_since_seq,
        'filter'        => array(
            'category'     => $category,
            'id'           => $id_filter,
            'request_uid'  => $request_uid,
            'since_seq'    => $since_seq,
            'since_ts_ms'  => $since_ts_ms,
            'lines'        => $lines,
        ),
        'entries'       => $returned_entries,
    ));
}
