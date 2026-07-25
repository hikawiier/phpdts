<?php
/**
 * @module B 命令系统
 * @framework B-3 命令总线执行管道
 * @framework A-5 调试工具框架
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

function obl_command_handler_dispatch($command, $payload, &$pdata) {
    switch ($command) {
        case 'map.move':
            obl_move($payload['to'], $pdata);
            break;
        case 'map.explore':
            // 设计案 §5.3 + §6.2 + §7.8：obl_explore 返回结构化结果，handler 透传 explore_outcome + info_result
            // info_result 携带 enemies_discovered/pois_discovered/items_discovered，供前端 dispatchAttention 派发反馈层
            $result = obl_explore($pdata);
            return array(
                'ok'   => true,
                'data' => array(
                    'explore_outcome' => isset($result['explore_outcome']) ? $result['explore_outcome'] : 'normal',
                    'info_result'     => isset($result['info_result']) ? $result['info_result'] : null,
                ),
            );
        case 'map.navigate':
            // 设计案 §3.4 + §6.2.1：高层导航命令，handler 内循环编排
            return obl_command_handler_map_navigate($payload, $pdata);
        case 'poi.search':
            // E-10 三档判定：先按 iaid 查 POI 实例 + 位置校验，再调用新签名 obl_search_poi($pdata, $poi, $tool_id, $skill_id)
            $iaid = (int)$payload['iaid'];
            $tool_id = isset($payload['tool_id']) ? (string)$payload['tool_id'] : null;
            $skill_id = isset($payload['skill_id']) ? (string)$payload['skill_id'] : null;
            $poi = obl_lookup_poi_for_search($iaid, $pdata);
            if ($poi === null) {
                // lookup 函数已 emit 错误日志（not_found / not_adjacent）
                break;
            }
            obl_search_poi($pdata, $poi, $tool_id, $skill_id);
            break;
        case 'poi.interact':
            // F-6 道具交互：复用 obl_lookup_poi_for_search 做位置校验，再调用 poi_interact 主流程
            obl_command_handler_poi_interact($payload, $pdata);
            break;
        case 'poi.dismantle':
            // F-7 玩家主动拆除 POI：复用 obl_lookup_poi_for_search 做位置校验，再调用 poi_dismantle 主流程
            obl_command_handler_poi_dismantle($payload, $pdata);
            break;
        case 'world.wait':
            global $obl_log;
            if (isset($obl_log) && $obl_log) $obl_log->emit('wait.success', 'world');
            break;
        case 'item.pickup':
            obl_pickup_item($payload['iid'], $pdata);
            break;
        case 'item.discard':
            obl_discard_item($payload['slot'], $pdata);
            break;
        case 'item.use':
            obl_command_handler_item_use($payload, $pdata);
            break;
        case 'item.equip':
            obl_command_handler_item_equip($payload, $pdata);
            break;
        case 'item.unequip':
            obl_command_handler_item_unequip($payload, $pdata);
            break;
        case 'item.swap_weapon':
            obl_command_handler_item_swap_weapon($payload, $pdata);
            break;
        case 'inventory.organize':
            obl_command_handler_inventory_organize($pdata);
            break;
        case 'craft.execute':
            $slots = isset($payload['slots']) ? $payload['slots'] : array();
            $workbench_materials = isset($payload['workbench_materials']) ? $payload['workbench_materials'] : array();
            item_craft($slots, $pdata, $workbench_materials);
            break;
        case 'battle.start':
            error_log("[combat_engine] routed to new system: battle.start (pid={$pdata['pid']})");
            $latest = obl_fetch_playerdata_by_pid_for_update((int)$pdata['pid']);
            if (!$latest) return array('ok' => false, 'code' => 'ACTOR_NOT_FOUND');
            obl_format_playerdata($latest);
            $pdata = $latest;
            return combat_start_battle($pdata, $payload['actions']);
        case 'battle.submit_turn':
            error_log("[combat_engine] routed to new system: battle.submit_turn (pid={$pdata['pid']})");
            $latest = obl_fetch_playerdata_by_pid_for_update((int)$pdata['pid']);
            if (!$latest) return array('ok' => false, 'code' => 'ACTOR_NOT_FOUND');
            obl_format_playerdata($latest);
            $pdata = $latest;
            $qid = (int)$payload['qid'];
            if ($qid !== (int)($pdata['bid'] ?? 0)) return array('ok' => false, 'code' => 'STALE_TURN');
            $claim = battle_turn_claim_player(
                $qid,
                (int)$pdata['pid'],
                (int)$payload['expected_turn_seq']
            );
            if (empty($claim['ok'])) return $claim;
            return combat_dispatch('player_turn', $pdata, $payload['actions'], array('turn' => $claim['turn']));
        case 'combat.can_engage':
            // L0 可达性查询：前端"点击敌人发起战斗"前的预判
            // 返回 reachable / max_attack_range / move_power / distance / reason
            $target_pid = (int)($payload['target_pid'] ?? 0);
            if ($target_pid <= 0) {
                return array('ok' => false, 'code' => 'INVALID_TARGET');
            }
            $target_data = obl_fetch_playerdata_by_pid($target_pid);
            if (!$target_data) {
                return array('ok' => true, 'data' => combat_engagement_not_visible_result());
            }
            $result = combat_can_engage($pdata, $target_data);
            return array('ok' => true, 'data' => $result);

        case 'combat.preview_single':
            // L1 即时校验：单次 action 合法性预判
            $act_id = (string)($payload['act_id'] ?? '');
            $aim_intent = $payload['aim_intent'] ?? ($payload['target_pid'] ?? null);
            if ($act_id === '' || $aim_intent === null) {
                return array('ok' => false, 'code' => 'INVALID_PARAMS');
            }
            $result = combat_preview_single($pdata, $act_id, $aim_intent);
            return array('ok' => true, 'data' => $result);

        case 'combat.preview_targets':
            $act_id = trim((string)($payload['act_id'] ?? ''));
            $prefix_actions = isset($payload['prefix_actions']) && is_array($payload['prefix_actions'])
                ? $payload['prefix_actions']
                : array();
            if (!empty($prefix_actions)) {
                $prefix_check = obl_command_validate_actions($prefix_actions);
                if (empty($prefix_check['ok'])) return array('ok' => false, 'code' => 'INVALID_ACTIONS');
                $prefix_actions = $prefix_check['value'];
            }
            $candidate_ids = isset($payload['candidate_ids']) && is_array($payload['candidate_ids'])
                ? $payload['candidate_ids']
                : array();
            return array('ok' => true, 'data' => combat_preview_targets($pdata, $act_id, $prefix_actions, $candidate_ids));

        case 'combat.preview_chain':
            // L2 动作链模拟：整条动作链预校验
            $actions = $payload['actions'] ?? [];
            $battle_cache = $payload['battle_cache'] ?? ['combatants' => [], 'tag_mutations' => []];
            if (!is_array($actions) || empty($actions)) {
                return array('ok' => false, 'code' => 'INVALID_ACTIONS');
            }
            $result = combat_preview_chain($pdata, $actions, $battle_cache);
            return array('ok' => true, 'data' => $result);

        // A-5 调试工具框架：debug.* 命令分发（需通过 ?debug=all 守卫）
        // debug 命令合约标记 debug_only=true，bus 跳过 required_capabilities 校验
        // 守卫在前：未启用调试模式时直接返回 DEBUG_MODE_REQUIRED，零生产环境影响
        default:
            if (strpos($command, 'debug.') === 0) {
                if (!function_exists('obl_debug_enabled') || !obl_debug_enabled()) {
                    return array('ok' => false, 'code' => 'DEBUG_MODE_REQUIRED');
                }
                return obl_debug_command_dispatch($command, $payload, $pdata);
            }
            return array('ok' => false, 'code' => 'UNKNOWN_COMMAND');
    }
    return array('ok' => true);
}

/**
 * map.navigate 命令 handler（设计案 §3.4 + §6.2.1）
 *
 * 高层导航命令的核心编排循环：
 *   1. obl_navigation_begin：初始化导航器 + 选目标
 *   2. 循环：
 *      a. obl_navigation_next_step → 选下一次原子移动目标（BFS 寻路）
 *      b. obl_perform_move_core → 执行原子移动（无副作用原语）
 *      c. obl_check_move_sp → 扣体力
 *      d. obl_mark_explored → 标记落点 explored
 *      e. obl_acquire_information → 统一信息获取（move 配置）
 *      f. obl_tick_orchestrator_advance_for_navigation_step → 推进 tick
 *      g. obl_navigation_check_interrupt → 检查中断
 *   3. 返回 navigation 结果（steps + outcome + final_position + presentation 批次）
 *
 * 设计案 §3.4 关键约束：
 *   - 每原子移动推进一个 tick（通过 advance_for_navigation_step）
 *   - B-3 save_and_tick 通过 internal_tick_advances=true 跳过 tick 推进，仅做最终保存
 *   - 部分完成（规则中断）：已完成移动 + tick 是权威事实，立即保留
 *
 * 中断语义（设计案 §6.6 + §3.5）：
 *   - no_target / arrived / max_steps_reached / route_invalid / move_failed /
 *     enemy_discovered / poi_discovered / no_sp / capability_lost → ok=true, 结构化 outcome
 *   - 起始前体力完全不足（无法启动任何移动）→ ok=false, code=NO_SP
 *
 * 不自动执行的行为（设计案 §7.6）：
 *   - 不自动调用 combat.start/poi.search/poi.interact/poi.dismantle/item.pickup
 *   - 不自动执行区域切换（obl_switch_region）
 *   - 抵达目标后停止，交还控制
 *
 * @param array $payload 命令 payload（target/tendency/max_steps）
 * @param array &$pdata  玩家数据
 * @return array ['ok' => bool, 'data' => [...], 'code' => string|null]
 */
