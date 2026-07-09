<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 技能系统（配置 + 校验 + 模块加载）
//
// 职责：
//   - combat_skill_get_config：从 combat_skill_config.php 读取技能配置（带静态缓存）
//   - combat_skill_load_module：按需 require 技能模块文件（skill_{act_id}_execute 钩子）
//   - combat_skill_verify：校验技能存在性 + AP 足够性 + 规则匹配
//
// 技能钩子约定（spec）：
//   - 钩子函数名：skill_{act_id}_execute(CombatContext $ctx): void（无 &）
//   - 钩子内调 $ctx->declareEffect(...) 声明效果
//   - 钩子内禁止直接改 actor_data / battle_cache / tag_mutations（move 除外）
//   - 钩子内禁止调 obl_save_player（persist 阶段统一保存）
//   - 例外：move 技能在 execute 阶段调 obl_perform_move_core（有副作用——改位置）
//
// 校验流程（combat_skill_verify）：
//   1. 技能存在性：combat_skill_get_config 不为 null
//   2. AP 足够性：combat_ap_calculate 得 ap_cost，检查 actor.ap >= ap_cost
//      （此处单 action 校验，wallet 预扣在 verify 阶段处理）
//   3. 规则匹配：combat_check_target_rules($ctx->config, $ctx->getCurrentTags())
//   全部通过返回 true，否则设 $ctx->success=false + failure_reason 并返回 false
//
// 与旧系统边界：旧系统走 skill_act_verify + skill_load_modules，
//   新系统配置源独立（combat_skill_config.php）+ 校验逻辑基于 CombatContext。
// ================================================================

/**
 * 加载全部技能配置到静态缓存（内部辅助函数）
 *
 * 首次调用 require combat_skill_config.php 获取 $COMBAT_SKILL_CONFIG。
 * 后续调用直接返回静态缓存，避免重复 require。
 *
 * 文件缺失时 error_log 警告并返回空数组（不抛错，让上层优雅降级）。
 *
 * @return array [act_id => config, ...]
 */
function combat_skill_load_all_configs(): array {
    static $config_cache = null;
    if ($config_cache === null) {
        $config_file = GAME_ROOT . './oblivions/gamedata/combat_skill_config.php';
        if (!file_exists($config_file)) {
            error_log("[combat_skill] Config file missing: {$config_file}");
            $config_cache = [];
            return $config_cache;
        }
        $config_cache = require $config_file;
        if (!is_array($config_cache)) {
            $config_cache = [];
        }
    }
    return $config_cache;
}

/**
 * 读取技能配置（带静态缓存）
 *
 * 通过 combat_skill_load_all_configs 复用静态缓存，避免重复 require。
 *
 * @param string $act_id 技能 ID
 * @return array|null 配置数组，不存在返回 null
 */
function combat_skill_get_config(string $act_id): ?array {
    $all = combat_skill_load_all_configs();
    return $all[$act_id] ?? null;
}

/**
 * 读取全部技能配置（带静态缓存，与 combat_skill_get_config 共享缓存）
 *
 * 供 L0 可达性判断（combat_get_max_attack_range）遍历所有技能使用。
 *
 * @return array [act_id => config, ...]，配置文件缺失返回空数组
 */
function combat_skill_get_all_configs(): array {
    return combat_skill_load_all_configs();
}

/**
 * 加载技能模块（按需 require_once）
 *
 * 模块文件路径：oblivions/gamedata/combat_skills/skill_{act_id}.php
 * 模块内可定义：
 *   - skill_{act_id}_execute(CombatContext $ctx): void  — 执行钩子（必须）
 *   - 自定义 AP 计算器注册（combat_ap_register）         — 可选
 *   - 自定义效果应用器注册（combat_effect_register）     — 可选
 *
 * 文件不存在时 error_log 警告但不报错（技能可能不需要模块，纯配置驱动）。
 *
 * @param string $act_id 技能 ID
 */
function combat_skill_load_module(string $act_id): void {
    $module_file = GAME_ROOT . "./oblivions/gamedata/combat_skills/skill_{$act_id}.php";
    if (!file_exists($module_file)) {
        // 技能可能不需要模块（纯配置驱动），仅记录调试日志
        error_log("[combat_skill] Module file missing for act_id={$act_id} (may be config-only skill)");
        return;
    }
    require_once $module_file;
}

/**
 * 校验技能（存在性 + AP 足够性 + 规则匹配）
 *
 * 校验流程：
 *   1. 技能存在性：combat_skill_get_config($ctx->act_id) 不为 null
 *   2. AP 足够性：调 combat_ap_calculate 得 ap_cost，
 *      检查 $ctx->actor_data['ap'] >= ap_cost
 *      （此处单 action 校验；动作链 planned state / wallet 在 combat.chain.php
 *      的 combat_chain_project 中处理）
 *   3. 规则匹配：调 combat_check_target_rules($ctx->config, $ctx->getCurrentTags())
 *
 * 全部通过返回 true 并写入 $ctx->ap_cost；失败设 $ctx->success=false +
 * $ctx->failure_reason 并返回 false。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_skill_verify(CombatContext $ctx): bool {
    // 1. 技能存在性
    $config = combat_skill_get_config($ctx->act_id);
    if ($config === null) {
        $ctx->success = false;
        $ctx->failure_reason = "skill_not_found:{$ctx->act_id}";
        return false;
    }

    // 2. AP 足够性（单 action 校验，wallet 预扣在 verify 阶段处理）
    $ap_cost = combat_ap_calculate($ctx);
    $actor_ap = (int)($ctx->actor_data['ap'] ?? 0);
    if ($actor_ap < $ap_cost) {
        $ctx->success = false;
        $ctx->failure_reason = "ap_insufficient:need={$ap_cost},have={$actor_ap}";
        return false;
    }
    $ctx->ap_cost = $ap_cost;

    // 3. 规则匹配（纯配置驱动，检查 forbid 列表）
    $tags = $ctx->getCurrentTags();
    $rule_result = combat_check_target_rules($ctx->config, $tags);
    if (!$rule_result['pass']) {
        $ctx->success = false;
        $ctx->failure_reason = "rule_forbid:{$rule_result['reason']}";
        return false;
    }

    return true;
}
