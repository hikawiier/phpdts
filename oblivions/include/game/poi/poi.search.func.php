<?php
/**
 * @module E 游戏逻辑
 * @framework E-10 POI 搜刮三档判定系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions E-10 POI 搜刮三档判定系统 / POI Search Three-Tier Judgment
//
// 替代 explore.func.php 内联的旧 obl_search_poi 扁平流程。
// 入口：obl_search_poi($pdata, $poi, $tool_id, $skill_id)
//
// 三档判定优先级（严格命中即停止）：
//   1. 保底（pity_timer 达阈值）→ 强制掉落
//   2. 事件池分发 → 调用 obl_event_{event_id}()
//   3. 普通掉落 → 调用 F-4 引擎 obl_roll_loot_table()
//   4. 空 → 什么也没找到
//
// 直接物化方案（R2）：搜刮产出道具直接 INSERT 进 oblmapitem
// （source_iaid=POI.iaid, discovered=1），玩家通过现有 item.pickup 拾取，
// 无 pending_loot 暂存、无 poi.fetch_loot 命令。
//
// pity_timer 跨 POI 共享（R1）：存 oblplayers.oblpara.pity_timer JSON 字段。
// prob_mods clamp 到 [0,1]（R4）：在 obl_calc_poi_probabilities() 末尾统一收敛。
//
// 设计文档：oblivions/docs/搜索建筑物与掉落机制重构-模块E-探索与搜刮.md §四 E-10
// 依赖：oblivions/include/game/loot/loot.engine.func.php（F-4 引擎）
//       oblivions/gamedata/poi_table.php（模板）
//       oblivions/gamedata/loot_tables.php（F-4 表配置）
//       由 obl_bootstrap.php 统一加载
// ================================================================

// ----------------------------------------------------------------
// 常量与默认值
// ----------------------------------------------------------------

if (!defined('OBL_PITY_DEFAULT_THRESHOLD')) {
    /**
     * 保底阈值默认值；可被 oblpara.pity_threshold 或技能/buff 覆盖
     */
    define('OBL_PITY_DEFAULT_THRESHOLD', 5);
}

// ----------------------------------------------------------------
// 顶层入口
// ----------------------------------------------------------------

/**
 * POI 搜刮主入口（三档判定 + 状态机推进）
 *
 * 流程：
 *   1. 状态机校验（idle 通过；searched 检查待拾取；cooldown 检查到期；exhausted 拒绝）
 *   2. 概率计算 obl_calc_poi_probabilities()（含 prob_mods + clamp）
 *   3. 保底档判定（pity_timer >= threshold）
 *   4. 事件档判定（rand < good+bad_event_chance）
 *   5. 普通档判定（rand < loot_chance）
 *   6. 空档（以上都没命中）
 *   7. 状态机推进 obl_advance_poi_state()
 *
 * 调用方（命令分发层 obl_command_handlers.php）负责先按 iaid 查 oblmappoi
 * 实例行 + 校验玩家位置 (pgroup/pls) 与 POI 一致，再调用本函数。
 *
 * @param array &$pdata   玩家数据引用（用于读写 oblpara.pity_timer、施加伤害等）
 * @param array $poi      POI 实例行（含 iaid/pgroup/pls/poi_id/state/cooldown_until_turn/search_count_remaining）
 * @param string|null $tool_id  工具 ID（路由 loot_table_override + prob_mods）
 * @param string|null $skill_id 技能 ID（路由 loot_table_override + prob_mods）
 * @return array 结果 ['ok' => bool, 'tier' => 'pity'/'event'/'loot'/'empty', 'items' => [...], 'event_id' => ?, 'message' => '...']
 */
