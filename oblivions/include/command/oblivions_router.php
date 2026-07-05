<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 命令子路由 / Oblivions command sub-router
//
// 由 obl_command.php 在 Oblivions 模式下调用，独立于旧模式的 include/command/router.php。
// 所有 Oblivions 命令的分发逻辑集中在此，不再散落在旧路由树内。
// ================================================================

/**
 * Oblivions 命令分发
 *
 * @param string $command 命令名
 * @param array  &$pdata  玩家数据
 * @param array  $post    过滤后的 POST 数据
 * @return string 返回 mode（'command' 等）
 */
function oblivions_cmd_dispatch($command, &$pdata, $post) {
    include_once GAME_ROOT . './oblivions/include/command/oblivions_commands.php';
    global $obl_log;

    // 全局门控：itm0 不为空时，只放行整理和丢弃命令
    // 设计案 §4.2：itm0 中的道具处于"待整理"状态，玩家必须先处理才能继续其他游戏行为
    $itm0_pending = isset($pdata['itempara'][0]) && is_array($pdata['itempara'][0]) && !empty($pdata['itempara'][0]['itmid']);
    if ($itm0_pending && !in_array($command, ['obl_organize', 'obl_discard'], true)) {
        $obl_log->emit('system.itm0_pending', 'system');
        return 'command';
    }

    switch ($command) {
        case 'move':
            // 移动：由 obl_move 处理（pgroup + pls 邻接表连通图移动）
            include_once GAME_ROOT . './oblivions/include/game/move.func.php';
            $moveto = isset($post['moveto']) ? $post['moveto'] : '';
            obl_move($moveto, $pdata);
            return 'command';

        case 'obl_explore':
            cmd_handle_obl_explore($pdata);
            return 'command';

        case 'obl_search':
            cmd_handle_obl_search(isset($post['iaid']) ? $post['iaid'] : 0, $pdata);
            return 'command';

        case 'obl_pickup':
            cmd_handle_obl_pickup(isset($post['iid']) ? $post['iid'] : 0, $pdata);
            return 'command';

        case 'obl_discard':
            cmd_handle_obl_discard(isset($post['slot']) ? $post['slot'] : 0, $pdata);
            return 'command';

        case 'obl_organize':
            cmd_handle_obl_organize($pdata);
            return 'command';

        case 'obl_battle_start':
            $actions = oblivions_parse_actions($post);
            cmd_handle_obl_battle_start($pdata, $actions);
            return 'command';

        case 'obl_battle_action':
            $actions = oblivions_parse_actions($post);
            cmd_handle_obl_battle_action($pdata, $actions);
            return 'command';

        case 'obl_use_item':
            cmd_handle_obl_use_item(isset($post['slot']) ? $post['slot'] : 0, $pdata);
            return 'command';

        case 'obl_craft':
            cmd_handle_obl_craft(
                isset($post['slots']) ? $post['slots'] : '',
                isset($post['workbench_materials']) ? $post['workbench_materials'] : '',
                $pdata
            );
            return 'command';

        default:
            // 未知命令：返回 command mode，由上层兜底处理
            return 'command';
    }
}

/**
 * 从 POST 解析 actions JSON
 *
 * actions 以 JSON 字符串传递，gstrfilter 会将双引号转为 &quot;，
 * 需先 html_entity_decode 还原后再 json_decode。
 *
 * @param array $post 过滤后的 POST 数据
 * @return array|null 解析后的 actions 数组，无效时返回 null
 */
function oblivions_parse_actions($post) {
    $actions = isset($post['actions']) ? $post['actions'] : null;
    if (is_string($actions)) {
        $decoded = json_decode(html_entity_decode($actions, ENT_QUOTES), true);
        return is_array($decoded) ? $decoded : null;
    }
    return $actions;
}