<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗执行模块
//
// 职责：战斗动作的校验和执行（verify → execute）。
// 队列管理（queue_check → finish_check）在 battle.queue.func.php。
// ================================================================

// 依赖声明（由 obl_bootstrap.php 统一加载，此处 require_once 仅作自文档化）
require_once GAME_ROOT . './oblivions/include/game/player.func.php';
require_once GAME_ROOT . './oblivions/include/game/sql.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php';

//回合主函数（纯执行，不含队列管理与 cleanup，1 次出手 = 1 Turn = 1 tick）
// $actor_data=先攻者data $atk_act=动作数组（数字索引，每项含 act_id + target）
// $battle_cache 由调用方传入并在 battle_main 返回后传给 battle_main_end + battle_manage_queue
// 队列管理与 cleanup 由调用方在 battle_main 返回后依次调用 battle_main_end() + battle_manage_queue()
function battle_main(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    $obl_battle_log->setPhase('verify');
    battle_verify($actor_data, $atk_act, $obl_battle_log, $battle_cache); 

    if (!empty($atk_act)) {
        // 终结技排序（安全兜底，不信任前端顺序）
        battle_sort_actions($atk_act);

        $obl_battle_log->setPhase('excute');
        battle_execute($actor_data, $atk_act, $obl_battle_log, $battle_cache);    
    }
}

function battle_verify(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    //回合校验函数（Turn）：检验输入的技能合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP
    //校验失败的act会从$atk_act中删除，校验成功的act会实际扣除AP
    //$atk_act 是数字索引数组，每项含 act_id + target
    foreach ($atk_act as $key => $act)
    {
        $act_id = $act['act_id'];
        if (!battle_act_verify($actor_data, $act_id, $obl_battle_log, $battle_cache)) { //单个动作校验函数：检验动作合法性，检验动作执行者是不是真的有这个动作、满不满足AP需求，并且实际扣除AP；成功返回true，失败返回false；
            unset($atk_act[$key]); //校验失败 从$atk_act中删除这个act
        }
    }
    # 重新索引数组，保证 key 连续
    $atk_act = array_values($atk_act);
}

function battle_execute(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    //$atk_act 是数字索引数组，每项含 act_id + target
    //target 可以是单个 pid 或 pid 数组（影响多目标的动作）
    foreach ($atk_act as $act) {
        $act_id = $act['act_id'];

        // A. 动作者能不能行动（per act 一次）
        if (!battle_actor_can_act($actor_data, $obl_battle_log, $battle_cache)) continue;

        $targets_array = is_array($act['target']) ? $act['target'] : array($act['target']);

        foreach ($targets_array as $target_id) {
            $verify_result = battle_execute_verify(
                $actor_data,
                ['act_id' => $act_id, 'target' => $target_id],
                $obl_battle_log,
                $battle_cache
            );
            if (!$verify_result) continue;

            $target_data = &$verify_result['target_data'];

            battle_once_execute($actor_data, $act_id, $target_data, $obl_battle_log, $battle_cache);
        }
    }
}

function battle_once_execute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache)
{
    # 受击目标进入战斗状态（突袭时首次命中触发）
    battle_state_init($target_data);

    // 执行动作前保存 HP 快照
    $actor_hp_before  = (int)$actor_data['hp'];
    $target_hp_before = (int)$target_data['hp'];

    // ── 动作执行前快照 ──
    if ($obl_battle_log) {
        $obl_battle_log->setPhase('once_execute_pre');
        $obl_battle_log->emit([
            'actor_pid'     => (int)$actor_data['pid'],
            'actor_type'    => (int)$actor_data['type'],
            'actor_name'    => $actor_data['name'],
            'actor_hp'      => $actor_hp_before,
            'actor_max_hp'  => (int)$actor_data['mhp'],
            'target_pid'    => (int)$target_data['pid'],
            'target_type'   => (int)$target_data['type'],
            'target_name'   => $target_data['name'],
            'target_hp'     => $target_hp_before,
            'target_max_hp' => (int)$target_data['mhp'],
            'action_id'     => $act_id,
        ]);
    }

    // 技能执行（处理非伤害效果，如逃跑等复杂逻辑；可写 tag_mutations，不改 HP）
    include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
    skill_execute($actor_data, $act_id, $target_data, $obl_battle_log, $battle_cache);

    //执行act_id具体的打击动作
    $damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache);
    battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache);

    // ── 动作执行后快照 ──
    if ($obl_battle_log) {
        $obl_battle_log->setPhase('once_execute_post');
        $obl_battle_log->emit([
            'actor_pid'    => (int)$actor_data['pid'],
            'actor_hp'     => (int)$actor_data['hp'],
            'target_pid'   => (int)$target_data['pid'],
            'target_hp'    => (int)$target_data['hp'],
            'action_id'    => $act_id,
            'effect_value' => $damage,
            'success'      => true,
        ]);
    }

    // ── 后检：用 tag 判定能否继续战斗，只写缓存（combatants + tag_mutations），不写 DB ──
    battle_state_middle_check($actor_data, $target_data, $act_id, $obl_battle_log, $battle_cache);

    obl_save_player($actor_data); //保存攻击者数据到数据库
    obl_save_player($target_data); //保存目标数据到数据库
}