function obl_search_poi(&$pdata, $poi, $tool_id = null, $skill_id = null) {
    global $obl_log, $obl_error_log;

    if (empty($poi) || !is_array($poi)) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('search.invalid_poi', 'search');
        return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'invalid poi');
    }

    $iaid = (int)$poi['iaid'];
    $poi_id = (string)$poi['poi_id'];
    $tick = function_exists('obl_tick_get') ? obl_tick_get() : 0;

    // 1. 载入 POI 模板
    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    if (!isset($poi_table[$poi_id])) {
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('search.data_error', array(
                'poi_id' => $poi_id,
                'iaid'   => $iaid,
            ), 'command');
        }
        return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'template missing');
    }
    $template = $poi_table[$poi_id];

    // 2. 可搜索检查
    if (empty($template['searchable'])) {
        if (isset($obl_log) && $obl_log) $obl_log->emit('search.not_searchable', 'search', array('poi_id' => $poi_id));
        return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'not searchable');
    }

    // 3. 状态机校验（内联）
    $state = isset($poi['state']) ? (string)$poi['state'] : 'idle';

    switch ($state) {
        case 'idle':
            // 允许搜刮
            break;
        case 'searched':
            // 检查 oblmapitem 是否仍有待拾取道具
            $pending_count = obl_count_pending_loot($iaid);
            if ($pending_count > 0) {
                if (isset($obl_log) && $obl_log) $obl_log->emit('search.has_pending_loot', 'search', array('iaid' => $iaid, 'count' => $pending_count));
                return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'pending loot exists');
            }
            // 无待拾取 → 推进状态机（依据 repeatable 与剩余次数）
            $new_state_from_check = obl_decide_post_search_state($poi, $template, $tick);
            obl_advance_poi_state($poi, $new_state_from_check, $tick);
            $poi['state'] = $new_state_from_check;
            if ($new_state_from_check === 'exhausted') {
                if (isset($obl_log) && $obl_log) $obl_log->emit('search.exhausted', 'search', array('iaid' => $iaid));
                return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'exhausted');
            }
            // cooldown 推进后还需再检查到期
            if ($new_state_from_check === 'cooldown') {
                if (isset($obl_log) && $obl_log) $obl_log->emit('search.in_cooldown', 'search', array('iaid' => $iaid));
                return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'in cooldown');
            }
            // 推进到 idle 时继续
            break;
        case 'cooldown':
            $until = (int)(isset($poi['cooldown_until_turn']) ? $poi['cooldown_until_turn'] : 0);
            if ($tick < $until) {
                if (isset($obl_log) && $obl_log) $obl_log->emit('search.in_cooldown', 'search', array('iaid' => $iaid, 'until' => $until));
                return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'in cooldown');
            }
            // 到期 → 推进到 idle 继续
            obl_advance_poi_state($poi, 'idle', $tick);
            $poi['state'] = 'idle';
            break;
        case 'exhausted':
            if (isset($obl_log) && $obl_log) $obl_log->emit('search.exhausted', 'search', array('iaid' => $iaid));
            return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'exhausted');
        default:
            // 未知状态：迁移到 idle 继续（防御性）
            obl_advance_poi_state($poi, 'idle', $tick);
            $poi['state'] = 'idle';
            break;
    }

    // 4. 概率计算
    $context = array(
        'template' => $template,
        'tile'     => obl_get_tile_for_poi($poi),
        'tool_id'  => $tool_id,
        'skill_id' => $skill_id,
        'tick'     => $tick,
        'pdata'    => &$pdata,
        'poi'      => $poi,
    );
    $probs = obl_calc_poi_probabilities($poi, $context);

    // 5. 保底档判定（优先级最高）
    $pity = obl_get_pity_timer($pdata['pid']);
    $threshold = obl_get_pity_threshold($pdata);
    $result = array('ok' => true, 'tier' => null, 'items' => array(), 'event_id' => null, 'message' => '');

    if ($pity >= $threshold) {
        // 保底触发：先掷骰生成 items（不物化），再原子推进状态机，成功后才物化
        $loot_table_id = obl_resolve_loot_table_id($template, $tool_id, $skill_id);
        $items = obl_roll_loot_table($loot_table_id, array('loot_table_override' => null));

        // 原子推进状态机（P0-1：乐观锁保护，避免并发双倍物化）
        $advanced = obl_advance_poi_state_after_search($poi, $template, $tick);
        if (!$advanced) {
            // 乐观锁冲突：另一并发请求已抢先推进，本次不物化、不重置 pity_timer
            return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'concurrent conflict');
        }

        // 状态机推进成功，物化 loot + 重置 pity_timer
        obl_materialize_loot($poi, $items);
        obl_set_pity_timer($pdata['pid'], 0);
        $pdata['oblpara']['pity_timer'] = 0;

        $result['tier'] = 'pity';
        $result['items'] = $items;
        $result['message'] = 'pity triggered';
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('search.pity_triggered', 'search', array(
                'iaid'      => $iaid,
                'item_ids'  => obl_extract_item_ids($items),
            ));
        }
        return $result;
    }

    // 6. 事件档判定
    $event_total_chance = $probs['good_event_chance'] + $probs['bad_event_chance'];
    if (!empty($template['event_pool']) && is_array($template['event_pool']) && (mt_rand() / mt_getrandmax()) < $event_total_chance) {
        $event_id = obl_pick_event($template['event_pool']);
        $event_context = $context;
        $event_context['poi'] = $poi;
        $event_result = obl_dispatch_poi_event($event_id, $event_context);

        $event_items = isset($event_result['items']) && is_array($event_result['items']) ? $event_result['items'] : array();

        // 事件返回 state_change='exhausted' 时强制终态
        $force_state = (!empty($event_result['state_change']) && $event_result['state_change'] === 'exhausted')
            ? 'exhausted'
            : null;

        // 原子推进状态机（P0-1：乐观锁保护，避免并发双倍物化）
        $advanced = obl_advance_poi_state_after_search($poi, $template, $tick, $force_state);
        if (!$advanced) {
            // 乐观锁冲突：不物化、不施加 damage、不修改 pity_timer、不 delete_loot
            return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'concurrent conflict');
        }

        // 状态机推进成功，执行所有副作用
        // 物化事件返回的 items
        if (!empty($event_items)) {
            obl_materialize_loot($poi, $event_items);
        }

        // 处理事件返回的 damage（由调用方施加到玩家）
        if (!empty($event_result['damage'])) {
            $dmg = max(1, (int)$event_result['damage']);
            $pdata['hp'] = max(0, (int)$pdata['hp'] - $dmg);
        }

        // 处理事件返回的 delete_loot（结构坍塌时清空已物化道具）
        if (!empty($event_result['delete_loot'])) {
            obl_delete_poi_loot($iaid);
        }

        // pity_timer 回拨 1
        $new_pity = max(0, $pity - 1);
        obl_set_pity_timer($pdata['pid'], $new_pity);
        $pdata['oblpara']['pity_timer'] = $new_pity;

        $result['tier'] = 'event';
        $result['items'] = $event_items;
        $result['event_id'] = $event_id;
        $result['message'] = isset($event_result['message']) ? (string)$event_result['message'] : '';

        return $result;
    }

    // 7. 普通档判定
    if ((mt_rand() / mt_getrandmax()) < $probs['loot_chance']) {
        // 先掷骰生成 items（不物化），再原子推进状态机
        $loot_table_id = obl_resolve_loot_table_id($template, $tool_id, $skill_id);
        $items = obl_roll_loot_table($loot_table_id, array('loot_table_override' => null));

        // 原子推进状态机（P0-1：乐观锁保护，避免并发双倍物化）
        $advanced = obl_advance_poi_state_after_search($poi, $template, $tick);
        if (!$advanced) {
            return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'concurrent conflict');
        }

        // 状态机推进成功，物化 loot + 回拨 pity_timer
        obl_materialize_loot($poi, $items);

        // pity_timer 回拨 1
        $new_pity = max(0, $pity - 1);
        obl_set_pity_timer($pdata['pid'], $new_pity);
        $pdata['oblpara']['pity_timer'] = $new_pity;

        $result['tier'] = 'loot';
        $result['items'] = $items;
        $result['message'] = 'loot dropped';
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('search.result', 'search', array(
                'iaid'     => $iaid,
                'item_ids' => obl_extract_item_ids($items),
            ));
        }
        return $result;
    }

    // 8. 空档：仍需推进状态机（确保乐观锁语义一致），成功后再递增 pity_timer
    $advanced = obl_advance_poi_state_after_search($poi, $template, $tick);
    if (!$advanced) {
        return array('ok' => false, 'tier' => null, 'items' => array(), 'message' => 'concurrent conflict');
    }

    $new_pity = $pity + 1;
    obl_set_pity_timer($pdata['pid'], $new_pity);
    $pdata['oblpara']['pity_timer'] = $new_pity;

    $result['tier'] = 'empty';
    $result['message'] = 'nothing found';
    if (isset($obl_log) && $obl_log) $obl_log->emit('search.nothing_found', 'search', array('iaid' => $iaid));
    return $result;
}

