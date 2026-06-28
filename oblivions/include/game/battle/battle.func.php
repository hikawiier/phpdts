<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗系统功能文件 / Oblivions battle system
// 功能函数负责实现战斗系统的具体功能
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';

function battle_state_init(&$actor_data)
{
    # 进入战斗，初始化参战者的战斗状态
    $actor_data['action'] = 'battle';
}


function battle_state_clear(&$actor_data, &$obl_battle_log, &$battle_cache, $reason = 'unknown')
{
    # 二次调用保护：已清理则跳过
    if (empty($actor_data['action']) && empty($actor_data['bid'])) {
        return;
    }

    # ── reason 相关处理 ──
    if ($reason === 'death') {
        $actor_data['state'] = $actor_data['state'] ?: 1;
    }

    # ── 清空战斗状态 ──
    $actor_data['action'] = '';
    # 如果还存在关联中的战斗队列，退出队列
    if(!empty($actor_data['bid']))
    {
        battle_queue_exit($actor_data,$obl_battle_log,$battle_cache);
    }
    # 恢复AP
    $actor_data['ap'] = $actor_data['max_ap'];
    # 无论 bid 是否为空，都保存 action 的修改（避免战斗结束后卡在 battle 状态）
    obl_save_player($actor_data);
}








function battle_ap_recover(&$actor_data, &$battle_cache, &$obl_battle_log)
{
    #AP恢复函数：每轮开始时，先攻者恢复AP，恢复量为当前AP+AP上限，不会超过AP上限
    $old_ap = (int)$actor_data['ap'];
    $max_ap = (int)$actor_data['max_ap'];
    $actor_data['ap'] = min($old_ap + $max_ap, $max_ap);
    $recovered = $actor_data['ap'] - $old_ap;

    # 记录日志（AP 恢复信息）
    if ($obl_battle_log) {
        $obl_battle_log->setPhase('ap_recover');
        $obl_battle_log->emit([
            'actor_pid'    => (int)$actor_data['pid'],
            'actor_name'   => $actor_data['name'],
            'actor_ap'     => (int)$actor_data['ap'],
            'actor_max_ap' => (int)$actor_data['max_ap'],
            'effect_value' => $recovered,
        ]);
    }
}

function battle_act_verify(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache)
{
    #单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；
    #委托给技能系统的 skill_act_verify 处理：查配置、检查拥有、检查CD、检查AP、自动引用 verify 文件
    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    return skill_act_verify($actor_data, $act_id, $obl_battle_log, $battle_cache);
}

function battle_target_distance_check(&$actor_data, &$target_data, &$battle_cache)
{
    $actor_range = obl_get_range($actor_data);
    // 这里应该实现具体的距离检查逻辑，然后和射程比较判断目标是否合法。由于目前没有具体的距离计算逻辑，暂时默认所有目标都在射程内。
    return true;
}

function battle_apply_damage(&$actor_data, &$target_data, $damage, &$obl_battle_log, &$battle_cache)
{
    #伤害应用函数，输入目标数据、伤害数值，实际扣除目标HP，并且记录战斗日志
    $target_data['hp'] -= $damage;
    if ($target_data['hp'] < 0) {
        $target_data['hp'] = 0;
    }
}

// ================================================================
// Tag 系统 / Tag system
//
// 目标状态标记统一描述。Cat A 始终从当前 actor/target 重算；Cat B 通过
// $battle_cache['tag_mutations'][pid] 缓存，跨 action 可见。
// 配套设计：oblivions/docs/战斗执行阶段重构设计案.md §2
// ================================================================

/**
 * 单 tag 派生函数：目标已死（Cat B 首次派生用）
 */
function battle_tag_dead(&$target_data): bool {
    return (int)$target_data['state'] === 1;
}

/**
 * 单 tag 派生函数：目标是自己
 */
function battle_tag_self(&$actor_data, &$target_data): bool {
    return (int)$target_data['pid'] === (int)$actor_data['pid'];
}

/**
 * 单 tag 派生函数：目标超出当前 actor 射程
 */
function battle_tag_out_of_range(&$actor_data, &$target_data, &$battle_cache): bool {
    return !battle_target_distance_check($actor_data, $target_data, $battle_cache);
}

/**
 * 构建目标标签集（统一入口）
 *
 * Cat A（self/out_of_range）始终从当前 actor/target 重算；
 * Cat B（dead/escaped/hidden）从 $battle_cache['tag_mutations'][pid] 读取缓存，
 * 首次构建时从 DB 派生 dead，并将全量 Cat B 写回 tag_mutations。
 *
 * @param array  &$actor_data   动作者数据
 * @param array  &$target_data   目标数据
 * @param string $act_id         动作 ID（预留，便于未来动作驱动派生）
 * @param array  &$battle_cache
 * @return array [tag_name => bool, ...]
 */