// ================================================================
// 执行阶段校验 / Execute verify
// 配套设计：§7
// ================================================================

/**
 * 单 action-目标 校验：获取目标 → 构建 tag → 比对 target_rules
 *
 * @param array  &$actor_data  动作者数据
 * @param array  $act          ['act_id' => string, 'target' => int]
 * @param BattleLogCollector &$obl_battle_log
 * @param array  &$battle_cache
 * @return array|null ['target_data' => &array, 'tags' => array] 或 null
 */
function battle_execute_verify(&$actor_data, $act, &$obl_battle_log, &$battle_cache) {
    $act_id    = $act['act_id'];
    $target_id = (int)$act['target'];

    // B. 获取目标数据
    $target_data = obl_fetch_playerdata_by_pid($target_id);
    if (!$target_data) {
        // B4：pid 不存在
        if ($obl_battle_log) {
            $obl_battle_log->setPhase('execute_verify_failed');
            $obl_battle_log->emit([
                'actor_pid'  => (int)$actor_data['pid'],
                'actor_name' => $actor_data['name'],
                'action_id'  => $act_id,
                'reason'     => 'target_not_found',
            ]);
        }
        return null;
    }

    // C. 构建目标标签（内部自动合并 tag_mutations）
    $tags = battle_build_target_tags($actor_data, $target_data, $act_id, $battle_cache);

    // D. 动作-标签规则对齐
    $config = skill_get_config($act_id);
    if ($config !== null) {
        $check = battle_check_target_rules($config, $tags);
        if (!$check['pass']) {
            if ($obl_battle_log) {
                $obl_battle_log->setPhase('execute_verify_failed');
                $obl_battle_log->emit([
                    'actor_pid'  => (int)$actor_data['pid'],
                    'actor_name' => $actor_data['name'],
                    'action_id'  => $act_id,
                    'reason'     => $check['reason'],
                ]);
            }
            return null;
        }
    }

    return ['target_data' => &$target_data, 'tags' => $tags];
}

// ================================================================
// 执行内状态后检 / Middle check
// 配套设计：§8
// ================================================================

/**
 * 伤害结算后写入缓存：combatants + tag_mutations
 *
 * 检测规则（互斥）：
 *   - 已有 escaped mutation → combatants[pid]=0，不改 dead
 *   - hp>0 且 state==0     → combatants[pid]=1
 *   - 其他（hp<=0 或 state=1）→ combatants[pid]=0 + tag_mutations[pid]['dead']=true
 *
 * @param array  &$actor_data
 * @param array  &$target_data
 * @param string $act_id
 * @param BattleLogCollector|null &$obl_battle_log
 * @param array  &$battle_cache
 * @return void
 */
