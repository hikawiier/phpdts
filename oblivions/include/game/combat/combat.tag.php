<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 标签系统（判断/匹配分离，纯读）
//
// 职责：
//   - 派生函数注册表 $combat_tag_derivers：tag 名 => 派生函数
//   - 派生函数签名：function(CombatContext $ctx): bool（无 &）
//   - 构建函数 combat_tag_build：遍历注册表，组合 tag 名 => bool 关联数组
//   - 规则匹配 combat_check_target_rules：纯配置驱动，检查 forbid 列表
//
// 标签分类（spec §3 纯读约束）：
//   - Cat A（可逆状态，每次重算，不持久化）：
//       self / out_of_range / tile_impassable / tile_occupied
//       tile_unreachable / tile_out_of_range
//     依赖当前 actor 位置 + target 状态，同回合内可能变化，必须重算。
//   - Cat B（不可逆状态，从 tag_mutations 读，纯读不写）：
//       dead / escaped / hidden
//     跨 action 可见，写入只能由 post_check / effect applier 完成。
//
// AP 检查不入标签系统——AP 是 actor-act 关系，走 AP 系统独立路径。
//
// 与旧系统边界：旧系统 battle_build_target_tags 用 if-else 链硬编码派生。
//   新系统注册表化，新增 tag 只需注册派生函数，匹配层零业务逻辑。
// ================================================================

/** @var array 标签派生函数注册表（tag 名 => callable） */
if (!isset($GLOBALS['combat_tag_derivers'])) {
    $GLOBALS['combat_tag_derivers'] = [];
}

/**
 * 注册标签派生函数
 *
 * @param string   $name    标签名（self / out_of_range / dead / ...）
 * @param callable $deriver 派生函数签名：function(CombatContext $ctx): bool
 */
function combat_tag_register(string $name, callable $deriver): void {
    $GLOBALS['combat_tag_derivers'][$name] = $deriver;
}

// ================================================================
// 内部辅助：射程计算（基于 $ctx->config['range']）
// ================================================================

/**
 * 计算技能的有效射程（BFS 跳数）
 *
 * 复用旧 obl_get_range / obl_get_range_fix 的基础射程概念，但读取新配置结构
 * $ctx->config['range'] = ['mode' => ..., 'max' => int, 'bonus' => int]。
 *
 * 支持的 mode：
 *   - fixed           ：固定 range_max
 *   - inherit         ：继承 actor 基础射程（obl_get_range）
 *   - additive        ：actor 基础射程 + range_bonus
 *   - capped_additive ：min(actor 基础射程 + range_bonus, range_max)
 *   - move_power      ：obl_get_move_power(actor)
 *
 * @param CombatContext $ctx
 * @return int
 */
function combat_tag_compute_range(CombatContext $ctx): int {
    $range_cfg = $ctx->config['range'] ?? ['mode' => 'fixed', 'max' => 1, 'bonus' => 0];
    $mode  = $range_cfg['mode'] ?? 'fixed';
    $max   = (int)($range_cfg['max'] ?? 1);
    $bonus = (int)($range_cfg['bonus'] ?? 0);

    switch ($mode) {
        case 'inherit':
            return obl_get_range($ctx->actor_data);
        case 'additive':
            return obl_get_range($ctx->actor_data) + $bonus;
        case 'capped_additive':
            return min(obl_get_range($ctx->actor_data) + $bonus, $max);
        case 'move_power':
            return obl_get_move_power($ctx->actor_data);
        case 'fixed':
        default:
            return $max;
    }
}

// ================================================================
// Cat A 派生函数（每次重算，纯读）
// ================================================================