// ----------------------------------------------------------------
// 概率计算
// ----------------------------------------------------------------

/**
 * POI 搜刮概率计算（含 prob_mods + clamp）
 *
 * 公式（参考设计案 §4.3.1 步骤 2）：
 *   loot_chance       = base_loot_chance * floor_mod * tide_mod
 *   good_event_chance = base_good_event_chance * floor_mod
 *   bad_event_chance  = base_bad_event_chance * tide_mod
 * 之后应用工具/技能的 prob_mods（loot_chance/bad_event_chance 等键的 +/- 偏移），
 * 最后统一 clamp 到 [0,1]。
 *
 * $context 含：
 *   - template: POI 模板配置
 *   - tile: 地块数据（读 tide/floor 属性；占位 1.0）
 *   - tool_id / skill_id: 工具/技能 ID（查 prob_mods_source 白名单后从 item_table/skill 配置读 prob_mods）
 *
 * @param array $poi     POI 实例行（含模板已合并字段）
 * @param array $context 上下文
 * @return array ['loot_chance' => float, 'good_event_chance' => float, 'bad_event_chance' => float]
 */
function obl_calc_poi_probabilities($poi, $context) {
    $template = isset($context['template']) ? $context['template'] : array();

    // 基础概率
    $base_loot = isset($template['base_loot_chance']) ? (float)$template['base_loot_chance'] : 0.5;
    $base_good = isset($template['base_good_event_chance']) ? (float)$template['base_good_event_chance'] : 0.0;
    $base_bad  = isset($template['base_bad_event_chance']) ? (float)$template['base_bad_event_chance'] : 0.0;

    // 修正系数（占位，待地板/光照/天气系统落地）
    $floor_mod = 1.0;  // 地板属性修正占位
    $tide_mod  = 1.0;  // 潮汐等级修正占位（如未来需要可从 $tile['tide'] 查倍率表）

    $loot_chance = $base_loot * $floor_mod * $tide_mod;
    $good_event_chance = $base_good * $floor_mod;
    $bad_event_chance  = $base_bad  * $tide_mod;

    // 应用 prob_mods（仅当 POI 模板 prob_mods_source 白名单声明接受该工具/技能）
    $prob_mods = obl_collect_prob_mods($template, $context);
    if (!empty($prob_mods)) {
        if (isset($prob_mods['loot_chance']))        $loot_chance        += (float)$prob_mods['loot_chance'];
        if (isset($prob_mods['good_event_chance']))  $good_event_chance  += (float)$prob_mods['good_event_chance'];
        if (isset($prob_mods['bad_event_chance']))   $bad_event_chance   += (float)$prob_mods['bad_event_chance'];
    }

    // 末尾统一 clamp 到 [0,1]（R4 决策；不阻塞流程，玩家无感知）
    $loot_chance        = obl_clamp_prob($loot_chance);
    $good_event_chance  = obl_clamp_prob($good_event_chance);
    $bad_event_chance   = obl_clamp_prob($bad_event_chance);

    return array(
        'loot_chance'        => $loot_chance,
        'good_event_chance'  => $good_event_chance,
        'bad_event_chance'   => $bad_event_chance,
    );
}

/**
 * 收集 prob_mods（按 POI 模板 prob_mods_source 白名单过滤）
 *
 * prob_mods_source 形如 ['lockpick', 'flashlight']——声明该 POI 接受这些工具/技能的 prob_mods。
 * 工具/技能的 prob_mods 定义在 item_table.php（poi_prob_mods 字段）或技能配置中。
 * 同一时刻工具 > 技能；多个工具同时使用时按优先级（工具 > 技能）取一个。
 *
 * @param array $template POI 模板
 * @param array $context  上下文（含 tool_id/skill_id）
 * @return array prob_mods 字典；空数组表示无修正
 */