function obl_command_handler_map_navigate($payload, &$pdata) {
    global $obl_log;
    error_log("[NAV_DEBUG] nav_begin: pid={$pdata['pid']} payload=" . json_encode($payload) . " cur_pgroup={$pdata['pgroup']} cur_pls={$pdata['pls']} sp={$pdata['sp']}");

    // 1. 初始化导航器（解析 payload + 选目标）
    $navigation = obl_navigation_begin($payload, $pdata);
    $navigation['navigation_id'] = isset($GLOBALS['obl_command_operation_key'])
        ? (string)$GLOBALS['obl_command_operation_key'] : '';

    // 1.1 无目标 / 目标无效 / 已在目标格 → ok=true, tick_advanced=false
    // 设计案 §6.6：NAV_NO_TARGET / target_invalid / arrived 都返回 ok=true
    if (!empty($navigation['finished'])) {
        // emit 日志供前端 Toast 显示（设计案 §6.4 前端模板）
        if (isset($obl_log) && $obl_log) {
            if ($navigation['outcome'] === 'no_target') {
                $obl_log->emit('navigate.no_target', 'navigate');
            } elseif ($navigation['outcome'] === 'interrupted' && $navigation['outcome_reason'] === 'target_invalid') {
                $obl_log->emit('navigate.no_target', 'navigate', array('reason' => 'target_invalid'));
            }
        }
        return array(
            'ok'   => true,
            'data' => array(
                'tick_advanced' => false,
                'navigation'    => obl_command_build_navigation_result(
                    $navigation, $pdata, array(), array()
                ),
            ),
        );
    }

    // 2. 起始前体力检查（无法启动任何移动时 → NO_SP 错误）
    // 设计案 §6.6：NO_SP 在"无法启动"时 ok=false, code=NO_SP
    // （与"中途体力不足"的 ok=true 部分完成不同，§3.5）
    $cfg = obl_get_config();
    $move_sp_cost = (int)($cfg['move_sp_cost'] ?? 0);
    if ($move_sp_cost > 0 && (int)$pdata['sp'] < $move_sp_cost) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('navigate.no_sp', 'navigate');
        }
        return array('ok' => false, 'code' => 'NO_SP');
    }

    $steps = array();
    $presentation_events = array();
    $event_seq = 0;
    $tick_advanced = false;
    $move_power = obl_get_move_power($pdata);
    $cur_pgroup = (int)$pdata['pgroup'];

    // 3. 导航循环（设计案 §3.4 handler 内循环）
    while (!$navigation['finished']) {
        // 3.1 选下一次原子移动目标（BFS 寻路，基于当前权威状态）
        $step = obl_navigation_next_step($navigation, $pdata);
        if ($step === null) {
            // 无下一步：判定原因
            if ($navigation['steps_taken'] >= $navigation['max_steps']) {
                $navigation['finished'] = true;
                $navigation['outcome'] = 'max_steps_reached';
                $navigation['outcome_reason'] = 'max_steps_reached';
            } elseif (!$navigation['finished']) {
                // 有目标但无路线 → route_invalid
                $navigation['finished'] = true;
                $navigation['outcome'] = 'interrupted';
                $navigation['outcome_reason'] = 'route_invalid';
            }
            break;
        }

        // 3.2 执行原子移动原语（无副作用，仅修改 pls）
        $move_result = obl_perform_move_core($pdata, $step['to_pls'], $move_power);
        if (!$move_result['success']) {
            // 原子移动失败：记录 move_failed step，中断导航
            // 设计案 §6.6：move_failed 记录为 step，outcome=interrupted（ok=true）
            $steps[] = array(
                'seq'    => $step['seq'],
                'kind'   => 'move_failed',
                'reason' => $move_result['reason'],
                'from'   => array('pgroup' => $cur_pgroup, 'pls' => $step['from_pls']),
                'to'     => array('pgroup' => $cur_pgroup, 'pls' => $step['to_pls']),
            );
            $navigation['finished'] = true;
            $navigation['outcome'] = 'interrupted';
            $navigation['outcome_reason'] = $move_result['reason'];
            break;
        }

        // 3.3 扣体力（move.func.php 现有逻辑）
        obl_check_move_sp($pdata, $move_result['distance']);

        // 3.4 标记 explored（落点确认，设计案 §4.6：仅落点写）
        obl_mark_explored($pdata['pgroup'], $pdata['pls']);

        // 3.5 统一信息获取（move 配置）
        $info_result = obl_acquire_information(
            $pdata['pgroup'], $pdata['pls'], $pdata,
            obl_get_info_config('move')
        );

        // 3.6 推进 tick（设计案 §3.4：每原子移动一个 tick，原子提交保证不回滚）
        $tick_status = obl_tick_orchestrator_advance_for_navigation_step($pdata, $step);
        $tick_advanced = true;

        // 3.7 写移动日志（B-4 复用现有 move.success / move.tile_desc）
        if (isset($obl_log) && $obl_log) {
            $map = obl_get_map_data($cur_pgroup);
            $tiles = $map['tiles'][$cur_pgroup] ?? array();
            $from_tile = $tiles[$step['from_pls']] ?? array();
            $to_tile = $tiles[$step['to_pls']] ?? array();
            $obl_log->emit('move.success', 'move', array(
                'from' => obl_tile_log_params($from_tile),
                'to'   => obl_tile_log_params($to_tile),
            ));
            $obl_log->emit('move.tile_desc', 'move', obl_tile_log_params($to_tile));
        }

        // 3.8 收集 step 结果（设计案 §6.3 navigation.steps[] 结构）
        $step_entry = array(
            'seq'  => $step['seq'],
            'kind' => 'move',
            'from' => array('pgroup' => $cur_pgroup, 'pls' => $step['from_pls']),
            'to'   => array('pgroup' => $cur_pgroup, 'pls' => $step['to_pls']),
            'tick' => (int)$tick_status['tick'],
            'info' => array(
                'fog_cleared'        => $info_result['fog_cleared'],
                'items_discovered'   => $info_result['items_discovered'],
                'enemies_discovered' => $info_result['enemies_discovered'],
                'pois_discovered'    => $info_result['pois_discovered'],
            ),
        );
        $steps[] = $step_entry;

        // 3.9 收集 presentation 事件（设计案 §6.4：navigation_seq 供 K-9 有序消费）
        $presentation_events[] = array(
            'event_seq'      => ++$event_seq,
            'navigation_seq' => $step['seq'],
            'type'           => 'move',
            'actor_id'       => 'player:' . (int)$pdata['pid'],
            'from'           => $step_entry['from'],
            'to'             => $step_entry['to'],
            'tick'           => $step_entry['tick'],
        );
        $presentation_events[] = array(
            'event_seq'      => ++$event_seq,
            'navigation_seq' => $step['seq'],
            'type'           => 'info_acquired',
            'fog_cleared'    => $info_result['fog_cleared'],
            'items'          => $info_result['items_discovered'],
            'enemies'        => $info_result['enemies_discovered'],
            'pois'           => $info_result['pois_discovered'],
        );

        // 3.9.1 收集 tick_frame 中的领域事件（设计案 §4.4：tick_changed_scope + tick_domain_event）
        //    改造点4：advance_for_navigation_step 返回的 tick_frame 包含 NPC 行动、战斗启动等领域事件
        //    按 K-9 inbox 顺序身份契约追加到 presentation_events（event_seq + navigation_seq 双重序号）
        if (isset($tick_status['tick_frame']) && is_array($tick_status['tick_frame'])) {
            $tick_frame = $tick_status['tick_frame'];
            // 收集 changed_scopes（tick 结算引起的前端 scope 刷新）
            if (!empty($tick_frame['changed_scopes'])) {
                foreach ($tick_frame['changed_scopes'] as $scope) {
                    $presentation_events[] = array(
                        'event_seq'      => ++$event_seq,
                        'navigation_seq' => $step['seq'],
                        'type'           => 'tick_changed_scope',
                        'tick'           => (int)$tick_status['tick'],
                        'scope'          => $scope,
                    );
                }
            }
            // 收集 phases 中的领域事件（NPC 移动、战斗启动等）
            if (!empty($tick_frame['phases'])) {
                foreach ($tick_frame['phases'] as $phase) {
                    if (!empty($phase['events'])) {
                        foreach ($phase['events'] as $domain_event) {
                            $presentation_events[] = array(
                                'event_seq'      => ++$event_seq,
                                'navigation_seq' => $step['seq'],
                                'type'           => 'tick_domain_event',
                                'tick'           => (int)$tick_status['tick'],
                                'domain'         => $phase['name'],
                                'event'          => $domain_event['event'],
                                'payload'        => $domain_event['payload'],
                            );
                        }
                    }
                }
            }
        }

        // 3.10 检查中断（设计案 §3.4 步骤 8, §7.3 + §8.1 中断语义）
        // 设计案 §8.1：中断是最后一次移动的属性，不作为独立 step
        // 示意：移动 3：C → D，发现敌人，导航中断 —— 中断附在第 3 次移动上
        $interrupt = obl_navigation_check_interrupt($navigation, $pdata, $info_result);
        if ($interrupt !== null) {
            // arrived 是正常完成（设计案 §6.3 outcome 枚举），不附加 interrupt 信息
            // 其他中断（enemy_discovered / poi_discovered / force_combat / no_sp / capability_lost）作为
            // 最后一个 move step 的 interrupt 字段附加，避免 seq 重复和"中断 step 无 from/to"歧义
            if ($interrupt['reason'] !== 'arrived') {
                $last_step_idx = count($steps) - 1;
                if ($last_step_idx >= 0) {
                    $steps[$last_step_idx]['interrupt'] = array(
                        'reason'  => $interrupt['reason'],
                        'tick'    => (int)$tick_status['tick'],
                        'details' => $interrupt['details'],
                    );
                }
                $presentation_events[] = array(
                    'event_seq'      => ++$event_seq,
                    'navigation_seq' => $step['seq'],
                    'type'           => 'navigation_interrupted',
                    'reason'         => $interrupt['reason'],
                );
            }
            break;
        }
    }

    // 4. emit 导航结果日志（设计案 §6.4 前端模板：navigate.no_route / navigate.interrupt）
    // 这些日志供前端 Toast 显示；由于对应的 feedback_rule 未加入（§6.6 要求 ok=true），
    // 不会触发 feedback 错误转换，响应保持 ok=true 结构化结果
    if (isset($obl_log) && $obl_log) {
        if ($navigation['outcome'] === 'interrupted') {
            if ($navigation['outcome_reason'] === 'route_invalid') {
                $obl_log->emit('navigate.no_route', 'navigate');
            } else {
                // 其他中断原因：move_failed / enemy_discovered / poi_discovered /
                // force_combat / no_sp / capability_lost / max_steps_reached
                $obl_log->emit('navigate.interrupt', 'navigate', array(
                    'reason' => $navigation['outcome_reason'],
                ));
            }
        }
    }

    // 5. 返回导航结果（设计案 §6.3 + §6.6）
    // 导航完成/中断都是 ok=true；tick_advanced 仅在循环内实际推进过 tick 时为 true
    return array(
        'ok'   => true,
        'data' => array(
            'tick_advanced' => $tick_advanced,
            'navigation'    => obl_command_build_navigation_result(
                $navigation, $pdata, $steps, $presentation_events
            ),
            'presentation'  => array(
                'schema'    => 'presentation.v1',
                'batch_seq' => 0,
                'events'    => $presentation_events,
            ),
        ),
    );
}

