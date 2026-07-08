<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 技能系统核心 / Oblivions skill system core
//
// 职责：配置读取、skillpara 格式化、动作校验、技能执行分发
// 设计原则：一切皆技能；配置驱动分类；tick 时间戳记 CD；单技能单文件自动引用
// ================================================================

# 全局缓存：技能配置（由 skill_get_all_configs() 初始化）
$__skill_configs_cache = null;

/**
 * 获取技能配置（带静态缓存）
 *
 * @param string $skill_id 技能 ID
 * @return array|null 配置数组，不存在返回 null
 */
function skill_get_config($skill_id) {
    $configs = skill_get_all_configs();
    return isset($configs[$skill_id]) ? $configs[$skill_id] : null;
}

/**
 * 检查技能配置中是否定义了冷却（cd > 0）
 *
 * 纯配置查询，不涉及玩家状态。用于前端队列约束：
 * 有 CD 定义的技能在装填队列中最多出现一次。
 *
 * @param string $skill_id 技能 ID
 * @return bool true=有 CD 定义，false=无 CD 定义或配置不存在
 */
function skill_has_cd($skill_id) {
    $config = skill_get_config($skill_id);
    if (!$config) return false;
    return isset($config['cd']) && (int)$config['cd'] > 0;
}

/**
 * 检查技能是否为终结技（finisher）
 *
 * 纯配置查询，不涉及玩家状态。用于后端排序兜底：
 * 终结技在装填队列中只能存在一个且永远在末尾执行。
 *
 * @param string $skill_id 技能 ID
 * @return bool true=是终结技，false=不是或配置不存在
 */
function skill_is_finisher($skill_id) {
    $config = skill_get_config($skill_id);
    if (!$config) return false;
    return !empty($config['finisher']);
}

/**
 * 检查技能是否可用（不修改状态）
 *
 * 检查项：配置存在、actor 拥有该技能、CD 未锁定、AP 足够。
 * 当传入 $target_data 时追加射程预判（目标非 self 才检查）。
 * 供 AI 决策使用，避免选择无法通过校验或射程不足的技能。
 *
 * @param array &$actor_data 先攻者数据
 * @param string $skill_id 技能 ID
 * @param array $target_data 目标数据（可选，传入时启用射程预判；非引用，可传 null）
 * @return bool 是否可用
 */
function skill_is_usable(&$actor_data, $skill_id, $target_data = null) {
    # 1. 查配置
    $config = skill_get_config($skill_id);
    if (!$config) return false;

    # 2. 检查是否拥有该技能
    if (!isset($actor_data['skillpara'][$skill_id])) return false;

    # 3. 检查 CD
    global $gamevars;
    $current_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $lstact = isset($actor_data['skillpara'][$skill_id]['lstact']) ? (int)$actor_data['skillpara'][$skill_id]['lstact'] : 0;
    $cd = isset($config['cd']) ? (int)$config['cd'] : 0;
    if ($cd > 0 && ($current_tick - $lstact) < $cd) return false;

    # 4. 检查 AP
    $apcost = isset($config['apcost']) ? (int)$config['apcost'] : 0;
    if ($apcost > 0 && (int)$actor_data['ap'] < $apcost) return false;

    # 5. 射程预判（仅当 target_data 提供且目标非 self 时）
    #    注意：pgroup 无效或跨区域时 return false 是保守策略——
    #    当前唯一调用方 NPC AI 只在同区域战斗时决策，pgroup 必然 >0。
    #    未来玩家侧复用时需重新评估此边界（战前 pgroup=0 会被误判不可用）。
    if ($target_data !== null && (int)$actor_data['pid'] !== (int)$target_data['pid']) {
        include_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';
        include_once GAME_ROOT . './oblivions/include/game/move.func.php';
        $action_range = obl_get_action_range($actor_data, $skill_id);
        $actor_pgroup = isset($actor_data['pgroup']) ? (int)$actor_data['pgroup'] : 0;
        $target_pgroup = isset($target_data['pgroup']) ? (int)$target_data['pgroup'] : 0;
        $actor_pls = isset($actor_data['pls']) ? (int)$actor_data['pls'] : 0;
        $target_pls = isset($target_data['pls']) ? (int)$target_data['pls'] : 0;
        if ($actor_pgroup > 0 && $actor_pgroup === $target_pgroup && $actor_pls > 0 && $target_pls > 0) {
            $distance = obl_get_distance($actor_pgroup, $actor_pls, $target_pls);
            if ($distance < 0 || $distance > $action_range) return false;
        } else {
            return false;  // 不同区域或无效位置
        }
    }

    return true;
}

/**
 * 获取所有技能配置（带静态缓存）
 *
 * @return array 完整配置数组
 */
function skill_get_all_configs() {
    global $__skill_configs_cache;
    if ($__skill_configs_cache === null) {
        $__skill_configs_cache = include GAME_ROOT . './oblivions/gamedata/skill_config.php';
        if (!is_array($__skill_configs_cache)) {
            $__skill_configs_cache = array();
        }
    }
    return $__skill_configs_cache;
}