function battle_build_target_tags(&$actor_data, &$target_data, $act_id, &$battle_cache): array {
    $tags = [];
    $pid = (int)$target_data['pid'];

    // ── Cat A：始终重算（依赖当前 actor，不可缓存）──
    $tags['self']         = battle_tag_self($actor_data, $target_data);
    $tags['out_of_range'] = battle_tag_out_of_range($actor_data, $target_data, $battle_cache);

    // ── Cat B：从缓存读取可变状态 tag ──
    $cached = $battle_cache['tag_mutations'][$pid] ?? null;
    if ($cached !== null) {
        $tags['dead']    = !empty($cached['dead']);
        $tags['escaped'] = !empty($cached['escaped']);
        $tags['hidden']  = !empty($cached['hidden']);
    } else {
        // 首次构建：从 DB 派生 dead，escaped/hidden 默认 false
        $tags['dead']    = battle_tag_dead($target_data);
        $tags['escaped'] = false;
        $tags['hidden']  = false;
    }

    // 只写 Cat B 到 tag_mutations（Cat A 每次重算）
    $battle_cache['tag_mutations'][$pid] = [
        'dead'    => $tags['dead'],
        'escaped' => $tags['escaped'],
        'hidden'  => $tags['hidden'],
    ];

    return $tags;
}

// ================================================================
// 动作-目标规则匹配 / Action-target rule matching
// 配套设计：§3
// ================================================================

/**
 * 白名单+黑名单规则匹配
 *
 * @param array $config 技能配置（需含 target_rules）
 * @param array $tags   battle_build_target_tags 返回的标签集
 * @return array ['pass' => bool, 'reason' => string|null]
 */
function battle_check_target_rules($config, array $tags): array {
    $rules = $config['target_rules'] ?? null;
    if (!$rules) return ['pass' => true, 'reason' => null];

    if (!empty($rules['require'])) {
        foreach ($rules['require'] as $tag) {
            if (empty($tags[$tag])) {
                return ['pass' => false, 'reason' => "require:{$tag}"];
            }
        }
    }

    if (!empty($rules['forbid'])) {
        foreach ($rules['forbid'] as $tag) {
            if (!empty($tags[$tag])) {
                return ['pass' => false, 'reason' => "forbid:{$tag}"];
            }
        }
    }

    return ['pass' => true, 'reason' => null];
}

// ================================================================
// Actor 行动资格检查 / Actor can-act check
// 配套设计：§6.1
// ================================================================

/**
 * 检查 actor 当前是否能行动（state>0 或 hp<=0 视为不能行动）
 *
 * 独立于调用方，失败时 emit 失败原因。
 *
 * @param array               &$actor_data
 * @param BattleLogCollector|null &$obl_battle_log
 * @return bool
 */
function battle_actor_can_act(&$actor_data, &$obl_battle_log, &$battle_cache = null): bool {
    $dead = false;
    if ((int)$actor_data['state'] > 0) {
        if ($obl_battle_log) {
            $obl_battle_log->setPhase('actor_state_check');
            $obl_battle_log->emit([
                'actor_pid' => (int)$actor_data['pid'],
                'reason'    => 'actor_dead',
            ], true);  // debug
        }
        $dead = true;
    }
    if ((int)$actor_data['hp'] <= 0) {
        if ($obl_battle_log) {
            $obl_battle_log->setPhase('actor_state_check');
            $obl_battle_log->emit([
                'actor_pid' => (int)$actor_data['pid'],
                'reason'    => 'actor_hp_zero',
            ], true);  // debug
        }
        $dead = true;
    }
    if ($dead && $battle_cache !== null) {
        $battle_cache['combatants'][(int)$actor_data['pid']] = 0;
        $battle_cache['tag_mutations'][(int)$actor_data['pid']]['dead'] = true;
    }
    return !$dead;
}

// ================================================================
// Turn 生命周期 hook / Turn lifecycle hooks
//
// Turn start / Turn end 在代码中的精确位置。
// 仅 Phase 1（有先攻队列的标准战斗）中存在 Turn；Phase 0（Ambush）无 Turn。
//
// Turn 的身份由先攻队列的 done 标志位标识：
//   - done=0 的 combatant 即为当前回合持有者
//   - manage_queue 在 step 6 取下一顺位时读的就是 done=0 的首行
//   - 因此在 Turn start hook 中可通过 queue 行定位 current turn holder
//
// Turn start hook 内递增 BattleLogCollector::$turnNum，使后续 emit 的
// bl_turn_num 标识"当前回合"。
// ================================================================

/**
 * Turn start hook
 *
 * 在 battle_manage_queue 末尾（step 6）调用，"下一 combatant 的回合已就绪"。
 * 此时下一 combatant 已确定顺位、已恢复 AP，尚未执行动作。
 *
 * 递增 BattleLogCollector 的 turnNum，使后续 emit 的 bl_turn_num 标识新回合。
 *
 * @param array  &$actor_data   下一 combatant 的数据
 * @param array  &$obl_battle_log
 * @param array  &$battle_cache
 */
function battle_hook_turn_start(&$actor_data, &$obl_battle_log, &$battle_cache): void {
    if ($obl_battle_log) {
        $obl_battle_log->nextTurn();
    }
}

/**
 * Turn end hook
 *
 * 在 battle_main_end 入口（step 4.5）调用，"当前 combatant 的行动已全部执行完毕"。
 * 仅 Phase 1 时触发（有先攻队列），Phase 0（Ambush）不触发。
 *
 * 不操作计数器（Turn end 不递增，Turn start 才递增——turn_num 标识"当前回合"）。
 *
 * @param array  &$actor_data   当前 combatant 的数据（刚刚完成行动的 actor）
 * @param array  &$obl_battle_log
 * @param array  &$battle_cache
 */
function battle_hook_turn_end(&$actor_data, &$obl_battle_log, &$battle_cache): void {
    // ── Turn end placeholder ──
}