/**
 * 构造 navigation 响应结构（设计案 §6.3）
 *
 * @param array $navigation 导航器状态
 * @param array &$pdata     玩家数据（读取最终权威位置）
 * @param array $steps      已完成的步骤列表
 * @param array $presentation_events presentation 事件列表
 * @return array navigation 响应结构
 */
function obl_command_build_navigation_result($navigation, &$pdata, $steps, $presentation_events) {
    error_log("[NAV_DEBUG] build_result: outcome=" . ($navigation['outcome'] ?? 'null') . " outcome_reason=" . ($navigation['outcome_reason'] ?? 'null') . " steps_count=" . count($steps ?? []) . " requested_target_pls=" . ($navigation['requested_target_pls'] ?? 'null') . " target_pls=" . ($navigation['target_pls'] ?? 'null') . " final_pgroup={$pdata['pgroup']} final_pls={$pdata['pls']} steps_taken=" . ($navigation['steps_taken'] ?? 0) . " max_steps=" . ($navigation['max_steps'] ?? 0));
    return array(
        'navigation_id'  => $navigation['navigation_id'],
        'steps'          => $steps,
        'final_position' => array(
            'pgroup' => (int)$pdata['pgroup'],
            'pls'    => (int)$pdata['pls'],
        ),
        'outcome'        => $navigation['outcome'],
        'outcome_reason' => $navigation['outcome_reason'],
        'requested_target_pls' => $navigation['requested_target_pls'] ?? null,
        'target_pls'     => $navigation['target_pls'],
        'target_adjustment' => $navigation['target_adjustment'] ?? null,
        'target_is_auto' => $navigation['target_is_auto'],
        'tendency'       => $navigation['tendency'],
        'steps_taken'    => $navigation['steps_taken'],
        'max_steps'      => $navigation['max_steps'],
    );
}

