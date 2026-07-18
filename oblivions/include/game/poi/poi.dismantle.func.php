<?php
/**
 * @module F 物品系统
 * @framework F-7 玩家放置 POI 框架
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions F-7 poi.dismantle 命令主流程
//
// 玩家主动拆除当前格 POI，按模板 dismantle_returns 配置返还部分材料。
// 与 F-6 poi.interact 不同：dismantle 不依赖道具，是玩家直接对 POI 的动作，
// 故不复用 poi_interact 的 slot 语义，独立命令更清晰。
//
// 设计原则：
//   - 任意 POI 都可拆除（不限于 F-7 放置的 POI），但只有模板配置 dismantle_returns
//     时才返还材料；世界生成 POI 也可被拆除（玩家"清理地形"语义）
//   - 拆除是 advances_tick=true 行为，与 poi.search / poi.interact 一致
//   - 返还材料走 itm0 → organize 与 F-1 同模式，背包满则掉到地上
//   - 同时清理 POI 实例 + 关联的 source_iaid 待拾取道具
//
// 命令入口：obl_command_handler_poi_dismantle（obl_command_handlers.php）
//   - payload: {iaid}
//   - 复用 obl_lookup_poi_for_search 做位置校验
//
// 设计文档：oblivions/docs/玩家放置POI与耐久系统-设计案.md §四
// ================================================================

/**
 * poi.dismantle 主入口
 *
 * 流程：
 *   1. 复用 obl_lookup_poi_for_search 做 POI 实例查询 + 位置校验
 *   2. 加载 POI 模板，取 dismantle_returns 配置（数组，可能为空或不存在）
 *   3. 乐观锁 DELETE FROM oblmappoi WHERE iaid=X
 *      affected=0 → emit poi.dismantle.concurrent_conflict，return
 *   4. 级联 DELETE FROM oblmapitem WHERE source_iaid=X（清理待拾取道具）
 *   5. 按 dismantle_returns 配置生成返还道具实例，逐件经 itm0 → organize 放入背包
 *   6. 背包满 → 返还道具掉到地上（INSERT oblmapitem, iaid=0, source_iaid=0）
 *   7. emit poi.dismantle.success（含返还道具 ID 列表）
 *
 * @param int   $iaid  POI 实例 ID
 * @param array &$pdata 玩家数据引用
 * @return void
 */
function poi_dismantle($iaid, &$pdata) {
    global $db, $tablepre, $obl_log;

    if (!isset($db) || !$db || !isset($tablepre)) return;

    // 1. 复用 obl_lookup_poi_for_search 做 POI 实例查询 + 位置校验
    //    函数已 emit not_found / not_adjacent 日志，调用方无需重复
    $poi = obl_lookup_poi_for_search($iaid, $pdata);
    if ($poi === null) {
        return;
    }

    $iaid = (int)$poi['iaid'];
    $poi_id = isset($poi['poi_id']) ? (string)$poi['poi_id'] : '';

    // 2. 加载 POI 模板，取 dismantle_returns 配置
    $poi_table = include GAME_ROOT . './oblivions/gamedata/poi_table.php';
    $template = isset($poi_table[$poi_id]) ? $poi_table[$poi_id] : null;
    $returns_config = ($template && isset($template['dismantle_returns']) && is_array($template['dismantle_returns']))
        ? $template['dismantle_returns']
        : array();

    // 3. 乐观锁 DELETE POI 实例（DELETE WHERE iaid=X；affected=0 表示并发已删除）
    $db->query("DELETE FROM {$tablepre}oblmappoi WHERE iaid='{$iaid}'");
    $affected = $db->affected_rows();
    if ($affected <= 0) {
        if (isset($obl_log) && $obl_log) {
            $obl_log->emit('poi.dismantle.concurrent_conflict', 'poi_dismantle', [
                'iaid'  => $iaid,
                'poi_id'=> $poi_id,
            ]);
        }
        return;
    }

    // 4. 级联清理 bra_oblmapitem.source_iaid=iaid 的待拾取道具
    $db->query("DELETE FROM {$tablepre}oblmapitem WHERE source_iaid='{$iaid}'");

    // 5. 按 dismantle_returns 配置生成返还道具实例，逐件经 itm0 → organize 放入背包
    $returned_ids = array();
    $dropped_ids = array();
    if (!empty($returns_config)) {
        $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';

        foreach ($returns_config as $ret) {
            $ret_item_id = isset($ret['item_id']) ? (string)$ret['item_id'] : '';
            $ret_count = isset($ret['count']) ? (int)$ret['count'] : 1;
            if ($ret_item_id === '' || !isset($item_table[$ret_item_id]) || $ret_count <= 0) {
                continue;
            }

            for ($i = 0; $i < $ret_count; $i++) {
                $new_item = item_instantiate_from_template($item_table[$ret_item_id], $ret_item_id);
                if ($new_item === null) continue;

                // 优先经 itm0 → organize 放入背包
                if (function_exists('obl_put_item_to_itm0') && obl_put_item_to_itm0($pdata, $new_item)) {
                    if (function_exists('obl_organize_inventory') && obl_organize_inventory($pdata)) {
                        $returned_ids[] = $ret_item_id;
                        continue;
                    }
                    // organize 失败（背包满+无法合并）→ itm0 仍占用，落到地面
                    unset($pdata['itempara'][0]);
                }

                // 背包满 → 掉到地上（INSERT oblmapitem, iaid=0, source_iaid=0）
                obl_drop_item_to_ground($pdata, $new_item);
                $dropped_ids[] = $ret_item_id;
            }
        }
    }

    // 6. emit 成功事件
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('poi.dismantle.success', 'poi_dismantle', [
            'iaid'         => $iaid,
            'poi_id'       => $poi_id,
            'returned_ids' => $returned_ids,
            'dropped_ids'  => $dropped_ids,
        ]);
    }
}

