<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 对话框处理：dialogue_choice + end_dialogue
// Dialogue handler: dialogue_choice + end_dialogue
// ================================================================

// 对话选择处理 / Handle dialogue choice
function cmd_handle_dialogue_choice($command, &$mode) {
    global $log, $clbpara, $dialogue_branch, $dialogue_log;
    global $dialogue_id, $opendialog;

    $choice_parts = explode(' ', $command);
    if (count($choice_parts) >= 3) {
        $dialogue_id = $choice_parts[1];
        $choice_index = $choice_parts[2];

        // 检查对话 ID 和选择索引是否有效
        if (isset($dialogue_branch[$dialogue_id]) && isset($dialogue_branch[$dialogue_id][$choice_index])) {
            // 记录玩家的选择
            $clbpara['dialogue_choice'] = array(
                'dialogue_id' => $dialogue_id,
                'choice_index' => $choice_index,
                'choice_text' => $dialogue_branch[$dialogue_id][$choice_index]
            );

            $log .= "你选择了：<span class=\"yellow\">{$dialogue_branch[$dialogue_id][$choice_index]}</span><br>";

            // 如果有对应的选择结果日志
            $choice_log_key = $dialogue_id . '_choice_' . $choice_index;
            if (isset($dialogue_log[$choice_log_key]) && !empty($dialogue_log[$choice_log_key])) {
                $log .= $dialogue_log[$choice_log_key];
            } elseif (isset($dialogue_log[$dialogue_id]) && !empty($dialogue_log[$dialogue_id])) {
                $log .= $dialogue_log[$dialogue_id];
            } else {
                $log .= "<!-- DEBUG: 没有找到对应的对话日志 -->";
            }

            // 清除对话状态
            unset($clbpara['dialogue']);
            unset($clbpara['noskip_dialogue']);

            // 确保对话框不会重新打开
            $dialogue_id = null;
            $opendialog = null;

            $mode = 'command';
        } else {
            $log .= "<span class=\"red\">无效的对话选择！</span><br>";
        }
    } else {
        $log .= "<span class=\"red\">对话选择格式错误！</span><br>";
    }
}

// 结束对话处理 / Handle end dialogue
function cmd_handle_end_dialogue() {
    global $clbpara, $log, $dialogue_log;
    if (!empty($dialogue_log[$clbpara['dialogue']])) {
        $log .= $dialogue_log[$clbpara['dialogue']];
    }
    unset($clbpara['dialogue']);
    unset($clbpara['noskip_dialogue']);
}