function obl_command_handler_item_use($payload, &$pdata) {
    global $obl_log;
    $slot = isset($payload['slot']) ? (int)$payload['slot'] : 0;
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending && $slot !== 0) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    item_use($slot, $pdata);
}

/**
 * poi.interact 命令 handler
 *
 * 流程：
 *   1. itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已拦截）
 *   2. 复用 obl_lookup_poi_for_search 做 POI 实例查询 + 位置校验
 *   3. 调用 poi_interact($slot, $poi, $pdata) 主流程
 *
 * @param array $payload {slot, iaid}
 * @param array &$pdata
 * @return void
 */
function obl_command_handler_poi_interact($payload, &$pdata) {
    $slot = isset($payload['slot']) ? (int)$payload['slot'] : 0;
    $iaid = isset($payload['iaid']) ? (int)$payload['iaid'] : 0;

    // itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已在 gate 层拦截）
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }

    // 复用 poi.search 的位置校验：SELECT oblmappoi + pgroup/pls 一致性
    $poi = obl_lookup_poi_for_search($iaid, $pdata);
    if ($poi === null) {
        // lookup 函数已 emit 错误日志（not_found / not_adjacent）
        return;
    }

    poi_interact($slot, $poi, $pdata);
}

/**
 * poi.dismantle 命令 handler（F-7）
 *
 * 流程：
 *   1. itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已拦截）
 *   2. 调用 poi_dismantle($iaid, $pdata) 主流程（内部复用 obl_lookup_poi_for_search 做位置校验）
 *
 * @param array $payload {iaid}
 * @param array &$pdata
 * @return void
 */
