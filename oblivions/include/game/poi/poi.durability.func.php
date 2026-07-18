<?php
/**
 * @module E 游戏逻辑
 * @framework E-12 POI 耐久系统
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions E-12 POI 耐久系统 / POI Durability System
//
// 在 E-10/E-11 之上为 POI 实例层提供"自然时效"语义：
//   - 任意 POI 模板可声明 ttl_days > 0，实例化时由放置者写入三字段：
//     placed_by_pid / placed_at_day / ttl_days
//   - 玩家放置（F-7）与世界生成两条路径区分：世界生成不写 ttl_days（默认 0=永不过期）
//   - day_changed 事件触发时批量扫描到期 POI，DELETE 实例行 + 级联清理
//     bra_oblmapitem.source_iaid=iaid 的关联待拾取道具
//
// 监听器签名（与 E-9 wild_refresh 同模式，复用 E-11 事件钩子）：
//   function obl_poi_durability_cleanup(array $transition): void
//   $transition = [
//     'from' => ['day' => N,   'phase' => 'day'|'night'],
//     'to'   => ['day' => N+1, 'phase' => 'day'|'night'],
//     'tick' => T,
//   ]
//
// 注册位置：oblivions/include/game/tick.func.php 末尾
//   obl_day_register_listener('day_changed', 'obl_poi_durability_cleanup');
//
// 通用性：本框架对任意声明 ttl_days>0 的 POI 模板均生效，不限于 campfire_unlit。
// 未来若引入木箱/陷阱等短期 POI，仅需在 poi_table 配置 ttl_days 即可纳入。
//
// 设计文档：oblivions/docs/玩家放置POI与耐久系统-设计案.md
// ================================================================

/**
 * POI 耐久清理（day_changed 事件监听器）
 *
 * 流程：
 *   1. 解析 $transition['to']['day'] 为当前天数
 *   2. SELECT 所有 ttl_days > 0 AND placed_at_day + ttl_days <= current_day 的 POI iaid
 *   3. 级联 DELETE bra_oblmapitem WHERE source_iaid IN (iaid_list)（POI 产出待拾取道具）
 *   4. DELETE bra_oblmappoi WHERE iaid IN (iaid_list)
 *   5. emit poi.durability.cleanup 事件，传 day / cleaned_count / iaid_list
 *
 * 注：级联清理 bra_oblmapitem 走 source_iaid（POI 产出道具的来源标记），
 * 不影响野生道具（source_iaid=0）与玩家丢弃道具（iaid=0, source_iaid=0）。
 * 待拾取道具被一并清理是合理语义：POI 消失后其产出物无依附对象。
 *
 * @param array $transition day_changed 事件 transition 结构
 * @return void
 * @global object $db
 * @global string $tablepre
 */
function obl_poi_durability_cleanup(array $transition) {
    global $db, $tablepre, $obl_log;

    if (!isset($db) || !$db || !isset($tablepre)) return;

    $current_day = isset($transition['to']['day']) ? (int)$transition['to']['day'] : 0;
    if ($current_day <= 0) return;

    // 1. 批量查询到期 POI（idx_ttl_expiry 索引覆盖：ttl_days>0 等值过滤 + placed_at_day 范围扫描）
    $threshold = $current_day;  // placed_at_day + ttl_days <= current_day
    $result = $db->query("SELECT iaid FROM {$tablepre}oblmappoi
                          WHERE ttl_days > 0
                            AND placed_at_day + ttl_days <= {$threshold}");
    if (!$result) return;

    $iaid_list = array();
    while ($row = $db->fetch_array($result)) {
        $iaid_list[] = (int)$row['iaid'];
    }
    if (empty($iaid_list)) return;

    // 2. 级联清理 bra_oblmapitem（POI 产出待拾取道具）
    // 注：典型短期 POI（如 campfire_unlit searchable=false）无 source_iaid>0 关联道具，
    // 此处级联清理为通用保护，避免任何配置变更后遗漏。
    $iaid_in = implode(',', $iaid_list);
    $db->query("DELETE FROM {$tablepre}oblmapitem
                WHERE source_iaid IN ({$iaid_in})");

    // 3. 批量 DELETE POI 实例
    $db->query("DELETE FROM {$tablepre}oblmappoi
                WHERE iaid IN ({$iaid_in})");

    // 4. emit 清理事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('poi.durability.cleanup', 'system', [
            'day'            => $current_day,
            'cleaned_count'  => count($iaid_list),
            'iaid_list'      => $iaid_list,
        ]);
    }
}
