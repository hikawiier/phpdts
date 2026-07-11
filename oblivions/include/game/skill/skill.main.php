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

# 全局缓存：技能静态定义。主动战斗机制由 combat_skill_config.php 独占。
$__skill_definitions_cache = null;

/**
 * 获取技能配置（带静态缓存）
 *
 * @param string $skill_id 技能 ID
 * @return array|null 配置数组，不存在返回 null
 */
function skill_get_definition($skill_id) {
    $definitions = skill_get_all_definitions();
    return isset($definitions[$skill_id]) ? $definitions[$skill_id] : null;
}

function skill_get_all_definitions() {
    global $__skill_definitions_cache;
    if ($__skill_definitions_cache === null) {
        $__skill_definitions_cache = include GAME_ROOT . './oblivions/gamedata/skill_definition_config.php';
        if (!is_array($__skill_definitions_cache)) $__skill_definitions_cache = array();
        foreach ($__skill_definitions_cache as $skill_id => $definition) {
            if (!is_array($definition)) throw new UnexpectedValueException('Invalid skill definition: ' . $skill_id);
            $lifetime = (string)($definition['lifetime'] ?? '');
            if (!in_array($lifetime, array('permanent', 'equipment', 'effect'), true)) {
                throw new UnexpectedValueException('Invalid skill lifetime: ' . $skill_id);
            }
            if ($lifetime === 'equipment') {
                $grant = $definition['equipment_grant'] ?? null;
                if (!is_array($grant)) {
                    throw new UnexpectedValueException('Missing equipment grant: ' . $skill_id);
                }
                $slots = $grant['slots'] ?? array();
                $tags = $grant['any_tags'] ?? array();
                $kinds = $grant['any_kinds'] ?? array();
                if (!is_array($slots) || empty($slots)) {
                    throw new UnexpectedValueException('Invalid equipment grant slots: ' . $skill_id);
                }
                foreach ($slots as $slot) {
                    if (!in_array($slot, array('wep', 'wep2', 'arb', 'arh', 'ara', 'arf', 'art'), true)) {
                        throw new UnexpectedValueException('Unknown equipment grant slot: ' . $skill_id . ':' . $slot);
                    }
                }
                if (!is_array($tags) || !is_array($kinds) || (empty($tags) && empty($kinds))) {
                    throw new UnexpectedValueException('Equipment grant requires tags or kinds: ' . $skill_id);
                }
            }
            foreach (($definition['capability_denies'] ?? array()) as $capability) {
                if (function_exists('actor_capability_is_known') && !actor_capability_is_known((string)$capability)) {
                    throw new UnexpectedValueException('Unknown capability in skill definition: ' . $skill_id . ':' . $capability);
                }
            }
        }
    }
    return $__skill_definitions_cache;
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
    $config = function_exists('combat_skill_get_config') ? combat_skill_get_config((string)$skill_id) : null;
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
    $config = function_exists('combat_skill_get_config') ? combat_skill_get_config((string)$skill_id) : null;
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
    $config = function_exists('combat_skill_get_config') ? combat_skill_get_config((string)$skill_id) : null;
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
        $range = combat_range_resolve_base($actor_data, (string)$skill_id);
        $action_range = !empty($range['ok']) ? (int)$range['base_range'] : 0;
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

    foreach (array_keys($skillpara) as $skill_id) {
        if (!is_array($skillpara[$skill_id])) {
            unset($skillpara[$skill_id]);
            continue;
        }
        $definition = skill_get_definition((string)$skill_id);
        if (!$definition) {
            if (isset($skillpara[$skill_id]['effect_instances'])) {
                if (function_exists('skill_effect_log_invalid')) skill_effect_log_invalid((string)$skill_id, 'definition_missing');
                unset($skillpara[$skill_id]);
            }
            continue;
        }
        if (($definition['lifetime'] ?? 'permanent') === 'effect' && function_exists('skill_effect_format_skill_state')) {
            skill_effect_format_skill_state((string)$skill_id, $skillpara[$skill_id]);
            if (empty($skillpara[$skill_id]['effect_instances'])) unset($skillpara[$skill_id]);
        } elseif (!isset($skillpara[$skill_id]['lstact'])) {
            $skillpara[$skill_id]['lstact'] = 0;
        }
    }

    # 4. 装备临时技能注入由调用方 obl_format_playerdata 调用 skill_inject_equipment 完成
    #    （需要 $pdata 读取装备字段，因此不能在此处调用）
}

/**
 * 确保默认技能存在（由 skill_format_skillpara 调用）
 *
 * 测试默认技能：Phase 6 验收基线中非装备来源的玩家技能。
 * 若 skillpara 中不存在这些 key，则初始化为 {"lstact": 0}
 *
 * @param array &$skillpara
 */