function obl_command_handler_poi_dismantle($payload, &$pdata) {
    $iaid = isset($payload['iaid']) ? (int)$payload['iaid'] : 0;

    // itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已在 gate 层拦截）
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }

    poi_dismantle($iaid, $pdata);
}

function obl_command_handler_item_equip($payload, &$pdata) {
    $slot = isset($payload['slot']) ? (int)$payload['slot'] : 0;
    $equip_slot = isset($payload['equip_slot']) ? (string)$payload['equip_slot'] : '';
    if ($equip_slot === '') $equip_slot = null;
    // itm0_pending 防御性检查：item.equip 合约 itm0_allowed=false，bus 已在 gate 层拦截，
    // 此处保留与 item.use 一致的防御性日志，避免任何绕过 gate 的路径静默执行。
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    item_equip($slot, $equip_slot, $pdata);
}

function obl_command_handler_item_unequip($payload, &$pdata) {
    $equip_slot = isset($payload['equip_slot']) ? (string)$payload['equip_slot'] : '';
    if ($equip_slot === '') {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('unequip.invalid_slot', 'unequip');
        return;
    }
    item_unequip($equip_slot, $pdata);
}

function obl_command_handler_item_swap_weapon($payload, &$pdata) {
    // itm0_pending 防御性检查：item.swap_weapon 合约 itm0_allowed=false
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    item_swap_weapon($pdata);
}