function obl_collect_prob_mods($template, $context) {
    $allowed = isset($template['prob_mods_source']) && is_array($template['prob_mods_source'])
        ? $template['prob_mods_source']
        : array();

    if (empty($allowed)) return array();

    $tool_id  = isset($context['tool_id'])  ? (string)$context['tool_id']  : '';
    $skill_id = isset($context['skill_id']) ? (string)$context['skill_id'] : '';

    // 工具优先
    if ($tool_id !== '' && in_array($tool_id, $allowed, true)) {
        $mods = obl_lookup_prob_mods_for_tool($tool_id);
        if (!empty($mods)) return $mods;
    }

    // 技能次之
    if ($skill_id !== '' && in_array($skill_id, $allowed, true)) {
        $mods = obl_lookup_prob_mods_for_skill($skill_id);
        if (!empty($mods)) return $mods;
    }

    return array();
}

/**
 * 查工具的 prob_mods（从 item_table.php 的 poi_prob_mods 字段读）
 *
 * @param string $tool_id
 * @return array
 */
function obl_lookup_prob_mods_for_tool($tool_id) {
    static $item_table = null;
    if ($item_table === null) {
        $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    }
    if (!isset($item_table[$tool_id])) return array();
    $tpl = $item_table[$tool_id];
    if (!isset($tpl['poi_prob_mods']) || !is_array($tpl['poi_prob_mods'])) return array();
    return $tpl['poi_prob_mods'];
}

/**
 * 查技能的 prob_mods（占位；技能系统接口由 G-1 提供，本案仅留扩展点）
 *
 * @param string $skill_id
 * @return array
 */
function obl_lookup_prob_mods_for_skill($skill_id) {
    // 占位：技能 prob_mods 由 G-1 技能系统未来落地
    return array();
}

/**
 * 概率 clamp 到 [0,1]
 *
 * @param float $p
 * @return float
 */
function obl_clamp_prob($p) {
    if ($p < 0.0) return 0.0;
    if ($p > 1.0) return 1.0;
    return $p;
}

// ----------------------------------------------------------------
// pity_timer 读写（oblpara.pity_timer JSON 字段）
// ----------------------------------------------------------------

/**
 * 读取玩家 pity_timer（跨 POI 共享）
 *
 * 直接读 oblplayers.oblpara JSON 字段（不依赖 $pdata 缓存，避免跨请求过期）。
 *
 * @param int $uid 玩家 ID（oblplayers.pid）
 * @return int pity_timer 值（默认 0）
 */
function obl_get_pity_timer($uid) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return 0;

    $uid = (int)$uid;
    $result = $db->query("SELECT oblpara FROM {$tablepre}oblplayers WHERE pid='$uid'");
    if (!$result || !$db->num_rows($result)) return 0;

    $row = $db->fetch_array($result);
    $oblpara = isset($row['oblpara']) ? $row['oblpara'] : '';
    if (is_string($oblpara)) {
        $decoded = $oblpara !== '' ? json_decode($oblpara, true) : null;
        $oblpara = is_array($decoded) ? $decoded : array();
    } elseif (!is_array($oblpara)) {
        $oblpara = array();
    }

    return isset($oblpara['pity_timer']) ? (int)$oblpara['pity_timer'] : 0;
}

/**
 * 写入玩家 pity_timer（跨 POI 共享）
 *
 * 使用 JSON_SET 仅更新 pity_timer 键，保留 oblpara 其他字段。
 * 调用方需同步 $pdata['oblpara']['pity_timer'] 以保持内存缓存一致。
 *
 * oblplayers 表初始化时 oblpara 默认为 '{}'（见 player.func.php obl_create_player），
 * IF(NULLIF(oblpara, ''), '{}', oblpara) 兜底处理 NULL/空字符串两种异常情况。
 *
 * @param int $uid   玩家 ID
 * @param int $value 新值（负值兜底为 0）
 * @return void
 */
function obl_set_pity_timer($uid, $value) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return;

    $uid = (int)$uid;
    $value = max(0, (int)$value);

    // JSON_SET 要求 oblpara 列是有效 JSON；NULLIF + IF 兜底处理 NULL 与空字符串
    $db->query("UPDATE {$tablepre}oblplayers
                SET oblpara = JSON_SET(IF(NULLIF(oblpara, '') IS NULL, '{}', oblpara), '$.pity_timer', $value)
                WHERE pid='$uid'");
}

/**
 * 读取玩家保底阈值（可被 oblpara.pity_threshold 或技能/buff 覆盖）
 *
 * @param array $pdata 玩家数据
 * @return int 阈值（>=1）
 */
function obl_get_pity_threshold($pdata) {
    if (isset($pdata['oblpara']['pity_threshold'])) {
        $t = (int)$pdata['oblpara']['pity_threshold'];
        if ($t >= 1) return $t;
    }
    return OBL_PITY_DEFAULT_THRESHOLD;
}

// ----------------------------------------------------------------
// POI 状态机推进
// ----------------------------------------------------------------

