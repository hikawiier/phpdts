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
 * 检查技能是否可用（不修改状态）
 *
 * 检查项：配置存在、actor 拥有该技能、CD 未锁定、AP 足够。
 * 供 AI 决策使用，避免选择无法通过校验的技能。
 *
 * @param array &$actor_data 先攻者数据
 * @param string $skill_id 技能 ID
 * @return bool 是否可用
 */
function skill_is_usable(&$actor_data, $skill_id) {
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
 * 4. 注入装备临时技能（MVP 无装备技能，预留空逻辑）
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

    # 4. 注入装备临时技能（MVP 无装备技能，预留）
    # skill_inject_equipment($skillpara);
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
 * 5. 自动引用 verify/{skill_id}.verify.php，文件存在则调用 {skill_id}_verify_check()
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
        if ($obl_battle_log) {
            $obl_battle_log->emit([
                'actor_pid'   => (int)$actor_data['pid'],
                'actor_type'  => (int)$actor_data['type'],
                'target_pid'  => 0,
                'target_type' => -1,
                'action_id'   => $act_id,
                'extra'       => ['result' => 'failed', 'reason' => 'no_config'],
            ]);
        }
        return false;
    }

    # 2. 检查是否拥有该技能
    if (!isset($actor_data['skillpara'][$act_id])) {
        if ($obl_battle_log) {
            $obl_battle_log->emit([
                'actor_pid'   => (int)$actor_data['pid'],
                'actor_type'  => (int)$actor_data['type'],
                'target_pid'  => 0,
                'target_type' => -1,
                'action_id'   => $act_id,
                'extra'       => ['result' => 'failed', 'reason' => 'not_owned'],
            ]);
        }
        return false;
    }

    # 3. 检查 CD
    $current_tick = isset($gamevars['obl_tick']) ? (int)$gamevars['obl_tick'] : 0;
    $lstact = isset($actor_data['skillpara'][$act_id]['lstact']) ? (int)$actor_data['skillpara'][$act_id]['lstact'] : 0;
    $cd = isset($config['cd']) ? (int)$config['cd'] : 0;
    if ($cd > 0 && ($current_tick - $lstact) < $cd) {
        if ($obl_battle_log) {
            $obl_battle_log->emit([
                'actor_pid'   => (int)$actor_data['pid'],
                'actor_type'  => (int)$actor_data['type'],
                'target_pid'  => 0,
                'target_type' => -1,
                'action_id'   => $act_id,
                'extra'       => ['result' => 'failed', 'reason' => 'on_cd', 'remaining' => $cd - ($current_tick - $lstact)],
            ]);
        }
        return false;
    }

    # 4. 检查 AP
    $apcost = isset($config['apcost']) ? (int)$config['apcost'] : 0;
    if ($apcost > 0 && (int)$actor_data['ap'] < $apcost) {
        if ($obl_battle_log) {
            $obl_battle_log->emit([
                'actor_pid'   => (int)$actor_data['pid'],
                'actor_type'  => (int)$actor_data['type'],
                'target_pid'  => 0,
                'target_type' => -1,
                'action_id'   => $act_id,
                'extra'       => ['result' => 'failed', 'reason' => 'no_ap', 'ap' => (int)$actor_data['ap'], 'apcost' => $apcost],
            ]);
        }
        return false;
    }

    # 5. 自动引用 verify/{skill_id}.verify.php
    $verify_file = GAME_ROOT . './oblivions/include/game/skill/verify/' . $act_id . '.verify.php';
    if (file_exists($verify_file)) {
        include_once $verify_file;
        $verify_func = $act_id . '_verify_check';
        if (function_exists($verify_func)) {
            if (!$verify_func($actor_data, $obl_battle_log, $battle_cache)) {
                if ($obl_battle_log) {
                    $obl_battle_log->emit([
                        'actor_pid'   => (int)$actor_data['pid'],
                        'actor_type'  => (int)$actor_data['type'],
                        'target_pid'  => 0,
                        'target_type' => -1,
                        'action_id'   => $act_id,
                        'extra'       => ['result' => 'failed', 'reason' => 'verify_check_failed'],
                    ]);
                }
                return false;
            }
        }
    }

    # 6. 校验通过：扣除 AP，更新 lstact
    if ($apcost > 0) {
        $actor_data['ap'] -= $apcost;
    }
    $actor_data['skillpara'][$act_id]['lstact'] = $current_tick;

    if ($obl_battle_log) {
        $obl_battle_log->emit([
            'actor_pid'   => (int)$actor_data['pid'],
            'actor_type'  => (int)$actor_data['type'],
            'target_pid'  => 0,
            'target_type' => -1,
            'action_id'   => $act_id,
            'extra'       => ['result' => 'passed', 'apcost' => $apcost, 'tick' => $current_tick],
        ]);
    }
    return true;
}

/**
 * 技能执行（由 battle_once_execute 调用）
 *
 * 职责：
 * 1. 自动引用 calc/{skill_id}.calc.php
 * 2. 文件存在则调用 {skill_id}_calc() 执行技能的复杂处理
 * 3. 文件不存在则无额外处理（伤害已由 obl_calc_damage + battle_apply_damage 处理）
 *
 * 调用时机：在 obl_calc_damage() + battle_apply_damage() 之后
 *
 * @param array &$actor_data 先攻者数据
 * @param string $act_id 动作 ID
 * @param array &$target_data 目标数据
 * @param BattleLogCollector &$obl_battle_log
 * @param array &$battle_cache
 */
function skill_execute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache) {
    $calc_file = GAME_ROOT . './oblivions/include/game/skill/calc/' . $act_id . '.calc.php';
    if (!file_exists($calc_file)) {
        return; # 无 calc 文件，伤害已由 obl_calc_damage + battle_apply_damage 处理
    }

    include_once $calc_file;
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

        $skills[] = array(
            'act_id'       => $skill_id,
            'apcost'       => $apcost,
            'cd'           => $cd,
            'target'       => isset($config['target']) ? $config['target'] : 'self',
            'range_bonus'  => isset($config['range_bonus']) ? (int)$config['range_bonus'] : 0,
            'category'     => isset($config['category']) ? $config['category'] : 'utility',
            'lstact'       => $lstact,
            'current_tick' => $current_tick,
            'on_cd'        => $on_cd,
            'available'    => $available,
        );
    }

    return $skills;
}