function battle_state_middle_check(&$actor_data, &$target_data, $act_id, &$obl_battle_log, &$battle_cache): void {
    $pid = (int)$target_data['pid'];
    $hp  = (int)$target_data['hp'];

    // 读取当前缓存标签
    $mutations = $battle_cache['tag_mutations'][$pid] ?? [];
    $escaped = !empty($mutations['escaped']);
    $isDead = $hp <= 0 || (int)$target_data['state'] === 1;

    if (!$isDead && !$escaped) {
        $battle_cache['combatants'][$pid] = 1;
    } elseif ($escaped) {
        // 已逃跑：只标记 combatants，不改 dead
        $battle_cache['combatants'][$pid] = 0;
    } else {
        // 死亡：标记 combatants + 更新 mutation
        $battle_cache['combatants'][$pid] = 0;
        $battle_cache['tag_mutations'][$pid]['dead'] = true;

        if ($obl_battle_log) {
            $obl_battle_log->setPhase('middle_check_target_dead');
            $obl_battle_log->emit([
                'actor_pid'   => (int)$actor_data['pid'],
                'target_pid'  => $pid,
                'target_name' => $target_data['name'],
                'action_id'   => $act_id,
            ]);
        }
    }
}

// ================================================================
// 集中 cleanup / battle_main_end
// 配套设计：§9
// ================================================================

/**
 * battle_main 后的集中 cleanup（由 battle_entry_dispatch step 4.5 调用）
 *
 * 对 combatants[pid]=0 的战场单位执行清理。
 * ambush 模式下 actor 死亡/逃离时不清理 actor，改返回 flag 给 dispatch 决策。
 *
 * @param array  &$actor_data
 * @param array  &$atk_act
 * @param BattleLogCollector &$obl_battle_log
 * @param array  &$battle_cache
 * @return string|null ambush 下 actor 退出时返回 'dead'|'escaped'，否则 null
 */
function battle_main_end(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache): ?string {
    if (empty($battle_cache['combatants'])) return null;

    $actor_pid = (int)$actor_data['pid'];
    $is_ambush = !empty($battle_cache['is_ambush']);
    $ambusher_quit = null;

    // ── Turn end hook：当前 combatant 的行动已全部执行完毕（仅 Phase 1）──
    if (!empty($actor_data['bid'])) {
        battle_hook_turn_end($actor_data, $obl_battle_log, $battle_cache);
    }

    // ── Actor 补充死亡检测（写缓存，统一由 foreach 处理）──
    if ((int)$actor_data['hp'] <= 0 || (int)$actor_data['state'] > 0) {
        $battle_cache['combatants'][$actor_pid] = 0;
        $battle_cache['tag_mutations'][$actor_pid]['dead'] = true;
    }

    foreach ($battle_cache['combatants'] as $pid => $status) {
        if ($status !== 0) continue;

        // ambush actor quit → 不清理，返回 flag 让 dispatch 决策
        if ($is_ambush && (int)$pid === $actor_pid) {
            $mutations = $battle_cache['tag_mutations'][$actor_pid] ?? [];
            if (!empty($mutations['escaped'])) {
                $ambusher_quit = 'escaped';
                continue;
            }
            if (!empty($mutations['dead'])) {
                $ambusher_quit = 'dead';
                continue;
            }
        }

        $mutations = $battle_cache['tag_mutations'][(int)$pid] ?? [];
        $target_data = $actor_data['pid'] == $pid ? $actor_data : obl_fetch_playerdata_by_pid((int)$pid);
        if (!$target_data) continue;

        $reason = !empty($mutations['escaped']) ? 'escaped' : (!empty($mutations['dead']) ? 'death' : 'unknown');

        if ($obl_battle_log) {
            $obl_battle_log->setPhase('combatant_cleared');
            $obl_battle_log->emit([
                'cleared_pid'  => (int)$pid,
                'cleared_name' => $target_data['name'],
                'reason'       => $reason,
            ], $reason === 'unknown');
        }
        battle_state_clear($target_data, $obl_battle_log, $battle_cache, $reason);
    }

    return $ambusher_quit;
}

/**
 * 终结技排序（verify 后、execute 前调用）
 *
 * 强制将 finisher 动作排列到队列末尾，确保终结技最后执行。
 * 若存在多个终结技，只保留最后一个（后提交覆盖前面的）。
 *
 * @param array &$atk_act 动作数组（引用）
 */
function battle_sort_actions(array &$atk_act) {
    $normal = array();
    $finishers = array();

    foreach ($atk_act as $act) {
        if (skill_is_finisher($act['act_id'])) {
            $finishers[] = $act;
        } else {
            $normal[] = $act;
        }
    }

    if (count($finishers) > 1) {
        $finishers = array(array_pop($finishers));
    }

    $atk_act = array_merge($normal, $finishers);
}