/**
 * 推进 POI 状态机（乐观锁）
 *
 * 使用 `UPDATE ... WHERE iaid=X AND state=旧值` 实现乐观并发控制：
 * affected_rows=0 说明并发冲突，emit search.concurrent_conflict 日志。
 *
 * @param array  $poi          POI 实例行（含旧 state；函数内不修改 $poi）
 * @param string $new_state    新状态（idle/searched/cooldown/exhausted）
 * @param int    $current_tick 当前 tick（cooldown 状态用于计算 cooldown_until_turn）
 * @return bool 是否成功（false=乐观锁冲突或 DB 不可用）
 */
function obl_advance_poi_state($poi, $new_state, $current_tick) {
    global $db, $tablepre, $obl_log;
    if (!isset($db) || !$db || !isset($tablepre)) return false;

    $iaid = (int)$poi['iaid'];
    $old_state = isset($poi['state']) ? (string)$poi['state'] : 'idle';
    $new_state = (string)$new_state;
    $current_tick = (int)$current_tick;

    if (!in_array($new_state, array('idle', 'searched', 'cooldown', 'exhausted'), true)) {
        return false;
    }

    // 计算冷却到期 tick（cooldown 状态）
    $cooldown_until = 0;
    if ($new_state === 'cooldown') {
        $poi_id = (string)$poi['poi_id'];
        $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
        $cooldown_turns = isset($poi_table[$poi_id]['repeat_cooldown'])
            ? (int)$poi_table[$poi_id]['repeat_cooldown']
            : 0;
        $cooldown_until = $current_tick + $cooldown_turns;
    }

    // 乐观锁 UPDATE
    $db->query("UPDATE {$tablepre}oblmappoi
                SET state='" . $db->escape_string($new_state) . "', cooldown_until_turn='$cooldown_until',
                    searched=" . ($new_state === 'idle' ? '0' : '1') . "
                WHERE iaid='$iaid' AND state='" . $db->escape_string($old_state) . "'");

    $affected = $db->affected_rows();
    if ($affected <= 0) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('search.concurrent_conflict', 'search', array(
                'iaid'      => $iaid,
                'old_state' => $old_state,
                'new_state' => $new_state,
            ));
        }
        return false;
    }
    return true;
}

/**
 * 搜刮后的状态机推进（原子 UPDATE + 乐观锁）
 *
 * 合并为单条 UPDATE，同时推进 state / cooldown_until_turn / searched /
 * search_count / last_search_turn / search_count_remaining，带乐观锁条件
 * `WHERE iaid=X AND state=旧值`：
 *   - affected_rows=1：推进成功，调用方据此决定是否物化 loot
 *   - affected_rows=0：乐观锁冲突（并发搜索抢占失败），emit search.concurrent_conflict
 *
 * 递减语义：
 *   - new_state='searched' 且 old_state='idle'：本次为"新一次成功搜刮"，递减
 *     search_count_remaining、累加 search_count、记录 last_search_turn
 *   - 其他转换（如 idle → exhausted 一次性 POI 终态）：不递减（exhausted 终态无需计数）
 *   - case 'searched' 中"待拾取清空后转 idle/cooldown"由 obl_advance_poi_state 单独
 *     推进（不经过本函数），不递减 search_count_remaining
 *
 * @param array  $poi          POI 实例行（含旧 state；函数内不修改 $poi）
 * @param array  $template     POI 模板
 * @param int    $tick         当前 tick
 * @param string|null $force_state 强制状态（事件返回 state_change='exhausted' 时使用）
 * @return bool 是否成功（false=乐观锁冲突或 DB 不可用；调用方据此跳过物化）
 */
function obl_advance_poi_state_after_search($poi, $template, $tick, $force_state = null) {
    global $db, $tablepre, $obl_log;
    if (!isset($db) || !$db || !isset($tablepre)) return false;

    $iaid = (int)$poi['iaid'];
    $old_state = isset($poi['state']) ? (string)$poi['state'] : 'idle';
    $tick = (int)$tick;

    // 决定新状态
    if ($force_state !== null) {
        $new_state = (string)$force_state;
    } elseif (empty($template['repeatable'])) {
        // 一次性 POI：直接 exhausted（oblmapitem 中已物化道具仍可拾取）
        $new_state = 'exhausted';
    } else {
        // 可重复 POI：先进 searched，待玩家拾取完待拾取道具后由下次调用推进到 cooldown/idle
        $new_state = 'searched';
    }

    if (!in_array($new_state, array('idle', 'searched', 'cooldown', 'exhausted'), true)) {
        return false;
    }

    // 计算 cooldown_until_turn（cooldown 状态）
    $cooldown_until = 0;
    if ($new_state === 'cooldown') {
        $poi_id = (string)$poi['poi_id'];
        $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
        $cooldown_turns = isset($poi_table[$poi_id]['repeat_cooldown'])
            ? (int)$poi_table[$poi_id]['repeat_cooldown']
            : 0;
        $cooldown_until = $tick + $cooldown_turns;
    }

    // searched 标志位（idle 时为 0，其他为 1）
    $searched_flag = ($new_state === 'idle') ? '0' : '1';

    // 构建 SET 子句（合并所有字段，单条 UPDATE 原子写入）
    $set_clauses = array(
        "state='" . $db->escape_string($new_state) . "'",
        "cooldown_until_turn='" . (int)$cooldown_until . "'",
        "searched=" . $searched_flag,
    );

    // 仅可重复 POI 进入 searched 状态（即"新一次成功搜刮"）时递减 search_count_remaining、
    // 累加 search_count、记录 last_search_turn。一次性 POI 的 exhausted 终态不递减。
    if ($new_state === 'searched') {
        $set_clauses[] = "search_count = search_count + 1";
        $set_clauses[] = "last_search_turn = '" . $tick . "'";
        $set_clauses[] = "search_count_remaining = CASE
                            WHEN search_count_remaining > 0 THEN search_count_remaining - 1
                            ELSE search_count_remaining
                          END";
    }

    $set_sql = implode(', ', $set_clauses);

    // 单条原子 UPDATE，带乐观锁条件
    $db->query("UPDATE {$tablepre}oblmappoi
                SET {$set_sql}
                WHERE iaid='{$iaid}' AND state='" . $db->escape_string($old_state) . "'");

    $affected = $db->affected_rows();
    if ($affected <= 0) {
        // 乐观锁冲突：另一并发请求已抢先推进状态机
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('search.concurrent_conflict', 'search', array(
                'iaid'      => $iaid,
                'old_state' => $old_state,
                'new_state' => $new_state,
            ));
        }
        return false;
    }
    return true;
}