/**
 * 格式化 skillpara（由 obl_format_playerdata 调用）
 *
 * 职责：
 * 1. 确保 skillpara 是数组
 * 2. 迁移旧格式：若存在 skills key（旧格式 {"skills": []}），删除并视为空 skillpara
 * 3. 调用 skill_ensure_defaults 注入默认技能
 * 4. 装备临时技能注入由调用方 obl_format_playerdata 调用 skill_inject_equipment 完成
 *    （需要 $pdata 读取装备字段，因此不能在此处调用）
 *
 * @param array &$skillpara 玩家 skillpara 字段（引用）
 */
function skill_format_skillpara(&$skillpara) {
    # 1. 确保是数组
    if (!is_array($skillpara)) {
        $skillpara = array();
    }

    # 2. 迁移旧格式：检测并清除 {"skills": [...]} 结构
    if (isset($skillpara['skills'])) {
        unset($skillpara['skills']);
    }

    # 3. 注入默认技能
    skill_ensure_defaults($skillpara);

    # 4. 装备临时技能注入由调用方 obl_format_playerdata 调用 skill_inject_equipment 完成
    #    （需要 $pdata 读取装备字段，因此不能在此处调用）
}

/**
 * 确保默认技能存在（由 skill_format_skillpara 调用）
 *
 * MVP 默认技能：unarmed_strike、escape
 * 若 skillpara 中不存在这些 key，则初始化为 {"lstact": 0}
 *
 * @param array &$skillpara
 */
function skill_ensure_defaults(&$skillpara) {
    $defaults = array('unarmed_strike', 'escape');
    foreach ($defaults as $skill_id) {
        if (!isset($skillpara[$skill_id]) || !is_array($skillpara[$skill_id])) {
            $skillpara[$skill_id] = array('lstact' => 0);
        }
        # 确保 lstact 字段存在
        if (!isset($skillpara[$skill_id]['lstact'])) {
            $skillpara[$skill_id]['lstact'] = 0;
        }
    }
}

/**
 * 确保 NPC 专属默认技能存在（由 obl_format_playerdata 在 type>0 时调用）
 *
 * NPC 专属默认技能：idle（发呆兜底）
 * 玩家 skillpara 中永远不会有这些技能。
 *
 * @param array &$skillpara
 */
function skill_ensure_npc_defaults(&$skillpara) {
    $npc_defaults = array('idle');
    foreach ($npc_defaults as $skill_id) {
        if (!isset($skillpara[$skill_id]) || !is_array($skillpara[$skill_id])) {
            $skillpara[$skill_id] = array('lstact' => 0);
        }
        if (!isset($skillpara[$skill_id]['lstact'])) {
            $skillpara[$skill_id]['lstact'] = 0;
        }
    }
}

/**
 * 剥离临时技能（由 obl_save_player 调用）
 *
 * 遍历 skillpara，按 config 的 lifetime 字段过滤：
 * - permanent：保留
 * - equipment：剥离（下次 format 时重新注入）
 * - effect：保留（到期后由其他逻辑清理）
 *
 * MVP 无 equipment/effect 技能，此函数为预留逻辑
 *
 * @param array &$skillpara
 */
function skill_strip_temporary(&$skillpara) {
    if (!is_array($skillpara)) return;

    foreach ($skillpara as $skill_id => $state) {
        $config = skill_get_config($skill_id);
        if (!$config) {
            # 配置中不存在的技能，保留（可能是新技能尚未入库）
            continue;
        }
        # 剥离装备临时技能
        if (isset($config['lifetime']) && $config['lifetime'] === 'equipment') {
            unset($skillpara[$skill_id]);
        }
    }
}

/**
 * 动作合法性校验（由 battle_act_verify 调用）
 *
 * 职责：
 * 1. 查 skill_config 获取技能配置，不存在则失败
 * 2. 检查 actor 是否拥有该技能（skillpara 中有对应 key）
 * 3. 检查 CD：current_tick - lstact >= cd，否则失败
 * 4. 检查 AP：ap >= apcost，否则失败
 * 5. 调用 {skill_id}_verify_check()（由 modules 模块加载），存在则执行扩展校验
 * 6. 校验通过：扣除 AP，更新 lstact = current_tick，返回 true
 * 7. 校验失败：返回 false
 *
 * @param array &$actor_data 先攻者数据
 * @param string $act_id 动作 ID
 * @param BattleLogCollector &$obl_battle_log
 * @param array &$battle_cache
 * @return bool 校验是否通过
 */
