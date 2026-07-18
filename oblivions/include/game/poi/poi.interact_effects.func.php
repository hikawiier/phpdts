<?php
/**
 * @module F 物品系统
 * @framework F-6 POI 道具交互系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions F-6 POI 道具交互效果函数集
//
// 与 F-3 use_effect 分发器同构：主流程 poi_interact() 在配置匹配后
// 按 effect_type 字段分发到 poi_interact_effect_{name}() 函数。
//
// 签名约定：
//   function poi_interact_effect_{name}($item, $poi, $interaction, &$pdata)
//   - $item         道具实例（itempara 七字段，按值传递）
//   - $poi          POI 实例行（含 iaid/pgroup/pls/poi_id/state 等）
//   - $interaction  交互配置数组（poi_interactions.php 的 entry）
//   - &$pdata       玩家数据引用
//
// 返回值：bool
//   - true  效果成功，主流程继续消耗道具 + emit success
//   - false 效果失败（如乐观锁冲突），主流程跳过消耗 + emit 已在 effect 内完成
//
// 设计原则：
//   - effect 函数内部不扣 itms，由主流程 poi_interact() 统一消耗
//   - effect 函数内部使用乐观锁 UPDATE 保护并发场景
//   - 失败时 effect 函数自行 emit 日志，主流程据此跳过消耗
//
// 依赖：oblivions/include/game/loot/loot.engine.func.php（F-4 引擎）
//       oblivions/include/game/poi/poi.search.func.php（obl_materialize_loot 复用）
// ================================================================

/**
 * 效果：解锁门（locked → idle）
 *
 * 用于 interact_locked_door POI（locked_door 模板）。
 * 解锁后 POI state 改为 'idle'，让 poi.search 可接管后续搜刮。
 *
 * effect_params:
 *   - target_state  目标状态（默认 'idle'）
 *
 * 流程：
 *   1. UPDATE oblmappoi SET state=target_state WHERE iaid=X AND state='locked'（乐观锁）
 *   2. affected=0 → emit poi.interact.concurrent_conflict，返回 false
 *   3. 成功 → emit unlock_door.unlocked，返回 true
 *
 * @param array  $item
 * @param array  $poi
 * @param array  $interaction
 * @param array  &$pdata
 * @return bool
 */
function poi_interact_effect_unlock_door($item, $poi, $interaction, &$pdata) {
    global $db, $tablepre, $obl_log;

    if (!isset($db) || !$db || !isset($tablepre)) return false;

    $iaid = (int)$poi['iaid'];
    $params = isset($interaction['effect_params']) && is_array($interaction['effect_params'])
        ? $interaction['effect_params']
        : array();
    $target_state = isset($params['target_state']) ? (string)$params['target_state'] : 'idle';

    // 乐观锁 UPDATE：locked → target_state
    $db->query("UPDATE {$tablepre}oblmappoi
                SET state='" . $db->escape_string($target_state) . "',
                    searched=0
                WHERE iaid='{$iaid}' AND state='locked'");

    $affected = $db->affected_rows();
    if ($affected <= 0) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('poi.interact.concurrent_conflict', 'poi_interact', array(
                'iaid'       => $iaid,
                'effect'     => 'unlock_door',
                'old_state'  => 'locked',
                'new_state'  => $target_state,
            ));
        }
        return false;
    }

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('unlock_door.unlocked', 'poi_interact', array(
            'iaid'        => $iaid,
            'poi_id'      => isset($poi['poi_id']) ? (string)$poi['poi_id'] : '',
            'new_state'   => $target_state,
        ));
    }
    return true;
}

/**
 * 效果：打开容器（locked → exhausted + 物化掉落）
 *
 * 用于 interact_locked_chest POI（locked_chest 模板）。
 * 一次性开箱：调用 F-4 引擎掷骰，物化到 oblmapitem，state 改为 'exhausted'。
 *
 * effect_params:
 *   - loot_table_id  F-4 战利品表 ID
 *
 * 流程：
 *   1. 读 effect_params.loot_table_id，调用 obl_roll_loot_table 掷骰
 *   2. UPDATE oblmappoi SET state='exhausted' WHERE iaid=X AND state='locked'（乐观锁）
 *      affected=0 → emit poi.interact.concurrent_conflict，不物化，返回 false
 *   3. 物化 items 到 oblmapitem（source_iaid=poi.iaid, discovered=1）
 *   4. emit open_container.opened（含 item_count）
 *   5. 返回 true
 *
 * @param array  $item
 * @param array  $poi
 * @param array  $interaction
 * @param array  &$pdata
 * @return bool
 */