/**
 * 决策 searched 状态推进后的目标状态（玩家拾取完待拾取道具后调用）
 *
 * @param array $poi      POI 实例行
 * @param array $template POI 模板
 * @param int   $tick     当前 tick
 * @return string 'idle'/'cooldown'/'exhausted'
 */
function obl_decide_post_search_state($poi, $template, $tick) {
    $remaining = isset($poi['search_count_remaining']) ? (int)$poi['search_count_remaining'] : -1;

    // 剩余次数耗尽 → exhausted
    if ($remaining === 0) return 'exhausted';

    $repeat_cooldown = isset($template['repeat_cooldown']) ? (int)$template['repeat_cooldown'] : 0;
    if ($repeat_cooldown > 0) {
        return 'cooldown';
    }

    // 无冷却 → 直接 idle
    return 'idle';
}

// ----------------------------------------------------------------
// 物化与查询
// ----------------------------------------------------------------

/**
 * 将 F-4 引擎返回的物品实例数组逐件物化进 oblmapitem
 *
 * 写入字段：
 *   pgroup, pls       来自 POI 实例
 *   iaid              POI.iaid
 *   source_iaid       POI.iaid（标记为 POI 产出待拾取）
 *   item_id           物品模板 ID（itmid）
 *   itm               留空（前端通过 item_id 查 locale）
 *   itmk/itme/itms/itmsk/itmpara  来自 F-4 实例
 *   discovered        1（已发现，可直接拾取）
 *   fake_item_id      空字符串
 *   is_trap           0
 *
 * @param array $poi   POI 实例行
 * @param array $items F-4 引擎返回的物品实例数组
 * @return int 实际插入的件数
 */
function obl_materialize_loot($poi, $items) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return 0;
    if (empty($items) || !is_array($items)) return 0;

    $pgroup = (int)$poi['pgroup'];
    $pls    = (int)$poi['pls'];
    $iaid   = (int)$poi['iaid'];

    $count = 0;
    foreach ($items as $item) {
        $item_id   = $db->escape_string((string)(isset($item['itmid']) ? $item['itmid'] : ''));
        $itmk      = $db->escape_string((string)(isset($item['itmk']) ? $item['itmk'] : ''));
        $itme      = (int)(isset($item['itme']) ? $item['itme'] : 0);
        $itms      = $db->escape_string((string)(isset($item['itms']) ? $item['itms'] : '0'));
        $itmsk     = $db->escape_string((string)(isset($item['itmsk']) ? $item['itmsk'] : ''));
        $itmpara   = isset($item['itmpara']) ? $item['itmpara'] : '';
        if (is_array($itmpara)) {
            $itmpara = json_encode($itmpara, JSON_UNESCAPED_UNICODE);
        }
        $itmpara = $db->escape_string((string)$itmpara);

        $db->query("INSERT INTO {$tablepre}oblmapitem
                    (pgroup, pls, iaid, source_iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara, discovered, fake_item_id, is_trap)
                    VALUES
                    ('$pgroup', '$pls', '$iaid', '$iaid', '$item_id', '', '$itmk', $itme, '$itms', '$itmsk', '$itmpara', 1, '', 0)");
        $count++;
    }

    return $count;
}

/**
 * 统计 POI 当前待拾取道具数（oblmapitem WHERE source_iaid=POI.iaid AND discovered=1）
 *
 * @param int $iaid POI iaid
 * @return int
 */
function obl_count_pending_loot($iaid) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return 0;

    $iaid = (int)$iaid;
    $result = $db->query("SELECT COUNT(*) AS cnt
                          FROM {$tablepre}oblmapitem
                          WHERE source_iaid='$iaid' AND discovered=1");
    if (!$result) return 0;
    $row = $db->fetch_array($result);
    return isset($row['cnt']) ? (int)$row['cnt'] : 0;
}

/**
 * 删除 POI 当前已物化的所有待拾取道具（事件结构坍塌时用）
 *
 * @param int $iaid POI iaid
 * @return int 删除的行数
 */
function obl_delete_poi_loot($iaid) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return 0;

    $iaid = (int)$iaid;
    $db->query("DELETE FROM {$tablepre}oblmapitem
                WHERE source_iaid='$iaid'");
    return $db->affected_rows();
}

/**
 * 从物品实例数组提取 item_id 列表（用于日志/响应）
 *
 * @param array $items
 * @return array
 */