function obl_command_handler_inventory_organize(&$pdata) {
    global $obl_log;
    $item_id = isset($pdata['itempara'][0]['itmid']) ? (string)$pdata['itempara'][0]['itmid'] : '';
    $success = obl_organize_inventory($pdata);
    if (isset($obl_log) && $obl_log) {
        if ($success) {
            $obl_log->emit('item.to_bag', 'system', array('item_id' => $item_id));
        } else {
            $obl_log->emit('organize.fail', 'system', array('item_id' => $item_id));
        }
    }
}

/**
 * 查询 POI 实例并校验玩家位置（poi.search 命令路由辅助）
 *
 * 流程：
 *   1. SELECT * FROM oblmappoi WHERE iaid=X
 *   2. 不存在 → emit search.not_found 并返回 null
 *   3. pgroup/pls 与玩家不一致 → emit search.not_adjacent 并返回 null
 *   4. 返回 POI 实例行
 *
 * 由 poi.search 命令分支调用，调用方拿到 POI 实例后传给 E-10 的 obl_search_poi($pdata, $poi, $tool_id, $skill_id)。
 *
 * @param int   $iaid  POI 实例 ID
 * @param array $pdata 玩家数据（用于读 pgroup/pls）
 * @return array|null POI 实例行或 null（找不到/位置不匹配）
 */
function obl_lookup_poi_for_search($iaid, $pdata) {
    global $db, $tablepre, $obl_log;

    $iaid = (int)$iaid;
    $cur_pgroup = (int)$pdata['pgroup'];
    $cur_pls = (int)$pdata['pls'];

    $result = $db->query("SELECT * FROM {$tablepre}oblmappoi WHERE iaid='$iaid'");
    if (!$result || !$db->num_rows($result)) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('search.not_found', 'search');
        return null;
    }
    $poi = $db->fetch_array($result);

    if ((int)$poi['pgroup'] != $cur_pgroup || (int)$poi['pls'] != $cur_pls) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('search.not_adjacent', 'search');
        return null;
    }

    return $poi;
}
