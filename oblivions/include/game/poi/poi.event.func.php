<?php
/**
 * @module E 游戏逻辑
 * @framework E-10 POI 搜刮三档判定系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions E-10 事件池分发框架 / POI Event Pool Dispatcher
//
// 与 explore.func.php 的 obl_mechanic_{name}() 分发框架同构——
// 新增事件只需添加 obl_event_{event_id}() 函数，框架自动分发。
//
// 分发入口：obl_dispatch_poi_event($event_id, $context)
//   1. 查找 obl_event_{event_id}() 函数
//   2. 存在 → 调用并返回结构化结果（['type','items','message','state_change','damage','delete_loot', ...]）
//   3. 不存在 → emit search.event_pending 并降级返回空结果（调用方继续走普通档判定）
//
// 事件函数约定：
//   function obl_event_{event_id}($context): array
//   $context = ['poi' => 实例行, 'template' => 模板配置, 'pdata' => &玩家数据引用,
//                'tool_id' => ?, 'skill_id' => ?, 'tick' => int]
//   返回结构 ['type' => 'good'/'bad', 'items' => [...], 'message' => '...',
//             'state_change' => 'exhausted'/null, 'damage' => ?, 'delete_loot' => bool, ...]
//   - items：F-4 引擎返回的物品实例数组（itempara 七字段），由调用方 obl_materialize_loot() 物化
//   - state_change='exhausted'：触发 POI 终态推进
//   - delete_loot=true：触发本次 oblmapitem 中 source_iaid=POI.iaid 道具全量 DELETE
//   - damage：由调用方施加到玩家（最低 1 HP）
//
// 原型阶段先实现 4 个测试事件：
//   - find_extra_cache（良性）：调用 F-4 用 extra_cache_loot 表生成物品实例数组
//   - safe_route（良性）：写入 oblpara 临时 buff（占位，待移动系统落地）
//   - trap_trigger（恶性）：玩家立即受到 10-20 点伤害
//   - structure_collapse（恶性）：POI 永久 exhausted + 已物化道具全量 DELETE
//
// 设计文档：oblivions/docs/搜索建筑物与掉落机制重构-模块E-探索与搜刮.md §四 E-10 §4.3.4
// 依赖：oblivions/include/game/loot/loot.engine.func.php（F-4 引擎，被 find_extra_cache 调用）
//       由 obl_bootstrap.php 与 poi.search.func.php 一同加载
// ================================================================

// ----------------------------------------------------------------
// 分发入口
// ----------------------------------------------------------------

/**
 * 分发 POI 事件到具体处理函数
 *
 * 命名约定：obl_event_{event_id}()——与 obl_mechanic_{name}() 分发框架同构。
 * 找不到函数时 emit search.event_pending 并降级返回空结果（调用方继续走普通档判定）。
 *
 * @param string $event_id 事件 ID
 * @param array  $context  上下文（含 poi/template/pdata/tool_id/skill_id/tick）
 * @return array 事件返回结构 ['type' => 'good'/'bad', 'items' => [...], 'message' => '...', 'state_change' => ?, 'damage' => ?, 'delete_loot' => bool, ...]；找不到函数时返回空 good 结果
 */
function obl_dispatch_poi_event($event_id, $context) {
    global $obl_log;

    $event_id = (string)$event_id;
    if ($event_id === '') {
        return array('type' => 'bad', 'items' => array(), 'message' => 'empty event_id');
    }

    $handler = 'obl_event_' . $event_id;
    if (!function_exists($handler)) {
        // 与 obl_mechanic 分发框架的容错策略一致
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('search.event_pending', 'search', array('event_id' => $event_id));
        }
        // 降级返回：type='good' 空结果，调用方继续走普通档判定
        return array(
            'type'         => 'good',
            'items'        => array(),
            'message'      => 'event pending',
            'state_change' => null,
            'damage'       => 0,
            'delete_loot'  => false,
        );
    }

    $result = $handler($context);

    // 兜底归一化：确保返回结构完整
    if (!is_array($result)) $result = array();
    $defaults = array(
        'type'         => 'good',
        'items'        => array(),
        'message'      => '',
        'state_change' => null,
        'damage'       => 0,
        'delete_loot'  => false,
    );
    foreach ($defaults as $k => $v) {
        if (!isset($result[$k])) $result[$k] = $v;
    }
    if (!is_array($result['items'])) $result['items'] = array();

    return $result;
}

// ----------------------------------------------------------------
// 测试事件实现
// ----------------------------------------------------------------

/**
 * 事件：发现额外补给箱（良性）
 *
 * 调用 F-4 引擎用 extra_cache_loot 表生成物品实例数组，通过返回值 items 字段
 * 交回调用方 obl_materialize_loot() 物化进 oblmapitem。
 *
 * @param array $context 上下文（含 poi/template/pdata/tick）
 * @return array
 */