function obl_extract_item_ids($items) {
    $ids = array();
    if (empty($items) || !is_array($items)) return $ids;
    foreach ($items as $item) {
        if (isset($item['itmid'])) $ids[] = (string)$item['itmid'];
    }
    return $ids;
}

// ----------------------------------------------------------------
// 辅助函数
// ----------------------------------------------------------------

/**
 * 解析最终使用的战利品表 ID（应用 loot_table_override 路由）
 *
 * 工具 > 技能优先级；POI 模板的 loot_table_overrides 字典映射 tool_id/skill_id → override 表 ID。
 * 若无 override 则使用模板默认 loot_table_id；若模板无 loot_table_id 则回退到 poi_id（"表 ID 即 POI ID"约定）。
 *
 * @param array  $template POI 模板
 * @param string|null $tool_id
 * @param string|null $skill_id
 * @return string 战利品表 ID
 */
function obl_resolve_loot_table_id($template, $tool_id, $skill_id) {
    $overrides = isset($template['loot_table_overrides']) && is_array($template['loot_table_overrides'])
        ? $template['loot_table_overrides']
        : array();

    $tool_id  = $tool_id  !== null ? (string)$tool_id  : '';
    $skill_id = $skill_id !== null ? (string)$skill_id : '';

    // 工具优先
    if ($tool_id !== '' && isset($overrides[$tool_id])) {
        return (string)$overrides[$tool_id];
    }
    // 技能次之
    if ($skill_id !== '' && isset($overrides[$skill_id])) {
        return (string)$overrides[$skill_id];
    }

    // 默认 loot_table_id
    if (isset($template['loot_table_id'])) {
        return (string)$template['loot_table_id'];
    }

    // 回退到 poi_id（"表 ID 即 POI ID"约定）；模板上不显式存 poi_id 但 key 即 poi_id，
    // 由调用方 obl_search_poi 入口已知 $poi_id，正常路径不会走到这里
    return '';
}

/**
 * 按 weight 加权随机抽取一个事件 ID
 *
 * weight 全 0 时均匀随机；weight 缺失按 1.0 计。
 *
 * @param array $event_pool [['event_id' => '...', 'weight' => N, 'kind' => 'good'/'bad'], ...]
 * @return string event_id
 */
function obl_pick_event($event_pool) {
    if (empty($event_pool) || !is_array($event_pool)) return '';

    $total_weight = 0.0;
    foreach ($event_pool as $e) {
        $total_weight += isset($e['weight']) ? (float)$e['weight'] : 1.0;
    }

    if ($total_weight <= 0) {
        $pick = $event_pool[array_rand($event_pool)];
        return isset($pick['event_id']) ? (string)$pick['event_id'] : '';
    }

    $r = mt_rand() / mt_getrandmax() * $total_weight;
    $cum = 0.0;
    foreach ($event_pool as $e) {
        $w = isset($e['weight']) ? (float)$e['weight'] : 1.0;
        $cum += $w;
        if ($r <= $cum) {
            return isset($e['event_id']) ? (string)$e['event_id'] : '';
        }
    }
    // 浮点累加误差兜底
    $last = $event_pool[count($event_pool) - 1];
    return isset($last['event_id']) ? (string)$last['event_id'] : '';
}

/**
 * 取 POI 所在地块数据（用于读 tide/floor 属性）
 *
 * @param array $poi POI 实例行
 * @return array 地块数据（缺失时返回空数组）
 */
function obl_get_tile_for_poi($poi) {
    if (!function_exists('obl_get_map_data')) return array();
    $pgroup = isset($poi['pgroup']) ? (int)$poi['pgroup'] : 0;
    $pls    = isset($poi['pls'])    ? (int)$poi['pls']    : 0;
    if ($pgroup <= 0 || $pls <= 0) return array();

    $map = obl_get_map_data($pgroup);
    $tiles = isset($map['tiles'][$pgroup]) ? $map['tiles'][$pgroup] : array();
    return isset($tiles[$pls]) ? $tiles[$pls] : array();
}

// ----------------------------------------------------------------
// 战利品表预览投影（tile_actions scope 用）
// ----------------------------------------------------------------

/**
 * 构建 POI 战利品表预览（tile_actions scope 投影专用）
 *
 * 设计案：oblivions/docs/POI产出预览简化-设计案-2026-07-19.md
 *
 * 投影 POI 模板关联的 F-4 战利品表为前端三档分级预览数据，
 * 让玩家在搜索前看到"可能搜刮出的道具列表"（原始方案 §4.2）。
 *
 * 投影规则（按 DESIGN.md §3.4「少即是多」原则，从详细结构简化为三档分级）：
 *   1. 四级过滤链：searchable=false / state='exhausted' / loot_table_id 缺失 / 表不存在 / groups 为空 → null
 *   2. 每个 entry 整体出现概率 = group_chance × entry_probability
 *      - entry_probability = weight / Σweight（与 F-4 引擎 obl_weighted_pick 一致）
 *      - weight 全 0 时按均匀分布（1/count），与 obl_weighted_pick 兜底一致
 *   3. 多组同 item_id 去重：独立事件联合概率 1 - ∏(1 - p_i)
 *      （假设各组掷骰独立，与 F-4 引擎语义一致；同组内 entries 互斥，无需联合）
 *   4. 按整体出现概率分三档（硬编码阈值，不引入配置）：
 *      - certain（绝对会有）：p >= 0.95
 *      - likely（大概率会有）：0.5 <= p < 0.95
 *      - maybe（也许会有）：0 < p < 0.5
 *   5. 各档内 item_id 按 p 降序排序；三档全空 → 返回 null
 *
 * 信息安全：loot_table 配置仅含普通掉落物品，不含 event_pool 的陷阱/恶性事件 ID。
 * 陷阱类信息通过 base_bad_event_chance 概率值暴露，不暴露具体 item_id。
 *
 * 不应用 loot_table_overrides 路由——tile_actions scope 调用时机早于玩家选工具，
 * 仅投影默认 loot_table_id 的结构。前端在 loot_table_overrides 非空时显示提示文案。
 *
 * @param array $poi      POI 实例行（含 state）
 * @param array $template POI 模板（含 searchable / loot_table_id）
 * @return array|null 三档分级预览结构或 null
 *   返回结构：
 *     [
 *       'table_name' => string,           // 索引锚点（调试用）
 *       'certain' => ['item_id', ...],    // 已按 p 降序
 *       'likely'  => ['item_id', ...],
 *       'maybe'   => ['item_id', ...],
 *     ]
 */