function poi_interact_effect_open_container($item, $poi, $interaction, &$pdata) {
    global $db, $tablepre, $obl_log;

    if (!isset($db) || !$db || !isset($tablepre)) return false;

    $iaid = (int)$poi['iaid'];
    $params = isset($interaction['effect_params']) && is_array($interaction['effect_params'])
        ? $interaction['effect_params']
        : array();
    $loot_table_id = isset($params['loot_table_id']) ? (string)$params['loot_table_id'] : '';
    if ($loot_table_id === '') {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('poi.interact.concurrent_conflict', 'poi_interact', array(
                'iaid'   => $iaid,
                'effect' => 'open_container',
                'reason' => 'missing loot_table_id',
            ));
        }
        return false;
    }

    // 1. 先掷骰生成 items（不物化），确保乐观锁失败时无需回滚
    $items = function_exists('obl_roll_loot_table')
        ? obl_roll_loot_table($loot_table_id, array('loot_table_override' => null))
        : array();
    if (!is_array($items)) $items = array();

    // 2. 乐观锁 UPDATE：locked → exhausted
    $db->query("UPDATE {$tablepre}oblmappoi
                SET state='exhausted',
                    searched=1
                WHERE iaid='{$iaid}' AND state='locked'");

    $affected = $db->affected_rows();
    if ($affected <= 0) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('poi.interact.concurrent_conflict', 'poi_interact', array(
                'iaid'      => $iaid,
                'effect'    => 'open_container',
                'old_state' => 'locked',
                'new_state' => 'exhausted',
            ));
        }
        return false;
    }

    // 3. 物化掉落物到 oblmapitem（source_iaid=POI.iaid, discovered=1）
    $materialized = 0;
    if (!empty($items) && function_exists('obl_materialize_loot')) {
        $materialized = obl_materialize_loot($poi, $items);
    }

    // 4. emit 成功事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('open_container.opened', 'poi_interact', array(
            'iaid'       => $iaid,
            'poi_id'     => isset($poi['poi_id']) ? (string)$poi['poi_id'] : '',
            'item_count' => $materialized,
            'item_ids'   => function_exists('obl_extract_item_ids') ? obl_extract_item_ids($items) : array(),
        ));
    }
    return true;
}

/**
 * 效果：点燃（idle → ignited）
 *
 * 用于 interact_campfire POI（campfire_unlit 模板）。
 * 仅修改 state 并 emit 事件，增益/伤害语义由未来状态系统/健康系统订阅。
 *
 * effect_params:
 *   - target_state  目标状态（默认 'ignited'）
 *
 * 流程：
 *   1. UPDATE oblmappoi SET state=target_state WHERE iaid=X AND state='idle'（乐观锁）
 *   2. affected=0 → emit poi.interact.concurrent_conflict，返回 false
 *   3. 成功 → emit ignite.ignited，返回 true
 *
 * @param array  $item
 * @param array  $poi
 * @param array  $interaction
 * @param array  &$pdata
 * @return bool
 */
function poi_interact_effect_ignite($item, $poi, $interaction, &$pdata) {
    global $db, $tablepre, $obl_log;

    if (!isset($db) || !$db || !isset($tablepre)) return false;

    $iaid = (int)$poi['iaid'];
    $params = isset($interaction['effect_params']) && is_array($interaction['effect_params'])
        ? $interaction['effect_params']
        : array();
    $target_state = isset($params['target_state']) ? (string)$params['target_state'] : 'ignited';

    // 乐观锁 UPDATE：idle → target_state（ignited）
    $db->query("UPDATE {$tablepre}oblmappoi
                SET state='" . $db->escape_string($target_state) . "',
                    searched=0
                WHERE iaid='{$iaid}' AND state='idle'");

    $affected = $db->affected_rows();
    if ($affected <= 0) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('poi.interact.concurrent_conflict', 'poi_interact', array(
                'iaid'       => $iaid,
                'effect'     => 'ignite',
                'old_state'  => 'idle',
                'new_state'  => $target_state,
            ));
        }
        return false;
    }

    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('ignite.ignited', 'poi_interact', array(
            'iaid'      => $iaid,
            'poi_id'    => isset($poi['poi_id']) ? (string)$poi['poi_id'] : '',
            'new_state' => $target_state,
        ));
    }
    return true;
}