function obl_event_find_extra_cache($context) {
    global $obl_log;

    $items = obl_roll_loot_table('extra_cache_loot', array('loot_table_override' => null));

    if (isset($obl_log) && $obl_log) {
        $iaid = isset($context['poi']['iaid']) ? (int)$context['poi']['iaid'] : 0;
        $obl_log->emit('search.event.find_extra_cache', 'search', array(
            'iaid'     => $iaid,
            'item_ids' => obl_extract_event_item_ids($items),
        ));
    }

    return array(
        'type'         => 'good',
        'items'        => $items,
        'message'      => '发现一个额外的补给箱！',
        'state_change' => null,
        'damage'       => 0,
        'delete_loot'  => false,
    );
}

/**
 * 事件：发现安全路径（良性）
 *
 * 写入 oblpara 临时 buff（safe_route_until_turn），下次移动消耗体力 -50%。
 * 移动系统落地后由移动命令读取该 buff 并应用修正（占位实现，仅写 buff 数据）。
 *
 * @param array $context 上下文（含 poi/template/pdata/tick）
 * @return array
 */
function obl_event_safe_route($context) {
    global $obl_log;

    $tick = isset($context['tick']) ? (int)$context['tick'] : 0;
    $pdata = isset($context['pdata']) ? $context['pdata'] : null;

    if (is_array($pdata)) {
        // 写入 oblpara 临时 buff：safe_route_until_turn = tick + 1（仅下次移动生效）
        if (!isset($pdata['oblpara']) || !is_array($pdata['oblpara'])) {
            $pdata['oblpara'] = array();
        }
        $pdata['oblpara']['safe_route_until_turn'] = $tick + 1;
    }

    if (isset($obl_log) && $obl_log) {
        $iaid = isset($context['poi']['iaid']) ? (int)$context['poi']['iaid'] : 0;
        $obl_log->emit('search.event.safe_route', 'search', array(
            'iaid'         => $iaid,
            'expires_turn' => $tick + 1,
        ));
    }

    return array(
        'type'         => 'good',
        'items'        => array(),
        'message'      => '发现一条安全路径，下次移动体力消耗减半！',
        'state_change' => null,
        'damage'       => 0,
        'delete_loot'  => false,
    );
}

/**
 * 事件：触发陷阱（恶性）
 *
 * 玩家立即受到 10-20 点伤害（不低于 1 HP）。伤害由调用方 obl_search_poi 施加到
 * $pdata['hp']，本函数仅返回 damage 字段。
 *
 * @param array $context 上下文（含 poi/template/pdata/tick）
 * @return array
 */
function obl_event_trap_trigger($context) {
    global $obl_log;

    $damage = rand(10, 20);

    if (isset($obl_log) && $obl_log) {
        $iaid = isset($context['poi']['iaid']) ? (int)$context['poi']['iaid'] : 0;
        $obl_log->emit('search.event.trap_trigger', 'search', array(
            'iaid'   => $iaid,
            'damage' => $damage,
        ));
    }

    return array(
        'type'         => 'bad',
        'items'        => array(),
        'message'      => '触发了陷阱！受到 ' . $damage . ' 点伤害。',
        'state_change' => null,
        'damage'       => $damage,
        'delete_loot'  => false,
    );
}

/**
 * 事件：结构坍塌（恶性）
 *
 * POI 永久 exhausted（通过 state_change='exhausted' 触发调用方 obl_advance_poi_state 推进），
 * 本次 oblmapitem 中已物化的 source_iaid=POI.iaid 道具全部 DELETE（通过 delete_loot=true 触发）。
 *
 * @param array $context 上下文（含 poi/template/pdata/tick）
 * @return array
 */
function obl_event_structure_collapse($context) {
    global $obl_log;

    if (isset($obl_log) && $obl_log) {
        $iaid = isset($context['poi']['iaid']) ? (int)$context['poi']['iaid'] : 0;
        $obl_log->emit('search.event.structure_collapse', 'search', array(
            'iaid' => $iaid,
        ));
    }

    return array(
        'type'         => 'bad',
        'items'        => array(),
        'message'      => '建筑物在你搜刮时坍塌了，所有物资都被压坏了！',
        'state_change' => 'exhausted',
        'damage'       => 0,
        'delete_loot'  => true,
    );
}

// ----------------------------------------------------------------
// 辅助函数
// ----------------------------------------------------------------

/**
 * 从物品实例数组提取 item_id 列表（事件日志用）
 *
 * 与 poi.search.func.php 的 obl_extract_item_ids 同语义，独立定义避免循环依赖误判。
 *
 * @param array $items
 * @return array
 */
function obl_extract_event_item_ids($items) {
    $ids = array();
    if (empty($items) || !is_array($items)) return $ids;
    foreach ($items as $item) {
        if (isset($item['itmid'])) $ids[] = (string)$item['itmid'];
    }
    return $ids;
}