function obl_build_loot_preview_for_poi($poi, $template) {
    // 1. 四级过滤链
    if (empty($template['searchable'])) return null;

    $state = isset($poi['state']) ? (string)$poi['state'] : 'idle';
    if ($state === 'exhausted') return null;

    $table_id = isset($template['loot_table_id']) ? (string)$template['loot_table_id'] : '';
    if ($table_id === '') return null;

    // 2. 加载表配置
    $tables = include GAME_ROOT . './oblivions/gamedata/loot_tables.php';
    if (!isset($tables[$table_id])) {
        // 防御性：模板 loot_table_id 配置错误，emit error 日志
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.preview_table_missing', array(
                'table_id' => $table_id,
            ), 'api');
        }
        return null;
    }
    $table = $tables[$table_id];

    $groups = isset($table['groups']) && is_array($table['groups']) ? $table['groups'] : array();
    if (empty($groups)) return null;  // 空表（如 empty_loot）

    // 3. 收集每个 item_id 在各组中的出现概率列表
    // 同组内 entries 互斥（按 weight 选一），一个 item 在同一组内只贡献一次概率；
    // 多组同 item_id 视为独立事件，后续用联合概率合并。
    $item_prob_map = array();  // item_id => [p1, p2, ...]

    foreach ($groups as $group) {
        $chance = isset($group['chance']) ? (float)$group['chance'] : 1.0;
        // 钳位到 [0, 1]（与 obl_clamp_prob 同语义）
        if ($chance < 0.0) $chance = 0.0;
        if ($chance > 1.0) $chance = 1.0;
        if ($chance <= 0.0) continue;  // 组级 chance=0 → 该组物品不可能出现

        $entries = isset($group['entries']) && is_array($group['entries']) ? $group['entries'] : array();
        if (empty($entries)) continue;

        // 计算 weight 总和（与 obl_weighted_pick 一致；weight 缺省按 1.0 计）
        $total_weight = 0.0;
        foreach ($entries as $e) {
            $total_weight += isset($e['weight']) ? (float)$e['weight'] : 1.0;
        }

        $entry_count = count($entries);
        foreach ($entries as $e) {
            $w = isset($e['weight']) ? (float)$e['weight'] : 1.0;
            // weight 全 0 时按均匀分布（1/count），与 obl_weighted_pick 兜底一致
            $entry_prob = $total_weight > 0
                ? ($w / $total_weight)
                : (1.0 / $entry_count);

            $overall = $chance * $entry_prob;
            if ($overall <= 0.0) continue;

            $item_id = (string)(isset($e['item_id']) ? $e['item_id'] : '');
            if ($item_id === '') continue;

            if (!isset($item_prob_map[$item_id])) {
                $item_prob_map[$item_id] = array();
            }
            $item_prob_map[$item_id][] = $overall;
        }
    }

    // 4. 计算每个 item 的联合概率，分档
    $certain = array();
    $likely  = array();
    $maybe   = array();

    $item_final = array();
    foreach ($item_prob_map as $item_id => $probs) {
        // 独立事件联合概率：1 - ∏(1 - p_i)
        $combined = 1.0;
        foreach ($probs as $p) {
            $combined *= (1.0 - $p);
        }
        $p_final = 1.0 - $combined;

        $item_final[] = array('item_id' => $item_id, 'p' => $p_final);
    }

    // 按 p 降序排序（同概率稳定排序：usort 不稳定，但 item_id 顺序对前端不重要）
    usort($item_final, function($a, $b) {
        if ($a['p'] === $b['p']) return 0;
        return $a['p'] < $b['p'] ? 1 : -1;
    });

    foreach ($item_final as $item) {
        $p = $item['p'];
        if ($p >= 0.95) {
            $certain[] = $item['item_id'];
        } elseif ($p >= 0.5) {
            $likely[] = $item['item_id'];
        } elseif ($p > 0.0) {
            $maybe[] = $item['item_id'];
        }
        // p <= 0 不入档（防御性，理论不发生）
    }

    // 5. 三档全空 → 返回 null（前端隐藏整个区域）
    if (empty($certain) && empty($likely) && empty($maybe)) return null;

    return array(
        'table_name' => isset($table['name']) ? (string)$table['name'] : $table_id,
        'certain'    => $certain,
        'likely'     => $likely,
        'maybe'      => $maybe,
    );
}