/**
 * self：当前 target 的 pid == actor 的 pid
 *
 * self 目标技能（heal）通过 target='self' 解析后 target_data 引用 actor_data，
 * 自然满足 pid 相等。enemy 目标若玩家误选自己也会派生为 true，由 rules.forbid 拦截。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_self(CombatContext $ctx): bool {
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;
    $target_pid = (int)($target_data['pid'] ?? 0);
    $actor_pid  = (int)($ctx->actor_data['pid'] ?? 0);
    return $target_pid > 0 && $target_pid === $actor_pid;
}

/**
 * out_of_range：距离 > 技能射程（pid 目标专用）
 *
 * 距离 = obl_get_distance(actor.pgroup, actor.pls, target.pls)
 * 不可达（-1）视为超距。tile 目标本标签固定 false（tile 有独立标签）。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_out_of_range(CombatContext $ctx): bool {
    if (!$ctx->isPidTarget()) return false;
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;

    $distance = obl_get_distance(
        (int)($ctx->actor_data['pgroup'] ?? 0),
        (int)($ctx->actor_data['pls'] ?? 0),
        (int)($target_data['pls'] ?? 0)
    );
    if ($distance < 0) return true;

    $range = combat_tag_compute_range($ctx);
    return $distance > $range;
}

/**
 * tile_impassable：目标图格不可通行（tile 目标专用）
 *
 * 图格不存在也视为不可通行。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_tile_impassable(CombatContext $ctx): bool {
    if (!$ctx->isTileTarget()) return false;
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;

    $pgroup = (int)($target_data['pgroup'] ?? 0);
    $pls    = (int)($target_data['pls'] ?? 0);
    $map    = obl_get_map_data($pgroup);
    $tile   = $map['tiles'][$pgroup][$pls] ?? null;
    if ($tile === null) return true;
    return empty($tile['passable']);
}

/**
 * tile_occupied：目标图格被占用（tile 目标专用，调 obl_get_pids_in_tile）
 *
 * 排除 actor 自身（actor 站在自己目标格内不算被占用）。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_tile_occupied(CombatContext $ctx): bool {
    if (!$ctx->isTileTarget()) return false;
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;

    $pgroup      = (int)($target_data['pgroup'] ?? 0);
    $pls         = (int)($target_data['pls'] ?? 0);
    $exclude_pid = (int)($ctx->actor_data['pid'] ?? 0);
    $occupiers   = obl_get_pids_in_tile($pgroup, $pls, $exclude_pid);
    return !empty($occupiers);
}

/**
 * tile_unreachable：目标图格不可达（BFS 距离 -1）
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_tile_unreachable(CombatContext $ctx): bool {
    if (!$ctx->isTileTarget()) return false;
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;

    $distance = obl_get_distance(
        (int)($ctx->actor_data['pgroup'] ?? 0),
        (int)($ctx->actor_data['pls'] ?? 0),
        (int)($target_data['pls'] ?? 0)
    );
    return $distance < 0;
}

/**
 * tile_out_of_range：目标图格距离 > 技能射程（tile 目标专用）
 *
 * move 技能的 range.mode=move_power，因此仍按移动力拦截；grenade 等
 * tile 技能可使用 fixed/additive 等射程配置。不可达也视为超距。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_tile_out_of_range(CombatContext $ctx): bool {
    if (!$ctx->isTileTarget()) return false;
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;

    $distance = obl_get_distance(
        (int)($ctx->actor_data['pgroup'] ?? 0),
        (int)($ctx->actor_data['pls'] ?? 0),
        (int)($target_data['pls'] ?? 0)
    );
    if ($distance < 0) return true;

    if (($ctx->config['ap_calc'] ?? '') === 'move_distance') {
        $move_power = max(1, obl_get_move_power($ctx->actor_data));
        $apcost = max(1, (int)($ctx->config['apcost'] ?? 1));
        $actor_ap = max(0, (int)($ctx->actor_data['ap'] ?? 0));
        $range = $move_power * (int)floor($actor_ap / $apcost);
        return $distance > $range;
    }

    $range = combat_tag_compute_range($ctx);
    return $distance > $range;
}

// ================================================================
// Cat B 派生函数（从 tag_mutations 读，纯读不写）
// ================================================================

/**
 * dead：从 tag_mutations[target_pid]['dead'] 读
 *
 * tile 目标 pid=0，无 mutation，固定 false。
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_dead(CombatContext $ctx): bool {
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return false;
    $mutations = $ctx->battle_cache['tag_mutations'][$pid] ?? [];
    return !empty($mutations['dead']);
}

/**
 * escaped：从 tag_mutations[target_pid]['escaped'] 读
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_escaped(CombatContext $ctx): bool {
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return false;
    $mutations = $ctx->battle_cache['tag_mutations'][$pid] ?? [];
    return !empty($mutations['escaped']);
}

/**
 * hidden：从 tag_mutations[target_pid]['hidden'] 读
 *
 * @param CombatContext $ctx
 * @return bool
 */