// ----------------------------------------------------------------
// 辅助函数
// ----------------------------------------------------------------

/**
 * 从模板生成道具实例（itempara 七字段数组）
 *
 * 用于 dismantle 返还材料时实例化模板。itmpara 在 stack=true 道具上保留模板值，
 * 但对 F-7 place_poi 道具（如 firewood）应保留 itmpara 以维持放置语义。
 *
 * @param array  $template 模板行（item_table 的 entry）
 * @param string $item_id  道具 ID
 * @return array|null 实例行或 null（模板无效）
 */
function item_instantiate_from_template($template, $item_id) {
    if (!is_array($template) || empty($item_id)) return null;

    return [
        'itmid'   => $item_id,
        'itm'     => '',
        'itmk'    => isset($template['itmk']) ? (string)$template['itmk'] : '',
        'itme'    => isset($template['itme']) ? (int)$template['itme'] : 0,
        'itms'    => isset($template['itms']) ? (string)$template['itms'] : '1',
        'itmsk'   => isset($template['itmsk']) ? (string)$template['itmsk'] : '',
        'itmpara' => isset($template['itmpara']) ? (string)$template['itmpara'] : '',
    ];
}

/**
 * 将道具实例掉到玩家当前格地面（INSERT bra_oblmapitem, iaid=0, source_iaid=0）
 *
 * 用于 dismantle 返还时背包满的兜底场景。
 * 字段列表与 wild_refresh.func.php 的 INSERT 一致。
 *
 * @param array &$pdata 玩家数据（取 pgroup/pls）
 * @param array $item   道具实例
 * @return void
 */
function obl_drop_item_to_ground(&$pdata, $item) {
    global $db, $tablepre;
    if (!isset($db) || !$db || !isset($tablepre)) return;

    $pgroup = (int)$pdata['pgroup'];
    $pls = (int)$pdata['pls'];

    $item_id_esc = $db->escape_string(isset($item['itmid']) ? (string)$item['itmid'] : '');
    $itm_esc     = $db->escape_string(isset($item['itm']) ? (string)$item['itm'] : '');
    $itmk_esc    = $db->escape_string(isset($item['itmk']) ? (string)$item['itmk'] : '');
    $itme        = (int)(isset($item['itme']) ? $item['itme'] : 0);
    $itms_esc    = $db->escape_string(isset($item['itms']) ? (string)$item['itms'] : '1');
    $itmsk_esc   = $db->escape_string(isset($item['itmsk']) ? (string)$item['itmsk'] : '');
    $itmpara_esc = $db->escape_string(isset($item['itmpara']) ? (string)$item['itmpara'] : '');

    $db->query("INSERT INTO {$tablepre}oblmapitem
                (pgroup, pls, iaid, source_iaid, item_id, itm, itmk, itme, itms, itmsk, itmpara,
                 discovered, fake_item_id, is_trap)
                VALUES
                ({$pgroup}, {$pls}, 0, 0, '{$item_id_esc}', '{$itm_esc}', '{$itmk_esc}',
                 {$itme}, '{$itms_esc}', '{$itmsk_esc}', '{$itmpara_esc}',
                 1, '', 0)");
}