function skill_ensure_defaults(&$skillpara) {
    $defaults = array(
        'unarmed_strike',
        'escape',
        'move',
        'heal',
        'whirlwind',
        'execute',
        'vampiric_bite',
        'grenade',
    );
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
        $definition = skill_get_definition((string)$skill_id);
        if (!$definition) {
            # 配置中不存在的技能，保留（可能是新技能尚未入库）
            continue;
        }
        # 剥离装备临时技能
        if (($definition['lifetime'] ?? 'permanent') === 'equipment') {
            unset($skillpara[$skill_id]);
        } elseif (($definition['lifetime'] ?? '') === 'effect') {
            if (!is_array($state) || empty($state['effect_instances'])) unset($skillpara[$skill_id]);
        }
    }
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
    foreach (skill_get_all_definitions() as $skill_id => $definition) {
        if (($definition['lifetime'] ?? '') !== 'equipment') continue;
        if (!skill_equipment_grant_matches($definition['equipment_grant'] ?? array(), $pdata)) continue;
        if (!isset($skillpara[$skill_id]) || !is_array($skillpara[$skill_id])) {
            $skillpara[$skill_id] = array('lstact' => 0);
        } elseif (!isset($skillpara[$skill_id]['lstact'])) {
            $skillpara[$skill_id]['lstact'] = 0;
        }
    }

    if (!function_exists('skill_get_equipment_injectors')) return;
    $injectors = skill_get_equipment_injectors();
    foreach ($injectors as $func) {
        if (function_exists($func)) {
            $func($skillpara, $pdata);
        }
    }
}

function skill_equipment_grant_matches($grant, &$pdata) {
    if (!is_array($grant)) return false;
    $slots = isset($grant['slots']) && is_array($grant['slots']) ? $grant['slots'] : array();
    $tags = isset($grant['any_tags']) && is_array($grant['any_tags']) ? $grant['any_tags'] : array();
    $kinds = isset($grant['any_kinds']) && is_array($grant['any_kinds']) ? $grant['any_kinds'] : array();

    foreach ($slots as $slot) {
        $item_id = isset($pdata[$slot . 'id']) ? (string)$pdata[$slot . 'id'] : '';
        $kind = isset($pdata[$slot . 'k']) ? (string)$pdata[$slot . 'k'] : '';
        if ($kind !== '' && in_array($kind, $kinds, true)) return true;
        if ($item_id === '' || !function_exists('item_has_tag')) continue;
        foreach ($tags as $tag) {
            if (item_has_tag($item_id, (string)$tag)) return true;
        }
    }
    return false;
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
        $combat_config = function_exists('combat_skill_get_config') ? combat_skill_get_config((string)$skill_id) : null;
        if (!$combat_config) continue;
        $definition = skill_get_definition((string)$skill_id);
        if (!$definition || ($definition['lifetime'] ?? '') === 'effect') continue;

        $lstact = isset($state['lstact']) ? (int)$state['lstact'] : 0;
        $cd = isset($combat_config['cd']) ? (int)$combat_config['cd'] : 0;
        $apcost = isset($combat_config['apcost']) ? (int)$combat_config['apcost'] : 0;

        $on_cd = ($cd > 0 && ($current_tick - $lstact) < $cd);
        $available = !$on_cd && $player_ap >= $apcost;

        $range_projection = combat_range_resolve_base($pdata, (string)$skill_id);
        if (empty($range_projection['ok'])) continue;
        $range_mode = (string)$range_projection['mode'];
        $range_max = (int)$range_projection['max'];
        $range_bonus = (int)$range_projection['bonus'];
        // Legacy consumers interpret action_range as the skill's base range.
        // Wallet-dependent reach is exposed separately as range.effective.
        $action_range = (int)$range_projection['base_range'];

        $skills[] = array(
            'act_id'       => $skill_id,
            'apcost'       => $apcost,
            'cd'           => $cd,
            'finisher'     => !empty($combat_config['finisher']) ? 1 : 0,
            'aimType'      => isset($combat_config['aim']['resolver']) ? (string)$combat_config['aim']['resolver'] : 'none',
            'selectionMode'=> in_array(($combat_config['aim']['resolver'] ?? 'none'), array('pid', 'tile'), true) ? 'explicit' : 'implicit',
            'captureResolver' => isset($combat_config['capture']['resolver']) ? (string)$combat_config['capture']['resolver'] : 'identity',
            'range_mode'   => $range_mode,
            'range_max'    => $range_max,
            'range_bonus'  => $range_bonus,
            'action_range' => $action_range,
            'range'        => array(
                'mode' => $range_mode,
                'base' => (int)$range_projection['base_range'],
                'effective' => $range_projection['effective_range'],
                'available_ap' => (int)$range_projection['available_ap'],
                'base_apcost' => (int)$range_projection['base_apcost'],
            ),
            'category'     => isset($definition['category']) ? $definition['category'] : 'assault',
            'hidden'       => !empty($definition['hidden']) || !empty($combat_config['hidden']),
            'lstact'       => $lstact,
            'current_tick' => $current_tick,
            'on_cd'        => $on_cd,
            'available'    => $available,
        );
    }

    return $skills;
}