function combat_tag_derive_hidden(CombatContext $ctx): bool {
    $target = $ctx->getCurrentTarget();
    $target_data = $target['target_data'] ?? null;
    if (!is_array($target_data)) return false;
    $pid = (int)($target_data['pid'] ?? 0);
    if ($pid <= 0) return false;
    $mutations = $ctx->battle_cache['tag_mutations'][$pid] ?? [];
    return !empty($mutations['hidden']);
}

// ================================================================
// 构建函数 + 规则匹配
// ================================================================

/**
 * 构建标签集（遍历注册表，组合 tag 名 => bool）
 *
 * 纯读约束（spec §3）：不写 tag_mutations，仅派生 + 返回。
 * Cat A 每次重算，Cat B 从 tag_mutations 读（也是纯读）。
 *
 * @param CombatContext $ctx
 * @return array [tag_name => bool, ...]
 */
function combat_tag_build(CombatContext $ctx): array {
    $tags = [];
    foreach ($GLOBALS['combat_tag_derivers'] as $name => $deriver) {
        $tags[$name] = (bool)call_user_func($deriver, $ctx);
    }
    return $tags;
}

/**
 * 规则匹配（纯配置驱动，零业务逻辑）
 *
 * 检查 $config['rules']['forbid'] 数组，任一 forbid tag 在 $tags 中为 true
 * 则校验失败，返回 pass=false + reason=tag_name。全部通过返回 pass=true。
 *
 * AP 检查不在此处——AP 走 combat_ap_calculate 独立路径。
 *
 * @param array $config 技能配置（含 rules.forbid）
 * @param array $tags   标签集 [tag_name => bool, ...]
 * @return array ['pass' => bool, 'reason' => string|null]
 */
function combat_check_target_rules(array $config, array $tags): array {
    $rules  = $config['rules'] ?? [];
    $forbid = $rules['forbid'] ?? [];
    if (!is_array($forbid)) $forbid = [];

    foreach ($forbid as $tag_name) {
        if (!empty($tags[$tag_name])) {
            return ['pass' => false, 'reason' => $tag_name];
        }
    }
    return ['pass' => true, 'reason' => null];
}

// ================================================================
// 注册内置派生函数
// ================================================================

// Cat A（每次重算）
combat_tag_register('self',              'combat_tag_derive_self');
combat_tag_register('out_of_range',      'combat_tag_derive_out_of_range');
combat_tag_register('tile_impassable',   'combat_tag_derive_tile_impassable');
combat_tag_register('tile_occupied',     'combat_tag_derive_tile_occupied');
combat_tag_register('tile_unreachable',  'combat_tag_derive_tile_unreachable');
combat_tag_register('tile_out_of_range', 'combat_tag_derive_tile_out_of_range');

// Cat B（从 tag_mutations 读）
combat_tag_register('dead',    'combat_tag_derive_dead');
combat_tag_register('escaped', 'combat_tag_derive_escaped');
combat_tag_register('hidden',  'combat_tag_derive_hidden');