function skill_act_verify(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache) {
    global $gamevars;

    # 1. 查配置
    $config = skill_get_config($act_id);
    if (!$config) {
        return false;
    }

    # 2. 检查是否拥有该技能
    if (!isset($actor_data['skillpara'][$act_id])) {
        return false;
    }

    # 3. 检查 CD
    $current_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $lstact = isset($actor_data['skillpara'][$act_id]['lstact']) ? (int)$actor_data['skillpara'][$act_id]['lstact'] : 0;
    $cd = isset($config['cd']) ? (int)$config['cd'] : 0;
    if ($cd > 0 && ($current_tick - $lstact) < $cd) {
        return false;
    }

    # 4. 检查 AP
    $apcost = isset($config['apcost']) ? (int)$config['apcost'] : 0;
    if ($apcost > 0 && (int)$actor_data['ap'] < $apcost) {
        return false;
    }

    # 5. 技能扩展校验：{skill_id}_verify_check（由 modules 模块加载）
    $verify_func = $act_id . '_verify_check';
    if (function_exists($verify_func)) {
        if (!$verify_func($actor_data, $obl_battle_log, $battle_cache)) {
            return false;
        }
    }


    # 6. 校验通过：扣除 AP，更新 lstact
    if ($apcost > 0) {
        $actor_data['ap'] -= $apcost;
    }
    $actor_data['skillpara'][$act_id]['lstact'] = $current_tick;
    return true;
}


/**
 * 注入装备临时技能。
 *
 * 这里只做通用 hook 调度；具体技能逻辑由 skill/modules/*.skill.php 注册。
 *
 * @param array &$skillpara
 * @param array &$pdata
 */
function skill_inject_equipment(&$skillpara, &$pdata) {
    if (!function_exists('skill_get_equipment_injectors')) return;
    $injectors = skill_get_equipment_injectors();
    foreach ($injectors as $func) {
        if (function_exists($func)) {
            $func($skillpara, $pdata);
        }
    }
}

/**
 * 技能执行（历史旧 battle_once_execute 调用；new combat 技能执行走 combat/skill 模块）
 *
 * 职责：
 * 1. 调用 {skill_id}_calc() 执行技能的非伤害处理（由 modules 模块加载）
 * 2. 无 calc 函数的技能直接跳过（伤害由 obl_calc_damage + battle_apply_damage 处理）
 *
 * 调用时机：在 obl_calc_damage() + battle_apply_damage() 之前
 *
 * @param array &$actor_data 先攻者数据
 * @param string $act_id 动作 ID
 * @param array &$target_data 目标数据
 * @param BattleLogCollector &$obl_battle_log
 * @param array &$battle_cache
 */
function skill_execute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache) {
    $calc_func = $act_id . '_calc';
    if (function_exists($calc_func)) {
        $calc_func($actor_data, $target_data, $obl_battle_log, $battle_cache);
    }
}

/**
 * 获取玩家可用技能列表（由 skill_list API 调用）
 *
 * 职责：
 * 1. 遍历 skillpara 的 keys
 * 2. 对每个 key 查 skill_config 获取配置
 * 3. 附加运行时状态：lstact、current_tick、on_cd、available
 * 4. 返回技能列表数组
 *
 * @param array &$pdata 玩家数据
 * @return array 技能列表
 */
function skill_get_available_list(&$pdata) {
    global $gamevars;

    $current_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $player_ap = isset($pdata['ap']) ? (int)$pdata['ap'] : 0;
    $player_max_ap = isset($pdata['max_ap']) ? (int)$pdata['max_ap'] : 0;

    $skills = array();
    if (!isset($pdata['skillpara']) || !is_array($pdata['skillpara'])) {
        return $skills;
    }

    foreach ($pdata['skillpara'] as $skill_id => $state) {
        $config = skill_get_config($skill_id);
        if (!$config) continue;

        $lstact = isset($state['lstact']) ? (int)$state['lstact'] : 0;
        $cd = isset($config['cd']) ? (int)$config['cd'] : 0;
        $apcost = isset($config['apcost']) ? (int)$config['apcost'] : 0;

        $on_cd = ($cd > 0 && ($current_tick - $lstact) < $cd);
        $available = !$on_cd && $player_ap >= $apcost;

        $range_mode  = isset($config['range_mode']) ? (string)$config['range_mode'] : 'fixed';
        $range_max   = isset($config['range_max']) ? (int)$config['range_max'] : 1;
        $range_bonus = isset($config['range_bonus']) ? (int)$config['range_bonus'] : 0;
        $action_range = function_exists('obl_get_action_range') ? obl_get_action_range($pdata, $skill_id) : $range_max;

        $skills[] = array(
            'act_id'       => $skill_id,
            'apcost'       => $apcost,
            'cd'           => $cd,
            'finisher'     => isset($config['finisher']) ? (int)$config['finisher'] : 0,
            'target'       => isset($config['target']) ? $config['target'] : 'self',
            'range_mode'   => $range_mode,
            'range_max'    => $range_max,
            'range_bonus'  => $range_bonus,
            'action_range' => $action_range,
            'category'     => isset($config['category']) ? $config['category'] : 'utility',
            'hidden'       => !empty($config['hidden']),
            'lstact'       => $lstact,
            'current_tick' => $current_tick,
            'on_cd'        => $on_cd,
            'available'    => $available,
        );
    }

    return $skills;
}
