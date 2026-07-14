<?php
/**
 * @module D 战斗系统（Combat）
 * @framework D-15 AP 钱包计算器
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — AP 系统（动态为基准 + planned wallet）
//
// 职责：
//   - 计算器注册表 $combat_ap_calculators：calc_id => 计算器函数
//   - 计算器签名：function(CombatContext $ctx): int（无 &）
//   - 入口函数 combat_ap_calculate：按 $ctx->config['ap_calc'] 查注册表分发
//   - 注册函数 combat_ap_register：允许注册自定义计算器（如 throw_distance）
//
// 关键语义变化（spec）：
//   - apcost 从"最终消耗"变为"计算基数"——计算器的输入参数
//   - ap_calc 替代旧 ap_mode——标识计算器，而非模式分支
//   - 留空默认 'fixed'：静态 AP 技能无需显式配置（向下兼容）
//
// wallet / planned state（spec §2）：
//   - 动作链投影阶段调 combat_ap_calculate 得 ap_cost
//   - 检查 planned actor.ap - ap_cost >= 0
//   - 通过则写入 $action['_ap_cost']，并推进 planned actor.ap
//   - persist 阶段从 $action['_ap_cost'] 读，不重算
//   （动作链逻辑在 combat.chain.php，本文件只提供计算器）
//
// 与旧系统边界：旧系统 AP 是静态配置字段（skill config.apcost），新系统
//   支持动态计算 + 注册扩展（装备/标签修正 AP 消耗），fixed 是退化特例。
// ================================================================

/** @var array AP 计算器注册表（calc_id => callable，返回 int） */
if (!isset($GLOBALS['combat_ap_calculators'])) {
    $GLOBALS['combat_ap_calculators'] = [];
}
if (!isset($GLOBALS['combat_ap_budget_projectors'])) {
    $GLOBALS['combat_ap_budget_projectors'] = [];
}

/**
 * 注册 AP 计算器
 *
 * @param string   $calc_id    计算器标识（fixed / move_distance / throw_distance / ...）
 * @param callable $calculator 计算器签名：function(CombatContext $ctx): int
 */
function combat_ap_register(string $calc_id, callable $calculator): void {
    $GLOBALS['combat_ap_calculators'][$calc_id] = $calculator;
}

function combat_ap_budget_register(string $calc_id, callable $projector): void {
    $GLOBALS['combat_ap_budget_projectors'][$calc_id] = $projector;
}

// AP 预算投影：根据 ap_calc 类型调用对应的 budget projector，返回可用 AP 的射程预算
function combat_ap_project_budget(array $actor_data, array $config, ?int $available_ap = null): ?array {
    $calc_id = (string)($config['ap_calc'] ?? 'fixed');
    if ($calc_id === '') $calc_id = 'fixed';
    $projector = $GLOBALS['combat_ap_budget_projectors'][$calc_id] ?? null;
    if (!$projector) return null;
    $available_ap = $available_ap === null
        ? max(0, (int)($actor_data['ap'] ?? 0))
        : max(0, $available_ap);
    return call_user_func($projector, $actor_data, $config, $available_ap);
}

// ================================================================
// 内置计算器
// ================================================================

/**
 * fixed 计算器（默认）：返回 config['apcost']
 *
 * 静态 AP 技能的退化特例，大多数技能使用。
 *
 * @param CombatContext $ctx
 * @return int
 */
function combat_ap_calc_fixed(CombatContext $ctx): int {
    return (int)($ctx->config['apcost'] ?? 0);
}

/**
 * move_distance 计算器：按移动距离动态计算 AP
 *
 * 公式：max(apcost, ceil(distance / move_power))
 *   - move_power = obl_get_move_power(actor)（单次移动力）
 *   - distance = obl_get_distance(actor.pgroup, actor.pls, target.pls)
 *
 * 兜底：distance <= 0 时返回 apcost（无法计算距离时按基数走）。
 *
 * @param CombatContext $ctx
 * @return int
 */
function combat_ap_calc_move_distance(CombatContext $ctx): int {
    $apcost = (int)($ctx->config['apcost'] ?? 0);

    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) {
        return $apcost;
    }

    $distance = obl_get_distance(
        (int)($ctx->actor_data['pgroup'] ?? 0),
        (int)($ctx->actor_data['pls'] ?? 0),
        (int)($target_data['pls'] ?? 0)
    );
    if ($distance <= 0) {
        return $apcost;
    }

    $move_power = obl_get_move_power($ctx->actor_data);
    if ($move_power <= 0) {
        return $apcost;
    }

    return max($apcost, (int)ceil($distance / $move_power));
}

// ================================================================
// 入口函数
// ================================================================

/**
 * 计算 AP 消耗（按 $ctx->config['ap_calc'] 查注册表分发）
 *
 * 未知 calc_id 时 error_log 警告 + 兜底 fixed 计算器，保证战斗不中断。
 *
 * @param CombatContext $ctx
 * @return int
 */
function combat_ap_calculate(CombatContext $ctx): int {
    $calc_id = $ctx->config['ap_calc'] ?? 'fixed';
    if ($calc_id === '') $calc_id = 'fixed';

    $calculator = $GLOBALS['combat_ap_calculators'][$calc_id] ?? null;
    if (!$calculator) {
        error_log("[combat_ap] Unknown ap_calc: {$calc_id}, fallback to fixed");
        $calculator = $GLOBALS['combat_ap_calculators']['fixed'] ?? 'combat_ap_calc_fixed';
    }

    return (int)call_user_func($calculator, $ctx);
}

// ================================================================
// 注册内置计算器
// ================================================================

combat_ap_register('fixed',         'combat_ap_calc_fixed');
combat_ap_register('move_distance', 'combat_ap_calc_move_distance');
combat_ap_budget_register('move_distance', static function (array $actor_data, array $config, int $available_ap): array {
    $base_apcost = max(0, (int)($config['apcost'] ?? 0));
    $move_power = max(0, (int)obl_get_move_power($actor_data));
    return array(
        'effective_range' => $available_ap >= $base_apcost ? $move_power * $available_ap : 0,
        'available_ap' => $available_ap,
        'base_apcost' => $base_apcost,
    );
});
